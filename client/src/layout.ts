import { PAD_STYLES } from "./padStyles.ts";

export interface ButtonConfig {
  id: string;
  type: "button";
  label: string;
  bit: number;
  x: number;
  y: number;
  /// Diameter for round buttons, and the fallback for `width`/`height`.
  size: number;
  width?: number;
  height?: number;
  shape?: "circle" | "pill" | "square";
  /// Per-control accent tint (hex). Drives the button's ring and its
  /// pressed fill, so a user can colour-code a custom layout the way the
  /// stock face buttons are coloured.
  tint?: string;
  /// Per-control override for the global press-glow effect. Absent means
  /// "follow the global Look setting"; false turns glow off on just this
  /// control even while the rest of the pad glows.
  glow?: boolean;
  toggle: boolean;
}

export interface DpadConfig {
  id: string;
  type: "dpad";
  x: number;
  y: number;
  size: number;
  tint?: string;
  glow?: boolean;
}

export interface StickConfig {
  id: string;
  type: "stick";
  label: string;
  x: number;
  y: number;
  size: number;
  clickBit: number;
  /// Per-stick dead zone override (fraction of the radius). When absent the
  /// global setting applies -- per-control overrides exist because a player
  /// often wants a large dead zone for movement and a tight one for aim.
  deadZone?: number;
  tint?: string;
  glow?: boolean;
  /// Which physical axis pair this drives. Must be explicit: inferring it
  /// from `id` broke as soon as the editor could create/duplicate controls
  /// (every new stick silently became the right stick).
  stick: "left" | "right";
}

export interface TriggerConfig {
  id: string;
  type: "trigger";
  label: string;
  x: number;
  y: number;
  width: number;
  height: number;
  tint?: string;
  glow?: boolean;
  /// Explicit for the same reason as StickConfig.stick.
  trigger: "left" | "right";
  /// Fraction of travel from the resting edge that reads as zero. Absent
  /// means 0 -- a bare finger graze already registers, matching the
  /// pre-existing behaviour.
  deadZone?: number;
  /// Response curve applied after the dead zone, same convention as a
  /// stick's sensitivityCurve: 1 is linear, >1 gives more precision near
  /// the resting edge. Absent means 1 (linear), matching the pre-existing
  /// behaviour.
  curve?: number;
}

export type ControlConfig = ButtonConfig | DpadConfig | StickConfig | TriggerConfig;

/// A profile's own visual backdrop, independent of the active theme. Absent
/// means "just the theme's plain background" -- most profiles never set one.
export interface BackgroundConfig {
  type: "color" | "image";
  /// A hex colour for "color", or a data: URL for "image".
  value: string;
  /// Photo adjustments (image backgrounds only; all optional, so older
  /// saved profiles keep working). See applyBackground() in theme.ts.
  fit?: "cover" | "contain";
  /// How strongly the photo shows over the theme's own backdrop, 0.15-1.
  opacity?: number;
  /// 0.3-1.5; 1 is the photo as taken.
  brightness?: number;
  /// Softening, in px, 0-16.
  blur?: number;
  filter?: BackgroundFilter;
}

export type BackgroundFilter = "none" | "mono" | "sepia" | "warm" | "cool" | "vivid" | "fade";

export interface Layout {
  id: string;
  name: string;
  controls: ControlConfig[];
  /// A small identity colour shown as a dot next to the profile's name in
  /// the switcher and the Profiles list, so profiles are recognisable at a
  /// glance instead of being an unlabelled list of similar names.
  color?: string;
  background?: BackgroundConfig;
}

/// The Xbox 360 layout -- offset sticks, d-pad under the left stick, the
/// Guide button with its ring of light in the middle. See padStyles.ts.
export function defaultLayout(): Layout {
  return { ...PAD_STYLES[0].layout(), id: "default", name: "Default" };
}
