//! Updating in place from the project's GitHub releases.
//!
//! Every push to main publishes a release with two fixed file names (see
//! .github/workflows/windows-build.yml): the installer and the portable exe.
//! The app looks at the latest release now and then, and when it is newer
//! than this build the window offers a one-click update:
//!
//! - Installed copy: download the installer and run it in its passive mode
//!   (`/P`: a progress bar, no questions), which closes this app, installs
//!   over it in place and starts the new version (`/R`). `/UPDATE` is what
//!   Tauri's own updater passes; it leaves the user's shortcuts alone.
//! - Portable copy: download the new exe and swap it in for this one once
//!   this process has exited, then start it.
//!
//! Downloads go to a temp folder that is cleared each time, and are checked
//! against the SHA-256 digest GitHub publishes for every release file, so
//! nothing piles up in Downloads and a damaged download is never run.
//!
//! The network work is done by PowerShell, which every supported Windows
//! has: it brings the system's proxy and certificate settings with it and
//! keeps an HTTP client out of this binary.

use serde::Deserialize;
#[cfg(windows)]
use tauri::{Emitter, Manager};
use tauri::AppHandle;

#[cfg(windows)]
use crate::status::SharedStatus;

/// The newest release, as far as the last check knows.
#[derive(Clone, Debug, Deserialize)]
pub struct Release {
    pub tag: String,
    pub setup: Option<Asset>,
    pub portable: Option<Asset>,
}

#[derive(Clone, Debug, Deserialize)]
pub struct Asset {
    pub url: String,
    /// "sha256:<hex>" when GitHub has one; empty for older releases.
    #[serde(default)]
    pub digest: String,
}

/// The release the last check found, kept so "Update now" installs exactly
/// the version the window offered.
#[derive(Default)]
pub struct UpdateState(pub std::sync::Mutex<Option<Release>>);

/// "v1.5.3" or "1.5.3" -> (1, 5, 3). Anything after the patch number (a
/// pre-release suffix) is ignored; anything unparseable is None.
fn parse_version(text: &str) -> Option<(u64, u64, u64)> {
    let text = text.trim().trim_start_matches(['v', 'V']);
    let mut parts = text.split('.');
    let major = parts.next()?.parse().ok()?;
    let minor = parts.next()?.parse().ok()?;
    let patch_text = parts.next()?;
    let digits: String = patch_text.chars().take_while(char::is_ascii_digit).collect();
    let patch = digits.parse().ok()?;
    Some((major, minor, patch))
}

/// Whether release `tag` is newer than version `current`.
pub fn is_newer(tag: &str, current: &str) -> bool {
    match (parse_version(tag), parse_version(current)) {
        (Some(remote), Some(local)) => remote > local,
        _ => false,
    }
}

/// The SHA-256 hex out of GitHub's "sha256:<hex>" digest, if there is one.
fn sha256_of(digest: &str) -> Option<&str> {
    let hex = digest.strip_prefix("sha256:")?;
    (hex.len() == 64 && hex.chars().all(|c| c.is_ascii_hexdigit())).then_some(hex)
}

/// An installed copy sits next to the uninstaller the installer wrote; a
/// portable copy is on its own.
#[cfg(windows)]
fn is_installed_copy() -> bool {
    std::env::current_exe()
        .ok()
        .and_then(|exe| exe.parent().map(|dir| dir.join("uninstall.exe").is_file()))
        .unwrap_or(false)
}

#[cfg(windows)]
const RELEASE_API: &str = "https://api.github.com/repos/hsassman/controller-app/releases/latest";

