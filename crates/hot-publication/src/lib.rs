//! Hot publication substrate.
//!
//! Owns generic hot publication mechanics over caller-provided mutable bytes.
//! This crate does not allocate shared memory, open files, spawn threads,
//! use async, or know about any generated fixture names.

/// Layout constants for a hot publication region.
#[derive(Clone, Copy, Debug)]
pub struct HotPublicationLayout {
    pub total_region_byte_length: usize,
    pub block_a_size: usize,
    pub seqlock_offset: usize,
    pub baseline_epoch_offset: usize,
    pub continuity_generation_offset: usize,
    pub publication_sequence_offset: usize,
}

/// Publication parameters.
#[derive(Clone, Copy, Debug)]
pub struct HotPublication {
    pub baseline_epoch: u32,
    pub continuity_generation: u32,
}

/// Result of a successful publication.
#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub struct HotPublishResult {
    pub previous_seqlock_counter: u64,
    pub seqlock_counter: u64,
    pub previous_publication_sequence: u64,
    pub publication_sequence: u64,
}

/// Errors that can occur during publication.
#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub enum HotPublicationError {
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
}

/// A bound publication-region handle.
///
/// Created via [`HotPublicationRegion::bind`] which validates the layout
/// before any offset-based read or write.  Every [`publish`] call
/// performs the full seqlock-guarded publication transition.
#[derive(Debug)]
pub struct HotPublicationRegion<'a> {
    layout: HotPublicationLayout,
    region: &'a mut [u8],
}

impl<'a> HotPublicationRegion<'a> {
    /// Bind a layout to a mutable byte region.
    ///
    /// Validates region length and every layout offset before returning;
    /// no mutation of `region` occurs during validation.
    pub fn bind(
        layout: HotPublicationLayout,
        region: &'a mut [u8],
    ) -> Result<Self, HotPublicationError> {
        if region.len() < layout.total_region_byte_length {
            return Err(HotPublicationError::RegionTooShort {
                expected_minimum: layout.total_region_byte_length,
                actual: region.len(),
            });
        }
        validate_layout(&layout)?;
        Ok(Self { layout, region })
    }

    /// Execute a hot publication through this bound region.
    ///
    /// Validates Block A byte length and seqlock state, then performs
    /// the seqlock-guarded publication transition.  The `write_fields`
    /// closure is called after the active (odd) seqlock is written and
    /// before the final even seqlock is written.
    pub fn publish(
        &mut self,
        block_a: &[u8],
        publication: HotPublication,
        write_fields: impl FnOnce(&mut [u8]),
    ) -> Result<HotPublishResult, HotPublicationError> {
        if block_a.len() != self.layout.block_a_size {
            return Err(HotPublicationError::BlockALength {
                expected: self.layout.block_a_size,
                actual: block_a.len(),
            });
        }

        let previous_seqlock_counter =
            read_u64_le(self.region, self.layout.seqlock_offset);
        if previous_seqlock_counter & 1 == 1 {
            return Err(HotPublicationError::WriterActiveSeqlock {
                counter: previous_seqlock_counter,
            });
        }

        let seqlock_counter = previous_seqlock_counter
            .checked_add(2)
            .ok_or(HotPublicationError::SeqlockOverflow {
                counter: previous_seqlock_counter,
            })?;

        let active_seqlock_counter = previous_seqlock_counter + 1;

        let previous_publication_sequence =
            read_u64_le(self.region, self.layout.publication_sequence_offset);

        let publication_sequence = previous_publication_sequence
            .checked_add(1)
            .ok_or(HotPublicationError::PublicationSequenceOverflow {
                sequence: previous_publication_sequence,
            })?;

        // Signal writer active (odd seqlock)
        write_u64_le(self.region, self.layout.seqlock_offset, active_seqlock_counter);

        // Write snapshot fields (only the logical region slice).
        // Substrate-owned bytes (Block A and Block B metadata) are written
        // AFTER the closure so the substrate retains ownership.
        write_fields(&mut self.region[..self.layout.total_region_byte_length]);

        // Copy Block A bytes (substrate-owned)
        self.region[..self.layout.block_a_size].copy_from_slice(block_a);

        // Write Block B metadata (substrate-owned)
        write_u32_le(
            self.region,
            self.layout.baseline_epoch_offset,
            publication.baseline_epoch,
        );
        write_u32_le(
            self.region,
            self.layout.continuity_generation_offset,
            publication.continuity_generation,
        );

        // Write publication sequence
        write_u64_le(
            self.region,
            self.layout.publication_sequence_offset,
            publication_sequence,
        );

        // Release (even seqlock)
        write_u64_le(self.region, self.layout.seqlock_offset, seqlock_counter);

        Ok(HotPublishResult {
            previous_seqlock_counter,
            seqlock_counter,
            previous_publication_sequence,
            publication_sequence,
        })
    }
}

