import { createHash } from "node:crypto";
import { bytesToHex } from "./byte";
import {
  HOT_ABI_VERSION,
  HOT_BLOCK_A_BYTE_LENGTH,
  HOT_BLOCK_B_BYTE_LENGTH,
  HOT_REGION_MAGIC_BYTES,
} from "./constants";
import {
  createHotByteRejectedError,
  createHotCodecIssue,
  type HotByteCodecError,
  type HotCodecIssue,
  type HotCodecIssueCode,
  isHotCodecError,
} from "./error";

export type HotBlockAHeaderInput = {
  readonly contractKey: string;
  readonly instanceKey: string;
  readonly semanticVersion: bigint;
  readonly hotLayoutVersion: bigint;
  readonly fieldCount: number;
  readonly mutableRegionByteLength: number;
};

export type HotBlockAHeader = {
  readonly regionMagicHex: "53514c4b";
  readonly hotAbiVersion: 1;
  readonly contractKeyHashHex: string;
  readonly instanceKeyHashHex: string;
  readonly semanticVersion: bigint;
  readonly hotLayoutVersion: bigint;
  readonly fieldCount: number;
  readonly mutableRegionByteLength: number;
  readonly reservedHex: "0000000000000000";
};

export type HotBlockAHeaderValidationResult =
  | { readonly ok: true; readonly value: HotBlockAHeader }
  | { readonly ok: false; readonly error: HotByteCodecError };

export type HotBlockBHeaderInput = {
  readonly seqlockCounter: bigint;
  readonly baselineEpoch: number;
  readonly continuityGeneration: number;
  readonly publicationSequence: bigint;
};

export type HotBlockBHeader = {
  readonly seqlockCounter: bigint;
  readonly baselineEpoch: number;
  readonly continuityGeneration: number;
  readonly publicationSequence: bigint;
};

export type HotBlockBHeaderValidationResult =
  | { readonly ok: true; readonly value: HotBlockBHeader }
  | { readonly ok: false; readonly error: HotByteCodecError };

export function encodeHotBlockAHeader(input: HotBlockAHeaderInput): Uint8Array {
  validateInput(input);
  const bytes = new Uint8Array(HOT_BLOCK_A_BYTE_LENGTH);
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);

  bytes.set(HOT_REGION_MAGIC_BYTES, 0);
  view.setUint32(4, HOT_ABI_VERSION, true);
  bytes.set(hashKey(input.contractKey), 8);
  bytes.set(hashKey(input.instanceKey), 24);
  view.setBigUint64(40, input.semanticVersion, true);
  view.setBigUint64(48, input.hotLayoutVersion, true);
  view.setUint32(56, input.fieldCount, true);
  view.setUint32(60, input.mutableRegionByteLength, true);
  // reserved bytes 64-72 already zero

  return bytes;
}

export function decodeHotBlockAHeader(bytes: Uint8Array): HotBlockAHeader {
  if (bytes.byteLength !== HOT_BLOCK_A_BYTE_LENGTH) {
    throw headerError(
      "header.byteLengthInvalid",
      "bytes",
      `Block A header must be exactly ${HOT_BLOCK_A_BYTE_LENGTH} bytes, got ${bytes.byteLength}`,
    );
  }

  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);

  for (let i = 0; i < HOT_REGION_MAGIC_BYTES.length; i++) {
    if (bytes[i] !== HOT_REGION_MAGIC_BYTES[i]) {
      throw headerError(
        "header.magicInvalid",
        "bytes.magic",
        "Block A header magic bytes must be [53, 51, 4c, 4b]",
      );
    }
  }

  const hotAbiVersion = view.getUint32(4, true);
  if (hotAbiVersion !== HOT_ABI_VERSION) {
    throw headerError(
      "header.hotAbiVersionUnsupported",
      "bytes.hotAbiVersion",
      `Block A header hotAbiVersion ${hotAbiVersion} is not supported; expected ${HOT_ABI_VERSION}`,
    );
  }

  for (let i = 64; i < 72; i++) {
    if (bytes[i] !== 0) {
      throw headerError(
        "header.reservedNonZero",
        "bytes.reserved",
        "Block A header reserved bytes must be zero",
      );
    }
  }

  const contractKeyHashHex = bytesToHex(bytes.subarray(8, 24));
  const instanceKeyHashHex = bytesToHex(bytes.subarray(24, 40));

  return {
    regionMagicHex: "53514c4b",
    hotAbiVersion: 1,
    contractKeyHashHex,
    instanceKeyHashHex,
    semanticVersion: view.getBigUint64(40, true),
    hotLayoutVersion: view.getBigUint64(48, true),
    fieldCount: view.getUint32(56, true),
    mutableRegionByteLength: view.getUint32(60, true),
    reservedHex: "0000000000000000",
  };
}

