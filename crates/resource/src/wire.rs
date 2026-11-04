use crate::Transfer;
use std::io::{self, Write};

pub const VERSION: u16 = 1;
pub const HEADER_BYTES: usize = 48;
pub const MAX_CHUNK_BYTES: usize = 256 * 1024;

/// One writer per bulk pipe. The backing slice is never repacked or Base64 encoded.
pub fn write_transfer(writer: &mut impl Write, transfer: &Transfer) -> io::Result<()> {
    let mut header = [0_u8; HEADER_BYTES];
    header[..4].copy_from_slice(b"EXRB");
    header[4..6].copy_from_slice(&VERSION.to_le_bytes());
    header[6..8].copy_from_slice(&1_u16.to_le_bytes());
    header[8..12].copy_from_slice(&(transfer.length as u32).to_le_bytes());
    header[12..16].copy_from_slice(&u32::from(transfer.eof).to_le_bytes());
    header[16..24].copy_from_slice(&transfer.id.to_le_bytes());
    header[24..32].copy_from_slice(&transfer.epoch.to_le_bytes());
    header[32..40].copy_from_slice(&transfer.offset.to_le_bytes());
    header[40..48].copy_from_slice(&transfer.version.to_le_bytes());
    writer.write_all(&header)?;
    writer.write_all(transfer.bytes())?;
    writer.flush()
}
