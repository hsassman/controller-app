/// Turning the page into a Home Screen app that launches fullscreen.
///
/// Two separate problems live here, and only the first is obvious.
///
/// 1. Launched from Safari, the browser's address bar and toolbar eat the
///    top and bottom of a landscape phone -- exactly the space a gamepad
///    needs. Added to the Home Screen the same page opens standalone, with
///    no browser chrome at all. The markup for that is already in place
///    (`apple-mobile-web-app-capable`, `display: standalone`); what was
///    missing was anything telling the player it was possible.
///
/// 2. A Home Screen icon pins the exact URL it was created from. The
///    obvious one is `http://<lan-ip>:<port>`, and that address belongs to
///    a DHCP lease -- when the router hands this PC a different one, the
///    icon opens a page that no longer exists. So the shortcut has to be
///    built on the host's `<hostname>.local` name instead, which follows
///    the machine. The host reports that name as `stableUrl`, but only
///    after verifying it resolves; this module additionally checks the
///    *phone* can reach it before offering to move, because mDNS is what
///    guest networks and AP isolation tend to break.

const DISMISSED_KEY = "controller-shortcut-dismissed";
/// Keys worth carrying to the permanent address. Browser storage is scoped
/// per origin, so moving from the IP to the hostname would otherwise look
/// exactly like losing every layout and setting.
const CARRIED_KEYS = [
  "controller-settings-v1",
  "controller-profiles-v1",
  "controller-layout-v1",
  "controller-onboarded",
];
/// Above this, the handover is dropped rather than risking a URL long
/// enough for a browser or webview to silently truncate.
const MAX_HANDOFF_CHARS = 6000;
const HANDOFF_PREFIX = "#restore=";

export function isStandalone(): boolean {
  const iosStandalone = (window.navigator as { standalone?: boolean }).standalone === true;
  return (
    iosStandalone ||
    window.matchMedia("(display-mode: standalone)").matches ||
    window.matchMedia("(display-mode: fullscreen)").matches
  );
}

export function isIos(): boolean {
  const ua = navigator.userAgent;
  // iPadOS reports itself as a Mac, and is only distinguishable by the
  // fact that Macs do not have a touchscreen.
  return /iphone|ipad|ipod/i.test(ua) || (/Macintosh/.test(ua) && navigator.maxTouchPoints > 1);
}

function dismissed(): boolean {
  try {
    return localStorage.getItem(DISMISSED_KEY) === "1";
  } catch {
    return false;
  }
}

function markDismissed(): void {
  try {
    localStorage.setItem(DISMISSED_KEY, "1");
  } catch {
    // Blocked storage: the card reappears next launch, which is a far
    // smaller problem than failing to open the controller.
  }
}

/// The permanent address, if the host knows one and this phone can reach it.
///
/// Both halves matter. The host only reports a name it resolved itself, and
/// this fetch proves the *phone's* resolver agrees -- offering to move to an
/// address that works on the PC but not the handset would strand the player
/// on a page that never loads, with the shortcut already made.
export async function reachableStableUrl(): Promise<string | null> {
    let stable: unknown;
  try {
    const res = await fetch("/host-info.json", { cache: "no-store" });
    if (!res.ok) return null;
    ({ stableUrl: stable } = (await res.json()) as { stableUrl?: unknown });
  } catch {
    return null;
  }
  if (typeof stable !== "string" || !stable) return null;
  // Already there: nothing to move to, but still a valid shortcut target.
  if (new URL(stable).origin === location.origin) return stable;

  // `no-cors` on purpose. The probe crosses origins (IP -> hostname), and a
  // normal fetch is refused by CORS unless the host returns an allow-origin
  // header -- which would mean any page the phone happens to visit could
  // quietly probe for this app and learn the PC's LAN address. An opaque
  // response tells us nothing about the body, but that isn't the question:
  // resolving at all proves the name resolved and the socket answered,
  // which is exactly what a Home Screen shortcut needs to be true.
  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 2500);
    await fetch(`${stable}/host-info.json`, {
      mode: "no-cors",
      cache: "no-store",
      signal: controller.signal,
    });
    clearTimeout(timer);
    return stable;
  } catch {
    // mDNS blocked on this network, or the phone has no Bonjour resolver.
    return null;
  }
}

/// Bundles local storage into the URL fragment so the permanent address
/// starts with the player's layouts and settings intact. A fragment is used
/// rather than a query string because it is never sent to the server and
/// never lands in a log.
function handoffFragment(): string {
  const payload: Record<string, string> = {};
  try {
    for (const key of CARRIED_KEYS) {
      const value = localStorage.getItem(key);
      if (value !== null) payload[key] = value;
    }
  } catch {
    return "";
  }
  if (Object.keys(payload).length === 0) return "";
  // encodeURIComponent, not btoa: the values are JSON that can contain
  // non-Latin-1 characters (a profile named in any non-Western script),
  // which btoa throws on.
  const encoded = encodeURIComponent(JSON.stringify(payload));
  return encoded.length > MAX_HANDOFF_CHARS ? "" : `${HANDOFF_PREFIX}${encoded}`;
}

