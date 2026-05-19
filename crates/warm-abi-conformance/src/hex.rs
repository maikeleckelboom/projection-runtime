pub fn encode_lower(bytes: &[u8]) -> String {
    let mut out = String::with_capacity(bytes.len() * 2);
    for byte in bytes {
        out.push(hex_digit(byte >> 4));
        out.push(hex_digit(byte & 0x0f));
    }
    out
}

pub fn decode_lower(value: &str, label: &str) -> Result<Vec<u8>, String> {
    if value.len() % 2 != 0 {
        return Err(format!(
            "{label} must contain an even number of hex characters"
        ));
    }

    let mut out = Vec::with_capacity(value.len() / 2);
    let bytes = value.as_bytes();
    for index in (0..bytes.len()).step_by(2) {
        let high = decode_nibble(bytes[index])
            .ok_or_else(|| format!("{label} contains non-lowercase-hex at byte {index}"))?;
        let low = decode_nibble(bytes[index + 1])
            .ok_or_else(|| format!("{label} contains non-lowercase-hex at byte {}", index + 1))?;
        out.push((high << 4) | low);
    }
    Ok(out)
}

pub fn parse_u64_hex(value: &str, label: &str) -> Result<u64, String> {
    if value.len() != 16 {
        return Err(format!(
            "{label} must be exactly 16 lowercase hex characters"
        ));
    }

    let bytes = decode_lower(value, label)?;
    let mut fixed = [0_u8; 8];
    fixed.copy_from_slice(&bytes);
    Ok(u64::from_be_bytes(fixed))
}

pub fn format_u64_hex(value: u64) -> String {
    format!("{value:016x}")
}

fn hex_digit(value: u8) -> char {
    match value {
        0..=9 => (b'0' + value) as char,
        10..=15 => (b'a' + value - 10) as char,
        _ => unreachable!("nibble is always <= 15"),
    }
}

fn decode_nibble(value: u8) -> Option<u8> {
    match value {
        b'0'..=b'9' => Some(value - b'0'),
        b'a'..=b'f' => Some(value - b'a' + 10),
        _ => None,
    }
}
