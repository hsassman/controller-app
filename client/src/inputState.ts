// Mutable aggregate of every control's current value. Controls write into
// this via the setters; the send loop reads a snapshot at a fixed rate

import type { InputFrameData } from "../../protocol/frame.ts";

const buttonsHeld = new Set<number>();

const state: InputFrameData = {
  sequence: 0,
  buttons: 0,
  leftStickX: 0,
  leftStickY: 0,
  rightStickX: 0,
  rightStickY: 0,
  leftTrigger: 0,
  rightTrigger: 0,
};

export function setButton(bit: number, pressed: boolean): void {
  if (pressed) buttonsHeld.add(bit);
  else buttonsHeld.delete(bit);
}

export function isButtonHeld(bit: number): boolean {
  return buttonsHeld.has(bit);
}

export function setStick(which: "left" | "right", x: number, y: number): void {
  // x, y in [-1, 1]; scale to the full i16 wire range. The negative side
  // reaches one further than the positive side (-32768 vs 32767), same as a
  // real XInput pad -- scaling both by 32767 would leave full-left/full-down
  // one unit short of true full-scale deflection.
  const sx = scaleAxis(x);
  const sy = scaleAxis(y);
  if (which === "left") {
    state.leftStickX = sx;
    state.leftStickY = sy;
  } else {
    state.rightStickX = sx;
    state.rightStickY = sy;
  }
}

export function setTrigger(which: "left" | "right", value: number): void {
  const v = Math.round(clamp(value, 0, 1) * 255);
  if (which === "left") state.leftTrigger = v;
  else state.rightTrigger = v;
}

export function resetAll(): void {
  buttonsHeld.clear();
  state.leftStickX = 0;
  state.leftStickY = 0;
  state.rightStickX = 0;
  state.rightStickY = 0;
  state.leftTrigger = 0;
  state.rightTrigger = 0;
}

export function snapshot(sequence: number): InputFrameData {
  let buttons = 0;
  for (const bit of buttonsHeld) buttons |= 1 << bit;
  return { ...state, sequence, buttons };
}

function clamp(v: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, v));
}

function scaleAxis(v: number): number {
  const c = clamp(v, -1, 1);
  return Math.round(c * (c < 0 ? 32768 : 32767));
}
