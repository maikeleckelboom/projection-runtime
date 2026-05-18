export type AuthorityKey = string;
export type SurfaceKey = string;
export type AuthorityEpoch = bigint;
export type SessionHandleId = string;

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

export type AuthoritySessionDescriptor =
  | { readonly state: "starting"; readonly authorityEpoch: AuthorityEpoch }
  | { readonly state: "ready"; readonly authorityEpoch: AuthorityEpoch }
  | { readonly state: "stopping"; readonly authorityEpoch: AuthorityEpoch }
  | { readonly state: "stopped" };

export type SessionMismatchFailure = {
  readonly kind: "sessionMismatch";
  readonly expectedAuthorityEpoch: AuthorityEpoch;
  readonly providedAuthorityEpoch: AuthorityEpoch;
};

export type SessionHandleInvalidFailure = {
  readonly kind: "handleInvalid";
  readonly handleId: SessionHandleId;
  readonly reason: "revoked" | "expired" | "staleEpoch";
};

export type AuthorityUnavailableFailure = {
  readonly kind: "authorityUnavailable";
};

export type AuthorityNotReadyFailure = {
  readonly kind: "authorityNotReady";
  readonly state: "starting" | "stopping";
};

export type RequestIllegalByContractFailure = {
  readonly kind: "requestIllegalByContract";
  readonly detail: string;
};

export type RequestIllegalInCurrentProductStateFailure = {
  readonly kind: "requestIllegalInCurrentProductState";
  readonly detail: string;
};

export type SessionBoundFailure =
  | SessionMismatchFailure
  | SessionHandleInvalidFailure
  | AuthorityUnavailableFailure
  | AuthorityNotReadyFailure
  | RequestIllegalByContractFailure
  | RequestIllegalInCurrentProductStateFailure;

export type SessionInvalidationEvent =
  | {
      readonly kind: "authorityEpochReplaced";
      readonly replacedAuthorityEpoch: AuthorityEpoch;
      readonly replacingAuthorityEpoch: AuthorityEpoch;
    }
  | {
      readonly kind: "authorityUnavailable";
      readonly replacedAuthorityEpoch: AuthorityEpoch;
      readonly state: "stopping" | "stopped";
    }
  | {
      readonly kind: "resourceHandleInvalidated";
      readonly authorityEpoch: AuthorityEpoch;
      readonly handleId: SessionHandleId;
      readonly reason: "authorityRestart" | "resourceReplaced" | "revoked" | "expired";
    }
  | {
      readonly kind: "hotHandleInvalidated";
      readonly authorityEpoch: AuthorityEpoch;
      readonly handleId: SessionHandleId;
      readonly projectionInstanceKey: string;
      readonly reason: "authorityRestart" | "projectionReplaced" | "revoked";
    };

export type SessionStateEvent =
  | { readonly kind: "authorityReady"; readonly authorityEpoch: AuthorityEpoch }
  | { readonly kind: "authorityStarting"; readonly authorityEpoch: AuthorityEpoch };

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
