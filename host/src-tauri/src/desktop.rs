//! Everything that makes the host behave like a desktop app rather than a
//! window that has to be babysat: a tray icon so it can keep running out of
//! sight, launch-at-login so the phone can connect whenever it is opened,
//! and one-click fixes for the two things that otherwise stop a first run
//! dead -- the missing gamepad driver and the Windows Firewall.

use std::path::PathBuf;
use std::sync::Mutex;

use tauri::menu::{CheckMenuItem, Menu, MenuItem, PredefinedMenuItem};
use tauri::tray::{MouseButton, MouseButtonState, TrayIconBuilder, TrayIconEvent};
use tauri::{AppHandle, Emitter, Manager, Wry};

use crate::server::SharedPad;
use crate::status::SharedStatus;

const TRAY_ID: &str = "main";

/// Passed by the launch-at-login entry so the host starts straight into the
/// tray instead of putting a window in front of whatever the user is doing.
pub const BACKGROUND_ARG: &str = "--background";

#[cfg(windows)]
const RUN_KEY: &str = r"Software\Microsoft\Windows\CurrentVersion\Run";
#[cfg(windows)]
const RUN_VALUE: &str = "PhoneControllerHost";

/// Private address ranges (IPv4 private, carrier-grade NAT, link-local,
/// IPv6 unique-local and link-local) -- the firewall rule's allowed remotes.
#[cfg(windows)]
const PRIVATE_RANGES: &str =
    "10.0.0.0/8,172.16.0.0/12,192.168.0.0/16,100.64.0.0/10,169.254.0.0/16,fc00::/7,fe80::/10";

/// The controller and page ports, plus the spare ones ports.rs falls back
/// to when they're taken. Opened by port as well as by program, so the rule
/// still matches if Windows doesn't tie the connection to this exe's path.
#[cfg(windows)]
const APP_PORTS: &str = "8787-8799";

const VIGEM_RELEASES_URL: &str = "https://github.com/nefarius/ViGEmBus/releases/latest";
#[cfg(windows)]
const VIGEM_INSTALLER_URL: &str =
    "https://github.com/nefarius/ViGEmBus/releases/download/v1.22.0/ViGEmBus_1.22.0_x64_x86_arm64.exe";

// ---------------------------------------------------------------------------
// Preferences
// ---------------------------------------------------------------------------

#[derive(Clone, serde::Serialize, serde::Deserialize)]
#[serde(default, rename_all = "camelCase")]
pub struct Prefs {
    /// Closing the window hides it to the tray instead of quitting -- quitting
    /// unplugs the controller, which mid-game is never what a stray click on
    /// the X meant.
    pub close_to_tray: bool,
    /// Set after the first launch has applied the first-run defaults.
    pub first_run_done: bool,
}

impl Default for Prefs {
    fn default() -> Self {
        Prefs {
            close_to_tray: true,
            first_run_done: false,
        }
    }
}

pub struct PrefsState(pub Mutex<Prefs>);

impl PrefsState {
    pub fn get(&self) -> Prefs {
        self.0.lock().unwrap_or_else(|p| p.into_inner()).clone()
    }

    fn update(&self, app: &AppHandle, change: impl FnOnce(&mut Prefs)) {
        let snapshot = {
            let mut prefs = self.0.lock().unwrap_or_else(|p| p.into_inner());
            change(&mut prefs);
            prefs.clone()
        };
        save_prefs(app, &snapshot);
    }
}

fn prefs_path(app: &AppHandle) -> Option<PathBuf> {
    app.path()
        .app_config_dir()
        .ok()
        .map(|dir| dir.join("host-prefs.json"))
}

pub fn load_prefs(app: &AppHandle) -> Prefs {
    prefs_path(app)
        .and_then(|path| std::fs::read(path).ok())
        .and_then(|bytes| serde_json::from_slice(&bytes).ok())
        .unwrap_or_default()
}

fn save_prefs(app: &AppHandle, prefs: &Prefs) {
    let Some(path) = prefs_path(app) else { return };
    if let Some(dir) = path.parent() {
        let _ = std::fs::create_dir_all(dir);
    }
    match serde_json::to_vec_pretty(prefs) {
        Ok(bytes) => {
            if let Err(err) = std::fs::write(&path, bytes) {
                eprintln!("could not save preferences to {}: {err}", path.display());
            }
        }
        Err(err) => eprintln!("could not encode preferences: {err}"),
    }
}

