use std::path::{Path, PathBuf};

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

pub fn find_web_root() -> Option<PathBuf> {
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
    candidates
        .into_iter()
        .filter(|path| path.join("index.html").is_file())
        .find_map(|path| path.canonicalize().ok())
}

pub async fn run_http_server(
    app_handle: AppHandle,
    lan_ip: String,
    listener: std::net::TcpListener,
    port: u16,
    ws_port: u16,
) -> std::io::Result<()> {
    let root = match find_web_root() {
        Some(root) => root,
        None => {
            eprintln!(
                "client bundle not found -- the phone page will not be served. \
                 Build it with `npm run build` in /client, then restart this app."
            );
            let _ = app_handle.emit("web-address", String::new());
            return Ok(());
        }
    };

    let listener = TcpListener::from_std(listener)?;
    let url = format!("http://{lan_ip}:{port}");
    println!("Phone page served at {url}  (open this on your phone)");
    println!("serving client bundle from {}", root.display());
    if let Some(state) = app_handle.try_state::<crate::status::SharedStatus>() {
        state.update(|s| s.web_url = Some(url.clone()));
    }
    let _ = app_handle.emit("web-address", url);

    loop {
        let (stream, _peer) = listener.accept().await?;
        let root = root.clone();
        let lan_ip = lan_ip.clone();
        tokio::spawn(async move {
            // A failed request is logged, never fatal: one malformed
            // request must not take the page server down for the session.
            if let Err(err) = serve_one(stream, &root, &lan_ip, ws_port).await {
                eprintln!("http request failed: {err}");
            }
        });
    }
}

async fn serve_one(
    mut stream: TcpStream,
    root: &Path,
    lan_ip: &str,
    ws_port: u16,
) -> std::io::Result<()> {
    let head = match read_head(&mut stream).await? {
        Some(head) => head,
        None => return Ok(()),
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
    let target = raw_target
        .split(['?', '#'])
        .next()
        .unwrap_or("/");

    // The one dynamic endpoint. The client fetches it on load: if it
    // answers, the page knows it was served by a host and can connect
    // itself instead of asking the user to type an address.
    if target == "/host-info.json" {
        let body = format!(
            "{{\"ws\":\"{lan_ip}:{ws}\",\"host\":\"{lan_ip}\",\"wsPort\":{ws}}}",
            ws = ws_port
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

    let Some(path) = resolve_path(root, target) else {
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
        buffer.extend_from_slice(&chunk[..read]);
        if buffer.windows(4).any(|w| w == b"\r\n\r\n") {
            break;
        }
        if buffer.len() > MAX_HEAD_BYTES {
            return Ok(None);
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
