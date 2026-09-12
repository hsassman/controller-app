import type { HostConnection, ConnectionState } from "../connection.ts";
import { renderControls } from "../controls.ts";
import { snapshot, resetAll } from "../inputState.ts";
import { encodeInputFrame } from "../../../protocol/frame.ts";
import { loadSettings, saveSettings, applyHighContrast } from "../settings.ts";
import { applyAppearance, applyBackground } from "../theme.ts";
import { configureHaptics, haptic } from "../haptics.ts";
import { fullscreenSupported, isFullscreen, toggleFullscreen, keepAwakeWhileVisible, releaseWakeLock } from "../session.ts";
import { renderSettingsPanel } from "./settings-panel.ts";
import { loadLayout, listProfiles, setActiveProfile, activeProfileId } from "../profile.ts";
import { renderEditor, type EditorHandle } from "./editor.ts";
import { confirmDialog } from "../dialog.ts";
import { showFirstRunHint } from "../onboarding.ts";
import { maybeOfferShortcut } from "../install.ts";

const SEND_RATE_HZ = 100;
/// Written by the connect screen just before it dials, so the first entry is
/// the address this session is actually on. Read (never written) here so
/// "Reconnect now" has a target without connection.ts having to expose one.
const RECENT_HOSTS_KEY = "controller-recent-hosts";
const DEFAULT_PORT = 8787;

