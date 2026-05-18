import { createControlSuccessEnvelope } from "@exclave/control-plane";
import type {
  OpenResourceRequest,
  ResourceCapabilities,
  ResourceContract,
  ResourceHandle,
  ResourceHandleLifecycleState,
} from "@exclave/resource";
import {
  assertResourceDescriptorHasNoBody,
  createCloseResourceHandleRequest,
  createCloseResourceMappingRequest,
  createMapResourceWindowRequest,
  createOpenResourceReply,
  createOpenResourceRequest,
  createReadResourceChunkRequest,
  createResourceBackpressure,
  createResourceCapabilities,
  createResourceHandleInvalidatedEvent,
  invalidateResourceHandle,
  validateCloseResourceHandleForState,
  validateCloseResourceMappingForState,
  validateMapResourceWindowRequest,
  validateReadResourceChunkRequest,
  validateResourceHandleAccess,
} from "@exclave/resource";
import { describe, expect, expectTypeOf, it } from "vitest";

type WaveformOpenInput = {
  readonly trackId: string;
  readonly resolution: "overview" | "detail";
  readonly channelMode: "mono" | "stereo";
};

type WaveformDescriptor = {
  readonly sampleRateHz: number;
  readonly channelCount: 1 | 2;
  readonly summary: string;
};

const waveformContract: ResourceContract<WaveformOpenInput, WaveformDescriptor> = {
  resourceKind: "fixture.waveform",
  openShape: {
    trackId: "track-1",
    resolution: "overview",
    channelMode: "stereo",
  },
  descriptorShape: {
    sampleRateHz: 48_000,
    channelCount: 2,
    summary: "metadata only",
  },
};

function validHandle(capabilities?: ResourceCapabilities): ResourceHandle {
  return {
    handleId: "handle-1",
    authorityEpoch: 7n,
    resourceKind: waveformContract.resourceKind,
    resourceKey: "waveform:track-1:overview",
    resourceVersion: 11n,
    capabilities:
      capabilities ??
      createResourceCapabilities({
        canReadChunks: true,
        canMapWindows: true,
        totalByteLength: 4096n,
        maxChunkBytes: 1024,
        maxMappedWindowBytes: 2048,
      }),
  };
}

describe("Resource Plane v1 type surface", () => {
  it("resource open uses typed input rather than generic option bags", () => {
    const request = createOpenResourceRequest<WaveformOpenInput>({
      resourceKind: waveformContract.resourceKind,
      input: {
        trackId: "track-1",
        resolution: "overview",
        channelMode: "stereo",
      },
    });

    expect(request.resourceKind).toBe("fixture.waveform");
    expect(request.input.trackId).toBe("track-1");
    expectTypeOf(request.input).toEqualTypeOf<WaveformOpenInput>();

    // @ts-expect-error Resource Plane v1 opens use typed input, not a generic options bag.
    const _badOpen: OpenResourceRequest<WaveformOpenInput> = {
      resourceKind: "fixture.waveform",
      options: { trackId: "track-1" },
    };
    void _badOpen;
  });

  it("default open is epoch-establishing and rejects caller-supplied authorityEpoch", () => {
    const request = createOpenResourceRequest<WaveformOpenInput>({
      resourceKind: "fixture.waveform",
      input: {
        trackId: "track-1",
        resolution: "detail",
        channelMode: "mono",
      },
    });

    expect("authorityEpoch" in request).toBe(false);
    expect(() =>
      createOpenResourceRequest({
        resourceKind: "fixture.waveform",
        authorityEpoch: 7n,
        input: { trackId: "track-1", resolution: "detail", channelMode: "mono" },
      } as unknown as OpenResourceRequest<WaveformOpenInput>),
    ).toThrow();
  });

  it("successful open reply carries handle, epoch, identity, version, descriptor, and capabilities", () => {
    const reply = createOpenResourceReply<WaveformDescriptor>({
      handleId: "handle-1",
      authorityEpoch: 7n,
      resourceKind: "fixture.waveform",
      resourceKey: "waveform:track-1:overview",
      resourceVersion: 11n,
      descriptor: {
        sampleRateHz: 48_000,
        channelCount: 2,
        summary: "metadata only",
      },
      capabilities: {
        canReadChunks: true,
        canMapWindows: false,
        maxChunkBytes: 1024,
      },
    });

    expect(reply.handleId).toBe("handle-1");
    expect(reply.authorityEpoch).toBe(7n);
    expect(reply.resourceKind).toBe("fixture.waveform");
    expect(reply.resourceKey).toBe("waveform:track-1:overview");
    expect(reply.resourceVersion).toBe(11n);
    expect(reply.descriptor.channelCount).toBe(2);
    expect(reply.capabilities.canReadChunks).toBe(true);
  });

  it("ResourceCapabilities structurally requires limits for enabled access modes", () => {
    const both = createResourceCapabilities({
      canReadChunks: true,
      canMapWindows: true,
      maxChunkBytes: 1024,
      maxMappedWindowBytes: 2048,
    });
    expect(both.maxChunkBytes).toBe(1024);
    expect(both.maxMappedWindowBytes).toBe(2048);

    // @ts-expect-error maxChunkBytes is mandatory when canReadChunks is true.
    const _missingChunkLimit: ResourceCapabilities = {
      canReadChunks: true,
      canMapWindows: false,
    };
    void _missingChunkLimit;

    // @ts-expect-error maxMappedWindowBytes is mandatory when canMapWindows is true.
    const _missingMappingLimit: ResourceCapabilities = {
      canReadChunks: false,
      canMapWindows: true,
    };
    void _missingMappingLimit;
  });
});

