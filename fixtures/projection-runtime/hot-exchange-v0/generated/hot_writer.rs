// Generated from fixtures/projection-runtime/hot-exchange-v0/hot-layout-manifest.json. Do not edit by hand.

#[derive(Clone, Copy, Debug, PartialEq)]
pub struct HotExchangeSnapshot<'a> {
    pub display_name: &'a str,
    pub gain: f32,
    pub level_vector: [f32; 4],
    pub phase: f64,
    pub revision: u32,
}

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub struct HotExchangePublication {
    pub baseline_epoch: u32,
    pub continuity_generation: u32,
}

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub struct HotExchangePublishResult {
    pub previous_seqlock_counter: u64,
    pub seqlock_counter: u64,
    pub previous_publication_sequence: u64,
    pub publication_sequence: u64,
}

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub enum HotExchangeWriteError {
    RegionTooShort { expected_minimum: usize, actual: usize },
    BlockALength { expected: usize, actual: usize },
    WriterActiveSeqlock { counter: u64 },
    SeqlockOverflow { counter: u64 },
    PublicationSequenceOverflow { sequence: u64 },
    BoundedArrayOverflow { field: &'static str, max_count: usize, actual: usize },
    FixedStringTooLong { field: &'static str, max_bytes: usize, actual_bytes: usize },
    FixedStringNonAscii { field: &'static str },
}

pub const BLOCK_A_SIZE: usize = 72;
pub const BLOCK_B_START_OFFSET: usize = 72;
pub const BASELINE_EPOCH_OFFSET: usize = 80;
pub const CONTINUITY_GENERATION_OFFSET: usize = 84;
pub const FIELD_DATA_ORIGIN: usize = 96;
pub const SEQLOCK_OFFSET: usize = 72;
pub const PUBLICATION_SEQUENCE_OFFSET: usize = 88;
pub const TOTAL_REGION_BYTE_LENGTH: usize = 152;
pub const DISPLAY_NAME_OFFSET: usize = 96;
pub const DISPLAY_NAME_BYTE_LENGTH: usize = 16;
pub const GAIN_OFFSET: usize = 112;
pub const LEVEL_VECTOR_OFFSET: usize = 116;
pub const LEVEL_VECTOR_LENGTH: usize = 4;
pub const LEVEL_VECTOR_0_OFFSET: usize = LEVEL_VECTOR_OFFSET;
pub const LEVEL_VECTOR_1_OFFSET: usize = 120;
pub const LEVEL_VECTOR_2_OFFSET: usize = 124;
pub const LEVEL_VECTOR_3_OFFSET: usize = 128;
pub const PHASE_OFFSET: usize = 136;
pub const REVISION_OFFSET: usize = 144;

pub fn publish_hot_exchange_snapshot(
    region: &mut [u8],
    block_a: &[u8],
    publication: HotExchangePublication,
    snapshot: &HotExchangeSnapshot<'_>,
) -> Result<HotExchangePublishResult, HotExchangeWriteError> {
    require_region_length(region)?;
    require_block_a_length(block_a)?;
    validate_hot_exchange_snapshot(snapshot)?;

    let previous_seqlock_counter = read_u64_le(region, SEQLOCK_OFFSET);
    if previous_seqlock_counter & 1 == 1 {
        return Err(HotExchangeWriteError::WriterActiveSeqlock {
            counter: previous_seqlock_counter,
        });
    }
    let seqlock_counter = previous_seqlock_counter
        .checked_add(2)
        .ok_or(HotExchangeWriteError::SeqlockOverflow {
            counter: previous_seqlock_counter,
        })?;
    let active_seqlock_counter = previous_seqlock_counter + 1;
    let previous_publication_sequence = read_u64_le(region, PUBLICATION_SEQUENCE_OFFSET);
    let publication_sequence = previous_publication_sequence
        .checked_add(1)
        .ok_or(HotExchangeWriteError::PublicationSequenceOverflow {
            sequence: previous_publication_sequence,
        })?;

    write_u64_le(region, SEQLOCK_OFFSET, active_seqlock_counter);
    region[0..BLOCK_A_SIZE].copy_from_slice(block_a);
    write_u32_le(region, BASELINE_EPOCH_OFFSET, publication.baseline_epoch);
    write_u32_le(
        region,
        CONTINUITY_GENERATION_OFFSET,
        publication.continuity_generation,
    );
    write_hot_exchange_snapshot_fields(region, snapshot);
    write_u64_le(region, PUBLICATION_SEQUENCE_OFFSET, publication_sequence);
    write_u64_le(region, SEQLOCK_OFFSET, seqlock_counter);

    Ok(HotExchangePublishResult {
        previous_seqlock_counter,
        seqlock_counter,
        previous_publication_sequence,
        publication_sequence,
    })
}

pub fn write_hot_exchange_snapshot(
    region: &mut [u8],
    snapshot: &HotExchangeSnapshot<'_>,
) -> Result<(), HotExchangeWriteError> {
    require_region_length(region)?;
    validate_hot_exchange_snapshot(snapshot)?;
    write_hot_exchange_snapshot_fields(region, snapshot);
    Ok(())
}

pub fn validate_hot_exchange_snapshot(snapshot: &HotExchangeSnapshot<'_>) -> Result<(), HotExchangeWriteError> {
    validate_display_name(snapshot.display_name)?;
    Ok(())
}

fn write_hot_exchange_snapshot_fields(region: &mut [u8], snapshot: &HotExchangeSnapshot<'_>) {
    write_display_name(region, snapshot.display_name);
    write_f32_le(region, GAIN_OFFSET, snapshot.gain);
    write_level_vector(region, &snapshot.level_vector);
    write_f64_le(region, PHASE_OFFSET, snapshot.phase);
    write_u32_le(region, REVISION_OFFSET, snapshot.revision);
}

fn validate_display_name(value: &str) -> Result<(), HotExchangeWriteError> {
    let bytes = value.as_bytes();
    if bytes.len() > DISPLAY_NAME_BYTE_LENGTH {
        return Err(HotExchangeWriteError::FixedStringTooLong {
            field: "displayName",
            max_bytes: DISPLAY_NAME_BYTE_LENGTH,
            actual_bytes: bytes.len(),
        });
    }
    if !bytes.is_ascii() {
        return Err(HotExchangeWriteError::FixedStringNonAscii {
            field: "displayName",
        });
    }
    Ok(())
}

fn write_display_name(region: &mut [u8], value: &str) {
    let bytes = value.as_bytes();
    for index in 0..DISPLAY_NAME_BYTE_LENGTH {
        let byte = if index < bytes.len() { bytes[index] } else { 0 };
        region[DISPLAY_NAME_OFFSET + index] = byte;
    }
}

fn write_level_vector(
    region: &mut [u8],
    value: &[f32; 4],
) {
    write_f32_le(region, LEVEL_VECTOR_0_OFFSET, value[0]);
    write_f32_le(region, LEVEL_VECTOR_1_OFFSET, value[1]);
    write_f32_le(region, LEVEL_VECTOR_2_OFFSET, value[2]);
    write_f32_le(region, LEVEL_VECTOR_3_OFFSET, value[3]);
}

fn require_region_length(region: &[u8]) -> Result<(), HotExchangeWriteError> {
    if region.len() < TOTAL_REGION_BYTE_LENGTH {
        return Err(HotExchangeWriteError::RegionTooShort {
            expected_minimum: TOTAL_REGION_BYTE_LENGTH,
            actual: region.len(),
        });
    }
    Ok(())
}

fn require_block_a_length(block_a: &[u8]) -> Result<(), HotExchangeWriteError> {
    if block_a.len() != BLOCK_A_SIZE {
        return Err(HotExchangeWriteError::BlockALength {
            expected: BLOCK_A_SIZE,
            actual: block_a.len(),
        });
    }
    Ok(())
}

fn read_u64_le(region: &[u8], offset: usize) -> u64 {
    let mut bytes = [0_u8; 8];
    bytes.copy_from_slice(&region[offset..offset + 8]);
    u64::from_le_bytes(bytes)
}

fn write_u32_le(region: &mut [u8], offset: usize, value: u32) {
    region[offset..offset + 4].copy_from_slice(&value.to_le_bytes());
}

fn write_u64_le(region: &mut [u8], offset: usize, value: u64) {
    region[offset..offset + 8].copy_from_slice(&value.to_le_bytes());
}

fn write_f32_le(region: &mut [u8], offset: usize, value: f32) {
    region[offset..offset + 4].copy_from_slice(&value.to_le_bytes());
}

fn write_f64_le(region: &mut [u8], offset: usize, value: f64) {
    region[offset..offset + 8].copy_from_slice(&value.to_le_bytes());
}
