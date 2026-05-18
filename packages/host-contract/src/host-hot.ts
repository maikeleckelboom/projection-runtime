import { throwInputRejected } from "./errors";
import type { HostContractValidationResult } from "./host-failure";
import {
  assertCanonicalDecimalString,
  assertExactRootKeys,
  assertNonEmptyString,
  assertPlainObject,
  assertSafeNonNegativeInteger,
  assertSafePositiveInteger,
  validationFailure,
  validationMessageFromError,
  validationSuccess,
} from "./validation";

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
    const message = validationMessageFromError(error);
    const code: "host-contract.invalidDescriptor" = "host-contract.invalidDescriptor";
    return validationFailure(code, message);
  }
}
