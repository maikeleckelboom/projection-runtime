import { ExclaveError, type JsonObject } from "@exclave/base";
import { describe, expect, expectTypeOf, it } from "vitest";
import * as warm from "../src/index";
import {
  createWarmFailure,
  createWarmFrameEnvelope,
  createWarmInvalidationPayload,
  createWarmOwner,
  validateWarmFailure,
  validateWarmFrameEnvelope,
  validateWarmOwner,
  WARM_ENVELOPE_VERSION,
  type WarmEnvelopeVersion,
  type WarmFailureCode,
  type WarmFrameEnvelope,
  type WarmFrameKey,
  type WarmFrameKind,
  type WarmFrameSequence,
  type WarmOwner,
  type WarmStreamKey,
} from "../src/index";

type WarmFrameInput = {
  -readonly [Key in keyof Parameters<typeof createWarmFrameEnvelope>[0]]: Parameters<
    typeof createWarmFrameEnvelope
  >[0][Key];
};

function makeRevokedProxy<T extends object>(target: T): T {
  const { proxy, revoke } = Proxy.revocable(target, {});
  revoke();
  return proxy;
}

function validOwner(): WarmOwner {
  return {
    authorityKey: "auth-key-1",
    surfaceKey: "surface-key-1",
    authorityEpoch: "7",
  };
}

function validFrameInput(): WarmFrameInput {
  return {
    streamKey: "stream-1",
    frameKey: "frame-1",
    sequence: "0",
    frameKind: "fixture.changed",
    owner: validOwner(),
    payload: { value: 42 },
  };
}

function validFrameEnvelope(): WarmFrameEnvelope {
  return createWarmFrameEnvelope(validFrameInput());
}

// ─── Public exports ────────────────────────────────────────────────

describe("@exclave/warm public exports", () => {
  it("exports the intended type surface", () => {
    expectTypeOf<WarmStreamKey>().toEqualTypeOf<string>();
    expectTypeOf<WarmFrameKey>().toEqualTypeOf<string>();
    expectTypeOf<WarmFrameSequence>().toEqualTypeOf<string>();
    expectTypeOf<WarmFrameKind>().toEqualTypeOf<string>();
    expectTypeOf<WarmEnvelopeVersion>().toEqualTypeOf<1>();

    expectTypeOf<WarmFailureCode>().toEqualTypeOf<
      "warm.invalidEnvelope" | "warm.staleBinding" | "warm.rejected"
    >();
  });

  it("exports the intended function surface", () => {
    expect(typeof warm.createWarmOwner).toBe("function");
    expect(typeof warm.validateWarmOwner).toBe("function");
    expect(typeof warm.createWarmFrameEnvelope).toBe("function");
    expect(typeof warm.validateWarmFrameEnvelope).toBe("function");
    expect(typeof warm.createWarmFailure).toBe("function");
    expect(typeof warm.validateWarmFailure).toBe("function");
    expect(typeof warm.createStaleBindingWarmFailure).toBe("function");
    expect(typeof warm.createWarmInvalidationPayload).toBe("function");
  });

  it("exports WARM_ENVELOPE_VERSION", () => {
    expect(WARM_ENVELOPE_VERSION).toBe(1);
  });

  it("does not leak internal helpers", () => {
    expect((warm as Record<string, unknown>).throwInputRejected).toBeUndefined();
    expect((warm as Record<string, unknown>).assertNonEmptyString).toBeUndefined();
    expect((warm as Record<string, unknown>).assertPlainObject).toBeUndefined();
    expect((warm as Record<string, unknown>).assertExactRootKeys).toBeUndefined();
  });
});

// ─── WarmOwner ─────────────────────────────────────────────────────

