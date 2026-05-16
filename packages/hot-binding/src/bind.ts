import {
  createHotBindingInputRejectedError,
  createHotBindingIssue,
  type HotBindingInputRejectedDetails,
  type HotBindingIssue,
} from "./error";

export type HotReadBindingInput = {
  readonly region: Uint8Array;
  readonly seqlockOffset: number;
  readonly totalRegionByteLength: number;
};

export type HotPublishBindingInput = {
  readonly region: Uint8Array;
  readonly seqlockOffset: number;
  readonly publicationSequenceOffset: number;
  readonly totalRegionByteLength: number;
};

export type HotReadBinding = {
  readonly region: Uint8Array;
  readonly seqlock: BigUint64Array;
};

export type HotPublishBinding = {
  readonly region: Uint8Array;
  readonly seqlock: BigUint64Array;
  readonly publicationSequence: BigUint64Array;
};

const U64_BYTE_LENGTH = BigUint64Array.BYTES_PER_ELEMENT;

export function bindHotReadRegion(input: HotReadBindingInput): HotReadBinding {
  const validated = validateHotReadBindingInput(input, "bindHotReadRegion");

  return {
    region: validated.region,
    seqlock: bindCounterView(validated.region, validated.seqlockOffset),
  };
}

export function bindHotPublishRegion(input: HotPublishBindingInput): HotPublishBinding {
  const validated = validateHotPublishBindingInput(input, "bindHotPublishRegion");

  return {
    region: validated.region,
    seqlock: bindCounterView(validated.region, validated.seqlockOffset),
    publicationSequence: bindCounterView(validated.region, validated.publicationSequenceOffset),
  };
}

function validateHotReadBindingInput(
  input: HotReadBindingInput,
  where: HotBindingInputRejectedDetails["where"],
): HotReadBindingInput {
  const issues: HotBindingIssue[] = [];

  if (!isRecord(input)) {
    throw createHotBindingInputRejectedError(where, [
      createHotBindingIssue("input.requestInvalid", "input"),
    ]);
  }

  const region = input.region;
  const totalRegionByteLength = input.totalRegionByteLength;
  const seqlockOffset = input.seqlockOffset;
  const hasValidRegion = validateRegion(region, issues);
  const hasValidTotalRegionByteLength = validateTotalRegionByteLength(
    totalRegionByteLength,
    issues,
  );
  const hasValidSeqlockOffset = validateCounterOffset(
    seqlockOffset,
    "input.seqlockOffset",
    "input.seqlockOffsetInvalid",
    issues,
  );

  if (hasValidRegion && hasValidTotalRegionByteLength) {
    validateRegionLength(region, totalRegionByteLength, issues);
  }

  if (hasValidRegion && hasValidTotalRegionByteLength && hasValidSeqlockOffset) {
    validateCounterRange(
      seqlockOffset,
      totalRegionByteLength,
      "input.seqlockOffset",
      "input.seqlockOffsetOutOfRange",
      issues,
    );
    validateCounterAlignment(
      region,
      seqlockOffset,
      "input.seqlockOffset",
      "input.seqlockOffsetMisaligned",
      issues,
    );
  }

  if (issues.length > 0) {
    throw createHotBindingInputRejectedError(where, issues);
  }

  return input;
}

