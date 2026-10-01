//! Binary frame constants for the host. Mirrors `protocol/frame.ts`, which
//! is the client's half of the same wire format: the two must be changed
//! together.

pub const FRAME_TYPE_INPUT: u8 = 0x01;
pub const FRAME_TYPE_PING: u8 = 0x02;
pub const FRAME_TYPE_PONG: u8 = 0x03;
/// Host -> phone: the game changed the pad's rumble motors or player LED.
pub const FRAME_TYPE_RUMBLE: u8 = 0x04;

pub const INPUT_FRAME_SIZE: usize = 15;
/// Type byte + u16 little-endian sequence.
pub const PING_PONG_FRAME_SIZE: usize = 3;
/// Type byte, large motor, small motor, player slot (255 = unassigned).
pub const RUMBLE_FRAME_SIZE: usize = 4;

/// Player slot value meaning "Windows has not assigned one yet".
pub const NO_PLAYER: u8 = 255;

/// Builds a RUMBLE frame. The motors are the 0-255 values ViGEm reports,
/// which is the high byte of the 16-bit XInput motor speed the game set.
pub fn rumble_frame(large: u8, small: u8, player: u8) -> [u8; RUMBLE_FRAME_SIZE] {
    [FRAME_TYPE_RUMBLE, large, small, player]
}

/// Builds the PONG reply for a PING, echoing its sequence unchanged. The
/// sequence is opaque to the host -- it exists only so the client can match
/// a reply to the request it timed.
pub fn pong_for(ping: &[u8]) -> Option<[u8; PING_PONG_FRAME_SIZE]> {
    if ping.len() != PING_PONG_FRAME_SIZE || ping[0] != FRAME_TYPE_PING {
        return None;
    }
    Some([FRAME_TYPE_PONG, ping[1], ping[2]])
}

#[derive(Debug, Clone, Copy, Default)]
pub struct InputFrame {
    #[allow(dead_code)]
    pub sequence: u16,
    pub buttons: u16,
    pub left_stick_x: i16,
    pub left_stick_y: i16,
    pub right_stick_x: i16,
    pub right_stick_y: i16,
    pub left_trigger: u8,
    pub right_trigger: u8,
}

#[derive(Debug)]
pub struct FrameParseError;

impl InputFrame {
    pub fn parse(bytes: &[u8]) -> Result<Self, FrameParseError> {
        if bytes.len() != INPUT_FRAME_SIZE || bytes[0] != FRAME_TYPE_INPUT {
            return Err(FrameParseError);
        }
        Ok(InputFrame {
            sequence: u16::from_le_bytes([bytes[1], bytes[2]]),
            buttons: u16::from_le_bytes([bytes[3], bytes[4]]),
            left_stick_x: i16::from_le_bytes([bytes[5], bytes[6]]),
            left_stick_y: i16::from_le_bytes([bytes[7], bytes[8]]),
            right_stick_x: i16::from_le_bytes([bytes[9], bytes[10]]),
            right_stick_y: i16::from_le_bytes([bytes[11], bytes[12]]),
            left_trigger: bytes[13],
            right_trigger: bytes[14],
        })
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn rumble_frame_layout_matches_the_client_decoder() {
        assert_eq!(rumble_frame(200, 17, 0), [0x04, 200, 17, 0]);
        assert_eq!(rumble_frame(0, 0, NO_PLAYER), [0x04, 0, 0, 255]);
    }

    #[test]
    fn pong_echoes_the_sequence() {
        assert_eq!(
            pong_for(&[FRAME_TYPE_PING, 7, 1]),
            Some([FRAME_TYPE_PONG, 7, 1])
        );
        assert_eq!(pong_for(&[FRAME_TYPE_INPUT, 7, 1]), None);
        assert_eq!(pong_for(&[FRAME_TYPE_PING, 7]), None);
    }

    #[test]
    fn input_frame_parses_little_endian_fields() {
        let mut bytes = [0u8; INPUT_FRAME_SIZE];
        bytes[0] = FRAME_TYPE_INPUT;
        bytes[3..5].copy_from_slice(&(1u16 << 14).to_le_bytes());
        bytes[5..7].copy_from_slice(&(-32768i16).to_le_bytes());
        bytes[14] = 255;
        let frame = InputFrame::parse(&bytes).unwrap();
        assert_eq!(frame.buttons, 1 << 14);
        assert_eq!(frame.left_stick_x, -32768);
        assert_eq!(frame.right_trigger, 255);
        assert!(InputFrame::parse(&bytes[..14]).is_err());
    }
}
