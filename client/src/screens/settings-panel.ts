import type { Layout } from "../layout.ts";
import type { Settings } from "../settings.ts";
import { THEMES, ACCENT_PRESETS, BUTTON_MATERIALS, DPAD_STYLES, applyBackground } from "../theme.ts";
import { promptDialog, confirmDialog, alertDialog } from "../dialog.ts";
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
  setProfileColor,
  setProfileBackground,
} from "../profile.ts";
import { haptic } from "../haptics.ts";
import { isStandalone, maybeOfferShortcut } from "../install.ts";
import { ICON_PACKS } from "../iconPacks.ts";
import { listSkins, saveSkin, deleteSkin, randomAppearance, type Skin, type SkinAppearance } from "../skins.ts";
import { buildShareUrl, renderQrCanvas } from "../share.ts";

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
  body.id = "settings-tabpanel";
  body.setAttribute("role", "tabpanel");
  panel.appendChild(body);

  const emit = (partial: Partial<Settings>) => {
    Object.assign(current, partial);
    host.onChange(current);
  };

  let activeTab: TabId = "appearance";
  const tabButtons: HTMLButtonElement[] = [];

  /// Selects a tab and keeps the ARIA state in step. The tablist is a single
  /// tab stop (roving tabindex): Tab moves past it into the panel, and the
  /// arrow keys move between tabs, which is what the tab role promises.
  const selectTab = (id: TabId, moveFocus: boolean) => {
    activeTab = id;
    for (const btn of tabButtons) {
      const on = btn.dataset.tab === id;
      btn.setAttribute("aria-selected", String(on));
      btn.tabIndex = on ? 0 : -1;
      btn.classList.toggle("on", on);
      if (on && moveFocus) btn.focus();
    }
    body.setAttribute("aria-labelledby", `settings-tab-${id}`);
    renderBody();
  };

  const onTabKey = (e: KeyboardEvent) => {
    const index = tabButtons.findIndex((b) => b === e.target);
    if (index < 0) return;
    let next = index;
    if (e.key === "ArrowRight") next = (index + 1) % tabButtons.length;
    else if (e.key === "ArrowLeft") next = (index - 1 + tabButtons.length) % tabButtons.length;
    else if (e.key === "Home") next = 0;
    else if (e.key === "End") next = tabButtons.length - 1;
    else return;
    e.preventDefault();
    selectTab(TABS[next].id, true);
    haptic("ui");
  };

  const buildTabs = () => {
    for (const tab of TABS) {
      const btn = document.createElement("button");
      btn.type = "button";
      btn.id = `settings-tab-${tab.id}`;
      btn.dataset.tab = tab.id;
      btn.textContent = tab.label;
      btn.setAttribute("role", "tab");
      btn.setAttribute("aria-controls", body.id);
      btn.addEventListener("click", () => {
        selectTab(tab.id, false);
        haptic("ui");
      });
      btn.addEventListener("keydown", onTabKey);
      tabButtons.push(btn);
      tabList.appendChild(btn);
    }
  };

  const renderBody = () => {
    body.innerHTML = "";
    switch (activeTab) {
      case "appearance":
        renderAppearance(body, current, emit, host);
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

  buildTabs();
  selectTab(activeTab, false);
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
      // tabIndex < 0 skips the unselected tabs: the tablist is one stop, so
      // Tab has to step over them the way the browser itself would.
      (el) => !el.hasAttribute("disabled") && el.offsetParent !== null && el.tabIndex >= 0,
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
  host: SettingsPanelHost,
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
      renderReplace(body, () => renderAppearance(body, current, emit, host), ".theme-card.on");
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
      renderReplace(body, () => renderAppearance(body, current, emit, host), ".swatch.on");
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
  choiceRow(
    body,
    "Button material",
    BUTTON_MATERIALS.map((m) => ({ value: m.id, label: m.name })),
    current.buttonMaterial,
    (v) => emit({ buttonMaterial: v }),
  );
  choiceRow(
    body,
    "D-pad style",
    DPAD_STYLES.map((d) => ({ value: d.id, label: d.name })),
    current.dpadStyle,
    (v) => emit({ dpadStyle: v }),
  );
  choiceRow(
    body,
    "Face button icons",
    ICON_PACKS.map((p) => ({ value: p.id, label: p.name })),
    current.iconPack,
    (v) => emit({ iconPack: v }),
  );
  hint(body, "Purely cosmetic — A/B/X/Y still send Xbox input either way. A control you've relabelled yourself keeps its own text.");

  sliderRow(body, "Press glow", current.glowIntensity, 0, 1.5, 0.05, (v) =>
    v === 0 ? "Off" : `${Math.round(v * 100)}%`, (v) => emit({ glowIntensity: v }),
  );
  switchRow(body, "Show button labels", current.showLabels, (v) => emit({ showLabels: v }));
  switchRow(body, "Background glow", current.surfaceGlow, (v) => emit({ surfaceGlow: v }));

  renderBackgroundSection(body, current, emit, host);
  renderSkinsSection(body, current, emit, host);

  choiceRow(
    body,
    "Dim when idle",
    IDLE_DIM_CHOICES,
    // Match on the stored number so a hand-edited value still highlights the
    // nearest offered option rather than leaving the group with none pressed.
    nearestIdleChoice(current.idleDimSeconds),
    (v) => emit({ idleDimSeconds: v }),
  );
  hint(body, "The controls fade after this long with no input, and come straight back on the next touch.");

  // Only worth offering when it would change something. Launched from a
  // Home Screen icon the browser chrome is already gone, and on a desktop
  // browser there is nowhere to put an icon in the first place.
  if (!isStandalone()) {
    const shortcut = document.createElement("button");
    shortcut.type = "button";
    shortcut.className = "full-width";
    shortcut.textContent = "Play fullscreen — add to Home Screen";
    shortcut.addEventListener("click", () => {
      haptic("ui");
      // Closes the panel first: the card renders over the play surface, and
      // the panel sits on top of it.
      closeOpenPanel?.();
      const surface = document.querySelector<HTMLElement>(".surface-wrap");
      // `force` because this is an explicit request, so an earlier dismissal
      // must not silently do nothing.
      if (surface) void maybeOfferShortcut(surface, true);
    });
    body.appendChild(shortcut);
    hint(body, "Removes the browser's address bar and toolbar, and pins an address that survives your PC changing IP.");
  }
}

/// Base64 inflates a file by roughly a third; capped comfortably under
/// profile.ts's MAX_BACKGROUND_IMAGE_BYTES so a file that looks acceptable
/// here doesn't get silently dropped by that sanitizer afterwards.
const MAX_BACKGROUND_IMAGE_FILE_BYTES = 1_400_000;

function renderBackgroundSection(
  body: HTMLElement,
  current: Settings,
  emit: (partial: Partial<Settings>) => void,
  host: SettingsPanelHost,
): void {
  const layout = host.getLayout?.();
  if (!layout) return;
  const bg = layout.background;

  const apply = (next: Layout["background"]) => {
    setProfileBackground(layout.id, next);
    applyBackground(next);
    host.onProfilesChanged();
    renderReplace(body, () => renderAppearance(body, current, emit, host));
  };

  const section_ = section(body, "Background");
  hint(section_, "A backdrop for this profile only, layered behind the theme's usual glow.");

  const mode = bg?.type ?? "none";
  const modeRow = document.createElement("div");
  modeRow.className = "segmented";
  modeRow.setAttribute("role", "radiogroup");
  modeRow.setAttribute("aria-label", "Background type");
  const options: [string, string][] = [
    ["none", "None"],
    ["color", "Colour"],
    ["image", "Photo"],
  ];
  for (const [value, text] of options) {
    const btn = document.createElement("button");
    btn.type = "button";
    btn.textContent = text;
    btn.setAttribute("role", "radio");
    btn.setAttribute("aria-checked", String(value === mode));
    if (value === mode) btn.classList.add("on");
    btn.addEventListener("click", () => {
      haptic("ui");
      if (value === "none") apply(undefined);
      else if (value === "color") apply({ type: "color", value: "#1a1d24" });
      // "image" alone does nothing yet -- it's chosen by picking a file
      // below, so switching to it here would otherwise clear a working
      // background for no visible result.
    });
    modeRow.appendChild(btn);
  }
  section_.appendChild(modeRow);

  if (mode === "color") {
    const picker = document.createElement("input");
    picker.type = "color";
    picker.className = "swatch swatch-custom";
    picker.value = /^#[0-9a-f]{6}$/i.test(bg?.value ?? "") ? bg!.value : "#1a1d24";
    picker.setAttribute("aria-label", "Background colour");
    picker.addEventListener("input", () => apply({ type: "color", value: picker.value }));
    section_.appendChild(picker);
  }

  if (mode === "image") {
    if (bg?.type === "image") {
      const preview = document.createElement("img");
      preview.className = "bg-preview";
      preview.src = bg.value;
      preview.alt = "Current background photo";
      section_.appendChild(preview);
    }
    const chooseBtn = document.createElement("button");
    chooseBtn.type = "button";
    chooseBtn.className = "small";
    chooseBtn.textContent = bg?.type === "image" ? "Choose a different photo" : "Choose a photo";
    const fileInput = document.createElement("input");
    fileInput.type = "file";
    fileInput.accept = "image/*";
    fileInput.className = "visually-hidden";
    fileInput.tabIndex = -1;
    chooseBtn.addEventListener("click", () => fileInput.click());
    fileInput.addEventListener("change", async () => {
      const file = fileInput.files?.[0];
      if (!file) return;
      if (file.size > MAX_BACKGROUND_IMAGE_FILE_BYTES) {
        await alertDialog(
          "That photo is too big",
          `Pick something under ${Math.round(MAX_BACKGROUND_IMAGE_FILE_BYTES / 1_000_000)}MB — a phone's full-resolution camera roll photo is usually well past what a background needs.`,
        );
        return;
      }
      const dataUrl = await new Promise<string>((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve(reader.result as string);
        reader.onerror = () => reject(reader.error);
        reader.readAsDataURL(file);
      });
      apply({ type: "image", value: dataUrl });
    });
    section_.append(chooseBtn, fileInput);
  }
}

/// Skins bundle Look settings (theme, accent, material, d-pad, glow, icon
/// pack) under a name, independent of any one profile's layout -- see
/// skins.ts for why they're kept separate from profiles.
function renderSkinsSection(
  body: HTMLElement,
  current: Settings,
  emit: (partial: Partial<Settings>) => void,
  host: SettingsPanelHost,
): void {
  const section_ = section(body, "My skins");
  hint(section_, "Save the look you've built (theme, accent, material, d-pad, glow, icons) and reapply it to any profile.");

  const refresh = () => renderReplace(body, () => renderAppearance(body, current, emit, host));

  const actions = document.createElement("div");
  actions.className = "inspector-actions";

  const remix = document.createElement("button");
  remix.type = "button";
  remix.textContent = "🎲 Remix";
  remix.title = "Try a random combination";
  remix.addEventListener("click", () => {
    haptic("ui");
    emit(randomAppearance());
    refresh();
  });

  const save = document.createElement("button");
  save.type = "button";
  save.textContent = "Save current look…";
  save.addEventListener("click", async () => {
    const name = await promptDialog("Save this look as a skin", {
      label: "Skin name",
      value: "My skin",
      confirmLabel: "Save",
    });
    if (name === null) return;
    const appearance: SkinAppearance = {
      theme: current.theme,
      accent: current.accent,
      buttonMaterial: current.buttonMaterial,
      dpadStyle: current.dpadStyle,
      glowIntensity: current.glowIntensity,
      iconPack: current.iconPack,
    };
    saveSkin(name, appearance);
    refresh();
  });

  actions.append(remix, save);
  section_.appendChild(actions);

  const skins = listSkins();
  if (skins.length === 0) {
    hint(section_, "No saved skins yet.");
    return;
  }
  const list = document.createElement("div");
  list.className = "profile-list";
  for (const skin of skins) {
    list.appendChild(skinRow(skin, current, emit, refresh));
  }
  section_.appendChild(list);
}

function skinRow(
  skin: Skin,
  current: Settings,
  emit: (partial: Partial<Settings>) => void,
  refresh: () => void,
): HTMLElement {
  const item = document.createElement("div");
  item.className = "profile-item";
  const isActive =
    current.theme === skin.theme &&
    current.accent.toLowerCase() === skin.accent.toLowerCase() &&
    current.buttonMaterial === skin.buttonMaterial &&
    current.dpadStyle === skin.dpadStyle &&
    current.iconPack === skin.iconPack;
  if (isActive) item.classList.add("on");

  const use = document.createElement("button");
  use.type = "button";
  use.className = "profile-use";
  use.innerHTML = `<span class="profile-use-title"><span class="profile-dot" style="background:${skin.accent}"></span><strong></strong></span>`;
  use.querySelector("strong")!.textContent = skin.name;
  use.addEventListener("click", () => {
    haptic("ui");
    emit({
      theme: skin.theme,
      accent: skin.accent,
      buttonMaterial: skin.buttonMaterial,
      dpadStyle: skin.dpadStyle,
      glowIntensity: skin.glowIntensity,
      iconPack: skin.iconPack,
    });
    refresh();
  });

  const del = smallButton("Delete", () => {
    deleteSkin(skin.id);
    refresh();
  });
  del.classList.add("danger");

  const actions = document.createElement("div");
  actions.className = "profile-actions";
  actions.appendChild(del);

  item.append(use, actions);
  return item;
}

const IDLE_DIM_CHOICES: { value: number; label: string }[] = [
  { value: 0, label: "Off" },
  { value: 5, label: "5 s" },
  { value: 10, label: "10 s" },
  { value: 30, label: "30 s" },
];

function nearestIdleChoice(seconds: number): number {
  if (!Number.isFinite(seconds) || seconds <= 0) return 0;
  return IDLE_DIM_CHOICES.reduce((best, c) =>
    Math.abs(c.value - seconds) < Math.abs(best.value - seconds) ? c : best,
  ).value;
}

function renderFeel(
  body: HTMLElement,
  current: Settings,
  emit: (partial: Partial<Settings>) => void,
): void {
  switchRow(body, "Vibration", current.haptics, (v) => emit({ haptics: v }));
  const strengthRow = sliderRow(body, "Vibration strength", current.hapticStrength, 0, 1, 0.05, (v) =>
    v === 0 ? "Off" : `${Math.round(v * 100)}%`, (v) => emit({ hapticStrength: v }),
  );
  const testBtn = document.createElement("button");
  testBtn.type = "button";
  testBtn.className = "small";
  testBtn.textContent = "Test";
  // configureHaptics() has already been called by the time this fires --
  // emit() runs applySettings() synchronously on every slider input -- so
  // this always buzzes at whatever strength is currently on screen, not a
  // stale value from when the panel opened.
  testBtn.addEventListener("click", () => haptic("click"));
  strengthRow.appendChild(testBtn);
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

  // The dialogs return focus to the button that opened them, which the
  // re-render then removes; put focus somewhere real instead of on <body>.
  const refreshAndFocus = () => {
    refresh();
    body.querySelector<HTMLElement>(".profile-item.on .profile-use")?.focus();
  };

  hint(body, "Each profile is a complete layout. Switch between them from the bar at the top.");

  const list = document.createElement("div");
  list.className = "profile-list";
  for (const profile of profiles) {
    const item = document.createElement("div");
    item.className = "profile-item";
    if (profile.id === active) item.classList.add("on");

    const colorDot = document.createElement("input");
    colorDot.type = "color";
    colorDot.className = "profile-color-picker";
    colorDot.value = /^#[0-9a-f]{6}$/i.test(profile.color ?? "") ? profile.color! : "#4c8bff";
    colorDot.setAttribute("aria-label", `${profile.name} colour`);
    colorDot.title = "Profile colour";
    colorDot.addEventListener("input", () => {
      setProfileColor(profile.id, colorDot.value);
      // No full refresh: recolouring the dot itself is enough feedback, and
      // a refresh mid-drag on a colour wheel would fight the native picker.
    });

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

    const rename = smallButton("Rename", async () => {
      const name = await promptDialog("Rename profile", {
        label: "Profile name",
        value: profile.name,
        confirmLabel: "Save",
      });
      if (name === null) return;
      renameProfile(profile.id, name);
      host.onProfilesChanged();
      refreshAndFocus();
    });
    const dup = smallButton("Duplicate", () => {
      duplicateProfile(profile.id);
      host.onProfilesChanged();
      refresh();
    });
    const exp = smallButton("Export", () => exportLayout(profile));
    const share = smallButton("Share", () => showShareDialog(profile));
    const del = smallButton("Delete", async () => {
      const ok = await confirmDialog("Delete profile", {
        body: `"${profile.name}" and its layout will be removed. This can't be undone.`,
        confirmLabel: "Delete",
        danger: true,
      });
      if (!ok) return;
      // The store refuses to delete the last profile; reflect that here
      // instead of leaving the user tapping a button that does nothing.
      if (!deleteProfile(profile.id)) {
        await alertDialog("Can't delete this profile", "It's your only one, so there'd be nothing left to play with.");
        return;
      }
      host.onProfilesChanged();
      refreshAndFocus();
    });
    del.classList.add("danger");
    del.disabled = profiles.length <= 1;

    actions.append(rename, dup, exp, share, del);
    const headRow = document.createElement("div");
    headRow.className = "profile-head";
    headRow.append(colorDot, use);
    item.append(headRow, actions);
    list.appendChild(item);
  }
  body.appendChild(list);

  const add = document.createElement("button");
  add.type = "button";
  add.className = "full-width";
  add.textContent = "+ New profile";
  add.addEventListener("click", async () => {
    const name = await promptDialog("New profile", {
      label: "Name",
      value: "My layout",
      confirmLabel: "Create",
    });
    if (name === null) return;
    createProfile(name);
    host.onProfilesChanged();
    refreshAndFocus();
  });
  body.appendChild(add);
}

/// A lightweight overlay (not the confirm/prompt/alert trio in dialog.ts,
/// which only ever show text) carrying the QR code a friend on the same
/// Wi-Fi can scan to pick up this exact layout -- see share.ts for why a
/// URL fragment is enough with no server-side relay.
function showShareDialog(profile: Layout): void {
  const overlay = document.createElement("div");
  // "dialog-overlay" (not just "overlay"): this opens from inside the
  // settings panel, which is itself an overlay, and needs the same
  // above-it stacking dialog.ts's confirm/prompt dialogs get.
  overlay.className = "overlay dialog-overlay";
  overlay.setAttribute("role", "dialog");
  overlay.setAttribute("aria-modal", "true");
  overlay.setAttribute("aria-label", `Share ${profile.name}`);

  const panel = document.createElement("div");
  panel.className = "panel dialog-panel share-panel";
  overlay.appendChild(panel);

  const title = document.createElement("h2");
  title.textContent = `Share "${profile.name}"`;
  panel.appendChild(title);

  const url = buildShareUrl(profile);
  if (url === null) {
    const body = document.createElement("p");
    body.className = "dialog-body";
    body.textContent =
      "This layout is too large to fit in a QR code. Use Export instead, and send the file directly.";
    panel.appendChild(body);
  } else {
    const body = document.createElement("p");
    body.className = "dialog-body";
    body.textContent = "On the same Wi-Fi, scan this with another phone's camera to pick up this layout.";
    panel.appendChild(body);

    const canvas = renderQrCanvas(url, 240);
    canvas.className = "share-qr";
    panel.appendChild(canvas);

    if (profile.background?.type === "image") {
      const note = document.createElement("p");
      note.className = "hint";
      note.textContent = "The custom background photo isn't included — it's shared with the rest of the look.";
      panel.appendChild(note);
    }
  }

  const actions = document.createElement("div");
  actions.className = "dialog-actions";
  const closeBtn = document.createElement("button");
  closeBtn.type = "button";
  closeBtn.className = "dialog-confirm";
  closeBtn.textContent = "Close";
  const close = () => {
    document.removeEventListener("keydown", onKey);
    overlay.remove();
  };
  closeBtn.addEventListener("click", close);
  actions.appendChild(closeBtn);
  panel.appendChild(actions);

  overlay.addEventListener("pointerdown", (e) => {
    if (e.target === overlay) close();
  });
  const onKey = (e: KeyboardEvent) => {
    if (e.key === "Escape") close();
  };
  document.addEventListener("keydown", onKey);

  document.body.appendChild(overlay);
  closeBtn.focus();
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

let choiceGroupSeq = 0;

/// A labelled set of mutually exclusive options, in the same pressed-button
/// language as the theme cards. Updates its own pressed state in place rather
/// than re-rendering the tab: several groups share a tab, so a re-render's
/// refocus-by-selector would land on the wrong group's chip.
function choiceRow<T extends string | number>(
  parent: HTMLElement,
  title: string,
  options: { value: T; label: string }[],
  value: T,
  onPick: (v: T) => void,
): void {
  const wrap = section(parent, title);
  const heading = wrap.querySelector("h3")!;
  heading.id = `choice-group-${++choiceGroupSeq}`;

  const group = document.createElement("div");
  group.className = "choice-group";
  group.setAttribute("role", "group");
  group.setAttribute("aria-labelledby", heading.id);

  const chips: { chip: HTMLButtonElement; value: T }[] = [];
  const mark = (picked: T) => {
    for (const { chip, value: v } of chips) {
      chip.setAttribute("aria-pressed", String(v === picked));
      chip.classList.toggle("on", v === picked);
    }
  };

  for (const option of options) {
    const chip = document.createElement("button");
    chip.type = "button";
    chip.className = "choice-chip";
    chip.textContent = option.label;
    chip.addEventListener("click", () => {
      mark(option.value);
      onPick(option.value);
      haptic("ui");
    });
    chips.push({ chip, value: option.value });
    group.appendChild(chip);
  }
  mark(value);
  wrap.appendChild(group);
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
): HTMLLabelElement {
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
  return label;
}

function smallButton(text: string, onClick: () => void): HTMLButtonElement {
  const btn = document.createElement("button");
  btn.type = "button";
  btn.className = "small";
  btn.textContent = text;
  btn.addEventListener("click", onClick);
  return btn;
}
