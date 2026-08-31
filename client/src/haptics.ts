// Touch feedback. `navigator.vibrate` is Android-only (iOS Safari has never
// shipped it), so every call is best-effort and silent on failure -- the
// controller must feel identical minus the buzz, never throw.

let enabled = true;
let strength = 0.6;

export function configureHaptics(on: boolean, level: number): void {
  enabled = on;
  strength = Math.min(1, Math.max(0, level));
}

/// Durations are short on purpose. Anything past ~30ms on a phone reads as
/// a rattle rather than a button click, and a controller fires these dozens
/// of times a second during play.
const PATTERNS = {
  press: 14,
  release: 6,
  detent: 9, // d-pad crossing into a new direction
  click: 22, // stick click (L3/R3) -- deliberate, so it gets a firmer tap
  ui: 10,
} as const;

export type HapticKind = keyof typeof PATTERNS;

export function haptic(kind: HapticKind): void {
  if (!enabled || strength <= 0) return;
  const ms = Math.round(PATTERNS[kind] * (0.4 + strength * 0.9));
  if (ms <= 0) return;
  try {
    navigator.vibrate?.(ms);
  } catch {
    // Unsupported or blocked (no user gesture yet) — feedback is optional.
  }
}
