// Sharing a layout by QR code, phone to phone, without a file transfer step.
//
// Both phones are on the same PC's page already (that's the whole point of
// this app), so the shared payload can just be a URL back to this same
// origin with the layout packed into the fragment: `#import=<json>`. The
// fragment never leaves the browser in a request, so nothing has to be
// hosted or relayed to make this work -- scanning the code with any camera
// app opens the URL, and main.ts notices the fragment on load.

import type { Layout } from "./layout.ts";
import { sanitizeLayout } from "./profile.ts";
import qrcode from "qrcode-generator";

const IMPORT_KEY = "import";
/// QR codes get harder to scan reliably well before their theoretical
/// capacity, and a layout with a custom image background could otherwise
/// try to cram megabytes into a code. Past this, sharing falls back to
/// Export/Import (a file has no such ceiling). Measured against the whole
/// URL (origin included), comfortably inside error-correction level M's
/// ~2330-byte ceiling at the QR spec's largest version.
const MAX_SHARE_CHARS = 2200;

/// `btoa` only accepts Latin-1 code points, so a name or label with an
/// emoji or accent would throw without this -- the classic escape/unescape
/// round trip re-packs a UTF-8 string into the byte range btoa expects.
function toBase64(s: string): string {
  return btoa(unescape(encodeURIComponent(s)));
}
function fromBase64(s: string): string {
  return decodeURIComponent(escape(atob(s)));
}

/// Strips anything not worth -- or not able to fit -- carrying over a QR
/// code. An image background is the one field genuinely too large; it's
/// dropped rather than blocking the whole share over it.
function shareable(layout: Layout): Layout {
  const { background, ...rest } = layout;
  if (background?.type === "image") return rest;
  return layout;
}

/// Returns the URL to encode as a QR code, or null if the layout (even with
/// an image background stripped) is too large to share this way.
export function buildShareUrl(layout: Layout): string | null {
  const json = JSON.stringify(shareable(layout));
  const encoded = toBase64(json);
  const url = new URL(location.href);
  url.hash = `${IMPORT_KEY}=${encoded}`;
  const full = url.toString();
  return full.length > MAX_SHARE_CHARS ? null : full;
}

/// Renders `text` as a QR code into a fresh canvas displayed at `pixels`
/// square (the caller's CSS sizing is unchanged). Error-correction level M
/// tolerates a scratched or reflective phone screen without needing the
/// payload padded.
export function renderQrCanvas(text: string, pixels: number): HTMLCanvasElement {
  const qr = qrcode(0, "M");
  qr.addData(text);
  qr.make();
  const count = qr.getModuleCount();
  // Both ends of this scan are phones, which are almost never DPR 1 --
  // drawing at CSS pixel resolution and letting the browser upscale the
  // bitmap blurs the modules right at the edges a scanner relies on. Backing
  // the canvas with `pixels * dpr` real pixels (displayed at the same CSS
  // size) keeps every module crisp. Capped at 3x: quality gains vanish past
  // it and it would only cost more canvas memory.
  const dpr = Math.min(window.devicePixelRatio || 1, 3);
  const cell = Math.floor((pixels * dpr) / count) || 1;
  const size = cell * count;

  const canvas = document.createElement("canvas");
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext("2d")!;
  ctx.fillStyle = "#ffffff";
  ctx.fillRect(0, 0, size, size);
  ctx.fillStyle = "#000000";
  for (let row = 0; row < count; row++) {
    for (let col = 0; col < count; col++) {
      if (qr.isDark(row, col)) ctx.fillRect(col * cell, row * cell, cell, cell);
    }
  }
  return canvas;
}

/// Pulls a shared layout out of the current URL fragment, if there is one,
/// and validates it the same way a file import would. Returns null for "no
/// import in the URL" as well as for "there was one but it didn't parse" --
/// callers can't usefully tell those apart and shouldn't try to.
export function consumeSharedLayoutFromUrl(): Layout | null {
  const hash = location.hash.replace(/^#/, "");
  if (!hash.startsWith(`${IMPORT_KEY}=`)) return null;
  // Removed immediately regardless of outcome: a failed or accepted import
  // must not re-trigger on the next reload of what is now a plain URL.
  history.replaceState(null, "", location.pathname + location.search);
  try {
    const json = fromBase64(hash.slice(IMPORT_KEY.length + 1));
    const parsed = JSON.parse(json) as Layout;
    if (!Array.isArray(parsed.controls)) return null;
    return sanitizeLayout(parsed);
  } catch {
    return null;
  }
}
