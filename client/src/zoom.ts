const DOUBLE_TAP_MS = 320;

/// True when the event happened over the play surface.
///
/// Everything here used to apply document-wide, which meant the connect
/// screen, the settings panel and the editor could not be magnified either.
/// Suppressing zoom is only worth it where a stray pinch costs you a game,
/// so all of it is scoped to the pad; iOS Safari ignores the viewport tag,
/// so these handlers are the only thing covering it there.
function overSurface(target: EventTarget | null): boolean {
  return target instanceof Node
    ? Boolean((target instanceof Element ? target : target.parentElement)?.closest(".controls-surface"))
    : false;
}

export function suppressZoomGestures(): void {
  // iOS Safari pinch zoom.
  for (const type of ["gesturestart", "gesturechange", "gestureend"]) {
    document.addEventListener(
      type,
      (e) => {
        if (overSurface(e.target)) e.preventDefault();
      },
      { passive: false },
    );
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
      if (now - lastTapAt < DOUBLE_TAP_MS && sameSpot && overSurface(e.target)) {
        e.preventDefault();
      }
      lastTapAt = now;
      lastTarget = e.target;
    },
    { passive: false },
  );

  // Desktop/Android ctrl+wheel zoom, so a laptop browser behaves the same
  // way during testing. Left alone outside the pad, where zooming is a
  // legitimate thing to want.
  document.addEventListener(
    "wheel",
    (e) => {
      if (e.ctrlKey && overSurface(e.target)) e.preventDefault();
    },
    { passive: false },
  );
}
