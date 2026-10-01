//! Picking the address a phone can actually reach.
//!
//! The obvious trick -- "whichever local address routes to the internet" --
//! is wrong on a lot of real PCs: with a VPN up it is the VPN's address, and
//! WSL, Hyper-V, VirtualBox, VMware and Docker all add virtual adapters that
//! can win too. Put one of those in the QR code and the phone's browser just
//! spins: the scan "does nothing". So every adapter is listed and ranked,
//! and the window offers the runners-up when the first choice doesn't work.

use std::net::{IpAddr, Ipv4Addr, UdpSocket};

/// One address this PC answers on, with the adapter it belongs to.
#[derive(Clone, Debug, serde::Serialize)]
pub struct LanAddress {
    pub ip: String,
    /// The adapter's name as Windows shows it ("Wi-Fi", "Ethernet 2"...).
    pub adapter: String,
}

/// Adapter-name fragments that mark a virtual or tunnel adapter -- a phone
/// on the same Wi-Fi can't reach any of these.
const VIRTUAL_HINTS: &[&str] = &[
    "vethernet",
    "virtual",
    "vmware",
    "vmnet",
    "virtualbox",
    "hyper-v",
    "wsl",
    "docker",
    "vpn",
    "tap",
    "tun",
    "tailscale",
    "zerotier",
    "hamachi",
    "wireguard",
    "nordlynx",
    "openvpn",
    "fortinet",
    "forticlient",
    "cisco",
    "anyconnect",
    "pangp",
    "globalprotect",
    "radmin",
    "loopback",
    "bluetooth",
    "npcap",
    "veth",
    "virbr",
    "br-",
    "utun",
    "vbox",
];

/// Names of real network hardware.
const PHYSICAL_HINTS: &[&str] = &[
    "wi-fi", "wifi", "wlan", "wireless", "ethernet", "eth", "en0", "en1",
];

/// The address the OS would use to reach the internet. Nothing is sent: a
/// UDP "connect" only picks a route.
fn routed_ip() -> Option<Ipv4Addr> {
    let socket = UdpSocket::bind("0.0.0.0:0").ok()?;
    socket.connect("8.8.8.8:80").ok()?;
    match socket.local_addr().ok()?.ip() {
        IpAddr::V4(ip) => Some(ip),
        IpAddr::V6(_) => None,
    }
}

fn score(ip: Ipv4Addr, adapter: &str, routed: Option<Ipv4Addr>) -> i32 {
    let name = adapter.to_lowercase();
    let mut score = 0;
    // Home and office Wi-Fi is overwhelmingly 192.168.x.x, then 10.x.x.x.
    // 172.16-31 is common too, but it is also where WSL and Docker live.
    let [a, b, ..] = ip.octets();
    if a == 192 && b == 168 {
        score += 40;
    } else if a == 10 {
        score += 30;
    } else if a == 172 && (16..=31).contains(&b) {
        score += 15;
    } else if a == 100 && (64..=127).contains(&b) {
        // Carrier-grade NAT range: Tailscale and similar overlays.
        score -= 30;
    }
    if VIRTUAL_HINTS.iter().any(|hint| name.contains(hint)) {
        score -= 100;
    }
    if PHYSICAL_HINTS.iter().any(|hint| name.contains(hint)) {
        score += 20;
    }
    if Some(ip) == routed {
        score += 10;
    }
    score
}

/// Every usable IPv4 address on this PC, most likely to work first.
pub fn lan_addresses() -> Vec<LanAddress> {
    let routed = routed_ip();
    let mut found: Vec<(i32, LanAddress)> = local_ip_address::list_afinet_netifas()
        .unwrap_or_default()
        .into_iter()
        .filter_map(|(adapter, ip)| match ip {
            IpAddr::V4(ip) if !ip.is_loopback() && !ip.is_link_local() && !ip.is_unspecified() => {
                Some((
                    score(ip, &adapter, routed),
                    LanAddress {
                        ip: ip.to_string(),
                        adapter,
                    },
                ))
            }
            _ => None,
        })
        .collect();

    // The routed address on its own, in case listing adapters failed.
    if let Some(ip) = routed {
        if !found.iter().any(|(_, a)| a.ip == ip.to_string()) {
            found.push((
                score(ip, "", Some(ip)),
                LanAddress {
                    ip: ip.to_string(),
                    adapter: String::new(),
                },
            ));
        }
    }

    found.sort_by(|a, b| b.0.cmp(&a.0));
    let mut seen = std::collections::HashSet::new();
    found
        .into_iter()
        .map(|(_, address)| address)
        .filter(|address| seen.insert(address.ip.clone()))
        .collect()
}

#[cfg(test)]
mod tests {
    use super::*;

    // Arbitrary example addresses, one per private range.
    const HOME: Ipv4Addr = Ipv4Addr::new(192, 168, 50, 50);
    const TUNNEL: Ipv4Addr = Ipv4Addr::new(10, 99, 0, 2);
    const OFFICE: Ipv4Addr = Ipv4Addr::new(10, 1, 1, 1);
    const WSL: Ipv4Addr = Ipv4Addr::new(172, 20, 1, 1);

    #[test]
    fn home_wifi_beats_a_vpn_that_owns_the_route() {
        assert!(score(HOME, "Wi-Fi", Some(TUNNEL)) > score(TUNNEL, "NordLynx", Some(TUNNEL)));
    }

    #[test]
    fn wsl_and_hyper_v_adapters_lose_to_ethernet() {
        assert!(score(OFFICE, "Ethernet", None) > score(WSL, "vEthernet (WSL)", None));
    }
}
