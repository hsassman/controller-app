use std::net::UdpSocket;
use std::sync::atomic::{AtomicUsize, Ordering};
use std::sync::{Arc, Mutex, MutexGuard};
use std::time::{Duration, Instant};

use futures_util::{SinkExt, StreamExt};
use tauri::{AppHandle, Emitter, Manager};
use tokio::net::TcpListener;
use tokio_tungstenite::tungstenite::protocol::WebSocketConfig;
use tokio_tungstenite::tungstenite::Message;

const MAX_MESSAGE_BYTES: usize = 4096;

use crate::frame::{pong_for, InputFrame, FRAME_TYPE_INPUT};

/// Public so the HTTP server can report it to the phone in
/// /host-info.json, which is what lets the page connect itself.
pub const PORT: u16 = 8787;

const EMIT_INTERVAL: Duration = Duration::from_millis(40);

/// The applied input state as shown by the host window's live monitor.
/// Mirrors `InputFrame` minus the sequence number; the frontend decodes
#[derive(Clone, Copy, PartialEq, Eq, serde::Serialize)]
pub struct InputStatePayload {
    pub buttons: u16,
    pub left_stick_x: i16,
    pub left_stick_y: i16,
    pub right_stick_x: i16,
    pub right_stick_y: i16,
    pub left_trigger: u8,
    pub right_trigger: u8,
}

impl From<&InputFrame> for InputStatePayload {
    fn from(frame: &InputFrame) -> Self {
        InputStatePayload {
            buttons: frame.buttons,
            left_stick_x: frame.left_stick_x,
            left_stick_y: frame.left_stick_y,
            right_stick_x: frame.right_stick_x,
            right_stick_y: frame.right_stick_y,
            left_trigger: frame.left_trigger,
            right_trigger: frame.right_trigger,
        }
    }
}

/// How many clients are connected, for the window's connection indicator.
#[derive(Clone, serde::Serialize)]
struct ConnectionPayload {
    connected: bool,
    clients: usize,
    peer: String,
}

struct EmitThrottle {
    last_emitted: Option<InputStatePayload>,
    last_emit_at: Instant,
}

impl EmitThrottle {
    fn new() -> Self {
        EmitThrottle {
            last_emitted: None,
            // Far enough in the past that the very first frame emits.
            last_emit_at: Instant::now() - EMIT_INTERVAL,
        }
    }

    /// Returns true (and records the emit) when `state` should be sent.
    fn should_emit(&mut self, state: InputStatePayload) -> bool {
        let buttons_changed = match self.last_emitted {
            Some(last) => last.buttons != state.buttons,
            None => true,
        };
        let unchanged = self.last_emitted == Some(state);
        if buttons_changed || (!unchanged && self.last_emit_at.elapsed() >= EMIT_INTERVAL) {
            self.last_emitted = Some(state);
            self.last_emit_at = Instant::now();
            return true;
        }
        false
    }
}

/// The one virtual pad. `None` when ViGEmBus isn't installed/available --
/// in that case frames are still parsed and logged so the rest of the app
/// stays diagnosable, they just don't drive a device.
#[cfg(windows)]
type PadSlot = Option<crate::gamepad::VirtualGamepad>;
#[cfg(not(windows))]
type PadSlot = Option<()>;

/// The single virtual pad plus the count of connections currently driving
/// it, shared by every connection.
pub struct PadState {
    pad: Mutex<PadSlot>,
    /// Live client connections. Used to decide who owns the pad's state:
    /// the pad is only reset to neutral when the *last* client goes away.
    active_clients: AtomicUsize,
}

impl PadState {
    fn new(pad: PadSlot) -> SharedPad {
        Arc::new(PadState {
            pad: Mutex::new(pad),
            active_clients: AtomicUsize::new(0),
        })
    }

    #[cfg_attr(not(windows), allow(dead_code))]
    fn lock(&self) -> MutexGuard<'_, PadSlot> {
        self.pad.lock().unwrap_or_else(|poisoned| {
            eprintln!(
                "virtual pad mutex was poisoned by a panic -- recovering the guard \
                 and continuing (the next frame fully redefines the pad's state)"
            );
            poisoned.into_inner()
        })
    }
}

pub type SharedPad = Arc<PadState>;

