import type { ThemeId } from "./theme.ts";

const STORAGE_KEY = "controller-settings-v1";

export interface Settings {
  // --- Accessibility ---
  highContrast: boolean;
  deadZone: number; // 0-0.5, fraction of stick radius
  sensitivityCurve: number; // 1 = linear, >1 = more precision near center
  toggleButtonIds: string[]; // control ids running in toggle mode
  reduceMotion: boolean; // force-disable transitions/animations

  // --- Appearance ---
  theme: ThemeId;
  accent: string; // hex, drives --accent and every derived tint
  controlOpacity: number; // 0.35-1, lets game video show through
  controlScale: number; // 0.75-1.4, multiplies every control's size
  showLabels: boolean; // draw A/B/X/Y/LB/... text on controls
  surfaceGlow: boolean; // the moulded vignette behind the controls

  // --- Feel ---
  haptics: boolean;
  hapticStrength: number; // 0-1, mapped to a vibration duration
  stickSnapBack: boolean; // animate the knob home on release

  // --- Editor ---
  snapToGrid: boolean;
  gridSize: number; // percent of the surface per grid step
}

export function defaults(): Settings {
  return {
    highContrast: false,
    deadZone: 0.12,
    sensitivityCurve: 1,
    toggleButtonIds: [],
    reduceMotion: false,

    theme: "midnight",
    accent: "#4da3ff",
    controlOpacity: 1,
    controlScale: 1,
    showLabels: true,
    surfaceGlow: true,

    haptics: true,
    hapticStrength: 0.6,
    stickSnapBack: true,

    snapToGrid: false,
    gridSize: 2,
  };
}

export function loadSettings(): Settings {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return defaults();
    return sanitize({ ...defaults(), ...JSON.parse(raw) });
  } catch {
    return defaults();
  }
}

function sanitize(s: Settings): Settings {
  const d = defaults();
  const num = (v: unknown, min: number, max: number, fallback: number) =>
    typeof v === "number" && Number.isFinite(v) ? Math.min(max, Math.max(min, v)) : fallback;

  s.deadZone = num(s.deadZone, 0, 0.5, d.deadZone);
  s.sensitivityCurve = num(s.sensitivityCurve, 0.5, 2, d.sensitivityCurve);
  s.controlOpacity = num(s.controlOpacity, 0.35, 1, d.controlOpacity);
  s.controlScale = num(s.controlScale, 0.75, 1.4, d.controlScale);
  s.hapticStrength = num(s.hapticStrength, 0, 1, d.hapticStrength);
  s.gridSize = num(s.gridSize, 0.5, 10, d.gridSize);
  if (!Array.isArray(s.toggleButtonIds)) s.toggleButtonIds = [];
  if (typeof s.accent !== "string" || !/^#[0-9a-f]{6}$/i.test(s.accent)) s.accent = d.accent;
  return s;
}

export function saveSettings(settings: Settings): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(settings));
  } catch {
    // localStorage unavailable (private mode, quota) — settings just won't persist.
  }
}

export function applyHighContrast(enabled: boolean): void {
  document.documentElement.classList.toggle("high-contrast", enabled);
}
