import type {
  ControlFailureEnvelope,
  ControlRequestEnvelope,
  ControlSuccessEnvelope,
} from "@exclave/control-plane";
import {
  CONTROL_ENVELOPE_VERSION,
  createControlFailureEnvelope,
  createControlRequestEnvelope,
  createControlSuccessEnvelope,
  validateControlRequestEnvelope,
  validateControlResponseEnvelope,
  validateControlResponseForRequest,
} from "@exclave/control-plane";
import { PUBLICATION_TRANSPORT_ATTACHMENT_VERSION } from "@exclave/publication";
import {
  RESOURCE_CLOSE_HANDLE_OPERATION_KEY,
  RESOURCE_CLOSE_MAPPING_OPERATION_KEY,
  RESOURCE_MAP_WINDOW_OPERATION_KEY,
  RESOURCE_OPEN_OPERATION_KEY,
  RESOURCE_READ_CHUNK_OPERATION_KEY,
} from "@exclave/resource";
import {
  type AuthorityBinding,
  createAuthorityBinding,
  guardAuthorityBinding,
  invalidateAuthorityBinding,
  markAuthorityBindingReady,
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
  validateResourceReadRangeRequestPayload,
} from "../../resource/src/resource-range";

import {
  createHostAuthorityRefFromBinding,
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
  type HostGrant,
  type HostGrantInvalidatedEnvelope,
  type HostGrantReadyEnvelope,
  type HostHotBlockAExpectation,
  type HostHotRegionDescriptor,
  validateHostGrantInvalidatedEnvelope,
  validateHostGrantReadyEnvelope,
} from "../src/index";

const OWNER = {
  authorityKey: "authority.alpha",
  grantKey: "surface.deck-a",
  authorityEpoch: "1",
} as const;

const BLOCK_A: HostHotBlockAExpectation = {
  contractKey: "contract.deck-runtime",
  instanceKey: "instance.deck-a",
  semanticVersion: "1",
  hotLayoutVersion: "2",
  fieldCount: 4,
  mutableRegionByteLength: 256,
};

const HOT_REGION: HostHotRegionDescriptor = {
  kind: "host.hotRegion",
  hotRegionKey: "hot.deck-runtime",
  blockA: BLOCK_A,
  totalRegionByteLength: 4096,
  seqlockOffset: 0,
};

const ENDPOINT_LOCAL_BYTE_KEYS = new Set([
  "bytes",
  "buffer",
  "view",
  "region",
  "SharedArrayBuffer",
  "arrayBuffer",
  "base64",
  "raw",
]);

function assertEndpointCarriesOnlyMetadata(value: unknown, path: string): void {
  if (typeof value !== "object" || value === null) return;
  if (Array.isArray(value)) {
    for (let i = 0; i < value.length; i++)
      assertEndpointCarriesOnlyMetadata(value[i], `${path}[${i}]`);
    return;
  }
  for (const key of Object.keys(value as Record<string, unknown>)) {
    if (ENDPOINT_LOCAL_BYTE_KEYS.has(key))
      throw new Error(`endpoint-local byte field "${key}" at ${path}`);
    assertEndpointCarriesOnlyMetadata((value as Record<string, unknown>)[key], `${path}.${key}`);
  }
}

function createAuthorityBindingReady(): AuthorityBinding {
  return markAuthorityBindingReady(
    createAuthorityBinding({
      authorityKey: OWNER.authorityKey,
      grantKey: OWNER.grantKey,
      authorityEpoch: 1n,
    }),
  );
}

type TransferredHandle = {
  readonly handleKey: string;
  readonly hotRegionKey: string;
  readonly expectedByteLength: number;
};

type EndpointMessage =
  | { readonly kind: "grantReady"; readonly envelope: HostGrantReadyEnvelope }
  | { readonly kind: "grantInvalidated"; readonly envelope: HostGrantInvalidatedEnvelope }
  | { readonly kind: "controlRequest"; readonly envelope: ControlRequestEnvelope }
  | {
      readonly kind: "controlResponse";
      readonly envelope: ControlSuccessEnvelope | ControlFailureEnvelope;
    }
  | { readonly kind: "hotHandle"; readonly handle: TransferredHandle };

