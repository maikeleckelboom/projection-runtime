import { checkJsonObjectRoot } from "@exclave/base";
import { throwInputRejected } from "./errors";
import type { ResourceOwner } from "./resource-descriptor";
import { validateResourceDescriptor, validateResourceOwner } from "./resource-descriptor";

export type ResourceReadRange = {
  readonly offset: number;
  readonly byteLength: number;
};

export type ResourceReadRangeRequestPayload = {
  readonly handleKey: string;
  readonly range: ResourceReadRange;
  readonly owner: ResourceOwner;
};

export type ResourceReadRangeReceiptPayload = {
  readonly handleKey: string;
  readonly range: ResourceReadRange;
  readonly byteLength: number;
  readonly version: string;
};

function assertSafeNonNegativeInteger(value: unknown, label: string): number {
  if (typeof value !== "number") {
    throwInputRejected(`${label} must be a number`);
  }
  if (!Number.isFinite(value)) {
    throwInputRejected(`${label} must not be Infinity or NaN`);
  }
  if (!Number.isInteger(value)) {
    throwInputRejected(`${label} must be an integer`);
  }
  if (value < 0) {
    throwInputRejected(`${label} must not be negative`);
  }
  if (value > Number.MAX_SAFE_INTEGER) {
    throwInputRejected(`${label} exceeds Number.MAX_SAFE_INTEGER`);
  }
  return value;
}

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

export function createResourceReadRange(input: {
  readonly offset: number;
  readonly byteLength: number;
}): ResourceReadRange {
  const obj = assertPlainObject(input, "read range");
  assertExactRootKeys(obj, new Set(["offset", "byteLength"]), "read range");

  const offset = assertSafeNonNegativeInteger(obj.offset, "range.offset");
  const byteLength = assertSafeNonNegativeInteger(obj.byteLength, "range.byteLength");

  return { offset, byteLength };
}

export function validateResourceReadRange(range: unknown, descriptor: unknown): ResourceReadRange {
  const validatedDescriptor = validateResourceDescriptor(descriptor);
  const r = createResourceReadRange(
    range as { readonly offset: number; readonly byteLength: number },
  );

  if (r.offset > Number.MAX_SAFE_INTEGER - r.byteLength) {
    throwInputRejected("range offset + byteLength would overflow Number.MAX_SAFE_INTEGER");
  }

  const end = r.offset + r.byteLength;

  if (end > validatedDescriptor.byteLength) {
    throwInputRejected(
      `range [${r.offset}, ${end}) exceeds descriptor byteLength ${validatedDescriptor.byteLength}`,
    );
  }

  return r;
}

export function createResourceReadRangeRequestPayload(input: {
  readonly handleKey: string;
  readonly range: ResourceReadRange;
  readonly owner: ResourceOwner;
}): ResourceReadRangeRequestPayload {
  const obj = assertPlainObject(input, "read range request payload");
  assertExactRootKeys(obj, new Set(["handleKey", "range", "owner"]), "read range request payload");

  const handleKey = assertNonEmptyString(obj.handleKey, "payload.handleKey");

  const range = createResourceReadRange(
    obj.range as { readonly offset: number; readonly byteLength: number },
  );

  const owner = validateResourceOwner(obj.owner);

  return { handleKey, range, owner };
}

export function validateResourceReadRangeRequestPayload(
  value: unknown,
): ResourceReadRangeRequestPayload {
  return createResourceReadRangeRequestPayload(
    value as {
      readonly handleKey: string;
      readonly range: ResourceReadRange;
      readonly owner: ResourceOwner;
    },
  );
}

export function createResourceReadRangeReceiptPayload(input: {
  readonly handleKey: string;
  readonly range: ResourceReadRange;
  readonly byteLength: number;
  readonly version: string;
}): ResourceReadRangeReceiptPayload {
  const obj = assertPlainObject(input, "read range receipt payload");
  assertExactRootKeys(
    obj,
    new Set(["handleKey", "range", "byteLength", "version"]),
    "read range receipt payload",
  );

  const handleKey = assertNonEmptyString(obj.handleKey, "receipt.handleKey");

  const range = createResourceReadRange(
    obj.range as { readonly offset: number; readonly byteLength: number },
  );

  const receiptByteLength = assertSafeNonNegativeInteger(obj.byteLength, "receipt.byteLength");

  if (receiptByteLength !== range.byteLength) {
    throwInputRejected(
      `receipt byteLength ${receiptByteLength} does not match range.byteLength ${range.byteLength}`,
    );
  }

  const version = assertNonEmptyString(obj.version, "receipt.version");

  assertNoByteFields(obj, "receipt");

  return { handleKey, range, byteLength: receiptByteLength, version };
}

export function validateResourceReadRangeReceiptPayload(
  value: unknown,
): ResourceReadRangeReceiptPayload {
  return createResourceReadRangeReceiptPayload(
    value as {
      readonly handleKey: string;
      readonly range: ResourceReadRange;
      readonly byteLength: number;
      readonly version: string;
    },
  );
}

const FORBIDDEN_BYTE_LIKE = [
  "bytes",
  "data",
  "buffer",
  "arrayBuffer",
  "sharedArrayBuffer",
  "uint8Array",
  "blob",
  "base64",
  "byteArray",
  "raw",
] as const;

function assertNoByteFields(obj: Record<string, unknown>, label: string): void {
  for (const key of Object.keys(obj)) {
    const lower = key.toLowerCase();
    for (const forbidden of FORBIDDEN_BYTE_LIKE) {
      if (lower === forbidden || lower.includes(forbidden)) {
        throwInputRejected(`${label} must not carry byte-like field: ${key}`);
      }
    }
  }
}
