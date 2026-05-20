// Generated from fixtures/projection-runtime/nested-hot-fields-v0/hot-layout-manifest.json. Do not edit by hand.

#[derive(Clone, Copy, Debug, PartialEq)]
pub struct NestedHotFieldsSnapshot<'a> {
    pub meters_left: f64,
    pub meters_right: f64,
    pub status_active: bool,
    pub status_speed: f32,
}

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub struct NestedHotFieldsPublication {
    pub baseline_epoch: u32,
    pub continuity_generation: u32,
}

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub struct NestedHotFieldsPublishResult {
    pub previous_seqlock_counter: u64,
    pub seqlock_counter: u64,
    pub previous_publication_sequence: u64,
    pub publication_sequence: u64,
}

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub enum NestedHotFieldsWriteError {
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

impl From<hot_publication::HotPublicationError> for NestedHotFieldsWriteError {
    fn from(error: hot_publication::HotPublicationError) -> Self {
        match error {
            hot_publication::HotPublicationError::RegionTooShort { expected_minimum, actual } =>
                NestedHotFieldsWriteError::RegionTooShort { expected_minimum, actual },
            hot_publication::HotPublicationError::BlockALength { expected, actual } =>
                NestedHotFieldsWriteError::BlockALength { expected, actual },
            hot_publication::HotPublicationError::WriterActiveSeqlock { counter } =>
                NestedHotFieldsWriteError::WriterActiveSeqlock { counter },
            hot_publication::HotPublicationError::SeqlockOverflow { counter } =>
                NestedHotFieldsWriteError::SeqlockOverflow { counter },
            hot_publication::HotPublicationError::PublicationSequenceOverflow { sequence } =>
                NestedHotFieldsWriteError::PublicationSequenceOverflow { sequence },
            hot_publication::HotPublicationError::LayoutRangeOutOfBounds { field, offset, byte_length, total_region_byte_length } =>
                NestedHotFieldsWriteError::LayoutRangeOutOfBounds { field, offset, byte_length, total_region_byte_length },
            hot_publication::HotPublicationError::LayoutOverlapsBlockA { field, offset, byte_length, block_a_size } =>
                NestedHotFieldsWriteError::LayoutOverlapsBlockA { field, offset, byte_length, block_a_size },
            hot_publication::HotPublicationError::LayoutRangesOverlap { first_field, first_offset, first_byte_length, second_field, second_offset, second_byte_length } =>
                NestedHotFieldsWriteError::LayoutRangesOverlap { first_field, first_offset, first_byte_length, second_field, second_offset, second_byte_length },
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
pub const TOTAL_REGION_BYTE_LENGTH: usize = 120;
pub const METERS_LEFT_OFFSET: usize = 96;
pub const METERS_RIGHT_OFFSET: usize = 104;
pub const STATUS_ACTIVE_OFFSET: usize = 112;
pub const STATUS_SPEED_OFFSET: usize = 116;

pub fn publish_nested_hot_fields_snapshot(
    region: &mut [u8],
    block_a: &[u8],
    publication: NestedHotFieldsPublication,
    snapshot: &NestedHotFieldsSnapshot<'_>,
) -> Result<NestedHotFieldsPublishResult, NestedHotFieldsWriteError> {
    validate_nested_hot_fields_snapshot(snapshot)?;

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
        |region| write_nested_hot_fields_snapshot_fields(region, snapshot),
    )?;

    Ok(NestedHotFieldsPublishResult {
        previous_seqlock_counter: result.previous_seqlock_counter,
        seqlock_counter: result.seqlock_counter,
        previous_publication_sequence: result.previous_publication_sequence,
        publication_sequence: result.publication_sequence,
    })
}

pub fn write_nested_hot_fields_snapshot(
    region: &mut [u8],
    snapshot: &NestedHotFieldsSnapshot<'_>,
) -> Result<(), NestedHotFieldsWriteError> {
    require_region_length(region)?;
    validate_nested_hot_fields_snapshot(snapshot)?;
    write_nested_hot_fields_snapshot_fields(region, snapshot);
    Ok(())
}

pub fn validate_nested_hot_fields_snapshot(snapshot: &NestedHotFieldsSnapshot<'_>) -> Result<(), NestedHotFieldsWriteError> {
    Ok(())
}

fn write_nested_hot_fields_snapshot_fields(region: &mut [u8], snapshot: &NestedHotFieldsSnapshot<'_>) {
    write_f64_le(region, METERS_LEFT_OFFSET, snapshot.meters_left);
    write_f64_le(region, METERS_RIGHT_OFFSET, snapshot.meters_right);
    region[STATUS_ACTIVE_OFFSET] = u8::from(snapshot.status_active);
    write_f32_le(region, STATUS_SPEED_OFFSET, snapshot.status_speed);
}

fn require_region_length(region: &[u8]) -> Result<(), NestedHotFieldsWriteError> {
    if region.len() < TOTAL_REGION_BYTE_LENGTH {
        return Err(NestedHotFieldsWriteError::RegionTooShort {
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