class EndpointTransportFailure extends Error {
  constructor(message: string) {
    super(message);
    this.name = "EndpointTransportFailure";
  }
}

class TransportBoundary {
  private _hostToClient: EndpointMessage[] = [];
  private _clientToHost: EndpointMessage[] = [];
  private _closed = false;

  hostSend(message: EndpointMessage): void {
    if (this._closed) throw new EndpointTransportFailure("transport is closed");
    this._hostToClient.push(message);
  }

  clientReceive(): EndpointMessage | null {
    if (this._closed) throw new EndpointTransportFailure("transport is closed");
    return this._hostToClient.shift() ?? null;
  }

  clientSend(message: EndpointMessage): void {
    if (this._closed) throw new EndpointTransportFailure("transport is closed");
    this._clientToHost.push(message);
  }

  hostReceive(): EndpointMessage | null {
    if (this._closed) throw new EndpointTransportFailure("transport is closed");
    return this._clientToHost.shift() ?? null;
  }

  shutdown(): void {
    this._hostToClient.length = 0;
    this._clientToHost.length = 0;
    this._closed = true;
  }

  get closed(): boolean {
    return this._closed;
  }
}

function jsonRoundtrip<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

class HostEndpoint {
  private _binding: AuthorityBinding;
  private _transport: TransportBoundary;
  private _config: {
    readonly hotRegion: HostHotRegionDescriptor;
    readonly controlEndpointKey: string;
    readonly controlOperationKeys: readonly string[];
    readonly warmStreamKey: string;
  };

  constructor(
    transport: TransportBoundary,
    config: {
      hotRegion: HostHotRegionDescriptor;
      controlEndpointKey: string;
      controlOperationKeys: readonly string[];
      warmStreamKey: string;
    },
  ) {
    this._transport = transport;
    this._config = config;
    this._binding = createAuthorityBindingReady();
  }

  get binding(): AuthorityBinding {
    return this._binding;
  }

  openGrant(): void {
    const authorityRef = createHostAuthorityRefFromBinding(this._binding);

    const hotRegion = createHostHotRegionDescriptor(this._config.hotRegion);

    const control = createHostControlPlaneDescriptor({
      kind: "host.controlPlane",
      envelopeVersion: CONTROL_ENVELOPE_VERSION,
      endpointKey: this._config.controlEndpointKey,
      operationKeys: [...this._config.controlOperationKeys],
    });

    const warmStream = createHostWarmStreamDescriptor({
      kind: "host.warmStream",
      descriptorVersion: HOST_WARM_STREAM_DESCRIPTOR_VERSION,
      attachmentVersion: PUBLICATION_TRANSPORT_ATTACHMENT_VERSION,
      streamKey: this._config.warmStreamKey,
    });

    const resourcePlane = createHostResourcePlaneDescriptor({
      kind: "host.resourcePlane",
      openOperationKey: RESOURCE_OPEN_OPERATION_KEY,
      readChunkOperationKey: RESOURCE_READ_CHUNK_OPERATION_KEY,
      mapWindowOperationKey: RESOURCE_MAP_WINDOW_OPERATION_KEY,
      closeMappingOperationKey: RESOURCE_CLOSE_MAPPING_OPERATION_KEY,
      closeHandleOperationKey: RESOURCE_CLOSE_HANDLE_OPERATION_KEY,
    });

    const grant = createHostGrantDescriptor({
      kind: "host.grantDescriptor",
      contractVersion: HOST_CONTRACT_VERSION,
      authority: authorityRef,
      hotRegions: [hotRegion],
      control,
      warmStreams: [warmStream],
      resourcePlane,
    });

    const envelope = createHostGrantReadyEnvelope({
      kind: "host.grantReady",
      contractVersion: HOST_CONTRACT_VERSION,
      grant,
    });

    this._transport.hostSend({
      kind: "grantReady",
      envelope: jsonRoundtrip(envelope),
    });
  }