export function validateHotBlockAHeader(
  bytes: Uint8Array,
  expected: HotBlockAHeaderInput,
): HotBlockAHeaderValidationResult {
  let decoded: HotBlockAHeader;
  try {
    decoded = decodeHotBlockAHeader(bytes);
  } catch (error) {
    if (isHotCodecError(error) && error.code === "hotCodec.byteRejected") {
      return { ok: false, error };
    }
    throw error;
  }

  const issues: HotCodecIssue[] = [];

  const expectedContractKeyHashHex = bytesToHex(hashKey(expected.contractKey));
  if (decoded.contractKeyHashHex !== expectedContractKeyHashHex) {
    issues.push(
      createHotCodecIssue(
        "header.contractKeyHashMismatch",
        "expected.contractKey",
        `contractKey hash mismatch: expected ${expectedContractKeyHashHex}, got ${decoded.contractKeyHashHex}`,
      ),
    );
  }

  const expectedInstanceKeyHashHex = bytesToHex(hashKey(expected.instanceKey));
  if (decoded.instanceKeyHashHex !== expectedInstanceKeyHashHex) {
    issues.push(
      createHotCodecIssue(
        "header.instanceKeyHashMismatch",
        "expected.instanceKey",
        `instanceKey hash mismatch: expected ${expectedInstanceKeyHashHex}, got ${decoded.instanceKeyHashHex}`,
      ),
    );
  }

  if (decoded.semanticVersion !== expected.semanticVersion) {
    issues.push(
      createHotCodecIssue(
        "header.semanticVersionMismatch",
        "expected.semanticVersion",
        `semanticVersion mismatch: expected ${expected.semanticVersion}, got ${decoded.semanticVersion}`,
      ),
    );
  }

  if (decoded.hotLayoutVersion !== expected.hotLayoutVersion) {
    issues.push(
      createHotCodecIssue(
        "header.hotLayoutVersionMismatch",
        "expected.hotLayoutVersion",
        `hotLayoutVersion mismatch: expected ${expected.hotLayoutVersion}, got ${decoded.hotLayoutVersion}`,
      ),
    );
  }

  if (decoded.fieldCount !== expected.fieldCount) {
    issues.push(
      createHotCodecIssue(
        "header.fieldCountMismatch",
        "expected.fieldCount",
        `fieldCount mismatch: expected ${expected.fieldCount}, got ${decoded.fieldCount}`,
      ),
    );
  }

  if (decoded.mutableRegionByteLength !== expected.mutableRegionByteLength) {
    issues.push(
      createHotCodecIssue(
        "header.mutableRegionByteLengthMismatch",
        "expected.mutableRegionByteLength",
        `mutableRegionByteLength mismatch: expected ${expected.mutableRegionByteLength}, got ${decoded.mutableRegionByteLength}`,
      ),
    );
  }

  if (issues.length > 0) {
    return { ok: false, error: createHotByteRejectedError(issues) };
  }

  return { ok: true, value: decoded };
}

export function encodeHotBlockBHeader(input: HotBlockBHeaderInput): Uint8Array {
  validateBlockBInput(input);
  const bytes = new Uint8Array(HOT_BLOCK_B_BYTE_LENGTH);
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);

  view.setBigUint64(0, input.seqlockCounter, true);
  view.setUint32(8, input.baselineEpoch, true);
  view.setUint32(12, input.continuityGeneration, true);
  view.setBigUint64(16, input.publicationSequence, true);

  return bytes;
}

export function decodeHotBlockBHeader(bytes: Uint8Array): HotBlockBHeader {
  if (bytes.byteLength !== HOT_BLOCK_B_BYTE_LENGTH) {
    throw headerError(
      "header.blockBByteLengthInvalid",
      "bytes",
      `Block B header must be exactly ${HOT_BLOCK_B_BYTE_LENGTH} bytes, got ${bytes.byteLength}`,
    );
  }

  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);

  return {
    seqlockCounter: view.getBigUint64(0, true),
    baselineEpoch: view.getUint32(8, true),
    continuityGeneration: view.getUint32(12, true),
    publicationSequence: view.getBigUint64(16, true),
  };
}

