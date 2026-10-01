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
  look: Pick<Settings, "padStyle" | "dpadStyle" | "faceStyle" | "iconPack">;
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

/// The offset-stick layout shared by Xbox and Nintendo pads: left stick high
/// on the left, d-pad below it, face buttons high on the right, right stick
/// below them, and the system buttons across the middle.
function offsetLayout(id: string, name: string, n: Names): Layout {
  const controls: ControlConfig[] = [
    { id: "lt", type: "trigger", label: n.lt, x: 7, y: 15, width: 50, height: 52, trigger: "left" },
    button("lb", n.lb, ButtonBit.L1, 21, 9, 34, { width: 82, height: 34, shape: "pill" }),
    button("rb", n.rb, ButtonBit.R1, 79, 9, 34, { width: 82, height: 34, shape: "pill" }),
    { id: "rt", type: "trigger", label: n.rt, x: 93, y: 15, width: 50, height: 52, trigger: "right" },
    { id: "left-stick", type: "stick", label: "Left stick", x: 19, y: 48, size: 104, clickBit: ButtonBit.L3, stick: "left" },
    { id: "dpad", type: "dpad", x: 36, y: 77, size: 98 },
    button("select", n.back, ButtonBit.SELECT, 40, 44, 30, { width: 54, height: 30, shape: "pill" }),
    button("guide", n.guide, ButtonBit.GUIDE, 50, 33, 50),
    button("start", n.start, ButtonBit.START, 60, 44, 30, { width: 54, height: 30, shape: "pill" }),
    { id: "right-stick", type: "stick", label: "Right stick", x: 64, y: 77, size: 98, clickBit: ButtonBit.R3, stick: "right" },
    button("face-y", n.y, ButtonBit.Y, 83, 29, 46),
    button("face-x", n.x, ButtonBit.X, 75.5, 48, 46),
    button("face-b", n.b, ButtonBit.B, 90.5, 48, 46),
    button("face-a", n.a, ButtonBit.A, 83, 67, 46),
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
    button("select", "Create", ButtonBit.SELECT, 31, 20, 26, { width: 58, height: 26, shape: "pill" }),
    // The touchpad's click is the closest thing to a Back button a game sees.
    button("touchpad", "Touchpad", ButtonBit.SELECT, 50, 21, 60, { width: 150, height: 60, shape: "square" }),
    button("start", "Options", ButtonBit.START, 69, 20, 26, { width: 58, height: 26, shape: "pill" }),
    button("guide", "PS", ButtonBit.GUIDE, 50, 52, 38),
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
  back: "Back",
  start: "Start",
  guide: "⊗",
};

export const PAD_STYLES: PadStyle[] = [
  {
    id: "xbox360",
    name: "Xbox 360",
    description: "Offset sticks, the classic cross d-pad, coloured A/B/X/Y and the ring of light.",
    layout: () => offsetLayout("xbox360", "Xbox 360", XBOX),
    look: { padStyle: "xbox360", dpadStyle: "cross", faceStyle: "jewel", iconPack: "letters" },
  },
  {
    id: "xboxseries",
    name: "Xbox Series",
    description: "Offset sticks with the faceted hybrid d-pad and View / Menu buttons.",
    layout: () => offsetLayout("xboxseries", "Xbox Series", { ...XBOX, back: "View", start: "Menu" }),
    look: { padStyle: "xboxseries", dpadStyle: "faceted", faceStyle: "classic", iconPack: "letters" },
  },
  {
    id: "playstation",
    name: "PlayStation",
    description: "Symmetric sticks, split d-pad, touchpad, and △ ○ ✕ □ in their own colours.",
    layout: playstationLayout,
    look: { padStyle: "playstation", dpadStyle: "split", faceStyle: "classic", iconPack: "letters" },
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
      }),
    look: { padStyle: "nintendo", dpadStyle: "cross", faceStyle: "mono", iconPack: "letters" },
  },
];

export const PAD_STYLE_IDS = PAD_STYLES.map((s) => s.id);

export function padStyleById(id: string): PadStyle | undefined {
  return PAD_STYLES.find((s) => s.id === id);
}
