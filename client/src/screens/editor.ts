import type { ControlConfig, Layout } from "../layout.ts";
import { defaultLayout } from "../layout.ts";
import type { Settings } from "../settings.ts";
import { exportLayout, importLayoutFromFile, saveLayout } from "../profile.ts";
import { PRESETS, mirrorLayout } from "../presets.ts";
import { mappingFor } from "../mappings.ts";
import { renderInspector, dimsOf, setDims } from "./inspector.ts";
import { computeScale } from "../controls.ts";
import { haptic } from "../haptics.ts";
import { ButtonBit } from "../../../protocol/frame.ts";

const MAX_HISTORY = 50;

const KNOWN_TYPES = new Set<string>(["button", "dpad", "stick", "trigger"]);

function nextId(layout: Layout, type: ControlConfig["type"]): string {
  const taken = new Set(layout.controls.map((c) => c.id));
  let n = 0;
  let id = `custom-${type}-${n}`;
  while (taken.has(id)) {
    n += 1;
    id = `custom-${type}-${n}`;
  }
  return id;
}

export interface EditorOptions {
  getSettings: () => Settings;
  onDone: (layout: Layout) => void;
  onCancel: () => void;
  /// Called when the editor changes a persisted setting (the grid toggle).
  onSettingsChanged?: () => void;
}

/// Renders the editor and returns a teardown function. Teardown is not
/// optional bookkeeping: the editor owns a floating properties panel and a
/// window-level key handler that both outlive `surface.innerHTML = ""`.
export interface EditorHandle {
  teardown: () => void;
  /// True when there are edits that Done would save and Cancel would lose.
  isDirty: () => boolean;
  save: () => void;
}

