//! Binary frame constants for the host. Mirrors `protocol/frame.ts`, which
//! is the client's half of the same wire format: the two must be changed
//! together.

pub const FRAME_TYPE_INPUT: u8 = 0x01;
pub const FRAME_TYPE_PING: u8 = 0x02;
pub const FRAME_TYPE_PONG: u8 = 0x03;

pub const INPUT_FRAME_SIZE: usize = 15;
/// Type byte + u16 little-endian sequence.
pub const PING_PONG_FRAME_SIZE: usize = 3;

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
