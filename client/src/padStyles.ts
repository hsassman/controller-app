// Whole-controller styles: the layout *and* the look of a real pad. Picking
// one gives you a profile laid out like that controller -- stick and d-pad
// positions, button names and glyphs, d-pad shape and face colours -- while
// the PC still sees an Xbox 360 pad, so every game works the same.
//
// Buttons are mapped by *position*, the way Steam and every XInput wrapper
// map other pads: the bottom face button always sends A, whatever is
// printed on it (✕ on PlayStation, B on Nintendo).

import type { ButtonConfig, ControlConfig, Layout } from "./layout.ts";
import type { Settings } from "./settings.ts";
import { ButtonBit } from "../../protocol/frame.ts";

export type PadStyleId = "xbox360" | "xboxseries" | "playstation" | "nintendo";

export interface PadStyle {
  id: PadStyleId;
  name: string;
  description: string;
  layout: () => Layout;
  /// The look that comes with it. Only the parts that define the controller;
  /// colour, finish and theme stay the player's own.
  look: Pick<Settings, "padStyle" | "dpadStyle" | "faceStyle" | "iconPack" | "stickStyle" | "triggerStyle">;
}

function button(
  id: string,
  label: string,
  bit: number,
  x: number,
  y: number,
  size: number,
  extra: Partial<ButtonConfig> = {},
): ButtonConfig {
  return { id, type: "button", label, bit, x, y, size, toggle: false, ...extra };
}

interface Names {
  a: string;
  b: string;
  x: string;
  y: string;
  lb: string;
  rb: string;
  lt: string;
  rt: string;
  back: string;
  start: string;
  guide: string;
}

/// Where the system buttons sit differs between the offset-stick pads:
/// Xbox has small round Back/Start flanking a big Guide; Nintendo has
/// -/+ up high and a smaller Home below +.
type CentreCluster = "xbox" | "nintendo";

/// The offset-stick layout shared by Xbox and Nintendo pads: left stick high
/// on the left at the same height as the face buttons, d-pad below and
/// inboard of it, right stick mirrored below the face buttons, and the
/// system buttons across the middle. Proportions follow the real pads: a
/// face diamond ~1.35 button-widths across, sticks about twice a face
/// button, bumpers spanning the shoulder above each grip.
function offsetLayout(id: string, name: string, n: Names, centre: CentreCluster = "xbox"): Layout {
  const system: ControlConfig[] =
    centre === "xbox"
      ? [
          button("select", n.back, ButtonBit.SELECT, 41, 41, 34),
          button("guide", n.guide, ButtonBit.GUIDE, 50, 31, 52),
          button("start", n.start, ButtonBit.START, 59, 41, 34),
        ]
      : [
          button("select", n.back, ButtonBit.SELECT, 40, 25, 32),
          button("start", n.start, ButtonBit.START, 60, 25, 32),
          button("guide", n.guide, ButtonBit.GUIDE, 56.5, 44, 36),
        ];
  const controls: ControlConfig[] = [
    { id: "lt", type: "trigger", label: n.lt, x: 7, y: 17, width: 52, height: 62, trigger: "left" },
    button("lb", n.lb, ButtonBit.L1, 21.5, 8, 32, { width: 92, height: 32, shape: "pill" }),
    button("rb", n.rb, ButtonBit.R1, 78.5, 8, 32, { width: 92, height: 32, shape: "pill" }),
    { id: "rt", type: "trigger", label: n.rt, x: 93, y: 17, width: 52, height: 62, trigger: "right" },
    { id: "left-stick", type: "stick", label: "Left stick", x: 20, y: 49, size: 106, clickBit: ButtonBit.L3, stick: "left" },
    { id: "dpad", type: "dpad", x: 36, y: 78, size: 96 },
    ...system,
    { id: "right-stick", type: "stick", label: "Right stick", x: 64, y: 78, size: 100, clickBit: ButtonBit.R3, stick: "right" },
    button("face-y", n.y, ButtonBit.Y, 82.5, 31, 46),
    button("face-x", n.x, ButtonBit.X, 75.5, 47, 46),
    button("face-b", n.b, ButtonBit.B, 89.5, 47, 46),
    button("face-a", n.a, ButtonBit.A, 82.5, 63, 46),
  ];
  return { id, name, controls };
}

