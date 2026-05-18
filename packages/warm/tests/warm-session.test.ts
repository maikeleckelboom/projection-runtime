import type { BindingExpectationMismatchFailure, BindingOpeningFailure } from "@exclave/session";
import { describe, expect, it } from "vitest";
import { createStaleBindingWarmFailure } from "../src/index";

describe("createStaleBindingWarmFailure", () => {
  it("projects session bindingOpening failure without bigint", () => {
    const openingFailure: BindingOpeningFailure = {
      ok: false,
      reason: "bindingOpening",
      rebindRequired: true,
      binding: {
        authorityKey: "auth-abc",
        surfaceKey: "surface-xyz",
        authorityEpoch: 42n,
        state: { kind: "opening" },
      },
    };

    const f = createStaleBindingWarmFailure(openingFailure);
    expect(f.code).toBe("warm.staleBinding");
    expect(f.details).toBeDefined();

    const details = f.details as Record<string, unknown>;
    expect(details.reason).toBe("bindingOpening");
    expect(details.rebindRequired).toBe(true);

    const binding = details.binding as Record<string, unknown>;
    expect(binding.authorityKey).toBe("auth-abc");
    expect(binding.surfaceKey).toBe("surface-xyz");
    expect(binding.authorityEpoch).toBe("42");
    expect(typeof binding.authorityEpoch).toBe("string");

    const serialized = JSON.stringify(f);
    const parsed = JSON.parse(serialized) as Record<string, unknown>;
    expect(parsed.code).toBe("warm.staleBinding");
    const parsedDetails = parsed.details as Record<string, unknown>;
    const parsedBinding = parsedDetails.binding as Record<string, unknown>;
    expect(typeof parsedBinding.authorityEpoch).toBe("string");
    expect(parsedBinding.authorityEpoch).toBe("42");
  });

  it("uses decimal-string authorityEpoch values", () => {
    const mismatchFailure: BindingExpectationMismatchFailure = {
      ok: false,
      reason: "authorityEpochMismatch",
      rebindRequired: true,
      binding: {
        authorityKey: "auth-stale",
        surfaceKey: "surface-stale",
        authorityEpoch: 100n,
        state: { kind: "ready" },
      },
      expected: {
        authorityKey: "auth-stale",
        surfaceKey: "surface-stale",
        authorityEpoch: 200n,
      },
    };

    const f = createStaleBindingWarmFailure(mismatchFailure);
    const details = f.details as Record<string, unknown>;
    const binding = details.binding as Record<string, unknown>;
    const expected = details.expected as Record<string, unknown>;

    expect(binding.authorityEpoch).toBe("100");
    expect(expected.authorityEpoch).toBe("200");
    expect(typeof binding.authorityEpoch).toBe("string");
    expect(typeof expected.authorityEpoch).toBe("string");
  });

  it("carries invalidationReason for bindingInvalidated", () => {
    const invalidatedFailure = {
      ok: false as const,
      reason: "bindingInvalidated" as const,
      rebindRequired: true as const,
      binding: {
        authorityKey: "auth-x",
        surfaceKey: "surface-x",
        authorityEpoch: 1n,
        state: { kind: "invalidated" as const, reason: "authorityRestarted" as const },
      },
      invalidationReason: "authorityRestarted" as const,
    };

    const f = createStaleBindingWarmFailure(invalidatedFailure);
    const details = f.details as Record<string, unknown>;
    expect(details.invalidationReason).toBe("authorityRestarted");
  });

  it("preserves expected in expectation mismatch failures", () => {
    const mismatchFailure: BindingExpectationMismatchFailure = {
      ok: false,
      reason: "authorityEpochMismatch",
      rebindRequired: true,
      binding: {
        authorityKey: "auth-x",
        surfaceKey: "surface-x",
        authorityEpoch: 5n,
        state: { kind: "ready" },
      },
      expected: {
        authorityKey: "auth-x",
        surfaceKey: "surface-x",
        authorityEpoch: 10n,
      },
    };

    const f = createStaleBindingWarmFailure(mismatchFailure);
    const details = f.details as Record<string, unknown>;
    const expectedField = details.expected as Record<string, unknown>;

    expect(expectedField).toBeDefined();
    expect(typeof expectedField.authorityEpoch).toBe("string");
    expect(expectedField.authorityEpoch).toBe("10");
  });

  it("rejects negative authorityEpoch deterministically", () => {
    const badFailure = {
      ok: false as const,
      reason: "bindingOpening" as const,
      rebindRequired: true,
      binding: {
        authorityKey: "auth-bad",
        surfaceKey: "surface-bad",
        authorityEpoch: -5n,
        state: { kind: "opening" as const },
      },
    };

    expect(() =>
      createStaleBindingWarmFailure(badFailure as unknown as BindingOpeningFailure),
    ).toThrow();
  });

  it("details are pure JSON through roundtrip", () => {
    const failure: BindingOpeningFailure = {
      ok: false,
      reason: "bindingOpening",
      rebindRequired: true,
      binding: {
        authorityKey: "auth-json",
        surfaceKey: "surface-json",
        authorityEpoch: 7n,
        state: { kind: "opening" },
      },
    };

    const f = createStaleBindingWarmFailure(failure);
    const serialized = JSON.stringify(f);
    const parsed = JSON.parse(serialized);

    expect(parsed.code).toBe("warm.staleBinding");
    expect(parsed.message).toBe("Warm stream rejected: bindingOpening");

    const parsedDetails = parsed.details;
    expect(typeof parsedDetails.reason).toBe("string");
    expect(typeof parsedDetails.rebindRequired).toBe("boolean");
    expect(typeof parsedDetails.binding).toBe("object");
    expect(typeof parsedDetails.binding.authorityEpoch).toBe("string");
    expect(parsedDetails.binding.authorityEpoch).toBe("7");
  });

  it("serializes stale binding details without bigint values", () => {
    const failure: BindingOpeningFailure = {
      ok: false,
      reason: "bindingOpening",
      rebindRequired: true,
      binding: {
        authorityKey: "auth-no-bigint",
        surfaceKey: "surface-no-bigint",
        authorityEpoch: 999n,
        state: { kind: "opening" },
      },
    };

    const f = createStaleBindingWarmFailure(failure);
    const json = JSON.stringify(f);
    const parsed = JSON.parse(json);

    const walk = (obj: unknown, path = "root"): void => {
      if (typeof obj === "bigint") {
        throw new Error(`Found bigint at ${path}`);
      }
      if (obj === null || typeof obj !== "object") return;
      if (Array.isArray(obj)) {
        for (const [i, value] of obj.entries()) {
          walk(value, `${path}[${i}]`);
        }
      } else {
        for (const [key, value] of Object.entries(obj as Record<string, unknown>)) {
          walk(value, `${path}.${key}`);
        }
      }
    };

    walk(parsed);
  });
});
