import type { AuthorityBinding } from "@exclave/session";
import { throwInputRejected } from "./errors";
import type { HostContractValidationResult } from "./host-failure";
import {
  assertCanonicalDecimalString,
  assertExactRootKeys,
  assertNonEmptyString,
  assertPlainObject,
  validationFailure,
  validationMessageFromError,
  validationSuccess,
} from "./validation";

export type HostAuthorityOwner = {
  readonly authorityKey: string;
  readonly surfaceKey: string;
  readonly authorityEpoch: string;
};

const OWNED_ROOT_KEYS: ReadonlySet<string> = new Set([
  "authorityKey",
  "surfaceKey",
  "authorityEpoch",
]);

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

  if (binding.authorityEpoch < 0n) {
    throwInputRejected("binding.authorityEpoch must be a non-negative bigint");
  }

  const authorityEpoch = String(binding.authorityEpoch);

  return validateHostAuthorityOwnerThrowing({
    authorityKey,
    surfaceKey,
    authorityEpoch,
  });
}

export function validateHostAuthorityOwnerThrowing(owner: unknown): HostAuthorityOwner {
  const obj = assertPlainObject(owner, "host authority owner");
  assertExactRootKeys(obj, OWNED_ROOT_KEYS, "host authority owner");

  const authorityKey = assertNonEmptyString(obj.authorityKey, "owner.authorityKey");
  const surfaceKey = assertNonEmptyString(obj.surfaceKey, "owner.surfaceKey");

  const authorityEpoch = assertCanonicalDecimalString(obj.authorityEpoch, "owner.authorityEpoch");

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
    const message = validationMessageFromError(error);
    const code: "host-contract.invalidDescriptor" = "host-contract.invalidDescriptor";
    return validationFailure(code, message);
  }
}