/// Applies a handover left by `handoffFragment`, then scrubs it from the
/// address bar so a reload doesn't replay stale data over newer edits.
///
/// Runs before the first screen renders. Existing values win: arriving at an
/// address that already has layouts means this is a return visit, and the
/// data in hand is older than what is already stored.
export function consumeHandoff(): void {
  if (!location.hash.startsWith(HANDOFF_PREFIX)) return;
  try {
    const raw = decodeURIComponent(location.hash.slice(HANDOFF_PREFIX.length));
    const payload = JSON.parse(raw) as Record<string, unknown>;
    for (const [key, value] of Object.entries(payload)) {
      if (!CARRIED_KEYS.includes(key) || typeof value !== "string") continue;
      if (localStorage.getItem(key) === null) localStorage.setItem(key, value);
    }
  } catch {
    // A truncated or hand-edited fragment: ignore it and start clean rather
    // than refusing to boot.
  }
  history.replaceState(null, "", location.pathname + location.search);
}

interface ShortcutCardOptions {
  /// The verified permanent address, or null when there isn't one.
  stableUrl: string | null;
  onClose: () => void;
}

function buildCard(options: ShortcutCardOptions): HTMLElement {
  const { stableUrl } = options;
  const onPermanent = stableUrl !== null && new URL(stableUrl).origin === location.origin;

  const card = document.createElement("aside");
  card.className = "shortcut-card";
  card.tabIndex = -1;
  card.setAttribute("role", "region");
  const titleId = "shortcut-card-title";
  card.setAttribute("aria-labelledby", titleId);

  const title = document.createElement("h2");
  title.id = titleId;
  title.textContent = "Play fullscreen, every time";
  card.appendChild(title);

  const intro = document.createElement("p");
  intro.className = "shortcut-intro";
  intro.textContent = isIos()
    ? "Added to your Home Screen, this opens with no address bar and no toolbar — the whole screen is the controller."
    : "Added to your home screen, this opens without browser chrome — the whole screen is the controller.";
  card.appendChild(intro);

  if (stableUrl && !onPermanent) {
    // The important half. Making the shortcut here would pin an address
    // that expires with the DHCP lease.
    const warn = document.createElement("p");
    warn.className = "shortcut-warn";
    warn.textContent =
      "First, switch to this PC's permanent address. The one you're on now is tied to an IP that changes, which is what makes a saved shortcut stop working later.";
    card.appendChild(warn);

    const go = document.createElement("button");
    go.type = "button";
    go.className = "shortcut-go";
    go.textContent = `Switch to ${new URL(stableUrl).host}`;
    go.addEventListener("click", () => {
      go.disabled = true;
      go.textContent = "Switching…";
      location.href = `${stableUrl}/${handoffFragment()}`;
    });
    card.appendChild(go);

    const keep = document.createElement("p");
    keep.className = "shortcut-note";
    keep.textContent = "Your layouts and settings come with you.";
    card.appendChild(keep);
  } else if (!stableUrl) {
    const warn = document.createElement("p");
    warn.className = "shortcut-warn";
    warn.textContent =
      "Heads up: this address is tied to your PC's current IP, so the shortcut may stop working if that changes. Reconnect and make it again if it ever does.";
    card.appendChild(warn);
  } else {
    const good = document.createElement("p");
    good.className = "shortcut-note good";
    good.textContent = `You're on the permanent address (${new URL(stableUrl).host}) — a shortcut made now keeps working.`;
    card.appendChild(good);
  }

  const steps = document.createElement("ol");
  const instructions = isIos()
    ? [
        "Tap the Share button in Safari's toolbar (the square with an arrow).",
        "Scroll down and tap Add to Home Screen, then Add.",
        "Launch the controller from that icon from now on.",
      ]
    : [
        "Open your browser's menu (usually three dots).",
        "Tap Install app, or Add to Home screen.",
        "Launch the controller from that icon from now on.",
      ];
  for (const line of instructions) {
    const li = document.createElement("li");
    li.textContent = line;
    steps.appendChild(li);
  }
  card.appendChild(steps);

  const close = document.createElement("button");
  close.type = "button";
  close.className = "shortcut-dismiss";
  close.textContent = "Got it";
  close.addEventListener("click", () => {
    markDismissed();
    options.onClose();
  });
  card.appendChild(close);

  return card;
}

/// Shows the shortcut card in `host` unless it has been dismissed, this is
/// already a Home Screen launch, or a shortcut could not help.
///
/// `force` bypasses the dismissed flag, for the entry point in Settings.
export async function maybeOfferShortcut(host: HTMLElement, force = false): Promise<void> {
  // Already fullscreen: the thing this card asks for is done.
  if (isStandalone()) return;
  if (!force && dismissed()) return;
  // A desktop browser has nowhere to put a Home Screen icon.
  if (!force && !isIos() && !("ontouchstart" in window)) return;

  const stableUrl = await reachableStableUrl();
  if (!host.isConnected) return;

  host.querySelector(".shortcut-card")?.remove();
  const card = buildCard({
    stableUrl,
    onClose: () => card.remove(),
  });
  host.appendChild(card);
  card.focus();
}