/// Execute a hot publication.
///
/// Convenience wrapper around [`HotPublicationRegion::bind`] followed by
/// [`HotPublicationRegion::publish`].
pub fn hot_publish(
    layout: &HotPublicationLayout,
    region: &mut [u8],
    block_a: &[u8],
    publication: HotPublication,
    write_fields: impl FnOnce(&mut [u8]),
) -> Result<HotPublishResult, HotPublicationError> {
    let mut handle = HotPublicationRegion::bind(*layout, region)?;
    handle.publish(block_a, publication, write_fields)
}


fn validate_layout(layout: &HotPublicationLayout) -> Result<(), HotPublicationError> {
    let total = layout.total_region_byte_length;

    if layout.block_a_size > total {
        return Err(HotPublicationError::LayoutRangeOutOfBounds {
            field: "block_a_size",
            offset: 0,
            byte_length: layout.block_a_size,
            total_region_byte_length: total,
        });
    }
    check_offset_range(layout.seqlock_offset, 8, total, "seqlock_offset")?;
    check_offset_range(layout.baseline_epoch_offset, 4, total, "baseline_epoch_offset")?;
    check_offset_range(
        layout.continuity_generation_offset,
        4,
        total,
        "continuity_generation_offset",
    )?;
    check_offset_range(
        layout.publication_sequence_offset,
        8,
        total,
        "publication_sequence_offset",
    )?;

    check_metadata_not_overlapping_block_a(
        layout.seqlock_offset,
        8,
        layout.block_a_size,
        "seqlock_offset",
    )?;
    check_metadata_not_overlapping_block_a(
        layout.baseline_epoch_offset,
        4,
        layout.block_a_size,
        "baseline_epoch_offset",
    )?;
    check_metadata_not_overlapping_block_a(
        layout.continuity_generation_offset,
        4,
        layout.block_a_size,
        "continuity_generation_offset",
    )?;
    check_metadata_not_overlapping_block_a(
        layout.publication_sequence_offset,
        8,
        layout.block_a_size,
        "publication_sequence_offset",
    )?;

    check_ranges_dont_overlap(
        layout.seqlock_offset, 8, "seqlock_offset",
        layout.baseline_epoch_offset, 4, "baseline_epoch_offset",
    )?;
    check_ranges_dont_overlap(
        layout.seqlock_offset, 8, "seqlock_offset",
        layout.continuity_generation_offset, 4, "continuity_generation_offset",
    )?;
    check_ranges_dont_overlap(
        layout.seqlock_offset, 8, "seqlock_offset",
        layout.publication_sequence_offset, 8, "publication_sequence_offset",
    )?;
    check_ranges_dont_overlap(
        layout.baseline_epoch_offset, 4, "baseline_epoch_offset",
        layout.continuity_generation_offset, 4, "continuity_generation_offset",
    )?;
    check_ranges_dont_overlap(
        layout.baseline_epoch_offset, 4, "baseline_epoch_offset",
        layout.publication_sequence_offset, 8, "publication_sequence_offset",
    )?;
    check_ranges_dont_overlap(
        layout.continuity_generation_offset, 4, "continuity_generation_offset",
        layout.publication_sequence_offset, 8, "publication_sequence_offset",
    )?;

    Ok(())
}

fn check_ranges_dont_overlap(
    offset_a: usize,
    width_a: usize,
    field_a: &'static str,
    offset_b: usize,
    width_b: usize,
    field_b: &'static str,
) -> Result<(), HotPublicationError> {
    let end_a = offset_a.checked_add(width_a);
    let end_b = offset_b.checked_add(width_b);
    if let (Some(end_a), Some(end_b)) = (end_a, end_b) {
        if offset_a < end_b && offset_b < end_a {
            return Err(HotPublicationError::LayoutRangesOverlap {
                first_field: field_a,
                first_offset: offset_a,
                first_byte_length: width_a,
                second_field: field_b,
                second_offset: offset_b,
                second_byte_length: width_b,
            });
        }
    }
    Ok(())
}