describe("createWarmOwner", () => {
  it("accepts valid owner", () => {
    const owner = createWarmOwner({
      authorityKey: "auth-1",
      surfaceKey: "surface-1",
      authorityEpoch: "42",
    });

    expect(owner.authorityKey).toBe("auth-1");
    expect(owner.surfaceKey).toBe("surface-1");
    expect(owner.authorityEpoch).toBe("42");
  });

  it("rejects empty authorityKey", () => {
    expect(() =>
      createWarmOwner({
        authorityKey: "",
        surfaceKey: "s",
        authorityEpoch: "0",
      }),
    ).toThrow(ExclaveError);
  });

  it("rejects empty surfaceKey", () => {
    expect(() =>
      createWarmOwner({
        authorityKey: "a",
        surfaceKey: "",
        authorityEpoch: "0",
      }),
    ).toThrow(ExclaveError);
  });

  it("rejects number authorityEpoch", () => {
    expect(() =>
      createWarmOwner({
        authorityKey: "a",
        surfaceKey: "s",
        authorityEpoch: 42,
      } as unknown as { authorityKey: string; surfaceKey: string; authorityEpoch: string }),
    ).toThrow(ExclaveError);
  });

  it("rejects bigint authorityEpoch", () => {
    expect(() =>
      createWarmOwner({
        authorityKey: "a",
        surfaceKey: "s",
        authorityEpoch: 42n,
      } as unknown as { authorityKey: string; surfaceKey: string; authorityEpoch: string }),
    ).toThrow(ExclaveError);
  });

  it("accepts canonical epoch strings", () => {
    expect(() =>
      createWarmOwner({ authorityKey: "a", surfaceKey: "s", authorityEpoch: "0" }),
    ).not.toThrow();
    expect(() =>
      createWarmOwner({ authorityKey: "a", surfaceKey: "s", authorityEpoch: "42" }),
    ).not.toThrow();
    expect(() =>
      createWarmOwner({ authorityKey: "a", surfaceKey: "s", authorityEpoch: "9007199254740993" }),
    ).not.toThrow();
  });

  it("rejects empty authorityEpoch", () => {
    expect(() =>
      createWarmOwner({ authorityKey: "a", surfaceKey: "s", authorityEpoch: "" }),
    ).toThrow(ExclaveError);
  });

  it('rejects "-1" authorityEpoch', () => {
    expect(() =>
      createWarmOwner({ authorityKey: "a", surfaceKey: "s", authorityEpoch: "-1" }),
    ).toThrow(ExclaveError);
  });

  it('rejects "+1" authorityEpoch', () => {
    expect(() =>
      createWarmOwner({ authorityKey: "a", surfaceKey: "s", authorityEpoch: "+1" }),
    ).toThrow(ExclaveError);
  });

  it('rejects "01" authorityEpoch', () => {
    expect(() =>
      createWarmOwner({ authorityKey: "a", surfaceKey: "s", authorityEpoch: "01" }),
    ).toThrow(ExclaveError);
  });

  it('rejects "1.0" authorityEpoch', () => {
    expect(() =>
      createWarmOwner({ authorityKey: "a", surfaceKey: "s", authorityEpoch: "1.0" }),
    ).toThrow(ExclaveError);
  });

  it('rejects "1n" authorityEpoch', () => {
    expect(() =>
      createWarmOwner({ authorityKey: "a", surfaceKey: "s", authorityEpoch: "1n" }),
    ).toThrow(ExclaveError);
  });

  it('rejects "abc" authorityEpoch', () => {
    expect(() =>
      createWarmOwner({ authorityKey: "a", surfaceKey: "s", authorityEpoch: "abc" }),
    ).toThrow(ExclaveError);
  });

  it("rejects owner with symbol keys", () => {
    const owner = {
      authorityKey: "a",
      surfaceKey: "s",
      authorityEpoch: "0",
    } as Record<string, unknown>;
    (owner as Record<symbol, unknown>)[Symbol("secret")] = "x";
    expect(() => validateWarmOwner(owner)).toThrow(ExclaveError);
  });

  it("rejects non-plain-object owner (class instance)", () => {
    class FakeOwner {
      authorityKey = "a";
      surfaceKey = "s";
      authorityEpoch = "0";
    }
    expect(() => validateWarmOwner(new FakeOwner())).toThrow(ExclaveError);
  });

  it("does not mutate input", () => {
    const input = {
      authorityKey: "auth-1",
      surfaceKey: "surface-1",
      authorityEpoch: "0",
    };
    const frozen = JSON.parse(JSON.stringify(input));

    createWarmOwner(input);

    expect(input).toEqual(frozen);
  });

  it("rejects extra field on owner", () => {
    expect(() =>
      createWarmOwner({
        authorityKey: "a",
        surfaceKey: "s",
        authorityEpoch: "0",
        extraField: true,
      } as unknown as { authorityKey: string; surfaceKey: string; authorityEpoch: string }),
    ).toThrow(ExclaveError);
  });
});

