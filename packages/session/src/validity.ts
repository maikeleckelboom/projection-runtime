export type AuthorityKey = string;
export type SurfaceKey = string;
export type AuthorityEpoch = bigint;

export type InvalidationReason =
  | "authorityRestarted"
  | "authorityReplaced"
  | "surfaceReplaced"
  | "surfaceRevoked";

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

export type BindingOpeningFailure = {
  readonly ok: false;
  readonly reason: "bindingOpening";
  readonly rebindRequired: true;
  readonly binding: AuthorityBinding;
};

export type BindingInvalidatedFailure = {
  readonly ok: false;
  readonly reason: "bindingInvalidated";
  readonly rebindRequired: true;
  readonly binding: AuthorityBinding;
  readonly invalidationReason: InvalidationReason;
};

export type BindingClosedFailure = {
  readonly ok: false;
  readonly reason: "bindingClosed";
  readonly rebindRequired: false;
  readonly binding: AuthorityBinding;
};

export type BindingExpectationMismatchFailure = {
  readonly ok: false;
  readonly reason: "authorityKeyMismatch" | "surfaceKeyMismatch" | "authorityEpochMismatch";
  readonly rebindRequired: true;
  readonly binding: AuthorityBinding;
  readonly expected: BindingExpectation;
};

export type BindingValidityFailure =
  | BindingOpeningFailure
  | BindingInvalidatedFailure
  | BindingClosedFailure
  | BindingExpectationMismatchFailure;

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
    return { ok: false, reason: "bindingOpening", rebindRequired: true, binding };
  }

  if (state.kind === "invalidated") {
    return {
      ok: false,
      reason: "bindingInvalidated",
      rebindRequired: true,
      binding,
      invalidationReason: state.reason,
    };
  }

  if (state.kind === "closed") {
    return { ok: false, reason: "bindingClosed", rebindRequired: false, binding };
  }

  if (binding.authorityKey !== expected.authorityKey) {
    return {
      ok: false,
      reason: "authorityKeyMismatch",
      rebindRequired: true,
      binding,
      expected,
    };
  }

  if (binding.surfaceKey !== expected.surfaceKey) {
    return {
      ok: false,
      reason: "surfaceKeyMismatch",
      rebindRequired: true,
      binding,
      expected,
    };
  }

  if (binding.authorityEpoch !== expected.authorityEpoch) {
    return {
      ok: false,
      reason: "authorityEpochMismatch",
      rebindRequired: true,
      binding,
      expected,
    };
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
