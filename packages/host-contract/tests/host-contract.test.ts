import type { JsonObject } from "@exclave/base";
import { CONTROL_ENVELOPE_VERSION } from "@exclave/control-plane";
import {
  RESOURCE_CLOSE_HANDLE_OPERATION_KEY,
  RESOURCE_CLOSE_MAPPING_OPERATION_KEY,
  RESOURCE_MAP_WINDOW_OPERATION_KEY,
  RESOURCE_OPEN_OPERATION_KEY,
  RESOURCE_READ_CHUNK_OPERATION_KEY,
} from "@exclave/resource";
import type { AuthorityBinding } from "@exclave/session";
import { createAuthorityBinding } from "@exclave/session";
import { describe, expect, expectTypeOf, it } from "vitest";
import * as hostContract from "../src/index";
import {
  createBindingExpectationFromHostOwner,
  createHostAuthorityOwner,
  createHostAuthorityOwnerFromBinding,
  createHostContractFailure,
  createHostControlPlaneDescriptor,
  createHostHotRegionDescriptor,
  createHostResourcePlaneDescriptor,
  createHostSurfaceDescriptor,
  createHostSurfaceGrant,
  createHostSurfaceInvalidatedEnvelope,
  createHostSurfaceReadyEnvelope,
  createHostWarmStreamDescriptor,
  HOST_CONTRACT_VERSION,
  HOST_WARM_STREAM_DESCRIPTOR_VERSION,
  type HostAuthorityOwner,
  type HostContractFailureCode,
  type HostContractVersion,
  type HostControlPlaneDescriptor,
  type HostHotBlockAExpectation,
  type HostHotRegionDescriptor,
  type HostResourcePlaneDescriptor,
  type HostSurfaceDescriptor,
  type HostWarmStreamDescriptor,
  type HostWarmStreamDescriptorVersion,
  validateHostAuthorityOwner,
  validateHostContractFailure,
  validateHostControlPlaneDescriptor,
  validateHostHotRegionDescriptor,
  validateHostResourcePlaneDescriptor,
  validateHostSurfaceDescriptor,
  validateHostSurfaceInvalidatedEnvelope,
  validateHostSurfaceReadyEnvelope,
  validateHostWarmStreamDescriptor,
} from "../src/index";

function validOwner(): HostAuthorityOwner {
  return {
    authorityKey: "auth-1",
    surfaceKey: "surf-1",
    authorityEpoch: "42",
  };
}

function validBlockA(): HostHotBlockAExpectation {
  return {
    contractKey: "contract-1",
    instanceKey: "instance-1",
    semanticVersion: "1",
    hotLayoutVersion: "2",
    fieldCount: 3,
    mutableRegionByteLength: 1024,
  };
}

function validHotRegion(): HostHotRegionDescriptor {
  return {
    kind: "host.hotRegion",
    hotRegionKey: "hr-1",
    blockA: validBlockA(),
    totalRegionByteLength: 4096,
    seqlockOffset: 0,
  };
}

function validControl(): HostControlPlaneDescriptor {
  return {
    kind: "host.controlPlane",
    envelopeVersion: CONTROL_ENVELOPE_VERSION,
    endpointKey: "ep-1",
    operationKeys: ["op.1", "op.2"],
  };
}

function validWarmStream(): HostWarmStreamDescriptor {
  return {
    kind: "host.warmStream",
    descriptorVersion: HOST_WARM_STREAM_DESCRIPTOR_VERSION,
    streamKey: "ws-1",
  };
}

function validResourcePlane(): HostResourcePlaneDescriptor {
  return {
    kind: "host.resourcePlane",
    openOperationKey: RESOURCE_OPEN_OPERATION_KEY,
    readChunkOperationKey: RESOURCE_READ_CHUNK_OPERATION_KEY,
    mapWindowOperationKey: RESOURCE_MAP_WINDOW_OPERATION_KEY,
    closeMappingOperationKey: RESOURCE_CLOSE_MAPPING_OPERATION_KEY,
    closeHandleOperationKey: RESOURCE_CLOSE_HANDLE_OPERATION_KEY,
  };
}

function validSurface(): HostSurfaceDescriptor {
  return {
    kind: "host.surface",
    contractVersion: HOST_CONTRACT_VERSION,
    owner: validOwner(),
    hotRegions: [validHotRegion()],
    control: validControl(),
    warmStreams: [validWarmStream()],
    resourcePlane: validResourcePlane(),
  };
}

describe("@exclave/host-contract public exports", () => {
  it("exports HOST_CONTRACT_VERSION = 1", () => {
    expect(HOST_CONTRACT_VERSION).toBe(1);
  });

  it("exports intended types", () => {
    expectTypeOf<HostContractVersion>().toEqualTypeOf<1>();
    expectTypeOf<HostContractFailureCode>().toEqualTypeOf<
      "host-contract.invalidDescriptor" | "host-contract.rejected"
    >();
    expectTypeOf<HostWarmStreamDescriptorVersion>().toEqualTypeOf<1>();
  });

  it("exports HOST_WARM_STREAM_DESCRIPTOR_VERSION", () => {
    expect(HOST_WARM_STREAM_DESCRIPTOR_VERSION).toBe(1);
  });

  it("exports intended functions", () => {
    expect(typeof hostContract.createHostAuthorityOwner).toBe("function");
    expect(typeof hostContract.validateHostAuthorityOwner).toBe("function");
    expect(typeof hostContract.createHostAuthorityOwnerFromBinding).toBe("function");
    expect(typeof hostContract.createHostHotRegionDescriptor).toBe("function");
    expect(typeof hostContract.validateHostHotRegionDescriptor).toBe("function");
    expect(typeof hostContract.createHostControlPlaneDescriptor).toBe("function");
    expect(typeof hostContract.validateHostControlPlaneDescriptor).toBe("function");
    expect(typeof hostContract.createHostWarmStreamDescriptor).toBe("function");
    expect(typeof hostContract.validateHostWarmStreamDescriptor).toBe("function");
    expect(typeof hostContract.createHostResourcePlaneDescriptor).toBe("function");
    expect(typeof hostContract.validateHostResourcePlaneDescriptor).toBe("function");
    expect(typeof hostContract.createHostSurfaceDescriptor).toBe("function");
    expect(typeof hostContract.validateHostSurfaceDescriptor).toBe("function");
    expect(typeof hostContract.createHostSurfaceReadyEnvelope).toBe("function");
    expect(typeof hostContract.validateHostSurfaceReadyEnvelope).toBe("function");
    expect(typeof hostContract.createHostSurfaceInvalidatedEnvelope).toBe("function");
    expect(typeof hostContract.validateHostSurfaceInvalidatedEnvelope).toBe("function");
    expect(typeof hostContract.createHostContractFailure).toBe("function");
    expect(typeof hostContract.validateHostContractFailure).toBe("function");
  });
});

