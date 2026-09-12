import type { ControlConfig, Layout } from "../layout.ts";
import { BUTTON_MAPPINGS, groupedMappings } from "../mappings.ts";
import { ACCENT_PRESETS } from "../theme.ts";
import { ButtonBit } from "../../../protocol/frame.ts";

export interface InspectorHost {
  /// A property changed in a way that only affects how the control draws.
  onChange(): void;
  pushHistory(key?: string): void;
  duplicate(cfg: ControlConfig): void;
  remove(cfg: ControlConfig): void;
  close(): void;
}

const SIZE_MIN = 30;
const SIZE_MAX = 200;

export function renderInspector(
  panel: HTMLElement,
  cfg: ControlConfig,
  layout: Layout,
  host: InspectorHost,
): void {
  panel.hidden = false;
  // Dock away from the control being edited so it stays visible while its
  // properties are changed.
  panel.dataset.side = cfg.x > 50 ? "left" : "right";
  panel.innerHTML = "";

  const heading = document.createElement("div");
  heading.className = "inspector-header";
  const title = document.createElement("h3");
  title.textContent = describe(cfg);
  const closeBtn = iconButton("✕", "Close properties", () => host.close());
  closeBtn.className = "inspector-close";
  heading.append(title, closeBtn);
  panel.appendChild(heading);

  const body = document.createElement("div");
  body.className = "inspector-body";
  panel.appendChild(body);

  // ---- Label ----
  if (cfg.type !== "dpad") {
    body.appendChild(
      textRow("Label", cfg.label, (value) => {
        host.pushHistory(`label:${cfg.id}`);
        cfg.label = value;
        title.textContent = describe(cfg);
        host.onChange();
      }),
    );
  }

  // ---- Type-specific mapping ----
  switch (cfg.type) {
    case "button": {
      body.appendChild(
        mappingRow("Sends", cfg.bit, (bit) => {
          host.pushHistory(`bit:${cfg.id}`);
          cfg.bit = bit;
          host.onChange();
        }),
      );
      body.appendChild(
        segmentedRow(
          "Shape",
          [
            ["circle", "Round"],
            ["pill", "Pill"],
            ["square", "Square"],
          ],
          cfg.shape ?? "circle",
          (value) => {
            host.pushHistory(`shape:${cfg.id}`);
            cfg.shape = value as "circle" | "pill" | "square";
            // A round button is square by definition; collapsing the
            // dimensions here stops a pill-turned-round control from
            // rendering as a squashed ellipse.
            if (value === "circle") {
              const d = Math.round(((cfg.width ?? cfg.size) + (cfg.height ?? cfg.size)) / 2);
              cfg.size = d;
              cfg.width = undefined;
              cfg.height = undefined;
            } else if (cfg.width === undefined) {
              cfg.width = cfg.size;
              cfg.height = cfg.size;
            }
            host.onChange();
            renderInspector(panel, cfg, layout, host); // size rows change shape
          },
        ),
      );
      break;
    }
    case "stick": {
      body.appendChild(
        segmentedRow(
          "Drives",
          [
            ["left", "Left stick"],
            ["right", "Right stick"],
          ],
          cfg.stick,
          (value) => {
            host.pushHistory(`stick:${cfg.id}`);
            cfg.stick = value as "left" | "right";
            // Keep the click mapping consistent with the axis by default;
            // a left stick that clicks R3 is almost always a mistake, and
            // the next row still allows it deliberately.
            cfg.clickBit = value === "left" ? ButtonBit.L3 : ButtonBit.R3;
            host.onChange();
            renderInspector(panel, cfg, layout, host);
          },
        ),
      );
      body.appendChild(
        mappingRow("Click sends", cfg.clickBit, (bit) => {
          host.pushHistory(`click:${cfg.id}`);
          cfg.clickBit = bit;
          host.onChange();
        }),
      );
      body.appendChild(
        sliderRow(
          "Dead zone",
          cfg.deadZone ?? -1,
          -1,
          0.5,
          0.01,
          (v) => (v < 0 ? "Use global" : `${Math.round(v * 100)}%`),
          (v) => {
            host.pushHistory(`deadzone:${cfg.id}`);
            cfg.deadZone = v < 0 ? undefined : v;
            host.onChange();
          },
        ),
      );
      break;
    }
    case "trigger": {
      body.appendChild(
        segmentedRow(
          "Drives",
          [
            ["left", "Left (LT)"],
            ["right", "Right (RT)"],
          ],
          cfg.trigger,
          (value) => {
            host.pushHistory(`trigger:${cfg.id}`);
            cfg.trigger = value as "left" | "right";
            host.onChange();
          },
        ),
      );
      break;
    }
    case "dpad":
      break;
  }

  // ---- Size ----
  const { w, h } = dimsOf(cfg);
  const independent =
    cfg.type === "trigger" || (cfg.type === "button" && (cfg.shape ?? "circle") !== "circle");

  if (independent) {
    body.appendChild(
      sliderRow("Width", w, SIZE_MIN, SIZE_MAX, 2, (v) => `${Math.round(v)}px`, (v) => {
        host.pushHistory(`width:${cfg.id}`);
        setDims(cfg, v, dimsOf(cfg).h);
        host.onChange();
      }),
    );
    body.appendChild(
      sliderRow("Height", h, SIZE_MIN, SIZE_MAX, 2, (v) => `${Math.round(v)}px`, (v) => {
        host.pushHistory(`height:${cfg.id}`);
        setDims(cfg, dimsOf(cfg).w, v);
        host.onChange();
      }),
    );
  } else {
    body.appendChild(
      sliderRow("Size", w, SIZE_MIN, SIZE_MAX, 2, (v) => `${Math.round(v)}px`, (v) => {
        host.pushHistory(`size:${cfg.id}`);
        setDims(cfg, v, v);
        host.onChange();
      }),
    );
  }

  // ---- Tint ----
  body.appendChild(
    tintRow(cfg.tint, (tint) => {
      host.pushHistory(`tint:${cfg.id}`);
      cfg.tint = tint;
      host.onChange();
    }),
  );

  // ---- Glow (per-control override of the global Look → Press glow) ----
  body.appendChild(
    switchRow("Glow", cfg.glow ?? true, (on) => {
      host.pushHistory(`glow:${cfg.id}`);
      // Stored as undefined rather than `true` when on, so "follow the
      // global setting" and "explicitly on" don't diverge the moment the
      // global slider changes later.
      cfg.glow = on ? undefined : false;
      host.onChange();
    }),
  );

  // ---- Position (fine nudge, for placement that drag can't hit exactly) ----
  const pos = document.createElement("div");
  pos.className = "inspector-row inspector-pos";
  const posLabel = document.createElement("span");
  posLabel.className = "inspector-label";
  posLabel.textContent = "Position";
  const posValue = document.createElement("span");
  posValue.className = "inspector-value";
  const showPos = () => {
    posValue.textContent = `${Math.round(cfg.x)}% , ${Math.round(cfg.y)}%`;
  };
  showPos();
  const pad = document.createElement("div");
  pad.className = "nudge-pad";
  const nudge = (dx: number, dy: number) => {
    host.pushHistory(`nudge:${cfg.id}`);
    cfg.x = clampPercent(cfg.x + dx);
    cfg.y = clampPercent(cfg.y + dy);
    showPos();
    host.onChange();
  };
  pad.append(
    iconButton("↑", "Nudge up", () => nudge(0, -1)),
    iconButton("←", "Nudge left", () => nudge(-1, 0)),
    iconButton("→", "Nudge right", () => nudge(1, 0)),
    iconButton("↓", "Nudge down", () => nudge(0, 1)),
  );
  pos.append(posLabel, posValue, pad);
  body.appendChild(pos);

  // ---- Actions ----
  const actions = document.createElement("div");
  actions.className = "inspector-actions";
  const dupBtn = document.createElement("button");
  dupBtn.type = "button";
  dupBtn.textContent = "Duplicate";
  dupBtn.addEventListener("click", () => host.duplicate(cfg));
  const delBtn = document.createElement("button");
  delBtn.type = "button";
  delBtn.className = "danger";
  delBtn.textContent = "Delete";
  delBtn.addEventListener("click", () => host.remove(cfg));
  actions.append(dupBtn, delBtn);
  panel.appendChild(actions);
}

