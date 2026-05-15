import { encodeHotFieldData, type HotFieldValues } from "./byte";
import {
  HOT_BLOCK_A_BYTE_LENGTH,
  HOT_BLOCK_B_BYTE_LENGTH,
  HOT_BLOCK_B_BYTE_OFFSET,
  HOT_FIELD_DATA_BYTE_OFFSET,
} from "./constants";
import { createHotByteRejectedError, createHotCodecIssue, type HotCodecIssue } from "./error";
import {
  encodeHotBlockAHeader,
  encodeHotBlockBHeader,
  type HotBlockAHeaderInput,
  type HotBlockBHeaderInput,
} from "./header";
import type { HotLayoutManifest } from "./manifest";

export type HotCompleteFixtureRegionInput = {
  readonly blockA: HotBlockAHeaderInput;
  readonly blockB: HotBlockBHeaderInput;
  readonly values: HotFieldValues;
};

export function encodeHotCompleteFixtureRegion(
  manifest: HotLayoutManifest,
  input: HotCompleteFixtureRegionInput,
): Uint8Array {
  validateCompleteFixtureRegionInput(manifest, input);

  const blockABytes = encodeHotBlockAHeader(input.blockA);
  const blockBBytes = encodeHotBlockBHeader(input.blockB);
  const fieldBytes = encodeHotFieldData(manifest, input.values);
  const regionBytes = new Uint8Array(manifest.totalRegionByteLength);

  regionBytes.set(blockABytes, 0);
  regionBytes.set(blockBBytes, HOT_BLOCK_B_BYTE_OFFSET);
  regionBytes.set(fieldBytes, HOT_FIELD_DATA_BYTE_OFFSET);

  return regionBytes;
}

function validateCompleteFixtureRegionInput(
  manifest: HotLayoutManifest,
  input: HotCompleteFixtureRegionInput,
): void {
  const issues: HotCodecIssue[] = [];

  if (input.blockA.contractKey !== manifest.contractKey) {
    issues.push(
      createHotCodecIssue(
        "byte.fixtureRegionContractKeyMismatch",
        "input.blockA.contractKey",
        `expected ${manifest.contractKey}, got ${input.blockA.contractKey}`,
      ),
    );
  }

  if (input.blockA.hotLayoutVersion !== manifest.hotLayoutVersion) {
    issues.push(
      createHotCodecIssue(
        "header.hotLayoutVersionMismatch",
        "input.blockA.hotLayoutVersion",
        `expected ${manifest.hotLayoutVersion}, got ${input.blockA.hotLayoutVersion}`,
      ),
    );
  }

  if (input.blockA.fieldCount !== manifest.fields.length) {
    issues.push(
      createHotCodecIssue(
        "header.fieldCountMismatch",
        "input.blockA.fieldCount",
        `expected ${manifest.fields.length}, got ${input.blockA.fieldCount}`,
      ),
    );
  }

  if (input.blockA.mutableRegionByteLength !== manifest.mutableRegionByteLength) {
    issues.push(
      createHotCodecIssue(
        "header.mutableRegionByteLengthMismatch",
        "input.blockA.mutableRegionByteLength",
        `expected ${manifest.mutableRegionByteLength}, got ${input.blockA.mutableRegionByteLength}`,
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

  if (
    !Number.isSafeInteger(manifest.totalRegionByteLength) ||
    manifest.totalRegionByteLength < HOT_BLOCK_A_BYTE_LENGTH + HOT_BLOCK_B_BYTE_LENGTH ||
    manifest.totalRegionByteLength < HOT_FIELD_DATA_BYTE_OFFSET
  ) {
    issues.push(
      createHotCodecIssue(
        "byte.fixtureRegionLengthInvalid",
        "manifest.totalRegionByteLength",
        `totalRegionByteLength must be at least ${HOT_FIELD_DATA_BYTE_OFFSET}, got ${manifest.totalRegionByteLength}`,
      ),
    );
  }

  if (issues.length > 0) {
    throw createHotByteRejectedError(issues);
  }
}