export function renderEditor(
  surface: HTMLElement,
  toolbar: HTMLElement,
  layout: Layout,
  options: EditorOptions,
): EditorHandle {
  let working: Layout = structuredClone(layout);
  const undoStack: Layout[] = [];
  const redoStack: Layout[] = [];
  let selectedId: string | null = null;
  /// Whether any edit has been made since the editor opened.
  let dirty = false;

  // The properties panel lives beside the surface, not inside it, so
  // re-rendering the controls never destroys a field the user is typing in.
  const panel = document.createElement("aside");
  panel.className = "inspector";
  panel.hidden = true;
  panel.setAttribute("role", "region");
  panel.setAttribute("aria-label", "Control properties");
  surface.parentElement?.appendChild(panel);

  const gridOverlay = document.createElement("div");
  gridOverlay.className = "grid-overlay";
  gridOverlay.setAttribute("aria-hidden", "true");

  const selected = (): ControlConfig | undefined =>
    working.controls.find((c) => c.id === selectedId);

  let historyKey: string | null = null;

  const pushSnapshot = (): void => {
    dirty = true;
    undoStack.push(structuredClone(working));
    if (undoStack.length > MAX_HISTORY) undoStack.shift();
    redoStack.length = 0;
    syncHistoryButtons();
  };

  /// Records the current layout for undo, then runs `change`. Everything
  /// that edits the layout goes through here.
  const mutate = (change: () => void): void => {
    pushSnapshot();
    historyKey = null; // a discrete edit ends any running gesture
    change();
    syncHistoryButtons();
  };

  /// A snapshot with no immediate change, for gestures (drag, resize,
  /// slider, typing) that mutate `cfg` continuously and should undo as one
  /// step. Repeated calls with the same `key` push only once.
  const snapshotForGesture = (key?: string): void => {
    if (key !== undefined && key === historyKey) return;
    historyKey = key ?? null;
    pushSnapshot();
  };

  const restore = (from: Layout[], to: Layout[]) => {
    const previous = from.pop();
    if (!previous) return;
    to.push(structuredClone(working));
    working = previous;
    // The selection may point at a control that no longer exists in the
    // restored layout; drop it rather than leaving the panel describing a
    // control the user cannot see.
    if (!working.controls.some((c) => c.id === selectedId)) selectedId = null;
    historyKey = null;
    rerender();
    syncHistoryButtons();
    haptic("ui");
  };

  /// The same scale play mode will use, so the editor is WYSIWYG.
  const currentScale = () => computeScale(surface) * options.getSettings().controlScale;

  const rerenderSurface = () => {
    surface.innerHTML = "";
    const s = options.getSettings();
    if (s.snapToGrid) {
      gridOverlay.style.setProperty("--grid-step", `${s.gridSize}%`);
      surface.appendChild(gridOverlay);
    }
    const scale = currentScale();
    for (const control of working.controls) {
      // Unknown types are filtered out by migrate(), but the editor must
      // not be the thing that explodes if one ever reaches it.
      if (!KNOWN_TYPES.has(control.type)) continue;
      surface.appendChild(buildEditableControl(control, scale));
    }
  };

  const rerenderInspector = () => {
    const sel = selected();
    if (!sel) {
      panel.hidden = true;
      panel.innerHTML = "";
      return;
    }
    renderInspector(panel, sel, working, {
      onChange: () => rerenderSurface(),
      pushHistory: (key) => snapshotForGesture(key),
      duplicate: (cfg) => duplicateControl(cfg),
      remove: (cfg) => removeControl(cfg),
      close: () => select(null),
    });
  };

  const rerender = () => {
    rerenderSurface();
    rerenderInspector();
  };

  const select = (id: string | null, focus: "control" | "panel" | "none" = "control") => {
    const previous = selectedId;
    selectedId = id;
    historyKey = null; // a new selection starts a new gesture
    rerender();
    if (focus === "none") return;
    if (focus === "panel" && id !== null) {
      panel.querySelector<HTMLElement>("input, select, button")?.focus();
      return;
    }
    // Falling back to the previously selected control matters when the
    // selection was CLEARED: there is no new control to focus, and the one
    // the user just closed is where they were.
    const target = id ?? previous;
    if (target) {
      surface.querySelector<HTMLElement>(`.edit-control[data-control-id="${cssEscape(target)}"]`)?.focus();
    }
  };

  const duplicateControl = (cfg: ControlConfig) => {
    mutate(() => {
      const copy = structuredClone(cfg);
      copy.id = nextId(working, cfg.type);
      // Offset the copy so it is visibly a second control rather than an
      // invisible one sitting exactly on top of the original.
      copy.x = Math.min(96, cfg.x + 6);
      copy.y = Math.min(94, cfg.y + 6);
      working.controls.push(copy);
      selectedId = copy.id;
    });
    rerender();
    haptic("ui");
  };

  const removeControl = (cfg: ControlConfig) => {
    mutate(() => {
      working.controls = working.controls.filter((c) => c.id !== cfg.id);
      if (selectedId === cfg.id) selectedId = null;
    });
    rerender();
    haptic("ui");
  };

  const snap = (value: number): number => {
    const s = options.getSettings();
    if (!s.snapToGrid) return value;
    return Math.round(value / s.gridSize) * s.gridSize;
  };

  // ---- Toolbar ----

  toolbar.innerHTML = `
    <div class="toolbar-group" role="group" aria-label="History">
      <button id="undo-edit" type="button" aria-label="Undo" title="Undo">↶</button>
      <button id="redo-edit" type="button" aria-label="Redo" title="Redo">↷</button>
    </div>
    <div class="toolbar-group" role="group" aria-label="Add control">
      <button data-add="button" type="button">+ Button</button>
      <button data-add="stick" type="button">+ Stick</button>
      <button data-add="dpad" type="button">+ D-pad</button>
      <button data-add="trigger" type="button">+ Trigger</button>
    </div>
    <div class="toolbar-group" role="group" aria-label="Layout">
      <button id="presets-btn" type="button" aria-haspopup="true" aria-expanded="false">Presets ▾</button>
      <button id="mirror-layout" type="button" title="Mirror the layout horizontally">Mirror</button>
      <button id="grid-toggle" type="button" aria-pressed="false">Grid</button>
      <button id="reset-layout" type="button">Reset default</button>
    </div>
    <div class="toolbar-group" role="group" aria-label="File">
      <button id="export-layout" type="button">Export</button>
      <button id="import-btn" type="button">Import</button>
      <input id="import-layout" type="file" accept="application/json" class="visually-hidden" />
    </div>
  `;

  const undoBtn = toolbar.querySelector<HTMLButtonElement>("#undo-edit")!;
  const redoBtn = toolbar.querySelector<HTMLButtonElement>("#redo-edit")!;
  const gridBtn = toolbar.querySelector<HTMLButtonElement>("#grid-toggle")!;

  function syncHistoryButtons(): void {
    undoBtn.disabled = undoStack.length === 0;
    redoBtn.disabled = redoStack.length === 0;
  }

  undoBtn.addEventListener("click", () => restore(undoStack, redoStack));
  redoBtn.addEventListener("click", () => restore(redoStack, undoStack));

  toolbar.querySelectorAll<HTMLButtonElement>("[data-add]").forEach((btn) => {
    btn.addEventListener("click", () => {
      const type = btn.dataset.add as ControlConfig["type"];
      mutate(() => {
        const control = newControl(working, type);
        working.controls.push(control);
        selectedId = control.id;
      });
      rerender();
      haptic("ui");
    });
  });

  const syncGridButton = () => {
    const on = options.getSettings().snapToGrid;
    gridBtn.setAttribute("aria-pressed", String(on));
    gridBtn.classList.toggle("on", on);
  };
  gridBtn.addEventListener("click", () => {
    const s = options.getSettings();
    s.snapToGrid = !s.snapToGrid;
    syncGridButton();
    rerender();
  });
  syncGridButton();

  toolbar.querySelector<HTMLButtonElement>("#mirror-layout")!.addEventListener("click", () => {
    mutate(() => {
      working.controls = mirrorLayout(working).controls;
    });
    rerender();
  });

  const presetsBtn = toolbar.querySelector<HTMLButtonElement>("#presets-btn")!;
  let presetMenu: HTMLElement | null = null;

  function onOutsidePresetPointer(e: PointerEvent): void {
    if (!presetMenu) return;
    const target = e.target as Node;
    if (presetMenu.contains(target) || presetsBtn.contains(target)) return;
    closePresets();
  }

  const repositionPresets = () => {
    if (presetMenu) positionPresetMenu(presetMenu);
  };

  const closePresets = () => {
    const hadFocus = presetMenu?.contains(document.activeElement);
    presetMenu?.remove();
    presetMenu = null;
    presetsBtn.setAttribute("aria-expanded", "false");
    // Only steal focus back if it was inside the menu; otherwise the user
    // has already moved on and yanking it would be worse than leaving it.
    if (hadFocus) presetsBtn.focus();
    window.removeEventListener("resize", repositionPresets);
    toolbar.removeEventListener("scroll", repositionPresets);
    document.removeEventListener("pointerdown", onOutsidePresetPointer, true);
  };

  const positionPresetMenu = (menu: HTMLElement) => {
    const rect = presetsBtn.getBoundingClientRect();
    // Measure first, then clamp: on a 320px-tall phone the menu is taller
    // than the space below the button, so it flips above rather than
    // running off the bottom of the screen.
    const { width, height } = menu.getBoundingClientRect();
    const margin = 8;
    const below = rect.bottom + 6;
    const fitsBelow = below + height <= window.innerHeight - margin;
    menu.style.top = fitsBelow
      ? `${below}px`
      : `${Math.max(margin, rect.top - 6 - height)}px`;
    menu.style.left = `${Math.min(
      Math.max(margin, rect.left),
      Math.max(margin, window.innerWidth - width - margin),
    )}px`;
  };

  presetsBtn.addEventListener("click", () => {
    if (presetMenu) return closePresets();
    const menu = document.createElement("div");
    presetMenu = menu;
    menu.className = "preset-menu";
    menu.setAttribute("role", "menu");
    menu.setAttribute("aria-label", "Layout presets");
    for (const preset of PRESETS) {
      const item = document.createElement("button");
      item.type = "button";
      item.setAttribute("role", "menuitem");
      item.innerHTML = `<strong></strong><span></span>`;
      item.querySelector("strong")!.textContent = preset.name;
      item.querySelector("span")!.textContent = preset.description;
      item.addEventListener("click", () => {
        mutate(() => {
          const next = preset.build();
          working.controls = next.controls;
          selectedId = null;
        });
        closePresets();
        rerender();
        haptic("ui");
      });
      menu.appendChild(item);
    }
    // Roving tabindex + arrow keys: role="menu" promises this behaviour,
    // and without it Tab walked straight out of the menu into the toolbar
    // behind it.
    const items = [...menu.querySelectorAll<HTMLButtonElement>("button")];
    items.forEach((item, i) => (item.tabIndex = i === 0 ? 0 : -1));
    menu.addEventListener("keydown", (e) => {
      const current = items.indexOf(document.activeElement as HTMLButtonElement);
      if (current < 0) return;
      let next = current;
      if (e.key === "ArrowDown") next = (current + 1) % items.length;
      else if (e.key === "ArrowUp") next = (current - 1 + items.length) % items.length;
      else if (e.key === "Home") next = 0;
      else if (e.key === "End") next = items.length - 1;
      else return;
      e.preventDefault();
      items[current].tabIndex = -1;
      items[next].tabIndex = 0;
      items[next].focus();
    });

    document.body.appendChild(menu);
    positionPresetMenu(menu);
    presetsBtn.setAttribute("aria-expanded", "true");
    items[0]?.focus();
    // A popover positioned from a rect has to follow that rect.
    window.addEventListener("resize", repositionPresets);
    toolbar.addEventListener("scroll", repositionPresets);
    document.addEventListener("pointerdown", onOutsidePresetPointer, true);
  });

  toolbar.querySelector<HTMLButtonElement>("#reset-layout")!.addEventListener("click", () => {
    if (!confirm("Reset to the default layout? This discards your current edits.")) return;
    mutate(() => {
      working.controls = defaultLayout().controls;
      selectedId = null;
    });
    rerender();
  });

  toolbar.querySelector<HTMLButtonElement>("#export-layout")!.addEventListener("click", () => {
    exportLayout(working);
  });

  const importInput = toolbar.querySelector<HTMLInputElement>("#import-layout")!;
  toolbar.querySelector<HTMLButtonElement>("#import-btn")!.addEventListener("click", () => {
    importInput.click();
  });

  importInput.addEventListener("change", async (e) => {
    const file = (e.target as HTMLInputElement).files?.[0];
    if (!file) return;
    try {
      const imported = await importLayoutFromFile(file);
      mutate(() => {
        // The imported controls replace the working set, but the profile
        // identity stays: importing into a profile should update *that*
        // profile, not silently retarget the save to the file's own id.
        working.controls = imported.controls;
        selectedId = null;
      });
      rerender();
    } catch {
      alert("That file isn't a valid layout profile.");
    }
  });

  const save = () => {
    saveLayout(working);
    options.onDone(working);
  };

  syncHistoryButtons();

  // ---- Control elements ----

  function buildEditableControl(cfg: ControlConfig, scale: number): HTMLElement {
    const el = document.createElement("div");
    el.className = "control edit-control";
    el.setAttribute("role", "button");
    el.setAttribute("aria-expanded", String(cfg.id === selectedId));
    el.tabIndex = 0;
    el.dataset.controlId = cfg.id;
    el.dataset.type = cfg.type;
    if (cfg.id === selectedId) el.classList.add("selected");
    if (cfg.tint) el.style.setProperty("--tint", cfg.tint);

    const label = "label" in cfg ? cfg.label : "D-pad";
    el.setAttribute(
      "aria-label",
      `${label}. Tap to open its properties, drag to move, corner handle to resize. ` +
        `When focused: arrow keys move, shift+arrow keys resize, enter opens properties, ` +
        `delete removes.`,
    );

    let { w, h } = dimsOf(cfg);

    const applyResize = (newW: number, newH: number): void => {
      setDims(cfg, newW, newH);
      ({ w, h } = dimsOf(cfg));
      el.style.width = `${w * scale}px`;
      el.style.height = `${h * scale}px`;
      el.dataset.compact = String(Math.min(w, h) < 58);
    };

    el.style.left = `${cfg.x}%`;
    el.style.top = `${cfg.y}%`;
    el.style.width = `${w * scale}px`;
    el.style.height = `${h * scale}px`;

    const labelSpan = document.createElement("span");
    labelSpan.className = "edit-label";
    labelSpan.textContent = label;
    el.appendChild(labelSpan);

    // The mapping is the one property that is invisible on the control
    // itself in play mode, and it is exactly what a user rearranging a
    // layout needs to see -- so it is surfaced here as a sub-label.
    const meta = document.createElement("span");
    meta.className = "edit-meta";
    meta.textContent = metaFor(cfg);
    el.appendChild(meta);
    // Two lines of text plus two corner handles do not fit on a small
    // control; the mapping line is the one that drops.
    el.dataset.compact = String(Math.min(w, h) < 58);

    const removeBtn = document.createElement("button");
    removeBtn.className = "edit-remove";
    removeBtn.type = "button";
    removeBtn.textContent = "×";
    removeBtn.setAttribute("aria-label", `Remove ${label}`);
    removeBtn.addEventListener("pointerdown", (e) => e.stopPropagation());
    removeBtn.addEventListener("click", (e) => {
      e.stopPropagation();
      removeControl(cfg);
    });
    el.appendChild(removeBtn);

    const resizeHandle = document.createElement("div");
    resizeHandle.className = "edit-resize";
    resizeHandle.setAttribute("aria-hidden", "true");
    el.appendChild(resizeHandle);

    // One finger owns a control at a time. A second finger landing mid-drag
    // used to attach a second move handler, so both fingers drove the same
    // control and it snapped back and forth between them.
    let dragPointer: number | null = null;
    let resizePointer: number | null = null;

    el.addEventListener("pointerdown", (e) => {
      if (e.target === resizeHandle || e.target === removeBtn) return;
      if (dragPointer !== null || resizePointer !== null) return;
      e.preventDefault();
      dragPointer = e.pointerId;
      el.setPointerCapture(e.pointerId);

      const startRect = el.getBoundingClientRect();
      const grabDx = e.clientX - (startRect.left + startRect.width / 2);
      const grabDy = e.clientY - (startRect.top + startRect.height / 2);
      const startX = cfg.x;
      const startY = cfg.y;
      let moved = false;

      const onMove = (ev: PointerEvent) => {
        if (ev.pointerId !== dragPointer) return;
        const parent = el.parentElement!;
        const rect = parent.getBoundingClientRect();
        const halfW = (el.offsetWidth / 2 / rect.width) * 100;
        const halfH = (el.offsetHeight / 2 / rect.height) * 100;
        const rawX = ((ev.clientX - grabDx - rect.left) / rect.width) * 100;
        const rawY = ((ev.clientY - grabDy - rect.top) / rect.height) * 100;
        if (!moved && (Math.abs(rawX - startX) > 0.4 || Math.abs(rawY - startY) > 0.4)) {
          // Snapshot on the first real movement, not on pointerdown: a tap
          // that opens the properties panel must not push an undo entry
          // that restores an identical layout.
          moved = true;
          snapshotForGesture(`drag:${cfg.id}`);
        }
        // Keep the whole control on the surface: controls are centre-anchored,
        // so the centre must stay at least half the control's size from each
        // edge or it hangs off and becomes partly untappable.
        cfg.x = clamp(snap(rawX), halfW, 100 - halfW);
        cfg.y = clamp(snap(rawY), halfH, 100 - halfH);
        el.style.left = `${cfg.x}%`;
        el.style.top = `${cfg.y}%`;
      };
      const onUp = (ev: PointerEvent) => {
        if (ev.pointerId !== dragPointer) return;
        dragPointer = null;
        historyKey = null; // the drag gesture is over
        el.removeEventListener("pointermove", onMove);
        el.removeEventListener("pointerup", onUp);
        el.removeEventListener("pointercancel", onUp);
        if (!moved) select(cfg.id === selectedId ? null : cfg.id);
        else if (cfg.id === selectedId) rerenderInspector(); // refresh the readout
      };
      el.addEventListener("pointermove", onMove);
      el.addEventListener("pointerup", onUp);
      el.addEventListener("pointercancel", onUp);
    });

    resizeHandle.addEventListener("pointerdown", (e) => {
      if (dragPointer !== null || resizePointer !== null) return;
      e.preventDefault();
      e.stopPropagation();
      resizePointer = e.pointerId;
      resizeHandle.setPointerCapture(e.pointerId);
      const startX = e.clientX;
      const startY = e.clientY;
      const startW = w;
      const startH = h;

      const onMove = (ev: PointerEvent) => {
        if (ev.pointerId !== resizePointer) return;
        // Snapshot on the first real movement, not on pointerdown: a tap
        // that resizes nothing must not leave an undo entry that restores
        // an identical layout.
        snapshotForGesture(`resize:${cfg.id}`);
        // Pointer travel is on-screen pixels; config sizes are unscaled,
        // so divide by the scale or the control would grow faster than the
        // finger on a zoomed-in surface and slower on a shrunk one.
        applyResize(
          startW + ((ev.clientX - startX) * 2) / scale,
          startH + ((ev.clientY - startY) * 2) / scale,
        );
      };
      const onUp = (ev: PointerEvent) => {
        if (ev.pointerId !== resizePointer) return;
        resizePointer = null;
        historyKey = null;
        resizeHandle.removeEventListener("pointermove", onMove);
        resizeHandle.removeEventListener("pointerup", onUp);
        resizeHandle.removeEventListener("pointercancel", onUp);
        if (cfg.id === selectedId) rerenderInspector();
      };
      resizeHandle.addEventListener("pointermove", onMove);
      resizeHandle.addEventListener("pointerup", onUp);
      resizeHandle.addEventListener("pointercancel", onUp);
    });

    el.addEventListener("keydown", (e) => {
      const step = e.shiftKey ? 5 : 1;
      switch (e.key) {
        case "ArrowUp":
        case "ArrowDown":
        case "ArrowLeft":
        case "ArrowRight": {
          e.preventDefault();
          // OS key auto-repeat fires this dozens of times a second; one
          // held arrow key must not evict the whole undo history.
          snapshotForGesture(`${e.shiftKey ? "resize" : "move"}:${cfg.id}`);
          if (e.shiftKey) {
            // Grows on Up/Right, shrinks on Down/Left -- uniform on both
            // axes, matching the single diagonal drag-resize handle.
            const dir = e.key === "ArrowUp" || e.key === "ArrowRight" ? 1 : -1;
            applyResize(w + dir * 6, h + dir * 6);
          } else {
            const parent = el.parentElement;
            const rect = parent?.getBoundingClientRect();
            const halfW = rect ? (el.offsetWidth / 2 / rect.width) * 100 : 0;
            const halfH = rect ? (el.offsetHeight / 2 / rect.height) * 100 : 0;
            if (e.key === "ArrowLeft") cfg.x = clamp(cfg.x - step, halfW, 100 - halfW);
            if (e.key === "ArrowRight") cfg.x = clamp(cfg.x + step, halfW, 100 - halfW);
            if (e.key === "ArrowUp") cfg.y = clamp(cfg.y - step, halfH, 100 - halfH);
            if (e.key === "ArrowDown") cfg.y = clamp(cfg.y + step, halfH, 100 - halfH);
            el.style.left = `${cfg.x}%`;
            el.style.top = `${cfg.y}%`;
          }
          break;
        }
        case "Escape":
          // Ends the arrow-key gesture so the next burst is its own entry.
          historyKey = null;
          break;
        case "Enter":
        case " ":
          e.preventDefault();
          select(cfg.id, "panel");
          break;
        case "d":
          // Ctrl/Cmd+D duplicates, matching the inspector's button.
          if (!e.ctrlKey && !e.metaKey) return;
          e.preventDefault();
          duplicateControl(cfg);
          break;
        case "Delete":
        case "Backspace":
          e.preventDefault();
          removeControl(cfg);
          break;
      }
    });

    return el;
  }

  // Tapping empty surface clears the selection, the standard way out of a
  // properties panel on a touch device.
  const onSurfacePointerDown = (e: PointerEvent) => {
    if (e.target === surface || e.target === gridOverlay) select(null);
  };
  surface.addEventListener("pointerdown", onSurfacePointerDown);

  const onKey = (e: KeyboardEvent) => {
    // Ignore shortcuts while typing a label in the properties panel.
    const target = e.target as HTMLElement | null;
    if (target && (target.tagName === "INPUT" || target.tagName === "SELECT")) return;
    if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "z") {
      e.preventDefault();
      if (e.shiftKey) restore(redoStack, undoStack);
      else restore(undoStack, redoStack);
    } else if (e.key === "Escape") {
      if (presetMenu) closePresets();
      else if (selectedId) select(null, "control");
      else options.onCancel();
    }
  };
  window.addEventListener("keydown", onKey);

  rerender();

  // The editor owns the surface exclusively while it is open, so its own
  // observer cannot collide with play mode's (that collision is exactly
  // what used to duplicate controls). Disconnected in teardown below.
  const observer = new ResizeObserver(() => rerenderSurface());
  observer.observe(surface);

  return {
    teardown: () => {
      observer.disconnect();
      window.removeEventListener("keydown", onKey);
      surface.removeEventListener("pointerdown", onSurfacePointerDown);
      closePresets();
      panel.remove();
    },
    isDirty: () => dirty,
    save,
  };
}

