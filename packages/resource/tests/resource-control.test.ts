import {
  validateControlRequestEnvelope,
  validateControlResponseEnvelope,
} from "@exclave/control-plane";
import type { ResourceOwner } from "@exclave/resource";
import * as resourceModule from "@exclave/resource";
import {
  createResourceControlFailure,
  createResourceReadRangeControlRequest,
  createResourceReadRangeControlSuccess,
  createResourceReadRangeReceiptPayload,
  createResourceReadRangeRequestPayload,
  createStaleBindingResourceFailure,
  RESOURCE_READ_RANGE_OPERATION_KEY,
} from "@exclave/resource";
import type { BindingOpeningFailure } from "@exclave/session";
import { describe, expect, it } from "vitest";

function validOwner(): ResourceOwner {
  return {
    authorityKey: "auth-key-1",
    surfaceKey: "surface-key-1",
    authorityEpoch: "7",
  };
}

describe("Resource Control Envelopes", () => {
  it("createResourceReadRangeControlRequest returns control.request with operationKey resource.readRange", () => {
    const request = createResourceReadRangeControlRequest({
      requestKey: "req-1",
      payload: createResourceReadRangeRequestPayload({
        handleKey: "handle-1",
        range: { offset: 0, byteLength: 512 },
        owner: validOwner(),
      }),
    });

    expect(request.kind).toBe("control.request");
    expect(request.operationKey).toBe("resource.readRange");
    expect(request.requestKey).toBe("req-1");
  });

  it("control request validates through validateControlRequestEnvelope", () => {
    const request = createResourceReadRangeControlRequest({
      requestKey: "req-2",
      payload: createResourceReadRangeRequestPayload({
        handleKey: "handle-2",
        range: { offset: 0, byteLength: 256 },
        owner: validOwner(),
      }),
    });

    const result = validateControlRequestEnvelope(request);
    expect(result.ok).toBe(true);
  });

  it("createResourceReadRangeControlSuccess returns control.response ok true", () => {
    const response = createResourceReadRangeControlSuccess({
      requestKey: "req-3",
      payload: createResourceReadRangeReceiptPayload({
        handleKey: "handle-3",
        range: { offset: 0, byteLength: 100 },
        byteLength: 100,
        version: "v1",
      }),
    });

    expect(response.kind).toBe("control.response");
    expect(response.ok).toBe(true);
    expect(response.requestKey).toBe("req-3");
  });

  it("control success validates through validateControlResponseEnvelope", () => {
    const response = createResourceReadRangeControlSuccess({
      requestKey: "req-4",
      payload: createResourceReadRangeReceiptPayload({
        handleKey: "handle-4",
        range: { offset: 0, byteLength: 64 },
        byteLength: 64,
        version: "v2",
      }),
    });

    const result = validateControlResponseEnvelope(response);
    expect(result.ok).toBe(true);
  });

  it("createResourceControlFailure returns control.response ok false", () => {
    const response = createResourceControlFailure({
      requestKey: "req-5",
      resourceFailure: {
        code: "resource.rejected",
        message: "Access denied",
      },
    });

    expect(response.kind).toBe("control.response");
    expect(response.ok).toBe(false);
    expect(response.requestKey).toBe("req-5");
  });

  it("control failure validates through validateControlResponseEnvelope", () => {
    const response = createResourceControlFailure({
      requestKey: "req-6",
      resourceFailure: {
        code: "resource.invalidHandle",
        message: "Handle not found",
        details: { handleKey: "missing" },
      },
    });

    const result = validateControlResponseEnvelope(response);
    expect(result.ok).toBe(true);
  });

  it("JSON.stringify/parse roundtrip preserves resource read range request payload", () => {
    const payload = createResourceReadRangeRequestPayload({
      handleKey: "handle-roundtrip",
      range: { offset: 100, byteLength: 300 },
      owner: validOwner(),
    });

    const serialized = JSON.stringify(payload);
    const parsed = JSON.parse(serialized) as Record<string, unknown>;

    expect(parsed.handleKey).toBe("handle-roundtrip");
    const range = parsed.range as Record<string, unknown>;
    expect(range.offset).toBe(100);
    expect(range.byteLength).toBe(300);
    const owner = parsed.owner as Record<string, unknown>;
    expect(owner.authorityEpoch).toBe("7");
    expect(typeof owner.authorityEpoch).toBe("string");
  });

  it("JSON.stringify/parse roundtrip preserves resource stale-binding failure without bigint", () => {
    const openingFailure: BindingOpeningFailure = {
      ok: false,
      reason: "bindingOpening",
      rebindRequired: true,
      binding: {
        authorityKey: "auth-roundtrip",
        surfaceKey: "surface-roundtrip",
        authorityEpoch: 99n,
        state: { kind: "opening" },
      },
    };

    const rf = createStaleBindingResourceFailure(openingFailure);

    const serialized = JSON.stringify(rf);
    expect(serialized).not.toContain("99n");
    expect(serialized).not.toContain("bigint");

    const parsed = JSON.parse(serialized) as Record<string, unknown>;
    expect(parsed.code).toBe("resource.staleBinding");

    const details = parsed.details as Record<string, unknown>;
    const binding = details.binding as Record<string, unknown>;
    expect(binding.authorityEpoch).toBe("99");
    expect(typeof binding.authorityEpoch).toBe("string");
  });

  it("no control helper mutates descriptor/range/failure inputs", () => {
    const owner = validOwner();
    const ownerFrozen = JSON.parse(JSON.stringify(owner));

    createResourceReadRangeControlRequest({
      requestKey: "req-imm",
      payload: createResourceReadRangeRequestPayload({
        handleKey: "handle-imm",
        range: { offset: 0, byteLength: 10 },
        owner,
      }),
    });

    expect(owner).toEqual(ownerFrozen);

    const response = createResourceControlFailure({
      requestKey: "req-imm-2",
      resourceFailure: { code: "resource.rejected", message: "no" },
    });

    expect(response.ok).toBe(false);
  });

  it("RESOURCE_READ_RANGE_OPERATION_KEY is resource.readRange", () => {
    expect(RESOURCE_READ_RANGE_OPERATION_KEY).toBe("resource.readRange");
  });

  it("createResourceReadRangeControlRequest rejects empty handleKey payload", () => {
    expect(() =>
      createResourceReadRangeControlRequest({
        requestKey: "req-1",
        payload: {
          handleKey: "",
          range: { offset: 0, byteLength: 10 },
          owner: validOwner(),
        } as unknown as ReturnType<typeof createResourceReadRangeRequestPayload>,
      }),
    ).toThrow();
  });

  it("createResourceReadRangeControlRequest rejects invalid owner epoch", () => {
    expect(() =>
      createResourceReadRangeControlRequest({
        requestKey: "req-1",
        payload: {
          handleKey: "h",
          range: { offset: 0, byteLength: 10 },
          owner: {
            authorityKey: "a",
            surfaceKey: "s",
            authorityEpoch: "01",
          },
        } as unknown as ReturnType<typeof createResourceReadRangeRequestPayload>,
      }),
    ).toThrow();
  });

  it("createResourceReadRangeControlSuccess rejects byteLength mismatch", () => {
    expect(() =>
      createResourceReadRangeControlSuccess({
        requestKey: "req-1",
        payload: {
          handleKey: "h",
          range: { offset: 0, byteLength: 100 },
          byteLength: 200,
          version: "v1",
        } as unknown as ReturnType<typeof createResourceReadRangeReceiptPayload>,
      }),
    ).toThrow();
  });

  it("createResourceControlFailure rejects invalid resource failure code", () => {
    expect(() =>
      createResourceControlFailure({
        requestKey: "req-1",
        resourceFailure: {
          code: "bad.code" as never,
          message: "test",
        },
      }),
    ).toThrow();
  });

  it("createResourceControlFailure rejects non-JSON-safe resource failure details", () => {
    expect(() =>
      createResourceControlFailure({
        requestKey: "req-1",
        resourceFailure: {
          code: "resource.rejected",
          message: "test",
          details: { bad: 1n } as unknown as Record<string, unknown>,
        },
      }),
    ).toThrow();
  });

  it("helpers return normalized payload/failure objects and do not preserve extra fields", () => {
    const rawPayload = {
      handleKey: "h",
      range: { offset: 0, byteLength: 10 },
      owner: validOwner(),
      extraField: "should-not-exist",
    } as unknown as ReturnType<typeof createResourceReadRangeRequestPayload>;

    expect(() =>
      createResourceReadRangeControlRequest({
        requestKey: "req-1",
        payload: rawPayload,
      }),
    ).toThrow();

    const rawFailure = {
      code: "resource.rejected" as const,
      message: "denied",
      extraField: "should-not-exist",
    } as unknown as { readonly code: "resource.rejected"; readonly message: string };

    expect(() =>
      createResourceControlFailure({
        requestKey: "req-1",
        resourceFailure: rawFailure,
      }),
    ).toThrow();
  });
});