fn check_metadata_not_overlapping_block_a(
    offset: usize,
    byte_length: usize,
    block_a_size: usize,
    field: &'static str,
) -> Result<(), HotPublicationError> {
    if offset < block_a_size {
        return Err(HotPublicationError::LayoutOverlapsBlockA {
            field,
            offset,
            byte_length,
            block_a_size,
        });
    }
    Ok(())
}

fn check_offset_range(
    offset: usize,
    width: usize,
    total_region_byte_length: usize,
    field: &'static str,
) -> Result<(), HotPublicationError> {
    let end = offset.checked_add(width).ok_or(
        HotPublicationError::LayoutRangeOutOfBounds {
            field,
            offset,
            byte_length: width,
            total_region_byte_length,
        },
    )?;
    if end > total_region_byte_length {
        return Err(HotPublicationError::LayoutRangeOutOfBounds {
            field,
            offset,
            byte_length: width,
            total_region_byte_length,
        });
    }
    Ok(())
}

fn read_u64_le(region: &[u8], offset: usize) -> u64 {
    let mut bytes = [0_u8; 8];
    bytes.copy_from_slice(&region[offset..offset + 8]);
    u64::from_le_bytes(bytes)
}

fn write_u64_le(region: &mut [u8], offset: usize, value: u64) {
    region[offset..offset + 8].copy_from_slice(&value.to_le_bytes());
}

fn write_u32_le(region: &mut [u8], offset: usize, value: u32) {
    region[offset..offset + 4].copy_from_slice(&value.to_le_bytes());
}


#[cfg(test)]
mod tests {
    use super::*;

    const TEST_TOTAL_REGION: usize = 160;
    const TEST_BLOCK_A_SIZE: usize = 72;
    const TEST_SEQLOCK_OFFSET: usize = 72;
    const TEST_BASELINE_EPOCH_OFFSET: usize = 80;
    const TEST_CONTINUITY_GEN_OFFSET: usize = 84;
    const TEST_PUBLICATION_SEQ_OFFSET: usize = 88;
    const TEST_FIELD_WRITE_OFFSET: usize = 96;

    fn test_layout() -> HotPublicationLayout {
        HotPublicationLayout {
            total_region_byte_length: TEST_TOTAL_REGION,
            block_a_size: TEST_BLOCK_A_SIZE,
            seqlock_offset: TEST_SEQLOCK_OFFSET,
            baseline_epoch_offset: TEST_BASELINE_EPOCH_OFFSET,
            continuity_generation_offset: TEST_CONTINUITY_GEN_OFFSET,
            publication_sequence_offset: TEST_PUBLICATION_SEQ_OFFSET,
        }
    }

    fn test_publication() -> HotPublication {
        HotPublication {
            baseline_epoch: 7,
            continuity_generation: 3,
        }
    }

    #[test]
    fn bind_returns_region_handle_for_valid_layout() {
        let layout = test_layout();
        let mut region = vec![0_u8; layout.total_region_byte_length];
        let handle = HotPublicationRegion::bind(layout, &mut region).unwrap();
        // Confirm the handle is alive and can publish
        let block_a = vec![0_u8; layout.block_a_size];
        let mut handle = handle; // ownership transfer
        let result = handle
            .publish(&block_a, test_publication(), |_| {})
            .unwrap();
        assert_eq!(result.seqlock_counter, 2);
        assert_eq!(result.publication_sequence, 1);
    }

    #[test]
    fn repeated_publish_through_region_increments_seqlock_by_two() {
        let layout = test_layout();
        let mut region = vec![0_u8; layout.total_region_byte_length];
        let block_a = vec![0_u8; layout.block_a_size];
        let mut handle = HotPublicationRegion::bind(layout, &mut region).unwrap();

        let r1 = handle.publish(&block_a, test_publication(), |_| {}).unwrap();
        assert_eq!(r1.seqlock_counter, 2);

        let r2 = handle.publish(&block_a, test_publication(), |_| {}).unwrap();
        assert_eq!(r2.seqlock_counter, 4);

        let r3 = handle.publish(&block_a, test_publication(), |_| {}).unwrap();
        assert_eq!(r3.seqlock_counter, 6);
    }

