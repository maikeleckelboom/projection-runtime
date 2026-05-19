import { decodeHotFieldValues, type HotFieldValues } from "./byte";
import {
  HOT_BLOCK_A_BYTE_LENGTH,
  HOT_BLOCK_B_BYTE_OFFSET,
  HOT_BLOCK_B_END_OFFSET,
  HOT_FIELD_DATA_BYTE_OFFSET,
} from "./constants";
import { createHotByteRejectedError, createHotCodecIssue, type HotCodecIssue } from "./error";
import {
  decodeHotBlockAHeader,
  decodeHotBlockBHeader,
  type HotBlockAHeader,
  type HotBlockBHeader,
  validateHotBlockAHeader,
} from "./header";
import { deriveHotBlockAIdentityHashHex } from "./header-identity";
import type { HotLayoutManifest } from "./manifest";

export type HotCompleteFixtureRegionDecodeOptions = {
  readonly expectedContractKey?: string;
  readonly expectedInstanceKey?: string;
  readonly expectedBaselineEpoch?: number;
  readonly expectedContinuityGeneration?: number;
};

export type HotCompleteFixtureRegionDecodeResult = {
  readonly blockA: HotBlockAHeader;
  readonly blockB: HotBlockBHeader;
  readonly fieldValues: HotFieldValues;
};

export function decodeHotCompleteFixtureRegion(
  manifest: HotLayoutManifest,
  bytes: Uint8Array,
  options: HotCompleteFixtureRegionDecodeOptions = {},
): HotCompleteFixtureRegionDecodeResult {
  validateCompleteFixtureRegionWindow(manifest, bytes);

  const blockABytes = bytes.subarray(0, HOT_BLOCK_A_BYTE_LENGTH);
  const blockA = decodeHotBlockAHeader(blockABytes);
  const blockB = decodeHotBlockBHeader(
    bytes.subarray(HOT_BLOCK_B_BYTE_OFFSET, HOT_BLOCK_B_END_OFFSET),
  );
  validateCompleteFixtureRegionHeaders(manifest, blockABytes, blockA, options);
  validateCompleteFixtureRegionBlockBIdentity(blockB, options);

  return {
    blockA,
    blockB,
    fieldValues: decodeHotFieldValues(manifest, bytes).values,
  };
}

function validateCompleteFixtureRegionWindow(manifest: HotLayoutManifest, bytes: Uint8Array): void {
  const issues: HotCodecIssue[] = [];

  if (bytes.byteLength !== manifest.totalRegionByteLength) {
    issues.push(
      createHotCodecIssue(
        "byte.fixtureRegionLengthInvalid",
        "bytes",
        `complete fixture region must be exactly ${manifest.totalRegionByteLength} bytes, got ${bytes.byteLength}`,
      ),
    );
  }

  if (manifest.fieldDataOrigin !== HOT_FIELD_DATA_BYTE_OFFSET) {
    issues.push(
      createHotCodecIssue(
        "byte.fixtureRegionFieldDataOriginInvalid",
        "manifest.fieldDataOrigin",
        `expected ${HOT_FIELD_DATA_BYTE_OFFSET}, got ${manifest.fieldDataOrigin}`,
      ),
    );
  }

  if (issues.length > 0) {
    throw createHotByteRejectedError(issues);
  }
}

