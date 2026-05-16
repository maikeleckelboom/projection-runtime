export type AuthorityKey = string;
export type SurfaceKey = string;
export type AuthorityEpoch = bigint;

export type InvalidationReason =
  | "authorityRestarted"
  | "authorityReplaced"
  | "surfaceReplaced"
  | "surfaceRevoked"
  | "bindingClosed";

export type BindingState =
  | { readonly kind: "opening" }
  | { readonly kind: "ready" }
  | { readonly kind: "invalidated"; readonly reason: InvalidationReason }
  | { readonly kind: "closed" };

export type AuthorityBinding = {
  readonly authorityKey: AuthorityKey;
  readonly surfaceKey: SurfaceKey;
  readonly authorityEpoch: AuthorityEpoch;
  readonly state: BindingState;
};

export type BindingExpectation = {
  readonly authorityKey: AuthorityKey;
  readonly surfaceKey: SurfaceKey;
  readonly authorityEpoch: AuthorityEpoch;
};

export type BindingValidityFailure = {
  readonly ok: false;
  readonly reason:
    | "bindingOpening"
    | "bindingInvalidated"
    | "bindingClosed"
    | "authorityKeyMismatch"
    | "surfaceKeyMismatch"
    | "authorityEpochMismatch";
  readonly rebindRequired: boolean;
  readonly binding: AuthorityBinding;
  readonly expected?: BindingExpectation;
  readonly invalidationReason?: InvalidationReason;
};

export type BindingValidity =
  | { readonly ok: true; readonly binding: AuthorityBinding }
  | BindingValidityFailure;

export type GuardResult<T> = { readonly ok: true; readonly value: T } | BindingValidityFailure;

export function createAuthorityBinding(input: {
  readonly authorityKey: AuthorityKey;
  readonly surfaceKey: SurfaceKey;
  readonly authorityEpoch: AuthorityEpoch;
}): AuthorityBinding {
  return {
    authorityKey: input.authorityKey,
    surfaceKey: input.surfaceKey,
    authorityEpoch: input.authorityEpoch,
    state: { kind: "opening" },
  };
}

export function markAuthorityBindingReady(binding: AuthorityBinding): AuthorityBinding {
  return { ...binding, state: { kind: "ready" } as const };
}

export function invalidateAuthorityBinding(
  binding: AuthorityBinding,
  reason: InvalidationReason,
): AuthorityBinding {
  return {
    ...binding,
    state: { kind: "invalidated", reason } as const,
  };
}

export function closeAuthorityBinding(binding: AuthorityBinding): AuthorityBinding {
  return { ...binding, state: { kind: "closed" } as const };
}

export function validateAuthorityBinding(
  binding: AuthorityBinding,
  expected: BindingExpectation,
): BindingValidity {
  const state = binding.state;

  if (state.kind === "opening") {
    return createFailure("bindingOpening", true, binding);
  }

  if (state.kind === "invalidated") {
    return createInvalidatedFailure(binding, state.reason);
  }

  if (state.kind === "closed") {
    return createFailure("bindingClosed", false, binding);
  }

  if (binding.authorityKey !== expected.authorityKey) {
    return createMismatchFailure("authorityKeyMismatch", binding, expected);
  }

  if (binding.surfaceKey !== expected.surfaceKey) {
    return createMismatchFailure("surfaceKeyMismatch", binding, expected);
  }

  if (binding.authorityEpoch !== expected.authorityEpoch) {
    return createMismatchFailure("authorityEpochMismatch", binding, expected);
  }

  return { ok: true, binding };
}

export function guardAuthorityBinding<T>(
  binding: AuthorityBinding,
  expected: BindingExpectation,
  read: () => T,
): GuardResult<T> {
  const validity = validateAuthorityBinding(binding, expected);

  if (validity.ok) {
    return { ok: true, value: read() };
  }

  return validity;
}

function createFailure(
  reason: BindingValidityFailure["reason"],
  rebindRequired: boolean,
  binding: AuthorityBinding,
): BindingValidityFailure {
  return { ok: false, reason, rebindRequired, binding };
}

function createInvalidatedFailure(
  binding: AuthorityBinding,
  invalidationReason: InvalidationReason,
): BindingValidityFailure {
  return {
    ok: false,
    reason: "bindingInvalidated",
    rebindRequired: true,
    binding,
    invalidationReason,
  };
}

function createMismatchFailure(
  reason: "authorityKeyMismatch" | "surfaceKeyMismatch" | "authorityEpochMismatch",
  binding: AuthorityBinding,
  expected: BindingExpectation,
): BindingValidityFailure {
  return { ok: false, reason, rebindRequired: true, binding, expected };
}
