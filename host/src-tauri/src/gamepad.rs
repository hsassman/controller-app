use vigem_client::{Client, TargetId, XButtons, XGamepad, Xbox360Wired};

use crate::frame::InputFrame;

mod wire_bit {
    pub const A: u16 = 1 << 0;
    pub const B: u16 = 1 << 1;
    pub const X: u16 = 1 << 2;
    pub const Y: u16 = 1 << 3;
    pub const DPAD_UP: u16 = 1 << 4;
    pub const DPAD_DOWN: u16 = 1 << 5;
    pub const DPAD_LEFT: u16 = 1 << 6;
    pub const DPAD_RIGHT: u16 = 1 << 7;
    pub const L1: u16 = 1 << 8;
    pub const R1: u16 = 1 << 9;
    pub const L3: u16 = 1 << 10;
    pub const R3: u16 = 1 << 11;
    pub const START: u16 = 1 << 12;
    pub const SELECT: u16 = 1 << 13;
}

#[derive(Debug)]
pub enum GamepadError {
    /// ViGEmBus driver not installed / bus device unreachable.
    DriverUnavailable,
    /// Any other vigem-client failure (plugin, wait_ready, update).
    Vigem(String),
}

impl std::fmt::Display for GamepadError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            GamepadError::DriverUnavailable => write!(
                f,
                "ViGEmBus driver not installed or unreachable -- install it from \
                 https://github.com/ViGEm/ViGEmBus/releases"
            ),
            GamepadError::Vigem(msg) => write!(f, "vigem-client error: {msg}"),
        }
    }
}

impl std::error::Error for GamepadError {}

/// The single virtual Xbox 360 controller, plugged in for the process
/// lifetime.
pub struct VirtualGamepad {
    target: Xbox360Wired<Client>,
}

impl VirtualGamepad {
    /// Connects to ViGEmBus and plugs in the virtual controller. Called
    /// once at startup.
    pub fn connect() -> Result<Self, GamepadError> {
        let client = Client::connect().map_err(|_| GamepadError::DriverUnavailable)?;
        let mut target = Xbox360Wired::new(client, TargetId::XBOX360_WIRED);

        target
            .plugin()
            .map_err(|e| GamepadError::Vigem(format!("plugin failed: {e:?}")))?;
        target
            .wait_ready()
            .map_err(|e| GamepadError::Vigem(format!("wait_ready failed: {e:?}")))?;

        let neutral = XGamepad::default();
        let mut last_err = String::new();
        let mut ready = false;
        for _ in 0..40 {
            match target.update(&neutral) {
                Ok(()) => {
                    ready = true;
                    break;
                }
                Err(e) => {
                    last_err = format!("{e:?}");
                    std::thread::sleep(std::time::Duration::from_millis(50));
                }
            }
        }
        if !ready {
            return Err(GamepadError::Vigem(format!(
                "virtual pad never became ready to accept updates (last error: {last_err})"
            )));
        }

        Ok(VirtualGamepad { target })
    }

    /// The XInput user index (0-3) Windows assigned this pad, if it can be
    /// determined. Logged at startup because "which slot am I?" is the
    /// single most useful thing to know when a game isn't responding.
    pub fn user_index(&mut self) -> Option<u32> {
        self.target.get_user_index().ok()
    }

    pub fn apply(&mut self, frame: &InputFrame) -> Result<(), GamepadError> {
        self.update(&Self::to_xgamepad(frame))
    }

    /// Releases everything. Used when a client disconnects so a dropped
    /// connection can't leave a button stuck down on the still-plugged-in
    /// virtual pad.
    pub fn reset(&mut self) -> Result<(), GamepadError> {
        self.update(&XGamepad::default())
    }

    fn update(&mut self, gamepad: &XGamepad) -> Result<(), GamepadError> {
        self.target
            .update(gamepad)
            .map_err(|e| GamepadError::Vigem(format!("{e:?}")))
    }

    fn to_xgamepad(frame: &InputFrame) -> XGamepad {
        let b = frame.buttons;
        let mut buttons: u16 = 0;
        // Map our wire bits onto vigem-client's XButtons constants (which
        // are the standard XINPUT_GAMEPAD.wButtons values).
        let map: [(u16, u16); 14] = [
            (wire_bit::A, XButtons::A),
            (wire_bit::B, XButtons::B),
            (wire_bit::X, XButtons::X),
            (wire_bit::Y, XButtons::Y),
            (wire_bit::DPAD_UP, XButtons::UP),
            (wire_bit::DPAD_DOWN, XButtons::DOWN),
            (wire_bit::DPAD_LEFT, XButtons::LEFT),
            (wire_bit::DPAD_RIGHT, XButtons::RIGHT),
            (wire_bit::L1, XButtons::LB),
            (wire_bit::R1, XButtons::RB),
            (wire_bit::L3, XButtons::LTHUMB),
            (wire_bit::R3, XButtons::RTHUMB),
            (wire_bit::START, XButtons::START),
            (wire_bit::SELECT, XButtons::BACK),
        ];
        for (wire, xinput) in map {
            if b & wire != 0 {
                buttons |= xinput;
            }
        }

        XGamepad {
            buttons: XButtons(buttons),
            left_trigger: frame.left_trigger,
            right_trigger: frame.right_trigger,
            thumb_lx: frame.left_stick_x,
            thumb_ly: frame.left_stick_y,
            thumb_rx: frame.right_stick_x,
            thumb_ry: frame.right_stick_y,
        }
    }
}
