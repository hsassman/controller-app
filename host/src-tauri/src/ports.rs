use std::net::{Ipv4Addr, SocketAddr, TcpListener as StdListener, TcpStream};
use std::time::Duration;

/// How many consecutive ports to try before giving up.
const MAX_ATTEMPTS: u16 = 12;

const PROBE_TIMEOUT: Duration = Duration::from_millis(25);

fn port_is_taken(port: u16) -> bool {
    let addr = SocketAddr::from((Ipv4Addr::LOCALHOST, port));
    TcpStream::connect_timeout(&addr, PROBE_TIMEOUT).is_ok()
}

pub fn bind_from(preferred: u16) -> std::io::Result<(StdListener, u16)> {
    let mut last_err: Option<std::io::Error> = None;

    for offset in 0..MAX_ATTEMPTS {
        // checked_add, not saturating: saturation near u16::MAX would retry
        // the same port MAX_ATTEMPTS times instead of trying distinct ones.
        let Some(port) = preferred.checked_add(offset) else {
            break;
        };
        if port_is_taken(port) {
            if offset == 0 {
                println!("port {port} is already in use by another program; trying the next one");
            }
            continue;
        }
        match StdListener::bind((Ipv4Addr::UNSPECIFIED, port)) {
            Ok(listener) => match listener.set_nonblocking(true) {
                Ok(()) => return Ok((listener, port)),
                // Advance rather than abort: failing here would throw away
                // a perfectly good bind and give up the whole search.
                Err(err) => last_err = Some(err),
            },
            Err(err) => last_err = Some(err),
        }
    }

    Err(last_err.unwrap_or_else(|| {
        std::io::Error::new(
            std::io::ErrorKind::AddrInUse,
            format!(
                "no free port in {}..{}",
                preferred,
                preferred.saturating_add(MAX_ATTEMPTS)
            ),
        )
    }))
}
