import type { ResourceHandle } from "@exclave/resource";
import {
  createOpenResourceReply,
  createResourceCapabilities,
  invalidateResourceHandle,
  RESOURCE_CLOSE_HANDLE_OPERATION_KEY,
  RESOURCE_CLOSE_MAPPING_OPERATION_KEY,
  RESOURCE_MAP_WINDOW_OPERATION_KEY,
  RESOURCE_OPEN_OPERATION_KEY,
  RESOURCE_PLANE_V1_OPERATION_KEYS,
  RESOURCE_READ_CHUNK_OPERATION_KEY,
  validateMapResourceWindowRequest,
  validateReadResourceChunkRequest,
  validateResourceHandleAccess,
} from "@exclave/resource";
import { describe, expect, it } from "vitest";

function fixtureHandle(): ResourceHandle {
  return {
    handleId: "handle-conformance-1",
    authorityEpoch: 3n,
    resourceKind: "fixture.waveform",
    resourceKey: "waveform:track-1",
    resourceVersion: 5n,
    capabilities: createResourceCapabilities({
      canReadChunks: true,
      canMapWindows: true,
      totalByteLength: 4096n,
      maxChunkBytes: 1024,
      maxMappedWindowBytes: 2048,
    }),
  };
}

describe("Resource Plane v1 conformance", () => {
  it("keeps resource open as metadata and establishes epoch/version without bytes", () => {
    const reply = createOpenResourceReply({
      ...fixtureHandle(),
      descriptor: {
        sampleRateHz: 48_000,
        channelCount: 2,
      },
    });

    expect(reply.handleId).toBe("handle-conformance-1");
    expect(reply.authorityEpoch).toBe(3n);
    expect(reply.resourceVersion).toBe(5n);
    expect(JSON.stringify(reply.descriptor)).not.toMatch(/bytes|buffer|base64|blob/i);
  });

  it("enforces chunk and mapping bounds before any payload allocation", () => {
    const handle = fixtureHandle();

    expect(
      validateReadResourceChunkRequest(
        {
          handleId: handle.handleId,
          authorityEpoch: handle.authorityEpoch,
          offsetBytes: 0n,
          lengthBytes: 1025,
        },
        handle,
      ),
    ).toEqual({ kind: "chunkTooLarge", requestedBytes: 1025, maxChunkBytes: 1024 });

    expect(
      validateMapResourceWindowRequest(
        {
          handleId: handle.handleId,
          authorityEpoch: handle.authorityEpoch,
          offsetBytes: 0n,
          lengthBytes: 2049,
        },
        handle,
      ),
    ).toEqual({
      kind: "mappingTooLarge",
      requestedBytes: 2049,
      maxMappedWindowBytes: 2048,
    });
  });

  it("invalidates handles by pushed event and rejects later access", () => {
    const invalidated = invalidateResourceHandle(
      { kind: "valid", handle: fixtureHandle() },
      "authorityRestart",
    );

    expect(invalidated.event.kind).toBe("resourceHandleInvalidated");
    expect(invalidated.event.reason).toBe("authorityRestart");
    expect(
      validateResourceHandleAccess(invalidated, {
        handleId: "handle-conformance-1",
        authorityEpoch: 3n,
        offsetBytes: 0n,
        lengthBytes: 64,
      }),
    ).toEqual({
      kind: "handleInvalid",
      handleId: "handle-conformance-1",
      reason: "staleEpoch",
    });
  });

  it("advertises Resource Plane v1 operations as control metadata, not body carriers", () => {
    const operationKeys = [
      RESOURCE_OPEN_OPERATION_KEY,
      RESOURCE_READ_CHUNK_OPERATION_KEY,
      RESOURCE_MAP_WINDOW_OPERATION_KEY,
      RESOURCE_CLOSE_MAPPING_OPERATION_KEY,
      RESOURCE_CLOSE_HANDLE_OPERATION_KEY,
    ];

    expect(operationKeys).toEqual([
      "resource.open",
      "resource.readChunk",
      "resource.mapWindow",
      "resource.closeMapping",
      "resource.closeHandle",
    ]);
    expect(JSON.stringify(operationKeys)).not.toMatch(/bytes|buffer|base64|blob/i);
  });

  it("resource.readRange is not a Resource Plane v1 operation", () => {
    const v1Keys = [...RESOURCE_PLANE_V1_OPERATION_KEYS];
    expect(v1Keys).not.toContain("resource.readRange");
    expect(v1Keys).toEqual([
      "resource.open",
      "resource.readChunk",
      "resource.mapWindow",
      "resource.closeMapping",
      "resource.closeHandle",
    ]);
  });

  it("v1 operation metadata does not carry byte bodies", () => {
    const operationKeys = [...RESOURCE_PLANE_V1_OPERATION_KEYS];
    expect(JSON.stringify(operationKeys)).not.toMatch(/bytes|buffer|base64|blob/i);
  });
});
