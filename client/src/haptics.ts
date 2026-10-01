// Touch feedback and game rumble. `navigator.vibrate` is Android-only (iOS
// Safari has never shipped it), so every call is best-effort and silent on
// failure -- the controller must feel identical minus the buzz, never throw.

let enabled = true;
let strength = 0.6;

let rumbleEnabled = true;
let rumbleStrength = 0.8;
/// 0-1, the effective motor level currently being played. Non-zero means a
/// game is holding the rumble on.
let rumbleLevel = 0;
let rumbleTimer: number | null = null;

export function configureHaptics(on: boolean, level: number): void {
  enabled = on;
  strength = Math.min(1, Math.max(0, level));
}

export function configureRumble(on: boolean, level: number): void {
  rumbleEnabled = on;
  rumbleStrength = Math.min(1, Math.max(0, level));
  if (!on) stopRumble();
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

function vibrate(pattern: number | number[]): void {
  try {
    navigator.vibrate?.(pattern);
  } catch {
    // Unsupported or blocked (no user gesture yet) — feedback is optional.
  }
}

/// Whether this browser can vibrate at all. False on every iPhone browser.
export function canVibrate(): boolean {
  return typeof navigator !== "undefined" && typeof navigator.vibrate === "function";
}

export function haptic(kind: HapticKind): void {
  if (!enabled || strength <= 0) return;
  // A vibrate() call replaces whatever pattern is playing, so a tap during
  // game rumble would cut the rumble dead. The rumble is the stronger and
  // more meaningful signal; the tap gives way.
  if (rumbleLevel > 0) return;
  const ms = Math.round(PATTERNS[kind] * (0.4 + strength * 0.9));
  if (ms <= 0) return;
  vibrate(ms);
}

/// A phone has one motor and no speed control, so motor speed is played as
/// pulse width: within each short cycle the motor is on for a share
/// proportional to the level. At these cycle lengths the hand reads it as
/// a weaker or stronger buzz rather than as separate pulses.
const RUMBLE_CYCLE_MS = 50;
/// How long one queued pattern runs before it is topped up. A game that
/// holds rumble on sends nothing more, so the pattern is re-issued while
/// the level stays up; a dropped connection stops it via stopRumble().
const RUMBLE_CHUNK_MS = 1000;

function playRumbleChunk(): void {
  if (rumbleLevel <= 0) return;
  const on = Math.max(8, Math.round(RUMBLE_CYCLE_MS * rumbleLevel));
  if (on >= RUMBLE_CYCLE_MS - 4) {
    vibrate(RUMBLE_CHUNK_MS);
    return;
  }
  const pattern: number[] = [];
  for (let t = 0; t < RUMBLE_CHUNK_MS; t += RUMBLE_CYCLE_MS) pattern.push(on, RUMBLE_CYCLE_MS - on);
  vibrate(pattern);
}

/// Plays the game's motor speeds (each 0-1). The heavy motor dominates a
/// real controller's feel; the light one adds a sharper buzz on top.
/// Returns the effective level actually played (0 when rumble is off), so
/// the caller can drive a visual cue at the same strength.
export function setRumble(large: number, small: number): number {
  const raw = Math.min(1, Math.max(large, small * 0.75, (large + small) / 1.6));
  const level = rumbleEnabled ? raw * rumbleStrength : 0;
  if (level < 0.02) {
    stopRumble();
    return 0;
  }
  rumbleLevel = level;
  playRumbleChunk();
  if (rumbleTimer === null) {
    rumbleTimer = window.setInterval(playRumbleChunk, RUMBLE_CHUNK_MS - 60);
  }
  return level;
}

export function stopRumble(): void {
  const wasOn = rumbleLevel > 0;
  rumbleLevel = 0;
  if (rumbleTimer !== null) {
    window.clearInterval(rumbleTimer);
    rumbleTimer = null;
  }
  if (wasOn) vibrate(0);
}
