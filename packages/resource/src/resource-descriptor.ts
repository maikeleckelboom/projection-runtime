import { checkJsonObjectRoot } from "@exclave/base";
import { throwInputRejected } from "./errors";

export type ResourceHandleKey = string;
export type ResourceKind = string;
export type ResourceVersion = string;

export type ResourceOwner = {
  readonly authorityKey: string;
  readonly surfaceKey: string;
  readonly authorityEpoch: string;
};

export type ResourceDescriptor = {
  readonly handleKey: ResourceHandleKey;
  readonly kind: ResourceKind;
  readonly byteLength: number;
  readonly version: ResourceVersion;
  readonly owner: ResourceOwner;
};

const CANONICAL_EPOCH_RE = /^(?:0|[1-9][0-9]*)$/;

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

export function validateResourceOwner(owner: unknown): ResourceOwner {
  const obj = assertPlainObject(owner, "owner");
  assertExactRootKeys(obj, new Set(["authorityKey", "surfaceKey", "authorityEpoch"]), "owner");

  const authorityKey = assertNonEmptyString(obj.authorityKey, "owner.authorityKey");
  const surfaceKey = assertNonEmptyString(obj.surfaceKey, "owner.surfaceKey");

  const authorityEpoch = obj.authorityEpoch;
  if (typeof authorityEpoch !== "string") {
    throwInputRejected("owner.authorityEpoch must be a string, not a number or bigint");
  }
  if (!CANONICAL_EPOCH_RE.test(authorityEpoch)) {
    throwInputRejected(
      'owner.authorityEpoch must be a canonical non-negative decimal string (e.g. "0", "42")',
    );
  }

  return {
    authorityKey,
    surfaceKey,
    authorityEpoch,
  };
}

export function validateResourceDescriptor(descriptor: unknown): ResourceDescriptor {
  const obj = assertPlainObject(descriptor, "resource descriptor");
  assertExactRootKeys(
    obj,
    new Set(["handleKey", "kind", "byteLength", "version", "owner"]),
    "resource descriptor",
  );

  const handleKey = assertNonEmptyString(obj.handleKey, "descriptor.handleKey");
  const kind = assertNonEmptyString(obj.kind, "descriptor.kind");
  const byteLength = assertSafeNonNegativeInteger(obj.byteLength, "descriptor.byteLength");
  const version = assertNonEmptyString(obj.version, "descriptor.version");

  const owner = validateResourceOwner(obj.owner);

  return {
    handleKey,
    kind,
    byteLength,
    version,
    owner,
  };
}

export function createResourceDescriptor(input: {
  readonly handleKey: ResourceHandleKey;
  readonly kind: ResourceKind;
  readonly byteLength: number;
  readonly version: ResourceVersion;
  readonly owner: ResourceOwner;
}): ResourceDescriptor {
  return validateResourceDescriptor(input);
}
