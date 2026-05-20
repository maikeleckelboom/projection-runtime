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

export type HostAuthorityRef = {
  readonly authorityKey: string;
  readonly grantKey: string;
  readonly authorityEpoch: string;
};

const AUTHORITY_REF_ROOT_KEYS: ReadonlySet<string> = new Set([
  "authorityKey",
  "grantKey",
  "authorityEpoch",
]);

export function createHostAuthorityRef(input: {
  readonly authorityKey: string;
  readonly grantKey: string;
  readonly authorityEpoch: string;
}): HostAuthorityRef {
  return validateHostAuthorityRefThrowing(input);
}

export function createHostAuthorityRefFromBinding(binding: AuthorityBinding): HostAuthorityRef {
  if (typeof binding !== "object" || binding === null) {
    throwInputRejected("authority binding must be a non-null object");
  }

  const authorityKey = binding.authorityKey;
  if (typeof authorityKey !== "string" || authorityKey.length === 0) {
    throwInputRejected("binding.authorityKey must be a non-empty string");
  }

  const grantKey = binding.grantKey;
  if (typeof grantKey !== "string" || grantKey.length === 0) {
    throwInputRejected("binding.grantKey must be a non-empty string");
  }

  if (typeof binding.authorityEpoch !== "bigint") {
    throwInputRejected("binding.authorityEpoch must be a bigint");
  }

  if (binding.authorityEpoch < 0n) {
    throwInputRejected("binding.authorityEpoch must be a non-negative bigint");
  }

  const authorityEpoch = String(binding.authorityEpoch);

  return validateHostAuthorityRefThrowing({
    authorityKey,
    grantKey,
    authorityEpoch,
  });
}

export function validateHostAuthorityRefThrowing(authority: unknown): HostAuthorityRef {
  const obj = assertPlainObject(authority, "host authority reference");
  assertExactRootKeys(obj, AUTHORITY_REF_ROOT_KEYS, "host authority reference");

  const authorityKey = assertNonEmptyString(obj.authorityKey, "authority.authorityKey");
  const grantKey = assertNonEmptyString(obj.grantKey, "authority.grantKey");

  const authorityEpoch = assertCanonicalDecimalString(
    obj.authorityEpoch,
    "authority.authorityEpoch",
  );

  return {
    authorityKey,
    grantKey,
    authorityEpoch,
  };
}

export function validateHostAuthorityRef(
  authority: unknown,
): HostContractValidationResult<HostAuthorityRef> {
  try {
    return validationSuccess(validateHostAuthorityRefThrowing(authority));
  } catch (error) {
    const message = validationMessageFromError(error);
    const code: "host-contract.invalidDescriptor" = "host-contract.invalidDescriptor";
    return validationFailure(code, message);
  }
}
