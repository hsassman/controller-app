let wakeLock: WakeLockSentinel | null = null;
let wakeLockWanted = false;

export function fullscreenSupported(): boolean {
  return typeof document.documentElement.requestFullscreen === "function";
}

export function isFullscreen(): boolean {
  return document.fullscreenElement !== null;
}

export async function toggleFullscreen(): Promise<void> {
  try {
    if (isFullscreen()) await document.exitFullscreen();
    else await document.documentElement.requestFullscreen({ navigationUI: "hide" });
  } catch {
    // Denied (no user gesture, iOS Safari on iPhone) — not fatal.
  }
}

export async function acquireWakeLock(): Promise<void> {
  if (!("wakeLock" in navigator) || !wakeLockWanted) return;
  try {
    wakeLock = await navigator.wakeLock.request("screen");
    wakeLock.addEventListener("release", () => {
      wakeLock = null;
    });
  } catch {
    // Low battery / unsupported — the screen may dim, nothing else breaks.
  }
}

export function releaseWakeLock(): void {
  wakeLockWanted = false;
  wakeLock?.release().catch(() => {});
  wakeLock = null;
}

let visibilityHooked = false;

export function keepAwakeWhileVisible(): void {
  wakeLockWanted = true;
  void acquireWakeLock();
  if (visibilityHooked) return;
  visibilityHooked = true;
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "visible" && wakeLockWanted && wakeLock === null) {
      void acquireWakeLock();
    }
  });
}
