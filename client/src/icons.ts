// Toolbar icons, drawn as SVG rather than text symbols (⛶ ✎ ⚙ ⏻). Phone
// fonts draw those characters at different sizes and heights, and iOS has
// no glyph at all for some, so they never sat centred in their buttons.
// Each icon is a 24-unit square that inherits the button's text colour.

const svg = (body: string) =>
  `<svg class="icon" viewBox="0 0 24 24" aria-hidden="true" focusable="false" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">${body}</svg>`;

export const ICONS = {
  fullscreen: svg(`<path d="M4 9V4h5M15 4h5v5M20 15v5h-5M9 20H4v-5"/>`),
  edit: svg(`<path d="M4 20h4L19 9a2.83 2.83 0 0 0-4-4L4 16v4z"/><path d="M13.5 6.5l4 4"/>`),
  settings: svg(
    `<circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 1 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 1 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 1 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 1 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z"/>`,
  ),
  power: svg(`<path d="M12 3v8"/><path d="M6.4 6.6a8 8 0 1 0 11.2 0"/>`),
  camera: svg(
    `<path d="M3 8a2 2 0 0 1 2-2h2l1.5-2h7L17 6h2a2 2 0 0 1 2 2v10a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/><circle cx="12" cy="13" r="3.5"/>`,
  ),
} as const;