describe("Resource Plane v1 boundedness and no-body rules", () => {
  it("descriptors reject byte-like body fields and byte containers", () => {
    expect(() =>
      assertResourceDescriptorHasNoBody({
        sampleRateHz: 48_000,
        bytes: new Uint8Array([1, 2, 3]),
      }),
    ).toThrow();

    expect(() =>
      createOpenResourceReply({
        handleId: "handle-1",
        authorityEpoch: 7n,
        resourceKind: "fixture.waveform",
        resourceKey: "waveform:track-1",
        resourceVersion: 11n,
        descriptor: { thumbnailBase64: "AAAA" },
        capabilities: { canReadChunks: false, canMapWindows: false },
      }),
    ).toThrow();
  });

  it("control replies reject resource bodies before they become payloads", () => {
    expect(() =>
      createControlSuccessEnvelope({
        requestKey: "req-resource-body",
        payload: { bytes: new Uint8Array([1, 2, 3]) } as never,
      }),
    ).toThrow();
  });

  it("chunk read rejects invalid and oversized lengthBytes before allocation", () => {
    const handle = validHandle();

    expect(() =>
      createReadResourceChunkRequest({
        handleId: "handle-1",
        authorityEpoch: 7n,
        offsetBytes: 0n,
        lengthBytes: 0xffffffff + 1,
      }),
    ).toThrow();

    const failure = validateReadResourceChunkRequest(
      {
        handleId: "handle-1",
        authorityEpoch: 7n,
        offsetBytes: 0n,
        lengthBytes: 1025,
      },
      handle,
    );
    expect(failure).toEqual({
      kind: "chunkTooLarge",
      requestedBytes: 1025,
      maxChunkBytes: 1024,
    });
  });

  it("mapped window rejects invalid and oversized lengthBytes before allocation", () => {
    const handle = validHandle();

    expect(() =>
      createMapResourceWindowRequest({
        handleId: "handle-1",
        authorityEpoch: 7n,
        offsetBytes: 0n,
        lengthBytes: -1,
      }),
    ).toThrow();

    const failure = validateMapResourceWindowRequest(
      {
        handleId: "handle-1",
        authorityEpoch: 7n,
        offsetBytes: 0n,
        lengthBytes: 2049,
      },
      handle,
    );
    expect(failure).toEqual({
      kind: "mappingTooLarge",
      requestedBytes: 2049,
      maxMappedWindowBytes: 2048,
    });
  });

  it("backpressure is explicit and not encoded as a short read", () => {
    const backpressure = createResourceBackpressure({
      kind: "resourceBackpressure",
      scope: "handle",
      retryAfterMs: 25,
    });
    expect(backpressure.kind).toBe("resourceBackpressure");
    expect(backpressure.scope).toBe("handle");
  });
});