// ─── WarmFrameEnvelope creation ────────────────────────────────────

describe("createWarmFrameEnvelope", () => {
  it("accepts valid frame", () => {
    const envelope = createWarmFrameEnvelope(validFrameInput());

    expect(envelope.kind).toBe("warm.frame");
    expect(envelope.envelopeVersion).toBe(1);
    expect(envelope.streamKey).toBe("stream-1");
    expect(envelope.frameKey).toBe("frame-1");
    expect(envelope.sequence).toBe("0");
    expect(envelope.frameKind).toBe("fixture.changed");
    expect(envelope.owner.authorityKey).toBe("auth-key-1");
    expect(envelope.payload).toEqual({ value: 42 });
  });

  it("rejects wrong envelope shape (missing kind)", () => {
    expect(() =>
      createWarmFrameEnvelope({
        streamKey: "s",
        frameKey: "f",
        sequence: "0",
        frameKind: "fixture.changed",
        owner: validOwner(),
        payload: {},
        extraField: "bad",
      } as unknown as ReturnType<typeof validFrameInput>),
    ).toThrow(ExclaveError);
  });

  it("rejects empty streamKey", () => {
    const input = validFrameInput();
    input.streamKey = "";
    expect(() => createWarmFrameEnvelope(input)).toThrow(ExclaveError);
  });

  it("rejects empty frameKey", () => {
    const input = validFrameInput();
    input.frameKey = "";
    expect(() => createWarmFrameEnvelope(input)).toThrow(ExclaveError);
  });

  it("rejects empty frameKind", () => {
    const input = validFrameInput();
    input.frameKind = "";
    expect(() => createWarmFrameEnvelope(input)).toThrow(ExclaveError);
  });

  it("accepts canonical sequence strings", () => {
    expect(() => createWarmFrameEnvelope({ ...validFrameInput(), sequence: "0" })).not.toThrow();
    expect(() => createWarmFrameEnvelope({ ...validFrameInput(), sequence: "42" })).not.toThrow();
    expect(() =>
      createWarmFrameEnvelope({ ...validFrameInput(), sequence: "9007199254740993" }),
    ).not.toThrow();
  });

  it("rejects invalid sequence strings", () => {
    const invalidSequences = ["", "-1", "+1", "01", "1.0", "1n", "abc"];
    for (const seq of invalidSequences) {
      expect(() => createWarmFrameEnvelope({ ...validFrameInput(), sequence: seq })).toThrow(
        ExclaveError,
      );
    }
  });

  it("rejects sequence as number", () => {
    expect(() =>
      createWarmFrameEnvelope({
        ...validFrameInput(),
        sequence: 42,
      } as unknown as ReturnType<typeof validFrameInput>),
    ).toThrow(ExclaveError);
  });

  it("rejects sequence as bigint", () => {
    expect(() =>
      createWarmFrameEnvelope({
        ...validFrameInput(),
        sequence: 42n,
      } as unknown as ReturnType<typeof validFrameInput>),
    ).toThrow(ExclaveError);
  });

  it("rejects non-JSON-safe payloads including bigint", () => {
    expect(() =>
      createWarmFrameEnvelope({
        ...validFrameInput(),
        payload: { value: 1n } as never,
      }),
    ).toThrow(ExclaveError);
  });

  it("rejects array root payload", () => {
    expect(() =>
      createWarmFrameEnvelope({
        ...validFrameInput(),
        payload: [] as never,
      }),
    ).toThrow(ExclaveError);
  });

  it("rejects class instance payload", () => {
    class FakePayload {
      value = 42;
    }
    expect(() =>
      createWarmFrameEnvelope({
        ...validFrameInput(),
        payload: new FakePayload() as never,
      }),
    ).toThrow(ExclaveError);
  });

  it("rejects cyclic payload", () => {
    const cyclic: Record<string, unknown> = { x: 1 };
    cyclic.self = cyclic;
    expect(() =>
      createWarmFrameEnvelope({
        ...validFrameInput(),
        payload: cyclic as never,
      }),
    ).toThrow(ExclaveError);
  });

  it("rejects byte-like payload fields", () => {
    const byteCases: unknown[] = [
      { data: new Uint8Array(4) },
      { data: new ArrayBuffer(8) },
      { data: new SharedArrayBuffer(8) },
    ];

    for (const payload of byteCases) {
      expect(() =>
        createWarmFrameEnvelope({
          ...validFrameInput(),
          payload: payload as never,
        }),
      ).toThrow(ExclaveError);
    }
  });

  it("does not mutate input owner/payload objects", () => {
    const owner = validOwner();
    const payload = { value: 42 };
    const input = { ...validFrameInput(), owner, payload };

    const frozenOwner = JSON.parse(JSON.stringify(owner));
    const frozenPayload = JSON.parse(JSON.stringify(payload));

    createWarmFrameEnvelope(input);

    expect(owner).toEqual(frozenOwner);
    expect(payload).toEqual(frozenPayload);
  });

  it("creates envelope with correct owned keys", () => {
    const envelope = createWarmFrameEnvelope(validFrameInput());
    expect(Object.keys(envelope).sort()).toEqual([
      "envelopeVersion",
      "frameKey",
      "frameKind",
      "kind",
      "owner",
      "payload",
      "sequence",
      "streamKey",
    ]);
  });

  it("rejects null input", () => {
    expect(() => createWarmFrameEnvelope(null as never)).toThrow(ExclaveError);
  });

  it("rejects class instance as input", () => {
    class FakeInput {
      streamKey = "s";
      frameKey = "f";
      sequence = "0";
      frameKind = "fixture.changed";
      owner = validOwner();
      payload = {};
    }
    expect(() => createWarmFrameEnvelope(new FakeInput() as never)).toThrow(ExclaveError);
  });

  it("rejects revoked Proxy input without raw TypeError", () => {
    const proxy = makeRevokedProxy(validFrameInput());
    let threw = false;
    try {
      createWarmFrameEnvelope(proxy as never);
    } catch (e) {
      threw = true;
      expect(e).toBeInstanceOf(ExclaveError);
    }
    expect(threw).toBe(true);
  });

  it("rejects getter payload without invoking getter", () => {
    let getterCalled = false;
    const input = validFrameInput();
    Object.defineProperty(input, "payload", {
      get() {
        getterCalled = true;
        return { x: 1 };
      },
      enumerable: true,
      configurable: true,
    });
    expect(() => createWarmFrameEnvelope(input as never)).toThrow(ExclaveError);
    expect(getterCalled).toBe(false);
  });
});

