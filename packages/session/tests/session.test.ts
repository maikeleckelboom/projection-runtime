import { describe, expect, expectTypeOf, it, vi } from "vitest";

import * as session from "../src/index";
import {
  type AuthorityBinding,
  type BindingExpectation,
  closeAuthorityBinding,
  createAuthorityBinding,
  guardAuthorityBinding,
  type InvalidationReason,
  invalidateAuthorityBinding,
  markAuthorityBindingReady,
  validateAuthorityBinding,
} from "../src/index";

const TEST_AUTHORITY_KEY = "test-authority";
const TEST_GRANT_KEY = "test-grant";
const TEST_EPOCH = 1n;

const AUTHORITY_KEY_A = "authority-alpha";
const AUTHORITY_KEY_B = "authority-beta";
const GRANT_KEY_A = "grant-alpha";
const GRANT_KEY_B = "grant-beta";
const EPOCH_1 = 1n;
const EPOCH_2 = 2n;

describe("@exclave/session public exports", () => {
  it("exports the intended type surface", () => {
    expectTypeOf<session.AuthorityKey>().toEqualTypeOf<string>();
    expectTypeOf<session.GrantKey>().toEqualTypeOf<string>();
    expectTypeOf<session.AuthorityEpoch>().toEqualTypeOf<bigint>();
    expectTypeOf<session.InvalidationReason>().toEqualTypeOf<
      "authorityRestarted" | "authorityReplaced" | "grantReplaced" | "grantRevoked"
    >();
    expectTypeOf<session.BindingState>().toEqualTypeOf<
      | { readonly kind: "opening" }
      | { readonly kind: "ready" }
      | { readonly kind: "invalidated"; readonly reason: InvalidationReason }
      | { readonly kind: "closed" }
    >();
  });

  it("SessionInvalidationEvent is authority-only, not resource or hot handle events", () => {
    expectTypeOf<session.SessionInvalidationEvent>().toEqualTypeOf<
      | {
          readonly kind: "authorityEpochReplaced";
          readonly replacedAuthorityEpoch: bigint;
          readonly replacingAuthorityEpoch: bigint;
        }
      | {
          readonly kind: "authorityUnavailable";
          readonly replacedAuthorityEpoch: bigint;
          readonly state: "stopping" | "stopped";
        }
    >();
  });

  it("SessionBoundFailure does not include handleInvalid", () => {
    expectTypeOf<session.SessionBoundFailure>().toEqualTypeOf<
      | {
          readonly kind: "sessionMismatch";
          readonly expectedAuthorityEpoch: bigint;
          readonly providedAuthorityEpoch: bigint;
        }
      | { readonly kind: "authorityUnavailable" }
      | { readonly kind: "authorityNotReady"; readonly state: "starting" | "stopping" }
      | { readonly kind: "requestIllegalByContract"; readonly detail: string }
      | { readonly kind: "requestIllegalInCurrentProductState"; readonly detail: string }
    >();
  });

  it("exports discriminated failure types", () => {
    expectTypeOf<session.BindingOpeningFailure>().toMatchTypeOf<session.BindingValidityFailure>();
    expectTypeOf<session.BindingInvalidatedFailure>().toMatchTypeOf<session.BindingValidityFailure>();
    expectTypeOf<session.BindingClosedFailure>().toMatchTypeOf<session.BindingValidityFailure>();
    expectTypeOf<session.BindingExpectationMismatchFailure>().toMatchTypeOf<session.BindingValidityFailure>();
  });

  it("exports the intended function surface", () => {
    expect(typeof session.createAuthorityBinding).toBe("function");
    expect(typeof session.markAuthorityBindingReady).toBe("function");
    expect(typeof session.invalidateAuthorityBinding).toBe("function");
    expect(typeof session.closeAuthorityBinding).toBe("function");
    expect(typeof session.validateAuthorityBinding).toBe("function");
    expect(typeof session.guardAuthorityBinding).toBe("function");
  });
});

describe("createAuthorityBinding", () => {
  it("creates a binding with kind opening", () => {
    const binding = createAuthorityBinding({
      authorityKey: TEST_AUTHORITY_KEY,
      grantKey: TEST_GRANT_KEY,
      authorityEpoch: TEST_EPOCH,
    });

    expect(binding.authorityKey).toBe(TEST_AUTHORITY_KEY);
    expect(binding.grantKey).toBe(TEST_GRANT_KEY);
    expect(binding.authorityEpoch).toBe(TEST_EPOCH);
    expect(binding.state).toEqual({ kind: "opening" });
  });
});

