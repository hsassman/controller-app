use std::path::{Path, PathBuf};
use std::sync::Arc;
use std::time::Duration;

use tauri::{AppHandle, Emitter, Manager};
use tokio::io::{AsyncReadExt, AsyncWriteExt};
use tokio::net::{TcpListener, TcpStream};

/// Separate from the WebSocket port so neither has to sniff the other's
/// protocol off the wire. 8788 sits next to the 8787 the pad uses.
pub const HTTP_PORT: u16 = 8788;

/// Cap on the request head we will read. A request that never sends
/// `\r\n\r\n` would otherwise let one peer hold a task and a growing buffer
/// open indefinitely.
const MAX_HEAD_BYTES: usize = 8 * 1024;

/// Cap on a served file. The client bundle is ~100 KB; anything far past
/// that in the web directory is not something this server should be
/// streaming into memory in one piece.
const MAX_FILE_BYTES: u64 = 16 * 1024 * 1024;

/// How long one request gets to send its head. Without this a peer writing
/// a byte every 30 seconds holds a task forever and never trips the size
/// cap -- 8 KB at that rate would take 68 hours.
const HEAD_TIMEOUT: Duration = Duration::from_secs(10);

/// Upper bound on simultaneous HTTP connections.
const MAX_CONNECTIONS: usize = 64;

/// The phone page as compiled into this exe. Always present in a release
/// build, which is what makes the portable download a single file; empty
/// only when the host was built before the client ever was.
static EMBEDDED_WEB: include_dir::Dir<'static> =
    include_dir::include_dir!("$CARGO_MANIFEST_DIR/../../client/dist");

/// Where the phone page is served from.
#[derive(Clone)]
pub enum WebRoot {
    /// A folder on disk: a `web` folder beside the exe (lets a page be
    /// swapped without rebuilding the host) or, for developers, the client's
    /// own `dist` so `npm run build` takes effect without recompiling Rust.
    Disk(PathBuf),
    /// The copy compiled into the exe.
    Embedded,
}

pub fn find_web_root() -> Option<WebRoot> {
    let mut candidates: Vec<PathBuf> = Vec::new();

    if let Ok(exe) = std::env::current_exe() {
        if let Some(dir) = exe.parent() {
            candidates.push(dir.join("web"));
            candidates.push(dir.join("../../../../client/dist"));
        }
    }
    candidates.push(PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("../../client/dist"));

    // find_map, not find().and_then(): a candidate that exists but cannot
    // be canonicalized should fall through to the next one rather than
    // disabling the page server entirely.
    let on_disk = candidates
        .into_iter()
        .filter(|path| path.join("index.html").is_file())
        .find_map(|path| path.canonicalize().ok());
    match on_disk {
        Some(path) => Some(WebRoot::Disk(path)),
        None if EMBEDDED_WEB.get_file("index.html").is_some() => Some(WebRoot::Embedded),
        None => None,
    }
}

