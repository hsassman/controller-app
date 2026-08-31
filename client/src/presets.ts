import type { ButtonConfig, ControlConfig, Layout } from "./layout.ts";
import { defaultLayout } from "./layout.ts";
import { ButtonBit } from "../../protocol/frame.ts";

export interface PresetMeta {
  id: string;
  name: string;
  description: string;
  build: () => Layout;
}

export function mirrorLayout(layout: Layout): Layout {
  return {
    ...layout,
    controls: layout.controls.map((c) => ({ ...c, x: 100 - c.x })),
  };
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

function fps(): Layout {
  // Aim and movement get the largest targets; the face cluster shrinks and
  // tucks in, because in a shooter it is pressed far less often than the
  // sticks and triggers are held.
  const controls: ControlConfig[] = [
    { id: "lt", type: "trigger", label: "LT", x: 6, y: 20, width: 46, height: 74, trigger: "left" },
    { id: "rt", type: "trigger", label: "RT", x: 94, y: 20, width: 46, height: 74, trigger: "right" },
    button("lb", "LB", ButtonBit.L1, 17, 12, 44),
    button("rb", "RB", ButtonBit.R1, 83, 12, 44),
    { id: "left-stick", type: "stick", label: "Left stick", x: 22, y: 70, size: 122, clickBit: ButtonBit.L3, stick: "left" },
    { id: "right-stick", type: "stick", label: "Right stick", x: 78, y: 70, size: 122, clickBit: ButtonBit.R3, stick: "right" },
    button("face-a", "A", ButtonBit.A, 52, 84, 44),
    button("face-b", "B", ButtonBit.B, 62, 70, 44),
    button("face-x", "X", ButtonBit.X, 42, 70, 44),
    button("face-y", "Y", ButtonBit.Y, 52, 56, 44),
    button("start", "Start", ButtonBit.START, 58, 8, 32, { width: 58, height: 32, shape: "pill" }),
    button("select", "Select", ButtonBit.SELECT, 42, 8, 32, { width: 58, height: 32, shape: "pill" }),
  ];
  return { id: "fps", name: "Shooter", controls };
}

function racing(): Layout {
  // Full-height triggers under each index finger, steering on the left
  // stick, and a d-pad kept only for menus.
  const controls: ControlConfig[] = [
    { id: "lt", type: "trigger", label: "Brake", x: 8, y: 50, width: 62, height: 150, trigger: "left" },
    { id: "rt", type: "trigger", label: "Gas", x: 92, y: 50, width: 62, height: 150, trigger: "right" },
    { id: "left-stick", type: "stick", label: "Steering", x: 30, y: 66, size: 132, clickBit: ButtonBit.L3, stick: "left" },
    button("face-a", "A", ButtonBit.A, 62, 78, 46),
    button("face-b", "B", ButtonBit.B, 72, 62, 46),
    button("face-x", "X", ButtonBit.X, 52, 62, 46),
    button("lb", "LB", ButtonBit.L1, 62, 20, 42),
    button("rb", "RB", ButtonBit.R1, 74, 20, 42),
    { id: "dpad", type: "dpad", x: 40, y: 26, size: 78 },
    button("start", "Start", ButtonBit.START, 52, 8, 30, { width: 56, height: 30, shape: "pill" }),
  ];
  return { id: "racing", name: "Racing", controls };
}

function platformer(): Layout {
  // D-pad-first: precise digital movement on the left, a compact action
  // cluster on the right, no analog sticks competing for thumb space.
  const controls: ControlConfig[] = [
    { id: "dpad", type: "dpad", x: 18, y: 66, size: 150 },
    button("face-a", "A", ButtonBit.A, 78, 78, 54),
    button("face-b", "B", ButtonBit.B, 90, 62, 54),
    button("face-x", "X", ButtonBit.X, 66, 62, 54),
    button("face-y", "Y", ButtonBit.Y, 78, 46, 54),
    button("lb", "LB", ButtonBit.L1, 10, 12, 44),
    button("rb", "RB", ButtonBit.R1, 90, 12, 44),
    { id: "lt", type: "trigger", label: "LT", x: 22, y: 14, width: 44, height: 44, trigger: "left" },
    { id: "rt", type: "trigger", label: "RT", x: 78, y: 14, width: 44, height: 44, trigger: "right" },
    button("start", "Start", ButtonBit.START, 56, 8, 30, { width: 56, height: 30, shape: "pill" }),
    button("select", "Select", ButtonBit.SELECT, 44, 8, 30, { width: 56, height: 30, shape: "pill" }),
  ];
  return { id: "platformer", name: "Platformer", controls };
}

function largeTargets(): Layout {
  // Fewer, much bigger controls with generous separation, for reduced fine
  // 2.2's target size by a wide margin even at MIN_SCALE.
  const controls: ControlConfig[] = [
    { id: "dpad", type: "dpad", x: 20, y: 62, size: 168 },
    { id: "left-stick", type: "stick", label: "Left stick", x: 50, y: 66, size: 140, clickBit: ButtonBit.L3, stick: "left" },
    button("face-a", "A", ButtonBit.A, 76, 72, 84),
    button("face-b", "B", ButtonBit.B, 92, 72, 84),
    button("lb", "LB", ButtonBit.L1, 12, 14, 62),
    button("rb", "RB", ButtonBit.R1, 88, 14, 62),
    button("start", "Start", ButtonBit.START, 50, 14, 44, { width: 96, height: 44, shape: "pill" }),
  ];
  return { id: "large", name: "Large targets", controls };
}

function minimal(): Layout {
  const controls: ControlConfig[] = [
    { id: "dpad", type: "dpad", x: 18, y: 68, size: 130 },
    button("face-a", "A", ButtonBit.A, 84, 74, 66),
    button("face-b", "B", ButtonBit.B, 66, 62, 66),
    button("start", "Start", ButtonBit.START, 50, 10, 34, { width: 70, height: 34, shape: "pill" }),
  ];
  return { id: "minimal", name: "Minimal", controls };
}

export const PRESETS: PresetMeta[] = [
  {
    id: "default",
    name: "Standard",
    description: "Full Xbox-style pad: both sticks, d-pad, four face buttons, bumpers and triggers.",
    build: defaultLayout,
  },
  {
    id: "fps",
    name: "Shooter",
    description: "Oversized sticks and tall triggers; the face cluster moves inboard.",
    build: fps,
  },
  {
    id: "racing",
    name: "Racing",
    description: "Full-height gas and brake triggers with a wide steering stick.",
    build: racing,
  },
  {
    id: "platformer",
    name: "Platformer",
    description: "Large d-pad instead of an analog stick, with a close action cluster.",
    build: platformer,
  },
  {
    id: "large",
    name: "Large targets",
    description: "Fewer, much bigger, widely spaced controls for reduced fine motor control.",
    build: largeTargets,
  },
  {
    id: "minimal",
    name: "Minimal",
    description: "D-pad and two buttons — for simple or retro games.",
    build: minimal,
  },
  {
    id: "left-handed",
    name: "Left-handed",
    description: "The standard layout mirrored, so the action cluster sits under the left thumb.",
    build: () => ({ ...mirrorLayout(defaultLayout()), id: "left-handed", name: "Left-handed" }),
  },
];