// ---- Shared shape helpers (the editor uses the same rules) ----

export function dimsOf(c: ControlConfig): { w: number; h: number } {
  if (c.type === "trigger") return { w: c.width, h: c.height };
  if (c.type === "button") return { w: c.width ?? c.size, h: c.height ?? c.size };
  return { w: c.size, h: c.size };
}

export function setDims(c: ControlConfig, newW: number, newH: number): void {
  const w = Math.min(SIZE_MAX, Math.max(SIZE_MIN, Math.round(newW)));
  const h = Math.min(SIZE_MAX, Math.max(SIZE_MIN, Math.round(newH)));
  if (c.type === "trigger") {
    c.width = w;
    c.height = h;
  } else if (c.type === "button" && c.shape !== "circle" && c.width !== undefined) {
    c.width = w;
    c.height = h;
  } else if (c.type === "button") {
    c.size = Math.round((w + h) / 2);
    c.width = undefined;
    c.height = undefined;
  } else {
    c.size = Math.round((w + h) / 2);
  }
}

function describe(cfg: ControlConfig): string {
  switch (cfg.type) {
    case "button":
      return `Button — ${cfg.label}`;
    case "stick":
      return `Stick — ${cfg.label}`;
    case "trigger":
      return `Trigger — ${cfg.label}`;
    case "dpad":
      return "D-pad";
  }
}

