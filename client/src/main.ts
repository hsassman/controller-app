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

// Must run before anything reads storage. Arriving from the IP address at
// the permanent one is a different origin and so a different localStorage;
// this carries the layouts and settings across, and the very next line
// loads them.
consumeHandoff();

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

showConnectScreen(true);
