// authoritative byte-level spec. Keep this in sync with frame.rs by hand —
// there is no codegen step for this project.

export const FRAME_TYPE_INPUT = 0x01;
export const FRAME_TYPE_PING = 0x02;
export const FRAME_TYPE_PONG = 0x03;
/// Host -> phone only. Sent whenever a game changes the virtual pad's rumble
/// motors (or its player LED), so the phone can buzz along with the game.
export const FRAME_TYPE_RUMBLE = 0x04;

export const INPUT_FRAME_SIZE = 15;
export const PING_PONG_FRAME_SIZE = 3;
/// Type byte, large (low-frequency) motor 0-255, small (high-frequency)
/// motor 0-255, then the XInput player slot 0-3 (255 = not assigned yet).
export const RUMBLE_FRAME_SIZE = 4;

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
  /// The Xbox guide button. Games reading plain XInput never see it, but
  /// Steam (Big Picture, the overlay) and the Xbox Game Bar do.
  GUIDE: 14,
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

export interface RumbleFrameData {
  /// 0-1, the heavy low-frequency motor (explosions, engines).
  large: number;
  /// 0-1, the light high-frequency motor (footsteps, gunfire).
  small: number;
  /// XInput slot 0-3, or null before Windows has assigned one.
  player: number | null;
}

/// Returns the rumble state if `data` is a RUMBLE frame, else null.
export function decodeRumbleFrame(data: ArrayBuffer): RumbleFrameData | null {
  if (data.byteLength !== RUMBLE_FRAME_SIZE) return null;
  const view = new DataView(data);
  if (view.getUint8(0) !== FRAME_TYPE_RUMBLE) return null;
  const player = view.getUint8(3);
  return {
    large: view.getUint8(1) / 255,
    small: view.getUint8(2) / 255,
    player: player < 4 ? player : null,
  };
}
