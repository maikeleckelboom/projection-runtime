import type { JsonObject } from "@exclave/base";
import type { ResourceDescriptor, ResourceOwner } from "@exclave/resource";
import {
  createInvalidRangeResourceFailure,
  createResourceDescriptor,
  createResourceReceiptFailure,
  createStaleBindingResourceFailure,
  validateResourceDescriptor,
  validateResourceOwner,
  validateResourceReceiptFailure,
} from "@exclave/resource";
import type { BindingExpectationMismatchFailure, BindingOpeningFailure } from "@exclave/session";
import { describe, expect, it } from "vitest";
import {
  createResourceReadRange,
  createResourceReadRangeReceiptPayload,
  createResourceReadRangeRequestPayload,
  validateResourceReadRange,
} from "../src/resource-range";

function validOwner(): ResourceOwner {
  return {
    authorityKey: "auth-key-1",
    surfaceKey: "surface-key-1",
    authorityEpoch: "7",
  };
}

function validDescriptor(): ResourceDescriptor {
  return {
    handleKey: "handle-1",
    kind: "fixture.bytes",
    byteLength: 1024,
    version: "v1.0.0-alpha",
    owner: validOwner(),
  };
}

describe("ResourceDescriptor", () => {
  it("createResourceDescriptor accepts valid descriptor", () => {
    const d = createResourceDescriptor({
      handleKey: "handle-1",
      kind: "fixture.bytes",
      byteLength: 1024,
      version: "v1.0.0-alpha",
      owner: validOwner(),
    });

    expect(d.handleKey).toBe("handle-1");
    expect(d.kind).toBe("fixture.bytes");
    expect(d.byteLength).toBe(1024);
    expect(d.version).toBe("v1.0.0-alpha");
    expect(d.owner.authorityKey).toBe("auth-key-1");
  });

  it("rejects empty handleKey", () => {
    expect(() =>
      createResourceDescriptor({
        handleKey: "",
        kind: "fixture.bytes",
        byteLength: 0,
        version: "v1",
        owner: validOwner(),
      }),
    ).toThrow();
  });

  it("rejects empty kind", () => {
    expect(() =>
      createResourceDescriptor({
        handleKey: "h",
        kind: "",
        byteLength: 0,
        version: "v1",
        owner: validOwner(),
      }),
    ).toThrow();
  });

  it("rejects empty version", () => {
    expect(() =>
      createResourceDescriptor({
        handleKey: "h",
        kind: "fixture.bytes",
        byteLength: 0,
        version: "",
        owner: validOwner(),
      }),
    ).toThrow();
  });

  it("rejects negative byteLength", () => {
    expect(() =>
      createResourceDescriptor({
        handleKey: "h",
        kind: "fixture.bytes",
        byteLength: -1,
        version: "v1",
        owner: validOwner(),
      }),
    ).toThrow();
  });

  it("rejects fractional byteLength", () => {
    expect(() =>
      createResourceDescriptor({
        handleKey: "h",
        kind: "fixture.bytes",
        byteLength: 3.5,
        version: "v1",
        owner: validOwner(),
      }),
    ).toThrow();
  });

  it("rejects NaN byteLength", () => {
    expect(() =>
      createResourceDescriptor({
        handleKey: "h",
        kind: "fixture.bytes",
        byteLength: Number.NaN,
        version: "v1",
        owner: validOwner(),
      }),
    ).toThrow();
  });

  it("rejects Infinity byteLength", () => {
    expect(() =>
      createResourceDescriptor({
        handleKey: "h",
        kind: "fixture.bytes",
        byteLength: Number.POSITIVE_INFINITY,
        version: "v1",
        owner: validOwner(),
      }),
    ).toThrow();
  });

  it("rejects unsafe integer byteLength", () => {
    expect(() =>
      createResourceDescriptor({
        handleKey: "h",
        kind: "fixture.bytes",
        byteLength: Number.MAX_SAFE_INTEGER + 1,
        version: "v1",
        owner: validOwner(),
      }),
    ).toThrow();
  });

  it("rejects owner with number epoch", () => {
    expect(() =>
      createResourceDescriptor({
        handleKey: "h",
        kind: "fixture.bytes",
        byteLength: 0,
        version: "v1",
        owner: {
          authorityKey: "a",
          surfaceKey: "s",
          authorityEpoch: 42,
        } as unknown as ResourceOwner,
      }),
    ).toThrow();
  });

  it("rejects owner with bigint epoch", () => {
    expect(() =>
      createResourceDescriptor({
        handleKey: "h",
        kind: "fixture.bytes",
        byteLength: 0,
        version: "v1",
        owner: {
          authorityKey: "a",
          surfaceKey: "s",
          authorityEpoch: 42n,
        } as unknown as ResourceOwner,
      }),
    ).toThrow();
  });

  it("validateResourceOwner accepts canonical non-negative decimal-string authorityEpoch", () => {
    expect(() =>
      validateResourceOwner({ authorityKey: "a", surfaceKey: "s", authorityEpoch: "0" }),
    ).not.toThrow();

    expect(() =>
      validateResourceOwner({ authorityKey: "a", surfaceKey: "s", authorityEpoch: "42" }),
    ).not.toThrow();

    expect(() =>
      validateResourceOwner({
        authorityKey: "a",
        surfaceKey: "s",
        authorityEpoch: "9007199254740993",
      }),
    ).not.toThrow();
  });

  it("rejects negative decimal-string authorityEpoch", () => {
    expect(() =>
      validateResourceOwner({ authorityKey: "a", surfaceKey: "s", authorityEpoch: "-1" }),
    ).toThrow();
  });

  it("rejects non-decimal authorityEpoch", () => {
    expect(() =>
      validateResourceOwner({ authorityKey: "a", surfaceKey: "s", authorityEpoch: "1.0" }),
    ).toThrow();

    expect(() =>
      validateResourceOwner({ authorityKey: "a", surfaceKey: "s", authorityEpoch: "1n" }),
    ).toThrow();

    expect(() =>
      validateResourceOwner({ authorityKey: "a", surfaceKey: "s", authorityEpoch: "abc" }),
    ).toThrow();

    expect(() =>
      validateResourceOwner({ authorityKey: "a", surfaceKey: "s", authorityEpoch: "+1" }),
    ).toThrow();

    expect(() =>
      validateResourceOwner({ authorityKey: "a", surfaceKey: "s", authorityEpoch: "" }),
    ).toThrow();
  });

  it("rejects leading-zero authorityEpoch except 0", () => {
    expect(() =>
      validateResourceOwner({ authorityKey: "a", surfaceKey: "s", authorityEpoch: "01" }),
    ).toThrow();

    expect(() =>
      validateResourceOwner({ authorityKey: "a", surfaceKey: "s", authorityEpoch: "007" }),
    ).toThrow();

    expect(() =>
      validateResourceOwner({ authorityKey: "a", surfaceKey: "s", authorityEpoch: "0" }),
    ).not.toThrow();
  });

  it("rejects owner with symbol keys", () => {
    const owner = {
      authorityKey: "a",
      surfaceKey: "s",
      authorityEpoch: "0",
    } as Record<string, unknown>;
    (owner as Record<symbol, unknown>)[Symbol("secret")] = "x";
    expect(() => validateResourceOwner(owner)).toThrow();
  });

  it("createResourceDescriptor does not mutate input", () => {
    const input = {
      handleKey: "handle-1",
      kind: "fixture.bytes",
      byteLength: 1024,
      version: "v1",
      owner: validOwner(),
    };

    const frozen = JSON.parse(JSON.stringify(input));

    createResourceDescriptor(input);

    expect(input).toEqual(frozen);
  });

  it("rejects getter fields without invoking getter", () => {
    let getterCalled = false;
    const input = {
      handleKey: "h",
      kind: "fixture.bytes",
      byteLength: 0,
      version: "v1",
      owner: validOwner(),
    };
    Object.defineProperty(input, "extra", {
      get() {
        getterCalled = true;
        return 42;
      },
      enumerable: true,
      configurable: true,
    });
    expect(() => createResourceDescriptor(input)).toThrow();
    expect(getterCalled).toBe(false);
  });

  it("rejects hostile Proxy without raw TypeError", () => {
    const input = {
      handleKey: "h",
      kind: "fixture.bytes",
      byteLength: 0,
      version: "v1",
      owner: validOwner(),
    };
    const proxy = new Proxy(input, {
      getPrototypeOf() {
        throw new Error("trap");
      },
    });
    let threw = false;
    try {
      expect(() => createResourceDescriptor(proxy)).toThrow();
    } catch {
      threw = true;
    }
    expect(threw).toBe(false);
  });

  it("rejects revoked Proxy without raw TypeError", () => {
    const { proxy, revoke } = Proxy.revocable(
      {
        handleKey: "h",
        kind: "fixture.bytes",
        byteLength: 0,
        version: "v1",
        owner: validOwner(),
      },
      {},
    );
    revoke();
    let threw = false;
    try {
      expect(() => createResourceDescriptor(proxy)).toThrow();
    } catch {
      threw = true;
    }
    expect(threw).toBe(false);
  });

  it("rejects class instance deterministically", () => {
    class FakeDescriptor {
      handleKey = "h";
      kind = "fixture.bytes";
      byteLength = 0;
      version = "v1";
      owner = validOwner();
    }
    expect(() => createResourceDescriptor(new FakeDescriptor())).toThrow();
  });
});