describe("markAuthorityBindingReady", () => {
  it("returns a new binding with kind ready", () => {
    const binding = createAuthorityBinding({
      authorityKey: TEST_AUTHORITY_KEY,
      grantKey: TEST_GRANT_KEY,
      authorityEpoch: TEST_EPOCH,
    });
    const ready = markAuthorityBindingReady(binding);

    expect(ready.authorityKey).toBe(TEST_AUTHORITY_KEY);
    expect(ready.grantKey).toBe(TEST_GRANT_KEY);
    expect(ready.authorityEpoch).toBe(TEST_EPOCH);
    expect(ready.state).toEqual({ kind: "ready" });
  });

  it("does not mutate the original binding", () => {
    const binding = createAuthorityBinding({
      authorityKey: TEST_AUTHORITY_KEY,
      grantKey: TEST_GRANT_KEY,
      authorityEpoch: TEST_EPOCH,
    });

    markAuthorityBindingReady(binding);

    expect(binding.state).toEqual({ kind: "opening" });
  });
});

describe("invalidateAuthorityBinding", () => {
  it("returns a new binding with kind invalidated and the given reason", () => {
    const binding = createReadyBinding();
    const invalidated = invalidateAuthorityBinding(binding, "authorityRestarted");

    expect(invalidated.authorityKey).toBe(AUTHORITY_KEY_A);
    expect(invalidated.grantKey).toBe(GRANT_KEY_A);
    expect(invalidated.authorityEpoch).toBe(EPOCH_1);
    expect(invalidated.state).toEqual({
      kind: "invalidated",
      reason: "authorityRestarted",
    });
  });

  it("preserves other fields unchanged", () => {
    const binding = createReadyBinding();
    const invalidated = invalidateAuthorityBinding(binding, "authorityReplaced");

    expect(invalidated.authorityKey).toBe(binding.authorityKey);
    expect(invalidated.grantKey).toBe(binding.grantKey);
    expect(invalidated.authorityEpoch).toBe(binding.authorityEpoch);
  });

  it("does not mutate the original binding", () => {
    const binding = createReadyBinding();

    invalidateAuthorityBinding(binding, "authorityRestarted");

    expect(binding.state).toEqual({ kind: "ready" });
  });

  it("accepts each invalidation reason", () => {
    const binding = createReadyBinding();
    const reasons: InvalidationReason[] = [
      "authorityRestarted",
      "authorityReplaced",
      "grantReplaced",
      "grantRevoked",
    ];

    for (const reason of reasons) {
      const invalidated = invalidateAuthorityBinding(binding, reason);
      expect(invalidated.state).toEqual({ kind: "invalidated", reason });
    }
  });
});

describe("closeAuthorityBinding", () => {
  it("returns a new binding with kind closed", () => {
    const binding = createReadyBinding();
    const closed = closeAuthorityBinding(binding);

    expect(closed.authorityKey).toBe(AUTHORITY_KEY_A);
    expect(closed.grantKey).toBe(GRANT_KEY_A);
    expect(closed.authorityEpoch).toBe(EPOCH_1);
    expect(closed.state).toEqual({ kind: "closed" });
  });

  it("does not mutate the original binding", () => {
    const binding = createReadyBinding();

    closeAuthorityBinding(binding);

    expect(binding.state).toEqual({ kind: "ready" });
  });
});

describe("helper immutability", () => {
  it("all helpers return new objects without mutating the original", () => {
    const original = createAuthorityBinding({
      authorityKey: TEST_AUTHORITY_KEY,
      grantKey: TEST_GRANT_KEY,
      authorityEpoch: TEST_EPOCH,
    });

    const ready = markAuthorityBindingReady(original);
    const invalidated = invalidateAuthorityBinding(ready, "grantRevoked");
    const closed = closeAuthorityBinding(invalidated);

    expect(original.state).toEqual({ kind: "opening" });
    expect(ready.state).toEqual({ kind: "ready" });
    expect(invalidated.state).toEqual({
      kind: "invalidated",
      reason: "grantRevoked",
    });
    expect(closed.state).toEqual({ kind: "closed" });

    expect(original).not.toBe(ready);
    expect(ready).not.toBe(invalidated);
    expect(invalidated).not.toBe(closed);
  });
});