export function validateHotBlockBHeader(
  bytes: Uint8Array,
  expected: HotBlockBHeaderInput,
): HotBlockBHeaderValidationResult {
  let decoded: HotBlockBHeader;
  try {
    decoded = decodeHotBlockBHeader(bytes);
  } catch (error) {
    if (isHotCodecError(error) && error.code === "hotCodec.byteRejected") {
      return { ok: false, error };
    }
    throw error;
  }

  const issues: HotCodecIssue[] = [];

  if (decoded.seqlockCounter !== expected.seqlockCounter) {
    issues.push(
      createHotCodecIssue(
        "header.seqlockCounterMismatch",
        "expected.seqlockCounter",
        `seqlockCounter mismatch: expected ${expected.seqlockCounter}, got ${decoded.seqlockCounter}`,
      ),
    );
  }

  if (decoded.baselineEpoch !== expected.baselineEpoch) {
    issues.push(
      createHotCodecIssue(
        "header.baselineEpochMismatch",
        "expected.baselineEpoch",
        `baselineEpoch mismatch: expected ${expected.baselineEpoch}, got ${decoded.baselineEpoch}`,
      ),
    );
  }

  if (decoded.continuityGeneration !== expected.continuityGeneration) {
    issues.push(
      createHotCodecIssue(
        "header.continuityGenerationMismatch",
        "expected.continuityGeneration",
        `continuityGeneration mismatch: expected ${expected.continuityGeneration}, got ${decoded.continuityGeneration}`,
      ),
    );
  }

  if (decoded.publicationSequence !== expected.publicationSequence) {
    issues.push(
      createHotCodecIssue(
        "header.publicationSequenceMismatch",
        "expected.publicationSequence",
        `publicationSequence mismatch: expected ${expected.publicationSequence}, got ${decoded.publicationSequence}`,
      ),
    );
  }

  if (issues.length > 0) {
    return { ok: false, error: createHotByteRejectedError(issues) };
  }

  return { ok: true, value: decoded };
}

function validateInput(input: HotBlockAHeaderInput): void {
  const issues: HotCodecIssue[] = [];

  if (input.contractKey.length === 0) {
    issues.push(createHotCodecIssue("header.contractKeyEmpty", "input.contractKey"));
  }

  if (input.instanceKey.length === 0) {
    issues.push(createHotCodecIssue("header.instanceKeyEmpty", "input.instanceKey"));
  }

  if (input.semanticVersion < 0n || input.semanticVersion > 0xffff_ffff_ffff_ffffn) {
    issues.push(createHotCodecIssue("header.semanticVersionOutOfRange", "input.semanticVersion"));
  }

  if (input.hotLayoutVersion < 0n || input.hotLayoutVersion > 0xffff_ffff_ffff_ffffn) {
    issues.push(createHotCodecIssue("header.hotLayoutVersionOutOfRange", "input.hotLayoutVersion"));
  }

  if (
    !Number.isSafeInteger(input.fieldCount) ||
    input.fieldCount < 0 ||
    input.fieldCount > 0xffff_ffff
  ) {
    issues.push(createHotCodecIssue("header.fieldCountOutOfRange", "input.fieldCount"));
  }

  if (
    !Number.isSafeInteger(input.mutableRegionByteLength) ||
    input.mutableRegionByteLength < 0 ||
    input.mutableRegionByteLength > 0xffff_ffff
  ) {
    issues.push(
      createHotCodecIssue(
        "header.mutableRegionByteLengthOutOfRange",
        "input.mutableRegionByteLength",
      ),
    );
  }

  if (issues.length > 0) {
    throw createHotByteRejectedError(issues);
  }
}

function validateBlockBInput(input: HotBlockBHeaderInput): void {
  const issues: HotCodecIssue[] = [];

  if (input.seqlockCounter < 0n || input.seqlockCounter > 0xffff_ffff_ffff_ffffn) {
    issues.push(createHotCodecIssue("header.seqlockCounterOutOfRange", "input.seqlockCounter"));
  }

  if (
    !Number.isSafeInteger(input.baselineEpoch) ||
    input.baselineEpoch < 0 ||
    input.baselineEpoch > 0xffff_ffff
  ) {
    issues.push(createHotCodecIssue("header.baselineEpochOutOfRange", "input.baselineEpoch"));
  }

  if (
    !Number.isSafeInteger(input.continuityGeneration) ||
    input.continuityGeneration < 0 ||
    input.continuityGeneration > 0xffff_ffff
  ) {
    issues.push(
      createHotCodecIssue("header.continuityGenerationOutOfRange", "input.continuityGeneration"),
    );
  }

  if (input.publicationSequence < 0n || input.publicationSequence > 0xffff_ffff_ffff_ffffn) {
    issues.push(
      createHotCodecIssue("header.publicationSequenceOutOfRange", "input.publicationSequence"),
    );
  }

  if (issues.length > 0) {
    throw createHotByteRejectedError(issues);
  }
}

function hashKey(key: string): Uint8Array {
  return createHash("sha256").update(key, "utf8").digest().subarray(0, 16);
}

function headerError(code: HotCodecIssueCode, path: string, message: string): HotByteCodecError {
  return createHotByteRejectedError([createHotCodecIssue(code, path, message)]);
}
