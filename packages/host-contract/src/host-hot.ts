import { checkJsonObjectRoot, ExclaveError } from "@exclave/base";
import { throwInputRejected } from "./errors";
import type { HostContractFailure, HostContractValidationResult } from "./host-failure";

export type HostHotBlockAExpectation = {
  readonly contractKey: string;
  readonly instanceKey: string;
  readonly semanticVersion: string;
  readonly hotLayoutVersion: string;
  readonly fieldCount: number;
  readonly mutableRegionByteLength: number;
};

export type HostHotRegionDescriptor = {
  readonly kind: "host.hotRegion";
  readonly hotRegionKey: string;
  readonly blockA: HostHotBlockAExpectation;
  readonly totalRegionByteLength: number;
  readonly seqlockOffset: number;
  readonly publicationSequenceOffset?: number;
};

const COUNTER_BYTE_LENGTH = 8;

const CANONICAL_EPOCH_RE = /^(?:0|[1-9][0-9]*)$/;

const BLOCK_A_OWNED_ROOT_KEYS: ReadonlySet<string> = new Set([
  "contractKey",
  "instanceKey",
  "semanticVersion",
  "hotLayoutVersion",
  "fieldCount",
  "mutableRegionByteLength",
]);

const HOT_REGION_OWNED_ROOT_KEYS: ReadonlySet<string> = new Set([
  "kind",
  "hotRegionKey",
  "blockA",
  "totalRegionByteLength",
  "seqlockOffset",
  "publicationSequenceOffset",
]);

function assertNonEmptyString(value: unknown, label: string): string {
  if (typeof value !== "string") {
    throwInputRejected(`${label} must be a string`);
  }
  if (value.length === 0) {
    throwInputRejected(`${label} must be a non-empty string`);
  }
  return value;
}

function assertPlainObject(value: unknown, label: string): Record<string, unknown> {
  const result = checkJsonObjectRoot(value);
  if (!result.ok) {
    throwInputRejected(`${label} is not a plain data object: ${result.reason}`);
  }
  return value as Record<string, unknown>;
}

function assertExactRootKeys(
  value: Record<string, unknown>,
  allowedKeys: ReadonlySet<string>,
  label: string,
): void {
  for (const key of Object.keys(value)) {
    if (!allowedKeys.has(key)) {
      throwInputRejected(`${label} must not have extra field: ${key}`);
    }
  }
}

function assertCanonicalDecimalString(value: unknown, label: string): string {
  if (typeof value !== "string") {
    throwInputRejected(`${label} must be a string, not a number or bigint`);
  }
  if (!CANONICAL_EPOCH_RE.test(value)) {
    throwInputRejected(`${label} must be a canonical non-negative decimal string (e.g. "0", "42")`);
  }
  return value;
}

function assertSafeNonNegativeInteger(value: unknown, label: string): number {
  if (typeof value !== "number") {
    throwInputRejected(`${label} must be a number`);
  }
  if (!Number.isFinite(value)) {
    throwInputRejected(`${label} must be a finite number`);
  }
  if (!Number.isSafeInteger(value)) {
    throwInputRejected(`${label} must be a safe integer`);
  }
  if (value < 0) {
    throwInputRejected(`${label} must be a non-negative integer`);
  }
  return value;
}

function assertSafePositiveInteger(value: unknown, label: string): number {
  const num = assertSafeNonNegativeInteger(value, label);
  if (num === 0) {
    throwInputRejected(`${label} must be a positive integer`);
  }
  return num;
}

function assertCounterOffsetAligned(offset: number, label: string): void {
  if (offset % COUNTER_BYTE_LENGTH !== 0) {
    throwInputRejected(`${label} must be a multiple of ${COUNTER_BYTE_LENGTH}`);
  }
}

function assertNoByteFields(
  value: Record<string, unknown>,
  forbiddenKeys: readonly string[],
  label: string,
): void {
  for (const key of forbiddenKeys) {
    if (key in value) {
      throwInputRejected(`${label} must not carry byte fields (${key})`);
    }
  }
}

function validationFailure(
  code: "host-contract.invalidDescriptor" | "host-contract.rejected",
  message: string,
): HostContractValidationResult<never> {
  return {
    ok: false as const,
    failure: { code, message } as HostContractFailure,
  };
}

function validationSuccess<T>(value: T): HostContractValidationResult<T> {
  return { ok: true as const, value };
}

