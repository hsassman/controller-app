//! A LAN address that survives the PC changing IP.
//!
//! The phone page is normally reached at `http://<lan-ip>:<port>`, and that
//! address is fine for a one-off scan. It is the wrong thing to build a Home
//! Screen shortcut on: a shortcut pins the exact origin, and the next DHCP
//! lease hands this PC a different IP, so the icon quietly stops working.
//!
//! `<hostname>.local` is the fix. Windows answers mDNS for its own hostname,
//! and iOS resolves `.local` through Bonjour natively, so the name keeps
//! pointing at this machine no matter what its address becomes.
//!
//! Nothing here is assumed: the name is only offered after it has been
//! resolved and checked to point back at one of this machine's own
//! addresses. Some networks (guest Wi-Fi, AP client isolation) drop mDNS,
//! and advertising a name that doesn't resolve would be worse than saying
//! nothing.

use std::net::{IpAddr, ToSocketAddrs};

/// This machine's hostname, lowercased. Lowercase because it ends up in a
/// URL, and Windows reports the name in caps, which reads as shouting in an
/// address bar.
fn hostname() -> Option<String> {
    #[cfg(windows)]
    let raw = std::env::var("COMPUTERNAME").ok();
    #[cfg(not(windows))]
    let raw = std::env::var("HOSTNAME").ok();

    let name = raw?.trim().to_lowercase();
    // A hostname with a dot is already qualified; appending `.local` to it
    // would produce nonsense like `pc.corp.example.local`.
    if name.is_empty() || name.contains('.') {
        return None;
    }
    Some(name)
}

/// `http://<hostname>.local:<port>`, but only when that name resolves to an
/// address this machine actually answers on.
///
/// `local_ip` is the LAN address already chosen for the IP-based URL; a
/// resolved name that matches it is proof the two routes reach the same
/// place. Loopback counts as well, since resolution happening at all is the
/// signal that mDNS is working here.
pub fn url_for(port: u16, local_ip: &str) -> Option<String> {
    let host = format!("{}.local", hostname()?);

    // Resolution goes through the OS resolver, which on Windows includes the
    // mDNS responder -- the same path the phone's Bonjour lookup will take.
    let resolved: Vec<IpAddr> = (host.as_str(), port)
        .to_socket_addrs()
        .ok()?
        .map(|addr| addr.ip())
        .collect();
    if resolved.is_empty() {
        return None;
    }

    // Must match the address we already know is ours. Accepting anything
    // that merely came back -- a link-local answer, say -- would turn this
    // into a test that the resolver replied at all, which it always does.
    let expected: Option<IpAddr> = local_ip.parse().ok();
    let points_here = resolved
        .iter()
        .any(|ip| Some(*ip) == expected || ip.is_loopback());
    if !points_here {
        return None;
    }

    Some(format!("http://{host}:{port}"))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn a_dotted_hostname_is_not_given_a_local_suffix() {
        // Guards the rule rather than the environment: whatever this machine
        // is called, the result must never contain two dotted suffixes.
        if let Some(name) = hostname() {
            assert!(!name.contains('.'), "hostname() must reject qualified names");
        }
    }

    #[test]
    fn an_unresolvable_name_yields_nothing() {
        // 0.0.0.0 is not an address any hostname resolves to, so even if this
        // machine's `.local` name does resolve, it cannot match.
        assert_eq!(url_for(8788, "203.0.113.255"), None);
    }
}
