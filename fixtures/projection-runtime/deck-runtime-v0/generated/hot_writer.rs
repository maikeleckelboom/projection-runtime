// Generated from fixtures/projection-runtime/deck-runtime-v0/hot-layout-manifest.json. Do not edit by hand.

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub enum DeckRuntimeTransportState {
    Stopped,
    Cueing,
    Playing,
    Paused,
}

impl DeckRuntimeTransportState {
    fn to_u8(self) -> u8 {
        match self {
            Self::Stopped => 0,
            Self::Cueing => 1,
            Self::Playing => 2,
            Self::Paused => 3,
        }
    }
}

#[derive(Clone, Copy, Debug, PartialEq)]
pub struct DeckRuntimeSnapshot<'a> {
    pub beat_phase01: f32,
    pub level: f32,
    pub loop_active: bool,
    pub media_time_seconds: f64,
    pub sample_position: u64,
    pub stem_gains: &'a [f32],
    pub tempo_ratio: f32,
    pub transport_state: DeckRuntimeTransportState,
}

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub struct DeckRuntimePublication {
    pub baseline_epoch: u32,
    pub continuity_generation: u32,
}

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub struct DeckRuntimePublishResult {
    pub previous_seqlock_counter: u64,
    pub seqlock_counter: u64,
    pub previous_publication_sequence: u64,
    pub publication_sequence: u64,
}

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub enum DeckRuntimeWriteError {
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
pub const TOTAL_REGION_BYTE_LENGTH: usize = 160;
pub const BEAT_PHASE01_OFFSET: usize = 96;
pub const LEVEL_OFFSET: usize = 100;
pub const LOOP_ACTIVE_OFFSET: usize = 104;
pub const MEDIA_TIME_SECONDS_OFFSET: usize = 112;
pub const SAMPLE_POSITION_OFFSET: usize = 120;
pub const STEM_GAINS_COUNT_OFFSET: usize = 128;
pub const STEM_GAINS_ELEMENTS_OFFSET: usize = 132;
pub const STEM_GAINS_MAX_COUNT: usize = 4;
pub const STEM_GAINS_UNIT_BYTE_LENGTH: usize = 4;
pub const TEMPO_RATIO_OFFSET: usize = 148;
pub const TRANSPORT_STATE_OFFSET: usize = 152;

pub fn publish_deck_runtime_snapshot(
    region: &mut [u8],
    block_a: &[u8],
    publication: DeckRuntimePublication,
    snapshot: &DeckRuntimeSnapshot<'_>,
) -> Result<DeckRuntimePublishResult, DeckRuntimeWriteError> {
    require_region_length(region)?;
    require_block_a_length(block_a)?;
    validate_deck_runtime_snapshot(snapshot)?;

    let previous_seqlock_counter = read_u64_le(region, SEQLOCK_OFFSET);
    if previous_seqlock_counter & 1 == 1 {
        return Err(DeckRuntimeWriteError::WriterActiveSeqlock {
            counter: previous_seqlock_counter,
        });
    }
    let seqlock_counter = previous_seqlock_counter
        .checked_add(2)
        .ok_or(DeckRuntimeWriteError::SeqlockOverflow {
            counter: previous_seqlock_counter,
        })?;
    let active_seqlock_counter = previous_seqlock_counter + 1;
    let previous_publication_sequence = read_u64_le(region, PUBLICATION_SEQUENCE_OFFSET);
    let publication_sequence = previous_publication_sequence
        .checked_add(1)
        .ok_or(DeckRuntimeWriteError::PublicationSequenceOverflow {
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
    write_deck_runtime_snapshot_fields(region, snapshot);
    write_u64_le(region, PUBLICATION_SEQUENCE_OFFSET, publication_sequence);
    write_u64_le(region, SEQLOCK_OFFSET, seqlock_counter);

    Ok(DeckRuntimePublishResult {
        previous_seqlock_counter,
        seqlock_counter,
        previous_publication_sequence,
        publication_sequence,
    })
}

pub fn write_deck_runtime_snapshot(
    region: &mut [u8],
    snapshot: &DeckRuntimeSnapshot<'_>,
) -> Result<(), DeckRuntimeWriteError> {
    require_region_length(region)?;
    validate_deck_runtime_snapshot(snapshot)?;
    write_deck_runtime_snapshot_fields(region, snapshot);
    Ok(())
}

pub fn validate_deck_runtime_snapshot(snapshot: &DeckRuntimeSnapshot<'_>) -> Result<(), DeckRuntimeWriteError> {
    validate_stem_gains(snapshot.stem_gains)?;
    Ok(())
}

fn write_deck_runtime_snapshot_fields(region: &mut [u8], snapshot: &DeckRuntimeSnapshot<'_>) {
    write_f32_le(region, BEAT_PHASE01_OFFSET, snapshot.beat_phase01);
    write_f32_le(region, LEVEL_OFFSET, snapshot.level);
    region[LOOP_ACTIVE_OFFSET] = u8::from(snapshot.loop_active);
    write_f64_le(region, MEDIA_TIME_SECONDS_OFFSET, snapshot.media_time_seconds);
    write_u64_le(region, SAMPLE_POSITION_OFFSET, snapshot.sample_position);
    write_stem_gains(region, snapshot.stem_gains);
    write_f32_le(region, TEMPO_RATIO_OFFSET, snapshot.tempo_ratio);
    region[TRANSPORT_STATE_OFFSET] = snapshot.transport_state.to_u8();
}

fn validate_stem_gains<T>(value: &[T]) -> Result<(), DeckRuntimeWriteError> {
    if value.len() > STEM_GAINS_MAX_COUNT {
        return Err(DeckRuntimeWriteError::BoundedArrayOverflow {
            field: "stemGains",
            max_count: STEM_GAINS_MAX_COUNT,
            actual: value.len(),
        });
    }
    Ok(())
}

fn write_stem_gains(region: &mut [u8], value: &[f32]) {
    write_u32_le(region, STEM_GAINS_COUNT_OFFSET, value.len() as u32);
    for index in 0..STEM_GAINS_MAX_COUNT {
        if index < value.len() {
            write_f32_le(region, STEM_GAINS_ELEMENTS_OFFSET + index * STEM_GAINS_UNIT_BYTE_LENGTH, value[index]);
        } else {
            write_f32_le(region, STEM_GAINS_ELEMENTS_OFFSET + index * STEM_GAINS_UNIT_BYTE_LENGTH, 0.0);
        }
    }
}

fn require_region_length(region: &[u8]) -> Result<(), DeckRuntimeWriteError> {
    if region.len() < TOTAL_REGION_BYTE_LENGTH {
        return Err(DeckRuntimeWriteError::RegionTooShort {
            expected_minimum: TOTAL_REGION_BYTE_LENGTH,
            actual: region.len(),
        });
    }
    Ok(())
}

fn require_block_a_length(block_a: &[u8]) -> Result<(), DeckRuntimeWriteError> {
    if block_a.len() != BLOCK_A_SIZE {
        return Err(DeckRuntimeWriteError::BlockALength {
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
