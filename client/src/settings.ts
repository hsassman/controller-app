import type { ButtonMaterial, DpadStyle, ThemeId } from "./theme.ts";
import { BUTTON_MATERIALS, DPAD_STYLES, THEMES } from "./theme.ts";

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
  buttonMaterial: ButtonMaterial; // how the control surfaces catch light
  dpadStyle: DpadStyle; // the d-pad's silhouette
  glowIntensity: number; // 0-1.5, multiplies the accent glow on pressed controls
  idleDimSeconds: number; // seconds of no input before the controls fade; 0 = off

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
    buttonMaterial: "gloss",
    dpadStyle: "cross",
    glowIntensity: 1,
    idleDimSeconds: 0,

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
  s.glowIntensity = num(s.glowIntensity, 0, 1.5, d.glowIntensity);
  // Capped well above the offered presets so a hand-edited value stays
  // usable, but not so high that "on" is indistinguishable from "off".
  s.idleDimSeconds = num(s.idleDimSeconds, 0, 600, d.idleDimSeconds);
  if (!Array.isArray(s.toggleButtonIds)) s.toggleButtonIds = [];
  if (typeof s.accent !== "string" || !/^#[0-9a-f]{6}$/i.test(s.accent)) s.accent = d.accent;

  // An id no longer in the list (a removed theme, a corrupt value) would
  // otherwise reach the DOM and match no rule at all.
  if (!THEMES.some((t) => t.id === s.theme)) s.theme = d.theme;
  if (!BUTTON_MATERIALS.some((m) => m.id === s.buttonMaterial)) s.buttonMaterial = d.buttonMaterial;
  if (!DPAD_STYLES.some((p) => p.id === s.dpadStyle)) s.dpadStyle = d.dpadStyle;
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
