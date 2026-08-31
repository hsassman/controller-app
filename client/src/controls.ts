import type { ControlConfig, Layout } from "./layout.ts";
import { isButtonHeld, resetAll, setButton, setStick, setTrigger } from "./inputState.ts";
import type { Settings } from "./settings.ts";
import { haptic } from "./haptics.ts";
import { ButtonBit } from "../../protocol/frame.ts";

const REF_W = 640;
const REF_H = 300;
// 0.8 (not lower) so the smallest reference control -- Select/Start at 34px
// -- never drops below ~27px, clearing WCAG 2.2's 24px minimum target size
const MIN_SCALE = 0.8;
const MAX_SCALE = 1.3;

export function computeScale(container: HTMLElement): number {
  const rect = container.getBoundingClientRect();
  if (rect.width === 0 || rect.height === 0) return 1;
  const scale = Math.min(rect.width / REF_W, rect.height / REF_H);
  return Math.min(MAX_SCALE, Math.max(MIN_SCALE, scale));
}

export function renderControls(
  container: HTMLElement,
  layout: Layout,
  getSettings: () => Settings,
  /// Called when a re-render forced every held input to be released, so the
  /// caller can flush one neutral frame immediately instead of waiting for
  /// the next tick of its send loop.
  onReleaseAll?: () => void,
): () => void {
  let disposed = false;

  const draw = (releaseHeld: boolean) => {
    if (disposed) return;
    // Wiping the surface destroys the element holding the pointer, so its
    // release would never fire and the input would stay stuck on.
    if (releaseHeld) {
      resetAll();
      onReleaseAll?.();
    }
    // The user's size multiplier rides on top of the fit-to-viewport scale
    // rather than replacing it, so scaling up on a small phone still cannot
    // push a control off-screen further than the fit calculation allows.
    const scale = computeScale(container) * getSettings().controlScale;
    container.innerHTML = "";
    container.classList.toggle("hide-labels", !getSettings().showLabels);
    for (const control of layout.controls) {
      const el = buildControl(control, getSettings, scale);
      if (el) container.appendChild(el);
    }
  };
  draw(false);

  // ResizeObserver fires once immediately on observe(); that first callback
  // is the size we just drew at, so skip it rather than rebuilding the
  // surface twice on every mount.
  let seenFirstObservation = false;
  const observer = new ResizeObserver(() => {
    if (!seenFirstObservation) {
      seenFirstObservation = true;
      return;
    }
    draw(true);
  });
  observer.observe(container);

  return () => {
    disposed = true;
    observer.disconnect();
  };
}

function buildControl(
  control: ControlConfig,
  getSettings: () => Settings,
  scale: number,
): HTMLElement | null {
  switch (control.type) {
    case "button":
      return buildButton(control, getSettings, scale);
    case "dpad":
      return buildDpad(control, scale);
    case "stick":
      return buildStick(control, getSettings, scale);
    case "trigger":
      return buildTrigger(control, scale);
    default:
      console.warn("skipping control of unknown type", control);
      return null;
  }
}

