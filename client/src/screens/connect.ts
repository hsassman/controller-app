import { HostConnection, type ConnectionState } from "../connection.ts";

const RECENT_KEY = "controller-recent-hosts";
const MAX_RECENT = 4;
/// The host binds this port unless told otherwise, so a bare IP is almost
/// always meant to be `ip:8787`. Filling it in beats rejecting the input --
/// typing a port number on a phone keypad is the fiddliest part of setup.
const DEFAULT_PORT = 8787;

async function discoverHost(): Promise<string | null> {
  try {
    const controller = new AbortController();
    // Short: this runs before the user can do anything, so a slow or
    // hanging probe would just be a stall on a screen that otherwise works.
    const timer = setTimeout(() => controller.abort(), 1500);
    const res = await fetch("/host-info.json", {
      signal: controller.signal,
      cache: "no-store",
    });
    clearTimeout(timer);
    if (!res.ok) return null;
    const info = (await res.json()) as { ws?: unknown };
    return typeof info.ws === "string" && info.ws.includes(":") ? info.ws : null;
  } catch {
    return null;
  }
}

const STATUS_LABEL: Record<ConnectionState, string> = {
  idle: "Not connected",
  connecting: "Connecting…",
  connected: "Connected",
  error: "Connection error — check the IP:port and that the host app is running",
  lost: "Connection lost — reconnecting…",
};

export interface ConnectScreenOptions {
  autoConnect?: boolean;
}