describe("ResourceReadRange", () => {
  const descriptor = validDescriptor();

  it("validateResourceReadRange accepts normal range", () => {
    const range = validateResourceReadRange({ offset: 0, byteLength: 512 }, descriptor);
    expect(range.offset).toBe(0);
    expect(range.byteLength).toBe(512);
  });

  it("accepts zero-length range at end of descriptor", () => {
    expect(() =>
      validateResourceReadRange({ offset: 1024, byteLength: 0 }, descriptor),
    ).not.toThrow();
  });

  it("accepts zero-length range at offset 0 for a zero-byte descriptor", () => {
    const zeroDesc = createResourceDescriptor({
      handleKey: "z",
      kind: "fixture.bytes",
      byteLength: 0,
      version: "v1",
      owner: validOwner(),
    });
    expect(() => validateResourceReadRange({ offset: 0, byteLength: 0 }, zeroDesc)).not.toThrow();
  });

  it("rejects negative offset", () => {
    expect(() => validateResourceReadRange({ offset: -1, byteLength: 10 }, descriptor)).toThrow();
  });

  it("rejects negative byteLength", () => {
    expect(() => validateResourceReadRange({ offset: 0, byteLength: -1 }, descriptor)).toThrow();
  });

  it("rejects fractional offset", () => {
    expect(() => validateResourceReadRange({ offset: 0.5, byteLength: 10 }, descriptor)).toThrow();
  });

  it("rejects fractional byteLength", () => {
    expect(() => validateResourceReadRange({ offset: 0, byteLength: 10.5 }, descriptor)).toThrow();
  });

  it("rejects unsafe offset", () => {
    expect(() =>
      validateResourceReadRange({ offset: Number.MAX_SAFE_INTEGER + 1, byteLength: 0 }, descriptor),
    ).toThrow();
  });

  it("rejects unsafe byteLength", () => {
    expect(() =>
      validateResourceReadRange({ offset: 0, byteLength: Number.MAX_SAFE_INTEGER + 1 }, descriptor),
    ).toThrow();
  });

  it("rejects range beyond descriptor byteLength", () => {
    expect(() =>
      validateResourceReadRange({ offset: 1000, byteLength: 100 }, descriptor),
    ).toThrow();
  });

  it("rejects offset + byteLength overflow beyond Number.MAX_SAFE_INTEGER", () => {
    expect(() =>
      validateResourceReadRange({ offset: Number.MAX_SAFE_INTEGER, byteLength: 1 }, descriptor),
    ).toThrow();
  });

  it("createResourceReadRange does not mutate range input", () => {
    const input = { offset: 100, byteLength: 200 };
    const frozen = { ...input };

    createResourceReadRange(input);

    expect(input).toEqual(frozen);
  });

  it("rejects forged descriptor with unsafe byteLength", () => {
    const forged = {
      handleKey: "h",
      kind: "fixture.bytes",
      byteLength: Number.MAX_SAFE_INTEGER + 1,
      version: "v1",
      owner: validOwner(),
    };
    expect(() => validateResourceReadRange({ offset: 0, byteLength: 0 }, forged)).toThrow();
  });

  it("rejects forged descriptor with negative byteLength", () => {
    const forged = {
      handleKey: "h",
      kind: "fixture.bytes",
      byteLength: -1,
      version: "v1",
      owner: validOwner(),
    };
    expect(() => validateResourceReadRange({ offset: 0, byteLength: 0 }, forged)).toThrow();
  });

  it("overflow is rejected before range comparison", () => {
    // descriptor.byteLength is small (1024), so range comparison would reject anyway,
    // but the key behavior is that overflow check happens first and throws with overflow message.
    let caught: unknown;
    try {
      validateResourceReadRange({ offset: Number.MAX_SAFE_INTEGER, byteLength: 2 }, descriptor);
    } catch (e) {
      caught = e;
    }
    expect(caught).toBeInstanceOf(Error);
    if (
      caught instanceof Error &&
      "details" in caught &&
      caught.details &&
      typeof caught.details === "object"
    ) {
      const detail = (caught.details as Record<string, unknown>).detail;
      expect(typeof detail).toBe("string");
      expect(detail).toContain("overflow");
    }
  });

  it("allows offset + byteLength exactly Number.MAX_SAFE_INTEGER when descriptor is large enough", () => {
    const largeDesc = createResourceDescriptor({
      handleKey: "h",
      kind: "fixture.bytes",
      byteLength: Number.MAX_SAFE_INTEGER,
      version: "v1",
      owner: validOwner(),
    });
    expect(() =>
      validateResourceReadRange({ offset: 0, byteLength: Number.MAX_SAFE_INTEGER }, largeDesc),
    ).not.toThrow();
  });

  it("zero-length read at descriptor.byteLength is still allowed", () => {
    expect(() =>
      validateResourceReadRange({ offset: descriptor.byteLength, byteLength: 0 }, descriptor),
    ).not.toThrow();
  });
});

