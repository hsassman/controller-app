use std::sync::atomic::{AtomicUsize, Ordering};
use std::sync::{Arc, Mutex, MutexGuard};
use std::time::{Duration, Instant};

use futures_util::{FutureExt, SinkExt, StreamExt};
use tauri::{AppHandle, Emitter, Manager};
use tokio::net::TcpListener;
use tokio::sync::broadcast;
use tokio_tungstenite::tungstenite::protocol::WebSocketConfig;
use tokio_tungstenite::tungstenite::Message;

const MAX_MESSAGE_BYTES: usize = 4096;

/// How long a client gets to complete the WebSocket handshake.
///
/// Without a deadline, a peer that opens a TCP connection and then says
/// nothing parks a task, a socket handle and a handshake buffer forever.
/// That is not only an attack: LAN scanners, Windows network discovery and
/// endpoint-security agents all connect-and-say-nothing, so a long session
/// slowly leaks handles to entirely routine traffic.
const HANDSHAKE_TIMEOUT: Duration = Duration::from_secs(10);

/// Upper bound on simultaneous connections. Far above what this app needs
/// (a handful of phones) and far below anything that could exhaust handles.
const MAX_CONNECTIONS: usize = 32;

/// Smallest gap between pongs. The real client pings every 2s; nothing on
/// the wire enforces that, and answering an unbounded ping flood costs a
/// syscall each time on the same task that applies input.
const MIN_PONG_INTERVAL: Duration = Duration::from_millis(50);

/// Cap on how many malformed messages one connection may log.
const MAX_MALFORMED_LOGS: u32 = 5;

/// How long a connected client may go completely silent before the host
/// drops it.
///
/// This is the difference between a stuck character and a released one. A
/// phone that sleeps, walks out of Wi-Fi range or is force-quit sends no
/// FIN, so the read below would block until Windows' TCP keepalive notices
/// -- two hours by default. Nothing else would release the pad in that
/// time, and the pad holds the last frame it was given: hold the stick
/// forward, lose Wi-Fi, and the character keeps running until this app is
/// killed. The client heartbeats every 2s, so several missed pings in a row
/// is already a dead link.
const IDLE_TIMEOUT: Duration = Duration::from_secs(6);

use crate::frame::{
    pong_for, rumble_frame, InputFrame, FRAME_TYPE_INPUT, NO_PLAYER, RUMBLE_FRAME_SIZE,
};

/// What the game last asked of the pad: motor speeds plus player slot, as
/// the frame the phone is sent.
pub type FeedbackFrame = [u8; RUMBLE_FRAME_SIZE];

/// The rumble/LED state as shown in the host window.
#[derive(Clone, Copy, serde::Serialize)]
struct FeedbackPayload {
    large: u8,
    small: u8,
    player: Option<u8>,
}

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
    /// Rumble / player-LED changes, fanned out to every connected phone.
    feedback: broadcast::Sender<FeedbackFrame>,
    /// The newest feedback, so a phone that connects mid-game (or one that
    /// fell behind the broadcast) starts from the real state.
    last_feedback: Mutex<FeedbackFrame>,
}

