//! Warm lane frame encoding and decoding.

use crate::hex;

pub const DEFAULT_MAX_WARM_FRAME_BYTE_LENGTH: usize = 1024 * 1024;

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct WarmFrameCodecOptions {
    pub max_frame_byte_length: usize,
}

impl WarmFrameCodecOptions {
    pub const fn new(max_frame_byte_length: usize) -> Self {
        Self {
            max_frame_byte_length,
        }
    }
}

impl Default for WarmFrameCodecOptions {
    fn default() -> Self {
        Self::new(DEFAULT_MAX_WARM_FRAME_BYTE_LENGTH)
    }
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct WarmLaneFrame {
    pub contract_key: String,
    pub projection_instance_key: String,
    pub semantic_version: u64,
    pub warm_codec_version: u64,
    pub baseline_epoch: u32,
    pub continuity_generation: u32,
    pub publication_sequence: u64,
    pub lane_sequence: Option<u32>,
    pub payload: Vec<u8>,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct DecodedWarmLaneFrame {
    pub frame_byte_length: u32,
    pub frame: WarmLaneFrame,
}

pub fn encode_warm_lane_frame(input: &WarmLaneFrame) -> Result<Vec<u8>, String> {
    encode_warm_lane_frame_with_options(input, WarmFrameCodecOptions::default())
}

pub fn encode_warm_lane_frame_with_options(
    input: &WarmLaneFrame,
    options: WarmFrameCodecOptions,
) -> Result<Vec<u8>, String> {
    let max_frame_byte_length = normalize_max_frame_byte_length(options)?;
    require_non_empty_utf8(&input.contract_key, "contractKey")?;
    require_non_empty_utf8(&input.projection_instance_key, "projectionInstanceKey")?;

    let contract_key_bytes = input.contract_key.as_bytes();
    let projection_instance_key_bytes = input.projection_instance_key.as_bytes();
    let lane_sequence_byte_length = if input.lane_sequence.is_some() { 4 } else { 0 };
    let frame_byte_length = checked_frame_byte_length(
        contract_key_bytes.len(),
        projection_instance_key_bytes.len(),
        lane_sequence_byte_length,
        input.payload.len(),
    )?;
    let total_byte_length = frame_byte_length
        .checked_add(4)
        .ok_or_else(|| "warm frame total byte length overflowed usize".to_string())?;

    if frame_byte_length > u32::MAX as usize {
        return Err("frameByteLength must fit in u32".to_string());
    }
    if total_byte_length > max_frame_byte_length {
        return Err(format!(
            "warm frame byte length {total_byte_length} exceeds maxFrameByteLength {max_frame_byte_length}"
        ));
    }

    let mut writer = ByteWriter::with_capacity(total_byte_length);
    writer.write_u32(frame_byte_length as u32);
    writer.write_length_prefixed_bytes(contract_key_bytes)?;
    writer.write_length_prefixed_bytes(projection_instance_key_bytes)?;
    writer.write_u64(input.semantic_version);
    writer.write_u64(input.warm_codec_version);
    writer.write_u32(input.baseline_epoch);
    writer.write_u32(input.continuity_generation);
    writer.write_u64(input.publication_sequence);

    match input.lane_sequence {
        Some(value) => {
            writer.write_u8(1);
            writer.write_u32(value);
        }
        None => writer.write_u8(0),
    }

    writer.write_length_prefixed_bytes(&input.payload)?;
    Ok(writer.into_bytes())
}

pub fn decode_warm_lane_frame(bytes: &[u8]) -> Result<DecodedWarmLaneFrame, String> {
    decode_warm_lane_frame_with_options(bytes, WarmFrameCodecOptions::default())
}

pub fn decode_warm_lane_frame_with_options(
    bytes: &[u8],
    options: WarmFrameCodecOptions,
) -> Result<DecodedWarmLaneFrame, String> {
    let max_frame_byte_length = normalize_max_frame_byte_length(options)?;
    if bytes.len() > max_frame_byte_length {
        return Err(format!(
            "warm frame byte length {} exceeds maxFrameByteLength {max_frame_byte_length}",
            bytes.len()
        ));
    }
    if bytes.len() < 4 {
        return Err("frame is shorter than frameByteLength prefix".to_string());
    }

    let mut reader = ByteReader::new(bytes);
    let frame_byte_length = reader.read_u32("frameByteLength")?;
    let declared_total_byte_length = u64::from(frame_byte_length) + 4;
    if declared_total_byte_length > max_frame_byte_length as u64 {
        return Err(format!(
            "declared warm frame byte length {declared_total_byte_length} exceeds maxFrameByteLength {max_frame_byte_length}"
        ));
    }
    if frame_byte_length as usize != bytes.len() - 4 {
        return Err(format!(
            "declared frameByteLength {} does not match actual {}",
            frame_byte_length,
            bytes.len() - 4
        ));
    }

    let contract_key = reader.read_length_prefixed_utf8("contractKey")?;
    let projection_instance_key = reader.read_length_prefixed_utf8("projectionInstanceKey")?;
    let semantic_version = reader.read_u64("semanticVersion")?;
    let warm_codec_version = reader.read_u64("warmCodecVersion")?;
    let baseline_epoch = reader.read_u32("baselineEpoch")?;
    let continuity_generation = reader.read_u32("continuityGeneration")?;
    let publication_sequence = reader.read_u64("publicationSequence")?;

    let lane_sequence_present = reader.read_u8("laneSequencePresent")?;
    let lane_sequence = match lane_sequence_present {
        0 => None,
        1 => Some(reader.read_u32("laneSequence")?),
        other => {
            return Err(format!(
                "laneSequencePresent must be 0x00 or 0x01, got 0x{other:02x}"
            ))
        }
    };

    let payload = reader.read_length_prefixed_bytes("payload")?;
    if reader.remaining() != 0 {
        return Err("frame has trailing bytes after payload".to_string());
    }

    Ok(DecodedWarmLaneFrame {
        frame_byte_length,
        frame: WarmLaneFrame {
            contract_key,
            projection_instance_key,
            semantic_version,
            warm_codec_version,
            baseline_epoch,
            continuity_generation,
            publication_sequence,
            lane_sequence,
            payload,
        },
    })
}

pub fn frame_payload_hex(frame: &WarmLaneFrame) -> String {
    hex::encode_lower(&frame.payload)
}

fn normalize_max_frame_byte_length(options: WarmFrameCodecOptions) -> Result<usize, String> {
    let max_frame_byte_length = options.max_frame_byte_length;
    if max_frame_byte_length == 0 || max_frame_byte_length > u32::MAX as usize {
        return Err("maxFrameByteLength must be a positive u32 value".to_string());
    }
    Ok(max_frame_byte_length)
}

fn checked_frame_byte_length(
    contract_key_len: usize,
    projection_instance_key_len: usize,
    lane_sequence_len: usize,
    payload_len: usize,
) -> Result<usize, String> {
    let fixed_without_strings_or_payload: usize = 4 + 4 + 8 + 8 + 4 + 4 + 8 + 1 + 4;
    fixed_without_strings_or_payload
        .checked_add(contract_key_len)
        .and_then(|value| value.checked_add(projection_instance_key_len))
        .and_then(|value| value.checked_add(lane_sequence_len))
        .and_then(|value| value.checked_add(payload_len))
        .ok_or_else(|| "warm frame byte length overflowed usize".to_string())
}

fn require_non_empty_utf8(value: &str, label: &str) -> Result<(), String> {
    if value.is_empty() {
        return Err(format!("{label} must not be empty"));
    }
    Ok(())
}

struct ByteWriter {
    bytes: Vec<u8>,
}

impl ByteWriter {
    fn with_capacity(capacity: usize) -> Self {
        Self {
            bytes: Vec::with_capacity(capacity),
        }
    }

    fn write_u8(&mut self, value: u8) {
        self.bytes.push(value);
    }

    fn write_u32(&mut self, value: u32) {
        self.bytes.extend_from_slice(&value.to_le_bytes());
    }

    fn write_u64(&mut self, value: u64) {
        self.bytes.extend_from_slice(&value.to_le_bytes());
    }

    fn write_length_prefixed_bytes(&mut self, bytes: &[u8]) -> Result<(), String> {
        let byte_length = u32::try_from(bytes.len())
            .map_err(|_| "length-prefixed field must fit in u32".to_string())?;
        self.write_u32(byte_length);
        self.bytes.extend_from_slice(bytes);
        Ok(())
    }

    fn into_bytes(self) -> Vec<u8> {
        self.bytes
    }
}

struct ByteReader<'a> {
    bytes: &'a [u8],
    offset: usize,
}

impl<'a> ByteReader<'a> {
    fn new(bytes: &'a [u8]) -> Self {
        Self { bytes, offset: 0 }
    }