function clampPercent(v: number): number {
  return Math.min(100, Math.max(0, Math.round(v * 10) / 10));
}

// ---- Row builders ----

function row(labelText: string): { row: HTMLElement; label: HTMLElement } {
  const el = document.createElement("div");
  el.className = "inspector-row";
  const label = document.createElement("span");
  label.className = "inspector-label";
  label.textContent = labelText;
  el.appendChild(label);
  return { row: el, label };
}

function textRow(labelText: string, value: string, onCommit: (v: string) => void): HTMLElement {
  const { row: el, label } = row(labelText);
  const input = document.createElement("input");
  input.type = "text";
  input.className = "inspector-input";
  input.value = value;
  input.maxLength = 12;
  // Belt and braces alongside the <label for>: the accessible name resolved
  // to null in testing when the label association was the only mechanism.
  input.setAttribute("aria-label", labelText);
  const id = `insp-${Math.random().toString(36).slice(2, 8)}`;
  input.id = id;
  label.setAttribute("for", id);
  // `input`, not `change`: the panel can be dismissed by tapping the
  // surface, which on some mobile browsers never fires `change` for a field
  // that still has focus -- the edit would be silently lost.
  input.addEventListener("input", () => onCommit(input.value));
  el.appendChild(input);
  return el;
}

function mappingRow(labelText: string, bit: number, onPick: (bit: number) => void): HTMLElement {
  const { row: el, label } = row(labelText);
  const select = document.createElement("select");
  select.className = "inspector-input";
  // Without this the accessible name fell back to the concatenation of
  // every option ("ABXYLeft bumper (LB)...").
  select.setAttribute("aria-label", labelText);
  const id = `insp-${Math.random().toString(36).slice(2, 8)}`;
  select.id = id;
  label.setAttribute("for", id);
  for (const { group, items } of groupedMappings()) {
    const optgroup = document.createElement("optgroup");
    optgroup.label = group;
    for (const m of items) {
      const option = document.createElement("option");
      option.value = String(m.bit);
      option.textContent = m.name;
      option.selected = m.bit === bit;
      optgroup.appendChild(option);
    }
    select.appendChild(optgroup);
  }
  // A bit that isn't in the catalogue (hand-edited layout file) would
  // otherwise silently show as whatever option happened to be first.
  if (!BUTTON_MAPPINGS.some((m) => m.bit === bit)) {
    const option = document.createElement("option");
    option.value = String(bit);
    option.textContent = `Unknown (bit ${bit})`;
    option.selected = true;
    select.appendChild(option);
  }
  select.addEventListener("change", () => onPick(Number(select.value)));
  el.appendChild(select);
  return el;
}

