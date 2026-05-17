import { CONTROL_ENVELOPE_VERSION } from "@exclave/control-plane";
import { RESOURCE_READ_RANGE_OPERATION_KEY } from "@exclave/resource";
import { type AuthorityBinding, createAuthorityBinding } from "@exclave/session";
import { WARM_ENVELOPE_VERSION } from "@exclave/warm";
import { describe, expect, expectTypeOf, it } from "vitest";
import * as hostContract from "../src/index";
import {
  createHostAuthorityOwner,
  createHostAuthorityOwnerFromBinding,
  createHostContractFailure,
  createHostControlPlaneDescriptor,
  createHostHotRegionDescriptor,
  createHostResourcePlaneDescriptor,
  createHostSurfaceDescriptor,
  createHostSurfaceInvalidatedEnvelope,
  createHostSurfaceReadyEnvelope,
  createHostWarmStreamDescriptor,
  HOST_CONTRACT_VERSION,
  type HostAuthorityOwner,
  type HostControlPlaneDescriptor,
  type HostHotBlockAExpectation,
  type HostHotRegionDescriptor,
  type HostResourcePlaneDescriptor,
  type HostSurfaceDescriptor,
  type HostWarmStreamDescriptor,
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
    envelopeVersion: WARM_ENVELOPE_VERSION,
    streamKey: "ws-1",
  };
}

