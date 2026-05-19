import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

import {
  CONTROL_ENVELOPE_VERSION,
  createBindingInvalidControlFailure,
  createControlFailureEnvelope,
  createControlRequestEnvelope,
  createControlSuccessEnvelope,
  validateControlRequestEnvelope,
  validateControlResponseEnvelope,
  validateControlResponseForRequest,
} from "@exclave/control-plane";
import { PUBLICATION_TRANSPORT_ATTACHMENT_VERSION } from "@exclave/publication";
import {
  createResourceDescriptor,
  createStaleBindingResourceFailure,
  RESOURCE_CLOSE_HANDLE_OPERATION_KEY,
  RESOURCE_CLOSE_MAPPING_OPERATION_KEY,
  RESOURCE_MAP_WINDOW_OPERATION_KEY,
  RESOURCE_OPEN_OPERATION_KEY,
  RESOURCE_READ_CHUNK_OPERATION_KEY,
  validateResourceDescriptor,
  validateResourceReceiptFailure,
} from "@exclave/resource";
import {
  type AuthorityBinding,
  createAuthorityBinding,
  invalidateAuthorityBinding,
  markAuthorityBindingReady,
  validateAuthorityBinding,
} from "@exclave/session";

import { describe, expect, it } from "vitest";
import {
  createResourceReadRangeControlRequest,
  createResourceReadRangeControlSuccess,
  RESOURCE_READ_RANGE_OPERATION_KEY,
} from "../../resource/src/resource-control";
import {
  createResourceReadRangeReceiptPayload,
  createResourceReadRangeRequestPayload,
  validateResourceReadRangeReceiptPayload,
} from "../../resource/src/resource-range";

import {
  createHostAuthorityOwnerFromBinding,
  createHostControlPlaneDescriptor,
  createHostHotRegionDescriptor,
  createHostResourcePlaneDescriptor,
  createHostSurfaceDescriptor,
  createHostSurfaceReadyEnvelope,
  createHostWarmStreamDescriptor,
  HOST_CONTRACT_VERSION,
  HOST_WARM_STREAM_DESCRIPTOR_VERSION,
  type HostHotBlockAExpectation,
  type HostHotRegionDescriptor,
  validateHostSurfaceReadyEnvelope,
} from "../src/index";

const __dirname = fileURLToPath(new URL(".", import.meta.url));
const FIXTURES_ROOT = resolve(__dirname, "../../../fixtures/projection-runtime/deck-runtime-v0");

function loadFixtureJson(filename: string): unknown {
  const raw = readFileSync(resolve(FIXTURES_ROOT, filename), "utf-8");
  return JSON.parse(raw);
}

function hexU64ToDecimalString(hex: string): string {
  if (typeof hex !== "string") {
    throw new Error("hexU64ToDecimalString: hex must be a string");
  }
  if (!/^[0-9a-fA-F]{1,16}$/.test(hex)) {
    throw new Error("hexU64ToDecimalString: hex must be 1-16 hex characters");
  }
  return BigInt(`0x${hex}`).toString();
}

function assertDescriptorCarriesOnlyMetadata(
  value: unknown,
  localFieldKeys: ReadonlySet<string>,
  path: string,
): void {
  if (typeof value !== "object" || value === null) {
    return;
  }
  if (Array.isArray(value)) {
    for (let i = 0; i < value.length; i++) {
      assertDescriptorCarriesOnlyMetadata(value[i], localFieldKeys, `${path}[${i}]`);
    }
    return;
  }
  for (const key of Object.keys(value)) {
    if (localFieldKeys.has(key)) {
      throw new Error(`descriptor-local field "${key}" found at ${path}`);
    }
    assertDescriptorCarriesOnlyMetadata(
      (value as Record<string, unknown>)[key],
      localFieldKeys,
      `${path}.${key}`,
    );
  }
}

function loadBlockAFixture(): Record<string, unknown> {
  const data = loadFixtureJson("hot-block-a-fixture.json");
  if (typeof data !== "object" || data === null) {
    throw new Error("block A fixture is not an object");
  }
  return data as Record<string, unknown>;
}

function loadLayoutManifest(): Record<string, unknown> {
  const data = loadFixtureJson("hot-layout-manifest.json");
  if (typeof data !== "object" || data === null) {
    throw new Error("layout manifest is not an object");
  }
  return data as Record<string, unknown>;
}

