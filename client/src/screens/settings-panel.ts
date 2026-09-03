import type { Layout } from "../layout.ts";
import type { Settings } from "../settings.ts";
import { THEMES, ACCENT_PRESETS } from "../theme.ts";
import { mappingName } from "../mappings.ts";
import {
  listProfiles,
  activeProfileId,
  setActiveProfile,
  createProfile,
  duplicateProfile,
  renameProfile,
  deleteProfile,
  exportLayout,
} from "../profile.ts";
import { haptic } from "../haptics.ts";

export interface SettingsPanelHost {
  onChange(settings: Settings): void;
  /// The layout in force right now. Optional so callers that never switch
  /// profiles can omit it and keep the snapshot behaviour.
  getLayout?(): Layout;
  /// A profile was added, removed, renamed or switched. Separate from
  /// `onChange` because the caller has to reload the layout and re-render
  /// the surface, not merely re-read settings.
  onProfilesChanged(): void;
}

type TabId = "appearance" | "feel" | "access" | "profiles";

const TABS: { id: TabId; label: string }[] = [
  { id: "appearance", label: "Look" },
  { id: "feel", label: "Feel" },
  { id: "access", label: "Access" },
  { id: "profiles", label: "Profiles" },
];

let closeOpenPanel: (() => void) | null = null;

export function renderSettingsPanel(layout: Layout, current: Settings, host: SettingsPanelHost): void {
  if (closeOpenPanel) {
    closeOpenPanel();
    return; // acts as a toggle: second tap on the gear closes it
  }

  const overlay = document.createElement("div");
  overlay.id = "settings-overlay";
  overlay.className = "overlay";
  overlay.setAttribute("role", "dialog");
  overlay.setAttribute("aria-modal", "true");
  overlay.setAttribute("aria-label", "Settings");

  const panel = document.createElement("div");
  panel.className = "panel settings-panel";
  overlay.appendChild(panel);

  const header = document.createElement("div");
  header.className = "panel-header";
  const title = document.createElement("h2");
  title.textContent = "Settings";
  const closeBtn = document.createElement("button");
  closeBtn.id = "close-settings";
  closeBtn.type = "button";
  closeBtn.textContent = "✕";
  closeBtn.setAttribute("aria-label", "Close settings");
  header.append(title, closeBtn);
  panel.appendChild(header);

  const tabList = document.createElement("div");
  tabList.className = "tab-list";
  tabList.setAttribute("role", "tablist");
  panel.appendChild(tabList);

  const body = document.createElement("div");
  body.className = "panel-body";
  body.setAttribute("role", "tabpanel");
  panel.appendChild(body);

  const emit = (partial: Partial<Settings>) => {
    Object.assign(current, partial);
    host.onChange(current);
  };

  let activeTab: TabId = "appearance";

  const renderTabs = () => {
    tabList.innerHTML = "";
    for (const tab of TABS) {
      const btn = document.createElement("button");
      btn.type = "button";
      btn.textContent = tab.label;
      btn.setAttribute("role", "tab");
      btn.setAttribute("aria-selected", String(tab.id === activeTab));
      btn.classList.toggle("on", tab.id === activeTab);
      btn.addEventListener("click", () => {
        activeTab = tab.id;
        renderTabs();
        renderBody();
        haptic("ui");
      });
      tabList.appendChild(btn);
    }
  };

  const renderBody = () => {
    body.innerHTML = "";
    switch (activeTab) {
      case "appearance":
        renderAppearance(body, current, emit);
        break;
      case "feel":
        renderFeel(body, current, emit);
        break;
      case "access":
        // Read the layout fresh: switching profiles from the Profiles tab
        // changes which controls exist, and a captured snapshot listed the
        // previous profile's buttons under Toggle mode.
        renderAccess(body, host.getLayout?.() ?? layout, current, emit);
        break;
      case "profiles":
        renderProfiles(body, host, renderBody);
        break;
    }
  };

  renderTabs();
  renderBody();
  document.body.appendChild(overlay);

  // Focus management for a modal dialog: move focus in, trap Tab inside
  // while open, restore focus to whatever opened it on close (Escape,
  // backdrop click, or the close button) -- WCAG dialog pattern.
  const previouslyFocused = document.activeElement as HTMLElement | null;

  const close = () => {
    document.removeEventListener("keydown", onDocumentKey);
    closeOpenPanel = null;
    overlay.remove();
    previouslyFocused?.focus();
  };
  closeOpenPanel = close;

  const focusable = () =>
    [...overlay.querySelectorAll<HTMLElement>('button, input, select, [tabindex]:not([tabindex="-1"])')].filter(
      (el) => !el.hasAttribute("disabled") && el.offsetParent !== null,
    );

  const onDocumentKey = (e: KeyboardEvent) => {
    if (e.key !== "Escape" || !overlay.isConnected) return;
    e.preventDefault();
    close();
  };
  document.addEventListener("keydown", onDocumentKey);

  overlay.addEventListener("keydown", (e) => {
    if (e.key !== "Tab") return;
    const items = focusable();
    if (items.length === 0) return;
    const first = items[0];
    const last = items[items.length - 1];
    if (e.shiftKey && document.activeElement === first) {
      e.preventDefault();
      last.focus();
    } else if (!e.shiftKey && document.activeElement === last) {
      e.preventDefault();
      first.focus();
    }
  });

  closeBtn.addEventListener("click", close);
  overlay.addEventListener("click", (e) => {
    if (e.target === overlay) close();
  });

  closeBtn.focus();
}