function validateCompleteFixtureRegionHeaders(
  manifest: HotLayoutManifest,
  blockABytes: Uint8Array,
  blockA: HotBlockAHeader,
  options: HotCompleteFixtureRegionDecodeOptions,
): void {
  const issues: HotCodecIssue[] = [];

  if (blockA.hotLayoutVersion !== manifest.hotLayoutVersion) {
    issues.push(
      createHotCodecIssue(
        "header.hotLayoutVersionMismatch",
        "manifest.hotLayoutVersion",
        `expected ${manifest.hotLayoutVersion}, got ${blockA.hotLayoutVersion}`,
      ),
    );
  }

  if (blockA.fieldCount !== manifest.fields.length) {
    issues.push(
      createHotCodecIssue(
        "header.fieldCountMismatch",
        "manifest.fields",
        `expected ${manifest.fields.length}, got ${blockA.fieldCount}`,
      ),
    );
  }

  if (blockA.mutableRegionByteLength !== manifest.mutableRegionByteLength) {
    issues.push(
      createHotCodecIssue(
        "header.mutableRegionByteLengthMismatch",
        "manifest.mutableRegionByteLength",
        `expected ${manifest.mutableRegionByteLength}, got ${blockA.mutableRegionByteLength}`,
      ),
    );
  }

  issues.push(...validateCompleteFixtureRegionExpectedKeys(blockABytes, blockA, options));

  if (issues.length > 0) {
    throw createHotByteRejectedError(issues);
  }
}

function validateCompleteFixtureRegionExpectedKeys(
  blockABytes: Uint8Array,
  blockA: HotBlockAHeader,
  options: HotCompleteFixtureRegionDecodeOptions,
): readonly HotCodecIssue[] {
  if (options.expectedContractKey !== undefined && options.expectedInstanceKey !== undefined) {
    const validation = validateHotBlockAHeader(blockABytes, {
      contractKey: options.expectedContractKey,
      instanceKey: options.expectedInstanceKey,
      semanticVersion: blockA.semanticVersion,
      hotLayoutVersion: blockA.hotLayoutVersion,
      fieldCount: blockA.fieldCount,
      mutableRegionByteLength: blockA.mutableRegionByteLength,
    });

    if (!validation.ok) {
      return validation.error.details.issues;
    }
    return [];
  }

  const issues: HotCodecIssue[] = [];

  if (options.expectedContractKey !== undefined) {
    const expectedHashHex = deriveHotBlockAIdentityHashHex(options.expectedContractKey);
    if (blockA.contractKeyHashHex !== expectedHashHex) {
      issues.push(
        createHotCodecIssue(
          "header.contractKeyHashMismatch",
          "options.expectedContractKey",
          `contractKey hash mismatch: expected ${expectedHashHex}, got ${blockA.contractKeyHashHex}`,
        ),
      );
    }
  }

  if (options.expectedInstanceKey !== undefined) {
    const expectedHashHex = deriveHotBlockAIdentityHashHex(options.expectedInstanceKey);
    if (blockA.instanceKeyHashHex !== expectedHashHex) {
      issues.push(
        createHotCodecIssue(
          "header.instanceKeyHashMismatch",
          "options.expectedInstanceKey",
          `instanceKey hash mismatch: expected ${expectedHashHex}, got ${blockA.instanceKeyHashHex}`,
        ),
      );
    }
  }

  return issues;
}

function validateCompleteFixtureRegionBlockBIdentity(
  blockB: HotBlockBHeader,
  options: HotCompleteFixtureRegionDecodeOptions,
): void {
  const issues: HotCodecIssue[] = [];

  if (
    options.expectedBaselineEpoch !== undefined &&
    blockB.baselineEpoch !== options.expectedBaselineEpoch
  ) {
    issues.push(
      createHotCodecIssue(
        "header.baselineEpochMismatch",
        "options.expectedBaselineEpoch",
        `baselineEpoch mismatch: expected ${options.expectedBaselineEpoch}, got ${blockB.baselineEpoch}`,
      ),
    );
  }

  if (
    options.expectedContinuityGeneration !== undefined &&
    blockB.continuityGeneration !== options.expectedContinuityGeneration
  ) {
    issues.push(
      createHotCodecIssue(
        "header.continuityGenerationMismatch",
        "options.expectedContinuityGeneration",
        `continuityGeneration mismatch: expected ${options.expectedContinuityGeneration}, got ${blockB.continuityGeneration}`,
      ),
    );
  }

  if (issues.length > 0) {
    throw createHotByteRejectedError(issues);
  }
}