// ─── WarmFrameEnvelope validation ─────────────────────────────────

describe("validateWarmFrameEnvelope", () => {
  it("accepts valid frame", () => {
    const envelope = validFrameEnvelope();
    const result = validateWarmFrameEnvelope(envelope);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.streamKey).toBe("stream-1");
      expect(result.value.frameKey).toBe("frame-1");
    }
  });

  it("rejects wrong kind", () => {
    const envelope = { ...validFrameEnvelope(), kind: "wrong.kind" };
    const result = validateWarmFrameEnvelope(envelope);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.failure.code).toBe("warm.invalidEnvelope");
    }
  });

  it("rejects wrong envelopeVersion", () => {
    const envelope = { ...validFrameEnvelope(), envelopeVersion: 99 };
    const result = validateWarmFrameEnvelope(envelope);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.failure.code).toBe("warm.invalidEnvelope");
    }
  });

  it("rejects empty streamKey", () => {
    const envelope = { ...validFrameEnvelope(), streamKey: "" };
    const result = validateWarmFrameEnvelope(envelope);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.failure.code).toBe("warm.invalidEnvelope");
    }
  });

  it("rejects empty frameKey", () => {
    const envelope = { ...validFrameEnvelope(), frameKey: "" };
    const result = validateWarmFrameEnvelope(envelope);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.failure.code).toBe("warm.invalidEnvelope");
    }
  });

  it("rejects empty frameKind", () => {
    const envelope = { ...validFrameEnvelope(), frameKind: "" };
    const result = validateWarmFrameEnvelope(envelope);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.failure.code).toBe("warm.invalidEnvelope");
    }
  });

  it("accepts canonical sequence strings", () => {
    for (const seq of ["0", "42", "9007199254740993"]) {
      const envelope = { ...validFrameEnvelope(), sequence: seq };
      const result = validateWarmFrameEnvelope(envelope);
      expect(result.ok).toBe(true);
    }
  });

  it("rejects invalid sequence strings", () => {
    const invalidSequences = ["", "-1", "+1", "01", "1.0", "1n", "abc"];
    for (const seq of invalidSequences) {
      const envelope = { ...validFrameEnvelope(), sequence: seq };
      const result = validateWarmFrameEnvelope(envelope);
      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.failure.code).toBe("warm.invalidEnvelope");
      }
    }
  });

  it("rejects non-JSON-safe payloads including bigint", () => {
    const envelope = { ...validFrameEnvelope(), payload: { x: 1n } };
    const result = validateWarmFrameEnvelope(envelope);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.failure.code).toBe("warm.invalidEnvelope");
    }
  });

  it("rejects array root payload", () => {
    const envelope = { ...validFrameEnvelope(), payload: [1, 2, 3] };
    const result = validateWarmFrameEnvelope(envelope);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.failure.code).toBe("warm.invalidEnvelope");
    }
  });

  it("rejects class instance payload", () => {
    class FakePayload {
      value = 42;
    }
    const envelope = { ...validFrameEnvelope(), payload: new FakePayload() };
    const result = validateWarmFrameEnvelope(envelope);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.failure.code).toBe("warm.invalidEnvelope");
    }
  });

  it("rejects cyclic payload", () => {
    const cyclic: Record<string, unknown> = { x: 1 };
    cyclic.self = cyclic;
    const envelope = { ...validFrameEnvelope(), payload: cyclic };
    const result = validateWarmFrameEnvelope(envelope);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.failure.code).toBe("warm.invalidEnvelope");
    }
  });

  it("rejects byte-like payload fields", () => {
    const byteCases: unknown[] = [
      { data: new Uint8Array(4) },
      { data: new ArrayBuffer(8) },
      { data: new SharedArrayBuffer(8) },
    ];

    for (const payload of byteCases) {
      const envelope = { ...validFrameEnvelope(), payload };
      const result = validateWarmFrameEnvelope(envelope);
      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.failure.code).toBe("warm.invalidEnvelope");
      }
    }
  });

  it("JSON.stringify/parse roundtrip preserves a valid warm frame", () => {
    const original = validFrameEnvelope();
    const serialized = JSON.stringify(original);
    const parsed = JSON.parse(serialized) as WarmFrameEnvelope;

    expect(parsed.kind).toBe("warm.frame");
    expect(parsed.envelopeVersion).toBe(1);
    expect(parsed.streamKey).toBe("stream-1");
    expect(parsed.frameKey).toBe("frame-1");
    expect(parsed.sequence).toBe("0");
    expect(parsed.frameKind).toBe("fixture.changed");
    expect(parsed.owner.authorityKey).toBe("auth-key-1");
    expect(parsed.owner.authorityEpoch).toBe("7");
    expect(parsed.payload).toEqual({ value: 42 });

    const revalidated = validateWarmFrameEnvelope(parsed);
    expect(revalidated.ok).toBe(true);
  });

  it("rejects non-plain-object envelope root without throwing", () => {
    class FakeEnvelope {
      kind = "warm.frame";
      envelopeVersion = 1;
      streamKey = "s";
      frameKey = "f";
      sequence = "0";
      frameKind = "fixture.changed";
      owner = validOwner();
      payload = {};
    }
    expect(() => {
      const result = validateWarmFrameEnvelope(new FakeEnvelope());
      expect(result.ok).toBe(false);
    }).not.toThrow();
  });

  it("rejects hostile Proxy envelope without throwing", () => {
    const proxy = new Proxy(validFrameEnvelope(), {
      getPrototypeOf() {
        throw new Error("trap explosion");
      },
    });
    expect(() => {
      const result = validateWarmFrameEnvelope(proxy);
      expect(result.ok).toBe(false);
    }).not.toThrow();
  });

  it("rejects revoked Proxy envelope without throwing", () => {
    const proxy = makeRevokedProxy(validFrameEnvelope());
    let threw = false;
    try {
      const result = validateWarmFrameEnvelope(proxy);
      expect(result.ok).toBe(false);
    } catch {
      threw = true;
    }
    expect(threw).toBe(false);
  });

  it("rejects extra root field", () => {
    const envelope = { ...validFrameEnvelope(), extraField: "bad" };
    const result = validateWarmFrameEnvelope(envelope);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.failure.code).toBe("warm.invalidEnvelope");
      expect(result.failure.message).toContain("Unexpected field");
    }
  });

  it("rejects invalid owner in envelope", () => {
    const envelope = {
      ...validFrameEnvelope(),
      owner: { authorityKey: "a", surfaceKey: "s", authorityEpoch: -1 } as unknown as WarmOwner,
    };
    const result = validateWarmFrameEnvelope(envelope);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.failure.code).toBe("warm.invalidEnvelope");
    }
  });
});