function createHostHotBlockAExpectationThrowing(input: unknown): HostHotBlockAExpectation {
  const obj = assertPlainObject(input, "hot block A expectation");
  assertExactRootKeys(obj, BLOCK_A_OWNED_ROOT_KEYS, "hot block A expectation");

  const contractKey = assertNonEmptyString(obj.contractKey, "blockA.contractKey");
  const instanceKey = assertNonEmptyString(obj.instanceKey, "blockA.instanceKey");
  const semanticVersion = assertCanonicalDecimalString(
    obj.semanticVersion,
    "blockA.semanticVersion",
  );
  const hotLayoutVersion = assertCanonicalDecimalString(
    obj.hotLayoutVersion,
    "blockA.hotLayoutVersion",
  );
  const fieldCount = assertSafeNonNegativeInteger(obj.fieldCount, "blockA.fieldCount");
  const mutableRegionByteLength = assertSafeNonNegativeInteger(
    obj.mutableRegionByteLength,
    "blockA.mutableRegionByteLength",
  );

  assertNoByteFields(obj, ["bytes", "buffer", "data", "region", "view"], "blockA");

  return {
    contractKey,
    instanceKey,
    semanticVersion,
    hotLayoutVersion,
    fieldCount,
    mutableRegionByteLength,
  };
}

export function createHostHotRegionDescriptorThrowing(input: unknown): HostHotRegionDescriptor {
  const obj = assertPlainObject(input, "host hot region descriptor");
  assertExactRootKeys(obj, HOT_REGION_OWNED_ROOT_KEYS, "host hot region descriptor");

  if (obj.kind !== "host.hotRegion") {
    throwInputRejected(
      `host hot region descriptor kind must be "host.hotRegion", got ${JSON.stringify(obj.kind)}`,
    );
  }

  const hotRegionKey = assertNonEmptyString(obj.hotRegionKey, "hotRegion.hotRegionKey");

  const blockA = createHostHotBlockAExpectationThrowing(obj.blockA);

  const totalRegionByteLength = assertSafePositiveInteger(
    obj.totalRegionByteLength,
    "hotRegion.totalRegionByteLength",
  );
  const seqlockOffset = assertSafeNonNegativeInteger(obj.seqlockOffset, "hotRegion.seqlockOffset");
  assertCounterOffsetAligned(seqlockOffset, "hotRegion.seqlockOffset");

  if (seqlockOffset > Number.MAX_SAFE_INTEGER - COUNTER_BYTE_LENGTH) {
    throwInputRejected("hotRegion.seqlockOffset arithmetic overflow");
  }
  if (seqlockOffset + COUNTER_BYTE_LENGTH > totalRegionByteLength) {
    throwInputRejected(
      "hotRegion.seqlockOffset must leave room for an 8-byte counter within totalRegionByteLength",
    );
  }

  let publicationSequenceOffset: number | undefined;
  if (obj.publicationSequenceOffset !== undefined) {
    publicationSequenceOffset = assertSafeNonNegativeInteger(
      obj.publicationSequenceOffset,
      "hotRegion.publicationSequenceOffset",
    );
    assertCounterOffsetAligned(publicationSequenceOffset, "hotRegion.publicationSequenceOffset");
    if (publicationSequenceOffset > Number.MAX_SAFE_INTEGER - COUNTER_BYTE_LENGTH) {
      throwInputRejected("hotRegion.publicationSequenceOffset arithmetic overflow");
    }
    if (publicationSequenceOffset + COUNTER_BYTE_LENGTH > totalRegionByteLength) {
      throwInputRejected(
        "hotRegion.publicationSequenceOffset must leave room for an 8-byte counter within totalRegionByteLength",
      );
    }
    if (
      seqlockOffset < publicationSequenceOffset + COUNTER_BYTE_LENGTH &&
      publicationSequenceOffset < seqlockOffset + COUNTER_BYTE_LENGTH
    ) {
      throwInputRejected(
        "hotRegion.seqlockOffset and publicationSequenceOffset 8-byte counter ranges must not overlap",
      );
    }
  }

  assertNoByteFields(obj, ["bytes", "buffer", "data", "region", "view"], "hotRegion");

  return {
    kind: "host.hotRegion",
    hotRegionKey,
    blockA,
    totalRegionByteLength,
    seqlockOffset,
    ...(publicationSequenceOffset !== undefined ? { publicationSequenceOffset } : {}),
  };
}

export function createHostHotRegionDescriptor(
  input: HostHotRegionDescriptor,
): HostHotRegionDescriptor {
  return createHostHotRegionDescriptorThrowing(input);
}

export function validateHostHotRegionDescriptor(
  value: unknown,
): HostContractValidationResult<HostHotRegionDescriptor> {
  try {
    return validationSuccess(createHostHotRegionDescriptorThrowing(value));
  } catch (error) {
    const message =
      error instanceof ExclaveError && typeof error.details.detail === "string"
        ? error.details.detail
        : error instanceof Error
          ? error.message
          : "Unknown validation error";
    const code: "host-contract.invalidDescriptor" = "host-contract.invalidDescriptor";
    return validationFailure(code, message);
  }
}
