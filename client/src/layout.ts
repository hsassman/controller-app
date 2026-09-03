import { ButtonBit } from "../../protocol/frame.ts";

export interface ButtonConfig {
  id: string;
  type: "button";
  label: string;
  bit: number;
  x: number;
  y: number;
  /// Diameter for round buttons, and the fallback for `width`/`height`.
  size: number;
  width?: number;
  height?: number;
  shape?: "circle" | "pill" | "square";
  /// Per-control accent tint (hex). Drives the button's ring and its
  /// pressed fill, so a user can colour-code a custom layout the way the
  /// stock face buttons are coloured.
  tint?: string;
  toggle: boolean;
}

export interface DpadConfig {
  id: string;
  type: "dpad";
  x: number;
  y: number;
  size: number;
  tint?: string;
}

export interface StickConfig {
  id: string;
  type: "stick";
  label: string;
  x: number;
  y: number;
  size: number;
  clickBit: number;
  /// Per-stick dead zone override (fraction of the radius). When absent the
  /// global setting applies -- per-control overrides exist because a player
  /// often wants a large dead zone for movement and a tight one for aim.
  deadZone?: number;
  tint?: string;
  /// Which physical axis pair this drives. Must be explicit: inferring it
  /// from `id` broke as soon as the editor could create/duplicate controls
  /// (every new stick silently became the right stick).
  stick: "left" | "right";
}

export interface TriggerConfig {
  id: string;
  type: "trigger";
  label: string;
  x: number;
  y: number;
  width: number;
  height: number;
  tint?: string;
  /// Explicit for the same reason as StickConfig.stick.
  trigger: "left" | "right";
}

export type ControlConfig = ButtonConfig | DpadConfig | StickConfig | TriggerConfig;

export interface Layout {
  id: string;
  name: string;
  controls: ControlConfig[];
}

export function defaultLayout(): Layout {
  return {
    id: "default",
    name: "Default",
    controls: [
      { id: "lb", type: "button", label: "LB", bit: ButtonBit.L1, x: 7, y: 8, size: 42, toggle: false },
      { id: "rb", type: "button", label: "RB", bit: ButtonBit.R1, x: 93, y: 8, size: 42, toggle: false },
      { id: "lt", type: "trigger", label: "LT", x: 7, y: 26, width: 42, height: 42, trigger: "left" },
      { id: "rt", type: "trigger", label: "RT", x: 93, y: 26, width: 42, height: 42, trigger: "right" },
      { id: "select", type: "button", label: "Select", bit: ButtonBit.SELECT, x: 42, y: 6, size: 34, width: 62, height: 34, shape: "pill", toggle: false },
      { id: "start", type: "button", label: "Start", bit: ButtonBit.START, x: 58, y: 6, size: 34, width: 62, height: 34, shape: "pill", toggle: false },
      { id: "dpad", type: "dpad", x: 15, y: 68, size: 108 },
      { id: "left-stick", type: "stick", label: "Left stick", x: 33, y: 68, size: 98, clickBit: ButtonBit.L3, stick: "left" },
      { id: "right-stick", type: "stick", label: "Right stick", x: 64, y: 68, size: 90, clickBit: ButtonBit.R3, stick: "right" },
      { id: "face-x", type: "button", label: "X", bit: ButtonBit.X, x: 80, y: 64, size: 42, toggle: false },
      { id: "face-y", type: "button", label: "Y", bit: ButtonBit.Y, x: 87, y: 49, size: 42, toggle: false },
      { id: "face-b", type: "button", label: "B", bit: ButtonBit.B, x: 93, y: 64, size: 42, toggle: false },
      { id: "face-a", type: "button", label: "A", bit: ButtonBit.A, x: 87, y: 79, size: 42, toggle: false },
    ],
  };
}