describe("HostAuthorityOwner", () => {
  it("createHostAuthorityOwner accepts valid owner", () => {
    const owner = createHostAuthorityOwner(validOwner());
    expect(owner.authorityKey).toBe("auth-1");
    expect(owner.surfaceKey).toBe("surf-1");
    expect(owner.authorityEpoch).toBe("42");
  });

  it("createHostAuthorityOwnerFromBinding converts bigint authorityEpoch to decimal string", () => {
    const binding: AuthorityBinding = createAuthorityBinding({
      authorityKey: "auth-1",
      surfaceKey: "surf-1",
      authorityEpoch: 9007199254740993n,
    });
    const owner = createHostAuthorityOwnerFromBinding(binding);
    expect(owner.authorityKey).toBe("auth-1");
    expect(owner.surfaceKey).toBe("surf-1");
    expect(owner.authorityEpoch).toBe("9007199254740993");
  });

  it("rejects number authorityEpoch", () => {
    const result = validateHostAuthorityOwner({
      authorityKey: "auth-1",
      surfaceKey: "surf-1",
      authorityEpoch: 42,
    });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.failure.code).toBe("host-contract.invalidDescriptor");
      expect(result.failure.message).toContain("must be a string");
    }
  });

  it("rejects bigint authorityEpoch", () => {
    const result = validateHostAuthorityOwner({
      authorityKey: "auth-1",
      surfaceKey: "surf-1",
      authorityEpoch: 42n,
    });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.failure.code).toBe("host-contract.invalidDescriptor");
    }
  });

  it("accepts canonical decimal strings", () => {
    const accepted = ["0", "1", "42", "9007199254740993"];
    for (const epoch of accepted) {
      const result = validateHostAuthorityOwner({
        authorityKey: "auth-1",
        surfaceKey: "surf-1",
        authorityEpoch: epoch,
      });
      expect(result.ok).toBe(true);
    }
  });

  it("rejects invalid decimal strings", () => {
    const rejected = ["", "-1", "+1", "01", "1.0", "1n", "abc"];
    for (const epoch of rejected) {
      const result = validateHostAuthorityOwner({
        authorityKey: "auth-1",
        surfaceKey: "surf-1",
        authorityEpoch: epoch,
      });
      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.failure.code).toBe("host-contract.invalidDescriptor");
      }
    }
  });

  it("rejects extra keys and symbol keys", () => {
    const obj = {
      authorityKey: "auth-1",
      surfaceKey: "surf-1",
      authorityEpoch: "0",
      extra: true,
    };
    const result = validateHostAuthorityOwner(obj);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.failure.code).toBe("host-contract.invalidDescriptor");
      expect(result.failure.message).toContain("extra field");
    }

    const resultSymbol = validateHostAuthorityOwner({
      authorityKey: "auth-1",
      surfaceKey: "surf-1",
      authorityEpoch: "0",
      [Symbol("x")]: 1,
    });
    expect(resultSymbol.ok).toBe(false);
    if (!resultSymbol.ok) {
      expect(resultSymbol.failure.code).toBe("host-contract.invalidDescriptor");
    }
  });

  it("rejects class instance and accessor/getter input", () => {
    class FakeOwner {
      authorityKey = "auth-1";
      surfaceKey = "surf-1";
      get authorityEpoch() {
        return "0";
      }
    }
    const result = validateHostAuthorityOwner(new FakeOwner());
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.failure.code).toBe("host-contract.invalidDescriptor");
    }
  });

  it("create does not mutate input object", () => {
    const input = validOwner();
    const frozen = { ...input };
    createHostAuthorityOwner(input);
    expect(input).toEqual(frozen);
  });

  it("accepts 0n, 1n, 42n, and 9007199254740993n from binding", () => {
    for (const epoch of [0n, 1n, 42n, 9007199254740993n]) {
      const binding = createAuthorityBinding({
        authorityKey: "auth-1",
        surfaceKey: "surf-1",
        authorityEpoch: epoch,
      });
      const owner = createHostAuthorityOwnerFromBinding(binding);
      expect(owner.authorityEpoch).toBe(String(epoch));
    }
  });

  it("rejects -1n from binding", () => {
    const binding = createAuthorityBinding({
      authorityKey: "auth-1",
      surfaceKey: "surf-1",
      authorityEpoch: -1n,
    });
    expect(() => createHostAuthorityOwnerFromBinding(binding)).toThrow();
  });

  it("owner-from-binding output authorityEpoch is a string", () => {
    const binding = createAuthorityBinding({
      authorityKey: "auth-1",
      surfaceKey: "surf-1",
      authorityEpoch: 42n,
    });
    const owner = createHostAuthorityOwnerFromBinding(binding);
    expect(typeof owner.authorityEpoch).toBe("string");
  });

  it("owner-from-binding output does not include state", () => {
    const binding = createAuthorityBinding({
      authorityKey: "auth-1",
      surfaceKey: "surf-1",
      authorityEpoch: 42n,
    });
    const owner = createHostAuthorityOwnerFromBinding(binding);
    expect((owner as Record<string, unknown>).state).toBeUndefined();
  });
});

