// Named, savable bundles of "Look" settings -- theme, accent, material,
// d-pad style and glow -- kept separate from profiles (which are layouts).
// A profile is *what controls exist and where*; a skin is *what they look
// like*. Keeping them apart means switching a look never disturbs a
// hand-built layout, and a favourite look can be applied to any profile.

import type { Settings } from "./settings.ts";
import { defaults } from "./settings.ts";
import {
  BUTTON_MATERIALS,
  DPAD_STYLES,
  FACE_STYLES,
  LABEL_STYLES,
  SHELL_PRESETS,
  STICK_COLORS,
  STICK_STYLES,
  SURFACE_STYLES,
  THEMES,
} from "./theme.ts";
import { ICON_PACKS } from "./iconPacks.ts";

const STORE_KEY = "controller-skins-v1";

/// The subset of Settings a skin captures. Everything else (dead zone,
/// haptics, editor grid, ...) is feel/behaviour, not look, and stays with
/// the device rather than travelling with a saved skin.
export const SKIN_KEYS = [
  "theme",
  "accent",
  "buttonMaterial",
  "dpadStyle",
  "glowIntensity",
  "iconPack",
  "shellColor",
  "faceStyle",
  "stickStyle",
  "stickColor",
  "labelStyle",
  "surfaceStyle",
] as const;

export type SkinAppearance = Pick<Settings, (typeof SKIN_KEYS)[number]>;

export interface Skin extends SkinAppearance {
  id: string;
  name: string;
}

/// The look-related part of `settings`, for saving as a skin.
export function appearanceOf(settings: Settings): SkinAppearance {
  const out = {} as Record<string, unknown>;
  for (const key of SKIN_KEYS) out[key] = settings[key];
  return out as SkinAppearance;
}

/// Whether `settings` currently looks exactly like `skin`.
export function matchesSkin(settings: Settings, skin: SkinAppearance): boolean {
  return SKIN_KEYS.every((key) => {
    const a = settings[key];
    const b = skin[key];
    return typeof a === "string" && typeof b === "string" ? a.toLowerCase() === b.toLowerCase() : a === b;
  });
}

function readSkins(): Skin[] {
  try {
    const raw = localStorage.getItem(STORE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed)) return [];
    // Skins saved before a look option existed are topped up with its
    // default, so an old favourite still applies instead of being dropped.
    const d = defaults();
    return parsed
      .map((v) => (v && typeof v === "object" ? { ...appearanceOf(d), ...(v as object) } : v))
      .filter(isValidSkin);
  } catch {
    return [];
  }
}

function isValidSkin(v: unknown): v is Skin {
  if (!v || typeof v !== "object") return false;
  const s = v as Record<string, unknown>;
  return (
    typeof s.id === "string" &&
    typeof s.name === "string" &&
    THEMES.some((t) => t.id === s.theme) &&
    typeof s.accent === "string" &&
    BUTTON_MATERIALS.some((m) => m.id === s.buttonMaterial) &&
    DPAD_STYLES.some((d) => d.id === s.dpadStyle) &&
    typeof s.glowIntensity === "number" &&
    ICON_PACKS.some((p) => p.id === s.iconPack) &&
    typeof s.shellColor === "string" &&
    FACE_STYLES.some((p) => p.id === s.faceStyle) &&
    STICK_STYLES.some((p) => p.id === s.stickStyle) &&
    STICK_COLORS.some((p) => p.id === s.stickColor) &&
    LABEL_STYLES.some((p) => p.id === s.labelStyle) &&
    SURFACE_STYLES.some((p) => p.id === s.surfaceStyle)
  );
}

function writeSkins(skins: Skin[]): void {
  try {
    localStorage.setItem(STORE_KEY, JSON.stringify(skins));
  } catch {
    // localStorage unavailable -- the skin just won't survive a reload.
  }
}

export function listSkins(): Skin[] {
  return readSkins();
}

export function saveSkin(name: string, appearance: SkinAppearance): Skin {
  const skins = readSkins();
  const skin: Skin = { id: `skin-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`, name: name.trim() || "Untitled skin", ...appearance };
  skins.push(skin);
  writeSkins(skins);
  return skin;
}

export function deleteSkin(id: string): void {
  writeSkins(readSkins().filter((s) => s.id !== id));
}

const pick = <T>(list: readonly T[]): T => list[Math.floor(Math.random() * list.length)];

/// A random combination for a "Remix" button -- a one-tap way to land on a
/// look nobody had to hand-tune. Excludes glow=0, which reads as "broken"
/// rather than "a choice".
export function randomAppearance(): SkinAppearance {
  const theme = pick(THEMES);
  return {
    theme: theme.id,
    accent: theme.accent,
    buttonMaterial: pick(BUTTON_MATERIALS).id,
    dpadStyle: pick(DPAD_STYLES).id,
    glowIntensity: Math.round((0.6 + Math.random() * 0.9) * 20) / 20,
    iconPack: "letters",
    shellColor: pick(SHELL_PRESETS).value,
    faceStyle: pick(FACE_STYLES).id,
    stickStyle: pick(STICK_STYLES).id,
    stickColor: pick(STICK_COLORS).id,
    labelStyle: pick(LABEL_STYLES).id,
    surfaceStyle: Math.random() < 0.5 ? "shell" : "backdrop",
  };
}
