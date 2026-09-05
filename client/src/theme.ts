export type ThemeId =
  | "midnight"
  | "carbon"
  | "nebula"
  | "sunset"
  | "mint"
  | "aurora"
  | "crimson"
  | "mono";

/// How the moulded surface of every control catches light. Purely visual;
/// the geometry and hit areas are identical across all four.
export type ButtonMaterial = "matte" | "gloss" | "metal" | "neon";

/// The d-pad's silhouette. All three report the same eight directions.
export type DpadStyle = "cross" | "split" | "disc";

export const BUTTON_MATERIALS: { id: ButtonMaterial; name: string }[] = [
  { id: "matte", name: "Matte" },
  { id: "gloss", name: "Gloss" },
  { id: "metal", name: "Metal" },
  { id: "neon", name: "Neon" },
];

export const DPAD_STYLES: { id: DpadStyle; name: string }[] = [
  { id: "cross", name: "Cross" },
  { id: "split", name: "Split" },
  { id: "disc", name: "Disc" },
];

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
  { id: "aurora", name: "Aurora", accent: "#2fe0c8", swatch: ["#04161a", "#2fe0c8"] },
  { id: "crimson", name: "Crimson", accent: "#ff5d6e", swatch: ["#170709", "#ff5d6e"] },
  { id: "mono", name: "Mono", accent: "#d7d9de", swatch: ["#0c0c0d", "#d7d9de"] },
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

function contrastRatio(a: number, b: number): number {
  const hi = Math.max(a, b);
  const lo = Math.min(a, b);
  return (hi + 0.05) / (lo + 0.05);
}

/// The theme's panel colour, read back from the stylesheet so this tracks
/// whatever the active `[data-theme]` block declares instead of duplicating
/// the palette here. Every theme states it as a plain hex; anything else
/// (a gradient, an empty string before the sheet has loaded) falls back to
/// the default panel so the clamp below still has something to work with.
function panelBackground(): Rgb {
  const raw = getComputedStyle(document.documentElement).getPropertyValue("--panel-bg").trim();
  return /^#[0-9a-f]{6}$/i.test(raw) ? parseHex(raw) : { r: 26, g: 29, b: 36 };
}

/// The accent is also used as *label* colour on panels, where a very dark
/// custom accent is unreadable -- and, being saved, stays unreadable across
/// restarts. Nudge only its lightness, toward white on dark panels and black
/// on light ones, until it clears WCAG AA 4.5:1, so the hue the user picked
/// survives. Callers use this as `--accent-text`, never as `--accent`: the
/// borders and fills that also read from the accent are unaffected by
/// contrast and would lose the chosen colour for nothing.
function readableOn(base: Rgb, bg: Rgb): Rgb {
  const target = luminance(bg) < 0.5 ? WHITE : BLACK;
  const ok = (c: Rgb) => contrastRatio(luminance(c), luminance(bg)) >= 4.5;
  if (ok(base)) return base;
  // Mixing toward a fixed endpoint moves luminance monotonically, so the
  // smallest sufficient mix can be bisected rather than stepped.
  let lo = 0;
  let hi = 1;
  for (let i = 0; i < 12; i++) {
    const mid = (lo + hi) / 2;
    if (ok(mix(base, target, mid))) hi = mid;
    else lo = mid;
  }
  return mix(base, target, hi);
}

export function applyAccent(hex: string, highContrast: boolean): void {
  const root = document.documentElement;
  const tokens = [
    "--accent",
    "--accent-rgb",
    "--accent-active",
    "--accent-fg",
    "--accent-text",
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
  root.style.setProperty("--accent-text", toHex(readableOn(base, panelBackground())));
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

/// ---- Idle dim ----
///
/// Lives here rather than in the settings panel because it has to watch real
/// input, which outlives the panel: the panel is closed almost all the time
/// the timer matters. Ownership of the listeners stays in this module so
/// re-applying settings (which happens on every slider drag) can never stack
/// a second timer or a second listener pair.

let idleTimer: number | null = null;
let idleSeconds = 0;
let idleListening = false;
let lastWake = 0;

const wake = (): void => {
  document.documentElement.classList.remove("idle-dim");
  const now = Date.now();
  // A stick drag fires pointermove every frame; re-arming the timeout each
  // time is pure churn when the timeout is measured in seconds.
  if (idleTimer !== null && now - lastWake < 1000) return;
  lastWake = now;
  if (idleTimer !== null) clearTimeout(idleTimer);
  idleTimer = window.setTimeout(() => {
    idleTimer = null;
    document.documentElement.classList.add("idle-dim");
  }, idleSeconds * 1000);
};

/// Fades the controls out after `seconds` without input; any touch or key
/// brings them straight back. Safe to call repeatedly -- a second call just
/// retimes the existing one.
export function startIdleDim(seconds: number): void {
  if (!Number.isFinite(seconds) || seconds <= 0) {
    stopIdleDim();
    return;
  }
  idleSeconds = seconds;
  if (!idleListening) {
    // Capture phase: the controls call stopPropagation on their own pointer
    // events, so a bubble-phase listener here would never see a button press
    // and the screen would dim mid-game.
    window.addEventListener("pointerdown", wake, { capture: true, passive: true });
    window.addEventListener("pointermove", wake, { capture: true, passive: true });
    window.addEventListener("keydown", wake, { capture: true });
    idleListening = true;
  }
  // Force a re-arm even inside the throttle window: the timeout length may
  // have just changed.
  lastWake = 0;
  wake();
}

export function stopIdleDim(): void {
  if (idleTimer !== null) {
    clearTimeout(idleTimer);
    idleTimer = null;
  }
  if (idleListening) {
    window.removeEventListener("pointerdown", wake, { capture: true });
    window.removeEventListener("pointermove", wake, { capture: true });
    window.removeEventListener("keydown", wake, { capture: true });
    idleListening = false;
  }
  document.documentElement.classList.remove("idle-dim");
}

export function applyAppearance(s: {
  theme: ThemeId;
  accent: string;
  highContrast: boolean;
  controlOpacity: number;
  reduceMotion: boolean;
  surfaceGlow: boolean;
  buttonMaterial: ButtonMaterial;
  dpadStyle: DpadStyle;
  glowIntensity: number;
  idleDimSeconds: number;
}): void {
  const root = document.documentElement;
  applyTheme(s.theme);
  applyAccent(s.accent, s.highContrast);
  root.style.setProperty("--control-opacity", String(s.controlOpacity));
  root.classList.toggle("reduce-motion", s.reduceMotion);
  root.classList.toggle("no-surface-glow", !s.surfaceGlow);

  // Re-validated here as well as in sanitize(): this is the last point before
  // the value reaches the DOM, and an unknown id would leave every material
  // rule unmatched rather than falling back to the default look.
  root.dataset.material = BUTTON_MATERIALS.some((m) => m.id === s.buttonMaterial)
    ? s.buttonMaterial
    : "gloss";
  root.dataset.dpadStyle = DPAD_STYLES.some((d) => d.id === s.dpadStyle) ? s.dpadStyle : "cross";

  const glow = Number.isFinite(s.glowIntensity) ? Math.min(1.5, Math.max(0, s.glowIntensity)) : 1;
  root.style.setProperty("--glow-intensity", String(glow));

  startIdleDim(s.idleDimSeconds);
}
