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
  // x, y in [-1, 1]; scale to the i16 wire range.
  const sx = Math.round(clamp(x, -1, 1) * 32767);
  const sy = Math.round(clamp(y, -1, 1) * 32767);
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
