/// In-app replacements for `confirm`, `prompt` and `alert`.
///
/// The native ones are not usable here. `prompt()` is a no-op in several
/// in-app browsers (so "New profile" silently did nothing), and on Android
/// a native dialog can drop the page out of fullscreen -- which, mid-game,
/// is worse than the question being asked. These also inherit the app's
/// theme and honour the focus trap the rest of the UI uses.

import { haptic } from "./haptics.ts";

interface DialogOptions {
  title: string;
  /// Optional supporting line under the title.
  body?: string;
  confirmLabel?: string;
  cancelLabel?: string;
  /// Styles the confirm button as destructive.
  danger?: boolean;
  /// When present the dialog shows a text field and resolves with its
  /// value; otherwise it resolves with a boolean.
  input?: { label: string; value?: string; placeholder?: string; maxLength?: number };
}

/// Resolves to the entered string (input dialogs), true/false (confirm
/// dialogs), or null when the user cancelled an input dialog.
function open(options: DialogOptions): Promise<string | boolean | null> {
  return new Promise((resolve) => {
    const previouslyFocused = document.activeElement as HTMLElement | null;

    const overlay = document.createElement("div");
    overlay.className = "overlay dialog-overlay";
    overlay.setAttribute("role", "dialog");
    overlay.setAttribute("aria-modal", "true");

    const panel = document.createElement("div");
    panel.className = "panel dialog-panel";
    overlay.appendChild(panel);

    const titleId = `dialog-title-${Math.random().toString(36).slice(2, 8)}`;
    overlay.setAttribute("aria-labelledby", titleId);

    const title = document.createElement("h2");
    title.id = titleId;
    title.textContent = options.title;
    panel.appendChild(title);

    if (options.body) {
      const body = document.createElement("p");
      body.className = "dialog-body";
      body.textContent = options.body;
      panel.appendChild(body);
    }

    let field: HTMLInputElement | null = null;
    if (options.input) {
      const label = document.createElement("label");
      label.className = "dialog-label";
      label.textContent = options.input.label;
      const fieldId = `${titleId}-input`;
      label.htmlFor = fieldId;

      field = document.createElement("input");
      field.type = "text";
      field.id = fieldId;
      field.className = "dialog-input";
      field.value = options.input.value ?? "";
      if (options.input.placeholder) field.placeholder = options.input.placeholder;
      // Long names break the profile bar's layout and help nobody.
      field.maxLength = options.input.maxLength ?? 40;
      field.autocomplete = "off";
      field.spellcheck = false;

      panel.append(label, field);
    }

    const actions = document.createElement("div");
    actions.className = "dialog-actions";

    const cancelBtn = document.createElement("button");
    cancelBtn.type = "button";
    cancelBtn.className = "dialog-cancel";
    cancelBtn.textContent = options.cancelLabel ?? "Cancel";

    const confirmBtn = document.createElement("button");
    confirmBtn.type = "button";
    confirmBtn.className = options.danger ? "dialog-confirm danger" : "dialog-confirm";
    confirmBtn.textContent = options.confirmLabel ?? "OK";

    // An empty cancel label means a one-button acknowledgement, so the
    // button is omitted entirely rather than rendered blank.
    const hasCancel = options.cancelLabel !== "";
    if (hasCancel) actions.append(cancelBtn);
    actions.append(confirmBtn);
    panel.appendChild(actions);

    let settled = false;
    const close = (result: string | boolean | null) => {
      if (settled) return;
      settled = true;
      document.removeEventListener("keydown", onKeydown, true);
      overlay.remove();
      // Returning focus is what keeps keyboard and screen-reader users
      // where they were, rather than dumping them at the top of the page.
      previouslyFocused?.focus?.();
      resolve(result);
    };

    const accept = () => {
      haptic("ui");
      if (!field) return close(true);
      const value = field.value.trim();
      // An empty name would render as a blank chip with no way to pick it
      // again, so treat it as "not answered" rather than accepting it.
      if (!value) {
        field.focus();
        field.classList.add("invalid");
        return;
      }
      close(value);
    };
    const dismiss = () => {
      haptic("ui");
      close(field ? null : false);
    };

    confirmBtn.addEventListener("click", accept);
    cancelBtn.addEventListener("click", dismiss);
    // A tap on the backdrop cancels, matching the settings panel.
    overlay.addEventListener("pointerdown", (e) => {
      if (e.target === overlay) dismiss();
    });
    field?.addEventListener("input", () => field?.classList.remove("invalid"));
    field?.addEventListener("keydown", (e) => {
      if (e.key === "Enter") {
        e.preventDefault();
        accept();
      }
    });

    // Capture phase: the controller screen has window-level key handlers
    // that would otherwise act on a keystroke aimed at this dialog.
    const focusables = () => [
      ...(field ? [field] : []),
      ...(hasCancel ? [cancelBtn] : []),
      confirmBtn,
    ];
    const onKeydown = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.preventDefault();
        e.stopPropagation();
        dismiss();
        return;
      }
      if (e.key !== "Tab") return;
      // Trap: without this, Tab walks out into the gamepad behind the
      // dialog, which is both confusing and able to send real input.
      const items = focusables();
      const first = items[0];
      const last = items[items.length - 1];
      const active = document.activeElement;
      if (e.shiftKey && active === first) {
        e.preventDefault();
        last.focus();
      } else if (!e.shiftKey && active === last) {
        e.preventDefault();
        first.focus();
      }
    };
    document.addEventListener("keydown", onKeydown, true);

    document.body.appendChild(overlay);
    (field ?? confirmBtn).focus();
    if (field) field.select();
  });
}

export async function confirmDialog(
  title: string,
  options: { body?: string; confirmLabel?: string; cancelLabel?: string; danger?: boolean } = {},
): Promise<boolean> {
  return (await open({ title, ...options })) === true;
}

export async function promptDialog(
  title: string,
  options: {
    label: string;
    value?: string;
    placeholder?: string;
    body?: string;
    confirmLabel?: string;
  },
): Promise<string | null> {
  const { label, value, placeholder, ...rest } = options;
  const result = await open({ ...rest, title, input: { label, value, placeholder } });
  return typeof result === "string" ? result : null;
}

/// A one-button acknowledgement. Kept separate from `confirmDialog` so the
/// call sites read as statements rather than questions with a dead branch.
export async function alertDialog(title: string, body?: string): Promise<void> {
  await open({ title, body, confirmLabel: "OK", cancelLabel: "" });
}