  publishHotHandle(): TransferredHandle {
    const handle: TransferredHandle = {
      handleKey: "handle.deck-runtime",
      hotRegionKey: this._config.hotRegion.hotRegionKey,
      expectedByteLength: this._config.hotRegion.totalRegionByteLength,
    };
    this._transport.hostSend({ kind: "hotHandle", handle });
    return handle;
  }

  handleIncomingRequest(): void {
    const msg = this._transport.hostReceive();
    if (msg === null || msg.kind !== "controlRequest") return;

    const validated = validateControlRequestEnvelope(jsonRoundtrip(msg.envelope));
    if (!validated.ok) {
      const failure = createControlFailureEnvelope({
        requestKey: msg.envelope.requestKey,
        failure: {
          code: "control.invalidEnvelope",
          message: validated.failure.message,
        },
      });
      this._transport.hostSend({ kind: "controlResponse", envelope: failure });
      return;
    }

    const operationKey = validated.value.operationKey;
    const requestKey = validated.value.requestKey;
    const supportedSet = new Set(this._config.controlOperationKeys);

    if (!supportedSet.has(operationKey)) {
      const failure = createControlFailureEnvelope({
        requestKey,
        failure: {
          code: "control.unsupportedOperation",
          message: `Operation "${operationKey}" is not supported by endpoint "${this._config.controlEndpointKey}"`,
          details: {
            unsupportedOperationKey: operationKey,
            endpointKey: this._config.controlEndpointKey,
            supportedOperationKeys: [...this._config.controlOperationKeys],
          },
        },
      });
      this._transport.hostSend({ kind: "controlResponse", envelope: failure });
      return;
    }

    if (operationKey === RESOURCE_READ_RANGE_OPERATION_KEY) {
      const resourcePayload = validateResourceReadRangeRequestPayload(validated.value.payload);

      const receiptPayload = createResourceReadRangeReceiptPayload({
        handleKey: resourcePayload.handleKey,
        range: resourcePayload.range,
        byteLength: resourcePayload.range.byteLength,
        version: "1",
      });

      const success = createResourceReadRangeControlSuccess({
        requestKey,
        payload: receiptPayload,
      });

      this._transport.hostSend({ kind: "controlResponse", envelope: success });
      return;
    }

    const success = createControlSuccessEnvelope({
      requestKey,
      payload: { status: "ok", operationKey },
    });
    this._transport.hostSend({ kind: "controlResponse", envelope: success });
  }

  invalidateGrant(reason: "authorityRestarted"): void {
    this._binding = invalidateAuthorityBinding(this._binding, reason);
    const authorityRef = createHostAuthorityRefFromBinding(this._binding);
    const envelope = createHostGrantInvalidatedEnvelope({
      kind: "host.grantInvalidated",
      contractVersion: HOST_CONTRACT_VERSION,
      authority: authorityRef,
      reason,
      rebindRequired: true,
    });
    this._transport.hostSend({ kind: "grantInvalidated", envelope });
  }
}

class ClientEndpoint {
  private _transport: TransportBoundary;
  private _grant: HostGrant | null = null;
  private _binding: AuthorityBinding | null = null;

  constructor(transport: TransportBoundary) {
    this._transport = transport;
  }

  get grant(): HostGrant {
    if (this._grant === null) throw new Error("grant not initialized");
    return this._grant;
  }

  get binding(): AuthorityBinding {
    if (this._binding === null) throw new Error("binding not initialized");
    return this._binding;
  }

  acceptGrantReady(): HostGrant {
    const msg = this._transport.clientReceive();
    if (msg === null || msg.kind !== "grantReady") {
      throw new EndpointTransportFailure("expected grantReady message");
    }

    const parsed = jsonRoundtrip(msg.envelope);
    const validated = validateHostGrantReadyEnvelope(parsed);
    if (!validated.ok) {
      throw new Error(`grantReady validation failed: ${validated.failure.message}`);
    }

    const grant = createHostGrant(validated.value.grant);
    this._grant = grant;
    this._binding = markAuthorityBindingReady(
      createAuthorityBinding({
        authorityKey: grant.expectedBinding.authorityKey,
        grantKey: grant.expectedBinding.grantKey,
        authorityEpoch: grant.expectedBinding.authorityEpoch,
      }),
    );
    return grant;
  }