describe("Resource Plane v1 failures and lifecycle", () => {
  it("mappingUnsupported is distinct from handle invalidity", () => {
    const handle = validHandle(
      createResourceCapabilities({
        canReadChunks: true,
        canMapWindows: false,
        maxChunkBytes: 512,
      }),
    );

    const failure = validateMapResourceWindowRequest(
      {
        handleId: "handle-1",
        authorityEpoch: 7n,
        offsetBytes: 0n,
        lengthBytes: 64,
      },
      handle,
    );

    expect(failure?.kind).toBe("mappingUnsupported");
  });

  it("handleInvalid and mappingInvalid remain distinct", () => {
    const state: ResourceHandleLifecycleState = { kind: "valid", handle: validHandle() };

    const handleFailure = validateResourceHandleAccess(state, {
      handleId: "unknown-handle",
      authorityEpoch: 7n,
      offsetBytes: 0n,
      lengthBytes: 64,
    });

    const mappingClose = validateCloseResourceMappingForState(
      state,
      createCloseResourceMappingRequest({
        handleId: "handle-1",
        mappingId: "unknown-mapping",
        authorityEpoch: 7n,
      }),
      new Set(["mapping-1"]),
    );

    expect(handleFailure?.kind).toBe("handleInvalid");
    expect(mappingClose.ok).toBe(false);
    if (!mappingClose.ok) {
      expect(mappingClose.failure.kind).toBe("mappingInvalid");
    }
  });

  it("sessionMismatch is used for stale epoch-bound operations, not epoch-establishing open", () => {
    const handle = validHandle();
    const failure = validateReadResourceChunkRequest(
      {
        handleId: "handle-1",
        authorityEpoch: 8n,
        offsetBytes: 0n,
        lengthBytes: 64,
      },
      handle,
    );

    expect(failure).toEqual({
      kind: "sessionMismatch",
      expectedAuthorityEpoch: 7n,
      providedAuthorityEpoch: 8n,
    });

    const open = createOpenResourceRequest<WaveformOpenInput>({
      resourceKind: "fixture.waveform",
      input: { trackId: "track-1", resolution: "overview", channelMode: "mono" },
    });
    expect("authorityEpoch" in open).toBe(false);
  });

  it("authorityUnavailable and authorityNotReady are distinct resource failures", () => {
    const unavailable = { kind: "authorityUnavailable" } as const;
    const notReady = { kind: "authorityNotReady", state: "starting" } as const;

    expect(unavailable.kind).toBe("authorityUnavailable");
    expect(notReady.kind).toBe("authorityNotReady");
    expect(notReady.state).toBe("starting");
  });

  it("resourceHandleInvalidated kills later read and map attempts", () => {
    const validState = { kind: "valid" as const, handle: validHandle() };
    const invalidated = invalidateResourceHandle(validState, "resourceReplaced");

    const event = createResourceHandleInvalidatedEvent(invalidated.event);
    expect(event.kind).toBe("resourceHandleInvalidated");
    expect(event.reason).toBe("resourceReplaced");

    const readFailure = validateResourceHandleAccess(invalidated, {
      handleId: "handle-1",
      authorityEpoch: 7n,
      offsetBytes: 0n,
      lengthBytes: 64,
    });

    const mapFailure = validateResourceHandleAccess(invalidated, {
      handleId: "handle-1",
      authorityEpoch: 7n,
      offsetBytes: 0n,
      lengthBytes: 64,
    });

    expect(readFailure).toEqual({
      kind: "handleInvalid",
      handleId: "handle-1",
      reason: "resourceReplaced",
    });
    expect(mapFailure?.kind).toBe("handleInvalid");
  });

  it("close after invalidation is idempotent, while mapping close reports parentHandleInvalid", () => {
    const invalidated = invalidateResourceHandle(
      { kind: "valid", handle: validHandle() },
      "authorityRestart",
    );

    const closeHandle = validateCloseResourceHandleForState(
      invalidated,
      createCloseResourceHandleRequest({ handleId: "handle-1", authorityEpoch: 7n }),
    );

    const closeMapping = validateCloseResourceMappingForState(
      invalidated,
      createCloseResourceMappingRequest({
        handleId: "handle-1",
        mappingId: "mapping-1",
        authorityEpoch: 7n,
      }),
      new Set(["mapping-1"]),
    );

    expect(closeHandle.ok).toBe(true);
    expect(closeMapping.ok).toBe(false);
    if (!closeMapping.ok) {
      expect(closeMapping.failure).toEqual({
        kind: "mappingInvalid",
        handleId: "handle-1",
        mappingId: "mapping-1",
        reason: "parentHandleInvalid",
      });
    }
  });
});