function validResourcePlane(): HostResourcePlaneDescriptor {
  return {
    kind: "host.resourcePlane",
    readRangeOperationKey: RESOURCE_READ_RANGE_OPERATION_KEY,
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

// ─── Public exports ────────────────────────────────────────────────

describe("@exclave/host-contract public exports", () => {
  it("exports HOST_CONTRACT_VERSION = 1", () => {
    expect(HOST_CONTRACT_VERSION).toBe(1);
  });

  it("exports intended types", () => {
    expectTypeOf(hostContract.HostContractVersion).toEqualTypeOf<1>();
    expectTypeOf(hostContract.HostContractFailureCode).toEqualTypeOf<
      "host-contract.invalidDescriptor" | "host-contract.rejected"
    >();
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

  it("does not leak throwInputRejected", () => {
    expect((hostContract as Record<string, unknown>).throwInputRejected).toBeUndefined();
  });

  it("does not leak internal throwing helpers", () => {
    const exported = hostContract as Record<string, unknown>;
    expect(exported.validateHostAuthorityOwnerThrowing).toBeUndefined();
    expect(exported.createHostHotRegionDescriptorThrowing).toBeUndefined();
    expect(exported.createHostControlPlaneDescriptorThrowing).toBeUndefined();
    expect(exported.createHostWarmStreamDescriptorThrowing).toBeUndefined();
    expect(exported.createHostResourcePlaneDescriptorThrowing).toBeUndefined();
  });
});

// ─── Owner tests ───────────────────────────────────────────────────

describe("HostAuthorityOwner", () => {
  it("1. createHostAuthorityOwner accepts valid owner", () => {
    const owner = createHostAuthorityOwner(validOwner());
    expect(owner.authorityKey).toBe("auth-1");
    expect(owner.surfaceKey).toBe("surf-1");
    expect(owner.authorityEpoch).toBe("42");
  });

  it("2. createHostAuthorityOwnerFromBinding converts bigint authorityEpoch to decimal string", () => {
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

  it("3. rejects number authorityEpoch", () => {
    const result = validateHostAuthorityOwner({
      authorityKey: "auth-1",
      surfaceKey: "surf-1",
      authorityEpoch: 42,
    });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.failure.message).toContain("must be a string");
    }
  });

  it("4. rejects bigint authorityEpoch", () => {
    const result = validateHostAuthorityOwner({
      authorityKey: "auth-1",
      surfaceKey: "surf-1",
      authorityEpoch: 42n,
    });
    expect(result.ok).toBe(false);
  });

  it("5. accepts canonical decimal strings", () => {
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

  it("6. rejects invalid decimal strings", () => {
    const rejected = ["", "-1", "+1", "01", "1.0", "1n", "abc"];
    for (const epoch of rejected) {
      const result = validateHostAuthorityOwner({
        authorityKey: "auth-1",
        surfaceKey: "surf-1",
        authorityEpoch: epoch,
      });
      expect(result.ok).toBe(false);
    }
  });

  it("7. rejects extra keys and symbol keys", () => {
    const obj = {
      authorityKey: "auth-1",
      surfaceKey: "surf-1",
      authorityEpoch: "0",
      extra: true,
    };
    const result = validateHostAuthorityOwner(obj);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.failure.message).toContain("extra field");
    }

    const resultSymbol = validateHostAuthorityOwner({
      authorityKey: "auth-1",
      surfaceKey: "surf-1",
      authorityEpoch: "0",
      [Symbol("x")]: 1,
    });
    expect(resultSymbol.ok).toBe(false);
  });

  it("8. rejects class instance and accessor/getter input", () => {
    class FakeOwner {
      authorityKey = "auth-1";
      surfaceKey = "surf-1";
      get authorityEpoch() {
        return "0";
      }
    }
    const result = validateHostAuthorityOwner(new FakeOwner());
    expect(result.ok).toBe(false);
  });

  it("create does not mutate input object", () => {
    const input = validOwner();
    const frozen = { ...input };
    createHostAuthorityOwner(input);
    expect(input).toEqual(frozen);
  });
});

// ─── Hot region tests ──────────────────────────────────────────────

describe("HostHotRegionDescriptor", () => {
  it("9. accepts valid hot region descriptor", () => {
    const region = createHostHotRegionDescriptor(validHotRegion());
    expect(region.kind).toBe("host.hotRegion");
    expect(region.hotRegionKey).toBe("hr-1");
    expect(region.blockA.contractKey).toBe("contract-1");
    expect(region.blockA.fieldCount).toBe(3);
    expect(region.totalRegionByteLength).toBe(4096);
    expect(region.seqlockOffset).toBe(0);
  });

  it("10. rejects byte-like fields", () => {
    const input = {
      ...validHotRegion(),
      bytes: new Uint8Array([1, 2, 3]),
    } as unknown as HostHotRegionDescriptor;
    const result = validateHostHotRegionDescriptor(input);
    expect(result.ok).toBe(false);
  });

  it("11. rejects missing/empty hotRegionKey", () => {
    const result = validateHostHotRegionDescriptor({
      kind: "host.hotRegion",
      blockA: validBlockA(),
      totalRegionByteLength: 4096,
      seqlockOffset: 0,
    });
    expect(result.ok).toBe(false);

    const resultEmpty = validateHostHotRegionDescriptor({
      kind: "host.hotRegion",
      hotRegionKey: "",
      blockA: validBlockA(),
      totalRegionByteLength: 4096,
      seqlockOffset: 0,
    });
    expect(resultEmpty.ok).toBe(false);
  });

  it("12. rejects bigint semanticVersion/hotLayoutVersion", () => {
    const result = validateHostHotRegionDescriptor({
      ...validHotRegion(),
      blockA: { ...validBlockA(), semanticVersion: 1n },
    });
    expect(result.ok).toBe(false);

    const result2 = validateHostHotRegionDescriptor({
      ...validHotRegion(),
      blockA: { ...validBlockA(), hotLayoutVersion: 2n },
    });
    expect(result2.ok).toBe(false);
  });

  it("13. accepts semanticVersion/hotLayoutVersion as canonical decimal strings", () => {
    const result = validateHostHotRegionDescriptor({
      ...validHotRegion(),
      blockA: { ...validBlockA(), semanticVersion: "1", hotLayoutVersion: "2" },
    });
    expect(result.ok).toBe(true);
  });

  it("14. rejects invalid decimal strings in blockA", () => {
    const result = validateHostHotRegionDescriptor({
      ...validHotRegion(),
      blockA: { ...validBlockA(), semanticVersion: "-1" },
    });
    expect(result.ok).toBe(false);
  });

  it("15. rejects invalid totalRegionByteLength", () => {
    const result = validateHostHotRegionDescriptor({
      ...validHotRegion(),
      totalRegionByteLength: 0,
    });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.failure.message).toContain("positive");
    }
  });

  it("16. rejects invalid seqlockOffset", () => {
    const result = validateHostHotRegionDescriptor({
      ...validHotRegion(),
      seqlockOffset: 5000,
    });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.failure.message).toContain("within");
    }
  });

  it("17. rejects publicationSequenceOffset out of range", () => {
    const result = validateHostHotRegionDescriptor({
      ...validHotRegion(),
      publicationSequenceOffset: 5000,
    });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.failure.message).toContain("within");
    }
  });

  it("18. rejects extra fields", () => {
    const obj = { ...validHotRegion(), extra: true } as unknown;
    const result = validateHostHotRegionDescriptor(obj);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.failure.message).toContain("extra field");
    }
  });

  it("create does not mutate input object", () => {
    const input = validHotRegion();
    const frozen = JSON.parse(JSON.stringify(input));
    createHostHotRegionDescriptor(input);
    expect(input).toEqual(frozen);
  });
});