    #[test]
    fn repeated_publish_through_region_increments_publication_sequence_by_one() {
        let layout = test_layout();
        let mut region = vec![0_u8; layout.total_region_byte_length];
        let block_a = vec![0_u8; layout.block_a_size];
        let mut handle = HotPublicationRegion::bind(layout, &mut region).unwrap();

        let r1 = handle.publish(&block_a, test_publication(), |_| {}).unwrap();
        assert_eq!(r1.publication_sequence, 1);

        let r2 = handle.publish(&block_a, test_publication(), |_| {}).unwrap();
        assert_eq!(r2.publication_sequence, 2);

        let r3 = handle.publish(&block_a, test_publication(), |_| {}).unwrap();
        assert_eq!(r3.publication_sequence, 3);
    }

    #[test]
    fn invalid_seqlock_offset_rejects_deterministically_before_mutation() {
        let layout = HotPublicationLayout {
            total_region_byte_length: 100,
            block_a_size: 10,
            seqlock_offset: 95, // 95 + 8 = 103 > 100
            baseline_epoch_offset: 0,
            continuity_generation_offset: 0,
            publication_sequence_offset: 0,
        };
        let mut region = vec![0u8; 200];
        let snapshot = region.clone();

        let err =
            HotPublicationRegion::bind(layout, &mut region).unwrap_err();
        assert_eq!(
            err,
            HotPublicationError::LayoutRangeOutOfBounds {
                field: "seqlock_offset",
                offset: 95,
                byte_length: 8,
                total_region_byte_length: 100,
            }
        );
        assert_eq!(region, snapshot, "region must not be mutated on error");
    }

    #[test]
    fn invalid_baseline_epoch_offset_rejects_deterministically_before_mutation() {
        let layout = HotPublicationLayout {
            total_region_byte_length: 100,
            block_a_size: 10,
            seqlock_offset: 0,
            baseline_epoch_offset: 98, // 98 + 4 = 102 > 100
            continuity_generation_offset: 0,
            publication_sequence_offset: 0,
        };
        let mut region = vec![0u8; 200];
        let snapshot = region.clone();

        let err =
            HotPublicationRegion::bind(layout, &mut region).unwrap_err();
        assert_eq!(
            err,
            HotPublicationError::LayoutRangeOutOfBounds {
                field: "baseline_epoch_offset",
                offset: 98,
                byte_length: 4,
                total_region_byte_length: 100,
            }
        );
        assert_eq!(region, snapshot, "region must not be mutated on error");
    }

    #[test]
    fn invalid_continuity_generation_offset_rejects_deterministically_before_mutation() {
        let layout = HotPublicationLayout {
            total_region_byte_length: 100,
            block_a_size: 10,
            seqlock_offset: 0,
            baseline_epoch_offset: 0,
            continuity_generation_offset: 98, // 98 + 4 = 102 > 100
            publication_sequence_offset: 0,
        };
        let mut region = vec![0u8; 200];
        let snapshot = region.clone();

        let err =
            HotPublicationRegion::bind(layout, &mut region).unwrap_err();
        assert_eq!(
            err,
            HotPublicationError::LayoutRangeOutOfBounds {
                field: "continuity_generation_offset",
                offset: 98,
                byte_length: 4,
                total_region_byte_length: 100,
            }
        );
        assert_eq!(region, snapshot, "region must not be mutated on error");
    }

    #[test]
    fn invalid_publication_sequence_offset_rejects_deterministically_before_mutation() {
        let layout = HotPublicationLayout {
            total_region_byte_length: 100,
            block_a_size: 10,
            seqlock_offset: 0,
            baseline_epoch_offset: 0,
            continuity_generation_offset: 0,
            publication_sequence_offset: 95, // 95 + 8 = 103 > 100
        };
        let mut region = vec![0u8; 200];
        let snapshot = region.clone();

        let err =
            HotPublicationRegion::bind(layout, &mut region).unwrap_err();
        assert_eq!(
            err,
            HotPublicationError::LayoutRangeOutOfBounds {
                field: "publication_sequence_offset",
                offset: 95,
                byte_length: 8,
                total_region_byte_length: 100,
            }
        );
        assert_eq!(region, snapshot, "region must not be mutated on error");
    }

