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
    LayoutRangeOutOfBounds {
        field: &'static str,
        offset: usize,
        byte_length: usize,
        total_region_byte_length: usize,
    },
    LayoutOverlapsBlockA {
        field: &'static str,
        offset: usize,
        byte_length: usize,
        block_a_size: usize,
    },
    LayoutRangesOverlap {
        first_field: &'static str,
        first_offset: usize,
        first_byte_length: usize,
        second_field: &'static str,
        second_offset: usize,
        second_byte_length: usize,
    },
    BoundedArrayOverflow { field: &'static str, max_count: usize, actual: usize },
    FixedStringTooLong { field: &'static str, max_bytes: usize, actual_bytes: usize },
    FixedStringNonAscii { field: &'static str },
}

impl From<hot_publication::HotPublicationError> for HotExchangeWriteError {
    fn from(error: hot_publication::HotPublicationError) -> Self {
        match error {
            hot_publication::HotPublicationError::RegionTooShort { expected_minimum, actual } =>
                HotExchangeWriteError::RegionTooShort { expected_minimum, actual },
            hot_publication::HotPublicationError::BlockALength { expected, actual } =>
                HotExchangeWriteError::BlockALength { expected, actual },
            hot_publication::HotPublicationError::WriterActiveSeqlock { counter } =>
                HotExchangeWriteError::WriterActiveSeqlock { counter },
            hot_publication::HotPublicationError::SeqlockOverflow { counter } =>
                HotExchangeWriteError::SeqlockOverflow { counter },
            hot_publication::HotPublicationError::PublicationSequenceOverflow { sequence } =>
                HotExchangeWriteError::PublicationSequenceOverflow { sequence },
            hot_publication::HotPublicationError::LayoutRangeOutOfBounds { field, offset, byte_length, total_region_byte_length } =>
                HotExchangeWriteError::LayoutRangeOutOfBounds { field, offset, byte_length, total_region_byte_length },
            hot_publication::HotPublicationError::LayoutOverlapsBlockA { field, offset, byte_length, block_a_size } =>
                HotExchangeWriteError::LayoutOverlapsBlockA { field, offset, byte_length, block_a_size },
            hot_publication::HotPublicationError::LayoutRangesOverlap { first_field, first_offset, first_byte_length, second_field, second_offset, second_byte_length } =>
                HotExchangeWriteError::LayoutRangesOverlap { first_field, first_offset, first_byte_length, second_field, second_offset, second_byte_length },
        }
    }
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
    validate_hot_exchange_snapshot(snapshot)?;

    let mut region_handle = hot_publication::HotPublicationRegion::bind(
        hot_publication::HotPublicationLayout {
            total_region_byte_length: TOTAL_REGION_BYTE_LENGTH,
            block_a_size: BLOCK_A_SIZE,
            seqlock_offset: SEQLOCK_OFFSET,
            baseline_epoch_offset: BASELINE_EPOCH_OFFSET,
            continuity_generation_offset: CONTINUITY_GENERATION_OFFSET,
            publication_sequence_offset: PUBLICATION_SEQUENCE_OFFSET,
        },
        region,
    )?;
    let result = region_handle.publish(
        block_a,
        hot_publication::HotPublication {
            baseline_epoch: publication.baseline_epoch,
            continuity_generation: publication.continuity_generation,
        },
        |region| write_hot_exchange_snapshot_fields(region, snapshot),
    )?;

    Ok(HotExchangePublishResult {
        previous_seqlock_counter: result.previous_seqlock_counter,
        seqlock_counter: result.seqlock_counter,
        previous_publication_sequence: result.previous_publication_sequence,
        publication_sequence: result.publication_sequence,
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