describe("HostHotRegionDescriptor", () => {
  it("accepts valid hot region descriptor", () => {
    const region = createHostHotRegionDescriptor(validHotRegion());
    expect(region.kind).toBe("host.hotRegion");
    expect(region.hotRegionKey).toBe("hr-1");
    expect(region.blockA.contractKey).toBe("contract-1");
    expect(region.blockA.fieldCount).toBe(3);
    expect(region.totalRegionByteLength).toBe(4096);
    expect(region.seqlockOffset).toBe(0);
  });

  it("rejects byte-like fields", () => {
    const input = {
      ...validHotRegion(),
      bytes: "raw byte field",
    } as unknown as HostHotRegionDescriptor;
    const result = validateHostHotRegionDescriptor(input);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.failure.code).toBe("host-contract.invalidDescriptor");
    }
  });

  it("rejects missing/empty hotRegionKey", () => {
    const result = validateHostHotRegionDescriptor({
      kind: "host.hotRegion",
      blockA: validBlockA(),
      totalRegionByteLength: 4096,
      seqlockOffset: 0,
    });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.failure.code).toBe("host-contract.invalidDescriptor");
    }

    const resultEmpty = validateHostHotRegionDescriptor({
      kind: "host.hotRegion",
      hotRegionKey: "",
      blockA: validBlockA(),
      totalRegionByteLength: 4096,
      seqlockOffset: 0,
    });
    expect(resultEmpty.ok).toBe(false);
    if (!resultEmpty.ok) {
      expect(resultEmpty.failure.code).toBe("host-contract.invalidDescriptor");
    }
  });

  it("rejects bigint semanticVersion/hotLayoutVersion", () => {
    const result = validateHostHotRegionDescriptor({
      ...validHotRegion(),
      blockA: { ...validBlockA(), semanticVersion: 1n },
    });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.failure.code).toBe("host-contract.invalidDescriptor");
    }

    const result2 = validateHostHotRegionDescriptor({
      ...validHotRegion(),
      blockA: { ...validBlockA(), hotLayoutVersion: 2n },
    });
    expect(result2.ok).toBe(false);
    if (!result2.ok) {
      expect(result2.failure.code).toBe("host-contract.invalidDescriptor");
    }
  });

  it("accepts semanticVersion/hotLayoutVersion as canonical decimal strings", () => {
    const result = validateHostHotRegionDescriptor({
      ...validHotRegion(),
      blockA: { ...validBlockA(), semanticVersion: "1", hotLayoutVersion: "2" },
    });
    expect(result.ok).toBe(true);
  });

  it("rejects invalid decimal strings in blockA", () => {
    const result = validateHostHotRegionDescriptor({
      ...validHotRegion(),
      blockA: { ...validBlockA(), semanticVersion: "-1" },
    });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.failure.code).toBe("host-contract.invalidDescriptor");
    }
  });

  it("rejects invalid totalRegionByteLength", () => {
    const result = validateHostHotRegionDescriptor({
      ...validHotRegion(),
      totalRegionByteLength: 0,
    });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.failure.code).toBe("host-contract.invalidDescriptor");
      expect(result.failure.message).toContain("positive");
    }
  });

  it("rejects invalid seqlockOffset", () => {
    const result = validateHostHotRegionDescriptor({
      ...validHotRegion(),
      seqlockOffset: 5000,
    });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.failure.code).toBe("host-contract.invalidDescriptor");
      expect(result.failure.message).toContain("within");
    }
  });

  it("rejects publicationSequenceOffset out of range", () => {
    const result = validateHostHotRegionDescriptor({
      ...validHotRegion(),
      publicationSequenceOffset: 5000,
    });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.failure.code).toBe("host-contract.invalidDescriptor");
      expect(result.failure.message).toContain("within");
    }
  });

  it("rejects extra fields", () => {
    const obj = { ...validHotRegion(), extra: true } as unknown;
    const result = validateHostHotRegionDescriptor(obj);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.failure.code).toBe("host-contract.invalidDescriptor");
      expect(result.failure.message).toContain("extra field");
    }
  });

  it("create does not mutate input object", () => {
    const input = validHotRegion();
    const frozen = JSON.parse(JSON.stringify(input));
    createHostHotRegionDescriptor(input);
    expect(input).toEqual(frozen);
  });

  it("seqlockOffset at totalRegionByteLength - 8 is accepted", () => {
    const result = validateHostHotRegionDescriptor({
      ...validHotRegion(),
      totalRegionByteLength: 4096,
      seqlockOffset: 4088,
    });
    expect(result.ok).toBe(true);
  });

  it("seqlockOffset aligned but too large is rejected", () => {
    const result = validateHostHotRegionDescriptor({
      ...validHotRegion(),
      totalRegionByteLength: 4096,
      seqlockOffset: 4096,
    });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.failure.code).toBe("host-contract.invalidDescriptor");
      expect(result.failure.message).toContain("8-byte counter");
    }
  });

  it("publicationSequenceOffset at totalRegionByteLength - 8 is accepted", () => {
    const result = validateHostHotRegionDescriptor({
      ...validHotRegion(),
      totalRegionByteLength: 4096,
      seqlockOffset: 0,
      publicationSequenceOffset: 4088,
    });
    expect(result.ok).toBe(true);
  });

  it("publicationSequenceOffset aligned but too large is rejected", () => {
    const result = validateHostHotRegionDescriptor({
      ...validHotRegion(),
      totalRegionByteLength: 4096,
      seqlockOffset: 0,
      publicationSequenceOffset: 4096,
    });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.failure.code).toBe("host-contract.invalidDescriptor");
      expect(result.failure.message).toContain("8-byte counter");
    }
  });

  it("overlapping aligned seqlock and publicationSequence counter ranges are rejected", () => {
    const result = validateHostHotRegionDescriptor({
      ...validHotRegion(),
      totalRegionByteLength: 4096,
      seqlockOffset: 0,
      publicationSequenceOffset: 0,
    });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.failure.code).toBe("host-contract.invalidDescriptor");
      expect(result.failure.message).toContain("overlap");
    }
  });

  it("adjacent counter ranges are accepted", () => {
    const result = validateHostHotRegionDescriptor({
      ...validHotRegion(),
      totalRegionByteLength: 4096,
      seqlockOffset: 0,
      publicationSequenceOffset: 8,
    });
    expect(result.ok).toBe(true);
  });

  it("seqlockOffset aligned to 8 is accepted", () => {
    const result = validateHostHotRegionDescriptor({
      ...validHotRegion(),
      totalRegionByteLength: 4096,
      seqlockOffset: 8,
    });
    expect(result.ok).toBe(true);
  });

  it("seqlockOffset 1 is rejected for misalignment", () => {
    const result = validateHostHotRegionDescriptor({
      ...validHotRegion(),
      totalRegionByteLength: 4096,
      seqlockOffset: 1,
    });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.failure.code).toBe("host-contract.invalidDescriptor");
      expect(result.failure.message).toContain("multiple of 8");
    }
  });

  it("publicationSequenceOffset aligned to 8 is accepted", () => {
    const result = validateHostHotRegionDescriptor({
      ...validHotRegion(),
      totalRegionByteLength: 4096,
      seqlockOffset: 0,
      publicationSequenceOffset: 16,
    });
    expect(result.ok).toBe(true);
  });

  it("publicationSequenceOffset 9 is rejected for misalignment", () => {
    const result = validateHostHotRegionDescriptor({
      ...validHotRegion(),
      totalRegionByteLength: 4096,
      seqlockOffset: 0,
      publicationSequenceOffset: 9,
    });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.failure.code).toBe("host-contract.invalidDescriptor");
      expect(result.failure.message).toContain("multiple of 8");
    }
  });
});