    fn remaining(&self) -> usize {
        self.bytes.len().saturating_sub(self.offset)
    }

    fn read_u8(&mut self, label: &str) -> Result<u8, String> {
        self.require_remaining(1, label)?;
        let value = self.bytes[self.offset];
        self.offset += 1;
        Ok(value)
    }

    fn read_u32(&mut self, label: &str) -> Result<u32, String> {
        let bytes = self.read_fixed::<4>(label)?;
        Ok(u32::from_le_bytes(bytes))
    }

    fn read_u64(&mut self, label: &str) -> Result<u64, String> {
        let bytes = self.read_fixed::<8>(label)?;
        Ok(u64::from_le_bytes(bytes))
    }

    fn read_length_prefixed_bytes(&mut self, label: &str) -> Result<Vec<u8>, String> {
        let byte_length = self.read_u32(&format!("{label}ByteLength"))? as usize;
        self.require_remaining(byte_length, label)?;
        let value = self.bytes[self.offset..self.offset + byte_length].to_vec();
        self.offset += byte_length;
        Ok(value)
    }

    fn read_length_prefixed_utf8(&mut self, label: &str) -> Result<String, String> {
        let bytes = self.read_length_prefixed_bytes(label)?;
        if bytes.is_empty() {
            return Err(format!("{label} must not be empty"));
        }
        String::from_utf8(bytes).map_err(|_| format!("{label} bytes are not valid UTF-8"))
    }

