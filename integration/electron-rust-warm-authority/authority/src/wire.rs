use std::fmt;

pub const STDIO_MAGIC: [u8; 4] = *b"EXCL";
pub const STDIO_PROTOCOL_VERSION: u16 = 0;
pub const MAX_STDIO_FRAME_BYTE_LENGTH: usize = 1024 * 1024;
const FRAME_PREFIX_BYTE_LENGTH: usize = 4;
const FRAME_HEADER_BYTE_LENGTH: usize = 8;
const MIN_TOTAL_FRAME_BYTE_LENGTH: usize = FRAME_PREFIX_BYTE_LENGTH + FRAME_HEADER_BYTE_LENGTH;

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
#[repr(u16)]
pub enum FrameKind {
    AuthorityStarting = 1,
    AuthorityReady = 2,
    SubscribeRequest = 3,
    SubscribeResult = 4,
    ControlRequest = 5,
    ControlResponse = 6,
    WarmPublication = 7,
    PublicationCredit = 8,
    MetricsRequest = 9,
    MetricsResponse = 10,
    Shutdown = 11,
    UnsubscribeRequest = 12,
    UnsubscribeResult = 13,
}

impl TryFrom<u16> for FrameKind {
    type Error = WireError;

    fn try_from(value: u16) -> Result<Self, Self::Error> {
        match value {
            1 => Ok(Self::AuthorityStarting),
            2 => Ok(Self::AuthorityReady),
            3 => Ok(Self::SubscribeRequest),
            4 => Ok(Self::SubscribeResult),
            5 => Ok(Self::ControlRequest),
            6 => Ok(Self::ControlResponse),
            7 => Ok(Self::WarmPublication),
            8 => Ok(Self::PublicationCredit),
            9 => Ok(Self::MetricsRequest),
            10 => Ok(Self::MetricsResponse),
            11 => Ok(Self::Shutdown),
            12 => Ok(Self::UnsubscribeRequest),
            13 => Ok(Self::UnsubscribeResult),
            unknown => Err(WireError::UnknownKind(unknown)),
        }
    }
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct StdioFrame {
    pub kind: FrameKind,
    pub payload: Vec<u8>,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum WireError {
    EncodeTooLarge {
        total: usize,
        max: usize,
    },
    DeclaredFrameTooLarge {
        declared_total: u64,
        max: usize,
    },
    DeclaredFrameTooShort {
        declared_body: u32,
        minimum: usize,
    },
    InvalidMagic([u8; 4]),
    UnsupportedVersion(u16),
    UnknownKind(u16),
    TruncatedEof {
        buffered: usize,
        declared_total: Option<u64>,
    },
}

impl fmt::Display for WireError {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            Self::EncodeTooLarge { total, max } => write!(
                formatter,
                "stdio frame byte length {total} exceeds maximum {max}"
            ),
            Self::DeclaredFrameTooLarge {
                declared_total,
                max,
            } => write!(
                formatter,
                "declared stdio frame byte length {declared_total} exceeds maximum {max}"
            ),
            Self::DeclaredFrameTooShort {
                declared_body,
                minimum,
            } => write!(
                formatter,
                "declared stdio frame body byte length {declared_body} is shorter than header {minimum}"
            ),
            Self::InvalidMagic(actual) => write!(
                formatter,
                "invalid stdio magic {:02x}{:02x}{:02x}{:02x}",
                actual[0], actual[1], actual[2], actual[3]
            ),
            Self::UnsupportedVersion(version) => {
                write!(formatter, "unsupported stdio protocol version {version}")
            }
            Self::UnknownKind(kind) => write!(formatter, "unknown stdio frame kind {kind}"),
            Self::TruncatedEof {
                buffered,
                declared_total,
            } => match declared_total {
                Some(declared_total) => write!(
                    formatter,
                    "truncated stdio frame at EOF: buffered {buffered} of declared {declared_total} bytes"
                ),
                None => write!(
                    formatter,
                    "truncated stdio frame prefix at EOF: buffered {buffered} of 4 bytes"
                ),
            },
        }
    }
}

impl std::error::Error for WireError {}