describe("HostControlPlaneDescriptor", () => {
  it("accepts valid control descriptor", () => {
    const ctrl = createHostControlPlaneDescriptor(validControl());
    expect(ctrl.kind).toBe("host.controlPlane");
    expect(ctrl.endpointKey).toBe("ep-1");
    expect(ctrl.operationKeys).toEqual(["op.1", "op.2"]);
  });

  it("requires CONTROL_ENVELOPE_VERSION", () => {
    const result = validateHostControlPlaneDescriptor({
      kind: "host.controlPlane",
      envelopeVersion: 999,
      endpointKey: "ep-1",
      operationKeys: ["op.1"],
    });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.failure.code).toBe("host-contract.invalidDescriptor");
      expect(result.failure.message).toContain("envelopeVersion");
    }
  });

  it("rejects empty endpointKey", () => {
    const result = validateHostControlPlaneDescriptor({
      kind: "host.controlPlane",
      envelopeVersion: CONTROL_ENVELOPE_VERSION,
      endpointKey: "",
      operationKeys: ["op.1"],
    });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.failure.code).toBe("host-contract.invalidDescriptor");
    }
  });

  it("rejects empty operationKeys", () => {
    const result = validateHostControlPlaneDescriptor({
      kind: "host.controlPlane",
      envelopeVersion: CONTROL_ENVELOPE_VERSION,
      endpointKey: "ep-1",
      operationKeys: [],
    });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.failure.code).toBe("host-contract.invalidDescriptor");
    }
  });

  it("rejects empty operation key", () => {
    const result = validateHostControlPlaneDescriptor({
      kind: "host.controlPlane",
      envelopeVersion: CONTROL_ENVELOPE_VERSION,
      endpointKey: "ep-1",
      operationKeys: [""],
    });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.failure.code).toBe("host-contract.invalidDescriptor");
    }
  });

  it("rejects extra fields", () => {
    const obj = {
      kind: "host.controlPlane",
      envelopeVersion: CONTROL_ENVELOPE_VERSION,
      endpointKey: "ep-1",
      operationKeys: ["op.1"],
      extra: true,
    };
    const result = validateHostControlPlaneDescriptor(obj);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.failure.code).toBe("host-contract.invalidDescriptor");
    }
  });
});

describe("HostWarmStreamDescriptor", () => {
  it("accepts valid warm stream descriptor", () => {
    const ws = createHostWarmStreamDescriptor(validWarmStream());
    expect(ws.kind).toBe("host.warmStream");
    expect(ws.streamKey).toBe("ws-1");
  });

  it("requires HOST_WARM_STREAM_DESCRIPTOR_VERSION", () => {
    const result = validateHostWarmStreamDescriptor({
      kind: "host.warmStream",
      descriptorVersion: 999,
      streamKey: "ws-1",
    });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.failure.code).toBe("host-contract.invalidDescriptor");
    }
  });

  it("rejects empty streamKey", () => {
    const result = validateHostWarmStreamDescriptor({
      kind: "host.warmStream",
      descriptorVersion: HOST_WARM_STREAM_DESCRIPTOR_VERSION,
      streamKey: "",
    });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.failure.code).toBe("host-contract.invalidDescriptor");
    }
  });

  it("rejects extra fields", () => {
    const result = validateHostWarmStreamDescriptor({
      kind: "host.warmStream",
      descriptorVersion: HOST_WARM_STREAM_DESCRIPTOR_VERSION,
      streamKey: "ws-1",
      extra: true,
    });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.failure.code).toBe("host-contract.invalidDescriptor");
    }
  });
});

describe("HostResourcePlaneDescriptor", () => {
  it("accepts valid resource-plane descriptor", () => {
    const rp = createHostResourcePlaneDescriptor(validResourcePlane());
    expect(rp.kind).toBe("host.resourcePlane");
    expect(rp.openOperationKey).toBe(RESOURCE_OPEN_OPERATION_KEY);
    expect(rp.readChunkOperationKey).toBe(RESOURCE_READ_CHUNK_OPERATION_KEY);
    expect(rp.mapWindowOperationKey).toBe(RESOURCE_MAP_WINDOW_OPERATION_KEY);
    expect(rp.closeMappingOperationKey).toBe(RESOURCE_CLOSE_MAPPING_OPERATION_KEY);
    expect(rp.closeHandleOperationKey).toBe(RESOURCE_CLOSE_HANDLE_OPERATION_KEY);
  });

  it("requires Resource Plane v1 operation keys", () => {
    const result = validateHostResourcePlaneDescriptor({
      ...validResourcePlane(),
      readChunkOperationKey: "wrong",
    });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.failure.code).toBe("host-contract.invalidDescriptor");
    }
  });

  it("rejects extra fields", () => {
    const result = validateHostResourcePlaneDescriptor({
      ...validResourcePlane(),
      extra: true,
    });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.failure.code).toBe("host-contract.invalidDescriptor");
    }
  });
});