    fn read_fixed<const N: usize>(&mut self, label: &str) -> Result<[u8; N], String> {
        self.require_remaining(N, label)?;
        let mut out = [0_u8; N];
        out.copy_from_slice(&self.bytes[self.offset..self.offset + N]);
        self.offset += N;
        Ok(out)
    }

    fn require_remaining(&self, byte_length: usize, label: &str) -> Result<(), String> {
        if self.offset > self.bytes.len().saturating_sub(byte_length) {
            return Err(format!(
                "frame ended before {byte_length} byte(s) could be read for {label}"
            ));
        }
        Ok(())
    }
}

#[cfg(test)]
mod tests {
    use super::{
        decode_warm_lane_frame, decode_warm_lane_frame_with_options, encode_warm_lane_frame,
        encode_warm_lane_frame_with_options, WarmFrameCodecOptions, WarmLaneFrame,
        DEFAULT_MAX_WARM_FRAME_BYTE_LENGTH,
    };

    fn fixture_frame() -> WarmLaneFrame {
        WarmLaneFrame {
            contract_key: "fixture.warm.v0".to_string(),
            projection_instance_key: "projection-1".to_string(),
            semantic_version: 11,
            warm_codec_version: 3,
            baseline_epoch: 5,
            continuity_generation: 8,
            publication_sequence: 13,
            lane_sequence: Some(21),
            payload: vec![1, 2, 3, 5, 8],
        }
    }

    #[test]
    fn frame_round_trips_without_changing_bytes_or_metadata() {
        let frame = fixture_frame();
        let encoded = encode_warm_lane_frame(&frame).unwrap();
        let decoded = decode_warm_lane_frame(&encoded).unwrap();

        assert_eq!(decoded.frame_byte_length as usize, encoded.len() - 4);
        assert_eq!(decoded.frame, frame);
        assert_eq!(encode_warm_lane_frame(&decoded.frame).unwrap(), encoded);
    }

    #[test]
    fn configurable_max_is_enforced_for_encode_and_decode() {
        let frame = fixture_frame();
        let encoded = encode_warm_lane_frame(&frame).unwrap();
        let exact_limit = WarmFrameCodecOptions::new(encoded.len());
        let too_small_limit = WarmFrameCodecOptions::new(encoded.len() - 1);

        assert_eq!(
            encode_warm_lane_frame_with_options(&frame, exact_limit).unwrap(),
            encoded
        );
        assert_eq!(
            decode_warm_lane_frame_with_options(&encoded, exact_limit)
                .unwrap()
                .frame,
            frame
        );

        let expected = format!(
            "warm frame byte length {} exceeds maxFrameByteLength {}",
            encoded.len(),
            encoded.len() - 1
        );
        assert_eq!(
            encode_warm_lane_frame_with_options(&frame, too_small_limit).unwrap_err(),
            expected
        );
        assert_eq!(
            decode_warm_lane_frame_with_options(&encoded, too_small_limit).unwrap_err(),
            expected
        );
    }

    #[test]
    fn default_max_matches_typescript_and_rejects_oversized_frames() {
        assert_eq!(DEFAULT_MAX_WARM_FRAME_BYTE_LENGTH, 1024 * 1024);

        let mut frame = fixture_frame();
        frame.payload = vec![0; DEFAULT_MAX_WARM_FRAME_BYTE_LENGTH];
        let error = encode_warm_lane_frame(&frame).unwrap_err();

        assert!(error.starts_with("warm frame byte length "));
        assert!(error.ends_with(&format!(
            " exceeds maxFrameByteLength {DEFAULT_MAX_WARM_FRAME_BYTE_LENGTH}"
        )));
    }

    #[test]
    fn declared_oversize_is_rejected_before_length_mismatch_or_body_decode() {
        let max_frame_byte_length = 64;
        let bytes = 64_u32.to_le_bytes();

        assert_eq!(
            decode_warm_lane_frame_with_options(
                &bytes,
                WarmFrameCodecOptions::new(max_frame_byte_length)
            )
            .unwrap_err(),
            "declared warm frame byte length 68 exceeds maxFrameByteLength 64"
        );
    }

    #[test]
    fn malformed_declared_length_is_rejected() {
        let bytes = 1_u32.to_le_bytes();

        assert_eq!(
            decode_warm_lane_frame(&bytes).unwrap_err(),
            "declared frameByteLength 1 does not match actual 0"
        );
    }

    #[test]
    fn invalid_max_is_rejected_before_codec_work() {
        let options = WarmFrameCodecOptions::new(0);

        assert_eq!(
            encode_warm_lane_frame_with_options(&fixture_frame(), options).unwrap_err(),
            "maxFrameByteLength must be a positive u32 value"
        );
        assert_eq!(
            decode_warm_lane_frame_with_options(&[], options).unwrap_err(),
            "maxFrameByteLength must be a positive u32 value"
        );
    }
}