export function renderControllerScreen(
  container: HTMLElement,
  connection: HostConnection,
  onDisconnected: () => void,
): void {
  container.innerHTML = `
    <div class="screen controller-screen">
      <header class="topbar">
        <h1 id="screen-heading" class="visually-hidden" tabindex="-1">Game controller</h1>
        <div id="status" class="status" data-state="connected">
          <span id="status-dot" aria-hidden="true"></span>
          <span id="status-text" role="status">Connected</span>
          <!-- Outside the live region: the ping is rewritten every couple of
               seconds, and announcing it forever is unusable. -->
          <span id="status-latency" class="status-latency" aria-hidden="true" hidden></span>
        </div>
        <div id="conn-actions" class="conn-actions" hidden>
          <button id="reconnect-btn" type="button">Reconnect now</button>
          <button id="change-host-btn" type="button">Change PC</button>
        </div>
        <label id="profile-picker" class="profile-picker">
          <span class="visually-hidden">Active layout profile</span>
          <select id="profile-select"></select>
        </label>
        <div id="edit-toolbar" class="edit-toolbar" hidden></div>
        <div class="topbar-actions">
          <button id="fullscreen-btn" type="button" aria-label="Enter fullscreen" title="Fullscreen">⛶</button>
          <button id="edit-btn" type="button">Edit layout</button>
          <button id="done-editing" class="primary" type="button" hidden>Done</button>
          <button id="settings-btn" type="button" aria-label="Settings" title="Settings">⚙</button>
          <button id="disconnect-btn" type="button">Disconnect</button>
        </div>
      </header>
      <main class="surface-wrap">
        <div id="controls-surface" class="controls-surface" role="group" aria-label="Game controller"></div>
        <div id="empty-layout" class="empty-layout" hidden>
          <h2>This layout has no controls</h2>
          <p>Tap <strong>Edit layout</strong>, then <strong>Presets</strong> to start from a standard pad.</p>
        </div>
      </main>
      <div class="rotate-block">
        <span class="rotate-icon" aria-hidden="true">📱</span>
        <h2>Rotate your device</h2>
        <p>This controller is designed for landscape. Turn your phone sideways to play.</p>
      </div>
    </div>
  `;

  const surface = container.querySelector<HTMLDivElement>("#controls-surface")!;
  const statusEl = container.querySelector<HTMLDivElement>("#status")!;
  const statusText = container.querySelector<HTMLSpanElement>("#status-text")!;
  const statusLatency = container.querySelector<HTMLSpanElement>("#status-latency")!;
  const editBtn = container.querySelector<HTMLButtonElement>("#edit-btn")!;
  const doneBtn = container.querySelector<HTMLButtonElement>("#done-editing")!;
  const editToolbar = container.querySelector<HTMLDivElement>("#edit-toolbar")!;
  const settingsBtn = container.querySelector<HTMLButtonElement>("#settings-btn")!;
  const disconnectBtn = container.querySelector<HTMLButtonElement>("#disconnect-btn")!;
  const fullscreenBtn = container.querySelector<HTMLButtonElement>("#fullscreen-btn")!;
  const profilePicker = container.querySelector<HTMLLabelElement>("#profile-picker")!;
  const profileSelect = container.querySelector<HTMLSelectElement>("#profile-select")!;
  const heading = container.querySelector<HTMLHeadingElement>("#screen-heading")!;
  const connActions = container.querySelector<HTMLDivElement>("#conn-actions")!;
  const reconnectBtn = container.querySelector<HTMLButtonElement>("#reconnect-btn")!;
  const changeHostBtn = container.querySelector<HTMLButtonElement>("#change-host-btn")!;
  const surfaceWrap = container.querySelector<HTMLElement>(".surface-wrap")!;

  const settings = loadSettings();
  const applySettings = () => {
    applyHighContrast(settings.highContrast);
    applyAppearance(settings);
    configureHaptics(settings.haptics, settings.hapticStrength);
  };
  applySettings();

  // A phone whose screen dims mid-game drops every input at once, and the
  // canvas touches this app uses don't reliably reset the platform idle
  // timer — so the lock is requested as soon as there is something to play.
  keepAwakeWhileVisible();

  // Without the ViGEmBus driver the PC accepts the connection and reports
  // "Connected" while quietly discarding every input, which reads as a
  // broken app rather than a missing driver. The host says so in
  // /host-info.json; say it here too, because the phone is what the player
  // is looking at.
  void warnIfPadUnavailable(surfaceWrap);

  let layout = loadLayout();
  let editing = false;
  let sequence = 0;
  // Teardown for whatever currently owns `surface`. Exactly one renderer
  // (play controls or the editor) may own it at a time -- see the comment
  // on renderControls for the duplication bug this prevents.
  let teardownSurface: (() => void) | null = null;
  let editorHandle: EditorHandle | null = null;

  const releaseSurface = () => {
    teardownSurface?.();
    teardownSurface = null;
    editorHandle = null;
  };

  /// Sends the current input state immediately rather than waiting for the
  /// next tick of the send loop. Used right after releasing everything, so
  /// the host cannot keep applying a stale held frame for even one tick.
  const flushNeutralFrame = () => {
    connection.sendFrame(encodeInputFrame(snapshot(sequence++)));
  };

  const syncProfiles = () => {
    const profiles = listProfiles();
    const active = activeProfileId();
    profileSelect.innerHTML = "";
    for (const profile of profiles) {
      const option = document.createElement("option");
      option.value = profile.id;
      option.textContent = profile.name;
      option.selected = profile.id === active;
      profileSelect.appendChild(option);
    }
    // With a single profile the picker is noise; it appears as soon as
    // there is an actual choice to make.
    profilePicker.hidden = profiles.length < 2;
  };

  /// Rebuilds the play controls. Called whenever the input state is cleared
  /// out from under the DOM: a toggle-mode button holds its latched class and
  /// aria-pressed until it is rebuilt, so without this it keeps looking held
  /// while its bit is already clear, and the next tap turns it back on.
  const renderPlaySurface = () => {
    releaseSurface();
    teardownSurface = renderControls(surface, layout, () => settings, flushNeutralFrame);
  };

  /// `focusHeading` is for arrivals -- first mount and coming back out of the
  /// editor -- where the element that had focus no longer exists. It stays
  /// off for in-place refreshes so a profile change can't yank focus out of
  /// the picker the user is still using.
  const showPlayMode = (focusHeading = false) => {
    releaseSurface();
    editing = false;
    // Every path that lands here re-reads `layout` fresh, so this is the one
    // place a per-profile background needs applying rather than chasing
    // every call site that assigns `layout`.
    applyBackground(layout.background);
    editToolbar.hidden = true;
    editToolbar.innerHTML = "";
    settingsBtn.hidden = false;
    disconnectBtn.hidden = false;
    fullscreenBtn.hidden = !fullscreenSupported();
    profilePicker.hidden = listProfiles().length < 2;
    editBtn.textContent = "Edit layout";
    doneBtn.hidden = true;
    syncProfiles();
    container.querySelector<HTMLElement>("#empty-layout")!.hidden = layout.controls.length > 0;
    teardownSurface = renderControls(surface, layout, () => settings, flushNeutralFrame);
    heading.textContent = "Game controller";
    document.title = "Playing — Phone Controller";
    if (focusHeading) heading.focus();
  };

  const showEditMode = () => {
    releaseSurface();
    // Release everything before the send loop pauses, and push one neutral
    // frame, so a control held at the moment "Edit layout" was tapped isn't
    // left stuck down on the host (which keeps applying the last frame).
    resetAll();
    flushNeutralFrame();
    editing = true;
    editToolbar.hidden = false;
    settingsBtn.hidden = true;
    disconnectBtn.hidden = true;
    fullscreenBtn.hidden = true;
    profilePicker.hidden = true;
    editBtn.textContent = "Discard";
    doneBtn.hidden = false;
    container.querySelector<HTMLElement>("#empty-layout")!.hidden = true;
    heading.textContent = "Layout editor";
    document.title = "Editing layout — Phone Controller";
    const handle = renderEditor(surface, editToolbar, layout, {
      getSettings: () => settings,
      onSettingsChanged: () => saveSettings(settings),
      onDone: (updated) => {
        layout = updated;
        showPlayMode(true);
      },
      onCancel: () => void leaveEditor(),
    });
    editorHandle = handle;
    teardownSurface = handle.teardown;
  };

  /// Leaves the editor, asking first if it would throw work away. The prompt
  /// is async, so the editor is still mounted while it is open -- re-check
  /// nothing here, just act on the answer.
  const leaveEditor = async () => {
    if (editorHandle?.isDirty()) {
      const discard = await confirmDialog("Discard your changes to this layout?", {
        body: "The layout goes back to how it was when you opened the editor.",
        confirmLabel: "Discard",
        cancelLabel: "Keep editing",
        danger: true,
      });
      if (!discard) return;
    }
    showPlayMode(true);
  };

  showPlayMode(true);

  // On a first run the hint is what the user needs to read, so it takes
  // focus from the heading and hands it back when dismissed.
  const hintShown = showFirstRunHint(surfaceWrap, () => {
    heading.focus();
    // Offered only once the first-run hint is out of the way, so the two
    // cards never stack on a landscape phone's very short viewport.
    void maybeOfferShortcut(surfaceWrap);
  });
  if (!hintShown) void maybeOfferShortcut(surfaceWrap);

  const STATUS_LABEL: Record<ConnectionState, string> = {
    idle: "Not connected",
    connecting: "Connecting…",
    connected: "Connected",
    error: "Connection error",
    lost: "Connection lost — reconnecting…",
  };

  const intervalMs = 1000 / SEND_RATE_HZ;
  const sendTimer = window.setInterval(() => {
    if (editing) return; // don't stream stale button state while editing
    const frame = snapshot(sequence++);
    connection.sendFrame(encodeInputFrame(frame));
  }, intervalMs);

  const handleState = (state: ConnectionState) => {
    statusEl.dataset.state = state;
    statusText.textContent = STATUS_LABEL[state];
    // "lost" auto-reconnects (see connection.ts); the send loop keeps
    // running and simply no-ops until the socket is OPEN again. The backoff
    // grows to 16s though, so without these two buttons the only thing the
    // user can do about a dropped Wi-Fi is stare at the message and wait.
    const offline = state === "lost" || state === "error";
    connActions.hidden = !offline;
    reconnectBtn.disabled = lastHost() === null;
  };
  connection.setStateHandler(handleState);

  // Round-trip time from the heartbeat. Worth surfacing because "the
  // controller feels laggy" is otherwise unattributable -- this says
  // plainly whether the delay is the network or the game.
  connection.setLatencyHandler((ms) => {
    if (ms === null) {
      statusLatency.hidden = true;
      return;
    }
    statusLatency.hidden = false;
    statusLatency.textContent = `${ms} ms`;
    statusLatency.dataset.quality = ms < 30 ? "good" : ms < 80 ? "ok" : "poor";
  });

  const syncFullscreenBtn = () => {
    const on = isFullscreen();
    fullscreenBtn.setAttribute("aria-label", on ? "Exit fullscreen" : "Enter fullscreen");
    fullscreenBtn.classList.toggle("on", on);
  };
  document.addEventListener("fullscreenchange", syncFullscreenBtn);
  syncFullscreenBtn();

  const cleanup = () => {
    window.clearInterval(sendTimer);
    window.removeEventListener("beforeunload", onBeforeUnload);
    document.removeEventListener("fullscreenchange", syncFullscreenBtn);
    releaseWakeLock();
    releaseSurface();
  };

  fullscreenBtn.addEventListener("click", () => {
    haptic("ui");
    void toggleFullscreen();
  });

  profileSelect.addEventListener("change", () => {
    // Switching profiles mid-play would otherwise leave anything held under
    // the old layout stuck down, since the control that owns the release
    // event is about to be destroyed.
    resetAll();
    flushNeutralFrame();
    layout = setActiveProfile(profileSelect.value);
    showPlayMode();
    haptic("ui");
  });

  /// Tears the session down and hands the user back to the connect screen.
  const goToConnectScreen = () => {
    // Release inputs and flush one neutral frame before closing, so the
    // host's still-plugged-in pad doesn't retain a held button.
    resetAll();
    flushNeutralFrame();
    cleanup();
    connection.disconnect();
    document.title = "Phone Controller";
    onDisconnected();
  };

  disconnectBtn.addEventListener("click", () => {
    void (async () => {
      const confirmed = await confirmDialog("Disconnect from your PC?", {
        body: "The virtual gamepad is unplugged on the PC until you connect again.",
        confirmLabel: "Disconnect",
        danger: true,
      });
      if (!confirmed) return;
      goToConnectScreen();
    })();
  });

  reconnectBtn.addEventListener("click", () => {
    const host = lastHost();
    if (!host) return;
    haptic("ui");
    // disconnect() first: it is the only thing that cancels the pending
    // backoff timer, which would otherwise fire later and tear down the
    // socket this click just opened.
    connection.disconnect();
    connection.connect(host);
  });

  changeHostBtn.addEventListener("click", () => {
    haptic("ui");
    goToConnectScreen();
  });

  editBtn.addEventListener("click", () => {
    if (editing) void leaveEditor();
    else showEditMode();
  });

  doneBtn.addEventListener("click", () => editorHandle?.save());

  // A reload or a backgrounded tab being reclaimed would otherwise discard
  // an in-progress layout with no prompt.
  const onBeforeUnload = (e: BeforeUnloadEvent) => {
    if (!editorHandle?.isDirty()) return;
    e.preventDefault();
    e.returnValue = "";
  };
  window.addEventListener("beforeunload", onBeforeUnload);

  settingsBtn.addEventListener("click", () => {
    resetAll();
    flushNeutralFrame();
    if (!editing) renderPlaySurface();
    renderSettingsPanel(layout, settings, {
      getLayout: () => layout,
      onChange: (updated) => {
        Object.assign(settings, updated);
        saveSettings(settings);
        applySettings();
        // Re-render so changed dead zone / toggle-mode / appearance settings
        // take effect, but only in play mode -- and always through
        // releaseSurface() so we never stack a second ResizeObserver.
        if (!editing) renderPlaySurface();
      },
      onProfilesChanged: () => {
        resetAll();
        flushNeutralFrame();
        layout = loadLayout();
        if (!editing) showPlayMode();
      },
    });
  });
}