function validateHotPublishBindingInput(
  input: HotPublishBindingInput,
  where: HotBindingInputRejectedDetails["where"],
): HotPublishBindingInput {
  const issues: HotBindingIssue[] = [];

  if (!isRecord(input)) {
    throw createHotBindingInputRejectedError(where, [
      createHotBindingIssue("input.requestInvalid", "input"),
    ]);
  }

  const region = input.region;
  const totalRegionByteLength = input.totalRegionByteLength;
  const seqlockOffset = input.seqlockOffset;
  const publicationSequenceOffset = input.publicationSequenceOffset;
  const hasValidRegion = validateRegion(region, issues);
  const hasValidTotalRegionByteLength = validateTotalRegionByteLength(
    totalRegionByteLength,
    issues,
  );
  const hasValidSeqlockOffset = validateCounterOffset(
    seqlockOffset,
    "input.seqlockOffset",
    "input.seqlockOffsetInvalid",
    issues,
  );
  const hasValidPublicationSequenceOffset = validateCounterOffset(
    publicationSequenceOffset,
    "input.publicationSequenceOffset",
    "input.publicationSequenceOffsetInvalid",
    issues,
  );
  let hasValidSeqlockRange = false;
  let hasValidPublicationSequenceRange = false;

  if (hasValidRegion && hasValidTotalRegionByteLength) {
    validateRegionLength(region, totalRegionByteLength, issues);
  }

  if (hasValidRegion && hasValidTotalRegionByteLength && hasValidSeqlockOffset) {
    hasValidSeqlockRange = validateCounterRange(
      seqlockOffset,
      totalRegionByteLength,
      "input.seqlockOffset",
      "input.seqlockOffsetOutOfRange",
      issues,
    );
    validateCounterAlignment(
      region,
      seqlockOffset,
      "input.seqlockOffset",
      "input.seqlockOffsetMisaligned",
      issues,
    );
  }

  if (hasValidRegion && hasValidTotalRegionByteLength && hasValidPublicationSequenceOffset) {
    hasValidPublicationSequenceRange = validateCounterRange(
      publicationSequenceOffset,
      totalRegionByteLength,
      "input.publicationSequenceOffset",
      "input.publicationSequenceOffsetOutOfRange",
      issues,
    );
    validateCounterAlignment(
      region,
      publicationSequenceOffset,
      "input.publicationSequenceOffset",
      "input.publicationSequenceOffsetMisaligned",
      issues,
    );
  }

  if (
    hasValidRegion &&
    hasValidSeqlockOffset &&
    hasValidPublicationSequenceOffset &&
    hasValidSeqlockRange &&
    hasValidPublicationSequenceRange &&
    counterRangesOverlap(region, seqlockOffset, publicationSequenceOffset)
  ) {
    issues.push(
      createHotBindingIssue("input.counterViewsOverlap", "input.publicationSequenceOffset"),
    );
  }

  if (issues.length > 0) {
    throw createHotBindingInputRejectedError(where, issues);
  }

  return input;
}

function validateRegion(value: unknown, issues: HotBindingIssue[]): value is Uint8Array {
  if (!(value instanceof Uint8Array)) {
    issues.push(createHotBindingIssue("input.regionViewInvalid", "input.region"));
    return false;
  }

  if (!(value.buffer instanceof SharedArrayBuffer)) {
    issues.push(createHotBindingIssue("input.regionBufferNotShared", "input.region"));
  }

  return true;
}

function validateTotalRegionByteLength(value: unknown, issues: HotBindingIssue[]): value is number {
  if (typeof value !== "number" || !Number.isSafeInteger(value) || value <= 0) {
    issues.push(
      createHotBindingIssue("input.totalRegionByteLengthInvalid", "input.totalRegionByteLength"),
    );
    return false;
  }

  return true;
}

function validateRegionLength(
  region: Uint8Array,
  totalRegionByteLength: number,
  issues: HotBindingIssue[],
): void {
  if (region.byteLength < totalRegionByteLength) {
    issues.push(createHotBindingIssue("input.regionViewTooShort", "input.region"));
  }
}

function validateCounterOffset(
  value: unknown,
  path: string,
  issueCode: "input.seqlockOffsetInvalid" | "input.publicationSequenceOffsetInvalid",
  issues: HotBindingIssue[],
): value is number {
  if (typeof value !== "number" || !Number.isSafeInteger(value) || value < 0) {
    issues.push(createHotBindingIssue(issueCode, path));
    return false;
  }

  return true;
}

function validateCounterRange(
  offset: number,
  totalRegionByteLength: number,
  path: string,
  issueCode: "input.seqlockOffsetOutOfRange" | "input.publicationSequenceOffsetOutOfRange",
  issues: HotBindingIssue[],
): boolean {
  const end = offset + U64_BYTE_LENGTH;
  if (!Number.isSafeInteger(end) || end > totalRegionByteLength) {
    issues.push(createHotBindingIssue(issueCode, path));
    return false;
  }

  return true;
}

function validateCounterAlignment(
  region: Uint8Array,
  offset: number,
  path: string,
  issueCode: "input.seqlockOffsetMisaligned" | "input.publicationSequenceOffsetMisaligned",
  issues: HotBindingIssue[],
): void {
  if ((region.byteOffset + offset) % U64_BYTE_LENGTH !== 0) {
    issues.push(createHotBindingIssue(issueCode, path));
  }
}

function counterRangesOverlap(
  region: Uint8Array,
  seqlockOffset: number,
  publicationSequenceOffset: number,
): boolean {
  const seqlockStart = region.byteOffset + seqlockOffset;
  const seqlockEnd = seqlockStart + U64_BYTE_LENGTH;
  const publicationSequenceStart = region.byteOffset + publicationSequenceOffset;
  const publicationSequenceEnd = publicationSequenceStart + U64_BYTE_LENGTH;

  return seqlockStart < publicationSequenceEnd && publicationSequenceStart < seqlockEnd;
}

function bindCounterView(region: Uint8Array, offset: number): BigUint64Array {
  return new BigUint64Array(region.buffer, region.byteOffset + offset, 1);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
