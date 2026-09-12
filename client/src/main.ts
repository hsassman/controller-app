// style.css first, then the focused sheets that build on it. Import order
// is cascade order, so anything here intentionally wins ties against the
// base rules rather than fighting them with extra specificity.
import "./style.css";
import "./styles/dialogs.css";
import "./styles/shell.css";
import "./styles/settings-extra.css";
import { renderConnectScreen } from "./screens/connect.ts";
import { renderControllerScreen } from "./screens/controller.ts";
import { loadSettings, applyHighContrast } from "./settings.ts";
import { applyAppearance } from "./theme.ts";
import { configureHaptics } from "./haptics.ts";
import { suppressZoomGestures } from "./zoom.ts";
import { consumeHandoff } from "./install.ts";
import { consumeSharedLayoutFromUrl } from "./share.ts";
import { createProfile } from "./profile.ts";
import { confirmDialog } from "./dialog.ts";

// Must run before anything reads storage. Arriving from the IP address at
// the permanent one is a different origin and so a different localStorage;
// this carries the layouts and settings across, and the very next line
// loads them.
consumeHandoff();

// A layout shared from another phone's Settings → Profiles → Share (see
// share.ts) arrives as a URL fragment. Handled before the first screen
// renders so it works from a cold start -- scanning the code is often how
// someone opens this app for the very first time.
const sharedLayout = consumeSharedLayoutFromUrl();

// Appearance is applied before the first screen renders, not after: doing
// it later means the connect screen paints once in the default theme and
// then visibly repaints in the user's, on every single launch.
const bootSettings = loadSettings();
suppressZoomGestures();
applyHighContrast(bootSettings.highContrast);
applyAppearance(bootSettings);
configureHaptics(bootSettings.haptics, bootSettings.hapticStrength);

const app = document.querySelector<HTMLDivElement>("#app")!;

/// `autoConnect` is true only for the very first render. Returning here
/// after Disconnect means the user asked to stop, so the connect screen
/// waits for them instead of immediately reconnecting.
function showConnectScreen(autoConnect: boolean): void {
  renderConnectScreen(
    app,
    (connection) => {
      renderControllerScreen(app, connection, () => showConnectScreen(false));
    },
    { autoConnect },
  );
}

async function boot(): Promise<void> {
  if (sharedLayout) {
    const accepted = await confirmDialog(`Import "${sharedLayout.name}"?`, {
      body: "It's added as a new profile without touching any layout you already have.",
      confirmLabel: "Import",
    });
    if (accepted) createProfile(sharedLayout.name, sharedLayout);
  }
  showConnectScreen(true);
}

void boot();
