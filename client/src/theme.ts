export type ThemeId = "midnight" | "carbon" | "nebula" | "sunset" | "mint";

export interface ThemeMeta {
  id: ThemeId;
  name: string;
  /// Suggested accent, applied when the user picks the theme. They can
  /// still override it afterwards; this just makes each theme land looking
  /// intentional rather than inheriting the previous theme's accent.
  accent: string;
  /// Two colours for the theme's swatch in the settings panel.
  swatch: [string, string];
}

export const THEMES: ThemeMeta[] = [
  { id: "midnight", name: "Midnight", accent: "#4c8bff", swatch: ["#0d0f14", "#4c8bff"] },
  { id: "carbon", name: "Carbon", accent: "#e8e8ea", swatch: ["#0a0a0b", "#9a9aa2"] },
  { id: "nebula", name: "Nebula", accent: "#b57bff", swatch: ["#120d1c", "#b57bff"] },
  { id: "sunset", name: "Sunset", accent: "#ff8a4c", swatch: ["#1a0f0c", "#ff8a4c"] },
  { id: "mint", name: "Mint", accent: "#3fd9a4", swatch: ["#08150f", "#3fd9a4"] },
];

/// Accents offered as one-tap swatches. Free-form picking is also available
/// via the colour input; these are the ones checked to read well against
/// every theme background at the sizes the accent is actually used.
export const ACCENT_PRESETS = [
  "#4c8bff",
  "#3fd9a4",
  "#b57bff",
  "#ff8a4c",
  "#ff5c8a",
  "#ffc94a",
  "#4cd6ff",
  "#e8e8ea",
];

interface Rgb {
  r: number;
  g: number;
  b: number;
}

function parseHex(hex: string): Rgb {
  const m = /^#?([0-9a-f]{6})$/i.exec(hex.trim());
  // Fall back to the default accent rather than throwing: this runs on
  // every settings change, including while the user is mid-edit in a text
  // field, where a partial value like "#4c8" is expected and transient.
  const v = m ? parseInt(m[1], 16) : 0x4c8bff;
  return { r: (v >> 16) & 255, g: (v >> 8) & 255, b: v & 255 };
}

function toHex({ r, g, b }: Rgb): string {
  const c = (n: number) => Math.round(Math.min(255, Math.max(0, n))).toString(16).padStart(2, "0");
  return `#${c(r)}${c(g)}${c(b)}`;
}

function mix(a: Rgb, b: Rgb, t: number): Rgb {
  return { r: a.r + (b.r - a.r) * t, g: a.g + (b.g - a.g) * t, b: a.b + (b.b - a.b) * t };
}

/// Relative luminance per WCAG 2.1, used to decide whether text on top of
/// the accent should be near-black or near-white. A fixed foreground would
/// be unreadable for half the palette -- white on #ffc94a is ~1.7:1.
function luminance({ r, g, b }: Rgb): number {
  const ch = (v: number) => {
    const s = v / 255;
    return s <= 0.03928 ? s / 12.92 : Math.pow((s + 0.055) / 1.055, 2.4);
  };
  return 0.2126 * ch(r) + 0.7152 * ch(g) + 0.0722 * ch(b);
}

const BLACK: Rgb = { r: 0, g: 0, b: 0 };
const WHITE: Rgb = { r: 255, g: 255, b: 255 };

export function applyAccent(hex: string, highContrast: boolean): void {
  const root = document.documentElement;
  const tokens = [
    "--accent",
    "--accent-rgb",
    "--accent-active",
    "--accent-fg",
    "--control-active-bg",
    "--focus-ring",
    "--page-glow",
  ];

  if (highContrast) {
    // High contrast owns its own fixed yellow-on-black palette; a custom
    // accent there would reintroduce exactly the contrast problem the mode
    // exists to remove.
    for (const t of tokens) root.style.removeProperty(t);
    return;
  }

  const base = parseHex(hex);
  const rgb = `${Math.round(base.r)}, ${Math.round(base.g)}, ${Math.round(base.b)}`;
  const lighter = toHex(mix(base, WHITE, 0.28));
  const fg = luminance(base) > 0.45 ? toHex(mix(base, BLACK, 0.86)) : toHex(mix(base, BLACK, 0.9));

  root.style.setProperty("--accent", toHex(base));
  root.style.setProperty("--accent-rgb", rgb);
  root.style.setProperty("--accent-active", lighter);
  root.style.setProperty("--accent-fg", luminance(base) > 0.45 ? "#0b0b0d" : fg);
  root.style.setProperty(
    "--control-active-bg",
    `linear-gradient(180deg, rgba(${rgb}, 0.78), rgba(${rgb}, 0.55))`,
  );
  root.style.setProperty("--focus-ring", lighter);
  root.style.setProperty(
    "--page-glow",
    `radial-gradient(1100px 520px at 50% -14%, rgba(${rgb}, 0.14), transparent 68%),` +
      `radial-gradient(760px 420px at 6% 108%, rgba(${rgb}, 0.07), transparent 62%),` +
      `radial-gradient(760px 420px at 94% 108%, rgba(${rgb}, 0.07), transparent 62%)`,
  );
}

export function applyTheme(id: ThemeId): void {
  document.documentElement.dataset.theme = THEMES.some((t) => t.id === id) ? id : "midnight";
}

export function applyAppearance(s: {
  theme: ThemeId;
  accent: string;
  highContrast: boolean;
  controlOpacity: number;
  reduceMotion: boolean;
  surfaceGlow: boolean;
}): void {
  const root = document.documentElement;
  applyTheme(s.theme);
  applyAccent(s.accent, s.highContrast);
  root.style.setProperty("--control-opacity", String(s.controlOpacity));
  root.classList.toggle("reduce-motion", s.reduceMotion);
  root.classList.toggle("no-surface-glow", !s.surfaceGlow);
}