pub async fn run_http_server(
    app_handle: AppHandle,
    lan_ip: String,
    addresses: Vec<crate::net::LanAddress>,
    listener: std::net::TcpListener,
    port: u16,
    ws_port: u16,
) -> std::io::Result<()> {
    let root = match find_web_root() {
        Some(root) => root,
        None => {
            crate::status::report_error(
                &app_handle,
                "Phone page unavailable: the client bundle was not found. \
                 Run `npm run build` in the client folder, then restart this app."
                    .to_string(),
            );
            let _ = app_handle.emit("web-address", String::new());
            return Ok(());
        }
    };

    let listener = TcpListener::from_std(listener)?;
    let url = format!("http://{lan_ip}:{port}");
    println!("Phone page served at {url}  (open this on your phone)");
    match &root {
        WebRoot::Disk(path) => println!("serving client bundle from {}", path.display()),
        WebRoot::Embedded => println!("serving the client bundle built into this exe"),
    }
    // The name-based address, when mDNS can actually deliver it here. This
    // is what a Home Screen shortcut should be built on -- see stable.rs.
    let stable_url = crate::stable::url_for(port, &lan_ip);
    if let Some(stable) = &stable_url {
        println!("permanent address: {stable}  (survives this PC changing IP)");
    }

    // Rendered once here rather than on demand: the URL is fixed for the
    // life of the process, and the window may ask for the snapshot before
    // or after this point, so both paths need the finished SVG ready.
    //
    // The QR encodes the IP address, not the name: scanning has to work on
    // the first try, and a network that silently drops mDNS would turn the
    // one action the whole setup depends on into a dead end. The phone is
    // offered the permanent address afterwards, once it can test it.
    let qr_svg = crate::qr::svg_for(&url);
    let canonical_port = port == HTTP_PORT;
    let options: Vec<crate::status::AddressOption> = addresses
        .iter()
        .map(|address| {
            let url = format!("http://{}:{port}", address.ip);
            crate::status::AddressOption {
                qr_svg: crate::qr::svg_for(&url),
                url,
                adapter: address.adapter.clone(),
            }
        })
        .collect();
    if let Some(state) = app_handle.try_state::<crate::status::SharedStatus>() {
        state.update(|s| {
            s.addresses = options;
            s.web_url = Some(url.clone());
            s.qr_svg = qr_svg.clone();
            s.stable_url = stable_url.clone();
            s.canonical_port = canonical_port;
        });
    }
    let _ = app_handle.emit("web-address", url);
    if let Some(stable) = stable_url.clone() {
        let _ = app_handle.emit("stable-address", stable);
    }
    // Sent separately from `web-address` so a window that loaded before the
    // page server bound still receives the code, without having to poll.
    if let Some(svg) = qr_svg {
        let _ = app_handle.emit("web-qr", svg);
    }

    let connection_slots = Arc::new(tokio::sync::Semaphore::new(MAX_CONNECTIONS));

    loop {
        // Log and continue: an aborted connection (a phone dropping off
        // Wi-Fi mid-load) must not take the page server down for the rest
        // of the session.
        let (stream, _peer) = match listener.accept().await {
            Ok(accepted) => accepted,
            Err(err) => {
                eprintln!("http accept failed, continuing: {err}");
                tokio::time::sleep(Duration::from_millis(50)).await;
                continue;
            }
        };
        let Ok(permit) = Arc::clone(&connection_slots).try_acquire_owned() else {
            eprintln!("refusing http connection: {MAX_CONNECTIONS} already open");
            drop(stream);
            continue;
        };
        let root = root.clone();
        let lan_ip = lan_ip.clone();
        let handle = app_handle.clone();
        tokio::spawn(async move {
            let _permit = permit;
            // A failed request is logged, never fatal: one malformed
            // request must not take the page server down for the session.
            if let Err(err) = serve_one(stream, &root, &lan_ip, ws_port, &handle).await {
                eprintln!("http request failed: {err}");
            }
        });
    }
}