  receiveHotHandle(): TransferredHandle {
    const msg = this._transport.clientReceive();
    if (msg === null || msg.kind !== "hotHandle") {
      throw new EndpointTransportFailure("expected hotHandle message");
    }
    return msg.handle;
  }

  sendControlRequest(operationKey: string): ControlRequestEnvelope {
    if (!this._grant?.control) throw new Error("grant has no control capability");

    const request = createControlRequestEnvelope({
      requestKey: `req-${operationKey}`,
      operationKey,
      payload: { endpointKey: this._grant.control.endpointKey, action: "invoke" },
    });
    this._transport.clientSend({ kind: "controlRequest", envelope: request });
    return request;
  }

  receiveControlResponse(): ControlSuccessEnvelope | ControlFailureEnvelope {
    const msg = this._transport.clientReceive();
    if (msg === null || msg.kind !== "controlResponse") {
      throw new EndpointTransportFailure("expected controlResponse message");
    }
    return msg.envelope;
  }

  consumeControlResponse(
    request: ControlRequestEnvelope,
    response: ControlSuccessEnvelope | ControlFailureEnvelope,
  ): { correlated: boolean; ok: boolean; failureCode?: string } {
    const requestValidated = validateControlRequestEnvelope(jsonRoundtrip(request));
    if (!requestValidated.ok)
      throw new Error(`request validation failed: ${requestValidated.failure.message}`);

    const responseValidated = validateControlResponseEnvelope(jsonRoundtrip(response));
    if (!responseValidated.ok)
      throw new Error(`response validation failed: ${responseValidated.failure.message}`);

    const correlation = validateControlResponseForRequest(
      requestValidated.value,
      responseValidated.value,
    );
    if (!correlation.ok) return { correlated: false, ok: false };

    return {
      correlated: true,
      ok: responseValidated.value.ok,
      ...(responseValidated.value.ok === false
        ? { failureCode: responseValidated.value.failure.code }
        : {}),
    };
  }

  sendResourceReadRangeRequest(): ControlRequestEnvelope {
    if (!this._grant?.resourcePlane) throw new Error("grant has no resource plane capability");

    const rangePayload = createResourceReadRangeRequestPayload({
      handleKey: "resource.waveform",
      range: { offset: 0, byteLength: 512 },
      owner: {
        authorityKey: this._grant.authority.authorityKey,
        grantKey: this._grant.authority.grantKey,
        authorityEpoch: this._grant.authority.authorityEpoch,
      },
    });

    const request = createResourceReadRangeControlRequest({
      requestKey: "req-resource-read",
      payload: rangePayload,
    });

    this._transport.clientSend({ kind: "controlRequest", envelope: request });
    return request;
  }

  consumeResourceReceipt(
    request: ControlRequestEnvelope,
    response: ControlSuccessEnvelope,
  ): { handleKey: string; range: { offset: number; byteLength: number }; version: string } {
    const requestValidated = validateControlRequestEnvelope(jsonRoundtrip(request));
    if (!requestValidated.ok)
      throw new Error(`resource request validation failed: ${requestValidated.failure.message}`);

    const responseValidated = validateControlResponseEnvelope(jsonRoundtrip(response));
    if (!responseValidated.ok)
      throw new Error(`resource response validation failed: ${responseValidated.failure.message}`);

    const correlation = validateControlResponseForRequest(
      requestValidated.value,
      responseValidated.value,
    );
    if (!correlation.ok)
      throw new Error(`resource correlation failed: ${correlation.failure.message}`);

    if (!responseValidated.value.ok) throw new Error("resource response was not ok");

    const receipt = validateResourceReadRangeReceiptPayload(
      responseValidated.value.payload as Record<string, unknown>,
    );
    return {
      handleKey: receipt.handleKey,
      range: receipt.range,
      version: receipt.version,
    };
  }

  receiveInvalidation(): HostGrantInvalidatedEnvelope {
    const msg = this._transport.clientReceive();
    if (msg === null || msg.kind !== "grantInvalidated") {
      throw new EndpointTransportFailure("expected grantInvalidated message");
    }
    return msg.envelope;
  }

