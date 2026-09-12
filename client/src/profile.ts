import type { Layout } from "./layout.ts";
import { defaultLayout } from "./layout.ts";
import { ACCENT_PRESETS } from "./theme.ts";

const STORE_KEY = "controller-profiles-v1";
/// The pre-multi-profile key. Read once, on first load after upgrading, so
/// an existing user's customised layout becomes their first profile instead
/// of being silently discarded.
const LEGACY_KEY = "controller-layout-v1";

export interface ProfileStore {
  activeId: string;
  profiles: Layout[];
}

function emptyStore(): ProfileStore {
  const layout = defaultLayout();
  return { activeId: layout.id, profiles: [layout] };
}

function readStore(): ProfileStore {
  try {
    const raw = localStorage.getItem(STORE_KEY);
    if (raw) {
      const parsed = JSON.parse(raw) as ProfileStore;
      if (Array.isArray(parsed.profiles) && parsed.profiles.length > 0) {
        const profiles = parsed.profiles.filter((p) => p && Array.isArray(p.controls)).map(migrate);
        if (profiles.length === 0) return emptyStore();
        const activeId = profiles.some((p) => p.id === parsed.activeId)
          ? parsed.activeId
          : profiles[0].id;
        return { activeId, profiles };
      }
    }

    const legacy = localStorage.getItem(LEGACY_KEY);
    if (legacy) {
      const layout = migrate(JSON.parse(legacy) as Layout);
      if (Array.isArray(layout.controls)) {
        const store = { activeId: layout.id, profiles: [layout] };
        writeStore(store);
        return store;
      }
    }
  } catch {
    // Corrupt or unavailable storage — fall through to a clean default
    // rather than leaving the app with no layout at all.
  }
  return emptyStore();
}

function writeStore(store: ProfileStore): void {
  try {
    localStorage.setItem(STORE_KEY, JSON.stringify(store));
  } catch {
    // localStorage unavailable — edits just won't persist across reloads.
  }
}

/// Valid control types. Anything else is dropped rather than rendered:
/// see the comment on buildControl in controls.ts for what an unknown type
/// used to do to the whole app.
const KNOWN_TYPES = new Set(["button", "dpad", "stick", "trigger"]);

// `1 << bit` masks to 5 bits in JS, so an out-of-range value silently
// becomes a different real button. Clamp instead.
const MAX_BUTTON_BIT = 13;

function num(value: unknown, min: number, max: number, fallback: number): number {
  if (typeof value !== "number" || !Number.isFinite(value)) return fallback;
  return Math.min(max, Math.max(min, value));
}

function bit(value: unknown, fallback: number): number {
  // Integers only. Rounding 2.9 to 3 would turn a value that was never
  // valid into a confident mapping to a different real button.
  if (!Number.isInteger(value)) return fallback;
  const n = value as number;
  return n >= 0 && n <= MAX_BUTTON_BIT ? n : fallback;
}

const HEX_COLOR = /^#[0-9a-f]{6}$/i;

/// Caps a stored background image so one huge photo can't blow past
/// localStorage's ~5MB quota (which is shared with every other profile,
/// every skin, and the settings blob) and silently take the whole app's
/// persistence down with it.
const MAX_BACKGROUND_IMAGE_BYTES = 2_000_000;

/// Exported so share.ts can run an incoming scanned/pasted layout through
/// exactly the same validation a file import gets, rather than trusting
/// whatever a QR code decoded to.
export function sanitizeLayout(layout: Layout): Layout {
  return migrate(layout);
}

function migrate(layout: Layout): Layout {
  if (typeof layout.color !== "string" || !HEX_COLOR.test(layout.color)) {
    delete layout.color;
  }
  if (layout.background) {
    const bg = layout.background;
    const validType = bg.type === "color" || bg.type === "image";
    const validValue =
      typeof bg.value === "string" &&
      (bg.type === "color" ? HEX_COLOR.test(bg.value) : bg.value.length <= MAX_BACKGROUND_IMAGE_BYTES);
    if (!validType || !validValue) delete layout.background;
  }

  const filtered = (layout.controls ?? []).filter(
    (control) => control && KNOWN_TYPES.has((control as { type?: string }).type ?? ""),
  );

  // Every id already present in the file, so a freshly-minted fallback id
  // can never collide with a real id that happens to appear LATER in the
  // array -- checking only ids seen so far missed that case.
  const reserved = new Set<string>();
  for (const control of filtered) {
    if (typeof control.id === "string" && control.id) reserved.add(control.id);
  }
  // Ids actually assigned as we walk, to still catch true duplicates (two
  // controls sharing one real id).
  const used = new Set<string>();

  const controls = filtered.map((control) => {
    const c = { ...control };

    // Geometry: percentages of the surface, and sizes in px. Unclamped, an
    // imported file could place a control 900,000px off-screen or size it
    // to 2px, leaving a layout that looks broken with no way to tell why.
    c.x = num(c.x, 0, 100, 50);
    c.y = num(c.y, 0, 100, 50);
    if (c.type === "trigger") {
      c.width = num(c.width, 30, 200, 56);
      c.height = num(c.height, 30, 200, 90);
    } else {
      c.size = num(c.size, 30, 200, 56);
      if (c.type === "button" && c.width !== undefined) {
        c.width = num(c.width, 30, 200, c.size);
        c.height = num(c.height, 30, 200, c.size);
      }
    }
    if (c.type === "button") c.bit = bit(c.bit, 0);
    if (c.type === "stick") {
      c.clickBit = bit(c.clickBit, c.stick === "left" ? 10 : 11);
      if (c.deadZone !== undefined) c.deadZone = num(c.deadZone, 0, 0.5, 0.12);
    }

    if (c.type === "stick" && c.stick !== "left" && c.stick !== "right") {
      c.stick = c.id === "left-stick" ? "left" : "right";
    }
    if (c.type === "trigger" && c.trigger !== "left" && c.trigger !== "right") {
      c.trigger = c.id === "lt" ? "left" : "right";
    }
    if (c.type === "button" && c.shape === undefined) {
      const w = c.width ?? c.size;
      const h = c.height ?? c.size;
      c.shape = w !== h ? "pill" : "circle";
    }

    let id = c.id;
    let n = 0;
    while (!id || used.has(id)) {
      id = `${c.type}-${n++}`;
      while (reserved.has(id)) id = `${c.type}-${n++}`;
    }
    used.add(id);
    c.id = id;

    return c;
  });

  return {
    ...layout,
    id: layout.id || `profile-${Date.now()}`,
    name: layout.name || "Untitled",
    controls,
  };
}

