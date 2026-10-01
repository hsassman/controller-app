// Reading the PC's QR code from inside the app.
//
// Live camera preview (getUserMedia) is only allowed on secure https pages,
// and this app is served over plain http on the local network, so it can't
// show a viewfinder. What does work over http is the photo picker with
// `capture`: it opens the camera on top of the app and hands the photo
// back, so a Home Screen app stays in fullscreen the whole time. The photo
// is then decoded here -- by the browser's own BarcodeDetector where there
// is one (Android Chrome), otherwise by jsQR, loaded only when needed.

const DEFAULT_WS_PORT = 8787;

interface Detector {
  detect(source: CanvasImageSource): Promise<{ rawValue: string }[]>;
}

/// Draws the photo at `maxSide` pixels on its longest edge. Phone photos are
/// 12+ megapixels; decoding that is slow and no more accurate.
async function drawScaled(file: File, maxSide: number): Promise<HTMLCanvasElement> {
  const bitmap = await createImageBitmap(file);
  const scale = Math.min(1, maxSide / Math.max(bitmap.width, bitmap.height));
  const canvas = document.createElement("canvas");
  canvas.width = Math.round(bitmap.width * scale);
  canvas.height = Math.round(bitmap.height * scale);
  canvas.getContext("2d")!.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
  bitmap.close();
  return canvas;
}

/// The text of the QR code in `file`, or null if none could be read.
export async function readQrFromPhoto(file: File): Promise<string | null> {
  const BarcodeDetectorCtor = (window as unknown as { BarcodeDetector?: new (o: object) => Detector }).BarcodeDetector;
  if (BarcodeDetectorCtor) {
    try {
      const canvas = await drawScaled(file, 1600);
      const found = await new BarcodeDetectorCtor({ formats: ["qr_code"] }).detect(canvas);
      if (found[0]?.rawValue) return found[0].rawValue;
    } catch {
      // Unsupported format list or a decode failure: fall through to jsQR.
    }
  }

  const { default: jsQR } = await import("jsqr");
  // A code photographed off a screen is sometimes only readable at one
  // size, so try a couple before giving up.
  for (const side of [1280, 800, 1800]) {
    const canvas = await drawScaled(file, side);
    const ctx = canvas.getContext("2d")!;
    const image = ctx.getImageData(0, 0, canvas.width, canvas.height);
    const result = jsQR(image.data, image.width, image.height, { inversionAttempts: "attemptBoth" });
    if (result?.data) return result.data;
  }
  return null;
}

/// Turns the scanned URL (`http://<pc>:8788`, with `?ws=<port>` when the
/// controller port isn't the usual one) into the `host:port` the app
/// connects to. Null for anything that isn't one of this app's codes.
export function controllerAddressFromScan(text: string): string | null {
  let url: URL;
  try {
    url = new URL(text.trim());
  } catch {
    return null;
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") return null;
  if (!url.hostname) return null;
  const ws = Number(url.searchParams.get("ws"));
  const port = Number.isInteger(ws) && ws > 0 && ws < 65536 ? ws : DEFAULT_WS_PORT;
  return `${url.hostname}:${port}`;
}