pub fn encode_stdio_frame(kind: FrameKind, payload: &[u8]) -> Result<Vec<u8>, WireError> {
    let frame_body_byte_length =
        FRAME_HEADER_BYTE_LENGTH
            .checked_add(payload.len())
            .ok_or(WireError::EncodeTooLarge {
                total: usize::MAX,
                max: MAX_STDIO_FRAME_BYTE_LENGTH,
            })?;
    let total_byte_length = FRAME_PREFIX_BYTE_LENGTH
        .checked_add(frame_body_byte_length)
        .ok_or(WireError::EncodeTooLarge {
            total: usize::MAX,
            max: MAX_STDIO_FRAME_BYTE_LENGTH,
        })?;
    if total_byte_length > MAX_STDIO_FRAME_BYTE_LENGTH || frame_body_byte_length > u32::MAX as usize
    {
        return Err(WireError::EncodeTooLarge {
            total: total_byte_length,
            max: MAX_STDIO_FRAME_BYTE_LENGTH,
        });
    }

    let mut bytes = Vec::with_capacity(total_byte_length);
    bytes.extend_from_slice(&(frame_body_byte_length as u32).to_le_bytes());
    bytes.extend_from_slice(&STDIO_MAGIC);
    bytes.extend_from_slice(&STDIO_PROTOCOL_VERSION.to_le_bytes());
    bytes.extend_from_slice(&(kind as u16).to_le_bytes());
    bytes.extend_from_slice(payload);
    Ok(bytes)
}

#[derive(Debug, Default)]
pub struct StdioFrameDecoder {
    buffer: Vec<u8>,
}

impl StdioFrameDecoder {
    pub fn new() -> Self {
        Self::default()
    }

    pub fn push(&mut self, chunk: &[u8]) -> Result<Vec<StdioFrame>, WireError> {
        self.buffer.extend_from_slice(chunk);
        let mut frames = Vec::new();

        loop {
            if self.buffer.len() < FRAME_PREFIX_BYTE_LENGTH {
                break;
            }

            let frame_body_byte_length = u32::from_le_bytes(
                self.buffer[..FRAME_PREFIX_BYTE_LENGTH]
                    .try_into()
                    .expect("prefix length checked"),
            );
            let total_byte_length = u64::from(frame_body_byte_length) + 4;
            if total_byte_length > MAX_STDIO_FRAME_BYTE_LENGTH as u64 {
                return Err(WireError::DeclaredFrameTooLarge {
                    declared_total: total_byte_length,
                    max: MAX_STDIO_FRAME_BYTE_LENGTH,
                });
            }
            if frame_body_byte_length < FRAME_HEADER_BYTE_LENGTH as u32 {
                return Err(WireError::DeclaredFrameTooShort {
                    declared_body: frame_body_byte_length,
                    minimum: FRAME_HEADER_BYTE_LENGTH,
                });
            }

            if self.buffer.len() < MIN_TOTAL_FRAME_BYTE_LENGTH {
                break;
            }

            let magic: [u8; 4] = self.buffer[4..8].try_into().expect("header length checked");
            if magic != STDIO_MAGIC {
                return Err(WireError::InvalidMagic(magic));
            }
            let version = u16::from_le_bytes(
                self.buffer[8..10]
                    .try_into()
                    .expect("header length checked"),
            );
            if version != STDIO_PROTOCOL_VERSION {
                return Err(WireError::UnsupportedVersion(version));
            }
            let kind = FrameKind::try_from(u16::from_le_bytes(
                self.buffer[10..12]
                    .try_into()
                    .expect("header length checked"),
            ))?;

            let total_byte_length = total_byte_length as usize;
            if self.buffer.len() < total_byte_length {
                break;
            }

            let payload = self.buffer[MIN_TOTAL_FRAME_BYTE_LENGTH..total_byte_length].to_vec();
            self.buffer.drain(..total_byte_length);
            frames.push(StdioFrame { kind, payload });
        }

        Ok(frames)
    }

    pub fn finish(&self) -> Result<(), WireError> {
        if self.buffer.is_empty() {
            return Ok(());
        }
        let declared_total = if self.buffer.len() >= FRAME_PREFIX_BYTE_LENGTH {
            let declared_body = u32::from_le_bytes(
                self.buffer[..FRAME_PREFIX_BYTE_LENGTH]
                    .try_into()
                    .expect("prefix length checked"),
            );
            Some(u64::from(declared_body) + 4)
        } else {
            None
        };
        Err(WireError::TruncatedEof {
            buffered: self.buffer.len(),
            declared_total,
        })
    }

    #[cfg(test)]
    fn buffered_byte_length(&self) -> usize {
        self.buffer.len()
    }
}

#[cfg(test)]
mod tests {
    use super::{
        encode_stdio_frame, FrameKind, StdioFrameDecoder, WireError, MAX_STDIO_FRAME_BYTE_LENGTH,
    };