function applyTint(el: HTMLElement, tint: string | undefined): void {
  if (!tint || !/^#[0-9a-f]{6}$/i.test(tint)) return;
  const v = parseInt(tint.slice(1), 16);
  el.style.setProperty("--tint", tint);
  el.style.setProperty("--tint-rgb", `${(v >> 16) & 255}, ${(v >> 8) & 255}, ${v & 255}`);
  el.classList.add("tinted");
}

function positioned(el: HTMLElement, x: number, y: number, w: number, h: number): void {
  el.style.left = `${x}%`;
  el.style.top = `${y}%`;
  el.style.width = `${w}px`;
  el.style.height = `${h}px`;
}

function buildButton(
  cfg: Extract<ControlConfig, { type: "button" }>,
  getSettings: () => Settings,
  scale: number,
): HTMLElement {
  const el = document.createElement("div");
  el.className = "control button-control";
  el.setAttribute("role", "button");
  el.setAttribute("aria-label", cfg.label);
  el.tabIndex = 0;
  el.textContent = cfg.label;
  el.dataset.controlId = cfg.id;
  const bw = cfg.width ?? cfg.size;
  const bh = cfg.height ?? cfg.size;
  // Shape is explicit now (see ButtonConfig.shape); the width != height
  // inference is kept only as the fallback for layouts saved before the
  // field existed and not yet migrated.
  const shape = cfg.shape ?? (bw !== bh ? "pill" : "circle");
  if (shape === "pill") el.classList.add("button-pill");
  if (shape === "square") el.classList.add("button-square");
  applyTint(el, cfg.tint);
  positioned(el, cfg.x, cfg.y, bw * scale, bh * scale);

  const isToggle = () => getSettings().toggleButtonIds.includes(cfg.id);

  const heldNow = isToggle() && isButtonHeld(cfg.bit);
  el.classList.toggle("active", heldNow);
  el.setAttribute("aria-pressed", String(heldNow));

  const press = () => {
    if (isToggle()) {
      const next = !isButtonHeld(cfg.bit);
      setButton(cfg.bit, next);
      el.classList.toggle("active", next);
      el.setAttribute("aria-pressed", String(next));
      haptic(next ? "press" : "release");
    } else {
      setButton(cfg.bit, true);
      el.classList.add("active");
      el.setAttribute("aria-pressed", "true");
      haptic("press");
    }
  };
  const release = () => {
    if (isToggle()) return; // state already committed on press
    setButton(cfg.bit, false);
    el.classList.remove("active");
    el.setAttribute("aria-pressed", "false");
    haptic("release");
  };

  let ownerId: number | null = null;

  el.addEventListener("pointerdown", (e) => {
    e.preventDefault();
    if (ownerId !== null) return;
    ownerId = e.pointerId;
    el.setPointerCapture(e.pointerId);
    press();
  });
  el.addEventListener("pointerup", (e) => {
    if (e.pointerId !== ownerId) return;
    ownerId = null;
    if (el.hasPointerCapture(e.pointerId)) el.releasePointerCapture(e.pointerId);
    release();
  });
  el.addEventListener("pointercancel", (e) => {
    if (e.pointerId !== ownerId) return;
    ownerId = null;
    release();
  });

  // targets motor accessibility broadly, not just touch).
  el.addEventListener("keydown", (e) => {
    if (e.key !== "Enter" && e.key !== " ") return;
    e.preventDefault();
    if (!e.repeat) press();
  });
  el.addEventListener("keyup", (e) => {
    if (e.key !== "Enter" && e.key !== " ") return;
    e.preventDefault();
    release();
  });

  return el;
}

const DPAD_BITS: number[] = [ButtonBit.DPAD_UP, ButtonBit.DPAD_RIGHT, ButtonBit.DPAD_DOWN, ButtonBit.DPAD_LEFT];
const DPAD_KEY_BITS: Record<string, number> = {
  ArrowUp: ButtonBit.DPAD_UP,
  ArrowDown: ButtonBit.DPAD_DOWN,
  ArrowLeft: ButtonBit.DPAD_LEFT,
  ArrowRight: ButtonBit.DPAD_RIGHT,
};

function buildDpad(cfg: Extract<ControlConfig, { type: "dpad" }>, scale: number): HTMLElement {
  const el = document.createElement("div");
  el.className = "control dpad-control";
  el.setAttribute("role", "slider");
  el.setAttribute("aria-label", "D-pad");
  el.setAttribute("aria-valuetext", "centred");
  el.tabIndex = 0;
  el.dataset.controlId = cfg.id;
  applyTint(el, cfg.tint);
  positioned(el, cfg.x, cfg.y, cfg.size * scale, cfg.size * scale);

  const indicator = document.createElement("div");
  indicator.className = "dpad-indicator";
  el.appendChild(indicator);

  let activeBits: number[] = [];

  const setActive = (bits: number[]) => {
    for (const bit of activeBits) if (!bits.includes(bit)) setButton(bit, false);
    for (const bit of bits) setButton(bit, true);
    // Buzz only when the direction actually changes, not on every pointer
    // move: a d-pad is sampled continuously while a thumb slides across it,
    // and buzzing per move event is a constant rattle rather than feedback.
    if (bits.length !== activeBits.length || bits.some((b) => !activeBits.includes(b))) {
      if (bits.length > 0) haptic("detent");
    }
    activeBits = bits;
    const names = bits.map((b) => ["up", "right", "down", "left"][DPAD_BITS.indexOf(b)]);
    el.dataset.direction = names.join("-");
    // Mirror the direction into the accessibility tree. Previously it lived
    // only in data-direction, so a screen reader user got no feedback that
    // the d-pad was doing anything at all.
    el.setAttribute("aria-valuetext", names.length ? names.join(" ") : "centred");
  };

  const fromPoint = (clientX: number, clientY: number) => {
    const rect = el.getBoundingClientRect();
    const dx = clientX - (rect.left + rect.width / 2);
    const dy = clientY - (rect.top + rect.height / 2);
    const deadZonePx = rect.width * 0.15;
    if (Math.hypot(dx, dy) < deadZonePx) return setActive([]);

    const angle = Math.atan2(dy, dx); // -PI..PI, 0 = right, +PI/2 = down
    const octant = Math.round(angle / (Math.PI / 4)) & 7; // 0..7 in 45deg steps
    // octant: 0=right,1=down-right,2=down,3=down-left,4=left,5=up-left,6=up,7=up-right
    const bits: number[] = [];
    if (octant === 6 || octant === 5 || octant === 7) bits.push(ButtonBit.DPAD_UP);
    if (octant === 2 || octant === 1 || octant === 3) bits.push(ButtonBit.DPAD_DOWN);
    if (octant === 4 || octant === 3 || octant === 5) bits.push(ButtonBit.DPAD_LEFT);
    if (octant === 0 || octant === 1 || octant === 7) bits.push(ButtonBit.DPAD_RIGHT);
    setActive(bits);
  };

  // See the button builder: one owning pointer, so a second finger cannot
  // steer or release the d-pad out from under the first.
  let ownerId: number | null = null;

  el.addEventListener("pointerdown", (e) => {
    e.preventDefault();
    if (ownerId !== null) return;
    ownerId = e.pointerId;
    el.setPointerCapture(e.pointerId);
    fromPoint(e.clientX, e.clientY);
  });
  el.addEventListener("pointermove", (e) => {
    if (e.pointerId !== ownerId) return;
    if (el.hasPointerCapture(e.pointerId)) fromPoint(e.clientX, e.clientY);
  });
  el.addEventListener("pointerup", (e) => {
    if (e.pointerId !== ownerId) return;
    ownerId = null;
    if (el.hasPointerCapture(e.pointerId)) el.releasePointerCapture(e.pointerId);
    setActive([]);
  });
  el.addEventListener("pointercancel", (e) => {
    if (e.pointerId !== ownerId) return;
    ownerId = null;
    setActive([]);
  });

  const heldKeys = new Set<string>();
  el.addEventListener("keydown", (e) => {
    const bit = DPAD_KEY_BITS[e.key];
    if (bit === undefined) return;
    e.preventDefault();
    heldKeys.add(e.key);
    setActive([...heldKeys].map((k) => DPAD_KEY_BITS[k]));
  });
  el.addEventListener("keyup", (e) => {
    if (DPAD_KEY_BITS[e.key] === undefined) return;
    e.preventDefault();
    heldKeys.delete(e.key);
    setActive([...heldKeys].map((k) => DPAD_KEY_BITS[k]));
  });
  el.addEventListener("blur", () => {
    heldKeys.clear();
    setActive([]);
  });

  return el;
}

/// "right 80" / "left 40" / "centred" for one axis of a stick.
function describeAxis(value: number, positive: string, negative: string): string {
  const percent = Math.round(Math.abs(value) * 100);
  if (percent === 0) return `${positive}/${negative} centred`;
  return `${value > 0 ? positive : negative} ${percent}`;
}

function applyDeadZoneAndCurve(magnitude: number, deadZone: number, curve: number): number {
  if (magnitude < deadZone) return 0;
  const remapped = (magnitude - deadZone) / (1 - deadZone);
  return Math.pow(remapped, curve);
}

function buildStick(
  cfg: Extract<ControlConfig, { type: "stick" }>,
  getSettings: () => Settings,
  scale: number,
): HTMLElement {
  const el = document.createElement("div");
  el.className = "control stick-control";
  el.setAttribute("role", "slider");
  el.setAttribute("aria-label", cfg.label);
  el.setAttribute("aria-valuemin", "-100");
  el.setAttribute("aria-valuemax", "100");
  el.setAttribute("aria-valuenow", "0");
  el.tabIndex = 0;
  el.dataset.controlId = cfg.id;
  applyTint(el, cfg.tint);
  const size = cfg.size * scale;
  positioned(el, cfg.x, cfg.y, size, size);

  const knob = document.createElement("div");
  knob.className = "stick-knob";
  el.appendChild(knob);

  const which = cfg.stick;

  const applyVector = (rawDx: number, rawDy: number) => {
    const radius = size / 2;
    const mag = Math.min(1, Math.hypot(rawDx, rawDy));
    let dx = rawDx;
    let dy = rawDy;
    if (mag > 0) {
      const { deadZone, sensitivityCurve } = getSettings();
      // A per-stick override beats the global setting: a player commonly
      // wants a forgiving dead zone for movement and a tight one for aim.
      const dz = cfg.deadZone ?? deadZone;
      const scaled = applyDeadZoneAndCurve(mag, dz, sensitivityCurve);
      const angle = Math.atan2(rawDy, rawDx);
      dx = Math.cos(angle) * scaled;
      dy = Math.sin(angle) * scaled;
    } else {
      dx = 0;
      dy = 0;
    }
    setStick(which, dx, -dy); // screen Y is inverted vs. stick-up-is-positive convention
    // role="slider" carries a single value, so aria-valuenow can only
    // describe one axis. Vertical travel was therefore invisible to a
    // screen reader; valuetext states both.
    el.setAttribute(
      "aria-valuetext",
      `${describeAxis(dx, "right", "left")}, ${describeAxis(-dy, "up", "down")}`,
    );
    // The knob is only ever driven while a finger is down, so it must not
    // carry a transition then -- it would lag the thumb. The snap-back
    // animation is added at release instead (see reset()).
    knob.classList.remove("snap-back");
    knob.style.transform = `translate(${dx * radius * 0.6}px, ${dy * radius * 0.6}px)`;
    el.setAttribute("aria-valuenow", String(Math.round(dx * 100)));
  };

  const update = (clientX: number, clientY: number) => {
    const rect = el.getBoundingClientRect();
    const radius = rect.width / 2;
    applyVector((clientX - (rect.left + radius)) / radius, (clientY - (rect.top + radius)) / radius);
  };

  const reset = () => {
    setStick(which, 0, 0);
    el.setAttribute("aria-valuetext", "centred");
    if (getSettings().stickSnapBack) knob.classList.add("snap-back");
    knob.style.transform = "translate(0, 0)";
    el.setAttribute("aria-valuenow", "0");
  };

  const TAP_MAX_MS = 250;
  const TAP_MAX_TRAVEL = 0.35; // fraction of the stick radius
  let pressStartedAt = 0;
  let travelled = 0;

  // One owning finger. Previously a stray second touch on the stick made
  // the first lift recentre it AND could fire a phantom L3/R3 tap while the
  // player was still steering.
  let ownerId: number | null = null;

  el.addEventListener("pointerdown", (e) => {
    e.preventDefault();
    if (ownerId !== null) return;
    ownerId = e.pointerId;
    el.setPointerCapture(e.pointerId);
    pressStartedAt = performance.now();
    travelled = 0;
    update(e.clientX, e.clientY);
  });
  el.addEventListener("pointermove", (e) => {
    if (e.pointerId !== ownerId) return;
    if (!el.hasPointerCapture(e.pointerId)) return;
    const rect = el.getBoundingClientRect();
    const radius = rect.width / 2;
    const dx = (e.clientX - (rect.left + radius)) / radius;
    const dy = (e.clientY - (rect.top + radius)) / radius;
    travelled = Math.max(travelled, Math.hypot(dx, dy));
    update(e.clientX, e.clientY);
  });

  const end = (e: PointerEvent) => {
    if (e.pointerId !== ownerId) return;
    ownerId = null;
    if (el.hasPointerCapture(e.pointerId)) el.releasePointerCapture(e.pointerId);
    const wasTap =
      e.type === "pointerup" &&
      performance.now() - pressStartedAt <= TAP_MAX_MS &&
      travelled <= TAP_MAX_TRAVEL;
    reset();
    if (wasTap) {
      setButton(cfg.clickBit, true);
      haptic("click");
      window.setTimeout(() => setButton(cfg.clickBit, false), 60);
    }
  };
  el.addEventListener("pointerup", end);
  el.addEventListener("pointercancel", end);

  const heldStickKeys = new Set<string>();
  const STICK_VECTORS: Record<string, [number, number]> = {
    ArrowUp: [0, -1],
    ArrowDown: [0, 1],
    ArrowLeft: [-1, 0],
    ArrowRight: [1, 0],
  };
  const applyHeldKeys = () => {
    let vx = 0;
    let vy = 0;
    for (const key of heldStickKeys) {
      const [kx, ky] = STICK_VECTORS[key];
      vx += kx;
      vy += ky;
    }
    const mag = Math.hypot(vx, vy);
    applyVector(mag > 0 ? vx / mag : 0, mag > 0 ? vy / mag : 0);
  };
  el.addEventListener("keydown", (e) => {
    if (!(e.key in STICK_VECTORS)) return;
    e.preventDefault();
    heldStickKeys.add(e.key);
    applyHeldKeys();
  });
  el.addEventListener("keyup", (e) => {
    if (!(e.key in STICK_VECTORS)) return;
    e.preventDefault();
    heldStickKeys.delete(e.key);
    applyHeldKeys();
  });
  el.addEventListener("blur", () => {
    heldStickKeys.clear();
    reset();
  });

  return el;
}

function buildTrigger(cfg: Extract<ControlConfig, { type: "trigger" }>, scale: number): HTMLElement {
  const el = document.createElement("div");
  el.className = "control trigger-control";
  el.setAttribute("role", "slider");
  el.setAttribute("aria-label", cfg.label);
  el.setAttribute("aria-valuemin", "0");
  el.setAttribute("aria-valuemax", "100");
  el.setAttribute("aria-valuenow", "0");
  el.tabIndex = 0;
  el.dataset.controlId = cfg.id;
  applyTint(el, cfg.tint);
  positioned(el, cfg.x, cfg.y, cfg.width * scale, cfg.height * scale);

  const fill = document.createElement("div");
  fill.className = "trigger-fill";
  el.appendChild(fill);
  const labelEl = document.createElement("span");
  labelEl.className = "trigger-label";
  labelEl.textContent = cfg.label;
  el.appendChild(labelEl);

  const which = cfg.trigger;

  // A real trigger has a break point you can feel; an on-screen one has
  // nothing, so the buzz at the point most games treat as "pressed" is the
  // only cue that the pull registered.
  const ACTUATION = 0.5;
  let wasActuated = false;

  const setValue = (value: number) => {
    setTrigger(which, value);
    fill.style.height = `${value * 100}%`;
    el.setAttribute("aria-valuenow", String(Math.round(value * 100)));
    el.classList.toggle("actuated", value >= ACTUATION);
    if (value >= ACTUATION !== wasActuated) {
      wasActuated = value >= ACTUATION;
      haptic(wasActuated ? "press" : "release");
    }
  };

  const update = (clientY: number) => {
    const rect = el.getBoundingClientRect();
    setValue(Math.min(1, Math.max(0, 1 - (clientY - rect.top) / rect.height)));
  };

  const reset = () => setValue(0);

  // One owning finger, as with the other control types.
  let ownerId: number | null = null;

  el.addEventListener("pointerdown", (e) => {
    e.preventDefault();
    if (ownerId !== null) return;
    ownerId = e.pointerId;
    el.setPointerCapture(e.pointerId);
    update(e.clientY);
  });
  el.addEventListener("pointermove", (e) => {
    if (e.pointerId !== ownerId) return;
    if (el.hasPointerCapture(e.pointerId)) update(e.clientY);
  });
  const end = (e: PointerEvent) => {
    if (e.pointerId !== ownerId) return;
    ownerId = null;
    if (el.hasPointerCapture(e.pointerId)) el.releasePointerCapture(e.pointerId);
    reset();
  };
  el.addEventListener("pointerup", end);
  el.addEventListener("pointercancel", end);

  el.addEventListener("keydown", (e) => {
    if (e.key !== "ArrowUp" && e.key !== "ArrowDown") return;
    e.preventDefault();
    if (!e.repeat) setValue(e.key === "ArrowUp" ? 1 : 0);
  });
  el.addEventListener("keyup", (e) => {
    if (e.key !== "ArrowUp" && e.key !== "ArrowDown") return;
    e.preventDefault();
    reset();
  });
  el.addEventListener("blur", reset);

  return el;
}