    #[test]
    fn invalid_block_a_range_rejects_deterministically_before_mutation() {
        let layout = HotPublicationLayout {
            total_region_byte_length: 100,
            block_a_size: 200,       // 200 > 100
            seqlock_offset: 0,
            baseline_epoch_offset: 0,
            continuity_generation_offset: 0,
            publication_sequence_offset: 0,
        };
        let mut region = vec![0u8; 200];
        let snapshot = region.clone();

        let err =
            HotPublicationRegion::bind(layout, &mut region).unwrap_err();
        assert_eq!(
            err,
            HotPublicationError::LayoutRangeOutOfBounds {
                field: "block_a_size",
                offset: 0,
                byte_length: 200,
                total_region_byte_length: 100,
            }
        );
        assert_eq!(region, snapshot, "region must not be mutated on error");
    }

    #[test]
    fn offset_arithmetic_overflow_rejects_deterministically() {
        let layout = HotPublicationLayout {
            total_region_byte_length: 100,
            block_a_size: 10,
            seqlock_offset: usize::MAX - 3, // MAX - 3 + 8 overflows
            baseline_epoch_offset: 0,
            continuity_generation_offset: 0,
            publication_sequence_offset: 0,
        };
        let mut region = vec![0u8; 200];
        let snapshot = region.clone();

        let err =
            HotPublicationRegion::bind(layout, &mut region).unwrap_err();
        assert_eq!(
            err,
            HotPublicationError::LayoutRangeOutOfBounds {
                field: "seqlock_offset",
                offset: usize::MAX - 3,
                byte_length: 8,
                total_region_byte_length: 100,
            }
        );
        assert_eq!(region, snapshot, "region must not be mutated on error");
    }

    #[test]
    fn seqlock_offset_before_block_a_rejects_before_mutation() {
        let layout = HotPublicationLayout {
            total_region_byte_length: 200,
            block_a_size: 100,
            seqlock_offset: 50,
            baseline_epoch_offset: 100,
            continuity_generation_offset: 104,
            publication_sequence_offset: 108,
        };
        let mut region = vec![0u8; 200];
        let snapshot = region.clone();

        let err =
            HotPublicationRegion::bind(layout, &mut region).unwrap_err();
        assert_eq!(
            err,
            HotPublicationError::LayoutOverlapsBlockA {
                field: "seqlock_offset",
                offset: 50,
                byte_length: 8,
                block_a_size: 100,
            }
        );
        assert_eq!(region, snapshot, "region must not be mutated on error");
    }

    #[test]
    fn baseline_epoch_offset_before_block_a_rejects_before_mutation() {
        let layout = HotPublicationLayout {
            total_region_byte_length: 200,
            block_a_size: 100,
            seqlock_offset: 100,
            baseline_epoch_offset: 50,
            continuity_generation_offset: 104,
            publication_sequence_offset: 108,
        };
        let mut region = vec![0u8; 200];
        let snapshot = region.clone();

        let err =
            HotPublicationRegion::bind(layout, &mut region).unwrap_err();
        assert_eq!(
            err,
            HotPublicationError::LayoutOverlapsBlockA {
                field: "baseline_epoch_offset",
                offset: 50,
                byte_length: 4,
                block_a_size: 100,
            }
        );
        assert_eq!(region, snapshot, "region must not be mutated on error");
    }

    #[test]
    fn continuity_generation_offset_before_block_a_rejects_before_mutation() {
        let layout = HotPublicationLayout {
            total_region_byte_length: 200,
            block_a_size: 100,
            seqlock_offset: 100,
            baseline_epoch_offset: 104,
            continuity_generation_offset: 50,
            publication_sequence_offset: 108,
        };
        let mut region = vec![0u8; 200];
        let snapshot = region.clone();

        let err =
            HotPublicationRegion::bind(layout, &mut region).unwrap_err();
        assert_eq!(
            err,
            HotPublicationError::LayoutOverlapsBlockA {
                field: "continuity_generation_offset",
                offset: 50,
                byte_length: 4,
                block_a_size: 100,
            }
        );
        assert_eq!(region, snapshot, "region must not be mutated on error");
    }

    #[test]
    fn publication_sequence_offset_before_block_a_rejects_before_mutation() {
        let layout = HotPublicationLayout {
            total_region_byte_length: 200,
            block_a_size: 100,
            seqlock_offset: 100,
            baseline_epoch_offset: 104,
            continuity_generation_offset: 108,
            publication_sequence_offset: 50,
        };
        let mut region = vec![0u8; 200];
        let snapshot = region.clone();

        let err =
            HotPublicationRegion::bind(layout, &mut region).unwrap_err();
        assert_eq!(
            err,
            HotPublicationError::LayoutOverlapsBlockA {
                field: "publication_sequence_offset",
                offset: 50,
                byte_length: 8,
                block_a_size: 100,
            }
        );
        assert_eq!(region, snapshot, "region must not be mutated on error");
    }

