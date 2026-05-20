import type { JsonObject } from "@exclave/base";
import { CONTROL_ENVELOPE_VERSION } from "@exclave/control-plane";
import { PUBLICATION_TRANSPORT_ATTACHMENT_VERSION } from "@exclave/publication";
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
  createBindingExpectationFromHostAuthorityRef,
  createHostAuthorityRef,
  createHostAuthorityRefFromBinding,
  createHostContractFailure,
  createHostControlPlaneDescriptor,
  createHostGrant,
  createHostGrantDescriptor,
  createHostGrantInvalidatedEnvelope,
  createHostGrantReadyEnvelope,
  createHostHotRegionDescriptor,
  createHostResourcePlaneDescriptor,
  createHostWarmStreamDescriptor,
  HOST_CONTRACT_VERSION,
  HOST_WARM_STREAM_DESCRIPTOR_VERSION,
  type HostAuthorityRef,
  type HostContractFailureCode,
  type HostContractVersion,
  type HostControlPlaneDescriptor,
  type HostGrantDescriptor,
  type HostHotBlockAExpectation,
  type HostHotRegionDescriptor,
  type HostResourcePlaneDescriptor,
  type HostWarmStreamDescriptor,
  type HostWarmStreamDescriptorVersion,
  validateHostAuthorityRef,
  validateHostContractFailure,
  validateHostControlPlaneDescriptor,
  validateHostGrantDescriptor,
  validateHostGrantInvalidatedEnvelope,
  validateHostGrantReadyEnvelope,
  validateHostHotRegionDescriptor,
  validateHostResourcePlaneDescriptor,
  validateHostWarmStreamDescriptor,
} from "../src/index";

function validAuthorityRef(): HostAuthorityRef {
  return {
    authorityKey: "auth-1",
    grantKey: "grant-1",
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
    attachmentVersion: PUBLICATION_TRANSPORT_ATTACHMENT_VERSION,
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

function validGrantDescriptor(): HostGrantDescriptor {
  return {
    kind: "host.grantDescriptor",
    contractVersion: HOST_CONTRACT_VERSION,
    authority: validAuthorityRef(),
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
    expect(typeof hostContract.createHostAuthorityRef).toBe("function");
    expect(typeof hostContract.validateHostAuthorityRef).toBe("function");
    expect(typeof hostContract.createHostAuthorityRefFromBinding).toBe("function");
    expect(typeof hostContract.createHostHotRegionDescriptor).toBe("function");
    expect(typeof hostContract.validateHostHotRegionDescriptor).toBe("function");
    expect(typeof hostContract.createHostControlPlaneDescriptor).toBe("function");
    expect(typeof hostContract.validateHostControlPlaneDescriptor).toBe("function");
    expect(typeof hostContract.createHostWarmStreamDescriptor).toBe("function");
    expect(typeof hostContract.validateHostWarmStreamDescriptor).toBe("function");
    expect(typeof hostContract.createHostResourcePlaneDescriptor).toBe("function");
    expect(typeof hostContract.validateHostResourcePlaneDescriptor).toBe("function");
    expect(typeof hostContract.createHostGrantDescriptor).toBe("function");
    expect(typeof hostContract.validateHostGrantDescriptor).toBe("function");
    expect(typeof hostContract.createHostGrantReadyEnvelope).toBe("function");
    expect(typeof hostContract.validateHostGrantReadyEnvelope).toBe("function");
    expect(typeof hostContract.createHostGrantInvalidatedEnvelope).toBe("function");
    expect(typeof hostContract.validateHostGrantInvalidatedEnvelope).toBe("function");
    expect(typeof hostContract.createHostContractFailure).toBe("function");
    expect(typeof hostContract.validateHostContractFailure).toBe("function");
  });
});