/// Escapes an id for use inside a CSS attribute selector. Control ids are
/// generated, but an imported layout can carry anything.
function cssEscape(value: string): string {
  return typeof CSS !== "undefined" && CSS.escape ? CSS.escape(value) : value.replace(/["\\]/g, "\\$&");
}

function metaFor(cfg: ControlConfig): string {
  switch (cfg.type) {
    case "button":
      return mappingFor(cfg.bit)?.name ?? `bit ${cfg.bit}`;
    case "stick":
      return cfg.stick === "left" ? "Left stick" : "Right stick";
    case "trigger":
      return cfg.trigger === "left" ? "LT" : "RT";
    case "dpad":
      return "4-way";
  }
}

function newControl(layout: Layout, type: ControlConfig["type"]): ControlConfig {
  const id = nextId(layout, type);
  // Cascade, so tapping "+ Button" repeatedly does not stack every control
  // on the same pixel with only the top one draggable.
  const step = layout.controls.length % 6;
  const x = 42 + step * 4;
  const y = 38 + step * 5;
  switch (type) {
    case "button":
      return {
        id,
        type,
        label: "New",
        bit: ButtonBit.A,
        x,
        y,
        size: 56,
        shape: "circle",
        toggle: false,
      };
    case "stick":
      // New sticks default to the right stick only because the left one is
      // present in every stock layout; it is editable either way and, unlike
      // before, is stored explicitly rather than guessed from the id.
      return { id, type, label: "Stick", x, y, size: 110, clickBit: ButtonBit.R3, stick: "right" };
    case "dpad":
      return { id, type, x, y, size: 120 };
    case "trigger":
      return { id, type, label: "Trig", x, y, width: 56, height: 90, trigger: "right" };
  }
}

function clamp(v: number, min: number, max: number): number {
  // A control wider than the surface would give min > max; keep it centred
  // rather than producing NaN-ish nonsense.
  if (min > max) return 50;
  return Math.min(max, Math.max(min, v));
}
