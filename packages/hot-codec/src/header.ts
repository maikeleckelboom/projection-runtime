import { createHash } from "node:crypto";

import { HOT_ABI_VERSION, HOT_BLOCK_A_BYTE_LENGTH } from "./constants";
import { HotByteCodecError, type HotCodecIssue } from "./error";

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

export const HOT_REGION_MAGIC_BYTES: Uint8Array = new Uint8Array([0x53, 0x51, 0x4c, 0x4b]);

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
    if (error instanceof HotByteCodecError) {
      return { ok: false, error };
    }
    throw error;
  }

  const issues: HotCodecIssue[] = [];

  const expectedContractKeyHashHex = bytesToHex(hashKey(expected.contractKey));
  if (decoded.contractKeyHashHex !== expectedContractKeyHashHex) {
    issues.push({
      code: "header.contractKeyHashMismatch",
      path: "expected.contractKey",
      message: `contractKey hash mismatch: expected ${expectedContractKeyHashHex}, got ${decoded.contractKeyHashHex}`,
    });
  }

  const expectedInstanceKeyHashHex = bytesToHex(hashKey(expected.instanceKey));
  if (decoded.instanceKeyHashHex !== expectedInstanceKeyHashHex) {
    issues.push({
      code: "header.instanceKeyHashMismatch",
      path: "expected.instanceKey",
      message: `instanceKey hash mismatch: expected ${expectedInstanceKeyHashHex}, got ${decoded.instanceKeyHashHex}`,
    });
  }

  if (decoded.semanticVersion !== expected.semanticVersion) {
    issues.push({
      code: "header.semanticVersionMismatch",
      path: "expected.semanticVersion",
      message: `semanticVersion mismatch: expected ${expected.semanticVersion}, got ${decoded.semanticVersion}`,
    });
  }

  if (decoded.hotLayoutVersion !== expected.hotLayoutVersion) {
    issues.push({
      code: "header.hotLayoutVersionMismatch",
      path: "expected.hotLayoutVersion",
      message: `hotLayoutVersion mismatch: expected ${expected.hotLayoutVersion}, got ${decoded.hotLayoutVersion}`,
    });
  }

  if (decoded.fieldCount !== expected.fieldCount) {
    issues.push({
      code: "header.fieldCountMismatch",
      path: "expected.fieldCount",
      message: `fieldCount mismatch: expected ${expected.fieldCount}, got ${decoded.fieldCount}`,
    });
  }

  if (decoded.mutableRegionByteLength !== expected.mutableRegionByteLength) {
    issues.push({
      code: "header.mutableRegionByteLengthMismatch",
      path: "expected.mutableRegionByteLength",
      message: `mutableRegionByteLength mismatch: expected ${expected.mutableRegionByteLength}, got ${decoded.mutableRegionByteLength}`,
    });
  }

  if (issues.length > 0) {
    return { ok: false, error: new HotByteCodecError(issues) };
  }

  return { ok: true, value: decoded };
}

function validateInput(input: HotBlockAHeaderInput): void {
  const issues: HotCodecIssue[] = [];

  if (input.contractKey.length === 0) {
    issues.push({
      code: "header.contractKeyEmpty",
      path: "input.contractKey",
      message: "contractKey must not be empty",
    });
  }

  if (input.instanceKey.length === 0) {
    issues.push({
      code: "header.instanceKeyEmpty",
      path: "input.instanceKey",
      message: "instanceKey must not be empty",
    });
  }

  if (input.semanticVersion < 0n || input.semanticVersion > 0xffff_ffff_ffff_ffffn) {
    issues.push({
      code: "header.semanticVersionOutOfRange",
      path: "input.semanticVersion",
      message: "semanticVersion must be a u64",
    });
  }

  if (input.hotLayoutVersion < 0n || input.hotLayoutVersion > 0xffff_ffff_ffff_ffffn) {
    issues.push({
      code: "header.hotLayoutVersionOutOfRange",
      path: "input.hotLayoutVersion",
      message: "hotLayoutVersion must be a u64",
    });
  }

  if (
    !Number.isSafeInteger(input.fieldCount) ||
    input.fieldCount < 0 ||
    input.fieldCount > 0xffff_ffff
  ) {
    issues.push({
      code: "header.fieldCountOutOfRange",
      path: "input.fieldCount",
      message: "fieldCount must be a u32",
    });
  }

  if (
    !Number.isSafeInteger(input.mutableRegionByteLength) ||
    input.mutableRegionByteLength < 0 ||
    input.mutableRegionByteLength > 0xffff_ffff
  ) {
    issues.push({
      code: "header.mutableRegionByteLengthOutOfRange",
      path: "input.mutableRegionByteLength",
      message: "mutableRegionByteLength must be a u32",
    });
  }

  if (issues.length > 0) {
    throw new HotByteCodecError(issues);
  }
}

function hashKey(key: string): Uint8Array {
  return createHash("sha256").update(key, "utf8").digest().subarray(0, 16);
}

function bytesToHex(bytes: Uint8Array): string {
  let hex = "";
  for (const byte of bytes) {
    hex += byte.toString(16).padStart(2, "0");
  }
  return hex;
}

function headerError(code: string, path: string, message: string): HotByteCodecError {
  return new HotByteCodecError([{ code, path, message }]);
}
