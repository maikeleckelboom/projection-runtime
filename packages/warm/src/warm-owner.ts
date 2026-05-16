import { checkJsonObjectRoot } from "@exclave/base";
import { throwInputRejected } from "./errors";

export type WarmOwner = {
  readonly authorityKey: string;
  readonly surfaceKey: string;
  readonly authorityEpoch: string;
};

const CANONICAL_EPOCH_RE = /^(?:0|[1-9][0-9]*)$/;

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

export function validateWarmOwner(owner: unknown): WarmOwner {
  const obj = assertPlainObject(owner, "warm owner");
  assertExactRootKeys(obj, new Set(["authorityKey", "surfaceKey", "authorityEpoch"]), "warm owner");

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

export function createWarmOwner(input: {
  readonly authorityKey: string;
  readonly surfaceKey: string;
  readonly authorityEpoch: string;
}): WarmOwner {
  return validateWarmOwner(input);
}
