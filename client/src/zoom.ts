const DOUBLE_TAP_MS = 320;

export function suppressZoomGestures(): void {
  // iOS Safari pinch zoom.
  for (const type of ["gesturestart", "gesturechange", "gestureend"]) {
    document.addEventListener(type, (e) => e.preventDefault(), { passive: false });
  }

  // iOS double-tap zoom. Only cancel the *second* tap of a rapid pair, so a
  // normal single tap (and rapid taps on different controls, e.g. drumming
  // two buttons) still behaves normally.
  let lastTapAt = 0;
  let lastTarget: EventTarget | null = null;
  document.addEventListener(
    "touchend",
    (e) => {
      const now = Date.now();
      const sameSpot = e.target === lastTarget;
      if (now - lastTapAt < DOUBLE_TAP_MS && sameSpot) {
        e.preventDefault();
      }
      lastTapAt = now;
      lastTarget = e.target;
    },
    { passive: false },
  );

  // Desktop/Android ctrl+wheel and keyboard zoom, so a laptop browser
  // behaves the same way during testing.
  document.addEventListener(
    "wheel",
    (e) => {
      if (e.ctrlKey) e.preventDefault();
    },
    { passive: false },
  );
}
