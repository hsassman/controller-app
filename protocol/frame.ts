// authoritative byte-level spec. Keep this in sync with frame.rs by hand —
// there is no codegen step for this project.

export const FRAME_TYPE_INPUT = 0x01;
export const FRAME_TYPE_PING = 0x02;
export const FRAME_TYPE_PONG = 0x03;

export const INPUT_FRAME_SIZE = 15;
export const PING_PONG_FRAME_SIZE = 3;

export const ButtonBit = {
  A: 0,
  B: 1,
  X: 2,
  Y: 3,
  DPAD_UP: 4,
  DPAD_DOWN: 5,
  DPAD_LEFT: 6,
  DPAD_RIGHT: 7,
  L1: 8,
  R1: 9,
  L3: 10,
  R3: 11,
  START: 12,
  SELECT: 13,
} as const;

export interface InputFrameData {
  sequence: number;
  buttons: number;
  leftStickX: number;
  leftStickY: number;
  rightStickX: number;
  rightStickY: number;
  leftTrigger: number;
  rightTrigger: number;
}

export function encodePingFrame(sequence: number): ArrayBuffer {
  const buf = new ArrayBuffer(PING_PONG_FRAME_SIZE);
  const view = new DataView(buf);
  view.setUint8(0, FRAME_TYPE_PING);
  view.setUint16(1, sequence & 0xffff, true);
  return buf;
}

/// Returns the echoed sequence if `data` is a PONG, else null.
export function decodePongSequence(data: ArrayBuffer): number | null {
  if (data.byteLength !== PING_PONG_FRAME_SIZE) return null;
  const view = new DataView(data);
  if (view.getUint8(0) !== FRAME_TYPE_PONG) return null;
  return view.getUint16(1, true);
}

export function encodeInputFrame(data: InputFrameData): ArrayBuffer {
  const buf = new ArrayBuffer(INPUT_FRAME_SIZE);
  const view = new DataView(buf);
  view.setUint8(0, FRAME_TYPE_INPUT);
  view.setUint16(1, data.sequence, true);
  view.setUint16(3, data.buttons, true);
  view.setInt16(5, data.leftStickX, true);
  view.setInt16(7, data.leftStickY, true);
  view.setInt16(9, data.rightStickX, true);
  view.setInt16(11, data.rightStickY, true);
  view.setUint8(13, data.leftTrigger);
  view.setUint8(14, data.rightTrigger);
  return buf;
}
