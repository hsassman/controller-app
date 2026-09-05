//! Renders the phone URL as a QR code for the host window.
//!
//! Typing an `ip:port` on a phone keypad is the fiddliest part of setup, and
//! the window's "Copy address" button copies to the *PC's* clipboard, which
//! is no help at all in getting the address onto the phone. Pointing the
//! phone's camera at the screen removes the step entirely.

use qrcode::render::svg;
use qrcode::{EcLevel, QrCode};

/// An `<svg>` document encoding `url`, or `None` if it could not be encoded.
///
/// Returning `None` rather than panicking matters: the window is the only
/// place a user can see what went wrong at startup, so it has to keep
/// rendering even when this particular nicety fails.
pub fn svg_for(url: &str) -> Option<String> {
    // Low error correction on purpose. The payload is a short LAN URL, the
    // "channel" is a screen a few inches from a camera, and a lower level
    // means a smaller matrix -- fewer, larger modules, which scan faster on
    // a cheap phone camera than a dense grid does.
    let code = QrCode::with_error_correction_level(url, EcLevel::L).ok()?;

    let rendered = code
        .render()
        // Explicit colours: the window is dark-themed, but a QR code has
        // to stay dark-on-light to scan reliably.
        .dark_color(svg::Color("#000000"))
        .light_color(svg::Color("#ffffff"))
        // A quiet zone is required by the spec; scanners fail without it.
        .quiet_zone(true)
        .min_dimensions(200, 200)
        .build();

    // The renderer prefixes an `<?xml ... ?>` declaration. That is correct
    // for a standalone .svg file but not for markup inserted into an HTML
    // document, where a processing instruction is parsed as a bogus comment
    // -- so the window would get a stray node instead of a picture. Hand
    // back the element on its own.
    let start = rendered.find("<svg")?;
    Some(rendered[start..].to_string())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn renders_an_svg_for_a_typical_lan_url() {
        let svg = svg_for("http://192.168.1.42:8788").expect("should encode");
        // Must be the bare element: the window injects this into HTML, where
        // a leading XML declaration would be parsed as a bogus comment.
        assert!(svg.starts_with("<svg"), "got: {}", &svg[..svg.len().min(80)]);
        assert!(svg.contains("</svg>"));
        assert!(!svg.contains("<?xml"));
    }

    #[test]
    fn handles_an_empty_url_without_panicking() {
        // Not a useful code, but it must not bring the window down.
        let _ = svg_for("");
    }
}