// ---- Tabs ----

function renderAppearance(
  body: HTMLElement,
  current: Settings,
  emit: (partial: Partial<Settings>) => void,
): void {
  const themeRow = section(body, "Theme");
  const themes = document.createElement("div");
  themes.className = "theme-grid";
  for (const theme of THEMES) {
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = "theme-card";
    btn.setAttribute("aria-pressed", String(theme.id === current.theme));
    btn.classList.toggle("on", theme.id === current.theme);
    btn.innerHTML = `<span class="theme-swatch"></span><span class="theme-name"></span>`;
    const swatch = btn.querySelector<HTMLElement>(".theme-swatch")!;
    swatch.style.background = `linear-gradient(135deg, ${theme.swatch[0]} 0 52%, ${theme.swatch[1]} 52% 100%)`;
    btn.querySelector<HTMLElement>(".theme-name")!.textContent = theme.name;
    btn.addEventListener("click", () => {
      // The theme's own accent comes along, so a theme switch lands looking
      // intentional instead of inheriting the previous theme's colour.
      emit({ theme: theme.id, accent: theme.accent });
      renderReplace(body, () => renderAppearance(body, current, emit), ".theme-card.on");
    });
    themes.appendChild(btn);
  }
  themeRow.appendChild(themes);

  const accentRow = section(body, "Accent colour");
  const swatches = document.createElement("div");
  swatches.className = "swatches";
  for (const colour of ACCENT_PRESETS) {
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = "swatch";
    btn.style.background = colour;
    btn.setAttribute("aria-label", `Accent ${colour}`);
    btn.setAttribute("aria-pressed", String(colour.toLowerCase() === current.accent.toLowerCase()));
    btn.classList.toggle("on", colour.toLowerCase() === current.accent.toLowerCase());
    btn.addEventListener("click", () => {
      emit({ accent: colour });
      renderReplace(body, () => renderAppearance(body, current, emit), ".swatch.on");
    });
    swatches.appendChild(btn);
  }
  const custom = document.createElement("input");
  custom.type = "color";
  custom.className = "swatch swatch-custom";
  custom.value = current.accent;
  custom.setAttribute("aria-label", "Custom accent colour");
  custom.addEventListener("input", () => emit({ accent: custom.value }));
  swatches.appendChild(custom);
  accentRow.appendChild(swatches);

  sliderRow(body, "Control size", current.controlScale, 0.75, 1.4, 0.05, (v) => `${Math.round(v * 100)}%`, (v) =>
    emit({ controlScale: v }),
  );
  sliderRow(body, "Control opacity", current.controlOpacity, 0.35, 1, 0.05, (v) => `${Math.round(v * 100)}%`, (v) =>
    emit({ controlOpacity: v }),
  );
  switchRow(body, "Show button labels", current.showLabels, (v) => emit({ showLabels: v }));
  switchRow(body, "Background glow", current.surfaceGlow, (v) => emit({ surfaceGlow: v }));
}