    #[test]
    fn protocol_v0_kind_numbers_are_stable() {
        assert_eq!(FrameKind::AuthorityStarting as u16, 1);
        assert_eq!(FrameKind::AuthorityReady as u16, 2);
        assert_eq!(FrameKind::SubscribeRequest as u16, 3);
        assert_eq!(FrameKind::SubscribeResult as u16, 4);
        assert_eq!(FrameKind::ControlRequest as u16, 5);
        assert_eq!(FrameKind::ControlResponse as u16, 6);
        assert_eq!(FrameKind::WarmPublication as u16, 7);
        assert_eq!(FrameKind::PublicationCredit as u16, 8);
        assert_eq!(FrameKind::MetricsRequest as u16, 9);
        assert_eq!(FrameKind::MetricsResponse as u16, 10);
        assert_eq!(FrameKind::Shutdown as u16, 11);
        assert_eq!(FrameKind::UnsubscribeRequest as u16, 12);
        assert_eq!(FrameKind::UnsubscribeResult as u16, 13);
    }

    #[test]
    fn incremental_decoder_accepts_every_fragment_boundary_and_concatenation() {
        let first =
            encode_stdio_frame(FrameKind::SubscribeRequest, br#"{"requestKey":"a"}"#).unwrap();
        let second =
            encode_stdio_frame(FrameKind::MetricsRequest, br#"{"requestKey":"b"}"#).unwrap();
        let mut concatenated = first.clone();
        concatenated.extend_from_slice(&second);

        for split in 0..=concatenated.len() {
            let mut decoder = StdioFrameDecoder::new();
            let mut decoded = decoder.push(&concatenated[..split]).unwrap();
            decoded.extend(decoder.push(&concatenated[split..]).unwrap());
            decoder.finish().unwrap();
            assert_eq!(decoded.len(), 2, "split {split}");
            assert_eq!(decoded[0].kind, FrameKind::SubscribeRequest);
            assert_eq!(decoded[1].kind, FrameKind::MetricsRequest);
        }
    }

    #[test]
    fn declared_oversize_is_rejected_from_prefix_without_allocating_declared_size() {
        let declared_body = MAX_STDIO_FRAME_BYTE_LENGTH as u32;
        let mut decoder = StdioFrameDecoder::new();

        assert_eq!(
            decoder.push(&declared_body.to_le_bytes()).unwrap_err(),
            WireError::DeclaredFrameTooLarge {
                declared_total: MAX_STDIO_FRAME_BYTE_LENGTH as u64 + 4,
                max: MAX_STDIO_FRAME_BYTE_LENGTH,
            }
        );
        assert_eq!(decoder.buffered_byte_length(), 4);
    }

    #[test]
    fn decoder_reports_unknown_kind_and_truncated_eof_explicitly() {
        let mut unknown = Vec::new();
        unknown.extend_from_slice(&8_u32.to_le_bytes());
        unknown.extend_from_slice(b"EXCL");
        unknown.extend_from_slice(&0_u16.to_le_bytes());
        unknown.extend_from_slice(&99_u16.to_le_bytes());
        assert_eq!(
            StdioFrameDecoder::new().push(&unknown).unwrap_err(),
            WireError::UnknownKind(99)
        );

        let complete = encode_stdio_frame(FrameKind::Shutdown, b"{}").unwrap();
        let mut truncated = StdioFrameDecoder::new();
        assert!(truncated
            .push(&complete[..complete.len() - 1])
            .unwrap()
            .is_empty());
        assert!(matches!(
            truncated.finish(),
            Err(WireError::TruncatedEof { .. })
        ));
    }

    #[test]
    fn malformed_magic_and_version_are_explicit() {
        let mut invalid_magic = encode_stdio_frame(FrameKind::Shutdown, b"{}").unwrap();
        invalid_magic[4] = b'X';
        assert!(matches!(
            StdioFrameDecoder::new().push(&invalid_magic),
            Err(WireError::InvalidMagic(_))
        ));

        let mut invalid_version = encode_stdio_frame(FrameKind::Shutdown, b"{}").unwrap();
        invalid_version[8..10].copy_from_slice(&1_u16.to_le_bytes());
        assert_eq!(
            StdioFrameDecoder::new().push(&invalid_version).unwrap_err(),
            WireError::UnsupportedVersion(1)
        );
    }

    #[test]
    fn encoder_enforces_total_one_mebibyte_cap() {
        let payload = vec![0; MAX_STDIO_FRAME_BYTE_LENGTH];
        assert!(matches!(
            encode_stdio_frame(FrameKind::WarmPublication, &payload),
            Err(WireError::EncodeTooLarge { .. })
        ));
    }
}
