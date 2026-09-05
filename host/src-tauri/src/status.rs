use std::sync::{Mutex, MutexGuard};

use tauri::{AppHandle, Emitter, Manager};

#[derive(Clone, Default, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Status {
    /// A virtual pad was created successfully.
    pub pad_ready: bool,
    /// Pad creation failed in a way that looks like a missing driver.
    pub vigembus_missing: bool,
    /// `ip:port` for the gamepad WebSocket, if it bound.
    pub ws_address: Option<String>,
    /// Full URL of the phone page, if it is being served.
    pub web_url: Option<String>,
    /// `web_url` rendered as an `<svg>` QR code, so the address can be
    /// scanned instead of typed. `None` when there is no URL to encode, or
    /// if encoding failed -- the window lays out without it either way.
    pub qr_svg: Option<String>,
    /// `http://<hostname>.local:<port>`, when that name was verified to
    /// reach this machine. Unlike `web_url` it survives a new DHCP lease,
    /// so it is the address a phone's Home Screen shortcut should pin.
    pub stable_url: Option<String>,
    /// False when the page server had to fall back off its usual port
    /// because something else held it. Worth saying, because a shortcut
    /// saved earlier pins the old port and would no longer open.
    pub canonical_port: bool,
    /// False when this PC's LAN address could not be determined, in which
    /// case any address shown would be a loopback guess and useless to a
    /// phone -- the window says so rather than showing it.
    pub lan_ip_known: bool,
    /// Fatal-ish startup problems, in the order they happened. Shown
    /// verbatim in the window because there is no console in a release
    /// build to print them to.
    pub errors: Vec<String>,
}

pub struct SharedStatus(Mutex<Status>);

impl SharedStatus {
    pub fn new() -> Self {
        SharedStatus(Mutex::new(Status::default()))
    }

    fn lock(&self) -> MutexGuard<'_, Status> {
        self.0.lock().unwrap_or_else(|poisoned| poisoned.into_inner())
    }

    pub fn snapshot(&self) -> Status {
        self.lock().clone()
    }

    pub fn update(&self, change: impl FnOnce(&mut Status)) {
        change(&mut self.lock());
    }
}

/// Records a startup error and pushes it to the window if it is listening.
pub fn report_error(app: &AppHandle, message: String) {
    eprintln!("{message}");
    if let Some(status) = app.try_state::<SharedStatus>() {
        status.update(|s| s.errors.push(message.clone()));
    }
    let _ = app.emit("startup-error", message);
}

#[tauri::command]
pub fn get_status(status: tauri::State<'_, SharedStatus>) -> Status {
    status.snapshot()
}