/// Applies first-run defaults and refreshes anything that depends on where
/// the exe lives now.
pub fn startup(app: &AppHandle) {
    let prefs = load_prefs(app);
    let first_run = !prefs.first_run_done;
    app.manage(PrefsState(Mutex::new(prefs)));

    // Launch-at-login is what lets "open the app on the phone" just work:
    // the page is served by this host, so the host has to already be
    // running. Defaulted on for real installs only -- a developer's debug
    // build registering itself to start with Windows would be a nuisance.
    if first_run && !cfg!(debug_assertions) {
        if let Err(err) = set_autostart_enabled(true) {
            eprintln!("could not enable launch at login: {err}");
        }
    } else if autostart_enabled() {
        // The entry pins an exe path. Rewriting it each launch means moving
        // the portable exe to another folder doesn't silently break it.
        let _ = set_autostart_enabled(true);
    }

    if let Some(state) = app.try_state::<PrefsState>() {
        state.update(app, |p| p.first_run_done = true);
    }
    sync_status(app);
}

/// Looks for this app's firewall rule in the background and records the
/// answer, so the window can warn before the phone even tries -- a missing
/// rule is the most common reason a scanned QR code "does nothing".
pub fn check_firewall(app: &AppHandle) {
    #[cfg(windows)]
    {
        let app = app.clone();
        std::thread::spawn(move || {
            use std::os::windows::process::CommandExt;
            const CREATE_NO_WINDOW: u32 = 0x0800_0000;
            let found = std::process::Command::new("netsh")
                .args([
                    "advfirewall",
                    "firewall",
                    "show",
                    "rule",
                    "name=Phone Controller Host",
                ])
                .creation_flags(CREATE_NO_WINDOW)
                .output()
                .map(|out| out.status.success())
                .ok();
            // "Block all incoming connections, including those in the list
            // of allowed apps" (a checkbox in Windows Security, or set by an
            // administrator) shows as BlockInboundAlways and beats any rule.
            let blocks_all = std::process::Command::new("netsh")
                .args(["advfirewall", "show", "currentprofile"])
                .creation_flags(CREATE_NO_WINDOW)
                .output()
                .map(|out| String::from_utf8_lossy(&out.stdout).contains("BlockInboundAlways"))
                .unwrap_or(false);
            if let Some(state) = app.try_state::<SharedStatus>() {
                state.update(|s| {
                    s.firewall_rule = found;
                    s.firewall_blocks_all = blocks_all;
                });
            }
            let _ = app.emit("firewall-checked", found);
        });
    }
    #[cfg(not(windows))]
    {
        let _ = app;
    }
}

/// Copies the live desktop settings into the status snapshot.
fn sync_status(app: &AppHandle) {
    let autostart = autostart_enabled();
    let close_to_tray = app
        .try_state::<PrefsState>()
        .map(|p| p.get().close_to_tray)
        .unwrap_or(true);
    if let Some(state) = app.try_state::<SharedStatus>() {
        state.update(|s| {
            s.autostart = autostart;
            s.close_to_tray = close_to_tray;
        });
    }
}

pub fn close_to_tray(app: &AppHandle) -> bool {
    app.try_state::<PrefsState>()
        .map(|p| p.get().close_to_tray)
        .unwrap_or(true)
}

// ---------------------------------------------------------------------------
// Launch at login
// ---------------------------------------------------------------------------

#[cfg(windows)]
pub fn autostart_enabled() -> bool {
    use winreg::enums::HKEY_CURRENT_USER;
    use winreg::RegKey;
    RegKey::predef(HKEY_CURRENT_USER)
        .open_subkey(RUN_KEY)
        .and_then(|key| key.get_value::<String, _>(RUN_VALUE))
        .is_ok()
}

#[cfg(not(windows))]
pub fn autostart_enabled() -> bool {
    false
}

#[cfg(windows)]
fn set_autostart_enabled(enabled: bool) -> Result<(), String> {
    use winreg::enums::HKEY_CURRENT_USER;
    use winreg::RegKey;
    let (key, _) = RegKey::predef(HKEY_CURRENT_USER)
        .create_subkey(RUN_KEY)
        .map_err(|e| format!("could not open the startup list: {e}"))?;
    if enabled {
        let exe = std::env::current_exe().map_err(|e| format!("could not find this app: {e}"))?;
        let command = format!("\"{}\" {BACKGROUND_ARG}", exe.display());
        key.set_value(RUN_VALUE, &command)
            .map_err(|e| format!("could not add to the startup list: {e}"))
    } else {
        match key.delete_value(RUN_VALUE) {
            Ok(()) => Ok(()),
            Err(e) if e.kind() == std::io::ErrorKind::NotFound => Ok(()),
            Err(e) => Err(format!("could not remove from the startup list: {e}")),
        }
    }
}

