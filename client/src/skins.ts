// Named, savable bundles of "Look" settings -- theme, accent, material,
// d-pad style and glow -- kept separate from profiles (which are layouts).
// A profile is *what controls exist and where*; a skin is *what they look
// like*. Keeping them apart means switching a look never disturbs a
// hand-built layout, and a favourite look can be applied to any profile.

import type { Settings } from "./settings.ts";
import type { ButtonMaterial, DpadStyle, ThemeId } from "./theme.ts";
import { BUTTON_MATERIALS, DPAD_STYLES, THEMES } from "./theme.ts";
import type { IconPackId } from "./iconPacks.ts";
import { ICON_PACKS } from "./iconPacks.ts";

const STORE_KEY = "controller-skins-v1";

export interface Skin {
  id: string;
  name: string;
  theme: ThemeId;
  accent: string;
  buttonMaterial: ButtonMaterial;
  dpadStyle: DpadStyle;
  glowIntensity: number;
  iconPack: IconPackId;
}

/// The subset of Settings a skin captures. Everything else (dead zone,
/// haptics, editor grid, ...) is feel/behaviour, not look, and stays with
/// the device rather than travelling with a saved skin.
export type SkinAppearance = Pick<
  Settings,
  "theme" | "accent" | "buttonMaterial" | "dpadStyle" | "glowIntensity" | "iconPack"
>;

function readSkins(): Skin[] {
  try {
    const raw = localStorage.getItem(STORE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed)) return [];
    return parsed.filter(isValidSkin);
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
    ICON_PACKS.some((p) => p.id === s.iconPack)
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

/// A random combination for a "Remix" button -- a one-tap way to land on a
/// look nobody had to hand-tune. Excludes glow=0, which reads as "broken"
/// rather than "a choice".
export function randomAppearance(): SkinAppearance {
  const theme = THEMES[Math.floor(Math.random() * THEMES.length)];
  const material = BUTTON_MATERIALS[Math.floor(Math.random() * BUTTON_MATERIALS.length)];
  const dpad = DPAD_STYLES[Math.floor(Math.random() * DPAD_STYLES.length)];
  return {
    theme: theme.id,
    accent: theme.accent,
    buttonMaterial: material.id,
    dpadStyle: dpad.id,
    glowIntensity: Math.round((0.6 + Math.random() * 0.9) * 20) / 20,
    iconPack: "letters",
  };
}