export function renderConnectScreen(
  container: HTMLElement,
  onConnected: (connection: HostConnection) => void,
  options: ConnectScreenOptions = {},
): void {
  container.innerHTML = `
    <div class="screen connect-screen">
      <div class="brand">
        <span class="brand-mark" aria-hidden="true"></span>
        <div>
          <h1>Phone Controller</h1>
          <p class="hint">Turn this phone into a wireless gamepad for your PC.</p>
        </div>
      </div>

      <div class="connect-card">
        <label for="host-input">Host address</label>
        <div class="input-row">
          <input
            id="host-input"
            type="text"
            inputmode="decimal"
            placeholder="e.g. 192.168.0.10:8787"
            autocomplete="off"
            autocapitalize="off"
            spellcheck="false"
            aria-describedby="host-help"
          />
          <button id="connect-btn" type="button">Connect</button>
        </div>
        <p id="host-help" class="hint">
          Shown in the Controller Host window on your PC. Both devices must be on the same Wi-Fi.
        </p>
        <div id="recent-hosts" class="recent-hosts" hidden>
          <span class="recent-label">Recent</span>
          <div id="recent-list" class="recent-list"></div>
        </div>
      </div>

      <div id="status" class="status" data-state="idle" role="status">
        <span id="status-dot" aria-hidden="true"></span>
        <span id="status-text">${STATUS_LABEL.idle}</span>
      </div>

      <details class="troubleshoot">
        <summary>Not connecting?</summary>
        <ul>
          <li>Check the phone and the PC are on the <strong>same Wi-Fi network</strong>, not one on mobile data.</li>
          <li>Make sure the Controller Host app is open on the PC — it prints the address to type here.</li>
          <li>If Windows Firewall prompted when the host started, allow it on <strong>private networks</strong>.</li>
          <li>Guest or client-isolation Wi-Fi blocks device-to-device traffic; use your normal network.</li>
        </ul>
      </details>
    </div>
  `;

  const hostInput = container.querySelector<HTMLInputElement>("#host-input")!;
  const connectBtn = container.querySelector<HTMLButtonElement>("#connect-btn")!;
  const statusEl = container.querySelector<HTMLDivElement>("#status")!;
  const statusText = container.querySelector<HTMLSpanElement>("#status-text")!;
  const recentWrap = container.querySelector<HTMLDivElement>("#recent-hosts")!;
  const recentList = container.querySelector<HTMLDivElement>("#recent-list")!;

  const recent = loadRecent();
  if (recent.length > 0) hostInput.value = recent[0];
  else if (location.hostname && !/^(localhost|127\.0\.0\.1)$/.test(location.hostname)) {
    // Whoever served this page is overwhelmingly the machine to connect
    // to, so it is a far better default than an empty field.
    hostInput.value = `${location.hostname}:${DEFAULT_PORT}`;
  }

  const renderRecent = () => {
    recentList.innerHTML = "";
    const hosts = loadRecent();
    recentWrap.hidden = hosts.length === 0;
    for (const host of hosts) {
      const chip = document.createElement("button");
      chip.type = "button";
      chip.className = "host-chip";
      chip.textContent = host;
      chip.addEventListener("click", () => {
        // Counts as taking over: without this, discovery could still land a
        // moment later and reconnect to a different address than the one
        // that was just tapped.
        cancelAuto();
        hostInput.value = host;
        connect();
      });
      recentList.appendChild(chip);
    }
  };
  renderRecent();

  let connection: HostConnection | null = null;
  /// Set once we have handed a live connection to the controller screen, so
  /// a late callback from a stale socket cannot render a second one.
  let handedOff = false;

  const setState = (instance: HostConnection, state: ConnectionState) => {
    if (instance !== connection) return;
    statusEl.dataset.state = state;
    statusText.textContent = STATUS_LABEL[state];
    connectBtn.disabled = state === "connecting";
    connectBtn.textContent = state === "connecting" ? "Connecting…" : "Connect";
    if (state === "connected" && !handedOff) {
      handedOff = true;
      onConnected(instance);
    }
  };

  const connect = () => {
    const raw = hostInput.value.trim();
    if (!raw) {
      hostInput.focus();
      return;
    }
    const target = normalizeHost(raw);
    hostInput.value = target;
    rememberHost(target);
    renderRecent();
    // Retiring the previous attempt is what stops a reconnect chain from
    // outliving the address it was chasing.
    connection?.disconnect();
    const instance: HostConnection = new HostConnection((state) => setState(instance, state));
    connection = instance;
    instance.connect(target);
  };

  connectBtn.addEventListener("click", connect);
  hostInput.addEventListener("keydown", (e) => {
    if (e.key === "Enter") connect();
  });

  // Auto-connect when the host itself served this page. Cancelled the
  // moment the user touches the form, so an automatic attempt can never
  // fight someone typing a different address.
  let userTookOver = false;
  const cancelAuto = () => {
    userTookOver = true;
  };
  hostInput.addEventListener("input", cancelAuto);
  hostInput.addEventListener("focus", cancelAuto);
  connectBtn.addEventListener("click", cancelAuto);

  if (options.autoConnect === false) return;

  // Say what is happening straight away. Without this the form sits there
  // looking like it wants input for the ~100ms before discovery answers,
  // which is exactly long enough to start typing into.
  statusText.textContent = "Looking for your PC…";

  void discoverHost().then((address) => {
    // `handedOff`/`connection` are the real guards. `container.isConnected`
    // never goes false here -- #app is static in index.html and is only ever
    // refilled -- so on its own it let a late discovery call connect() on a
    // connection already handed to the controller screen. That path runs
    // disconnect() with manualDisconnect set and the listeners aborted, so
    // no close event ever fires: the UI keeps saying "Connected" while
    // nothing reaches the PC, and it never reconnects.
    if (userTookOver || handedOff || connection) return;
    if (!address) {
      // No host served this page, so the manual form is the real UI --
      // put the status back rather than leaving a stale "looking…".
      statusText.textContent = STATUS_LABEL.idle;
      return;
    }
    statusText.textContent = "Found your PC — connecting…";
    hostInput.value = address;
    connect();
  });
}

/// Accepts what people actually type: a bare IP, an IP with a port, or an
/// address pasted with a scheme in front of it.
function normalizeHost(raw: string): string {
  let value = raw.replace(/^\w+:\/\//, "").replace(/\/+$/, "");
  if (!/:\d+$/.test(value)) value = `${value}:${DEFAULT_PORT}`;
  return value;
}

function loadRecent(): string[] {
  try {
    const raw = localStorage.getItem(RECENT_KEY);
    // Carry over the single address older builds stored, so upgrading
    // doesn't make the user re-type their PC's IP on a phone keypad.
    if (!raw) {
      const legacy = localStorage.getItem("controller-last-host");
      return legacy ? [legacy] : [];
    }
    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed)) return [];
    return parsed.filter((h): h is string => typeof h === "string").slice(0, MAX_RECENT);
  } catch {
    return [];
  }
}

function rememberHost(host: string): void {
  try {
    // Most-recent-first with duplicates collapsed, so reconnecting to the
    // usual PC is always the first chip rather than drifting down the list.
    const next = [host, ...loadRecent().filter((h) => h !== host)].slice(0, MAX_RECENT);
    localStorage.setItem(RECENT_KEY, JSON.stringify(next));
  } catch {
    // localStorage unavailable — the field just won't prefill next time.
  }
}