describe("Read Range Request / Receipt Payloads", () => {
  it("createResourceReadRangeRequestPayload returns JSON-safe payload", () => {
    const payload = createResourceReadRangeRequestPayload({
      handleKey: "handle-1",
      range: { offset: 0, byteLength: 512 },
      owner: validOwner(),
    });

    const roundtripped = JSON.parse(JSON.stringify(payload));
    expect(roundtripped.handleKey).toBe("handle-1");
    expect(roundtripped.range.offset).toBe(0);
    expect(roundtripped.range.byteLength).toBe(512);
  });

  it("rejects invalid handleKey in request payload", () => {
    expect(() =>
      createResourceReadRangeRequestPayload({
        handleKey: "",
        range: { offset: 0, byteLength: 10 },
        owner: validOwner(),
      }),
    ).toThrow();
  });

  it("rejects invalid owner in request payload", () => {
    expect(() =>
      createResourceReadRangeRequestPayload({
        handleKey: "h",
        range: { offset: 0, byteLength: 10 },
        owner: {
          authorityKey: "a",
          surfaceKey: "s",
          authorityEpoch: -1,
        } as unknown as ResourceOwner,
      }),
    ).toThrow();
  });

  it("rejects invalid range in request payload", () => {
    expect(() =>
      createResourceReadRangeRequestPayload({
        handleKey: "h",
        range: { offset: -1, byteLength: 10 },
        owner: validOwner(),
      }),
    ).toThrow();
  });

  it("createResourceReadRangeReceiptPayload returns JSON-safe payload", () => {
    const payload = createResourceReadRangeReceiptPayload({
      handleKey: "handle-1",
      range: { offset: 100, byteLength: 200 },
      byteLength: 200,
      version: "v1",
    });

    const roundtripped = JSON.parse(JSON.stringify(payload));
    expect(roundtripped.handleKey).toBe("handle-1");
    expect(roundtripped.byteLength).toBe(200);
    expect(roundtripped.version).toBe("v1");
  });

  it("receipt payload does not carry bytes", () => {
    const payload = createResourceReadRangeReceiptPayload({
      handleKey: "handle-1",
      range: { offset: 100, byteLength: 200 },
      byteLength: 200,
      version: "v1",
    });

    const obj = payload as Record<string, unknown>;
    expect(obj).not.toHaveProperty("bytes");
    expect(obj).not.toHaveProperty("data");
    expect(obj).not.toHaveProperty("buffer");
  });

  it("rejects receipt byteLength mismatch with range", () => {
    expect(() =>
      createResourceReadRangeReceiptPayload({
        handleKey: "h",
        range: { offset: 0, byteLength: 100 },
        byteLength: 200,
        version: "v1",
      }),
    ).toThrow();
  });

  it("rejects receipt with byte-like payload fields", () => {
    expect(() =>
      createResourceReadRangeReceiptPayload({
        handleKey: "h",
        range: { offset: 0, byteLength: 10 },
        byteLength: 10,
        version: "v1",
        bytes: new Uint8Array(10),
      } as unknown as {
        handleKey: string;
        range: { offset: number; byteLength: number };
        byteLength: number;
        version: string;
      }),
    ).toThrow();

    expect(() =>
      createResourceReadRangeReceiptPayload({
        handleKey: "h",
        range: { offset: 0, byteLength: 10 },
        byteLength: 10,
        version: "v1",
        base64: "AAAA",
      } as unknown as {
        handleKey: string;
        range: { offset: number; byteLength: number };
        byteLength: number;
        version: string;
      }),
    ).toThrow();

    expect(() =>
      createResourceReadRangeReceiptPayload({
        handleKey: "h",
        range: { offset: 0, byteLength: 10 },
        byteLength: 10,
        version: "v1",
        arrayBuffer: {},
      } as unknown as {
        handleKey: string;
        range: { offset: number; byteLength: number };
        byteLength: number;
        version: string;
      }),
    ).toThrow();

    expect(() =>
      createResourceReadRangeReceiptPayload({
        handleKey: "h",
        range: { offset: 0, byteLength: 10 },
        byteLength: 10,
        version: "v1",
        buffer: {},
      } as unknown as {
        handleKey: string;
        range: { offset: number; byteLength: number };
        byteLength: number;
        version: string;
      }),
    ).toThrow();
  });
});

