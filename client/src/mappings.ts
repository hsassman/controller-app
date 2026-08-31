import { ButtonBit } from "../../protocol/frame.ts";

export interface ButtonMapping {
  bit: number;
  /// Short form drawn on the control itself.
  label: string;
  /// Long form used in menus and screen-reader labels.
  name: string;
  group: "Face" | "Shoulder" | "D-pad" | "Stick" | "System";
}

export const BUTTON_MAPPINGS: ButtonMapping[] = [
  { bit: ButtonBit.A, label: "A", name: "A", group: "Face" },
  { bit: ButtonBit.B, label: "B", name: "B", group: "Face" },
  { bit: ButtonBit.X, label: "X", name: "X", group: "Face" },
  { bit: ButtonBit.Y, label: "Y", name: "Y", group: "Face" },
  { bit: ButtonBit.L1, label: "LB", name: "Left bumper (LB)", group: "Shoulder" },
  { bit: ButtonBit.R1, label: "RB", name: "Right bumper (RB)", group: "Shoulder" },
  { bit: ButtonBit.L3, label: "L3", name: "Left stick click (L3)", group: "Stick" },
  { bit: ButtonBit.R3, label: "R3", name: "Right stick click (R3)", group: "Stick" },
  { bit: ButtonBit.DPAD_UP, label: "↑", name: "D-pad up", group: "D-pad" },
  { bit: ButtonBit.DPAD_DOWN, label: "↓", name: "D-pad down", group: "D-pad" },
  { bit: ButtonBit.DPAD_LEFT, label: "←", name: "D-pad left", group: "D-pad" },
  { bit: ButtonBit.DPAD_RIGHT, label: "→", name: "D-pad right", group: "D-pad" },
  { bit: ButtonBit.START, label: "Start", name: "Start", group: "System" },
  { bit: ButtonBit.SELECT, label: "Select", name: "Select / Back", group: "System" },
];

export function mappingFor(bit: number): ButtonMapping | undefined {
  return BUTTON_MAPPINGS.find((m) => m.bit === bit);
}

export function mappingName(bit: number): string {
  return mappingFor(bit)?.name ?? `Button ${bit}`;
}

/// Grouped for rendering an <optgroup>-style picker without the caller
/// having to know the group ordering.
export function groupedMappings(): { group: string; items: ButtonMapping[] }[] {
  const order: ButtonMapping["group"][] = ["Face", "Shoulder", "D-pad", "Stick", "System"];
  return order.map((group) => ({ group, items: BUTTON_MAPPINGS.filter((m) => m.group === group) }));
}
