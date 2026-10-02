// Drawn symbols for buttons whose legend is a shape, not a letter.
//
// Font glyphs for ✕ ○ □ △ come out small, thin and at a different size on
// every phone; real PlayStation buttons carry bold geometric outlines. The
// same goes for the Guide button's symbol. These are SVG drawn in the
// button's own text colour (currentColor), so face colours, legend styles,
// hidden labels and high contrast all keep working on them.

const shape = (cls: string, body: string) =>
  `<svg class="${cls}" viewBox="0 0 24 24" aria-hidden="true" focusable="false" fill="none" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round">${body}</svg>`;

/// The PlayStation face symbols, keyed by the character used as a label.
const FACE_SHAPES: Record<string, string> = {
  "✕": shape("face-shape", `<path d="M5.5 5.5l13 13M18.5 5.5l-13 13"/>`),
  "○": shape("face-shape", `<circle cx="12" cy="12" r="7.4"/>`),
  "□": shape("face-shape", `<rect x="5.2" y="5.2" width="13.6" height="13.6" rx="0.6"/>`),
  "△": shape("face-shape", `<path d="M12 4.3L20.2 18.6H3.8Z"/>`),
};

/// SVG for a face label that is one of the shape symbols, else null.
export function faceShapeSvg(label: string): string | null {
  return FACE_SHAPES[label.trim()] ?? null;
}

export type GuideStyle = "auto" | "orb" | "power" | "home" | "dot";

export const GUIDE_STYLES: { id: GuideStyle; name: string }[] = [
  { id: "auto", name: "Controller's own" },
  { id: "orb", name: "Orb" },
  { id: "power", name: "Power" },
  { id: "home", name: "Home" },
  { id: "dot", name: "Dot" },
];

const GUIDE_ICONS: Record<Exclude<GuideStyle, "auto">, string> = {
  // A sphere crossed by two swept bands, in the spirit of the Xbox orb.
  orb: shape(
    "guide-icon",
    `<circle cx="12" cy="12" r="9.2" stroke-width="1.9"/><path d="M6.6 6.9C9.6 8.6 14.4 15.4 17.4 17.1M17.4 6.9C14.4 8.6 9.6 15.4 6.6 17.1" stroke-width="2.5"/>`,
  ),
  power: shape("guide-icon", `<path d="M12 3.5v8" stroke-width="2.4"/><path d="M6.6 6.8a7.6 7.6 0 1 0 10.8 0" stroke-width="2.4"/>`),
  home: shape("guide-icon", `<path d="M4 11.2L12 4.3l8 6.9" stroke-width="2.3"/><path d="M6.6 9.6v9.6h10.8V9.6" stroke-width="2.3"/>`),
  dot: `<svg class="guide-icon" viewBox="0 0 24 24" aria-hidden="true" focusable="false"><circle cx="12" cy="12" r="5.2" fill="currentColor"/></svg>`,
};

/// The Guide button's drawn symbol for `style`, given its layout label.
/// "auto" draws the orb in place of the stock "⊗" and otherwise keeps the
/// layout's own legend ("PS", "⌂"...): null means "draw the label as text".
export function guideIconSvg(style: GuideStyle, label: string): string | null {
  if (style === "auto") return label.trim() === "⊗" ? GUIDE_ICONS.orb : null;
  return GUIDE_ICONS[style] ?? null;
}