// ─── Control tests ─────────────────────────────────────────────────

describe("HostControlPlaneDescriptor", () => {
  it("19. accepts valid control descriptor", () => {
    const ctrl = createHostControlPlaneDescriptor(validControl());
    expect(ctrl.kind).toBe("host.controlPlane");
    expect(ctrl.endpointKey).toBe("ep-1");
    expect(ctrl.operationKeys).toEqual(["op.1", "op.2"]);
  });

  it("20. requires CONTROL_ENVELOPE_VERSION", () => {
    const result = validateHostControlPlaneDescriptor({
      kind: "host.controlPlane",
      envelopeVersion: 999,
      endpointKey: "ep-1",
      operationKeys: ["op.1"],
    });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.failure.message).toContain("envelopeVersion");
    }
  });

  it("21. rejects empty endpointKey", () => {
    const result = validateHostControlPlaneDescriptor({
      kind: "host.controlPlane",
      envelopeVersion: CONTROL_ENVELOPE_VERSION,
      endpointKey: "",
      operationKeys: ["op.1"],
    });
    expect(result.ok).toBe(false);
  });

  it("22. rejects empty operationKeys", () => {
    const result = validateHostControlPlaneDescriptor({
      kind: "host.controlPlane",
      envelopeVersion: CONTROL_ENVELOPE_VERSION,
      endpointKey: "ep-1",
      operationKeys: [],
    });
    expect(result.ok).toBe(false);
  });

  it("23. rejects empty operation key", () => {
    const result = validateHostControlPlaneDescriptor({
      kind: "host.controlPlane",
      envelopeVersion: CONTROL_ENVELOPE_VERSION,
      endpointKey: "ep-1",
      operationKeys: [""],
    });
    expect(result.ok).toBe(false);
  });

  it("24. rejects extra fields", () => {
    const obj = {
      kind: "host.controlPlane",
      envelopeVersion: CONTROL_ENVELOPE_VERSION,
      endpointKey: "ep-1",
      operationKeys: ["op.1"],
      extra: true,
    };
    const result = validateHostControlPlaneDescriptor(obj);
    expect(result.ok).toBe(false);
  });
});

// ─── Warm tests ────────────────────────────────────────────────────

describe("HostWarmStreamDescriptor", () => {
  it("25. accepts valid warm stream descriptor", () => {
    const ws = createHostWarmStreamDescriptor(validWarmStream());
    expect(ws.kind).toBe("host.warmStream");
    expect(ws.streamKey).toBe("ws-1");
  });

  it("26. requires WARM_ENVELOPE_VERSION", () => {
    const result = validateHostWarmStreamDescriptor({
      kind: "host.warmStream",
      envelopeVersion: 999,
      streamKey: "ws-1",
    });
    expect(result.ok).toBe(false);
  });

  it("27. rejects empty streamKey", () => {
    const result = validateHostWarmStreamDescriptor({
      kind: "host.warmStream",
      envelopeVersion: WARM_ENVELOPE_VERSION,
      streamKey: "",
    });
    expect(result.ok).toBe(false);
  });

  it("28. rejects extra fields", () => {
    const result = validateHostWarmStreamDescriptor({
      kind: "host.warmStream",
      envelopeVersion: WARM_ENVELOPE_VERSION,
      streamKey: "ws-1",
      extra: true,
    });
    expect(result.ok).toBe(false);
  });
});