// ─── WarmFailure ───────────────────────────────────────────────────

describe("createWarmFailure", () => {
  it("accepts valid failure", () => {
    const f = createWarmFailure({
      code: "warm.rejected",
      message: "Access denied",
    });
    expect(f.code).toBe("warm.rejected");
    expect(f.message).toBe("Access denied");
    expect(f.details).toBeUndefined();
  });

  it("accepts failure with details", () => {
    const f = createWarmFailure({
      code: "warm.invalidEnvelope",
      message: "Invalid envelope",
      details: { field: "streamKey", reason: "empty" },
    });
    expect(f.details).toEqual({ field: "streamKey", reason: "empty" });
  });

  it("rejects invalid failure code", () => {
    expect(() =>
      createWarmFailure({
        code: "bad.code" as WarmFailureCode,
        message: "test",
      }),
    ).toThrow(ExclaveError);
  });

  it("rejects empty failure message", () => {
    expect(() =>
      createWarmFailure({
        code: "warm.rejected",
        message: "",
      }),
    ).toThrow(ExclaveError);
  });

  it("rejects non-JSON-safe failure details", () => {
    expect(() =>
      createWarmFailure({
        code: "warm.rejected",
        message: "test",
        details: { bad: 1n } as never,
      }),
    ).toThrow(ExclaveError);
  });

  it("validateWarmFailure accepts valid failure", () => {
    const f = validateWarmFailure({
      code: "warm.rejected",
      message: "rejected",
    });
    expect(f.code).toBe("warm.rejected");
  });

  it("failure details allow nested arrays", () => {
    const f = createWarmFailure({
      code: "warm.rejected",
      message: "denied",
      details: { items: [1, 2, 3] },
    });
    expect(f.details).toEqual({ items: [1, 2, 3] });
  });

  it("returns normalized failure without extra fields", () => {
    const f = createWarmFailure({
      code: "warm.rejected",
      message: "bad",
      details: { x: 1 },
    });
    expect(Object.keys(f).sort()).toEqual(
      f.details !== undefined ? ["code", "details", "message"] : ["code", "message"],
    );
  });
});

