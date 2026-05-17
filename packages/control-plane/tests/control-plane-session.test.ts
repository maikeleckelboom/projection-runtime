import {
  createAuthorityBinding,
  invalidateAuthorityBinding,
  markAuthorityBindingReady,
  validateAuthorityBinding,
} from "@exclave/session";
import { describe, expect, it } from "vitest";
import type { ControlFailure } from "../src/index";
import {
  createBindingInvalidControlFailure,
  createControlFailureEnvelope,
  validateControlResponseEnvelope,
} from "../src/index";

describe("@exclave/control-plane binding failure projection", () => {
  it("projects bindingInvalidated with invalidationReason", () => {
    const binding = createAuthorityBinding({
      authorityKey: "auth-1",
      surfaceKey: "surf-1",
      authorityEpoch: 42n,
    });
    const ready = markAuthorityBindingReady(binding);
    const invalid = invalidateAuthorityBinding(ready, "authorityRestarted");

    const validity = validateAuthorityBinding(invalid, {
      authorityKey: "auth-1",
      surfaceKey: "surf-1",
      authorityEpoch: 42n,
    });
    expect(validity.ok).toBe(false);
    if (validity.ok) return;

    const controlFailure: ControlFailure = createBindingInvalidControlFailure(validity);

    expect(controlFailure.code).toBe("control.bindingInvalid");
    expect(controlFailure.details).toBeDefined();
    if (controlFailure.details === undefined) return;
    expect(controlFailure.details.reason).toBe("bindingInvalidated");
    expect(controlFailure.details.rebindRequired).toBe(true);
    expect(controlFailure.details.invalidationReason).toBe("authorityRestarted");
  });

  it("projects authorityEpochMismatch with expected", () => {
    const binding = createAuthorityBinding({
      authorityKey: "auth-1",
      surfaceKey: "surf-1",
      authorityEpoch: 1n,
    });
    const ready = markAuthorityBindingReady(binding);

    const validity = validateAuthorityBinding(ready, {
      authorityKey: "auth-1",
      surfaceKey: "surf-1",
      authorityEpoch: 2n,
    });
    expect(validity.ok).toBe(false);
    if (validity.ok) return;

    const controlFailure: ControlFailure = createBindingInvalidControlFailure(validity);

    expect(controlFailure.code).toBe("control.bindingInvalid");
    expect(controlFailure.details).toBeDefined();
    if (controlFailure.details === undefined) return;
    const d = controlFailure.details as unknown as Record<string, unknown>;
    expect(d.reason).toBe("authorityEpochMismatch");
    expect(d.rebindRequired).toBe(true);
    expect(d.expected).toBeDefined();
    if (d.expected === undefined || d.expected === null) return;
    const expected = d.expected as Record<string, unknown>;
    expect(expected.authorityKey).toBe("auth-1");
    expect(expected.surfaceKey).toBe("surf-1");
    expect(expected.authorityEpoch).toBe("2");
  });

  it("projects authorityEpoch values as decimal strings", () => {
    const binding = createAuthorityBinding({
      authorityKey: "ak",
      surfaceKey: "sk",
      authorityEpoch: 42n,
    });
    const ready = markAuthorityBindingReady(binding);

    const validity = validateAuthorityBinding(ready, {
      authorityKey: "ak",
      surfaceKey: "sk",
      authorityEpoch: 100n,
    });
    expect(validity.ok).toBe(false);
    if (validity.ok) return;

    const controlFailure: ControlFailure = createBindingInvalidControlFailure(validity);

    expect(controlFailure.details).toBeDefined();
    if (controlFailure.details === undefined) return;
    const d = controlFailure.details as unknown as Record<string, unknown>;
    expect((d.binding as Record<string, unknown>).authorityEpoch).toBe("42");
    expect(typeof (d.binding as Record<string, unknown>).authorityEpoch).toBe("string");
    const expected = d.expected as Record<string, unknown> | undefined;
    if (expected) {
      expect(expected.authorityEpoch).toBe("100");
      expect(typeof expected.authorityEpoch).toBe("string");
    }
  });

  it("rejects negative binding authorityEpoch deterministically", () => {
    expect(() =>
      createBindingInvalidControlFailure({
        ok: false,
        reason: "bindingOpening",
        rebindRequired: true,
        binding: {
          authorityKey: "ak",
          surfaceKey: "sk",
          authorityEpoch: -1n,
          state: { kind: "opening" },
        },
      }),
    ).toThrow();
  });

  it("rejects negative expected authorityEpoch deterministically", () => {
    expect(() =>
      createBindingInvalidControlFailure({
        ok: false,
        reason: "authorityEpochMismatch",
        rebindRequired: true,
        binding: {
          authorityKey: "ak",
          surfaceKey: "sk",
          authorityEpoch: 1n,
          state: { kind: "ready" },
        },
        expected: {
          authorityKey: "ak",
          surfaceKey: "sk",
          authorityEpoch: -1n,
        },
      }),
    ).toThrow();
  });

  it("projected binding failure details pass response envelope validation", () => {
    const binding = createAuthorityBinding({
      authorityKey: "ak",
      surfaceKey: "sk",
      authorityEpoch: 42n,
    });
    const ready = markAuthorityBindingReady(binding);
    const invalid = invalidateAuthorityBinding(ready, "authorityRestarted");

    const validity = validateAuthorityBinding(invalid, {
      authorityKey: "ak",
      surfaceKey: "sk",
      authorityEpoch: 42n,
    });
    expect(validity.ok).toBe(false);
    if (validity.ok) return;

    const controlFailure = createBindingInvalidControlFailure(validity);
    const envelope = createControlFailureEnvelope({
      requestKey: "test",
      failure: controlFailure,
    });
    const result = validateControlResponseEnvelope(envelope);
    expect(result.ok).toBe(true);
  });

  it("projected details contain no bigint after JSON.stringify/parse", () => {
    const binding = createAuthorityBinding({
      authorityKey: "ak",
      surfaceKey: "sk",
      authorityEpoch: 42n,
    });
    const ready = markAuthorityBindingReady(binding);
    const invalid = invalidateAuthorityBinding(ready, "authorityRestarted");

    const validity = validateAuthorityBinding(invalid, {
      authorityKey: "ak",
      surfaceKey: "sk",
      authorityEpoch: 42n,
    });
    expect(validity.ok).toBe(false);
    if (validity.ok) return;

    const controlFailure = createBindingInvalidControlFailure(validity);
    const envelope = createControlFailureEnvelope({
      requestKey: "test",
      failure: controlFailure,
    });
    const json = JSON.stringify(envelope);
    const parsed = JSON.parse(json);
    const details = parsed.failure.details;
    expect(typeof details.binding.authorityEpoch).toBe("string");
    expect(typeof details.rebindRequired).toBe("boolean");
    expect(typeof details.reason).toBe("string");
  });
});