/// PlayStation: sticks side by side at the bottom, d-pad and face buttons
/// level across the top, and the touchpad between them.
function playstationLayout(): Layout {
  const controls: ControlConfig[] = [
    { id: "lt", type: "trigger", label: "L2", x: 7, y: 15, width: 50, height: 52, trigger: "left" },
    button("lb", "L1", ButtonBit.L1, 20, 9, 34, { width: 78, height: 34, shape: "pill" }),
    button("rb", "R1", ButtonBit.R1, 80, 9, 34, { width: 78, height: 34, shape: "pill" }),
    { id: "rt", type: "trigger", label: "R2", x: 93, y: 15, width: 50, height: 52, trigger: "right" },
    { id: "dpad", type: "dpad", x: 16, y: 50, size: 106 },
    button("select", "Create", ButtonBit.SELECT, 29.5, 21, 24, { width: 52, height: 24, shape: "pill" }),
    // The touchpad's click is the closest thing to a Back button a game sees.
    button("touchpad", "", ButtonBit.SELECT, 50, 22, 72, { width: 176, height: 72, shape: "square" }),
    button("start", "Options", ButtonBit.START, 70.5, 21, 24, { width: 52, height: 24, shape: "pill" }),
    button("guide", "PS", ButtonBit.GUIDE, 50, 53, 34),
    { id: "left-stick", type: "stick", label: "Left stick", x: 35, y: 78, size: 96, clickBit: ButtonBit.L3, stick: "left" },
    { id: "right-stick", type: "stick", label: "Right stick", x: 65, y: 78, size: 96, clickBit: ButtonBit.R3, stick: "right" },
    button("face-y", "△", ButtonBit.Y, 84, 32, 46),
    button("face-x", "□", ButtonBit.X, 76.5, 51, 46),
    button("face-b", "○", ButtonBit.B, 91.5, 51, 46),
    button("face-a", "✕", ButtonBit.A, 84, 70, 46),
  ];
  return { id: "playstation", name: "PlayStation", controls };
}

const XBOX: Names = {
  a: "A",
  b: "B",
  x: "X",
  y: "Y",
  lb: "LB",
  rb: "RB",
  lt: "LT",
  rt: "RT",
  back: "◀",
  start: "▶",
  guide: "⊗",
};

export const PAD_STYLES: PadStyle[] = [
  {
    id: "xbox360",
    name: "Xbox 360",
    description: "Offset sticks, the classic cross d-pad, coloured A/B/X/Y and the ring of light.",
    layout: () => offsetLayout("xbox360", "Xbox 360", XBOX),
    look: { padStyle: "xbox360", dpadStyle: "cross", faceStyle: "jewel", iconPack: "letters", stickStyle: "concave", triggerStyle: "paddle" },
  },
  {
    id: "xboxseries",
    name: "Xbox Series",
    description: "Offset sticks with the faceted hybrid d-pad and View / Menu buttons.",
    layout: () => offsetLayout("xboxseries", "Xbox Series", { ...XBOX, back: "⧉", start: "≡" }),
    look: { padStyle: "xboxseries", dpadStyle: "faceted", faceStyle: "classic", iconPack: "letters", stickStyle: "ringed", triggerStyle: "curved" },
  },
  {
    id: "playstation",
    name: "PlayStation",
    description: "Symmetric sticks, split d-pad, touchpad, and △ ○ ✕ □ in their own colours.",
    layout: playstationLayout,
    look: { padStyle: "playstation", dpadStyle: "split", faceStyle: "classic", iconPack: "letters", stickStyle: "dome", triggerStyle: "rounded" },
  },
  {
    id: "nintendo",
    name: "Nintendo",
    description: "Pro Controller layout: B/A/Y/X by position, ZL/ZR, − / + and Home.",
    layout: () =>
      offsetLayout("nintendo", "Nintendo", {
        a: "B",
        b: "A",
        x: "Y",
        y: "X",
        lb: "L",
        rb: "R",
        lt: "ZL",
        rt: "ZR",
        back: "−",
        start: "+",
        guide: "⌂",
      }, "nintendo"),
    look: { padStyle: "nintendo", dpadStyle: "cross", faceStyle: "mono", iconPack: "letters", stickStyle: "flat", triggerStyle: "flat" },
  },
];

export const PAD_STYLE_IDS = PAD_STYLES.map((s) => s.id);

export function padStyleById(id: string): PadStyle | undefined {
  return PAD_STYLES.find((s) => s.id === id);
}