    #[test]
    fn baseline_epoch_offset_overlapping_seqlock_rejects_before_mutation() {
        let layout = HotPublicationLayout {
            total_region_byte_length: 200,
            block_a_size: 72,
            seqlock_offset: 72,      // [72, 80)
            baseline_epoch_offset: 74,  // [74, 78) overlaps seqlock
            continuity_generation_offset: 88,
            publication_sequence_offset: 92,
        };
        let mut region = vec![0u8; 200];
        let snapshot = region.clone();

        let err =
            HotPublicationRegion::bind(layout, &mut region).unwrap_err();
        assert_eq!(
            err,
            HotPublicationError::LayoutRangesOverlap {
                first_field: "seqlock_offset",
                first_offset: 72,
                first_byte_length: 8,
                second_field: "baseline_epoch_offset",
                second_offset: 74,
                second_byte_length: 4,
            }
        );
        assert_eq!(region, snapshot, "region must not be mutated on error");
    }

    #[test]
    fn continuity_generation_offset_overlapping_baseline_epoch_rejects_before_mutation() {
        let layout = HotPublicationLayout {
            total_region_byte_length: 200,
            block_a_size: 72,
            seqlock_offset: 72,
            baseline_epoch_offset: 80,    // [80, 84)
            continuity_generation_offset: 82, // [82, 86) overlaps baseline_epoch
            publication_sequence_offset: 88,
        };
        let mut region = vec![0u8; 200];
        let snapshot = region.clone();

        let err =
            HotPublicationRegion::bind(layout, &mut region).unwrap_err();
        assert_eq!(
            err,
            HotPublicationError::LayoutRangesOverlap {
                first_field: "baseline_epoch_offset",
                first_offset: 80,
                first_byte_length: 4,
                second_field: "continuity_generation_offset",
                second_offset: 82,
                second_byte_length: 4,
            }
        );
        assert_eq!(region, snapshot, "region must not be mutated on error");
    }

    #[test]
    fn publication_sequence_offset_overlapping_seqlock_rejects_before_mutation() {
        let layout = HotPublicationLayout {
            total_region_byte_length: 200,
            block_a_size: 72,
            seqlock_offset: 72,             // [72, 80)
            baseline_epoch_offset: 80,
            continuity_generation_offset: 84,
            publication_sequence_offset: 76, // [76, 84) overlaps seqlock
        };
        let mut region = vec![0u8; 200];
        let snapshot = region.clone();

        let err =
            HotPublicationRegion::bind(layout, &mut region).unwrap_err();
        assert_eq!(
            err,
            HotPublicationError::LayoutRangesOverlap {
                first_field: "seqlock_offset",
                first_offset: 72,
                first_byte_length: 8,
                second_field: "publication_sequence_offset",
                second_offset: 76,
                second_byte_length: 8,
            }
        );
        assert_eq!(region, snapshot, "region must not be mutated on error");
    }

    #[test]
    fn publication_sequence_offset_overlapping_continuity_generation_rejects_before_mutation() {
        let layout = HotPublicationLayout {
            total_region_byte_length: 200,
            block_a_size: 72,
            seqlock_offset: 72,
            baseline_epoch_offset: 80,
            continuity_generation_offset: 84,    // [84, 88)
            publication_sequence_offset: 86,     // [86, 94) overlaps continuity_generation
        };
        let mut region = vec![0u8; 200];
        let snapshot = region.clone();

        let err =
            HotPublicationRegion::bind(layout, &mut region).unwrap_err();
        assert_eq!(
            err,
            HotPublicationError::LayoutRangesOverlap {
                first_field: "continuity_generation_offset",
                first_offset: 84,
                first_byte_length: 4,
                second_field: "publication_sequence_offset",
                second_offset: 86,
                second_byte_length: 8,
            }
        );
        assert_eq!(region, snapshot, "region must not be mutated on error");
    }

