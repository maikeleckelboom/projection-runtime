use crate::hex;

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
    if bytes.len() < 4 {
        return Err("frame is shorter than frameByteLength prefix".to_string());
    }

    let mut reader = ByteReader::new(bytes);
    let frame_byte_length = reader.read_u32("frameByteLength")?;
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