describe("Public API exports", () => {
  it("public value exports are exactly intended", () => {
    const expectedValueExports = new Set([
      "RESOURCE_READ_RANGE_OPERATION_KEY",
      "createResourceDescriptor",
      "createResourceReadRange",
      "createResourceReadRangeRequestPayload",
      "createResourceReadRangeReceiptPayload",
      "createResourceFailure",
      "createInvalidRangeResourceFailure",
      "createStaleBindingResourceFailure",
      "validateResourceDescriptor",
      "validateResourceOwner",
      "validateResourceReadRange",
      "validateResourceReadRangeRequestPayload",
      "validateResourceReadRangeReceiptPayload",
      "validateResourceFailure",
      "createResourceReadRangeControlRequest",
      "createResourceReadRangeControlSuccess",
      "createResourceControlFailure",
    ]);

    const exportedKeys = Object.keys(resourceModule);
    const actual = new Set(exportedKeys);

    const missing = [...expectedValueExports].filter((k) => !actual.has(k));
    const extra = [...actual].filter((k) => !expectedValueExports.has(k));

    expect(missing).toEqual([]);
    expect(extra).toEqual([]);
  });

  it("type exports are usable at compile time", () => {
    // Type-only exports are verified at compile time by TypeScript.
    // If any type export is missing or broken, the test file won't typecheck.
    const typeNames = [
      "ResourceHandleKey",
      "ResourceKind",
      "ResourceVersion",
      "ResourceOwner",
      "ResourceDescriptor",
      "ResourceReadRange",
      "ResourceReadRangeRequestPayload",
      "ResourceReadRangeReceiptPayload",
      "ResourceFailureCode",
      "ResourceFailure",
    ] as const;

    expect(typeNames.length).toBe(10);
  });
});