  applyInvalidation(envelope: HostGrantInvalidatedEnvelope): void {
    const parsed = jsonRoundtrip(envelope);
    const validated = validateHostGrantInvalidatedEnvelope(parsed);
    if (!validated.ok)
      throw new Error(`invalidation validation failed: ${validated.failure.message}`);

    if (this._grant === null || this._binding === null) {
      throw new Error("cannot apply invalidation without an active grant/binding");
    }

    const authorityRef = validated.value.authority;
    if (
      authorityRef.authorityKey !== this._grant.authority.authorityKey ||
      authorityRef.grantKey !== this._grant.authority.grantKey ||
      authorityRef.authorityEpoch !== this._grant.authority.authorityEpoch
    ) {
      throw new Error(
        "invalidation authority does not match current grant authority; rejecting foreign/stale invalidation",
      );
    }

    this._binding = invalidateAuthorityBinding(this._binding, validated.value.reason);
  }

  guardedRead(grant: HostGrant): boolean {
    if (this._binding === null) throw new Error("binding not initialized");

    const read = () => {
      this._lastGuardSpyCalled += 1;
      return true;
    };

    const guardResult = guardAuthorityBinding(this._binding, grant.expectedBinding, read);

    if (!guardResult.ok) {
      if (guardResult.reason === "bindingInvalidated") this._lastGuardReason = "bindingInvalidated";
      else this._lastGuardReason = guardResult.reason;
      return false;
    }

    return guardResult.value;
  }

  private _lastGuardReason: string | null = null;
  get lastGuardReason(): string | null {
    return this._lastGuardReason;
  }

  private _lastGuardSpyCalled = 0;
  get lastGuardSpyCalled(): number {
    return this._lastGuardSpyCalled;
  }
}

function createEndpointBoundaryFixture(): {
  transport: TransportBoundary;
  host: HostEndpoint;
  client: ClientEndpoint;
} {
  const transport = new TransportBoundary();
  const host = new HostEndpoint(transport, {
    hotRegion: HOT_REGION,
    controlEndpointKey: "control.deck-runtime",
    controlOperationKeys: ["control.describe", RESOURCE_READ_RANGE_OPERATION_KEY],
    warmStreamKey: "warm.deck-runtime",
  });
  const client = new ClientEndpoint(transport);
  return { transport, host, client };
}

describe("endpoint grant readiness", () => {
  it("validates a host.grantReady envelope and creates a HostGrant only through createHostGrant", () => {
    const { host, client, transport } = createEndpointBoundaryFixture();

    host.openGrant();

    const grant = client.acceptGrantReady();

    expect(grant.kind).toBe("host.grant");
    expect(grant.authority.authorityKey).toBe(OWNER.authorityKey);
    expect(grant.authority.grantKey).toBe(OWNER.grantKey);
    expect(grant.authority.authorityEpoch).toBe(OWNER.authorityEpoch);
    expect(grant.expectedBinding.authorityEpoch).toBe(1n);
    expect(grant.hot).toHaveLength(1);
    expect(grant.hot[0].hotRegionKey).toBe("hot.deck-runtime");
    expect(grant.control?.endpointKey).toBe("control.deck-runtime");
    expect(grant.warm).toHaveLength(1);
    expect(grant.warm[0].streamKey).toBe("warm.deck-runtime");
    expect(grant.resourcePlane?.readChunkOperationKey).toBe(RESOURCE_READ_CHUNK_OPERATION_KEY);

    assertEndpointCarriesOnlyMetadata(grant, "grant");
    expect((grant as Record<string, unknown>).endpoint).toBeUndefined();
    expect((grant as Record<string, unknown>).transport).toBeUndefined();
    expect((grant as Record<string, unknown>).grant).toBeUndefined();
    expect(transport.closed).toBe(false);
  });
});