pub fn create_pad(app_handle: &AppHandle) -> SharedPad {
    #[cfg(windows)]
    {
        match crate::gamepad::VirtualGamepad::connect() {
            Ok(mut pad) => {
                match pad.user_index() {
                    Some(idx) => println!(
                        "virtual Xbox 360 controller plugged in (XInput slot {idx}) \
                         -- it stays plugged in until this app exits"
                    ),
                    None => println!(
                        "virtual Xbox 360 controller plugged in (XInput slot unknown) \
                         -- it stays plugged in until this app exits"
                    ),
                }
                let _ = app_handle.emit("pad-ready", true);
                if let Some(state) = app_handle.try_state::<crate::status::SharedStatus>() {
                    state.update(|s| s.pad_ready = true);
                }
                PadState::new(Some(pad))
            }
            Err(err) => {
                eprintln!("FAILED to create virtual gamepad: {err}");
                eprintln!("input will be received and logged, but no controller will be driven.");
                let _ = app_handle.emit("vigembus-missing", ());
                if let Some(state) = app_handle.try_state::<crate::status::SharedStatus>() {
                    state.update(|s| s.vigembus_missing = true);
                }
                PadState::new(None)
            }
        }
    }
    #[cfg(not(windows))]
    {
        let _ = app_handle;
        eprintln!("virtual gamepad injection is Windows-only for now (docs/08-ROADMAP.md Phase 5)");
        PadState::new(None)
    }
}

pub async fn run_server(
    app_handle: AppHandle,
    pad: SharedPad,
    listener: std::net::TcpListener,
    port: u16,
    lan_ip: String,
) -> std::io::Result<()> {
    let listener = TcpListener::from_std(listener)?;
    let address = format!("{lan_ip}:{port}");

    println!("Controller host listening on {address}");
    if let Some(state) = app_handle.try_state::<crate::status::SharedStatus>() {
        state.update(|s| s.ws_address = Some(address.clone()));
    }
    let _ = app_handle.emit("server-address", address);

    loop {
        let (stream, peer_addr) = match listener.accept().await {
            Ok(accepted) => accepted,
            Err(err) => {
                eprintln!("accept failed, continuing: {err}");
                tokio::time::sleep(Duration::from_millis(50)).await;
                continue;
            }
        };
        let conn_pad = Arc::clone(&pad);
        // One handle per connection, cloned like the pad: the connection task
        // owns it for its whole life and uses it to push the live input
        // readout (and connect/disconnect state) to the host window.
        let conn_app = app_handle.clone();
        tokio::spawn(async move {
            if let Err(err) = handle_connection(stream, peer_addr, conn_pad, conn_app).await {
                eprintln!("connection from {peer_addr} ended: {err}");
            }
        });
    }
}

async fn handle_connection(
    stream: tokio::net::TcpStream,
    peer_addr: std::net::SocketAddr,
    pad: SharedPad,
    app_handle: AppHandle,
) -> Result<(), tokio_tungstenite::tungstenite::Error> {
    let config = WebSocketConfig {
        max_message_size: Some(MAX_MESSAGE_BYTES),
        max_frame_size: Some(MAX_MESSAGE_BYTES),
        ..Default::default()
    };
    let ws_stream = tokio_tungstenite::accept_async_with_config(stream, Some(config)).await?;
    let mut lease = ClientLease::acquire(&pad, peer_addr, app_handle.clone());
    let (mut write, mut read) = ws_stream.split();
    let mut throttle = EmitThrottle::new();

    let mut ended_with: Result<(), tokio_tungstenite::tungstenite::Error> = Ok(());

    while let Some(msg) = read.next().await {
        let msg = match msg {
            Ok(msg) => msg,
            Err(err) => {
                ended_with = Err(err);
                break;
            }
        };
        match msg {
            Message::Binary(bytes) => {
                // Heartbeat first: it is the cheapest check and must not be
                // delayed behind input handling, since its whole purpose is
                // to measure how long a round trip actually takes.
                if let Some(pong) = pong_for(&bytes) {
                    if let Err(err) = write.send(Message::Binary(pong.to_vec())).await {
                        // The peer is gone; stop rather than spin on a dead
                        // sink. Cleanup still runs via the lease's Drop.
                        ended_with = Err(err);
                        break;
                    }
                    continue;
                }

                if let Some(frame) = parse_frame(&bytes) {
                    // Lock, apply, unlock -- the guard is never held across
                    // an await, which keeps this future Send for tokio::spawn.
                    #[cfg(windows)]
                    {
                        let mut guard = pad.lock();
                        if let Some(pad) = guard.as_mut() {
                            match pad.apply(&frame) {
                                Ok(()) => {
                                    if lease.frames_applied == 0 {
                                        println!("first input frame applied to virtual pad");
                                    }
                                    lease.frames_applied += 1;
                                }
                                Err(err) => {
                                    eprintln!("failed to update virtual pad: {err}");
                                }
                            }
                        } else if lease.frames_applied == 0 {
                            eprintln!(
                                "receiving input from {peer_addr} but NO virtual pad exists \
                                 -- see the startup error above"
                            );
                            lease.frames_applied += 1;
                        }
                    }
                    #[cfg(not(windows))]
                    {
                        let _ = (&pad, &frame);
                        lease.frames_applied += 1;
                    }

                    let state = InputStatePayload::from(&frame);
                    if throttle.should_emit(state) {
                        let _ = app_handle.emit("input-state", state);
                    }
                }
            }
            Message::Close(_) => {
                let _ = write.close().await;
                break;
            }
            _ => {}
        }
    }

    // `lease` drops here (or on any early exit/panic), which releases the pad
    // if this was the last client -- see ClientLease::drop.
    ended_with
}