function segmentedRow(
  labelText: string,
  options: [string, string][],
  current: string,
  onPick: (value: string) => void,
): HTMLElement {
  const { row: el } = row(labelText);
  const group = document.createElement("div");
  group.className = "segmented";
  group.setAttribute("role", "radiogroup");
  group.setAttribute("aria-label", labelText);
  const buttons: HTMLButtonElement[] = [];
  for (const [value, text] of options) {
    const btn = document.createElement("button");
    btn.type = "button";
    btn.textContent = text;
    btn.setAttribute("role", "radio");
    btn.setAttribute("aria-checked", String(value === current));
    // Roving tabindex: a radiogroup presents as ONE tab stop, with the
    // arrows moving between options.
    btn.tabIndex = value === current ? 0 : -1;
    if (value === current) btn.classList.add("on");
    btn.addEventListener("click", () => onPick(value));
    buttons.push(btn);
    group.appendChild(btn);
  }
  group.addEventListener("keydown", (e) => {
    const at = buttons.indexOf(document.activeElement as HTMLButtonElement);
    if (at < 0) return;
    let next = at;
    if (e.key === "ArrowRight" || e.key === "ArrowDown") next = (at + 1) % buttons.length;
    else if (e.key === "ArrowLeft" || e.key === "ArrowUp") next = (at - 1 + buttons.length) % buttons.length;
    else return;
    e.preventDefault();
    buttons[at].tabIndex = -1;
    buttons[next].tabIndex = 0;
    buttons[next].focus();
    buttons[next].click();
  });
  el.appendChild(group);
  return el;
}

function sliderRow(
  labelText: string,
  value: number,
  min: number,
  max: number,
  step: number,
  format: (v: number) => string,
  onCommit: (v: number) => void,
): HTMLElement {
  const { row: el, label } = row(labelText);
  const readout = document.createElement("span");
  readout.className = "inspector-value";
  readout.textContent = format(value);
  const input = document.createElement("input");
  input.type = "range";
  input.min = String(min);
  input.max = String(max);
  input.step = String(step);
  input.value = String(value);
  const id = `insp-${Math.random().toString(36).slice(2, 8)}`;
  input.id = id;
  label.setAttribute("for", id);
  input.addEventListener("input", () => {
    const v = Number(input.value);
    readout.textContent = format(v);
    onCommit(v);
  });
  el.append(readout, input);
  return el;
}

function switchRow(labelText: string, value: boolean, onChange: (v: boolean) => void): HTMLElement {
  const { row: el, label } = row(labelText);
  const input = document.createElement("input");
  input.type = "checkbox";
  input.className = "switch";
  input.checked = value;
  const id = `insp-${Math.random().toString(36).slice(2, 8)}`;
  input.id = id;
  label.setAttribute("for", id);
  input.addEventListener("change", () => onChange(input.checked));
  el.appendChild(input);
  return el;
}

function tintRow(current: string | undefined, onPick: (tint: string | undefined) => void): HTMLElement {
  const { row: el } = row("Colour");
  const swatches = document.createElement("div");
  swatches.className = "swatches";

  const makeSwatch = (colour: string | undefined, name: string) => {
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = "swatch";
    btn.setAttribute("aria-label", name);
    btn.setAttribute("aria-pressed", String(current === colour));
    if (current === colour) btn.classList.add("on");
    if (colour) btn.style.background = colour;
    else btn.classList.add("swatch-default");
    btn.addEventListener("click", () => onPick(colour));
    return btn;
  };

  swatches.appendChild(makeSwatch(undefined, "Theme default"));
  for (const colour of ACCENT_PRESETS) swatches.appendChild(makeSwatch(colour, colour));
  el.appendChild(swatches);
  return el;
}

function iconButton(glyph: string, label: string, onClick: () => void): HTMLButtonElement {
  const btn = document.createElement("button");
  btn.type = "button";
  btn.textContent = glyph;
  btn.setAttribute("aria-label", label);
  btn.addEventListener("click", onClick);
  return btn;
}