describe("HostSurfaceDescriptor", () => {
  it("accepts a descriptor with all lanes", () => {
    const surface = createHostSurfaceDescriptor(validSurface());
    expect(surface.kind).toBe("host.surface");
    expect(surface.contractVersion).toBe(1);
    expect(surface.owner.authorityKey).toBe("auth-1");
    expect(surface.hotRegions?.length).toBe(1);
    expect(surface.control).toBeDefined();
    expect(surface.warmStreams?.length).toBe(1);
    expect(surface.resourcePlane).toBeDefined();
  });

  it("accepts descriptor with only one lane", () => {
    const surfaceHotOnly = createHostSurfaceDescriptor({
      kind: "host.surface",
      contractVersion: HOST_CONTRACT_VERSION,
      owner: validOwner(),
      hotRegions: [validHotRegion()],
    });
    expect(surfaceHotOnly).toBeDefined();

    const surfaceControlOnly = createHostSurfaceDescriptor({
      kind: "host.surface",
      contractVersion: HOST_CONTRACT_VERSION,
      owner: validOwner(),
      control: validControl(),
    });
    expect(surfaceControlOnly).toBeDefined();

    const surfaceWarmOnly = createHostSurfaceDescriptor({
      kind: "host.surface",
      contractVersion: HOST_CONTRACT_VERSION,
      owner: validOwner(),
      warmStreams: [validWarmStream()],
    });
    expect(surfaceWarmOnly).toBeDefined();

    const surfaceResourceOnly = createHostSurfaceDescriptor({
      kind: "host.surface",
      contractVersion: HOST_CONTRACT_VERSION,
      owner: validOwner(),
      resourcePlane: validResourcePlane(),
    });
    expect(surfaceResourceOnly).toBeDefined();
  });

  it("rejects descriptor with no lanes", () => {
    const result = validateHostSurfaceDescriptor({
      kind: "host.surface",
      contractVersion: HOST_CONTRACT_VERSION,
      owner: validOwner(),
    });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.failure.code).toBe("host-contract.invalidDescriptor");
      expect(result.failure.message).toContain("at least one lane");
    }
  });

  it("rejects duplicate hotRegionKey", () => {
    const result = validateHostSurfaceDescriptor({
      kind: "host.surface",
      contractVersion: HOST_CONTRACT_VERSION,
      owner: validOwner(),
      hotRegions: [validHotRegion(), validHotRegion()],
    });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.failure.code).toBe("host-contract.invalidDescriptor");
      expect(result.failure.message).toContain("duplicate");
    }
  });

  it("rejects duplicate warm streamKey", () => {
    const result = validateHostSurfaceDescriptor({
      kind: "host.surface",
      contractVersion: HOST_CONTRACT_VERSION,
      owner: validOwner(),
      warmStreams: [validWarmStream(), validWarmStream()],
    });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.failure.code).toBe("host-contract.invalidDescriptor");
      expect(result.failure.message).toContain("duplicate");
    }
  });

  it("rejects wrong contractVersion", () => {
    const result = validateHostSurfaceDescriptor({
      kind: "host.surface",
      contractVersion: 999,
      owner: validOwner(),
      hotRegions: [validHotRegion()],
    });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.failure.code).toBe("host-contract.invalidDescriptor");
    }
  });

  it("rejects invalid owner", () => {
    const result = validateHostSurfaceDescriptor({
      kind: "host.surface",
      contractVersion: HOST_CONTRACT_VERSION,
      owner: { authorityKey: "", surfaceKey: "", authorityEpoch: "" },
      hotRegions: [validHotRegion()],
    });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.failure.code).toBe("host-contract.invalidDescriptor");
    }
  });

  it("JSON.stringify/parse roundtrip preserves descriptor", () => {
    const surface = createHostSurfaceDescriptor(validSurface());
    const json = JSON.stringify(surface);
    const parsed = JSON.parse(json);
    const validated = validateHostSurfaceDescriptor(parsed);
    expect(validated.ok).toBe(true);
    if (validated.ok) {
      expect(validated.value.owner.authorityKey).toBe("auth-1");
      expect(validated.value.hotRegions?.length).toBe(1);
    }
  });

  it("creation helpers do not mutate input objects", () => {
    const input = validSurface();
    const frozen = JSON.parse(JSON.stringify(input));
    createHostSurfaceDescriptor(input);
    expect(input).toEqual(frozen);
  });
});

describe("HostSurfaceReadyEnvelope", () => {
  it("accepts valid surfaceReady envelope", () => {
    const envelope = createHostSurfaceReadyEnvelope({
      kind: "host.surfaceReady",
      contractVersion: HOST_CONTRACT_VERSION,
      surface: validSurface(),
    });
    expect(envelope.kind).toBe("host.surfaceReady");
    expect(envelope.surface.owner.authorityKey).toBe("auth-1");
  });

  it("rejects invalid surfaceReady surface", () => {
    const result = validateHostSurfaceReadyEnvelope({
      kind: "host.surfaceReady",
      contractVersion: HOST_CONTRACT_VERSION,
      surface: {
        kind: "host.surface",
        contractVersion: HOST_CONTRACT_VERSION,
        owner: validOwner(),
      },
    });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.failure.code).toBe("host-contract.invalidDescriptor");
    }
  });
});

describe("HostSurfaceInvalidatedEnvelope", () => {
  it("accepts valid surfaceInvalidated envelope", () => {
    const envelope = createHostSurfaceInvalidatedEnvelope({
      kind: "host.surfaceInvalidated",
      contractVersion: HOST_CONTRACT_VERSION,
      owner: validOwner(),
      reason: "surfaceRevoked",
      rebindRequired: true,
    });
    expect(envelope.kind).toBe("host.surfaceInvalidated");
    expect(envelope.reason).toBe("surfaceRevoked");
    expect(envelope.rebindRequired).toBe(true);
  });

  it("rejects invalid invalidation reason", () => {
    const result = validateHostSurfaceInvalidatedEnvelope({
      kind: "host.surfaceInvalidated",
      contractVersion: HOST_CONTRACT_VERSION,
      owner: validOwner(),
      reason: "notAReason",
      rebindRequired: true,
    });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.failure.code).toBe("host-contract.invalidDescriptor");
    }
  });

  it("rejects rebindRequired false", () => {
    const result = validateHostSurfaceInvalidatedEnvelope({
      kind: "host.surfaceInvalidated",
      contractVersion: HOST_CONTRACT_VERSION,
      owner: validOwner(),
      reason: "surfaceRevoked",
      rebindRequired: false,
    });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.failure.code).toBe("host-contract.invalidDescriptor");
    }
  });

  it("rejects raw bigint in invalidated owner", () => {
    const result = validateHostSurfaceInvalidatedEnvelope({
      kind: "host.surfaceInvalidated",
      contractVersion: HOST_CONTRACT_VERSION,
      owner: {
        authorityKey: "auth-1",
        surfaceKey: "surf-1",
        authorityEpoch: 42n,
      },
      reason: "surfaceRevoked",
      rebindRequired: true,
    });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.failure.code).toBe("host-contract.invalidDescriptor");
    }
  });
});