// ─── Resource tests ────────────────────────────────────────────────

describe("HostResourcePlaneDescriptor", () => {
  it("29. accepts valid resource-plane descriptor", () => {
    const rp = createHostResourcePlaneDescriptor(validResourcePlane());
    expect(rp.kind).toBe("host.resourcePlane");
    expect(rp.readRangeOperationKey).toBe(RESOURCE_READ_RANGE_OPERATION_KEY);
  });

  it("30. requires RESOURCE_READ_RANGE_OPERATION_KEY", () => {
    const result = validateHostResourcePlaneDescriptor({
      kind: "host.resourcePlane",
      readRangeOperationKey: "wrong",
    });
    expect(result.ok).toBe(false);
  });

  it("31. rejects extra fields", () => {
    const result = validateHostResourcePlaneDescriptor({
      kind: "host.resourcePlane",
      readRangeOperationKey: RESOURCE_READ_RANGE_OPERATION_KEY,
      extra: true,
    });
    expect(result.ok).toBe(false);
  });
});

// ─── Surface tests ─────────────────────────────────────────────────

describe("HostSurfaceDescriptor", () => {
  it("32. accepts a descriptor with all lanes", () => {
    const surface = createHostSurfaceDescriptor(validSurface());
    expect(surface.kind).toBe("host.surface");
    expect(surface.contractVersion).toBe(1);
    expect(surface.owner.authorityKey).toBe("auth-1");
    expect(surface.hotRegions?.length).toBe(1);
    expect(surface.control).toBeDefined();
    expect(surface.warmStreams?.length).toBe(1);
    expect(surface.resourcePlane).toBeDefined();
  });

  it("33. accepts descriptor with only one lane", () => {
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

  it("34. rejects descriptor with no lanes", () => {
    const result = validateHostSurfaceDescriptor({
      kind: "host.surface",
      contractVersion: HOST_CONTRACT_VERSION,
      owner: validOwner(),
    });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.failure.message).toContain("at least one lane");
    }
  });

  it("35. rejects duplicate hotRegionKey", () => {
    const result = validateHostSurfaceDescriptor({
      kind: "host.surface",
      contractVersion: HOST_CONTRACT_VERSION,
      owner: validOwner(),
      hotRegions: [validHotRegion(), validHotRegion()],
    });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.failure.message).toContain("duplicate");
    }
  });

  it("36. rejects duplicate warm streamKey", () => {
    const result = validateHostSurfaceDescriptor({
      kind: "host.surface",
      contractVersion: HOST_CONTRACT_VERSION,
      owner: validOwner(),
      warmStreams: [validWarmStream(), validWarmStream()],
    });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.failure.message).toContain("duplicate");
    }
  });

  it("37. rejects wrong contractVersion", () => {
    const result = validateHostSurfaceDescriptor({
      kind: "host.surface",
      contractVersion: 999,
      owner: validOwner(),
      hotRegions: [validHotRegion()],
    });
    expect(result.ok).toBe(false);
  });

  it("38. rejects invalid owner", () => {
    const result = validateHostSurfaceDescriptor({
      kind: "host.surface",
      contractVersion: HOST_CONTRACT_VERSION,
      owner: { authorityKey: "", surfaceKey: "", authorityEpoch: "" },
      hotRegions: [validHotRegion()],
    });
    expect(result.ok).toBe(false);
  });

  it("39. JSON.stringify/parse roundtrip preserves descriptor", () => {
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

  it("40. creation helpers do not mutate input objects", () => {
    const input = validSurface();
    const frozen = JSON.parse(JSON.stringify(input));
    createHostSurfaceDescriptor(input);
    expect(input).toEqual(frozen);
  });
});