describe("validateAuthorityBinding", () => {
  it("returns ok for a ready binding with matching expectations", () => {
    const binding = createReadyBinding();
    const expected = createMatchingExpectation();
    const result = validateAuthorityBinding(binding, expected);

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.binding).toBe(binding);
    }
  });

  it("rejects opening binding with bindingOpening and rebindRequired true", () => {
    const binding = createAuthorityBinding({
      authorityKey: AUTHORITY_KEY_A,
      grantKey: GRANT_KEY_A,
      authorityEpoch: EPOCH_1,
    });
    const expected = createMatchingExpectation();
    const result = validateAuthorityBinding(binding, expected);

    expect(result).toMatchObject({
      ok: false,
      reason: "bindingOpening",
      rebindRequired: true,
    });
  });

  it("rejects invalidated binding with bindingInvalidated, rebindRequired true, and carries reason", () => {
    const binding = invalidateAuthorityBinding(createReadyBinding(), "authorityRestarted");
    const expected = createMatchingExpectation();
    const result = validateAuthorityBinding(binding, expected);

    expect(result).toMatchObject({
      ok: false,
      reason: "bindingInvalidated",
      rebindRequired: true,
    });
    if (!result.ok && result.reason === "bindingInvalidated") {
      expect(result.invalidationReason).toBe("authorityRestarted");
    }
  });

  it("rejects closed binding with bindingClosed and rebindRequired false", () => {
    const binding = closeAuthorityBinding(createReadyBinding());
    const expected = createMatchingExpectation();
    const result = validateAuthorityBinding(binding, expected);

    expect(result).toMatchObject({
      ok: false,
      reason: "bindingClosed",
      rebindRequired: false,
    });
  });

  it("rejects authorityKey mismatch", () => {
    const binding = createReadyBinding({ authorityKey: AUTHORITY_KEY_A });
    const expected = createMatchingExpectation({ authorityKey: AUTHORITY_KEY_B });
    const result = validateAuthorityBinding(binding, expected);

    expect(result).toMatchObject({
      ok: false,
      reason: "authorityKeyMismatch",
      rebindRequired: true,
    });
    if (!result.ok && result.reason === "authorityKeyMismatch") {
      expect(result.expected).toEqual(expected);
    }
  });

  it("rejects grantKey mismatch", () => {
    const binding = createReadyBinding({ grantKey: GRANT_KEY_A });
    const expected = createMatchingExpectation({ grantKey: GRANT_KEY_B });
    const result = validateAuthorityBinding(binding, expected);

    expect(result).toMatchObject({
      ok: false,
      reason: "grantKeyMismatch",
      rebindRequired: true,
    });
    if (!result.ok && result.reason === "grantKeyMismatch") {
      expect(result.expected).toEqual(expected);
    }
  });

  it("rejects authorityEpoch mismatch", () => {
    const binding = createReadyBinding({ authorityEpoch: EPOCH_1 });
    const expected = createMatchingExpectation({ authorityEpoch: EPOCH_2 });
    const result = validateAuthorityBinding(binding, expected);

    expect(result).toMatchObject({
      ok: false,
      reason: "authorityEpochMismatch",
      rebindRequired: true,
    });
    if (!result.ok && result.reason === "authorityEpochMismatch") {
      expect(result.expected).toEqual(expected);
    }
  });

  it("reports first mismatch only (authorityKey checked before grantKey before epoch)", () => {
    const binding = createReadyBinding({
      authorityKey: AUTHORITY_KEY_A,
      grantKey: GRANT_KEY_A,
      authorityEpoch: EPOCH_1,
    });
    const expected = createMatchingExpectation({
      authorityKey: AUTHORITY_KEY_B,
      grantKey: GRANT_KEY_B,
      authorityEpoch: EPOCH_2,
    });
    const result = validateAuthorityBinding(binding, expected);

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.reason).toBe("authorityKeyMismatch");
    }
  });
});

describe("state-first precedence", () => {
  it("opening binding fails before expectation check (even when all expectations match)", () => {
    const binding = createAuthorityBinding({
      authorityKey: AUTHORITY_KEY_A,
      grantKey: GRANT_KEY_A,
      authorityEpoch: EPOCH_1,
    });
    const expected = createMatchingExpectation();
    const result = validateAuthorityBinding(binding, expected);

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.reason).toBe("bindingOpening");
    }
  });

  it("invalidated binding fails before expectation check (even when all expectations match)", () => {
    const binding = invalidateAuthorityBinding(createReadyBinding(), "authorityRestarted");
    const expected = createMatchingExpectation();
    const result = validateAuthorityBinding(binding, expected);

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.reason).toBe("bindingInvalidated");
    }
  });

  it("closed binding fails before expectation check (even when all expectations match)", () => {
    const binding = closeAuthorityBinding(createReadyBinding());
    const expected = createMatchingExpectation();
    const result = validateAuthorityBinding(binding, expected);

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.reason).toBe("bindingClosed");
    }
  });
});