impl PadState {
    fn new(pad: PadSlot) -> SharedPad {
        // Small: a phone that cannot keep up only ever needs the newest
        // state, which `last_feedback` holds regardless.
        let (feedback, _) = broadcast::channel(16);
        Arc::new(PadState {
            pad: Mutex::new(pad),
            active_clients: AtomicUsize::new(0),
            feedback,
            last_feedback: Mutex::new(rumble_frame(0, 0, NO_PLAYER)),
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

    #[cfg_attr(not(windows), allow(dead_code))]
    pub fn is_ready(&self) -> bool {
        self.lock().is_some()
    }

    fn last_feedback(&self) -> FeedbackFrame {
        *self.last_feedback.lock().unwrap_or_else(|p| p.into_inner())
    }

    /// Records new motor/LED state and pushes it to every phone and to the
    /// host window. Callable from any thread.
    pub fn publish_feedback(&self, app: &AppHandle, large: u8, small: u8, player: u8) {
        let frame = rumble_frame(large, small, player);
        *self.last_feedback.lock().unwrap_or_else(|p| p.into_inner()) = frame;
        // An error only means no phone is connected right now.
        let _ = self.feedback.send(frame);
        let player = (player < 4).then_some(player);
        let _ = app.emit(
            "rumble",
            FeedbackPayload {
                large,
                small,
                player,
            },
        );
        if let Some(state) = app.try_state::<crate::status::SharedStatus>() {
            state.update(|s| s.player = player);
        }
    }

    /// Re-sends the current player slot with the motors set as given, for the
    /// host window's "Test rumble" button.
    pub fn publish_test_rumble(&self, app: &AppHandle, large: u8, small: u8) {
        let player = self.last_feedback()[3];
        self.publish_feedback(app, large, small, player);
    }
}

pub type SharedPad = Arc<PadState>;

/// Creates the shared pad state and tries once to plug in the virtual
/// controller. A failure is not final: see `retry_until_ready`.
pub fn create_pad(app_handle: &AppHandle) -> SharedPad {
    let pad = PadState::new(None);
    #[cfg(windows)]
    {
        if let Err(err) = try_plug(&pad, app_handle) {
            eprintln!("FAILED to create virtual gamepad: {err}");
            eprintln!("input will be received and logged, but no controller will be driven.");
            let _ = app_handle.emit("vigembus-missing", ());
            if let Some(state) = app_handle.try_state::<crate::status::SharedStatus>() {
                state.update(|s| s.vigembus_missing = true);
            }
        }
    }
    #[cfg(not(windows))]
    {
        let _ = app_handle;
        eprintln!("virtual gamepad injection is Windows-only for now");
    }
    pad
}

/// Plugs the virtual controller in and starts listening for rumble. On
/// success the window and phone are told the pad is live.
#[cfg(windows)]
pub fn try_plug(
    pad: &SharedPad,
    app_handle: &AppHandle,
) -> Result<(), crate::gamepad::GamepadError> {
    let mut virtual_pad = crate::gamepad::VirtualGamepad::connect()?;
    let slot = virtual_pad
        .user_index()
        .filter(|idx| *idx < 4)
        .map(|idx| idx as u8);
    match slot {
        Some(idx) => println!(
            "virtual Xbox 360 controller plugged in (XInput slot {idx}) \
             -- it stays plugged in until this app exits"
        ),
        None => println!(
            "virtual Xbox 360 controller plugged in (XInput slot unknown) \
             -- it stays plugged in until this app exits"
        ),
    }

    // Weak, not Arc: the feedback thread must not keep the pad state alive
    // on its own, and it has nothing to do once the app is shutting down.
    let weak = Arc::downgrade(pad);
    let feedback_app = app_handle.clone();
    if let Err(err) = virtual_pad.watch_feedback(move |large, small, player| {
        if let Some(pad) = weak.upgrade() {
            pad.publish_feedback(&feedback_app, large, small, player);
        }
    }) {
        // Rumble is a bonus; a pad that cannot report it still plays.
        eprintln!("rumble forwarding unavailable: {err}");
    }

    *pad.lock() = Some(virtual_pad);
    pad.publish_feedback(app_handle, 0, 0, slot.unwrap_or(NO_PLAYER));
    let _ = app_handle.emit("pad-ready", true);
    if let Some(state) = app_handle.try_state::<crate::status::SharedStatus>() {
        state.update(|s| {
            s.pad_ready = true;
            s.vigembus_missing = false;
        });
    }
    crate::desktop::refresh_tray(app_handle);
    Ok(())
}

/// Keeps trying to plug the pad in while the driver is missing, so
/// installing ViGEmBus with this app open is enough -- no restart, and the
/// phone's warning clears by itself.
pub async fn retry_until_ready(pad: SharedPad, app_handle: AppHandle) {
    #[cfg(windows)]
    loop {
        if pad.is_ready() {
            return;
        }
        tokio::time::sleep(Duration::from_secs(3)).await;
        let attempt_pad = Arc::clone(&pad);
        let attempt_app = app_handle.clone();
        let result =
            tokio::task::spawn_blocking(move || try_plug(&attempt_pad, &attempt_app)).await;
        if let Ok(Ok(())) = result {
            println!("ViGEmBus is available now -- controller plugged in");
            return;
        }
    }
    #[cfg(not(windows))]
    {
        let _ = (pad, app_handle);
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

    let connection_slots = Arc::new(tokio::sync::Semaphore::new(MAX_CONNECTIONS));

    loop {
        let (stream, peer_addr) = match listener.accept().await {
            Ok(accepted) => accepted,
            Err(err) => {
                eprintln!("accept failed, continuing: {err}");
                tokio::time::sleep(Duration::from_millis(50)).await;
                continue;
            }
        };
        // Input frames are small (15 bytes) and sent every 10ms; Nagle's
        // algorithm would happily coalesce them with the next one and sit on
        // a frame waiting for an ACK, adding tens of milliseconds of input
        // lag for no bandwidth benefit at this size. Disabling it is a
        // straight latency win.
        if let Err(err) = stream.set_nodelay(true) {
            eprintln!("failed to set TCP_NODELAY for {peer_addr}: {err}");
        }
        // The permit moves into the task, so it is returned on every exit
        // path including a panic -- the same discipline as ClientLease.
        let Ok(permit) = Arc::clone(&connection_slots).try_acquire_owned() else {
            eprintln!("refusing connection from {peer_addr}: {MAX_CONNECTIONS} already open");
            drop(stream);
            continue;
        };
        let conn_pad = Arc::clone(&pad);
        // One handle per connection, cloned like the pad: the connection task
        // owns it for its whole life and uses it to push the live input
        // readout (and connect/disconnect state) to the host window.
        let conn_app = app_handle.clone();
        tokio::spawn(async move {
            let _permit = permit;
            if let Err(err) = handle_connection(stream, peer_addr, conn_pad, conn_app).await {
                eprintln!("connection from {peer_addr} ended: {err}");
            }
        });
    }
}

// tungstenite's Error is 136 bytes. This runs once per connection and
// returns at most once, so boxing it would buy nothing.
#[allow(clippy::result_large_err)]
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
    let ws_stream = match tokio::time::timeout(
        HANDSHAKE_TIMEOUT,
        tokio_tungstenite::accept_async_with_config(stream, Some(config)),
    )
    .await
    {
        Ok(result) => result?,
        Err(_) => {
            eprintln!("handshake from {peer_addr} timed out");
            return Ok(());
        }
    };
    let mut lease = ClientLease::acquire(&pad, peer_addr, app_handle.clone());
    let (mut write, mut read) = ws_stream.split();
    let mut throttle = EmitThrottle::new();
    // Subscribed before the initial send below, so no change can fall in the
    // gap between reading the current state and listening for the next.
    let mut feedback_rx = pad.feedback.subscribe();

    let mut ended_with: Result<(), tokio_tungstenite::tungstenite::Error> = Ok(());
    let mut last_pong_at: Option<Instant> = None;
    let mut malformed_logged: u32 = 0;

    // Tells the phone its player number straight away (and any rumble a
    // game is already holding), rather than waiting for the next change.
    if write
        .send(Message::Binary(pad.last_feedback().to_vec()))
        .await
        .is_err()
    {
        return Ok(());
    }

    let idle = tokio::time::sleep(IDLE_TIMEOUT);
    tokio::pin!(idle);

    loop {
        let msg = tokio::select! {
            // Input first: a rumble burst must never delay a button press.
            biased;
            next = read.next() => {
                idle.as_mut().reset(tokio::time::Instant::now() + IDLE_TIMEOUT);
                match next {
                    Some(Ok(msg)) => msg,
                    Some(Err(err)) => {
                        ended_with = Err(err);
                        break;
                    }
                    // Stream ended cleanly.
                    None => break,
                }
            }
            feedback = feedback_rx.recv() => {
                let frame = match feedback {
                    Ok(frame) => frame,
                    // Fell behind: only the newest state matters anyway.
                    Err(broadcast::error::RecvError::Lagged(_)) => pad.last_feedback(),
                    // Cannot happen while `pad` holds the sender; resubscribe
                    // rather than spin on a closed channel if it ever does.
                    Err(broadcast::error::RecvError::Closed) => {
                        feedback_rx = pad.feedback.subscribe();
                        continue;
                    }
                };
                if let Err(err) = write.send(Message::Binary(frame.to_vec())).await {
                    ended_with = Err(err);
                    break;
                }
                continue;
            }
            _ = &mut idle => {
                eprintln!(
                    "no traffic from {peer_addr} for {}s -- treating the link as dead and \
                     releasing the pad",
                    IDLE_TIMEOUT.as_secs()
                );
                break;
            }
        };
        match msg {
            Message::Binary(bytes) => {
                // Heartbeat first: it is the cheapest check and must not be
                // delayed behind input handling, since its whole purpose is
                // to measure how long a round trip actually takes.
                if let Some(pong) = pong_for(&bytes) {
                    // Rate-limited on purpose. A client flooding pings would
                    // otherwise spend this task's time in send() syscalls
                    // instead of applying input, and a dropped pong is
                    // indistinguishable to the client from a slow link --
                    // which its own timeout logic already handles.
                    let now = Instant::now();
                    if last_pong_at.is_none_or(|at| now.duration_since(at) >= MIN_PONG_INTERVAL) {
                        last_pong_at = Some(now);
                        if let Err(err) = write.send(Message::Binary(pong.to_vec())).await {
                            // The peer is gone; stop rather than spin on a
                            // dead sink. Cleanup still runs via lease Drop.
                            ended_with = Err(err);
                            break;
                        }
                    }
                    continue;
                }

                if let Some(mut frame) = parse_frame(&bytes) {
                    // Apply only the NEWEST input frame that has already
                    // arrived. After a Wi-Fi stall the phone's backlog lands
                    // in one burst; replaying it in order would inject a
                    // second of stale motion -- the stick physically
                    // returned to centre, but the pad would still be acting
                    // on where it used to be. Coalescing keeps the pad on
                    // the player's actual current input.
                    let mut deferred: Option<Message> = None;
                    let mut backlog_pong: Option<[u8; 3]> = None;
                    while deferred.is_none() {
                        match read.next().now_or_never() {
                            Some(Some(Ok(Message::Binary(next)))) => {
                                if let Some(newer) = parse_frame(&next) {
                                    frame = newer;
                                } else if let Some(pong) = pong_for(&next) {
                                    // Answered below, after the pad is up to
                                    // date. Only the newest is kept: a stale
                                    // pong tells the client nothing useful.
                                    backlog_pong = Some(pong);
                                } else {
                                    deferred = Some(Message::Binary(next));
                                }
                            }
                            Some(Some(Ok(other))) => deferred = Some(other),
                            // Nothing buffered, or the stream ended/errored:
                            // let the outer loop deal with it next pass.
                            _ => break,
                        }
                    }
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

                    if let Some(pong) = backlog_pong {
                        let now = Instant::now();
                        if last_pong_at.is_none_or(|at| now.duration_since(at) >= MIN_PONG_INTERVAL)
                        {
                            last_pong_at = Some(now);
                            if let Err(err) = write.send(Message::Binary(pong.to_vec())).await {
                                ended_with = Err(err);
                                break;
                            }
                        }
                    }

                    // A non-input message pulled out of the backlog above.
                    if let Some(Message::Close(_)) = deferred {
                        let _ = write.close().await;
                        break;
                    }
                } else if malformed_logged < MAX_MALFORMED_LOGS {
                    // Capped: a client with a version-skew bug sends these
                    // at 100Hz, and println! takes a process-wide lock that
                    // every other connection contends on.
                    malformed_logged += 1;
                    eprintln!(
                        "ignoring unrecognised {}-byte message from {peer_addr}",
                        bytes.len()
                    );
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
        record_clients(&app_handle, clients);
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
        record_clients(&self.app_handle, remaining);

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

/// Mirrors the connection count into the status snapshot and the tray, so
/// a window opened (or reloaded) mid-session shows the truth instead of
/// "waiting" until the next connect/disconnect event happens to fire.
fn record_clients(app: &AppHandle, clients: usize) {
    if let Some(state) = app.try_state::<crate::status::SharedStatus>() {
        state.update(|s| s.clients = clients);
    }
    crate::desktop::refresh_tray(app);
}

fn parse_frame(bytes: &[u8]) -> Option<InputFrame> {
    match bytes.first() {
        Some(&FRAME_TYPE_INPUT) => InputFrame::parse(bytes).ok(),
        _ => None,
    }
}