/// One live client's claim on the shared pad. Exists for its Drop impl:
/// whatever ends the connection -- clean close, abrupt TCP drop, or a panic
/// in the connection task -- the client is uncounted and the pad released.
struct ClientLease {
    pad: SharedPad,
    peer_addr: std::net::SocketAddr,
    frames_applied: u64,
    app_handle: AppHandle,
}

impl ClientLease {
    fn acquire(pad: &SharedPad, peer_addr: std::net::SocketAddr, app_handle: AppHandle) -> Self {
        let clients = pad.active_clients.fetch_add(1, Ordering::SeqCst) + 1;
        println!("client connected: {peer_addr} ({clients} connected)");
        let _ = app_handle.emit(
            "client-state",
            ConnectionPayload {
                connected: true,
                clients,
                peer: peer_addr.to_string(),
            },
        );
        ClientLease {
            pad: Arc::clone(pad),
            peer_addr,
            frames_applied: 0,
            app_handle,
        }
    }
}

impl Drop for ClientLease {
    fn drop(&mut self) {
        let remaining = self.pad.active_clients.fetch_sub(1, Ordering::SeqCst) - 1;
        if remaining == 0 {
            #[cfg(windows)]
            {
                let mut guard = self.pad.lock();
                if let Some(pad) = guard.as_mut() {
                    if let Err(err) = pad.reset() {
                        eprintln!("failed to reset virtual pad after disconnect: {err}");
                    }
                }
            }
        }

        println!(
            "client disconnected: {} ({} frames applied, {remaining} still connected)",
            self.peer_addr, self.frames_applied
        );

        let _ = self.app_handle.emit(
            "client-state",
            ConnectionPayload {
                connected: remaining > 0,
                clients: remaining,
                peer: self.peer_addr.to_string(),
            },
        );
        // The pad was just reset to neutral, so the monitor must show neutral
        // too -- otherwise the last frame before the drop stays lit forever.
        if remaining == 0 {
            let _ = self.app_handle.emit(
                "input-state",
                InputStatePayload {
                    buttons: 0,
                    left_stick_x: 0,
                    left_stick_y: 0,
                    right_stick_x: 0,
                    right_stick_y: 0,
                    left_trigger: 0,
                    right_trigger: 0,
                },
            );
        }
    }
}

/// Caps how many bytes of an unexpected/malformed payload get formatted
/// into a log line -- a buggy or hostile client shouldn't be able to blow
/// up log size (or the cost of formatting) just by sending a large message.
fn truncated(bytes: &[u8]) -> &[u8] {
    &bytes[..bytes.len().min(32)]
}

fn parse_frame(bytes: &[u8]) -> Option<InputFrame> {
    match bytes.first() {
        Some(&FRAME_TYPE_INPUT) => match InputFrame::parse(bytes) {
            Ok(frame) => Some(frame),
            Err(_) => {
                println!(
                    "malformed INPUT frame ({} bytes): {:?}",
                    bytes.len(),
                    truncated(bytes)
                );
                None
            }
        },
        _ => {
            println!("received {} bytes: {:?}", bytes.len(), truncated(bytes));
            None
        }
    }
}

pub fn local_lan_ip() -> Option<String> {
    UdpSocket::bind("0.0.0.0:0")
        .and_then(|socket| {
            socket.connect("8.8.8.8:80")?;
            socket.local_addr()
        })
        .map(|addr| addr.ip().to_string())
        .ok()
}