function renderFeel(
  body: HTMLElement,
  current: Settings,
  emit: (partial: Partial<Settings>) => void,
): void {
  switchRow(body, "Vibration", current.haptics, (v) => emit({ haptics: v }));
  sliderRow(body, "Vibration strength", current.hapticStrength, 0, 1, 0.05, (v) =>
    v === 0 ? "Off" : `${Math.round(v * 100)}%`, (v) => emit({ hapticStrength: v }),
  );
  sliderRow(body, "Stick dead zone", current.deadZone, 0, 0.5, 0.01, (v) => `${Math.round(v * 100)}%`, (v) =>
    emit({ deadZone: v }),
  );
  sliderRow(body, "Stick sensitivity", current.sensitivityCurve, 0.5, 2, 0.1, (v) =>
    v < 0.95 ? `Fast (${v.toFixed(1)})` : v > 1.05 ? `Precise (${v.toFixed(1)})` : "Linear", (v) =>
    emit({ sensitivityCurve: v }),
  );
  switchRow(body, "Animate stick return", current.stickSnapBack, (v) => emit({ stickSnapBack: v }));
  switchRow(body, "Snap to grid when editing", current.snapToGrid, (v) => emit({ snapToGrid: v }));
  sliderRow(body, "Grid size", current.gridSize, 0.5, 10, 0.5, (v) => `${v}%`, (v) => emit({ gridSize: v }));
  hint(
    body,
    "Sensitivity above Linear gives finer control near the centre of the stick; below it moves further per millimetre.",
  );
}

function renderAccess(
  body: HTMLElement,
  layout: Layout,
  current: Settings,
  emit: (partial: Partial<Settings>) => void,
): void {
  switchRow(body, "High-contrast mode", current.highContrast, (v) => emit({ highContrast: v }));
  switchRow(body, "Reduce motion", current.reduceMotion, (v) => emit({ reduceMotion: v }));

  const toggles = section(body, "Toggle mode");
  hint(toggles, "Press once to hold the button down, press again to release it.");
  const buttons = layout.controls.filter((c) => c.type === "button");
  if (buttons.length === 0) {
    hint(toggles, "This layout has no buttons yet.");
    return;
  }
  for (const control of buttons) {
    if (control.type !== "button") continue;
    switchRow(
      toggles,
      `${control.label} — ${mappingName(control.bit)}`,
      current.toggleButtonIds.includes(control.id),
      (on) => {
        const set = new Set(current.toggleButtonIds);
        if (on) set.add(control.id);
        else set.delete(control.id);
        emit({ toggleButtonIds: [...set] });
      },
    );
  }
}