#[cfg(windows)]
const FETCH_SCRIPT: &str = r#"
$ErrorActionPreference = 'Stop'
$ProgressPreference = 'SilentlyContinue'
[Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12
$headers = @{ 'User-Agent' = 'PhoneController'; 'Accept' = 'application/vnd.github+json' }
$r = Invoke-RestMethod -Uri $env:PC_RELEASE_API -Headers $headers -TimeoutSec 20 -UseBasicParsing
$found = @{}
foreach ($a in $r.assets) { $found[$a.name] = @{ url = $a.browser_download_url; digest = "$($a.digest)" } }
@{ tag = $r.tag_name; setup = $found['PhoneController-Setup.exe']; portable = $found['PhoneController.exe'] } |
  ConvertTo-Json -Compress -Depth 4
"#;

#[cfg(windows)]
const DOWNLOAD_SCRIPT: &str = r#"
$ErrorActionPreference = 'Stop'
$ProgressPreference = 'SilentlyContinue'
[Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12
$dir = $env:PC_DIR
New-Item -ItemType Directory -Force -Path $dir | Out-Null
Get-ChildItem -Path $dir -File | Remove-Item -Force -ErrorAction SilentlyContinue
$out = Join-Path $dir $env:PC_FILE
Invoke-WebRequest -Uri $env:PC_URL -OutFile $out -UseBasicParsing -TimeoutSec 600 -Headers @{ 'User-Agent' = 'PhoneController' }
if ($env:PC_SHA256) {
  $hash = (Get-FileHash -Path $out -Algorithm SHA256).Hash
  if ($hash -ne $env:PC_SHA256) { Remove-Item $out -Force; exit 3 }
}
"#;

/// Runs the installer elevated (it installs for all users). ShellExecute
/// with "runas" is the only way to start an exe that requires admin, and
/// throws when the user says no at the Windows prompt.
#[cfg(windows)]
const RUN_SETUP_SCRIPT: &str = r#"
try {
  Start-Process -FilePath $env:PC_SETUP -ArgumentList '/P', '/R', '/UPDATE' -Verb RunAs
  exit 0
} catch { exit 1223 }
"#;

/// Waits for this app to exit, puts the new exe in its place and starts it.
/// Runs on after this process is gone.
#[cfg(windows)]
const SWAP_PORTABLE_SCRIPT: &str = r#"
$ErrorActionPreference = 'Stop'
try { Wait-Process -Id ([int]$env:PC_PID) -Timeout 30 -ErrorAction SilentlyContinue } catch {}
Start-Sleep -Milliseconds 300
for ($i = 0; $i -lt 20; $i++) {
  try { Copy-Item -LiteralPath $env:PC_NEW -Destination $env:PC_EXE -Force; break }
  catch { Start-Sleep -Milliseconds 500 }
}
Remove-Item -LiteralPath $env:PC_NEW -Force -ErrorAction SilentlyContinue
Start-Process -FilePath $env:PC_EXE
"#;

/// Asks GitHub for the latest release and records it when it is newer.
/// Returns the newer version's tag, or None when this build is current.
#[cfg(windows)]
async fn check(app: &AppHandle) -> Result<Option<String>, String> {
    let output = tauri::async_runtime::spawn_blocking(|| {
        let mut command = crate::desktop::hidden_powershell(FETCH_SCRIPT);
        command.env("PC_RELEASE_API", RELEASE_API);
        command.output()
    })
    .await
    .map_err(|e| format!("Couldn't check for updates: {e}"))?
    .map_err(|e| format!("Couldn't check for updates: {e}"))?;
    if !output.status.success() {
        return Err("Couldn't reach GitHub to check for updates. Check this PC's internet connection.".into());
    }
    let text = String::from_utf8_lossy(&output.stdout);
    let release: Release = serde_json::from_str(text.trim())
        .map_err(|_| "GitHub's answer didn't make sense; try again later.".to_string())?;

    let newer = is_newer(&release.tag, env!("CARGO_PKG_VERSION"));
    let version = newer.then(|| release.tag.trim_start_matches(['v', 'V']).to_string());
    if let Some(state) = app.try_state::<UpdateState>() {
        *state.0.lock().unwrap_or_else(|e| e.into_inner()) = newer.then(|| release.clone());
    }
    if let Some(state) = app.try_state::<SharedStatus>() {
        state.update(|s| s.update_version = version.clone());
    }
    let _ = app.emit("update-available", version.clone());
    Ok(version)
}

/// Checks a little after startup (the window and the phone page come
/// first), then every few hours for a host that is left running in the tray.
pub fn start_background_checks(app: &AppHandle) {
    #[cfg(windows)]
    {
        let app = app.clone();
        tauri::async_runtime::spawn(async move {
            tokio::time::sleep(std::time::Duration::from_secs(8)).await;
            loop {
                // Offline or rate-limited: say nothing, try again later.
                let _ = check(&app).await;
                tokio::time::sleep(std::time::Duration::from_secs(6 * 60 * 60)).await;
            }
        });
    }
    #[cfg(not(windows))]
    {
        let _ = app;
    }
}

/// "Check for updates" in the window. Ok(None) means up to date.
#[tauri::command]
pub async fn check_for_update(app: AppHandle) -> Result<Option<String>, String> {
    #[cfg(windows)]
    {
        check(&app).await
    }
    #[cfg(not(windows))]
    {
        let _ = app;
        Err("Updates are only available on Windows.".to_string())
    }
}

/// "Update now": downloads the new version and hands over to it. On
/// success this app closes moments later, and the new one starts by itself.
#[tauri::command]
pub async fn install_update(app: AppHandle) -> Result<String, String> {
    #[cfg(windows)]
    {
        let cached = app
            .try_state::<UpdateState>()
            .and_then(|state| state.0.lock().unwrap_or_else(|e| e.into_inner()).clone());
        let release = match cached {
            Some(release) => release,
            None => {
                if check(&app).await?.is_none() {
                    return Ok("You already have the latest version.".to_string());
                }
                app.try_state::<UpdateState>()
                    .and_then(|state| state.0.lock().unwrap_or_else(|e| e.into_inner()).clone())
                    .ok_or("Couldn't find the update; try again.")?
            }
        };

        let installed = is_installed_copy();
        let (asset, file_name) = if installed {
            (release.setup.clone(), "PhoneController-Setup.exe")
        } else {
            (release.portable.clone(), "PhoneController.exe")
        };
        let asset = asset.ok_or("This release is missing its download; try again later.")?;
        let sha = sha256_of(&asset.digest).unwrap_or("").to_string();

        let _ = app.emit("update-progress", "Downloading…");
        // Decided here and handed to the script, so both sides agree on it
        // (and a user name with accents survives the trip).
        let dir = std::env::temp_dir().join("PhoneController-Update");
        let downloaded = dir.join(file_name);
        let url = asset.url.clone();
        let output = tauri::async_runtime::spawn_blocking(move || {
            let mut command = crate::desktop::hidden_powershell(DOWNLOAD_SCRIPT);
            command
                .env("PC_URL", url)
                .env("PC_DIR", dir)
                .env("PC_FILE", file_name)
                .env("PC_SHA256", sha);
            command.output()
        })
        .await
        .map_err(|e| format!("The download failed: {e}"))?
        .map_err(|e| format!("The download failed: {e}"))?;
        match output.status.code() {
            Some(0) => {}
            Some(3) => return Err("The download was damaged, so it wasn't installed. Try again.".to_string()),
            _ => return Err("The download failed. Check this PC's internet connection and try again.".to_string()),
        }
        if !downloaded.is_file() {
            return Err("The download failed; try again.".to_string());
        }

        if installed {
            let _ = app.emit("update-progress", "Installing — approve the Windows prompt…");
            let setup = downloaded.clone();
            let status = tauri::async_runtime::spawn_blocking(move || {
                let mut command = crate::desktop::hidden_powershell(RUN_SETUP_SCRIPT);
                command.env("PC_SETUP", setup);
                command.status()
            })
            .await
            .map_err(|e| format!("Couldn't start the installer: {e}"))?
            .map_err(|e| format!("Couldn't start the installer: {e}"))?;
            if status.code() != Some(0) {
                return Err("Cancelled — Windows needs your permission to install the update.".to_string());
            }
        } else {
            let exe = std::env::current_exe()
                .map_err(|e| format!("Couldn't find this app: {e}"))?
                .display()
                .to_string();
            let mut command = crate::desktop::hidden_powershell(SWAP_PORTABLE_SCRIPT);
            command
                .env("PC_PID", std::process::id().to_string())
                .env("PC_NEW", &downloaded)
                .env("PC_EXE", exe);
            // Spawned, not waited on: it finishes the job after we exit.
            command
                .spawn()
                .map_err(|e| format!("Couldn't start the update: {e}"))?;
        }

        // Give the window a moment to show the result, then make way. The
        // installer would close this app anyway; leaving cleanly unplugs
        // the virtual pad first.
        let handle = app.clone();
        tauri::async_runtime::spawn(async move {
            tokio::time::sleep(std::time::Duration::from_millis(1200)).await;
            handle.exit(0);
        });
        Ok(format!(
            "Updating to v{} — Phone Controller will restart by itself.",
            release.tag.trim_start_matches(['v', 'V'])
        ))
    }
    #[cfg(not(windows))]
    {
        let _ = app;
        Err("Updates are only available on Windows.".to_string())
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn newer_versions_are_spotted() {
        assert!(is_newer("v1.6.0", "1.5.3"));
        assert!(is_newer("v1.5.10", "1.5.9"));
        assert!(is_newer("2.0.0", "1.99.99"));
    }

    #[test]
    fn same_or_older_is_not_an_update() {
        assert!(!is_newer("v1.5.3", "1.5.3"));
        assert!(!is_newer("v1.4.0", "1.5.3"));
        assert!(!is_newer("garbage", "1.5.3"));
        assert!(!is_newer("v1.6", "1.5.3"));
    }

    #[test]
    fn digests_are_read_only_when_well_formed() {
        let hex = "a".repeat(64);
        assert_eq!(sha256_of(&format!("sha256:{hex}")), Some(hex.as_str()));
        assert_eq!(sha256_of(""), None);
        assert_eq!(sha256_of("sha256:xyz"), None);
        assert_eq!(sha256_of("md5:abc"), None);
    }

    #[test]
    fn release_json_from_the_fetch_script_parses() {
        let json = r#"{"tag":"v1.6.0","setup":{"url":"https://example.invalid/s.exe","digest":"sha256:00"},"portable":null}"#;
        let release: Release = serde_json::from_str(json).unwrap();
        assert_eq!(release.tag, "v1.6.0");
        assert!(release.setup.is_some());
        assert!(release.portable.is_none());
    }
}
