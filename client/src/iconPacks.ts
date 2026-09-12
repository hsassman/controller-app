// Purely cosmetic label substitution for the four face buttons. The wire
// protocol always sends A/B/X/Y (see protocol/frame.ts) -- a pack changes
// only what is drawn on the control, for players who think in a different
// controller's glyphs than Xbox's.

import { ButtonBit } from "../../protocol/frame.ts";

export type IconPackId = "letters" | "playstation" | "dots";

export const ICON_PACKS: { id: IconPackId; name: string }[] = [
  { id: "letters", name: "Letters" },
  { id: "playstation", name: "PlayStation glyphs" },
  { id: "dots", name: "Plain dots" },
];

/// The stock label for each face-button bit, i.e. what a control's `label`
/// equals when nobody has renamed it. Used to decide whether a custom label
/// should be respected instead of overridden by the active pack -- see
/// `displayLabel`.
const DEFAULT_FACE_LABEL: Partial<Record<number, string>> = {
  [ButtonBit.A]: "A",
  [ButtonBit.B]: "B",
  [ButtonBit.X]: "X",
  [ButtonBit.Y]: "Y",
};

const GLYPHS: Record<Exclude<IconPackId, "letters">, Partial<Record<number, string>>> = {
  // Xbox and PlayStation assign face buttons to the same physical
  // positions in the opposite mapping (bottom/right/left/top): PS's
  // cross/circle/square/triangle land on Xbox's A/B/X/Y respectively.
  playstation: {
    [ButtonBit.A]: "✕",
    [ButtonBit.B]: "○",
    [ButtonBit.X]: "□",
    [ButtonBit.Y]: "△",
  },
  dots: {
    [ButtonBit.A]: "●",
    [ButtonBit.B]: "●",
    [ButtonBit.X]: "●",
    [ButtonBit.Y]: "●",
  },
};

/// What to actually draw on a button. A pack only ever replaces a label that
/// still equals the plain stock letter for its bit -- the moment a player
/// types their own text into a control (via the inspector's Label field),
/// that text is respected verbatim and the pack leaves it alone.
export function displayLabel(bit: number, label: string, pack: IconPackId): string {
  if (pack === "letters") return label;
  if (DEFAULT_FACE_LABEL[bit] !== label) return label;
  return GLYPHS[pack][bit] ?? label;
}