    #[test]
    fn field_writer_receives_only_logical_region() {
        let layout = test_layout();
        let extra = 10;
        let mut region = vec![0u8; layout.total_region_byte_length + extra];
        let sentinel = 0xab;
        for byte in &mut region[layout.total_region_byte_length..] {
            *byte = sentinel;
        }
        let block_a = vec![0u8; layout.block_a_size];

        let mut handle = HotPublicationRegion::bind(layout, &mut region).unwrap();
        handle
            .publish(&block_a, test_publication(), |logical_region| {
                assert_eq!(logical_region.len(), layout.total_region_byte_length);
                let end = logical_region.len();
                logical_region[end - 4..end].copy_from_slice(&[0xde, 0xad, 0xbe, 0xef]);
            })
            .unwrap();

        for byte in &region[layout.total_region_byte_length..] {
            assert_eq!(*byte, sentinel, "trailing bytes must not be mutated");
        }
    }

    #[test]
    fn field_writer_cannot_corrupt_block_a_in_final_publication() {
        let layout = test_layout();
        let mut region = vec![0u8; layout.total_region_byte_length];
        let block_a = {
            let mut b = vec![0u8; layout.block_a_size];
            b[0] = 0x53;
            b[1] = 0x51;
            b[2] = 0x4c;
            b[3] = 0x4b;
            b
        };
        let mut handle = HotPublicationRegion::bind(layout, &mut region).unwrap();
        handle
            .publish(&block_a, test_publication(), |r| {
                // Try to corrupt Block A bytes
                r[..4].copy_from_slice(&[0x00, 0x00, 0x00, 0x00]);
            })
            .unwrap();
        // Substrate must have restored Block A
        assert_eq!(region[..4], [0x53, 0x51, 0x4c, 0x4b]);
    }

    #[test]
    fn field_writer_cannot_corrupt_baseline_epoch_in_final_publication() {
        let layout = test_layout();
        let mut region = vec![0u8; layout.total_region_byte_length];
        let block_a = vec![0u8; layout.block_a_size];
        let mut handle = HotPublicationRegion::bind(layout, &mut region).unwrap();
        handle
            .publish(&block_a, test_publication(), |r| {
                // Try to corrupt baseline_epoch
                write_u32_le(r, layout.baseline_epoch_offset, 0xdeadbeef);
            })
            .unwrap();
        // Substrate must have restored baseline_epoch
        assert_eq!(
            read_u32_le(&region, layout.baseline_epoch_offset),
            test_publication().baseline_epoch
        );
    }

    #[test]
    fn field_writer_cannot_corrupt_continuity_generation_in_final_publication() {
        let layout = test_layout();
        let mut region = vec![0u8; layout.total_region_byte_length];
        let block_a = vec![0u8; layout.block_a_size];
        let mut handle = HotPublicationRegion::bind(layout, &mut region).unwrap();
        handle
            .publish(&block_a, test_publication(), |r| {
                // Try to corrupt continuity_generation
                write_u32_le(r, layout.continuity_generation_offset, 0xdeadbeef);
            })
            .unwrap();
        // Substrate must have restored continuity_generation
        assert_eq!(
            read_u32_le(&region, layout.continuity_generation_offset),
            test_publication().continuity_generation
        );
    }

    #[test]
    fn writer_active_odd_seqlock_rejects_before_mutation() {
        let layout = test_layout();
        let mut region = vec![0_u8; layout.total_region_byte_length];
        let block_a = vec![0_u8; layout.block_a_size];
        // Set odd (writer-active) seqlock
        write_u64_le(&mut region, layout.seqlock_offset, 3);

        let err =
            hot_publish(&layout, &mut region, &block_a, test_publication(), |_| {})
                .unwrap_err();
        assert_eq!(
            err,
            HotPublicationError::WriterActiveSeqlock { counter: 3 }
        );
        // Seqlock must still be 3 (not mutated)
        assert_eq!(
            read_u64_le(&region, layout.seqlock_offset),
            3
        );
    }

    #[test]
    fn region_too_short_rejects_deterministically() {
        let layout = test_layout();
        let mut short_region = vec![0_u8; layout.total_region_byte_length - 1];
        let block_a = vec![0_u8; layout.block_a_size];

        let err = hot_publish(
            &layout,
            &mut short_region,
            &block_a,
            test_publication(),
            |_| {},
        )
        .unwrap_err();
        assert_eq!(
            err,
            HotPublicationError::RegionTooShort {
                expected_minimum: layout.total_region_byte_length,
                actual: layout.total_region_byte_length - 1,
            }
        );
    }