async fn serve_one(
    mut stream: TcpStream,
    root: &WebRoot,
    lan_ip: &str,
    ws_port: u16,
    app_handle: &AppHandle,
) -> std::io::Result<()> {
    let head = match tokio::time::timeout(HEAD_TIMEOUT, read_head(&mut stream)).await {
        Ok(result) => match result? {
            Some(head) => head,
            None => return Ok(()),
        },
        Err(_) => return Ok(()), // peer stalled mid-request; drop it
    };

    let mut parts = head.lines().next().unwrap_or("").split_whitespace();
    let method = parts.next().unwrap_or("");
    let raw_target = parts.next().unwrap_or("/");

    if method != "GET" && method != "HEAD" {
        return respond(
            &mut stream,
            405,
            "text/plain; charset=utf-8",
            b"Method Not Allowed",
            false,
        )
        .await;
    }

    // Strip the query/fragment before touching the filesystem.
    let target = raw_target.split(['?', '#']).next().unwrap_or("/");

    // The one dynamic endpoint. The client fetches it on load: if it
    // answers, the page knows it was served by a host and can connect
    // itself instead of asking the user to type an address.
    // A page load is the first sign the phone got through at all; the
    // window uses the count to tell "nothing reached this PC" (wrong
    // address, firewall, other network) apart from a later failure.
    if target == "/" || target == "/index.html" {
        if let Some(state) = app_handle.try_state::<crate::status::SharedStatus>() {
            state.update(|s| s.page_requests += 1);
        }
        let _ = app_handle.emit("phone-seen", ());
    }

    if target == "/host-info.json" {
        // `padReady` is the phone's only way to know the PC can actually
        // act on input. Without it the page connects, says "Connected" and
        // silently does nothing when ViGEmBus is missing -- which reads as
        // "this app is broken" rather than "install one driver".
        let snapshot = app_handle
            .try_state::<crate::status::SharedStatus>()
            .map(|state| state.snapshot());
        let pad_ready = snapshot
            .as_ref()
            .map(|s| s.pad_ready)
            // Unknown means don't accuse: claiming the driver is missing
            // when we simply cannot tell would be a worse failure.
            .unwrap_or(true);
        // Handed to the phone so it can offer a Home Screen shortcut built
        // on a name that outlives this PC's current IP. `null` when there
        // isn't one; the page then simply doesn't make the offer.
        let stable = snapshot
            .as_ref()
            .and_then(|s| s.stable_url.clone())
            .map(|url| format!("\"{}\"", url.replace('"', "")))
            .unwrap_or_else(|| "null".to_string());
        // Point the phone back at whatever address it reached us on. The
        // first-choice address can be the wrong one (a second adapter, a
        // VPN); a phone that opened the page through another address or
        // the .local name has just proven that one works.
        let reached = request_host(&head).unwrap_or_else(|| lan_ip.to_string());
        let body = format!(
            "{{\"ws\":\"{reached}:{ws}\",\"host\":\"{reached}\",\"wsPort\":{ws},\
             \"padReady\":{pad_ready},\"stableUrl\":{stable},\"version\":\"{version}\"}}",
            ws = ws_port,
            version = env!("CARGO_PKG_VERSION"),
        );
        return respond(
            &mut stream,
            200,
            "application/json; charset=utf-8",
            body.as_bytes(),
            method == "GET",
        )
        .await;
    }

    let root_dir = match root {
        WebRoot::Disk(dir) => dir,
        WebRoot::Embedded => {
            let Some((body, mime)) = resolve_embedded(target) else {
                return respond(
                    &mut stream,
                    404,
                    "text/plain; charset=utf-8",
                    b"Not Found",
                    method == "GET",
                )
                .await;
            };
            return respond(&mut stream, 200, mime, body, method == "GET").await;
        }
    };

    let Some(path) = resolve_path(root_dir, target) else {
        return respond(
            &mut stream,
            404,
            "text/plain; charset=utf-8",
            b"Not Found",
            method == "GET",
        )
        .await;
    };

    let metadata = match tokio::fs::metadata(&path).await {
        Ok(metadata) => metadata,
        Err(_) => {
            return respond(
                &mut stream,
                404,
                "text/plain; charset=utf-8",
                b"Not Found",
                method == "GET",
            )
            .await
        }
    };
    if metadata.len() > MAX_FILE_BYTES {
        return respond(
            &mut stream,
            413,
            "text/plain; charset=utf-8",
            b"Too Large",
            method == "GET",
        )
        .await;
    }

    let body = match tokio::fs::read(&path).await {
        Ok(body) => body,
        Err(err) => {
            eprintln!("could not read {}: {err}", path.display());
            return respond(
                &mut stream,
                500,
                "text/plain; charset=utf-8",
                b"Internal Server Error",
                method == "GET",
            )
            .await;
        }
    };
    let mime = content_type(&path);
    respond(&mut stream, 200, mime, &body, method == "GET").await
}

/// Looks a request up in the bundle compiled into the exe. Any `..` or
/// absolute component is refused outright: there is no canonical root to
/// compare against here, so the path has to be clean to begin with.
fn resolve_embedded(target: &str) -> Option<(&'static [u8], &'static str)> {
    let decoded = percent_decode(target);
    let relative = decoded.trim_start_matches('/');
    let relative = if relative.is_empty() {
        "index.html"
    } else {
        relative
    };
    let path = Path::new(relative);
    if path
        .components()
        .any(|c| !matches!(c, std::path::Component::Normal(_)))
    {
        return None;
    }
    let file = match EMBEDDED_WEB.get_file(path) {
        Some(file) => file,
        None => EMBEDDED_WEB.get_file(path.join("index.html"))?,
    };
    Some((file.contents(), content_type(file.path())))
}

/// The hostname from the request's Host header, without the port. Only
/// plain hostnames and IPv4 addresses are accepted, since the value is
/// echoed into JSON; anything else falls back to the default address.
fn request_host(head: &str) -> Option<String> {
    let value = head.lines().skip(1).find_map(|line| {
        let (name, value) = line.split_once(':')?;
        name.trim()
            .eq_ignore_ascii_case("host")
            .then(|| value.trim())
    })?;
    let host = value.rsplit_once(':').map_or(value, |(host, _)| host);
    let valid = !host.is_empty()
        && host.len() <= 253
        && host
            .chars()
            .all(|c| c.is_ascii_alphanumeric() || c == '.' || c == '-');
    valid.then(|| host.to_string())
}

fn resolve_path(root: &Path, target: &str) -> Option<PathBuf> {
    let decoded = percent_decode(target);
    let relative = decoded.trim_start_matches('/');
    let mut candidate = if relative.is_empty() {
        root.join("index.html")
    } else {
        root.join(relative)
    };

    if candidate.is_dir() {
        candidate = candidate.join("index.html");
    }

    let canonical = candidate.canonicalize().ok()?;
    if !canonical.starts_with(root) {
        return None;
    }
    if !canonical.is_file() {
        return None;
    }
    Some(canonical)
}