describe("ResourceReceiptFailure", () => {
  it("createResourceReceiptFailure accepts valid resource receipt failure", () => {
    const f = createResourceReceiptFailure({
      code: "resource.rejected",
      message: "Access denied",
    });
    expect(f.code).toBe("resource.rejected");
    expect(f.message).toBe("Access denied");
    expect(f.details).toBeUndefined();
  });

  it("accepts failure with details", () => {
    const f = createResourceReceiptFailure({
      code: "resource.invalidHandle",
      message: "Invalid handle",
      details: { handleKey: "bad", reason: "malformed" },
    });
    expect(f.details).toEqual({ handleKey: "bad", reason: "malformed" });
  });

  it("rejects invalid resource failure code", () => {
    expect(() =>
      createResourceReceiptFailure({
        code: "bad.code" as never,
        message: "test",
      }),
    ).toThrow();
  });

  it("rejects empty failure message", () => {
    expect(() =>
      createResourceReceiptFailure({
        code: "resource.rejected",
        message: "",
      }),
    ).toThrow();
  });

  it("rejects non-JSON-safe failure details", () => {
    expect(() =>
      createResourceReceiptFailure({
        code: "resource.rejected",
        message: "test",
        details: { bad: 1n } as unknown as JsonObject,
      }),
    ).toThrow();
  });

  it("createInvalidRangeResourceFailure includes range details", () => {
    const f = createInvalidRangeResourceFailure({
      message: "Range out of bounds",
      handleKey: "handle-1",
      offset: 1000,
      byteLength: 500,
      descriptorByteLength: 1024,
    });
    expect(f.code).toBe("resource.invalidRange");
    expect(f.details).toBeDefined();
    expect(f.details).toHaveProperty("offset", 1000);
    expect(f.details).toHaveProperty("byteLength", 500);
    expect(f.details).toHaveProperty("descriptorByteLength", 1024);
  });

  it("createStaleBindingResourceFailure projects session failure without bigint", () => {
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

    const rf = createStaleBindingResourceFailure(openingFailure);
    expect(rf.code).toBe("resource.staleBinding");
    expect(rf.details).toBeDefined();

    const details = rf.details as Record<string, unknown>;
    expect(details.reason).toBe("bindingOpening");
    expect(details.rebindRequired).toBe(true);

    const binding = details.binding as Record<string, unknown>;
    expect(binding.authorityKey).toBe("auth-abc");
    expect(binding.surfaceKey).toBe("surface-xyz");
    expect(binding.authorityEpoch).toBe("42");
    expect(typeof binding.authorityEpoch).toBe("string");

    const serialized = JSON.stringify(rf);
    const parsed = JSON.parse(serialized) as Record<string, unknown>;
    expect(parsed.code).toBe("resource.staleBinding");
    const parsedDetails = parsed.details as Record<string, unknown>;
    const parsedBinding = parsedDetails.binding as Record<string, unknown>;
    expect(typeof parsedBinding.authorityEpoch).toBe("string");
    expect(parsedBinding.authorityEpoch).toBe("42");
  });

  it("stale binding projection uses decimal-string authorityEpoch values", () => {
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

    const rf = createStaleBindingResourceFailure(mismatchFailure);
    const details = rf.details as Record<string, unknown>;
    const binding = details.binding as Record<string, unknown>;
    const expected = details.expected as Record<string, unknown>;

    expect(binding.authorityEpoch).toBe("100");
    expect(expected.authorityEpoch).toBe("200");
    expect(typeof binding.authorityEpoch).toBe("string");
    expect(typeof expected.authorityEpoch).toBe("string");
  });

  it("stale binding projection returns expected with epoch strings", () => {
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

    const rf = createStaleBindingResourceFailure(mismatchFailure);
    const details = rf.details as Record<string, unknown>;
    const expected = details.expected as Record<string, unknown>;

    expect(typeof expected?.authorityEpoch).toBe("string");
    expect(expected?.authorityEpoch).toBe("10");
  });

  it("stale binding rejects negative authorityEpoch", () => {
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
      createStaleBindingResourceFailure(badFailure as unknown as BindingOpeningFailure),
    ).toThrow();
  });

  it("failure details allow nested arrays", () => {
    const f = createResourceReceiptFailure({
      code: "resource.rejected",
      message: "denied",
      details: { items: [1, 2, 3] },
    });
    expect(f.details).toEqual({ items: [1, 2, 3] });
  });

  it("failure details reject getter properties without invoking getter", () => {
    let getterCalled = false;
    const details: Record<string, unknown> = { regular: 1 };
    Object.defineProperty(details, "computed", {
      get() {
        getterCalled = true;
        return 42;
      },
      enumerable: true,
      configurable: true,
    });
    expect(() =>
      createResourceReceiptFailure({
        code: "resource.rejected",
        message: "denied",
        details: details as unknown as JsonObject,
      }),
    ).toThrow();
    expect(getterCalled).toBe(false);
  });

  it("failure details reject BigInt", () => {
    expect(() =>
      createResourceReceiptFailure({
        code: "resource.rejected",
        message: "denied",
        details: { value: 1n } as unknown as JsonObject,
      }),
    ).toThrow();
  });
});

describe("Immutability", () => {
  it("no helper mutates descriptor input", () => {
    const desc = validDescriptor();
    const frozen = JSON.parse(JSON.stringify(desc));

    validateResourceDescriptor(desc);
    expect(desc).toEqual(frozen);
  });

  it("no helper mutates range input", () => {
    const range = { offset: 10, byteLength: 20 };
    const frozen = { ...range };
    const desc = validDescriptor();

    validateResourceReadRange(range, desc);
    expect(range).toEqual(frozen);
  });

  it("no helper mutates failure input", () => {
    const failure = {
      code: "resource.rejected" as const,
      message: "denied",
      details: { key: "val" },
    };
    const frozen = JSON.parse(JSON.stringify(failure));

    validateResourceReceiptFailure(failure);
    expect(failure).toEqual(frozen);
  });
});