// ---- Active layout (the API the controller screen uses) ----

export function loadLayout(): Layout {
  const store = readStore();
  return store.profiles.find((p) => p.id === store.activeId) ?? store.profiles[0];
}

/// Saves `layout` back over the profile with the same id, creating it if it
/// is new, and makes it active.
export function saveLayout(layout: Layout): void {
  const store = readStore();
  const index = store.profiles.findIndex((p) => p.id === layout.id);
  if (index >= 0) store.profiles[index] = layout;
  else store.profiles.push(layout);
  store.activeId = layout.id;
  writeStore(store);
}

// ---- Profile management ----

export function listProfiles(): Layout[] {
  return readStore().profiles;
}

export function activeProfileId(): string {
  return readStore().activeId;
}

export function setActiveProfile(id: string): Layout {
  const store = readStore();
  if (store.profiles.some((p) => p.id === id)) {
    store.activeId = id;
    writeStore(store);
  }
  return loadLayout();
}

function uniqueProfileId(store: ProfileStore, name: string): string {
  const base =
    name
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "") || "profile";
  const taken = new Set(store.profiles.map((p) => p.id));
  if (!taken.has(base)) return base;
  let n = 2;
  while (taken.has(`${base}-${n}`)) n += 1;
  return `${base}-${n}`;
}

export function createProfile(name: string, from?: Layout): Layout {
  const store = readStore();
  const source = from ?? defaultLayout();
  const layout: Layout = {
    ...structuredClone(source),
    id: uniqueProfileId(store, name),
    name: name.trim() || "Untitled",
    // Rotates through the accent palette rather than copying the source's
    // colour, so a duplicate is visually distinguishable from its parent in
    // the switcher instead of showing the same dot twice.
    color: ACCENT_PRESETS[store.profiles.length % ACCENT_PRESETS.length],
  };
  store.profiles.push(layout);
  store.activeId = layout.id;
  writeStore(store);
  return layout;
}

export function setProfileColor(id: string, color: string): void {
  const store = readStore();
  const profile = store.profiles.find((p) => p.id === id);
  if (!profile) return;
  profile.color = color;
  writeStore(store);
}

export function setProfileBackground(id: string, background: Layout["background"]): void {
  const store = readStore();
  const profile = store.profiles.find((p) => p.id === id);
  if (!profile) return;
  if (background) profile.background = background;
  else delete profile.background;
  writeStore(store);
}

export function duplicateProfile(id: string): Layout | null {
  const store = readStore();
  const source = store.profiles.find((p) => p.id === id);
  if (!source) return null;
  return createProfile(`${source.name} copy`, source);
}

export function renameProfile(id: string, name: string): void {
  const store = readStore();
  const profile = store.profiles.find((p) => p.id === id);
  if (!profile) return;
  profile.name = name.trim() || profile.name;
  writeStore(store);
}

export function deleteProfile(id: string): boolean {
  const store = readStore();
  if (store.profiles.length <= 1) return false;
  const index = store.profiles.findIndex((p) => p.id === id);
  if (index < 0) return false;
  store.profiles.splice(index, 1);
  if (store.activeId === id) store.activeId = store.profiles[0].id;
  writeStore(store);
  return true;
}

// ---- File export / import ----

export function exportLayout(layout: Layout): void {
  const blob = new Blob([JSON.stringify(layout, null, 2)], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `${layout.id || "layout"}.json`;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

export async function importLayoutFromFile(file: File): Promise<Layout> {
  const text = await file.text();
  const parsed = JSON.parse(text) as Layout;
  if (!Array.isArray(parsed.controls)) {
    throw new Error("Invalid layout file: missing controls array");
  }
  return migrate(parsed);
}