// ─── Invalidation Payload ──────────────────────────────────────────

describe("createWarmInvalidationPayload", () => {
  it("accepts { reason }", () => {
    const payload = createWarmInvalidationPayload({
      reason: "fixture.expired",
    });

    const roundtripped = JSON.parse(JSON.stringify(payload));
    expect(roundtripped.reason).toBe("fixture.expired");
  });

  it("accepts { reason, affectedKey, revision }", () => {
    const payload = createWarmInvalidationPayload({
      reason: "fixture.changed",
      affectedKey: "fixture-key-1",
      revision: "3",
    });
    const obj = payload as Record<string, unknown>;
    expect(obj.reason).toBe("fixture.changed");
    expect(obj.affectedKey).toBe("fixture-key-1");
    expect(obj.revision).toBe("3");
  });

  it("rejects empty reason", () => {
    expect(() => createWarmInvalidationPayload({ reason: "" })).toThrow(ExclaveError);
  });

  it("rejects empty affectedKey", () => {
    expect(() => createWarmInvalidationPayload({ reason: "test", affectedKey: "" })).toThrow(
      ExclaveError,
    );
  });

  it("rejects empty revision", () => {
    expect(() => createWarmInvalidationPayload({ reason: "test", revision: "" })).toThrow(
      ExclaveError,
    );
  });

  it("rejects extra keys", () => {
    expect(() =>
      createWarmInvalidationPayload({
        reason: "test",
        extraField: "bad",
      } as unknown as { reason: string }),
    ).toThrow(ExclaveError);
  });

  it("rejects array input", () => {
    expect(() =>
      createWarmInvalidationPayload(["reason"] as unknown as { reason: string }),
    ).toThrow(ExclaveError);
  });

  it("rejects class instance input", () => {
    class FakePayload {
      reason = "test";
    }
    expect(() =>
      createWarmInvalidationPayload(new FakePayload() as unknown as { reason: string }),
    ).toThrow(ExclaveError);
  });

  it("rejects accessor/getter input without leaking raw TypeError", () => {
    let getterCalled = false;
    const input = {
      get reason() {
        getterCalled = true;
        return "test";
      },
    };
    expect(() => createWarmInvalidationPayload(input as unknown as { reason: string })).toThrow(
      ExclaveError,
    );
    expect(getterCalled).toBe(false);
  });

  it("rejects symbol key input", () => {
    const input = { reason: "test" } as Record<string | symbol, unknown>;
    input[Symbol("secret")] = "x";
    expect(() => createWarmInvalidationPayload(input as unknown as { reason: string })).toThrow(
      ExclaveError,
    );
  });

  it("rejects cyclic input", () => {
    const cyclic: Record<string, unknown> = { reason: "test" };
    cyclic.self = cyclic;
    expect(() => createWarmInvalidationPayload(cyclic as unknown as { reason: string })).toThrow(
      ExclaveError,
    );
  });

  it("accepts non-decimal opaque revision such as 'projection:rev-42'", () => {
    const payload = createWarmInvalidationPayload({
      reason: "fixture.changed",
      revision: "projection:rev-42",
    });
    const obj = payload as Record<string, unknown>;
    expect(obj.revision).toBe("projection:rev-42");
  });
});