describe("HostAuthorityRef", () => {
  it("createHostAuthorityRef accepts valid authority ref", () => {
    const authorityRef = createHostAuthorityRef(validAuthorityRef());
    expect(authorityRef.authorityKey).toBe("auth-1");
    expect(authorityRef.grantKey).toBe("grant-1");
    expect(authorityRef.authorityEpoch).toBe("42");
  });

  it("createHostAuthorityRefFromBinding converts bigint authorityEpoch to decimal string", () => {
    const binding: AuthorityBinding = createAuthorityBinding({
      authorityKey: "auth-1",
      grantKey: "grant-1",
      authorityEpoch: 9007199254740993n,
    });
    const authorityRef = createHostAuthorityRefFromBinding(binding);
    expect(authorityRef.authorityKey).toBe("auth-1");
    expect(authorityRef.grantKey).toBe("grant-1");
    expect(authorityRef.authorityEpoch).toBe("9007199254740993");
  });

  it("rejects number authorityEpoch", () => {
    const result = validateHostAuthorityRef({
      authorityKey: "auth-1",
      grantKey: "grant-1",
      authorityEpoch: 42,
    });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.failure.code).toBe("host-contract.invalidDescriptor");
      expect(result.failure.message).toContain("must be a string");
    }
  });

  it("rejects bigint authorityEpoch", () => {
    const result = validateHostAuthorityRef({
      authorityKey: "auth-1",
      grantKey: "grant-1",
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
      const result = validateHostAuthorityRef({
        authorityKey: "auth-1",
        grantKey: "grant-1",
        authorityEpoch: epoch,
      });
      expect(result.ok).toBe(true);
    }
  });

  it("rejects invalid decimal strings", () => {
    const rejected = ["", "-1", "+1", "01", "1.0", "1n", "abc"];
    for (const epoch of rejected) {
      const result = validateHostAuthorityRef({
        authorityKey: "auth-1",
        grantKey: "grant-1",
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
      grantKey: "grant-1",
      authorityEpoch: "0",
      extra: true,
    };
    const result = validateHostAuthorityRef(obj);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.failure.code).toBe("host-contract.invalidDescriptor");
      expect(result.failure.message).toContain("extra field");
    }

    const resultSymbol = validateHostAuthorityRef({
      authorityKey: "auth-1",
      grantKey: "grant-1",
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
      grantKey = "grant-1";
      get authorityEpoch() {
        return "0";
      }
    }
    const result = validateHostAuthorityRef(new FakeOwner());
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.failure.code).toBe("host-contract.invalidDescriptor");
    }
  });

  it("create does not mutate input object", () => {
    const input = validAuthorityRef();
    const frozen = { ...input };
    createHostAuthorityRef(input);
    expect(input).toEqual(frozen);
  });

  it("accepts 0n, 1n, 42n, and 9007199254740993n from binding", () => {
    for (const epoch of [0n, 1n, 42n, 9007199254740993n]) {
      const binding = createAuthorityBinding({
        authorityKey: "auth-1",
        grantKey: "grant-1",
        authorityEpoch: epoch,
      });
      const authorityRef = createHostAuthorityRefFromBinding(binding);
      expect(authorityRef.authorityEpoch).toBe(String(epoch));
    }
  });

  it("rejects -1n from binding", () => {
    const binding = createAuthorityBinding({
      authorityKey: "auth-1",
      grantKey: "grant-1",
      authorityEpoch: -1n,
    });
    expect(() => createHostAuthorityRefFromBinding(binding)).toThrow();
  });

  it("authorityRef-from-binding output authorityEpoch is a string", () => {
    const binding = createAuthorityBinding({
      authorityKey: "auth-1",
      grantKey: "grant-1",
      authorityEpoch: 42n,
    });
    const authorityRef = createHostAuthorityRefFromBinding(binding);
    expect(typeof authorityRef.authorityEpoch).toBe("string");
  });

  it("authorityRef-from-binding output does not include state", () => {
    const binding = createAuthorityBinding({
      authorityKey: "auth-1",
      grantKey: "grant-1",
      authorityEpoch: 42n,
    });
    const authorityRef = createHostAuthorityRefFromBinding(binding);
    expect((authorityRef as Record<string, unknown>).state).toBeUndefined();
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
    expect(ws.attachmentVersion).toBe(PUBLICATION_TRANSPORT_ATTACHMENT_VERSION);
  });

  it("requires HOST_WARM_STREAM_DESCRIPTOR_VERSION", () => {
    const result = validateHostWarmStreamDescriptor({
      kind: "host.warmStream",
      descriptorVersion: 999,
      attachmentVersion: PUBLICATION_TRANSPORT_ATTACHMENT_VERSION,
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
      attachmentVersion: PUBLICATION_TRANSPORT_ATTACHMENT_VERSION,
      streamKey: "",
    });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.failure.code).toBe("host-contract.invalidDescriptor");
    }
  });

  it("requires publication transport attachment version", () => {
    const result = validateHostWarmStreamDescriptor({
      kind: "host.warmStream",
      descriptorVersion: HOST_WARM_STREAM_DESCRIPTOR_VERSION,
      attachmentVersion: 999,
      streamKey: "ws-1",
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
      attachmentVersion: PUBLICATION_TRANSPORT_ATTACHMENT_VERSION,
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

describe("HostGrantDescriptor", () => {
  it("accepts a descriptor with all lanes", () => {
    const grantDescriptor = createHostGrantDescriptor(validGrantDescriptor());
    expect(grantDescriptor.kind).toBe("host.grantDescriptor");
    expect(grantDescriptor.contractVersion).toBe(1);
    expect(grantDescriptor.authority.authorityKey).toBe("auth-1");
    expect(grantDescriptor.hotRegions?.length).toBe(1);
    expect(grantDescriptor.control).toBeDefined();
    expect(grantDescriptor.warmStreams?.length).toBe(1);
    expect(grantDescriptor.resourcePlane).toBeDefined();
  });

  it("accepts descriptor with only one lane", () => {
    const grantDescriptorHotOnly = createHostGrantDescriptor({
      kind: "host.grantDescriptor",
      contractVersion: HOST_CONTRACT_VERSION,
      authority: validAuthorityRef(),
      hotRegions: [validHotRegion()],
    });
    expect(grantDescriptorHotOnly).toBeDefined();

    const grantDescriptorControlOnly = createHostGrantDescriptor({
      kind: "host.grantDescriptor",
      contractVersion: HOST_CONTRACT_VERSION,
      authority: validAuthorityRef(),
      control: validControl(),
    });
    expect(grantDescriptorControlOnly).toBeDefined();

    const grantDescriptorWarmOnly = createHostGrantDescriptor({
      kind: "host.grantDescriptor",
      contractVersion: HOST_CONTRACT_VERSION,
      authority: validAuthorityRef(),
      warmStreams: [validWarmStream()],
    });
    expect(grantDescriptorWarmOnly).toBeDefined();

    const grantDescriptorResourceOnly = createHostGrantDescriptor({
      kind: "host.grantDescriptor",
      contractVersion: HOST_CONTRACT_VERSION,
      authority: validAuthorityRef(),
      resourcePlane: validResourcePlane(),
    });
    expect(grantDescriptorResourceOnly).toBeDefined();
  });

  it("rejects descriptor with no lanes", () => {
    const result = validateHostGrantDescriptor({
      kind: "host.grantDescriptor",
      contractVersion: HOST_CONTRACT_VERSION,
      authority: validAuthorityRef(),
    });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.failure.code).toBe("host-contract.invalidDescriptor");
      expect(result.failure.message).toContain("at least one lane");
    }
  });

  it("rejects duplicate hotRegionKey", () => {
    const result = validateHostGrantDescriptor({
      kind: "host.grantDescriptor",
      contractVersion: HOST_CONTRACT_VERSION,
      authority: validAuthorityRef(),
      hotRegions: [validHotRegion(), validHotRegion()],
    });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.failure.code).toBe("host-contract.invalidDescriptor");
      expect(result.failure.message).toContain("duplicate");
    }
  });

  it("rejects duplicate warm streamKey", () => {
    const result = validateHostGrantDescriptor({
      kind: "host.grantDescriptor",
      contractVersion: HOST_CONTRACT_VERSION,
      authority: validAuthorityRef(),
      warmStreams: [validWarmStream(), validWarmStream()],
    });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.failure.code).toBe("host-contract.invalidDescriptor");
      expect(result.failure.message).toContain("duplicate");
    }
  });

  it("rejects wrong contractVersion", () => {
    const result = validateHostGrantDescriptor({
      kind: "host.grantDescriptor",
      contractVersion: 999,
      authority: validAuthorityRef(),
      hotRegions: [validHotRegion()],
    });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.failure.code).toBe("host-contract.invalidDescriptor");
    }
  });

  it("rejects invalid authority", () => {
    const result = validateHostGrantDescriptor({
      kind: "host.grantDescriptor",
      contractVersion: HOST_CONTRACT_VERSION,
      authority: { authorityKey: "", grantKey: "", authorityEpoch: "" },
      hotRegions: [validHotRegion()],
    });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.failure.code).toBe("host-contract.invalidDescriptor");
    }
  });

  it("JSON.stringify/parse roundtrip preserves descriptor", () => {
    const grantDescriptor = createHostGrantDescriptor(validGrantDescriptor());
    const json = JSON.stringify(grantDescriptor);
    const parsed = JSON.parse(json);
    const validated = validateHostGrantDescriptor(parsed);
    expect(validated.ok).toBe(true);
    if (validated.ok) {
      expect(validated.value.authority.authorityKey).toBe("auth-1");
      expect(validated.value.hotRegions?.length).toBe(1);
    }
  });

  it("creation helpers do not mutate input objects", () => {
    const input = validGrantDescriptor();
    const frozen = JSON.parse(JSON.stringify(input));
    createHostGrantDescriptor(input);
    expect(input).toEqual(frozen);
  });
});