function renderProfiles(body: HTMLElement, host: SettingsPanelHost, refresh: () => void): void {
  const profiles = listProfiles();
  const active = activeProfileId();

  hint(body, "Each profile is a complete layout. Switch between them from the bar at the top.");

  const list = document.createElement("div");
  list.className = "profile-list";
  for (const profile of profiles) {
    const item = document.createElement("div");
    item.className = "profile-item";
    if (profile.id === active) item.classList.add("on");

    const use = document.createElement("button");
    use.type = "button";
    use.className = "profile-use";
    use.innerHTML = `<strong></strong><span></span>`;
    use.querySelector("strong")!.textContent = profile.name;
    use.querySelector("span")!.textContent =
      `${profile.controls.length} control${profile.controls.length === 1 ? "" : "s"}` +
      (profile.id === active ? " · active" : "");
    use.addEventListener("click", () => {
      setActiveProfile(profile.id);
      host.onProfilesChanged();
      refresh();
    });

    const actions = document.createElement("div");
    actions.className = "profile-actions";

    const rename = smallButton("Rename", () => {
      const name = prompt("Profile name", profile.name);
      if (name === null) return;
      renameProfile(profile.id, name);
      host.onProfilesChanged();
      refresh();
    });
    const dup = smallButton("Duplicate", () => {
      duplicateProfile(profile.id);
      host.onProfilesChanged();
      refresh();
    });
    const exp = smallButton("Export", () => exportLayout(profile));
    const del = smallButton("Delete", () => {
      if (!confirm(`Delete the "${profile.name}" profile? This can't be undone.`)) return;
      // The store refuses to delete the last profile; reflect that here
      // instead of leaving the user tapping a button that does nothing.
      if (!deleteProfile(profile.id)) {
        alert("This is your only profile, so it can't be deleted.");
        return;
      }
      host.onProfilesChanged();
      refresh();
    });
    del.classList.add("danger");
    del.disabled = profiles.length <= 1;

    actions.append(rename, dup, exp, del);
    item.append(use, actions);
    list.appendChild(item);
  }
  body.appendChild(list);

  const add = document.createElement("button");
  add.type = "button";
  add.className = "full-width";
  add.textContent = "+ New profile";
  add.addEventListener("click", () => {
    const name = prompt("Name for the new profile", "My layout");
    if (name === null) return;
    createProfile(name);
    host.onProfilesChanged();
    refresh();
  });
  body.appendChild(add);
}

// ---- Row builders ----

/// Re-renders a tab in place and restores focus to the control matching
/// `refocus`. Without the refocus a keyboard or switch user is dropped onto
/// <body> every time they pick a theme, losing their place in the dialog.
function renderReplace(body: HTMLElement, render: () => void, refocus?: string): void {
  body.innerHTML = "";
  render();
  if (refocus) body.querySelector<HTMLElement>(refocus)?.focus();
}

function section(parent: HTMLElement, title: string): HTMLElement {
  const wrap = document.createElement("section");
  wrap.className = "settings-section";
  const heading = document.createElement("h3");
  heading.textContent = title;
  wrap.appendChild(heading);
  parent.appendChild(wrap);
  return wrap;
}

function hint(parent: HTMLElement, text: string): void {
  const p = document.createElement("p");
  p.className = "hint";
  p.textContent = text;
  parent.appendChild(p);
}

function switchRow(parent: HTMLElement, labelText: string, value: boolean, onChange: (v: boolean) => void): void {
  const label = document.createElement("label");
  label.className = "switch-row";
  const span = document.createElement("span");
  span.textContent = labelText;
  const input = document.createElement("input");
  input.type = "checkbox";
  input.className = "switch";
  input.checked = value;
  input.addEventListener("change", () => {
    onChange(input.checked);
    haptic("ui");
  });
  label.append(span, input);
  parent.appendChild(label);
}

function sliderRow(
  parent: HTMLElement,
  labelText: string,
  value: number,
  min: number,
  max: number,
  step: number,
  format: (v: number) => string,
  onInput: (v: number) => void,
): void {
  const label = document.createElement("label");
  label.className = "slider-row";
  const head = document.createElement("span");
  head.className = "slider-head";
  const text = document.createElement("span");
  text.textContent = labelText;
  const readout = document.createElement("span");
  readout.className = "slider-value";
  readout.textContent = format(value);
  head.append(text, readout);
  const input = document.createElement("input");
  input.type = "range";
  input.min = String(min);
  input.max = String(max);
  input.step = String(step);
  input.value = String(value);
  input.addEventListener("input", () => {
    const v = Number(input.value);
    readout.textContent = format(v);
    onInput(v);
  });
  label.append(head, input);
  parent.appendChild(label);
}

function smallButton(text: string, onClick: () => void): HTMLButtonElement {
  const btn = document.createElement("button");
  btn.type = "button";
  btn.className = "small";
  btn.textContent = text;
  btn.addEventListener("click", onClick);
  return btn;
}
