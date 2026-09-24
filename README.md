# Phone Controller

**Turn your phone into a real Xbox controller for your PC — over Wi-Fi, with nothing to install on the phone.**

The phone runs a touch gamepad in its browser. The PC runs a small host app that receives the input and injects it as a genuine XInput device through [ViGEmBus](https://github.com/ViGEm/ViGEmBus). Games see an Xbox 360 controller — not a keyboard emulator, not a mouse macro. Steam sees it. Your games see it.

<p align="center">
  <img src="screenshots/02-controller.png" alt="The controller running on a phone in landscape" width="100%">
</p>

---

## Why this exists

Every phone-as-gamepad tool asks you to install an app on the phone, sign in, or pair over Bluetooth. This one doesn't. Start one program on the PC, open one address on the phone, and play. The phone never installs anything — it's a web page.

---

## Getting started

### Just want to play? (recommended — works on any Windows PC, nothing to install but one driver)

The app ships as a **portable build**: one `.exe` and a folder of static files. No Node.js, no Rust, no build step, on the PC you're actually going to play on.

1. Install [ViGEmBus](https://github.com/ViGEm/ViGEmBus/releases) (the driver that creates the virtual controller — this is the only thing that has to be installed, and only once per PC).
2. Download `PhoneController-Portable.zip` from the [latest release](../../releases/latest) and copy it to the PC you want to play on.
3. Unzip it anywhere, double-click **`controller-host.exe`**.
   - Windows will likely show a **"Windows protected your PC"** SmartScreen prompt the first time, because the exe isn't code-signed. Click **More info → Run anyway**. That's expected for an app shared this way, not a sign anything is wrong.
4. A window opens showing a **QR code**. Point your phone's camera at it.

That's it — no typing an IP on a phone keypad, and the page connects itself once it opens. The address is printed under the code if you'd rather type it.

> Both devices must be on the same Wi-Fi. If Windows Firewall prompts on the first run, allow it on **private networks**.
> To type the address manually instead, the host window shows that too.

### Play fullscreen: add it to your Home Screen

Opened from Safari or Chrome, the browser's address bar and toolbar eat the top and bottom of the screen — exactly the space a landscape gamepad wants. Added to your Home Screen, the same page launches standalone with no browser chrome at all, and connects itself on open.

The app offers this to you the first time you connect, and it's always available under **Settings → Look → "Play fullscreen — add to Home Screen"**. On iOS: **Share → Add to Home Screen**. On Android: **menu → Install app**.

**One catch worth knowing about, which the app handles for you.** A Home Screen icon pins the exact address it was made from. The obvious one — `http://192.168.x.x:8788` — belongs to a DHCP lease, so the day your router hands the PC a different IP, the icon opens a page that no longer exists.

So the host also advertises a **permanent address**: `http://<your-pc-name>.local:8788`. That name follows the machine whatever its IP becomes — Windows answers for it over mDNS, and iOS resolves it through Bonjour. Before you make the shortcut, the app checks your phone can actually reach that name and offers to move you there, carrying your layouts and settings across (they're stored per address, so it hands them over rather than leaving them behind). The host window shows the permanent address too.

If your network blocks mDNS — some guest networks and access points with client isolation do — the app simply doesn't make the offer, and says the shortcut is tied to the current IP. Nothing breaks; you just remake it if the address ever changes.

> Offline caching needs a secure origin, which a plain `http://` LAN address isn't, so the app always loads fresh over Wi-Fi rather than from a cache. Harmless here — your phone is on the same network as the host by definition.

**Building the portable zip yourself** (needs Node.js + Rust on the *building* machine only — not on the machine you'll play on):

```powershell
powershell -ExecutionPolicy Bypass -File .\Package-Release.ps1
```

This produces `PhoneController-Portable.zip` in the repo root. Copy that one file to any Windows PC, and steps 2–4 above are all that PC ever needs.

### Building from source and running directly (for developers)

If you have Node.js and Rust installed and want to build-and-run in place rather than produce a portable zip:

1. Install [ViGEmBus](https://github.com/ViGEm/ViGEmBus/releases).
2. Double-click **`Start-Controller.bat`**.

The first run builds the client and the host (a few minutes); every run after that just launches. If this reports Node.js or Rust as "not found" right after you installed them, see [Troubleshooting](#troubleshooting) below — it's almost always a stale PATH, not a bad install.

---

## Features

### Every control is editable

Tap **Edit layout**, then tap any control to open its properties. Move it, resize it, recolour it, change its shape — and **remap it to any of the 14 gamepad inputs**. Sticks get their own dead zone, so movement can stay forgiving while aim stays tight.

<p align="center">
  <img src="screenshots/03-editor.png" alt="The layout editor with a control's properties panel open" width="100%">
</p>

The editor has undo/redo (`Ctrl+Z`), snap-to-grid, duplicate (`Ctrl+D`), and a **Mirror** button that flips the whole layout for left-handed play. It's WYSIWYG — controls render at exactly the size they'll be in play.

### Seven layout presets

Start from a layout that already suits the game instead of dragging thirteen controls into place.

<p align="center">
  <img src="screenshots/04-presets.png" alt="The layout presets menu" width="100%">
</p>

| Preset | Built for |
| --- | --- |
| **Standard** | A full Xbox-style pad |
| **Shooter** | Oversized sticks, tall triggers, face cluster inboard |
| **Racing** | Full-height gas and brake, wide steering stick |
| **Platformer** | Large d-pad instead of an analog stick |
| **Large targets** | Fewer, much bigger, widely spaced controls |
| **Minimal** | D-pad and two buttons, for retro games |
| **Left-handed** | The standard layout mirrored |

### Profiles

Each profile is a complete layout. Keep a shooter layout and a racing layout side by side and switch between them from the bar at the top. Profiles can be renamed, duplicated, exported to a file and imported back.

### Themes and feel

Eight themes, a free-form accent colour, and control size, opacity and labels all adjustable. Vibration strength, stick dead zone and sensitivity curve are yours to tune.

Beyond colour, the pad's **material** changes how every control catches light — matte, gloss, brushed metal or neon — and the **d-pad** can be a moulded cross, four separate keys, or a round rocker disc. Press glow is a slider, down to off. **Dim when idle** fades the controls after a chosen pause and brings them straight back on the next touch, which is what you want when the phone is next to you between rounds or you're recording the screen.

<p align="center">
  <img src="screenshots/05-settings.png" alt="The settings panel" width="70%">
</p>

<p align="center">
  <img src="screenshots/06-theme-nebula.png" alt="The Nebula theme" width="49%">
  <img src="screenshots/07-theme-mint.png" alt="The Mint theme" width="49%">
</p>

### Built for accessibility, not retrofitted with it

- **Fully keyboard operable.** Every control, the editor, the properties panel and the settings dialog work without a touchscreen — arrow keys drive the sticks, d-pad and triggers.
- **High-contrast mode** that genuinely flattens every decorative layer, on every theme.
- **Toggle mode** per button: press once to hold, press again to release.
- **Reduce motion**, honouring both the app setting and the OS preference.
- **Pinch-zoom stays available** everywhere except the pad itself, so the connect screen and settings text can be magnified. Locking zoom app-wide is the usual shortcut here, and it fails WCAG 1.4.4 for anyone who needs larger text.
- **A custom accent can't make labels unreadable.** Pick any colour you like; where the accent is used as text it is lightened only as far as 4.5:1 requires, so the hue survives and the words stay legible.
- Every touch target clears WCAG 2.2's 24px minimum; UI boundaries clear 3:1 contrast on all eight themes.

<p align="center">
  <img src="screenshots/08-high-contrast.png" alt="High-contrast mode" width="100%">
</p>

### Details that matter in a game

- **100 Hz input**, sent as a fixed 15-byte binary frame — no JSON parsing in the hot path.
- **Live latency readout** in the top bar, so "it feels laggy" has an actual number attached.
- **Heartbeat detection.** A phone that walks out of Wi-Fi range produces no TCP reset, so the socket would sit open and the UI would keep claiming "Connected". A ping/pong heartbeat catches that and reconnects.
- **Nothing gets stuck.** Rotating the phone, opening settings, switching profiles or disconnecting all release held inputs and flush a neutral frame first — because the host keeps applying the last frame it received, so "stop sending" is not the same as "release".
- **A dead link releases the pad.** A phone that sleeps or leaves Wi-Fi sends no TCP close, so the host would otherwise sit on its last frame until Windows' keepalive noticed — hours later, with your character still running forward. The host drops a client that goes quiet for six seconds and returns the pad to neutral.
- **Screen wake lock**, so the phone doesn't dim mid-game.
- Multi-touch throughout, with per-control pointer ownership so a stray thumb can't release a button someone else is holding.

---

## Checking that it works

The host window has a live input monitor — press something on the phone and the buttons light up, the stick dots move, the trigger bars fill. The window walks you through this on first run, and says plainly when the ViGEmBus driver is missing, which is the one failure that otherwise looks like a working connection: the phone connects, reports "Connected", and every press is silently discarded.

> **Windows' own "Game controllers" panel (`joy.cpl`) will not show it moving.** That panel reads the legacy DirectInput API, which Xbox-type controllers — real ones included — don't report through. It is not a sign that anything is wrong. Games and Steam read XInput and see the pad correctly.

---

## Requirements

**To play** (the portable build): Windows with [ViGEmBus](https://github.com/ViGEm/ViGEmBus/releases) installed. Nothing else.

**To build** (either the portable zip or running from source): [Node.js](https://nodejs.org) and [Rust](https://rustup.rs), only on the machine doing the building. Never on the machine you're playing on.

---

## Troubleshooting

### "Node.js/Rust was not found" right after installing it

This is almost always a **stale PATH**, not a broken install. Installing Node.js or Rust updates an environment variable, but every program that was already running — including File Explorer, and therefore every window it opens when you double-click a `.bat` file — keeps the PATH it started with. Windows doesn't push the update into running programs.

`Start-Controller.bat` already re-reads the current PATH before checking anything, so a stale Explorer session usually isn't a problem. If it still reports a tool missing:

1. Close the window and **open a brand new Command Prompt**, then run the `.bat` from there.
2. If that still fails, **restart your PC once** — this always picks up a PATH change, no exceptions.
3. Confirm the install actually landed: open a new Command Prompt and run `where node` / `where cargo`. If neither prints a path, the install itself didn't complete — reinstall from [nodejs.org](https://nodejs.org) / [rustup.rs](https://rustup.rs).

### Rust fails to build with a linker error

Rust on Windows needs the **Desktop development with C++** workload from the Visual Studio Build Tools to link native code. `rustup` normally prompts to install this the first time you build; if that was skipped, get it from [visualstudio.microsoft.com/visual-cpp-build-tools](https://visualstudio.microsoft.com/visual-cpp-build-tools/).

### None of this should matter for the person actually playing

If you're setting this up for someone else, don't make them deal with any of the above — build `PhoneController-Portable.zip` yourself (see [Getting started](#getting-started)) and just send them that. It needs nothing but ViGEmBus.

### The address or QR code seems to change, or a typed address won't connect

Only one copy of `controller-host.exe` can meaningfully run at a time — a second launch (easy to trigger by double-clicking it again out of habit, or from a stale shortcut) now just brings the existing window to the front rather than starting a competing copy. Before this was enforced, a second instance would silently fall back to different ports for everything and plug in a second, separate virtual controller, leaving two different addresses in play with no way to tell which one a game was actually reading from — which looked exactly like "the address keeps changing" or "the one I typed doesn't work."

If you're hitting this on a build from before it was fixed: close every "Controller Host" window and check Task Manager for any `controller-host.exe` still running in the background, end them all, then relaunch once.

---

## How it works

```
  Phone (browser)                          PC
 ┌────────────────┐                ┌────────────────────┐
 │  Touch gamepad │  15-byte       │  WebSocket server  │
 │       PWA      │  frames  ──────▶       :8787        │
 │                │  @ 100 Hz      │         │          │
 │                │                │         ▼          │
 │                │  ◀──────       │  ViGEmBus driver   │
 │                │  page + pong   │         │          │
 └────────────────┘                │         ▼          │
                                   │  Virtual Xbox 360  │
                                   │   pad → your game  │
                                   └────────────────────┘
```

The host also serves the phone page itself over HTTP on `:8788`, which is what removes the install step and the manual IP entry. If either port is already taken, it detects that and moves to the next one rather than silently sharing it.

### Repository layout

```
client/                phone PWA — Vite + TypeScript, no UI framework
host/                  Windows host — Tauri + Rust: gamepad injection and page server
protocol/              the binary frame layout both sides implement
Start-Controller.bat    build-and-run from source (developers)
Package-Release.ps1     build the portable zip (see Getting started)
```

### Developing

```bash
cd client && npm run dev          # phone app with hot reload on :5173
cd host/src-tauri && cargo run    # host app
```

After changing client code, `npm run build` in `client/` refreshes what the host serves.

---

## Out of scope, deliberately

No macros, no rapid-fire, no aim assist. This is a controller, not an advantage.

## Licence

MIT