/// Decodes `%XX` escapes. Bytes that are not valid UTF-8 after decoding
/// cannot name a file we would serve anyway, so they fall back to the raw
/// input and then fail the existence check.
fn percent_decode(input: &str) -> String {
    if !input.contains('%') {
        return input.to_string();
    }
    let bytes = input.as_bytes();
    let mut out: Vec<u8> = Vec::with_capacity(bytes.len());
    let mut i = 0;
    while i < bytes.len() {
        if bytes[i] == b'%' && i + 2 < bytes.len() {
            let hex = std::str::from_utf8(&bytes[i + 1..i + 3]).ok();
            if let Some(value) = hex.and_then(|h| u8::from_str_radix(h, 16).ok()) {
                out.push(value);
                i += 3;
                continue;
            }
        }
        out.push(bytes[i]);
        i += 1;
    }
    String::from_utf8(out).unwrap_or_else(|_| input.to_string())
}

async fn read_head(stream: &mut TcpStream) -> std::io::Result<Option<String>> {
    let mut buffer = Vec::with_capacity(1024);
    let mut chunk = [0u8; 1024];
    loop {
        let read = stream.read(&mut chunk).await?;
        if read == 0 {
            return Ok(None); // peer closed before sending a full request
        }
        let scan_from = buffer.len().saturating_sub(3);
        buffer.extend_from_slice(&chunk[..read]);
        if buffer.len() > MAX_HEAD_BYTES {
            return Ok(None);
        }
        // Only the newly arrived bytes need scanning. Rescanning the whole
        // buffer each time is quadratic, which a peer can trigger cheaply
        // by sending one byte at a time.
        if buffer[scan_from..].windows(4).any(|w| w == b"\r\n\r\n") {
            break;
        }
    }
    Ok(Some(String::from_utf8_lossy(&buffer).into_owned()))
}

async fn respond(
    stream: &mut TcpStream,
    status: u16,
    content_type: &str,
    body: &[u8],
    include_body: bool,
) -> std::io::Result<()> {
    let reason = match status {
        200 => "OK",
        404 => "Not Found",
        405 => "Method Not Allowed",
        413 => "Payload Too Large",
        500 => "Internal Server Error",
        _ => "OK",
    };
    let head = format!(
        "HTTP/1.1 {status} {reason}\r\n\
         Content-Type: {content_type}\r\n\
         Content-Length: {len}\r\n\
         Cache-Control: no-store\r\n\
         Connection: close\r\n\r\n",
        len = body.len()
    );
    stream.write_all(head.as_bytes()).await?;
    if include_body {
        stream.write_all(body).await?;
    }
    stream.flush().await?;
    let _ = stream.shutdown().await;
    Ok(())
}

fn content_type(path: &Path) -> &'static str {
    match path.extension().and_then(|e| e.to_str()) {
        Some("html") => "text/html; charset=utf-8",
        Some("js") => "text/javascript; charset=utf-8",
        Some("css") => "text/css; charset=utf-8",
        Some("json") => "application/json; charset=utf-8",
        Some("webmanifest") => "application/manifest+json; charset=utf-8",
        Some("svg") => "image/svg+xml",
        Some("png") => "image/png",
        Some("jpg") | Some("jpeg") => "image/jpeg",
        Some("webp") => "image/webp",
        Some("ico") => "image/x-icon",
        Some("woff2") => "font/woff2",
        Some("txt") => "text/plain; charset=utf-8",
        _ => "application/octet-stream",
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn embedded_lookup_refuses_traversal() {
        assert!(resolve_embedded("/../Cargo.toml").is_none());
        assert!(resolve_embedded("/assets/../../secret").is_none());
        assert!(resolve_embedded("/%2e%2e/secret").is_none());
    }

    #[test]
    fn host_header_drives_the_reply_address() {
        let head = "GET /host-info.json HTTP/1.1\r\nHost: my-pc.local:8788\r\n\r\n";
        assert_eq!(request_host(head).as_deref(), Some("my-pc.local"));
        assert_eq!(
            request_host("GET / HTTP/1.1\r\nHost: bad\"host\r\n\r\n"),
            None
        );
        assert_eq!(request_host("GET / HTTP/1.1\r\n\r\n"), None);
    }

    #[test]
    fn percent_decoding_handles_partial_escapes() {
        assert_eq!(percent_decode("/a%20b"), "/a b");
        assert_eq!(percent_decode("/100%"), "/100%");
        assert_eq!(percent_decode("/%zz"), "/%zz");
    }
}