describe("HostContractFailure", () => {
  it("createHostContractFailure accepts valid failure", () => {
    const failure = createHostContractFailure({
      code: "host-contract.invalidDescriptor",
      message: "test failure",
    });
    expect(failure.code).toBe("host-contract.invalidDescriptor");
    expect(failure.message).toBe("test failure");
  });

  it("rejects invalid failure code", () => {
    expect(() =>
      createHostContractFailure({
        code: "warm.invalidEnvelope" as "host-contract.invalidDescriptor",
        message: "test",
      }),
    ).toThrow();
  });

  it("rejects empty failure message", () => {
    expect(() =>
      createHostContractFailure({
        code: "host-contract.invalidDescriptor",
        message: "",
      }),
    ).toThrow();
  });

  it("rejects non-JSON-safe details", () => {
    expect(() =>
      createHostContractFailure({
        code: "host-contract.invalidDescriptor",
        message: "test",
        details: { fn: () => {} } as unknown as JsonObject,
      }),
    ).toThrow();
  });

  it("validateHostContractFailure returns ok true for rejected code", () => {
    const result = validateHostContractFailure({
      code: "host-contract.rejected",
      message: "validated failure",
    });
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.code).toBe("host-contract.rejected");
      expect(result.value.message).toBe("validated failure");
    }
  });

  it("validateHostContractFailure returns ok true for invalidDescriptor with details", () => {
    const result = validateHostContractFailure({
      code: "host-contract.invalidDescriptor",
      message: "detailed failure",
      details: { key: "value" },
    });
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.code).toBe("host-contract.invalidDescriptor");
      expect(result.value.message).toBe("detailed failure");
      expect(result.value.details).toEqual({ key: "value" });
    }
  });

  it("validateHostContractFailure returns ok false for invalid failure code", () => {
    const result = validateHostContractFailure({
      code: "warm.invalidEnvelope" as "host-contract.invalidDescriptor",
      message: "test",
    });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.failure.code).toBe("host-contract.invalidDescriptor");
      expect(typeof result.failure.message).toBe("string");
      expect(result.failure.message.length).toBeGreaterThan(0);
    }
  });

  it("validateHostContractFailure returns ok false for empty message", () => {
    const result = validateHostContractFailure({
      code: "host-contract.invalidDescriptor",
      message: "",
    });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.failure.code).toBe("host-contract.invalidDescriptor");
      expect(typeof result.failure.message).toBe("string");
      expect(result.failure.message.length).toBeGreaterThan(0);
    }
  });

  it("validateHostContractFailure returns ok false for non-JSON-safe details", () => {
    const result = validateHostContractFailure({
      code: "host-contract.invalidDescriptor",
      message: "test",
      details: { fn: () => {} } as unknown as Record<string, unknown>,
    });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.failure.code).toBe("host-contract.invalidDescriptor");
      expect(typeof result.failure.message).toBe("string");
      expect(result.failure.message.length).toBeGreaterThan(0);
    }
  });
});

describe("HostContractValidationResult", () => {
  it("validation returns ok: true with value on success", () => {
    const result = validateHostSurfaceDescriptor(validSurface());
    expect(result.ok).toBe(true);
    if (result.ok) {
      expectTypeOf(result.value).toEqualTypeOf<HostSurfaceDescriptor>();
    }
  });

  it("validation returns ok: false with failure on error", () => {
    const result = validateHostSurfaceDescriptor({});
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.failure.code).toBe("host-contract.invalidDescriptor");
      expect(typeof result.failure.message).toBe("string");
      expect(result.failure.message.length).toBeGreaterThan(0);
    }
  });
});