#[cfg(not(windows))]
fn set_autostart_enabled(_enabled: bool) -> Result<(), String> {
    Err("Launch at login is only available on Windows.".to_string())
}

// ---------------------------------------------------------------------------
// Tray
// ---------------------------------------------------------------------------

struct TrayMenu {
    autostart: CheckMenuItem<Wry>,
}

pub fn setup_tray(app: &AppHandle) -> tauri::Result<()> {
    let show = MenuItem::with_id(app, "show", "Open Controller Host", true, None::<&str>)?;
    let autostart = CheckMenuItem::with_id(
        app,
        "autostart",
        "Start with Windows",
        cfg!(windows),
        autostart_enabled(),
        None::<&str>,
    )?;
    let quit = MenuItem::with_id(
        app,
        "quit",
        "Quit (unplugs the controller)",
        true,
        None::<&str>,
    )?;
    let separator = PredefinedMenuItem::separator(app)?;
    let menu = Menu::with_items(app, &[&show, &autostart, &separator, &quit])?;

    let mut builder = TrayIconBuilder::with_id(TRAY_ID)
        .tooltip("Phone Controller — waiting for a phone")
        .menu(&menu)
        .show_menu_on_left_click(false)
        .on_menu_event(|app, event| match event.id().as_ref() {
            "show" => show_main_window(app),
            "autostart" => {
                let next = !autostart_enabled();
                if let Err(err) = set_autostart_enabled(next) {
                    eprintln!("{err}");
                }
                sync_status(app);
                refresh_tray(app);
                let _ = app.emit("prefs-changed", ());
            }
            "quit" => app.exit(0),
            _ => {}
        })
        .on_tray_icon_event(|tray, event| {
            if let TrayIconEvent::Click {
                button: MouseButton::Left,
                button_state: MouseButtonState::Up,
                ..
            } = event
            {
                show_main_window(tray.app_handle());
            }
        });
    if let Some(icon) = app.default_window_icon() {
        builder = builder.icon(icon.clone());
    }
    builder.build(app)?;
    app.manage(TrayMenu { autostart });
    Ok(())
}

/// Brings the tray tooltip and menu in line with the current state. Cheap,
/// and safe to call before the tray exists.
pub fn refresh_tray(app: &AppHandle) {
    let (clients, pad_ready) = app
        .try_state::<SharedStatus>()
        .map(|s| {
            let snap = s.snapshot();
            (snap.clients, snap.pad_ready)
        })
        .unwrap_or((0, false));
    let tooltip = if !pad_ready && cfg!(windows) {
        "Phone Controller — driver needed (click to fix)".to_string()
    } else {
        match clients {
            0 => "Phone Controller — waiting for a phone".to_string(),
            1 => "Phone Controller — phone connected".to_string(),
            n => format!("Phone Controller — {n} phones connected"),
        }
    };
    if let Some(tray) = app.tray_by_id(TRAY_ID) {
        let _ = tray.set_tooltip(Some(tooltip));
    }
    if let Some(menu) = app.try_state::<TrayMenu>() {
        let _ = menu.autostart.set_checked(autostart_enabled());
    }
}

pub fn show_main_window(app: &AppHandle) {
    if let Some(window) = app.get_webview_window("main") {
        let _ = window.unminimize();
        let _ = window.show();
        let _ = window.set_focus();
    }
}

// ---------------------------------------------------------------------------
// Helpers for launching Windows tools without a console flashing up
// ---------------------------------------------------------------------------

#[cfg(windows)]
pub(crate) fn hidden_powershell(script: &str) -> std::process::Command {
    use std::os::windows::process::CommandExt;
    const CREATE_NO_WINDOW: u32 = 0x0800_0000;
    let mut command = std::process::Command::new("powershell.exe");
    command
        .args([
            "-NoProfile",
            "-NonInteractive",
            "-ExecutionPolicy",
            "Bypass",
            "-Command",
            script,
        ])
        .creation_flags(CREATE_NO_WINDOW);
    command
}

