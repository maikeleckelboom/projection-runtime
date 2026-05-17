import { checkJsonObjectRoot, ExclaveError } from "@exclave/base";
import type { AuthorityBinding } from "@exclave/session";
import { throwInputRejected } from "./errors";
import type { HostContractFailure, HostContractValidationResult } from "./host-failure";

export type HostAuthorityOwner = {
  readonly authorityKey: string;
  readonly surfaceKey: string;
  readonly authorityEpoch: string;
};

const CANONICAL_EPOCH_RE = /^(?:0|[1-9][0-9]*)$/;

const OWNED_ROOT_KEYS: ReadonlySet<string> = new Set([
  "authorityKey",
  "surfaceKey",
  "authorityEpoch",
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

export function createHostAuthorityOwner(input: {
  readonly authorityKey: string;
  readonly surfaceKey: string;
  readonly authorityEpoch: string;
}): HostAuthorityOwner {
  return validateHostAuthorityOwnerThrowing(input);
}

export function createHostAuthorityOwnerFromBinding(binding: AuthorityBinding): HostAuthorityOwner {
  if (typeof binding !== "object" || binding === null) {
    throwInputRejected("authority binding must be a non-null object");
  }

  const authorityKey = binding.authorityKey;
  if (typeof authorityKey !== "string" || authorityKey.length === 0) {
    throwInputRejected("binding.authorityKey must be a non-empty string");
  }

  const surfaceKey = binding.surfaceKey;
  if (typeof surfaceKey !== "string" || surfaceKey.length === 0) {
    throwInputRejected("binding.surfaceKey must be a non-empty string");
  }

  if (typeof binding.authorityEpoch !== "bigint") {
    throwInputRejected("binding.authorityEpoch must be a bigint");
  }

  const authorityEpoch = String(binding.authorityEpoch);

  return {
    authorityKey,
    surfaceKey,
    authorityEpoch,
  };
}

export function validateHostAuthorityOwnerThrowing(owner: unknown): HostAuthorityOwner {
  const obj = assertPlainObject(owner, "host authority owner");
  assertExactRootKeys(obj, OWNED_ROOT_KEYS, "host authority owner");

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

export function validateHostAuthorityOwner(
  owner: unknown,
): HostContractValidationResult<HostAuthorityOwner> {
  try {
    return validationSuccess(validateHostAuthorityOwnerThrowing(owner));
  } catch (error) {
    const message =
      error instanceof ExclaveError && typeof error.details.detail === "string"
        ? error.details.detail
        : error instanceof Error
          ? error.message
          : "Unknown validation error";
    const code: "host-contract.rejected" = "host-contract.rejected";
    return validationFailure(code, message);
  }
}