describe("createHostSurfaceGrant", () => {
  it("projects owner and expectedBinding from a validated surface descriptor", () => {
    const surface = createHostSurfaceDescriptor(validSurface());
    const grant = createHostSurfaceGrant(surface);

    expect(grant.kind).toBe("host.surfaceGrant");
    expect(grant.owner.authorityKey).toBe("auth-1");
    expect(grant.owner.surfaceKey).toBe("surf-1");
    expect(grant.owner.authorityEpoch).toBe("42");

    expect(grant.expectedBinding.authorityKey).toBe("auth-1");
    expect(grant.expectedBinding.surfaceKey).toBe("surf-1");
    expect(grant.expectedBinding.authorityEpoch).toBe(42n);
  });

  it("projects hot capabilities from surface.hotRegions", () => {
    const surface = createHostSurfaceDescriptor(validSurface());
    const grant = createHostSurfaceGrant(surface);

    expect(grant.kind).toBe("host.surfaceGrant");
    expect(grant.hot).toHaveLength(1);
    expect(grant.hot[0].kind).toBe("surface.hotRegionCapability");
    expect(grant.hot[0].hotRegionKey).toBe("hr-1");
    expect(grant.hot[0].expectedBlockA.contractKey).toBe("contract-1");
    expect(grant.hot[0].expectedByteLength).toBe(4096);
    expect(grant.hot[0].seqlockOffset).toBe(0);
  });

  it("projects control capability from surface.control when present", () => {
    const surface = createHostSurfaceDescriptor(validSurface());
    const grant = createHostSurfaceGrant(surface);

    expect(grant.control).toBeDefined();
    expect(grant.control?.kind).toBe("surface.controlEndpointCapability");
    expect(grant.control?.endpointKey).toBe("ep-1");
    expect(grant.control?.supportedOperationKeys).toEqual(["op.1", "op.2"]);
  });

  it("omits control capability when surface has no control lane", () => {
    const surface = createHostSurfaceDescriptor({
      kind: "host.surface",
      contractVersion: HOST_CONTRACT_VERSION,
      owner: validOwner(),
      hotRegions: [validHotRegion()],
    });
    const grant = createHostSurfaceGrant(surface);
    expect(grant.control).toBeUndefined();
  });

  it("projects resourcePlane capability from surface.resourcePlane when present", () => {
    const surface = createHostSurfaceDescriptor(validSurface());
    const grant = createHostSurfaceGrant(surface);

    expect(grant.resourcePlane).toBeDefined();
    expect(grant.resourcePlane?.kind).toBe("surface.resourcePlaneCapability");
    expect(grant.resourcePlane?.openOperationKey).toBe(RESOURCE_OPEN_OPERATION_KEY);
    expect(grant.resourcePlane?.readChunkOperationKey).toBe(RESOURCE_READ_CHUNK_OPERATION_KEY);
    expect(grant.resourcePlane?.mapWindowOperationKey).toBe(RESOURCE_MAP_WINDOW_OPERATION_KEY);
    expect(grant.resourcePlane?.closeMappingOperationKey).toBe(
      RESOURCE_CLOSE_MAPPING_OPERATION_KEY,
    );
    expect(grant.resourcePlane?.closeHandleOperationKey).toBe(RESOURCE_CLOSE_HANDLE_OPERATION_KEY);
    expect(grant.resourcePlane?.owner.authorityKey).toBe("auth-1");
  });

  it("omits resourcePlane capability when surface has no resource plane", () => {
    const surface = createHostSurfaceDescriptor({
      kind: "host.surface",
      contractVersion: HOST_CONTRACT_VERSION,
      owner: validOwner(),
      hotRegions: [validHotRegion()],
    });
    const grant = createHostSurfaceGrant(surface);
    expect(grant.resourcePlane).toBeUndefined();
  });

  it("projects warm capabilities from surface.warmStreams", () => {
    const surface = createHostSurfaceDescriptor(validSurface());
    const grant = createHostSurfaceGrant(surface);

    expect(grant.warm).toHaveLength(1);
    expect(grant.warm[0].kind).toBe("surface.warmStreamCapability");
    expect(grant.warm[0].streamKey).toBe("ws-1");
    expect(grant.warm[0].owner.authorityKey).toBe("auth-1");
  });

  it("returns empty hot and warm arrays when surface has no optional lanes", () => {
    const surface = createHostSurfaceDescriptor({
      kind: "host.surface",
      contractVersion: HOST_CONTRACT_VERSION,
      owner: validOwner(),
      control: validControl(),
    });
    const grant = createHostSurfaceGrant(surface);

    expect(grant.hot).toEqual([]);
    expect(grant.warm).toEqual([]);
    expect(grant.control).toBeDefined();
    expect(grant.resourcePlane).toBeUndefined();
  });

  it("does not expose source, descriptor, raw, original, or surface fields on the grant", () => {
    const surface = createHostSurfaceDescriptor(validSurface());
    const grant = createHostSurfaceGrant(surface);

    const grantKeys = Object.keys(grant);
    for (const key of grantKeys) {
      expect(key).not.toBe("source");
      expect(key).not.toBe("descriptor");
      expect(key).not.toBe("raw");
      expect(key).not.toBe("original");
      expect(key).not.toBe("surface");
    }

    const hotKeys = Object.keys(grant.hot[0] ?? {});
    for (const key of hotKeys) {
      expect(key).not.toBe("source");
      expect(key).not.toBe("descriptor");
      expect(key).not.toBe("raw");
      expect(key).not.toBe("original");
      expect(key).not.toBe("surface");
    }

    if (grant.control) {
      for (const key of Object.keys(grant.control)) {
        expect(key).not.toBe("source");
        expect(key).not.toBe("descriptor");
      }
    }

    if (grant.resourcePlane) {
      for (const key of Object.keys(grant.resourcePlane)) {
        expect(key).not.toBe("source");
        expect(key).not.toBe("descriptor");
      }
    }

    for (const warmCap of grant.warm) {
      for (const key of Object.keys(warmCap)) {
        expect(key).not.toBe("source");
        expect(key).not.toBe("descriptor");
      }
    }
  });

  it("does not contain byte-like fields in projected grants", () => {
    const surface = createHostSurfaceDescriptor(validSurface());
    const grant = createHostSurfaceGrant(surface);

    const ENDPOINT_LOCAL_BYTE_KEYS = new Set([
      "bytes",
      "buffer",
      "data",
      "region",
      "view",
      "SharedArrayBuffer",
    ]);

    function assertNoForbiddenKeys(value: unknown, path: string): void {
      if (typeof value !== "object" || value === null) {
        return;
      }
      if (Array.isArray(value)) {
        for (let i = 0; i < value.length; i++) {
          assertNoForbiddenKeys(value[i], `${path}[${i}]`);
        }
        return;
      }
      for (const key of Object.keys(value as Record<string, unknown>)) {
        expect(ENDPOINT_LOCAL_BYTE_KEYS.has(key)).toBe(false);
        assertNoForbiddenKeys((value as Record<string, unknown>)[key], `${path}.${key}`);
      }
    }

    assertNoForbiddenKeys(grant, "grant");
  });

  it("projects publicationSequenceOffset when present in hot region", () => {
    const surface = createHostSurfaceDescriptor({
      kind: "host.surface",
      contractVersion: HOST_CONTRACT_VERSION,
      owner: validOwner(),
      hotRegions: [
        {
          ...validHotRegion(),
          publicationSequenceOffset: 16,
        },
      ],
    });
    const grant = createHostSurfaceGrant(surface);

    expect(grant.hot[0].publicationSequenceOffset).toBe(16);
  });

  it("omits publicationSequenceOffset when not present in hot region", () => {
    const surface = createHostSurfaceDescriptor({
      kind: "host.surface",
      contractVersion: HOST_CONTRACT_VERSION,
      owner: validOwner(),
      hotRegions: [validHotRegion()],
    });
    const grant = createHostSurfaceGrant(surface);

    expect(grant.hot[0].publicationSequenceOffset).toBeUndefined();
  });

  it("is deterministic: same descriptor produces same grant", () => {
    const surface = createHostSurfaceDescriptor(validSurface());
    const grant1 = createHostSurfaceGrant(surface);
    const grant2 = createHostSurfaceGrant(surface);

    expect(grant1).toEqual(grant2);
  });

  it("does not change when the validated descriptor is mutated after projection", () => {
    const surface = createHostSurfaceDescriptor(validSurface());
    const grant = createHostSurfaceGrant(surface);

    expect(grant.owner.authorityKey).toBe("auth-1");
    expect(grant.owner.surfaceKey).toBe("surf-1");
    expect(grant.owner.authorityEpoch).toBe("42");
    expect(grant.expectedBinding.authorityEpoch).toBe(42n);
    expect(grant.hot[0].hotRegionKey).toBe("hr-1");
    expect(grant.hot[0].expectedBlockA.contractKey).toBe("contract-1");
    expect(grant.hot[0].expectedBlockA.instanceKey).toBe("instance-1");
    expect(grant.hot[0].expectedByteLength).toBe(4096);
    expect(grant.control?.endpointKey).toBe("ep-1");
    expect(grant.control?.supportedOperationKeys).toEqual(["op.1", "op.2"]);
    expect(grant.resourcePlane?.readChunkOperationKey).toBe(RESOURCE_READ_CHUNK_OPERATION_KEY);
    expect(grant.warm[0].streamKey).toBe("ws-1");

    const surfaceAny = surface as Record<string, unknown>;
    const ownerAny = surfaceAny.owner as Record<string, unknown>;
    ownerAny.authorityKey = "tampered";
    ownerAny.surfaceKey = "tampered";
    ownerAny.authorityEpoch = "999";

    const hotRegionsAny = surfaceAny.hotRegions as Record<string, unknown>[];
    const blockAAny = hotRegionsAny[0].blockA as Record<string, unknown>;
    blockAAny.contractKey = "tampered";
    blockAAny.instanceKey = "tampered";
    const hotRegionAny = hotRegionsAny[0] as Record<string, unknown>;
    hotRegionAny.hotRegionKey = "tampered";
    hotRegionAny.totalRegionByteLength = 99999;

    const controlAny = surfaceAny.control as Record<string, unknown>;
    controlAny.endpointKey = "tampered";
    controlAny.operationKeys = ["tampered"];

    const warmStreamsAny = surfaceAny.warmStreams as Record<string, unknown>[];
    warmStreamsAny[0].streamKey = "tampered";

    const resourcePlaneAny = surfaceAny.resourcePlane as Record<string, unknown>;
    resourcePlaneAny.readChunkOperationKey = "tampered";

    expect(grant.owner.authorityKey).toBe("auth-1");
    expect(grant.owner.surfaceKey).toBe("surf-1");
    expect(grant.owner.authorityEpoch).toBe("42");
    expect(grant.expectedBinding.authorityEpoch).toBe(42n);
    expect(grant.hot[0].hotRegionKey).toBe("hr-1");
    expect(grant.hot[0].expectedBlockA.contractKey).toBe("contract-1");
    expect(grant.hot[0].expectedBlockA.instanceKey).toBe("instance-1");
    expect(grant.hot[0].expectedByteLength).toBe(4096);
    expect(grant.control?.endpointKey).toBe("ep-1");
    expect(grant.control?.supportedOperationKeys).toEqual(["op.1", "op.2"]);
    expect(grant.resourcePlane?.readChunkOperationKey).toBe(RESOURCE_READ_CHUNK_OPERATION_KEY);
    expect(grant.warm[0].streamKey).toBe("ws-1");
  });

  it("re-validates owner through validateHostAuthorityOwnerThrowing when projecting", () => {
    expect(() =>
      createHostSurfaceGrant({
        kind: "host.surface",
        contractVersion: HOST_CONTRACT_VERSION,
        owner: { authorityKey: "auth-1", surfaceKey: "surf-1", authorityEpoch: "42", extra: true },
      } as HostSurfaceDescriptor),
    ).toThrow();

    expect(() =>
      createHostSurfaceGrant({
        kind: "host.surface",
        contractVersion: HOST_CONTRACT_VERSION,
        owner: { authorityKey: "", surfaceKey: "surf-1", authorityEpoch: "42" },
      } as HostSurfaceDescriptor),
    ).toThrow();
  });
});