describe("guardAuthorityBinding", () => {
  it("calls read for a ready binding and returns the value", () => {
    const binding = createReadyBinding();
    const expected = createMatchingExpectation();
    const read = vi.fn(() => 42);

    const result = guardAuthorityBinding(binding, expected, read);

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value).toBe(42);
    }
    expect(read).toHaveBeenCalledTimes(1);
  });

  it("does not call read for opening binding", () => {
    const binding = createAuthorityBinding({
      authorityKey: AUTHORITY_KEY_A,
      grantKey: GRANT_KEY_A,
      authorityEpoch: EPOCH_1,
    });
    const expected = createMatchingExpectation();
    const read = vi.fn(() => "should not be called");

    const result = guardAuthorityBinding(binding, expected, read);

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.reason).toBe("bindingOpening");
      expect(result.rebindRequired).toBe(true);
    }
    expect(read).not.toHaveBeenCalled();
  });

  it("does not call read for invalidated binding", () => {
    const binding = invalidateAuthorityBinding(createReadyBinding(), "authorityRestarted");
    const expected = createMatchingExpectation();
    const read = vi.fn(() => "should not be called");

    const result = guardAuthorityBinding(binding, expected, read);

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.reason).toBe("bindingInvalidated");
      expect(result.rebindRequired).toBe(true);
    }
    if (!result.ok && result.reason === "bindingInvalidated") {
      expect(result.invalidationReason).toBe("authorityRestarted");
    }
    expect(read).not.toHaveBeenCalled();
  });

  it("does not call read for closed binding", () => {
    const binding = closeAuthorityBinding(createReadyBinding());
    const expected = createMatchingExpectation();
    const read = vi.fn(() => "should not be called");

    const result = guardAuthorityBinding(binding, expected, read);

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.reason).toBe("bindingClosed");
      expect(result.rebindRequired).toBe(false);
    }
    expect(read).not.toHaveBeenCalled();
  });

  it("does not call read for authorityKey mismatch", () => {
    const binding = createReadyBinding({ authorityKey: AUTHORITY_KEY_A });
    const expected = createMatchingExpectation({ authorityKey: AUTHORITY_KEY_B });
    const read = vi.fn(() => "should not be called");

    const result = guardAuthorityBinding(binding, expected, read);

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.reason).toBe("authorityKeyMismatch");
      expect(result.rebindRequired).toBe(true);
    }
    expect(read).not.toHaveBeenCalled();
  });

  it("does not call read for grantKey mismatch", () => {
    const binding = createReadyBinding({ grantKey: GRANT_KEY_A });
    const expected = createMatchingExpectation({ grantKey: GRANT_KEY_B });
    const read = vi.fn(() => "should not be called");

    const result = guardAuthorityBinding(binding, expected, read);

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.reason).toBe("grantKeyMismatch");
      expect(result.rebindRequired).toBe(true);
    }
    expect(read).not.toHaveBeenCalled();
  });

  it("does not call read for authorityEpoch mismatch", () => {
    const binding = createReadyBinding({ authorityEpoch: EPOCH_1 });
    const expected = createMatchingExpectation({ authorityEpoch: EPOCH_2 });
    const read = vi.fn(() => "should not be called");

    const result = guardAuthorityBinding(binding, expected, read);

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.reason).toBe("authorityEpochMismatch");
      expect(result.rebindRequired).toBe(true);
    }
    expect(read).not.toHaveBeenCalled();
  });
});

function createReadyBinding(overrides?: Partial<AuthorityBinding>): AuthorityBinding {
  return {
    authorityKey: AUTHORITY_KEY_A,
    grantKey: GRANT_KEY_A,
    authorityEpoch: EPOCH_1,
    state: { kind: "ready" },
    ...overrides,
  };
}

function createMatchingExpectation(overrides?: Partial<BindingExpectation>): BindingExpectation {
  return {
    authorityKey: AUTHORITY_KEY_A,
    grantKey: GRANT_KEY_A,
    authorityEpoch: EPOCH_1,
    ...overrides,
  };
}