describe("endpoint hot handle transfer", () => {
  it("carries a TransferredHandle token without bytes, buffer handles, generated readers, or ABI decoding", () => {
    const { host, client } = createEndpointBoundaryFixture();

    host.openGrant();
    const grant = client.acceptGrantReady();

    const handle = host.publishHotHandle();
    expect(handle.hotRegionKey).toBe("hot.deck-runtime");
    expect(handle.expectedByteLength).toBe(4096);

    const received = client.receiveHotHandle();

    expect(received.handleKey).toBe("handle.deck-runtime");
    expect(received.hotRegionKey).toBe(grant.hot[0].hotRegionKey);
    expect(received.expectedByteLength).toBe(grant.hot[0].expectedByteLength);

    expect((received as Record<string, unknown>).bytes).toBeUndefined();
    expect((received as Record<string, unknown>).buffer).toBeUndefined();
    expect((received as Record<string, unknown>).region).toBeUndefined();
    expect((received as Record<string, unknown>).reader).toBeUndefined();
  });
});

describe("endpoint control envelopes", () => {
  it("carries control request from client and correlated response from host; transport does not inspect operation support", () => {
    const { host, client } = createEndpointBoundaryFixture();

    host.openGrant();
    client.acceptGrantReady();

    const request = client.sendControlRequest("control.describe");
    expect(request.kind).toBe("control.request");
    expect(request.operationKey).toBe("control.describe");

    host.handleIncomingRequest();

    const response = client.receiveControlResponse();
    expect(response.kind).toBe("control.response");
    expect(response.ok).toBe(true);

    const consumed = client.consumeControlResponse(request, response);
    expect(consumed.correlated).toBe(true);
    expect(consumed.ok).toBe(true);
    expect(consumed.failureCode).toBeUndefined();

    const requestPayload = jsonRoundtrip(request).payload as Record<string, unknown>;
    expect(requestPayload.endpointKey).toBe("control.deck-runtime");
  });
});

describe("endpoint control operation support", () => {
  it("returns control.unsupportedOperation for unknown operations; failure stays a control response", () => {
    const { host, client } = createEndpointBoundaryFixture();

    host.openGrant();
    client.acceptGrantReady();

    const request = client.sendControlRequest("control.unknown");
    const validated = validateControlRequestEnvelope(jsonRoundtrip(request));
    expect(validated.ok).toBe(true);

    host.handleIncomingRequest();

    const response = client.receiveControlResponse();
    expect(response.ok).toBe(false);
    expect(response.kind).toBe("control.response");

    const failure = response as ControlFailureEnvelope;
    expect(failure.failure.code).toBe("control.unsupportedOperation");
    expect(failure).not.toBeInstanceOf(EndpointTransportFailure);

    const consumed = client.consumeControlResponse(request, response);
    expect(consumed.correlated).toBe(true);
    expect(consumed.ok).toBe(false);
    expect(consumed.failureCode).toBe("control.unsupportedOperation");
  });
});

describe("endpoint resource receipts", () => {
  it("validates request payload on host side, returns receipt metadata only, carries no bytes", () => {
    const { host, client } = createEndpointBoundaryFixture();

    host.openGrant();
    const grant = client.acceptGrantReady();
    expect(grant.resourcePlane).toBeDefined();

    const request = client.sendResourceReadRangeRequest();
    expect(request.kind).toBe("control.request");
    expect(request.operationKey).toBe(RESOURCE_READ_RANGE_OPERATION_KEY);

    const requestValidated = validateControlRequestEnvelope(jsonRoundtrip(request));
    expect(requestValidated.ok).toBe(true);
    const requestPayload = validateResourceReadRangeRequestPayload(requestValidated.value.payload);

    host.handleIncomingRequest();

    const response = client.receiveControlResponse();
    expect(response.kind).toBe("control.response");
    expect(response.ok).toBe(true);

    const receipt = client.consumeResourceReceipt(request, response as ControlSuccessEnvelope);
    expect(receipt.handleKey).toBe(requestPayload.handleKey);
    expect(receipt.range).toEqual(requestPayload.range);
    expect(receipt.version).toBe("1");

    const responseValidated = validateControlResponseEnvelope(jsonRoundtrip(response));
    expect(responseValidated.ok).toBe(true);
    if (responseValidated.ok && responseValidated.value.ok) {
      const receiptPayload = validateResourceReadRangeReceiptPayload(
        responseValidated.value.payload as Record<string, unknown>,
      );
      expect(receiptPayload.byteLength).toBe(receiptPayload.range.byteLength);
    }

    assertEndpointCarriesOnlyMetadata(response, "resource read-range response");
    const responseJson = JSON.stringify(response);
    expect(responseJson).not.toContain("SharedArrayBuffer");
    expect(responseJson).not.toContain("ArrayBuffer");
    expect(responseJson).not.toContain("Uint8Array");
    expect(responseJson).not.toContain("base64");
    expect(responseJson).not.toContain("blob");
  });
});

