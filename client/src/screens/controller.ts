import type { HostConnection, ConnectionState } from "../connection.ts";
import { renderControls } from "../controls.ts";
import { snapshot, resetAll } from "../inputState.ts";
import { encodeInputFrame } from "../../../protocol/frame.ts";
import { loadSettings, saveSettings, applyHighContrast } from "../settings.ts";
import { applyAppearance } from "../theme.ts";
import { configureHaptics, haptic } from "../haptics.ts";
import { fullscreenSupported, isFullscreen, toggleFullscreen, keepAwakeWhileVisible, releaseWakeLock } from "../session.ts";
import { renderSettingsPanel } from "./settings-panel.ts";
import { loadLayout, listProfiles, setActiveProfile, activeProfileId } from "../profile.ts";
import { renderEditor, type EditorHandle } from "./editor.ts";

const SEND_RATE_HZ = 100;

export function renderControllerScreen(
  container: HTMLElement,
  connection: HostConnection,
  onDisconnected: () => void,
): void {
  container.innerHTML = `
    <div class="screen controller-screen">
      <div class="topbar">
        <div id="status" class="status" data-state="connected" role="status">
          <span id="status-dot" aria-hidden="true"></span>
          <span id="status-text">Connected</span>
          <span id="status-latency" class="status-latency" hidden></span>
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
      </div>
      <div class="surface-wrap">
        <div id="controls-surface" class="controls-surface" role="group" aria-label="Game controller"></div>
        <div id="empty-layout" class="empty-layout" hidden>
          <h2>This layout has no controls</h2>
          <p>Tap <strong>Edit layout</strong>, then <strong>Presets</strong> to start from a standard pad.</p>
        </div>
      </div>
      <div class="rotate-block" role="status">
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

  const showPlayMode = () => {
    releaseSurface();
    editing = false;
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
    const handle = renderEditor(surface, editToolbar, layout, {
      getSettings: () => settings,
      onSettingsChanged: () => saveSettings(settings),
      onDone: (updated) => {
        layout = updated;
        showPlayMode();
      },
      onCancel: () => leaveEditor(),
    });
    editorHandle = handle;
    teardownSurface = handle.teardown;
  };

  /// Leaves the editor, asking first if it would throw work away.
  const leaveEditor = () => {
    if (editorHandle?.isDirty() && !confirm("Discard your changes to this layout?")) return;
    showPlayMode();
  };

  showPlayMode();

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
    // running and simply no-ops until the socket is OPEN again.
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

  disconnectBtn.addEventListener("click", () => {
    if (!confirm("Disconnect from your PC?")) return;
    // Release inputs and flush one neutral frame before closing, so the
    // host's still-plugged-in pad doesn't retain a held button.
    resetAll();
    flushNeutralFrame();
    cleanup();
    connection.disconnect();
    onDisconnected();
  });

  editBtn.addEventListener("click", () => {
    if (editing) leaveEditor();
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
    renderSettingsPanel(layout, settings, {
      getLayout: () => layout,
      onChange: (updated) => {
        Object.assign(settings, updated);
        saveSettings(settings);
        applySettings();
        // Re-render so changed dead zone / toggle-mode / appearance settings
        // take effect, but only in play mode -- and always through
        // releaseSurface() so we never stack a second ResizeObserver.
        if (!editing) {
          releaseSurface();
          teardownSurface = renderControls(surface, layout, () => settings, flushNeutralFrame);
        }
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