describe("@exclave/control-plane mutation safety on session failures", () => {
  it("does not mutate session failure objects", () => {
    const binding = createAuthorityBinding({
      authorityKey: "auth-key",
      surfaceKey: "surf-key",
      authorityEpoch: 7n,
    });
    const ready = markAuthorityBindingReady(binding);
    const invalid = invalidateAuthorityBinding(ready, "authorityRestarted");

    const validity = validateAuthorityBinding(invalid, {
      authorityKey: "auth-key",
      surfaceKey: "surf-key",
      authorityEpoch: 7n,
    });
    expect(validity.ok).toBe(false);
    if (validity.ok) return;

    const original = {
      ...validity,
      binding: { ...validity.binding, state: { ...validity.binding.state } },
    };

    createBindingInvalidControlFailure(validity);

    expect(validity.reason).toBe(original.reason);
    expect(validity.binding.authorityEpoch).toBe(original.binding.authorityEpoch);
  });
});

describe("@exclave/control-plane conformance: binding failure round-trips through JSON", () => {
  it("preserves bindingInvalidated failure through JSON round-trip", () => {
    const binding = createAuthorityBinding({
      authorityKey: "ak",
      surfaceKey: "sk",
      authorityEpoch: 42n,
    });
    const ready = markAuthorityBindingReady(binding);
    const invalid = invalidateAuthorityBinding(ready, "authorityRestarted");

    const validity = validateAuthorityBinding(invalid, {
      authorityKey: "ak",
      surfaceKey: "sk",
      authorityEpoch: 42n,
    });
    expect(validity.ok).toBe(false);
    if (validity.ok) return;

    const controlFailure: ControlFailure = createBindingInvalidControlFailure(validity);

    const envelope = createControlFailureEnvelope({
      requestKey: "conformance-req",
      failure: controlFailure,
    });

    const json = JSON.stringify(envelope);
    const parsed = JSON.parse(json);

    const result = validateControlResponseEnvelope(parsed);
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    expect(result.value.ok).toBe(false);
    if (result.value.ok) return;

    const failure = result.value.failure;
    expect(failure.code).toBe("control.bindingInvalid");
    expect(typeof failure.message).toBe("string");
    expect(failure.details).toBeDefined();
    if (failure.details === undefined) return;

    expect(failure.details.reason).toBe("bindingInvalidated");
    expect(failure.details.rebindRequired).toBe(true);
    expect(failure.details.invalidationReason).toBe("authorityRestarted");
    expect((failure.details.binding as Record<string, unknown>).authorityEpoch).toBe("42");
    expect(typeof (failure.details.binding as Record<string, unknown>).authorityEpoch).toBe(
      "string",
    );
  });
});