describe("createBindingExpectationFromHostOwner", () => {
  it("converts canonical decimal string authorityEpoch to bigint", () => {
    const binding: AuthorityBinding = createAuthorityBinding({
      authorityKey: "auth-1",
      surfaceKey: "surf-1",
      authorityEpoch: 42n,
    });
    const owner = createHostAuthorityOwnerFromBinding(binding);
    const expectation = createBindingExpectationFromHostOwner(owner);

    expect(expectation.authorityKey).toBe("auth-1");
    expect(expectation.surfaceKey).toBe("surf-1");
    expect(expectation.authorityEpoch).toBe(42n);
  });

  it("handles epoch 0", () => {
    const owner = createHostAuthorityOwner({
      authorityKey: "auth-1",
      surfaceKey: "surf-1",
      authorityEpoch: "0",
    });
    const expectation = createBindingExpectationFromHostOwner(owner);

    expect(expectation.authorityEpoch).toBe(0n);
  });

  it("handles epoch exceeding Number.MAX_SAFE_INTEGER", () => {
    const owner = createHostAuthorityOwner({
      authorityKey: "auth-1",
      surfaceKey: "surf-1",
      authorityEpoch: "9007199254740993",
    });
    const expectation = createBindingExpectationFromHostOwner(owner);

    expect(expectation.authorityEpoch).toBe(9007199254740993n);
  });

  it("rejects non-canonical epoch strings", () => {
    const invalidEpochs = ["", "-1", "+1", "01", "1.0", "1n", "abc", " "];
    for (const epoch of invalidEpochs) {
      expect(() =>
        createBindingExpectationFromHostOwner({
          authorityKey: "auth-1",
          surfaceKey: "surf-1",
          authorityEpoch: epoch,
        }),
      ).toThrow();
    }
  });

  it("rejects non-string authorityEpoch", () => {
    expect(() =>
      createBindingExpectationFromHostOwner({
        authorityKey: "auth-1",
        surfaceKey: "surf-1",
        authorityEpoch: 42 as unknown as string,
      }),
    ).toThrow();
  });

  it("rejects empty authorityKey", () => {
    expect(() =>
      createBindingExpectationFromHostOwner({
        authorityKey: "",
        surfaceKey: "surf-1",
        authorityEpoch: "1",
      }),
    ).toThrow();
  });

  it("rejects empty surfaceKey", () => {
    expect(() =>
      createBindingExpectationFromHostOwner({
        authorityKey: "auth-1",
        surfaceKey: "",
        authorityEpoch: "1",
      }),
    ).toThrow();
  });

  it("rejects owner with extra keys", () => {
    expect(() =>
      createBindingExpectationFromHostOwner({
        authorityKey: "auth-1",
        surfaceKey: "surf-1",
        authorityEpoch: "1",
        extra: true,
      } as HostAuthorityOwner),
    ).toThrow();
  });
});

describe("HostSurfaceGrant type exports", () => {
  it("exports intended grant types and functions", () => {
    expect(typeof createHostSurfaceGrant).toBe("function");
    expect(typeof createBindingExpectationFromHostOwner).toBe("function");
  });
});