// ─── Ready and invalidated envelopes tests ─────────────────────────

describe("HostSurfaceReadyEnvelope", () => {
  it("41. accepts valid surfaceReady envelope", () => {
    const envelope = createHostSurfaceReadyEnvelope({
      kind: "host.surfaceReady",
      contractVersion: HOST_CONTRACT_VERSION,
      surface: validSurface(),
    });
    expect(envelope.kind).toBe("host.surfaceReady");
    expect(envelope.surface.owner.authorityKey).toBe("auth-1");
  });

  it("42. rejects invalid surfaceReady surface", () => {
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
  });
});

describe("HostSurfaceInvalidatedEnvelope", () => {
  it("43. accepts valid surfaceInvalidated envelope", () => {
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

  it("44. rejects invalid invalidation reason", () => {
    const result = validateHostSurfaceInvalidatedEnvelope({
      kind: "host.surfaceInvalidated",
      contractVersion: HOST_CONTRACT_VERSION,
      owner: validOwner(),
      reason: "notAReason",
      rebindRequired: true,
    });
    expect(result.ok).toBe(false);
  });

  it("45. rejects rebindRequired false", () => {
    const result = validateHostSurfaceInvalidatedEnvelope({
      kind: "host.surfaceInvalidated",
      contractVersion: HOST_CONTRACT_VERSION,
      owner: validOwner(),
      reason: "surfaceRevoked",
      rebindRequired: false,
    });
    expect(result.ok).toBe(false);
  });

  it("46. rejects raw bigint in invalidated owner", () => {
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
  });

  it("47. does not leak raw BindingValidityFailure object", () => {
    const envelope = createHostSurfaceInvalidatedEnvelope({
      kind: "host.surfaceInvalidated",
      contractVersion: HOST_CONTRACT_VERSION,
      owner: validOwner(),
      reason: "surfaceRevoked",
      rebindRequired: true,
    });
    expect((envelope as Record<string, unknown>).bindingValidityFailure).toBeUndefined();
    expect((envelope as Record<string, unknown>).failure).toBeUndefined();
  });
});

// ─── Failure/errors tests ──────────────────────────────────────────

describe("HostContractFailure", () => {
  it("48. createHostContractFailure accepts valid failure", () => {
    const failure = createHostContractFailure({
      code: "host-contract.invalidDescriptor",
      message: "test failure",
    });
    expect(failure.code).toBe("host-contract.invalidDescriptor");
    expect(failure.message).toBe("test failure");
  });

  it("49. rejects invalid failure code", () => {
    expect(() =>
      createHostContractFailure({
        code: "warm.invalidEnvelope" as "host-contract.invalidDescriptor",
        message: "test",
      }),
    ).toThrow();
  });

  it("50. rejects empty failure message", () => {
    expect(() =>
      createHostContractFailure({
        code: "host-contract.invalidDescriptor",
        message: "",
      }),
    ).toThrow();
  });

  it("51. rejects non-JSON-safe details", () => {
    expect(() =>
      createHostContractFailure({
        code: "host-contract.invalidDescriptor",
        message: "test",
        details: { fn: () => {} } as unknown as Record<string, unknown>,
      }),
    ).toThrow();
  });

  it("validation returns the failure shape", () => {
    const failure = validateHostContractFailure({
      code: "host-contract.rejected",
      message: "validated failure",
    });
    expect(failure.code).toBe("host-contract.rejected");
  });

  it("validates code, message, details shape", () => {
    const failure = validateHostContractFailure({
      code: "host-contract.invalidDescriptor",
      message: "detailed failure",
      details: { key: "value" },
    });
    expect(failure.code).toBe("host-contract.invalidDescriptor");
    expect(failure.details).toEqual({ key: "value" });
  });
});

// ─── Additional validation tests ───────────────────────────────────

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
      expect(result.failure.code).toBe("host-contract.rejected");
      expect(typeof result.failure.message).toBe("string");
      expect(result.failure.message.length).toBeGreaterThan(0);
    }
  });
});