    #[test]
    fn block_a_length_mismatch_rejects_deterministically() {
        let layout = test_layout();
        let mut region = vec![0_u8; layout.total_region_byte_length];
        let short_block_a = vec![0_u8; layout.block_a_size - 1];

        let err = hot_publish(
            &layout,
            &mut region,
            &short_block_a,
            test_publication(),
            |_| {},
        )
        .unwrap_err();
        assert_eq!(
            err,
            HotPublicationError::BlockALength {
                expected: layout.block_a_size,
                actual: layout.block_a_size - 1,
            }
        );
    }

    #[test]
    fn publication_sequence_overflow_rejects_deterministically() {
        let layout = test_layout();
        let mut region = vec![0_u8; layout.total_region_byte_length];
        let block_a = vec![0_u8; layout.block_a_size];
        // Set publication sequence to MAX
        write_u64_le(&mut region, layout.publication_sequence_offset, u64::MAX);

        let err =
            hot_publish(&layout, &mut region, &block_a, test_publication(), |_| {})
                .unwrap_err();
        assert_eq!(
            err,
            HotPublicationError::PublicationSequenceOverflow {
                sequence: u64::MAX
            }
        );
    }

    #[test]
    fn seqlock_overflow_rejects_deterministically() {
        let layout = test_layout();
        let mut region = vec![0_u8; layout.total_region_byte_length];
        let block_a = vec![0_u8; layout.block_a_size];
        // Set seqlock to u64::MAX - 1 (even, so it passes the odd check,
        // but adding 2 will overflow)
        write_u64_le(&mut region, layout.seqlock_offset, u64::MAX - 1);

        let err =
            hot_publish(&layout, &mut region, &block_a, test_publication(), |_| {})
                .unwrap_err();
        assert_eq!(
            err,
            HotPublicationError::SeqlockOverflow {
                counter: u64::MAX - 1
            }
        );
    }

    #[test]
    fn publish_via_region_writes_block_a_bytes() {
        let layout = test_layout();
        let mut region = vec![0u8; layout.total_region_byte_length];
        let block_a = {
            let mut b = vec![0u8; layout.block_a_size];
            b[0] = 0x53;
            b[1] = 0x51;
            b[2] = 0x4c;
            b[3] = 0x4b;
            b
        };
        let mut handle = HotPublicationRegion::bind(layout, &mut region).unwrap();
        handle.publish(&block_a, test_publication(), |_| {}).unwrap();
        assert_eq!(region[..4], [0x53, 0x51, 0x4c, 0x4b]);
    }

    #[test]
    fn publish_via_region_writes_block_b_metadata() {
        let layout = test_layout();
        let mut region = vec![0u8; layout.total_region_byte_length];
        let block_a = vec![0u8; layout.block_a_size];
        let mut handle = HotPublicationRegion::bind(layout, &mut region).unwrap();
        handle.publish(&block_a, test_publication(), |_| {}).unwrap();

        assert_eq!(read_u64_le(&region, layout.seqlock_offset), 2);
        assert_eq!(
            read_u32_le(&region, layout.baseline_epoch_offset),
            7
        );
        assert_eq!(
            read_u32_le(&region, layout.continuity_generation_offset),
            3
        );
        assert_eq!(
            read_u64_le(&region, layout.publication_sequence_offset),
            1
        );
    }

    #[test]
    fn closure_writes_are_preserved_after_publication() {
        let layout = test_layout();
        let mut region = vec![0u8; layout.total_region_byte_length];
        let block_a = vec![0u8; layout.block_a_size];
        let mut handle = HotPublicationRegion::bind(layout, &mut region).unwrap();
        handle
            .publish(&block_a, test_publication(), |r| {
                r[TEST_FIELD_WRITE_OFFSET..TEST_FIELD_WRITE_OFFSET + 4]
                    .copy_from_slice(&[0xbe, 0xba, 0xfe, 0xca]);
            })
            .unwrap();
        assert_eq!(
            region[TEST_FIELD_WRITE_OFFSET..TEST_FIELD_WRITE_OFFSET + 4],
            [0xbe, 0xba, 0xfe, 0xca]
        );
    }

    fn read_u32_le(region: &[u8], offset: usize) -> u32 {
        let mut bytes = [0_u8; 4];
        bytes.copy_from_slice(&region[offset..offset + 4]);
        u32::from_le_bytes(bytes)
    }
}
