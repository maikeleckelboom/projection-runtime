import {
  assertCanonicalDecimalString,
  assertExactRootKeys,
  assertNonEmptyString,
  assertPlainObject,
  assertSafeNonNegativeInteger,
} from "./validation";

type LegacyResourceHandleKey = string;
export type ResourceKind = string;
export type ResourceVersion = string;

export type ResourceOwner = {
  readonly authorityKey: string;
  readonly surfaceKey: string;
  readonly authorityEpoch: string;
};

export type ResourceDescriptor = {
  readonly handleKey: LegacyResourceHandleKey;
  readonly kind: ResourceKind;
  readonly byteLength: number;
  readonly version: ResourceVersion;
  readonly owner: ResourceOwner;
};

export function validateResourceOwner(owner: unknown): ResourceOwner {
  const obj = assertPlainObject(owner, "owner");
  assertExactRootKeys(obj, new Set(["authorityKey", "surfaceKey", "authorityEpoch"]), "owner");

  const authorityKey = assertNonEmptyString(obj.authorityKey, "owner.authorityKey");
  const surfaceKey = assertNonEmptyString(obj.surfaceKey, "owner.surfaceKey");

  const authorityEpoch = assertCanonicalDecimalString(obj.authorityEpoch, "owner.authorityEpoch");

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
  readonly handleKey: LegacyResourceHandleKey;
  readonly kind: ResourceKind;
  readonly byteLength: number;
  readonly version: ResourceVersion;
  readonly owner: ResourceOwner;
}): ResourceDescriptor {
  return validateResourceDescriptor(input);
}