fn open_in_browser(url: &str) -> Result<(), String> {
    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        const CREATE_NO_WINDOW: u32 = 0x0800_0000;
        std::process::Command::new("rundll32.exe")
            .args(["url.dll,FileProtocolHandler", url])
            .creation_flags(CREATE_NO_WINDOW)
            .spawn()
            .map(|_| ())
            .map_err(|e| format!("could not open the browser: {e}"))
    }
    #[cfg(not(windows))]
    {
        let _ = url;
        Err("Opening links is only supported on Windows.".to_string())
    }
}

/// A driver installer shipped next to the exe (the installer build bundles
/// one), so an offline PC can still be set up.
#[cfg(windows)]
fn bundled_driver_installer() -> Option<PathBuf> {
    let dir = std::env::current_exe().ok()?.parent()?.to_path_buf();
    let search = [dir.join("drivers"), dir.clone()];
    search.iter().find_map(|folder| {
        std::fs::read_dir(folder).ok()?.flatten().find_map(|entry| {
            let name = entry.file_name().to_string_lossy().to_lowercase();
            (name.starts_with("vigembus") && name.ends_with(".exe")).then(|| entry.path())
        })
    })
}

// ---------------------------------------------------------------------------
// Commands for the host window
// ---------------------------------------------------------------------------

#[derive(Clone, serde::Serialize)]
#[serde(rename_all = "camelCase")]
#[cfg_attr(not(windows), allow(dead_code))]
struct TaskResult {
    ok: bool,
    message: String,
}

#[tauri::command]
pub fn set_autostart(app: AppHandle, enabled: bool) -> Result<bool, String> {
    let result = set_autostart_enabled(enabled);
    sync_status(&app);
    refresh_tray(&app);
    result.map(|()| autostart_enabled())
}

#[tauri::command]
pub fn set_close_to_tray(app: AppHandle, enabled: bool) {
    if let Some(state) = app.try_state::<PrefsState>() {
        state.update(&app, |p| p.close_to_tray = enabled);
    }
    sync_status(&app);
}

#[tauri::command]
pub fn open_driver_page() -> Result<(), String> {
    open_in_browser(VIGEM_RELEASES_URL)
}

#[tauri::command]
pub fn quit_app(app: AppHandle) {
    app.exit(0);
}

/// Sends a short rumble to every connected phone, to check vibration works
/// without needing a game that rumbles.
#[tauri::command]
pub async fn test_rumble(app: AppHandle, pad: tauri::State<'_, SharedPad>) -> Result<(), String> {
    let pad = pad.inner().clone();
    pad.publish_test_rumble(&app, 255, 160);
    tokio::time::sleep(std::time::Duration::from_millis(450)).await;
    pad.publish_test_rumble(&app, 0, 0);
    Ok(())
}