/// Shows a dismissible banner when the PC has no virtual pad to drive.
///
/// Only ever *adds* information: if the endpoint is missing, unreachable or
/// from an older host that doesn't report `padReady`, nothing is shown. A
/// false alarm here would be worse than silence.
async function warnIfPadUnavailable(host: HTMLElement): Promise<void> {
  let ready: unknown;
  try {
    const res = await fetch("/host-info.json", { cache: "no-store" });
    if (!res.ok) return;
    ({ padReady: ready } = (await res.json()) as { padReady?: unknown });
  } catch {
    return; // page opened from somewhere other than the host
  }
  if (ready !== false) return;

  const banner = document.createElement("div");
  banner.className = "pad-warning";
  banner.setAttribute("role", "alert");

  const text = document.createElement("p");
  text.innerHTML =
    "<strong>The PC can't create a controller yet.</strong> " +
    "The ViGEmBus driver isn't installed, so your presses arrive but go nowhere. " +
    "Install it on the PC from the link in the Controller Host window, then restart that app.";
  banner.appendChild(text);

  const dismiss = document.createElement("button");
  dismiss.type = "button";
  dismiss.className = "pad-warning-dismiss";
  dismiss.textContent = "Dismiss";
  dismiss.addEventListener("click", () => banner.remove());
  banner.appendChild(dismiss);

  host.appendChild(banner);
}

/// The address this session connected to, for "Reconnect now". The connect
/// screen stores it on the way in; `location.hostname` is the fallback for
/// when storage is blocked but the host served this page itself.
function lastHost(): string | null {
  try {
    const parsed = JSON.parse(localStorage.getItem(RECENT_HOSTS_KEY) ?? "null") as unknown;
    if (Array.isArray(parsed) && typeof parsed[0] === "string") return parsed[0];
  } catch {
    // Blocked or corrupt storage -- fall through to the served-from host.
  }
  const host = location.hostname;
  if (!host || /^(localhost|127\.0\.0\.1)$/.test(host)) return null;
  return `${host}:${DEFAULT_PORT}`;
}
