import {
  assertResourceDescriptorHasNoBody,
  createOpenResourceReply,
  RESOURCE_CLOSE_HANDLE_OPERATION_KEY,
  RESOURCE_CLOSE_MAPPING_OPERATION_KEY,
  RESOURCE_MAP_WINDOW_OPERATION_KEY,
  RESOURCE_OPEN_OPERATION_KEY,
  RESOURCE_READ_CHUNK_OPERATION_KEY,
} from "@exclave/resource";
import { describe, expect, it } from "vitest";
import {
  createHostAuthorityOwner,
  createHostResourcePlaneDescriptor,
  createHostSurfaceDescriptor,
  createHostSurfaceGrant,
  HOST_CONTRACT_VERSION,
} from "../src";

function assertNoByteCarrier(value: unknown, path: string): void {
  if (typeof value !== "object" || value === null) return;
  if (Array.isArray(value)) {
    for (let i = 0; i < value.length; i++) assertNoByteCarrier(value[i], `${path}[${i}]`);
    return;
  }
  for (const key of Object.keys(value)) {
    expect(key.toLowerCase()).not.toMatch(/bytes|buffer|arraybuffer|uint8array|base64|blob|raw/);
    assertNoByteCarrier((value as Record<string, unknown>)[key], `${path}.${key}`);
  }
}

describe("host-contract resource v1 crossing", () => {
  it("carries resource-plane grants as operation metadata, never bytes", () => {
    const owner = createHostAuthorityOwner({
      authorityKey: "authority.fixture",
      surfaceKey: "surface.fixture",
      authorityEpoch: "7",
    });

    const surface = createHostSurfaceDescriptor({
      kind: "host.surface",
      contractVersion: HOST_CONTRACT_VERSION,
      owner,
      resourcePlane: createHostResourcePlaneDescriptor({
        kind: "host.resourcePlane",
        openOperationKey: RESOURCE_OPEN_OPERATION_KEY,
        readChunkOperationKey: RESOURCE_READ_CHUNK_OPERATION_KEY,
        mapWindowOperationKey: RESOURCE_MAP_WINDOW_OPERATION_KEY,
        closeMappingOperationKey: RESOURCE_CLOSE_MAPPING_OPERATION_KEY,
        closeHandleOperationKey: RESOURCE_CLOSE_HANDLE_OPERATION_KEY,
      }),
    });

    const grant = createHostSurfaceGrant(surface);

    expect(grant.resourcePlane?.openOperationKey).toBe(RESOURCE_OPEN_OPERATION_KEY);
    expect(grant.resourcePlane?.readChunkOperationKey).toBe(RESOURCE_READ_CHUNK_OPERATION_KEY);
    expect(grant.resourcePlane?.mapWindowOperationKey).toBe(RESOURCE_MAP_WINDOW_OPERATION_KEY);
    expect(grant.resourcePlane?.closeMappingOperationKey).toBe(
      RESOURCE_CLOSE_MAPPING_OPERATION_KEY,
    );
    expect(grant.resourcePlane?.closeHandleOperationKey).toBe(RESOURCE_CLOSE_HANDLE_OPERATION_KEY);
    assertNoByteCarrier(grant, "grant");
  });

  it("carries open descriptors as metadata and rejects descriptor byte smuggling", () => {
    const reply = createOpenResourceReply({
      handleId: "handle-1",
      authorityEpoch: 7n,
      resourceKind: "fixture.waveform",
      resourceKey: "waveform:track-1",
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

    assertResourceDescriptorHasNoBody(reply.descriptor);
    expect(() =>
      createOpenResourceReply({
        ...reply,
        descriptor: { ...reply.descriptor, bytes: new Uint8Array([1, 2, 3]) },
      }),
    ).toThrow();
  });
});