/// Downloads (or uses the bundled copy of) the ViGEmBus installer and runs
/// it. Windows asks for permission, the installer runs, and the background
/// retry in server.rs plugs the controller in as soon as the driver answers
/// -- the user never has to restart this app.
#[tauri::command]
pub fn install_driver(app: AppHandle) -> Result<(), String> {
    #[cfg(windows)]
    {
        if let Some(state) = app.try_state::<SharedStatus>() {
            let mut already = false;
            state.update(|s| {
                already = s.driver_installing;
                s.driver_installing = true;
            });
            if already {
                return Ok(());
            }
        }
        let _ = app.emit("driver-install-started", ());

        let local = bundled_driver_installer();
        // Paths and URLs travel in environment variables, never spliced into
        // the script text, so no quoting in either can change what runs.
        let script = r#"
$ErrorActionPreference = 'Stop'
try {
  $src = $env:PC_VIGEM_LOCAL
  if (-not $src) {
    [Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12
    $src = Join-Path $env:TEMP 'ViGEmBus_Setup.exe'
    Invoke-WebRequest -UseBasicParsing -Uri $env:PC_VIGEM_URL -OutFile $src
  }
} catch { exit 20 }
try {
  $p = Start-Process -FilePath $src -Verb RunAs -Wait -PassThru
  exit $p.ExitCode
} catch { exit 1223 }
"#;
        let mut command = hidden_powershell(script);
        command.env("PC_VIGEM_URL", VIGEM_INSTALLER_URL);
        command.env(
            "PC_VIGEM_LOCAL",
            local.map(|p| p.display().to_string()).unwrap_or_default(),
        );
        let child = command.spawn().map_err(|e| {
            if let Some(state) = app.try_state::<SharedStatus>() {
                state.update(|s| s.driver_installing = false);
            }
            format!("could not start the installer: {e}")
        })?;

        let app_for_wait = app.clone();
        std::thread::spawn(move || {
            let code = child
                .wait_with_output()
                .ok()
                .and_then(|out| out.status.code())
                .unwrap_or(-1);
            let (ok, message) = match code {
                0 => (true, "Driver installed.".to_string()),
                3010 => (
                    true,
                    "Driver installed. Windows asked for a restart; the controller usually \
                     works without one."
                        .to_string(),
                ),
                20 => {
                    let _ = open_in_browser(VIGEM_RELEASES_URL);
                    (
                        false,
                        "Couldn't download the driver. The download page has been opened in \
                         your browser instead."
                            .to_string(),
                    )
                }
                1223 | 1602 => (
                    false,
                    "The driver install was cancelled. Click Install driver to try again."
                        .to_string(),
                ),
                other => (
                    false,
                    format!("The driver installer exited with code {other}."),
                ),
            };
            if let Some(state) = app_for_wait.try_state::<SharedStatus>() {
                state.update(|s| s.driver_installing = false);
            }
            let _ = app_for_wait.emit("driver-install-finished", TaskResult { ok, message });
        });
        Ok(())
    }
    #[cfg(not(windows))]
    {
        let _ = app;
        Err("The gamepad driver is only needed on Windows.".to_string())
    }
}

/// Replaces whatever firewall rules Windows made for this exe with one that
/// lets phones on the local network in, on every network profile.
///
/// Two traps this fixes that the one-time Windows prompt walks people into:
/// pressing Cancel on that prompt silently creates *block* rules (which beat
/// any allow rule), and a home network marked "Public" -- the Windows
/// default for a newly joined Wi-Fi -- is not covered by the prompt's
/// default "Private" tick.
///
/// Remote addresses are limited to the private ranges home and office
/// networks use, which keeps the internet out. Not `localsubnet`: that only
/// matches the PC's own subnet, and plenty of homes put the phone on a
/// different one (mesh systems, extenders, a PC wired to another router) --
/// the page then never loads on the phone, with nothing to say why.
#[tauri::command]
pub async fn fix_firewall(app: AppHandle) -> Result<String, String> {
    let result = fix_firewall_inner().await;
    if result.is_ok() {
        if let Some(state) = app.try_state::<SharedStatus>() {
            state.update(|s| s.firewall_rule = Some(true));
        }
    }
    result
}

async fn fix_firewall_inner() -> Result<String, String> {
    #[cfg(windows)]
    {
        let exe = std::env::current_exe()
            .map_err(|e| format!("could not find this app: {e}"))?
            .display()
            .to_string();
        let script = r#"
$exe = $env:PC_EXE
$rule = 'Phone Controller Host'
$cmd = "/c netsh advfirewall firewall delete rule name=all program=`"$exe`" & " +
       "netsh advfirewall firewall delete rule name=`"$rule`" & " +
       "netsh advfirewall firewall add rule name=`"$rule`" dir=in action=allow " +
       "program=`"$exe`" enable=yes profile=any remoteip=$env:PC_REMOTE_RANGES & " +
       "netsh advfirewall firewall add rule name=`"$rule`" dir=in action=allow " +
       "protocol=TCP localport=$env:PC_PORTS enable=yes profile=any remoteip=$env:PC_REMOTE_RANGES"
try {
  $p = Start-Process -FilePath 'cmd.exe' -ArgumentList $cmd -Verb RunAs -WindowStyle Hidden -Wait -PassThru
  exit $p.ExitCode
} catch { exit 1223 }
"#;
        let output = tauri::async_runtime::spawn_blocking(move || {
            let mut command = hidden_powershell(script);
            command.env("PC_EXE", exe);
            command.env("PC_REMOTE_RANGES", PRIVATE_RANGES);
            command.env("PC_PORTS", APP_PORTS);
            command.output()
        })
        .await
        .map_err(|e| format!("could not run the firewall fix: {e}"))?
        .map_err(|e| format!("could not run the firewall fix: {e}"))?;
        match output.status.code() {
            Some(0) => Ok("Phones on your network can reach this PC now.".to_string()),
            Some(1223) => {
                Err("Cancelled — Windows needs your permission to change the firewall.".to_string())
            }
            other => Err(format!(
                "The firewall change didn't go through (code {}).",
                other.map_or("unknown".to_string(), |c| c.to_string())
            )),
        }
    }
    #[cfg(not(windows))]
    {
        Err("The firewall fix is only needed on Windows.".to_string())
    }
}