describe("endpoint invalidation", () => {
  it("blocks guarded use before the protected read callback runs", () => {
    const { host, client } = createEndpointBoundaryFixture();

    host.openGrant();
    const grant = client.acceptGrantReady();

    host.invalidateGrant("authorityRestarted");

    const invalidationEnvelope = client.receiveInvalidation();
    expect(invalidationEnvelope.kind).toBe("host.grantInvalidated");
    expect(invalidationEnvelope.reason).toBe("authorityRestarted");

    client.applyInvalidation(invalidationEnvelope);

    const readOk = client.guardedRead(grant);
    expect(readOk).toBe(false);
    expect(client.lastGuardReason).toBe("bindingInvalidated");
    expect(client.lastGuardSpyCalled).toBe(0);
  });

  it("rejects invalidation from a foreign authority", () => {
    const { host, client } = createEndpointBoundaryFixture();

    host.openGrant();
    client.acceptGrantReady();

    const foreignEnvelope = createHostGrantInvalidatedEnvelope({
      kind: "host.grantInvalidated",
      contractVersion: HOST_CONTRACT_VERSION,
      authority: {
        authorityKey: "authority.foreign",
        grantKey: "surface.foreign",
        authorityEpoch: "1",
      },
      reason: "authorityRestarted",
      rebindRequired: true,
    });

    host.invalidateGrant("authorityRestarted");
    client.receiveInvalidation();

    expect(() => client.applyInvalidation(foreignEnvelope)).toThrow(
      /invalidation authority does not match/,
    );
  });

  it("rejects stale invalidation by epoch mismatch and preserves the binding", () => {
    const { host, client } = createEndpointBoundaryFixture();

    host.openGrant();
    const grant = client.acceptGrantReady();

    const staleEnvelope = createHostGrantInvalidatedEnvelope({
      kind: "host.grantInvalidated",
      contractVersion: HOST_CONTRACT_VERSION,
      authority: {
        authorityKey: OWNER.authorityKey,
        grantKey: OWNER.grantKey,
        authorityEpoch: "2",
      },
      reason: "authorityRestarted",
      rebindRequired: true,
    });

    expect(() => client.applyInvalidation(staleEnvelope)).toThrow(
      /invalidation authority does not match/,
    );

    const readOk = client.guardedRead(grant);
    expect(readOk).toBe(true);
    expect(client.lastGuardSpyCalled).toBe(1);
  });
});

describe("endpoint transport failures", () => {
  it("produces a test-local transport failure for missing messages", () => {
    const { client } = createEndpointBoundaryFixture();

    expect(() => client.acceptGrantReady()).toThrow(EndpointTransportFailure);
  });

  it("treats control.unsupportedOperation as a control response, not a transport failure", () => {
    const { host, client } = createEndpointBoundaryFixture();

    host.openGrant();
    client.acceptGrantReady();

    client.sendControlRequest("control.unknown");
    host.handleIncomingRequest();

    const response = client.receiveControlResponse();
    expect(response.ok).toBe(false);
    expect((response as ControlFailureEnvelope).failure.code).toBe("control.unsupportedOperation");
    expect(response).not.toBeInstanceOf(EndpointTransportFailure);
  });

  it("produces a transport failure on shutdown, separate from semantic failure", () => {
    const { transport, host } = createEndpointBoundaryFixture();

    host.openGrant();
    transport.shutdown();

    expect(() =>
      transport.hostSend({
        kind: "hotHandle",
        handle: {
          handleKey: "handle.deck-runtime",
          hotRegionKey: "hot.deck-runtime",
          expectedByteLength: 4096,
        },
      }),
    ).toThrow(EndpointTransportFailure);
  });
});
