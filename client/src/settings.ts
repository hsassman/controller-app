import type {
  ButtonMaterial,
  DpadStyle,
  FaceStyle,
  LabelStyle,
  StickColor,
  StickStyle,
  SurfaceStyle,
  ThemeId,
} from "./theme.ts";
import {
  BUTTON_MATERIALS,
  DPAD_STYLES,
  FACE_STYLES,
  LABEL_STYLES,
  STICK_COLORS,
  STICK_STYLES,
  SURFACE_STYLES,
  THEMES,
} from "./theme.ts";
import type { IconPackId } from "./iconPacks.ts";
import type { PadStyleId } from "./padStyles.ts";
import { PAD_STYLE_IDS } from "./padStyles.ts";
import { ICON_PACKS } from "./iconPacks.ts";

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
  iconPack: IconPackId; // what face buttons draw, purely cosmetic
  padStyle: PadStyleId; // which real controller the pad is styled after
  shellColor: string; // controller body colour (hex), "" = follow the theme
  faceStyle: FaceStyle; // how A/B/X/Y are coloured
  stickStyle: StickStyle; // thumbstick cap shape
  stickColor: StickColor; // thumbstick cap colour
  labelStyle: LabelStyle; // printed / engraved / backlit legends
  surfaceStyle: SurfaceStyle; // dark backdrop, or the controller body edge to edge

  // --- Feel ---
  haptics: boolean;
  hapticStrength: number; // 0-1, mapped to a vibration duration
  stickSnapBack: boolean; // animate the knob home on release
  gameRumble: boolean; // vibrate when the game rumbles the controller
  rumbleStrength: number; // 0-1, scales the game's motor speeds
  rumbleVisual: boolean; // pulse the pad's edges with the rumble (works without vibration)

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
    iconPack: "letters",
    padStyle: "xbox360",
    shellColor: "",
    faceStyle: "classic",
    stickStyle: "concave",
    stickColor: "accent",
    labelStyle: "printed",
    surfaceStyle: "backdrop",

    haptics: true,
    hapticStrength: 0.6,
    stickSnapBack: true,
    gameRumble: true,
    rumbleStrength: 0.8,
    rumbleVisual: true,

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
  s.rumbleStrength = num(s.rumbleStrength, 0, 1, d.rumbleStrength);
  for (const key of ["haptics", "stickSnapBack", "gameRumble", "rumbleVisual", "highContrast", "reduceMotion", "showLabels", "surfaceGlow", "snapToGrid"] as const) {
    if (typeof s[key] !== "boolean") s[key] = d[key];
  }
  if (typeof s.shellColor !== "string" || (s.shellColor !== "" && !/^#[0-9a-f]{6}$/i.test(s.shellColor))) {
    s.shellColor = d.shellColor;
  }
  if (!Array.isArray(s.toggleButtonIds)) s.toggleButtonIds = [];
  if (typeof s.accent !== "string" || !/^#[0-9a-f]{6}$/i.test(s.accent)) s.accent = d.accent;

  // An id no longer in the list (a removed theme, a corrupt value) would
  // otherwise reach the DOM and match no rule at all.
  if (!THEMES.some((t) => t.id === s.theme)) s.theme = d.theme;
  if (!BUTTON_MATERIALS.some((m) => m.id === s.buttonMaterial)) s.buttonMaterial = d.buttonMaterial;
  // "disc" was replaced by the faceted dish -- the closest successor, and
  // what someone who picked a round d-pad most likely still wants.
  if ((s.dpadStyle as string) === "disc") s.dpadStyle = "faceted";
  if (!DPAD_STYLES.some((p) => p.id === s.dpadStyle)) s.dpadStyle = d.dpadStyle;
  if (!ICON_PACKS.some((p) => p.id === s.iconPack)) s.iconPack = d.iconPack;
  if (!PAD_STYLE_IDS.includes(s.padStyle)) s.padStyle = d.padStyle;
  if (!FACE_STYLES.some((p) => p.id === s.faceStyle)) s.faceStyle = d.faceStyle;
  if (!STICK_STYLES.some((p) => p.id === s.stickStyle)) s.stickStyle = d.stickStyle;
  if (!STICK_COLORS.some((p) => p.id === s.stickColor)) s.stickColor = d.stickColor;
  if (!LABEL_STYLES.some((p) => p.id === s.labelStyle)) s.labelStyle = d.labelStyle;
  if (!SURFACE_STYLES.some((p) => p.id === s.surfaceStyle)) s.surfaceStyle = d.surfaceStyle;
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