// ─── WarmOwner canon Epoch ─────────────────────────────────────────

describe("WarmOwner canonical epoch strings", () => {
  it('accepts "0"', () => {
    expect(() =>
      createWarmOwner({ authorityKey: "a", surfaceKey: "s", authorityEpoch: "0" }),
    ).not.toThrow();
  });

  it('accepts "1"', () => {
    expect(() =>
      createWarmOwner({ authorityKey: "a", surfaceKey: "s", authorityEpoch: "1" }),
    ).not.toThrow();
  });

  it('accepts "42"', () => {
    expect(() =>
      createWarmOwner({ authorityKey: "a", surfaceKey: "s", authorityEpoch: "42" }),
    ).not.toThrow();
  });

  it("rejects empty string", () => {
    expect(() =>
      createWarmOwner({ authorityKey: "a", surfaceKey: "s", authorityEpoch: "" }),
    ).toThrow(ExclaveError);
  });

  it('rejects "-1"', () => {
    expect(() =>
      createWarmOwner({ authorityKey: "a", surfaceKey: "s", authorityEpoch: "-1" }),
    ).toThrow(ExclaveError);
  });
});

// ─── Immutability ──────────────────────────────────────────────────

describe("Immutability", () => {
  it("createWarmFrameEnvelope does not mutate input payload", () => {
    const payload = { x: 1, y: [2, 3] };
    const frozen = JSON.parse(JSON.stringify(payload));
    const input = validFrameInput();
    input.payload = payload satisfies JsonObject;

    createWarmFrameEnvelope(input);

    expect(payload).toEqual(frozen);
  });

  it("createWarmFrameEnvelope does not mutate input owner", () => {
    const owner = validOwner();
    const frozen = JSON.parse(JSON.stringify(owner));
    const input = validFrameInput();
    input.owner = owner;

    createWarmFrameEnvelope(input);

    expect(owner).toEqual(frozen);
  });
});