function mustBeString(value: unknown, label: string): string {
  if (typeof value !== "string") {
    throw new Error(`${label} must be a string, got ${typeof value}`);
  }
  return value;
}

function mustBeNumber(value: unknown, label: string): number {
  if (typeof value !== "number") {
    throw new Error(`${label} must be a number, got ${typeof value}`);
  }
  return value;
}

function deriveFixtureIdentity(): {
  authorityKey: string;
  surfaceKey: string;
  authorityEpoch: bigint;
} {
  const blockA = loadBlockAFixture();
  const authorityKey = mustBeString(blockA.contractKey, "fixture.contractKey");
  const surfaceKey = mustBeString(blockA.instanceKey, "fixture.instanceKey");
  return { authorityKey, surfaceKey, authorityEpoch: 1n };
}

function deriveBlockAExpectation(): HostHotBlockAExpectation {
  const blockA = loadBlockAFixture();
  return {
    contractKey: mustBeString(blockA.contractKey, "fixture.contractKey"),
    instanceKey: mustBeString(blockA.instanceKey, "fixture.instanceKey"),
    semanticVersion: hexU64ToDecimalString(
      mustBeString(blockA.semanticVersion, "fixture.semanticVersion"),
    ),
    hotLayoutVersion: hexU64ToDecimalString(
      mustBeString(blockA.hotLayoutVersion, "fixture.hotLayoutVersion"),
    ),
    fieldCount: mustBeNumber(blockA.fieldCount, "fixture.fieldCount"),
    mutableRegionByteLength: mustBeNumber(
      blockA.mutableRegionByteLength,
      "fixture.mutableRegionByteLength",
    ),
  };
}

function deriveLayoutOffsets(): {
  totalRegionByteLength: number;
  seqlockOffset: number;
  publicationSeqOffset: number;
} {
  const layout = loadLayoutManifest();
  return {
    totalRegionByteLength: mustBeNumber(
      layout.totalRegionByteLength,
      "layout.totalRegionByteLength",
    ),
    seqlockOffset: mustBeNumber(layout.seqlockOffset, "layout.seqlockOffset"),
    publicationSeqOffset: mustBeNumber(layout.publicationSeqOffset, "layout.publicationSeqOffset"),
  };
}

function createFixtureBlockA(): HostHotBlockAExpectation {
  return deriveBlockAExpectation();
}

function createFixtureHotRegion(): HostHotRegionDescriptor {
  const offsets = deriveLayoutOffsets();
  return {
    kind: "host.hotRegion",
    hotRegionKey: "deck-runtime-v0.hot",
    blockA: createFixtureBlockA(),
    totalRegionByteLength: offsets.totalRegionByteLength,
    seqlockOffset: offsets.seqlockOffset,
    publicationSequenceOffset: offsets.publicationSeqOffset,
  };
}

function createFixtureSurfaceReady() {
  const identity = deriveFixtureIdentity();
  const binding: AuthorityBinding = createAuthorityBinding(identity);
  const readyBinding = markAuthorityBindingReady(binding);

  const owner = createHostAuthorityOwnerFromBinding(readyBinding);
  const hotRegion = createHostHotRegionDescriptor(createFixtureHotRegion());

  const control = createHostControlPlaneDescriptor({
    kind: "host.controlPlane",
    envelopeVersion: CONTROL_ENVELOPE_VERSION,
    endpointKey: "deck-runtime-v0.control",
    operationKeys: ["fixture.deckRuntime.describe", "fixture.deckRuntime.invalidate"],
  });

  const warmStream = createHostWarmStreamDescriptor({
    kind: "host.warmStream",
    descriptorVersion: HOST_WARM_STREAM_DESCRIPTOR_VERSION,
    attachmentVersion: PUBLICATION_TRANSPORT_ATTACHMENT_VERSION,
    streamKey: "deck-runtime-v0.warm",
  });

  const resourcePlane = createHostResourcePlaneDescriptor({
    kind: "host.resourcePlane",
    openOperationKey: RESOURCE_OPEN_OPERATION_KEY,
    readChunkOperationKey: RESOURCE_READ_CHUNK_OPERATION_KEY,
    mapWindowOperationKey: RESOURCE_MAP_WINDOW_OPERATION_KEY,
    closeMappingOperationKey: RESOURCE_CLOSE_MAPPING_OPERATION_KEY,
    closeHandleOperationKey: RESOURCE_CLOSE_HANDLE_OPERATION_KEY,
  });

  const surface = createHostSurfaceDescriptor({
    kind: "host.surface",
    contractVersion: HOST_CONTRACT_VERSION,
    owner,
    hotRegions: [hotRegion],
    control,
    warmStreams: [warmStream],
    resourcePlane,
  });

  const envelope = createHostSurfaceReadyEnvelope({
    kind: "host.surfaceReady",
    contractVersion: HOST_CONTRACT_VERSION,
    surface,
  });

  const json = JSON.stringify(envelope);
  const parsed = JSON.parse(json);

  return {
    identity,
    readyBinding,
    envelope,
    validated: validateHostSurfaceReadyEnvelope(parsed),
  };
}