describe("HostGrantReadyEnvelope", () => {
  it("accepts valid grantReady envelope", () => {
    const envelope = createHostGrantReadyEnvelope({
      kind: "host.grantReady",
      contractVersion: HOST_CONTRACT_VERSION,
      grant: validGrantDescriptor(),
    });
    expect(envelope.kind).toBe("host.grantReady");
    expect(envelope.grant.authority.authorityKey).toBe("auth-1");
  });

  it("rejects invalid grantReady grant", () => {
    const result = validateHostGrantReadyEnvelope({
      kind: "host.grantReady",
      contractVersion: HOST_CONTRACT_VERSION,
      grant: {
        kind: "host.grantDescriptor",
        contractVersion: HOST_CONTRACT_VERSION,
        authority: validAuthorityRef(),
      },
    });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.failure.code).toBe("host-contract.invalidDescriptor");
    }
  });
});

describe("HostGrantInvalidatedEnvelope", () => {
  it("accepts valid grantInvalidated envelope", () => {
    const envelope = createHostGrantInvalidatedEnvelope({
      kind: "host.grantInvalidated",
      contractVersion: HOST_CONTRACT_VERSION,
      authority: validAuthorityRef(),
      reason: "grantRevoked",
      rebindRequired: true,
    });
    expect(envelope.kind).toBe("host.grantInvalidated");
    expect(envelope.reason).toBe("grantRevoked");
    expect(envelope.rebindRequired).toBe(true);
  });

  it("rejects invalid invalidation reason", () => {
    const result = validateHostGrantInvalidatedEnvelope({
      kind: "host.grantInvalidated",
      contractVersion: HOST_CONTRACT_VERSION,
      authority: validAuthorityRef(),
      reason: "notAReason",
      rebindRequired: true,
    });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.failure.code).toBe("host-contract.invalidDescriptor");
    }
  });

  it("rejects rebindRequired false", () => {
    const result = validateHostGrantInvalidatedEnvelope({
      kind: "host.grantInvalidated",
      contractVersion: HOST_CONTRACT_VERSION,
      authority: validAuthorityRef(),
      reason: "grantRevoked",
      rebindRequired: false,
    });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.failure.code).toBe("host-contract.invalidDescriptor");
    }
  });

  it("rejects raw bigint in invalidated authority", () => {
    const result = validateHostGrantInvalidatedEnvelope({
      kind: "host.grantInvalidated",
      contractVersion: HOST_CONTRACT_VERSION,
      authority: {
        authorityKey: "auth-1",
        grantKey: "grant-1",
        authorityEpoch: 42n,
      },
      reason: "grantRevoked",
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
    const result = validateHostGrantDescriptor(validGrantDescriptor());
    expect(result.ok).toBe(true);
    if (result.ok) {
      expectTypeOf(result.value).toEqualTypeOf<HostGrantDescriptor>();
    }
  });

  it("validation returns ok: false with failure on error", () => {
    const result = validateHostGrantDescriptor({});
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.failure.code).toBe("host-contract.invalidDescriptor");
      expect(typeof result.failure.message).toBe("string");
      expect(result.failure.message.length).toBeGreaterThan(0);
    }
  });
});

