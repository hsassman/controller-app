mod desktop;
mod frame;
#[cfg(windows)]
mod gamepad;
mod http;
mod net;
mod ports;
mod qr;
mod server;
mod stable;
mod status;

use tauri::{Manager, WindowEvent};

use status::{report_error, SharedStatus};

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        // Must be the first plugin registered: it needs to intercept a
        // second launch before anything else in this process (including the
        // port binds below) has a chance to run. See the dependency comment
        // in Cargo.toml for why a second instance is a real, reproducible
        // bug and not just wasted memory -- it silently grabs different
        // fallback ports and plugs in a second virtual controller, leaving
        // the phone with two different addresses and no way to tell which
        // one the game is actually listening to.
        .plugin(tauri_plugin_single_instance::init(|app, _argv, _cwd| {
            // Reaching here means a *second* launch was attempted while this
            // (the first, real) instance is already running; surface the
            // window that's already doing the job instead of leaving the
            // user staring at nothing, which is what "do nothing" would
            // look like.
            desktop::show_main_window(app);
        }))
        .invoke_handler(tauri::generate_handler![
            status::get_status,
            desktop::set_autostart,
            desktop::set_close_to_tray,
            desktop::install_driver,
            desktop::open_driver_page,
            desktop::fix_firewall,
            desktop::test_rumble,
            desktop::quit_app,
        ])
        // Closing the window keeps the host running in the tray: quitting
        // unplugs the controller and takes the phone page down with it, so
        // it is a deliberate menu choice rather than a stray click on the X.
        .on_window_event(|window, event| {
            if let WindowEvent::CloseRequested { api, .. } = event {
                if desktop::close_to_tray(window.app_handle()) {
                    api.prevent_close();
                    let _ = window.hide();
                }
            }
        })
        .setup(|app| {
            let app_handle = app.handle().clone();
            // Startup facts are decided here, before the window's script has
            // loaded, so events announcing them reach nobody. The window
            // reads this snapshot on load instead.
            let status = SharedStatus::new();
            status.update(|s| s.version = env!("CARGO_PKG_VERSION").to_string());
            app.manage(status);
            desktop::startup(&app_handle);

            if let Err(err) = desktop::setup_tray(&app_handle) {
                // Without a tray, hiding the window would strand the app
                // with no way back, so closing quits instead.
                eprintln!("tray icon unavailable: {err}");
                if let Some(prefs) = app_handle.try_state::<desktop::PrefsState>() {
                    if let Ok(mut p) = prefs.0.lock() {
                        p.close_to_tray = false;
                    }
                }
            }

            // Launched at login: stay in the tray. Any other launch shows
            // the window -- it starts hidden only so it never flashes up
            // half-drawn.
            let background = std::env::args().any(|a| a == desktop::BACKGROUND_ARG);
            if !background {
                desktop::show_main_window(&app_handle);
            }

            let pad = server::create_pad(&app_handle);
            app.manage(pad.clone());
            tauri::async_runtime::spawn(server::retry_until_ready(pad.clone(), app_handle.clone()));
            desktop::refresh_tray(&app_handle);

            // Every address this PC answers on, best first (see net.rs). The
            // first goes in the QR code; the rest are offered in the window
            // for when the first turns out to be a VPN or virtual adapter.
            let addresses = net::lan_addresses();
            let lan_ip = match addresses.first() {
                Some(first) => {
                    if let Some(state) = app_handle.try_state::<SharedStatus>() {
                        state.update(|s| s.lan_ip_known = true);
                    }
                    first.ip.clone()
                }
                None => {
                    report_error(
                        &app_handle,
                        "Could not work out this PC's address on the network. \
                         Check that it is connected to Wi-Fi or Ethernet."
                            .to_string(),
                    );
                    // Bind and run anyway: the servers listen on 0.0.0.0 and
                    // are reachable, we simply cannot advertise where.
                    "127.0.0.1".to_string()
                }
            };
            desktop::check_firewall(&app_handle);

            let ws_bound = ports::bind_from(server::PORT);
            let http_bound = ports::bind_from(http::HTTP_PORT);

            // The two servers are independent. They used to be nested, so a
            // WebSocket bind failure took the phone page down with it even
            // though its own listener had bound fine.
            let ws_port = match ws_bound {
                Ok((listener, port)) => {
                    let ws_handle = app_handle.clone();
                    let ws_ip = lan_ip.clone();
                    tauri::async_runtime::spawn(async move {
                        if let Err(err) =
                            server::run_server(ws_handle.clone(), pad, listener, port, ws_ip).await
                        {
                            report_error(&ws_handle, format!("Controller server stopped: {err}"));
                        }
                    });
                    Some(port)
                }
                Err(err) => {
                    report_error(
                        &app_handle,
                        format!("Could not start the controller server: {err}"),
                    );
                    None
                }
            };

            match http_bound {
                Ok((http_listener, http_port)) => {
                    let http_handle = app_handle.clone();
                    let http_ip = lan_ip.clone();
                    // Without a gamepad port there is nothing to tell the
                    // phone to connect to, so the page would be a dead end.
                    if let Some(port) = ws_port {
                        tauri::async_runtime::spawn(async move {
                            if let Err(err) = http::run_http_server(
                                http_handle.clone(),
                                http_ip,
                                addresses,
                                http_listener,
                                http_port,
                                port,
                            )
                            .await
                            {
                                report_error(
                                    &http_handle,
                                    format!("Phone page server stopped: {err}"),
                                );
                            }
                        });
                    }
                }
                Err(err) => report_error(
                    &app_handle,
                    format!("Could not serve the phone page: {err}"),
                ),
            }
            Ok(())
        })
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