const DESCRIPTOR_LOCAL_FIELD_KEYS = new Set([
  "blockABytesHex",
  "completeFixtureRegionBytesHex",
  "hotRegionBytesHex",
  "completeFixtureRegionBytes",
  "completeFixtureRegion",
  "bytes",
  "buffer",
  "region",
  "view",
  "SharedArrayBuffer",
]);

describe("Client lane consumption across control, resource, and warm", () => {
  describe("Control lane request/response is descriptor-driven", () => {
    it("validates host.surfaceReady, extracts control descriptor, creates and validates a control request/response cycle", () => {
      const { validated } = createFixtureSurfaceReady();

      expect(validated.ok).toBe(true);
      if (!validated.ok) {
        throw new Error(`surfaceReady validation failed: ${validated.failure.message}`);
      }

      const vSurface = validated.value.surface;
      const control = vSurface.control;
      expect(control).toBeDefined();
      if (!control) return;
      expect(control.endpointKey).toBe("deck-runtime-v0.control");
      expect(control.operationKeys).toEqual([
        "fixture.deckRuntime.describe",
        "fixture.deckRuntime.invalidate",
      ]);

      const operationKey = control.operationKeys[0];
      expect(operationKey).toBe("fixture.deckRuntime.describe");

      const requestPayload = {
        endpointKey: control.endpointKey,
        fixture: { action: "describe", target: "deck-runtime-v0" },
      };

      const request = createControlRequestEnvelope({
        requestKey: "request-1",
        operationKey,
        payload: requestPayload,
      });

      expect(request.kind).toBe("control.request");
      expect(request.requestKey).toBe("request-1");
      expect(request.operationKey).toBe(operationKey);
      expect(request.envelopeVersion).toBe(CONTROL_ENVELOPE_VERSION);

      const requestJson = JSON.stringify(request);
      const requestParsed = JSON.parse(requestJson);
      const requestValidated = validateControlRequestEnvelope(requestParsed);
      expect(requestValidated.ok).toBe(true);
      if (!requestValidated.ok) {
        throw new Error(`control request validation failed: ${requestValidated.failure.message}`);
      }

      expect(requestValidated.value.operationKey).toBe(operationKey);
      expect(requestValidated.value.operationKey).toBe(control.operationKeys[0]);

      const responsePayload = { status: "ok", description: "fixture deck runtime v0" };
      const success = createControlSuccessEnvelope({
        requestKey: "request-1",
        payload: responsePayload,
      });

      expect(success.kind).toBe("control.response");
      expect(success.ok).toBe(true);
      expect(success.requestKey).toBe("request-1");
      expect(success.envelopeVersion).toBe(CONTROL_ENVELOPE_VERSION);

      const responseJson = JSON.stringify(success);
      const responseParsed = JSON.parse(responseJson);
      const responseValidated = validateControlResponseEnvelope(responseParsed);
      expect(responseValidated.ok).toBe(true);
      if (!responseValidated.ok) {
        throw new Error(`control response validation failed: ${responseValidated.failure.message}`);
      }

      const correlation = validateControlResponseForRequest(
        requestValidated.value,
        responseValidated.value,
      );
      expect(correlation.ok).toBe(true);
      if (!correlation.ok) {
        throw new Error(`correlation failed: ${correlation.failure.message}`);
      }

      expect(correlation.value.requestKey).toBe("request-1");
      expect(correlation.value.requestKey).toBe(requestValidated.value.requestKey);

      assertDescriptorCarriesOnlyMetadata(
        JSON.parse(requestJson),
        DESCRIPTOR_LOCAL_FIELD_KEYS,
        "request",
      );
      assertDescriptorCarriesOnlyMetadata(
        JSON.parse(responseJson),
        DESCRIPTOR_LOCAL_FIELD_KEYS,
        "response",
      );
      expect(requestJson).not.toContain("SharedArrayBuffer");
      expect(responseJson).not.toContain("SharedArrayBuffer");
    });
  });

  describe("Unsupported operation is rejected using control failure envelope, not dispatch", () => {
    it("request shape validity is separate from operation support; failure is descriptor-driven", () => {
      const { validated } = createFixtureSurfaceReady();

      expect(validated.ok).toBe(true);
      if (!validated.ok) {
        throw new Error(`surfaceReady validation failed: ${validated.failure.message}`);
      }

      const control = validated.value.surface.control;
      expect(control).toBeDefined();
      if (!control) return;
      const supportedOps = new Set(control.operationKeys);
      expect(supportedOps.has("fixture.deckRuntime.describe")).toBe(true);
      expect(supportedOps.has("fixture.deckRuntime.invalidate")).toBe(true);

      const unsupportedOperationKey = "fixture.deckRuntime.nonexistent";
      expect(supportedOps.has(unsupportedOperationKey)).toBe(false);

      const request = createControlRequestEnvelope({
        requestKey: "request-unsupported-1",
        operationKey: unsupportedOperationKey,
        payload: { endpointKey: control.endpointKey, attempt: true },
      });

      expect(request.kind).toBe("control.request");
      expect(request.operationKey).toBe(unsupportedOperationKey);

      const requestJson = JSON.stringify(request);
      const requestParsed = JSON.parse(requestJson);
      const requestValidated = validateControlRequestEnvelope(requestParsed);
      expect(requestValidated.ok).toBe(true);
      if (!requestValidated.ok) {
        throw new Error(
          `unsupported op request validation failed: ${requestValidated.failure.message}`,
        );
      }

      expect(requestValidated.value.operationKey).toBe(unsupportedOperationKey);
      expect(control.operationKeys.includes(requestValidated.value.operationKey)).toBe(false);

      const failureResponse = createControlFailureEnvelope({
        requestKey: "request-unsupported-1",
        failure: {
          code: "control.unsupportedOperation",
          message: `Operation "${unsupportedOperationKey}" is not supported by endpoint "${control.endpointKey}"`,
          details: {
            unsupportedOperationKey,
            endpointKey: control.endpointKey,
            supportedOperationKeys: control.operationKeys,
          },
        },
      });

      expect(failureResponse.kind).toBe("control.response");
      expect(failureResponse.ok).toBe(false);
      expect(failureResponse.requestKey).toBe("request-unsupported-1");
      expect(failureResponse.failure.code).toBe("control.unsupportedOperation");
      expect(failureResponse.failure.message.length).toBeGreaterThan(0);

      const failureJson = JSON.stringify(failureResponse);
      const failureParsed = JSON.parse(failureJson);
      const failureValidated = validateControlResponseEnvelope(failureParsed);
      expect(failureValidated.ok).toBe(true);
      if (!failureValidated.ok) {
        throw new Error(`failure response validation failed: ${failureValidated.failure.message}`);
      }

      const correlation = validateControlResponseForRequest(
        requestValidated.value,
        failureValidated.value,
      );
      expect(correlation.ok).toBe(true);
      if (!correlation.ok) {
        throw new Error(`failure correlation failed: ${correlation.failure.message}`);
      }

      expect(correlation.value.requestKey).toBe("request-unsupported-1");
      expect(correlation.value.requestKey).toBe(requestValidated.value.requestKey);

      if (failureResponse.failure.details) {
        assertDescriptorCarriesOnlyMetadata(
          failureResponse.failure.details,
          DESCRIPTOR_LOCAL_FIELD_KEYS,
          "failure.details",
        );
      }
      expect(failureJson).not.toContain("SharedArrayBuffer");
    });
  });

  describe("Resource read-range request/response is descriptor-driven through the host resource plane", () => {
    it("validates host.surfaceReady, extracts resourcePlane, creates and validates a read-range control request/response", () => {
      const { validated } = createFixtureSurfaceReady();
      expect(validated.ok).toBe(true);
      if (!validated.ok) {
        throw new Error(`surfaceReady validation failed: ${validated.failure.message}`);
      }

      const owner = validated.value.surface.owner;
      const resourcePlane = validated.value.surface.resourcePlane;
      expect(resourcePlane).toBeDefined();
      if (!resourcePlane) return;
      expect(resourcePlane.readChunkOperationKey).toBe(RESOURCE_READ_CHUNK_OPERATION_KEY);

      const descriptor = createResourceDescriptor({
        handleKey: "fixture.resource.waveform-0",
        kind: "fixture.waveform",
        byteLength: 4096,
        version: "1",
        owner: {
          authorityKey: owner.authorityKey,
          surfaceKey: owner.surfaceKey,
          authorityEpoch: owner.authorityEpoch,
        },
      });

      const descriptorJson = JSON.stringify(descriptor);
      const descriptorParsed = JSON.parse(descriptorJson);
      const validatedDescriptor = validateResourceDescriptor(descriptorParsed);
      expect(validatedDescriptor.handleKey).toBe("fixture.resource.waveform-0");
      expect(validatedDescriptor.kind).toBe("fixture.waveform");
      expect(validatedDescriptor.byteLength).toBe(4096);
      expect(validatedDescriptor.version).toBe("1");

      const rangePayload = createResourceReadRangeRequestPayload({
        handleKey: "fixture.resource.waveform-0",
        range: { offset: 0, byteLength: 4096 },
        owner: {
          authorityKey: owner.authorityKey,
          surfaceKey: owner.surfaceKey,
          authorityEpoch: owner.authorityEpoch,
        },
      });

      const request = createResourceReadRangeControlRequest({
        requestKey: "resource-request-1",
        payload: rangePayload,
      });

      expect(request.kind).toBe("control.request");
      expect(request.operationKey).toBe(RESOURCE_READ_RANGE_OPERATION_KEY);

      const requestJson = JSON.stringify(request);
      const requestParsed = JSON.parse(requestJson);
      const requestValidated = validateControlRequestEnvelope(requestParsed);
      expect(requestValidated.ok).toBe(true);
      if (!requestValidated.ok) {
        throw new Error(`resource request validation failed: ${requestValidated.failure.message}`);
      }

      expect(requestValidated.value.operationKey).toBe(RESOURCE_READ_RANGE_OPERATION_KEY);

      const receiptPayload = createResourceReadRangeReceiptPayload({
        handleKey: "fixture.resource.waveform-0",
        range: { offset: 0, byteLength: 4096 },
        byteLength: 4096,
        version: "1",
      });

      const receiptValidated = validateResourceReadRangeReceiptPayload(receiptPayload);
      expect(receiptValidated.handleKey).toBe("fixture.resource.waveform-0");
      expect(receiptValidated.range.offset).toBe(0);
      expect(receiptValidated.range.byteLength).toBe(4096);
      expect(receiptValidated.byteLength).toBe(4096);
      expect(receiptValidated.version).toBe("1");

      const success = createResourceReadRangeControlSuccess({
        requestKey: "resource-request-1",
        payload: receiptPayload,
      });

      expect(success.kind).toBe("control.response");
      expect(success.ok).toBe(true);
      expect(success.requestKey).toBe("resource-request-1");

      const successJson = JSON.stringify(success);
      const successParsed = JSON.parse(successJson);
      const successValidated = validateControlResponseEnvelope(successParsed);
      expect(successValidated.ok).toBe(true);
      if (!successValidated.ok) {
        throw new Error(`resource success validation failed: ${successValidated.failure.message}`);
      }

      expect(successValidated.value.requestKey).toBe("resource-request-1");
      expect(successValidated.value.ok).toBe(true);

      const correlation = validateControlResponseForRequest(
        requestValidated.value,
        successValidated.value,
      );
      expect(correlation.ok).toBe(true);
      if (!correlation.ok) {
        throw new Error(`resource correlation failed: ${correlation.failure.message}`);
      }

      const successPayload = successValidated.value;
      if (successPayload.ok) {
        const receiptFromPayload = validateResourceReadRangeReceiptPayload(successPayload.payload);
        expect(receiptFromPayload.handleKey).toBe("fixture.resource.waveform-0");
        expect(receiptFromPayload.range.offset).toBe(0);
        expect(receiptFromPayload.range.byteLength).toBe(4096);
        expect(receiptFromPayload.byteLength).toBe(4096);
        expect(receiptFromPayload.version).toBe("1");
      }

      assertDescriptorCarriesOnlyMetadata(
        JSON.parse(requestJson),
        DESCRIPTOR_LOCAL_FIELD_KEYS,
        "request",
      );
      assertDescriptorCarriesOnlyMetadata(
        JSON.parse(successJson),
        DESCRIPTOR_LOCAL_FIELD_KEYS,
        "success",
      );
      expect(requestJson).not.toContain("SharedArrayBuffer");
      expect(successJson).not.toContain("SharedArrayBuffer");
      expect(requestJson).not.toContain("bytes");
      expect(successJson).not.toContain("bytes");
    });
  });

  describe("Stale session binding projects consistently into control/resource/warm failures", () => {
    it("projects binding validity failures into control, resource, and warm failure shapes", () => {
      const identity = deriveFixtureIdentity();
      const binding: AuthorityBinding = createAuthorityBinding(identity);
      const readyBinding = markAuthorityBindingReady(binding);
      const invalidatedBinding = invalidateAuthorityBinding(readyBinding, "authorityRestarted");
      const invalidatedFailure = validateAuthorityBinding(invalidatedBinding, identity);
      expect(invalidatedFailure.ok).toBe(false);
      if (invalidatedFailure.ok) {
        throw new Error("invalidated binding unexpectedly validated");
      }
      expect(invalidatedFailure.reason).toBe("bindingInvalidated");

      const controlFailure = createBindingInvalidControlFailure(invalidatedFailure);

      expect(controlFailure.code).toBe("control.bindingInvalid");
      expect(typeof controlFailure.message).toBe("string");
      expect(controlFailure.message.length).toBeGreaterThan(0);

      const controlFailureJson = JSON.stringify(controlFailure);
      const controlFailureParsed = JSON.parse(controlFailureJson);
      const controlDetailsObj = controlFailureParsed.details as Record<string, unknown>;
      expect(controlDetailsObj).toBeDefined();
      expect(controlDetailsObj.reason).toBe("bindingInvalidated");
      expect(controlDetailsObj.rebindRequired).toBe(true);
      expect(typeof controlDetailsObj.invalidationReason).toBe("string");

      assertDescriptorCarriesOnlyMetadata(
        controlFailureParsed,
        DESCRIPTOR_LOCAL_FIELD_KEYS,
        "control-failure",
      );

      const resourceFailure = createStaleBindingResourceFailure(invalidatedFailure);

      expect(resourceFailure.code).toBe("resource.staleBinding");
      expect(typeof resourceFailure.message).toBe("string");
      expect(resourceFailure.message.length).toBeGreaterThan(0);

      const resourceFailureValidated = validateResourceReceiptFailure(resourceFailure);
      expect(resourceFailureValidated.code).toBe("resource.staleBinding");
      expect(typeof resourceFailureValidated.message).toBe("string");

      const resourceFailureJson = JSON.stringify(resourceFailure);
      assertDescriptorCarriesOnlyMetadata(
        JSON.parse(resourceFailureJson),
        DESCRIPTOR_LOCAL_FIELD_KEYS,
        "resource-failure",
      );

      const readyEpochOneBinding = markAuthorityBindingReady(
        createAuthorityBinding({
          authorityKey: identity.authorityKey,
          surfaceKey: identity.surfaceKey,
          authorityEpoch: 1n,
        }),
      );
      const staleExpected = {
        authorityKey: identity.authorityKey,
        surfaceKey: identity.surfaceKey,
        authorityEpoch: 2n,
      };
      const epochMismatchFailure = validateAuthorityBinding(readyEpochOneBinding, staleExpected);
      expect(epochMismatchFailure.ok).toBe(false);
      if (epochMismatchFailure.ok) {
        throw new Error("epoch-mismatched binding unexpectedly validated");
      }
      expect(epochMismatchFailure.reason).toBe("authorityEpochMismatch");

      const controlEpochFailure = createBindingInvalidControlFailure(epochMismatchFailure);
      expect(controlEpochFailure.code).toBe("control.bindingInvalid");
      expect(typeof controlEpochFailure.message).toBe("string");
      expect(controlEpochFailure.message).toContain("authorityEpochMismatch");

      const resourceEpochFailure = createStaleBindingResourceFailure(epochMismatchFailure);
      expect(resourceEpochFailure.code).toBe("resource.staleBinding");
      expect(typeof resourceEpochFailure.message).toBe("string");

      assertDescriptorCarriesOnlyMetadata(
        JSON.parse(JSON.stringify(controlEpochFailure)),
        DESCRIPTOR_LOCAL_FIELD_KEYS,
        "control-epoch-failure",
      );
    });
  });
});