describe("createHostGrant", () => {
  it("projects authority and expectedBinding from a validated grant descriptor", () => {
    const grantDescriptor = createHostGrantDescriptor(validGrantDescriptor());
    const grant = createHostGrant(grantDescriptor);

    expect(grant.kind).toBe("host.grant");
    expect(grant.authority.authorityKey).toBe("auth-1");
    expect(grant.authority.grantKey).toBe("grant-1");
    expect(grant.authority.authorityEpoch).toBe("42");

    expect(grant.expectedBinding.authorityKey).toBe("auth-1");
    expect(grant.expectedBinding.grantKey).toBe("grant-1");
    expect(grant.expectedBinding.authorityEpoch).toBe(42n);
  });

  it("projects hot capabilities from grantDescriptor.hotRegions", () => {
    const grantDescriptor = createHostGrantDescriptor(validGrantDescriptor());
    const grant = createHostGrant(grantDescriptor);

    expect(grant.kind).toBe("host.grant");
    expect(grant.hot).toHaveLength(1);
    expect(grant.hot[0].kind).toBe("grant.hotRegionCapability");
    expect(grant.hot[0].hotRegionKey).toBe("hr-1");
    expect(grant.hot[0].expectedBlockA.contractKey).toBe("contract-1");
    expect(grant.hot[0].expectedByteLength).toBe(4096);
    expect(grant.hot[0].seqlockOffset).toBe(0);
  });

  it("projects control capability from grantDescriptor.control when present", () => {
    const grantDescriptor = createHostGrantDescriptor(validGrantDescriptor());
    const grant = createHostGrant(grantDescriptor);

    expect(grant.control).toBeDefined();
    expect(grant.control?.kind).toBe("grant.controlEndpointCapability");
    expect(grant.control?.endpointKey).toBe("ep-1");
    expect(grant.control?.supportedOperationKeys).toEqual(["op.1", "op.2"]);
  });

  it("omits control capability when grantDescriptor has no control lane", () => {
    const grantDescriptor = createHostGrantDescriptor({
      kind: "host.grantDescriptor",
      contractVersion: HOST_CONTRACT_VERSION,
      authority: validAuthorityRef(),
      hotRegions: [validHotRegion()],
    });
    const grant = createHostGrant(grantDescriptor);
    expect(grant.control).toBeUndefined();
  });

  it("projects resourcePlane capability from grantDescriptor.resourcePlane when present", () => {
    const grantDescriptor = createHostGrantDescriptor(validGrantDescriptor());
    const grant = createHostGrant(grantDescriptor);

    expect(grant.resourcePlane).toBeDefined();
    expect(grant.resourcePlane?.kind).toBe("grant.resourcePlaneCapability");
    expect(grant.resourcePlane?.openOperationKey).toBe(RESOURCE_OPEN_OPERATION_KEY);
    expect(grant.resourcePlane?.readChunkOperationKey).toBe(RESOURCE_READ_CHUNK_OPERATION_KEY);
    expect(grant.resourcePlane?.mapWindowOperationKey).toBe(RESOURCE_MAP_WINDOW_OPERATION_KEY);
    expect(grant.resourcePlane?.closeMappingOperationKey).toBe(
      RESOURCE_CLOSE_MAPPING_OPERATION_KEY,
    );
    expect(grant.resourcePlane?.closeHandleOperationKey).toBe(RESOURCE_CLOSE_HANDLE_OPERATION_KEY);
    expect(grant.resourcePlane?.authority.authorityKey).toBe("auth-1");
  });

  it("omits resourcePlane capability when grantDescriptor has no resource plane", () => {
    const grantDescriptor = createHostGrantDescriptor({
      kind: "host.grantDescriptor",
      contractVersion: HOST_CONTRACT_VERSION,
      authority: validAuthorityRef(),
      hotRegions: [validHotRegion()],
    });
    const grant = createHostGrant(grantDescriptor);
    expect(grant.resourcePlane).toBeUndefined();
  });

  it("projects warm capabilities from grantDescriptor.warmStreams", () => {
    const grantDescriptor = createHostGrantDescriptor(validGrantDescriptor());
    const grant = createHostGrant(grantDescriptor);

    expect(grant.warm).toHaveLength(1);
    expect(grant.warm[0].kind).toBe("grant.warmStreamCapability");
    expect(grant.warm[0].streamKey).toBe("ws-1");
    expect(grant.warm[0].authority.authorityKey).toBe("auth-1");
    expect(grant.warm[0].attachmentVersion).toBe(PUBLICATION_TRANSPORT_ATTACHMENT_VERSION);
  });

  it("returns empty hot and warm arrays when grantDescriptor has no optional lanes", () => {
    const grantDescriptor = createHostGrantDescriptor({
      kind: "host.grantDescriptor",
      contractVersion: HOST_CONTRACT_VERSION,
      authority: validAuthorityRef(),
      control: validControl(),
    });
    const grant = createHostGrant(grantDescriptor);

    expect(grant.hot).toEqual([]);
    expect(grant.warm).toEqual([]);
    expect(grant.control).toBeDefined();
    expect(grant.resourcePlane).toBeUndefined();
  });

  it("does not expose source, descriptor, raw, original, or surface fields on the grant", () => {
    const grantDescriptor = createHostGrantDescriptor(validGrantDescriptor());
    const grant = createHostGrant(grantDescriptor);

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
    const grantDescriptor = createHostGrantDescriptor(validGrantDescriptor());
    const grant = createHostGrant(grantDescriptor);

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
    const grantDescriptor = createHostGrantDescriptor({
      kind: "host.grantDescriptor",
      contractVersion: HOST_CONTRACT_VERSION,
      authority: validAuthorityRef(),
      hotRegions: [
        {
          ...validHotRegion(),
          publicationSequenceOffset: 16,
        },
      ],
    });
    const grant = createHostGrant(grantDescriptor);

    expect(grant.hot[0].publicationSequenceOffset).toBe(16);
  });

  it("omits publicationSequenceOffset when not present in hot region", () => {
    const grantDescriptor = createHostGrantDescriptor({
      kind: "host.grantDescriptor",
      contractVersion: HOST_CONTRACT_VERSION,
      authority: validAuthorityRef(),
      hotRegions: [validHotRegion()],
    });
    const grant = createHostGrant(grantDescriptor);

    expect(grant.hot[0].publicationSequenceOffset).toBeUndefined();
  });

  it("is deterministic: same descriptor produces same grant", () => {
    const grantDescriptor = createHostGrantDescriptor(validGrantDescriptor());
    const grant1 = createHostGrant(grantDescriptor);
    const grant2 = createHostGrant(grantDescriptor);

    expect(grant1).toEqual(grant2);
  });

  it("does not change when the validated descriptor is mutated after projection", () => {
    const grantDescriptor = createHostGrantDescriptor(validGrantDescriptor());
    const grant = createHostGrant(grantDescriptor);

    expect(grant.authority.authorityKey).toBe("auth-1");
    expect(grant.authority.grantKey).toBe("grant-1");
    expect(grant.authority.authorityEpoch).toBe("42");
    expect(grant.expectedBinding.authorityEpoch).toBe(42n);
    expect(grant.hot[0].hotRegionKey).toBe("hr-1");
    expect(grant.hot[0].expectedBlockA.contractKey).toBe("contract-1");
    expect(grant.hot[0].expectedBlockA.instanceKey).toBe("instance-1");
    expect(grant.hot[0].expectedByteLength).toBe(4096);
    expect(grant.control?.endpointKey).toBe("ep-1");
    expect(grant.control?.supportedOperationKeys).toEqual(["op.1", "op.2"]);
    expect(grant.resourcePlane?.readChunkOperationKey).toBe(RESOURCE_READ_CHUNK_OPERATION_KEY);
    expect(grant.warm[0].streamKey).toBe("ws-1");

    const descriptorAny = grantDescriptor as Record<string, unknown>;
    const authorityAny = descriptorAny.authority as Record<string, unknown>;
    authorityAny.authorityKey = "tampered";
    authorityAny.grantKey = "tampered";
    authorityAny.authorityEpoch = "999";

    const hotRegionsAny = descriptorAny.hotRegions as Record<string, unknown>[];
    const blockAAny = hotRegionsAny[0].blockA as Record<string, unknown>;
    blockAAny.contractKey = "tampered";
    blockAAny.instanceKey = "tampered";
    const hotRegionAny = hotRegionsAny[0] as Record<string, unknown>;
    hotRegionAny.hotRegionKey = "tampered";
    hotRegionAny.totalRegionByteLength = 99999;

    const controlAny = descriptorAny.control as Record<string, unknown>;
    controlAny.endpointKey = "tampered";
    controlAny.operationKeys = ["tampered"];

    const warmStreamsAny = descriptorAny.warmStreams as Record<string, unknown>[];
    warmStreamsAny[0].streamKey = "tampered";

    const resourcePlaneAny = descriptorAny.resourcePlane as Record<string, unknown>;
    resourcePlaneAny.readChunkOperationKey = "tampered";

    expect(grant.authority.authorityKey).toBe("auth-1");
    expect(grant.authority.grantKey).toBe("grant-1");
    expect(grant.authority.authorityEpoch).toBe("42");
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

  it("re-validates authority through validateHostAuthorityRefThrowing when projecting", () => {
    expect(() =>
      createHostGrant({
        kind: "host.grantDescriptor",
        contractVersion: HOST_CONTRACT_VERSION,
        authority: {
          authorityKey: "auth-1",
          grantKey: "grant-1",
          authorityEpoch: "42",
          extra: true,
        },
      } as HostGrantDescriptor),
    ).toThrow();

    expect(() =>
      createHostGrant({
        kind: "host.grantDescriptor",
        contractVersion: HOST_CONTRACT_VERSION,
        authority: { authorityKey: "", grantKey: "grant-1", authorityEpoch: "42" },
      } as HostGrantDescriptor),
    ).toThrow();
  });
});

describe("createBindingExpectationFromHostAuthorityRef", () => {
  it("converts canonical decimal string authorityEpoch to bigint", () => {
    const binding: AuthorityBinding = createAuthorityBinding({
      authorityKey: "auth-1",
      grantKey: "grant-1",
      authorityEpoch: 42n,
    });
    const authorityRef = createHostAuthorityRefFromBinding(binding);
    const expectation = createBindingExpectationFromHostAuthorityRef(authorityRef);

    expect(expectation.authorityKey).toBe("auth-1");
    expect(expectation.grantKey).toBe("grant-1");
    expect(expectation.authorityEpoch).toBe(42n);
  });

  it("handles epoch 0", () => {
    const authorityRef = createHostAuthorityRef({
      authorityKey: "auth-1",
      grantKey: "grant-1",
      authorityEpoch: "0",
    });
    const expectation = createBindingExpectationFromHostAuthorityRef(authorityRef);

    expect(expectation.authorityEpoch).toBe(0n);
  });

  it("handles epoch exceeding Number.MAX_SAFE_INTEGER", () => {
    const authorityRef = createHostAuthorityRef({
      authorityKey: "auth-1",
      grantKey: "grant-1",
      authorityEpoch: "9007199254740993",
    });
    const expectation = createBindingExpectationFromHostAuthorityRef(authorityRef);

    expect(expectation.authorityEpoch).toBe(9007199254740993n);
  });

  it("rejects non-canonical epoch strings", () => {
    const invalidEpochs = ["", "-1", "+1", "01", "1.0", "1n", "abc", " "];
    for (const epoch of invalidEpochs) {
      expect(() =>
        createBindingExpectationFromHostAuthorityRef({
          authorityKey: "auth-1",
          grantKey: "grant-1",
          authorityEpoch: epoch,
        }),
      ).toThrow();
    }
  });

  it("rejects non-string authorityEpoch", () => {
    expect(() =>
      createBindingExpectationFromHostAuthorityRef({
        authorityKey: "auth-1",
        grantKey: "grant-1",
        authorityEpoch: 42 as unknown as string,
      }),
    ).toThrow();
  });

  it("rejects empty authorityKey", () => {
    expect(() =>
      createBindingExpectationFromHostAuthorityRef({
        authorityKey: "",
        grantKey: "grant-1",
        authorityEpoch: "1",
      }),
    ).toThrow();
  });

  it("rejects empty grantKey", () => {
    expect(() =>
      createBindingExpectationFromHostAuthorityRef({
        authorityKey: "auth-1",
        grantKey: "",
        authorityEpoch: "1",
      }),
    ).toThrow();
  });

  it("rejects authorityRef with extra keys", () => {
    expect(() =>
      createBindingExpectationFromHostAuthorityRef({
        authorityKey: "auth-1",
        grantKey: "grant-1",
        authorityEpoch: "1",
        extra: true,
      } as HostAuthorityRef),
    ).toThrow();
  });
});

describe("HostGrant type exports", () => {
  it("exports intended grant types and functions", () => {
    expect(typeof createHostGrant).toBe("function");
    expect(typeof createBindingExpectationFromHostAuthorityRef).toBe("function");
  });
});
