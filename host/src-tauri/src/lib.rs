mod frame;
#[cfg(windows)]
mod gamepad;
mod http;
mod ports;
mod qr;
mod server;
mod stable;
mod status;

use tauri::Manager;

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
            if let Some(window) = app.get_webview_window("main") {
                let _ = window.unminimize();
                let _ = window.show();
                let _ = window.set_focus();
            }
        }))
        .invoke_handler(tauri::generate_handler![status::get_status])
        .setup(|app| {
            let app_handle = app.handle().clone();
            // Startup facts are decided here, before the window's script has
            // loaded, so events announcing them reach nobody. The window
            // reads this snapshot on load instead.
            app.manage(SharedStatus::new());

            let pad = server::create_pad(&app_handle);

            // The LAN address is resolved once and shared: the gamepad
            // server prints it, and the page server needs the same one to
            // tell the phone where to connect back to.
            let lan_ip = match server::local_lan_ip() {
                Some(ip) => {
                    if let Some(state) = app_handle.try_state::<SharedStatus>() {
                        state.update(|s| s.lan_ip_known = true);
                    }
                    ip
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
