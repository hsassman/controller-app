/// The first-run hint shown over the play surface.
///
/// A first connection drops the user straight onto a live gamepad with no
/// indication that it is already sending input, or that the game window on
/// the PC still has to be focused for that input to land anywhere. Both are
/// said once, briefly, and then never again.

import { haptic } from "./haptics.ts";

const SEEN_KEY = "controller-onboarded";

function alreadySeen(): boolean {
  try {
    return localStorage.getItem(SEEN_KEY) === "1";
  } catch {
    // Blocked storage (private mode, cross-origin iframe): showing the hint
    // again beats throwing on the way into the controller screen.
    return false;
  }
}

function markSeen(): void {
  try {
    localStorage.setItem(SEEN_KEY, "1");
  } catch {
    // Nothing to do -- the hint will simply appear again next launch.
  }
}

/// Renders the hint into `host` if it has never been dismissed. Returns true
/// when it took focus, so the caller does not move focus a second time.
export function showFirstRunHint(host: HTMLElement, onDismiss?: () => void): boolean {
  if (alreadySeen()) return false;

  const card = document.createElement("aside");
  card.className = "onboarding";
  card.tabIndex = -1;
  card.setAttribute("role", "region");
  const titleId = "onboarding-title";
  card.setAttribute("aria-labelledby", titleId);

  const title = document.createElement("h2");
  title.id = titleId;
  title.textContent = "Your controller is live";
  card.appendChild(title);

  const list = document.createElement("ul");
  for (const line of [
    "Press any control — it lights up in the Controller Host window on your PC. That is the self-test.",
    "Click your game's window on the PC so the input actually reaches the game.",
    "Edit layout rearranges the pad; the gear opens settings.",
  ]) {
    const item = document.createElement("li");
    item.textContent = line;
    list.appendChild(item);
  }
  card.appendChild(list);

  const dismissBtn = document.createElement("button");
  dismissBtn.type = "button";
  dismissBtn.className = "onboarding-dismiss";
  dismissBtn.textContent = "Got it";
  card.appendChild(dismissBtn);

  const dismiss = () => {
    markSeen();
    card.remove();
    onDismiss?.();
  };

  dismissBtn.addEventListener("click", () => {
    haptic("ui");
    dismiss();
  });
  // Escape is the other way out. The handler is on the card rather than the
  // window so the hint never swallows a key aimed at anything else, and
  // nothing here traps focus -- Tab walks straight on into the topbar.
  card.addEventListener("keydown", (e) => {
    if (e.key !== "Escape") return;
    e.stopPropagation();
    dismiss();
  });

  host.appendChild(card);

  // In portrait the whole play area is covered by the "rotate your device"
  // screen, so the hint is on-screen but invisible; focusing it there would
  // strand a keyboard or screen-reader user on something they cannot see.
  const hidden = window.matchMedia?.("(orientation: portrait)").matches ?? false;
  if (hidden) return false;
  card.focus();
  return true;
}
