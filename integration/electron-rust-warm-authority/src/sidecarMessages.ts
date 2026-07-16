import type { JsonObject } from "@exclave/base";
import {
  type ControlFailureEnvelope,
  type ControlSuccessEnvelope,
  createControlRequestEnvelope,
  validateControlResponseEnvelope,
} from "@exclave/control-plane";
import {
  parseSerializedPublicationAttachment,
  parseSerializedSubscribeResult,
  type SerializedPublicationAttachment,
  type SerializedSubscribePublicationRequest,
  type SerializedSubscribeResult,
} from "./portProtocol.js";
import {
  encodeSidecarFrame,
  SIDECAR_PACKET_KIND,
  type SidecarFrame,
  type SidecarPacketKind,
} from "./sidecarFrame.js";
import { isCanonicalAuthorityEpoch, isCanonicalU64Hex } from "./wireValues.js";

export type AuthorityLifecycleMessage = {
  readonly kind: "authorityStarting" | "authorityReady";
  readonly authorityEpoch: string;
};

export type SidecarSubscribeResult = {
  readonly requestKey: string;
  readonly result: SerializedSubscribeResult;
};

export type SidecarWarmPublication = {
  readonly attachment: SerializedPublicationAttachment;
  readonly frameBytes: Uint8Array;
  readonly upstreamCoalescedPublicationCount: number;
};

export type SidecarTransportMetrics = {
  readonly maxInFlightCount: number;
  readonly maxPendingCount: number;
  readonly pendingCount: number;
  readonly upstreamCoalescedPublicationCount: number;
  readonly latestDeliveredPublicationSequence: string | null;
};

export type SidecarMetricsResponse = {
  readonly requestKey: string;
  readonly metrics: SidecarTransportMetrics;
};

const encoder = new TextEncoder();
const decoder = new TextDecoder("utf-8", { fatal: true });

export function decodeAuthorityLifecycleMessage(frame: SidecarFrame): AuthorityLifecycleMessage {
  const expectedKind =
    frame.packetKind === SIDECAR_PACKET_KIND.authorityStarting
      ? "authorityStarting"
      : frame.packetKind === SIDECAR_PACKET_KIND.authorityReady
        ? "authorityReady"
        : null;
  if (expectedKind === null)
    throw new TypeError("sidecar packet is not an authority lifecycle event");
  const value = decodeJsonRecord(frame.payload, expectedKind);
  exactKeys(value, ["kind", "authorityEpoch"], expectedKind);
  if (value.kind !== expectedKind) throw new TypeError(`${expectedKind}.kind is invalid`);
  return {
    kind: expectedKind,
    authorityEpoch: canonicalEpoch(value.authorityEpoch, `${expectedKind}.authorityEpoch`),
  };
}

export function encodeSubscribeRequest(
  requestKey: string,
  request: SerializedSubscribePublicationRequest,
): Uint8Array {
  return encodeJsonSidecarPacket(SIDECAR_PACKET_KIND.subscribeRequest, { requestKey, request });
}

export function decodeSubscribeResult(frame: SidecarFrame): SidecarSubscribeResult {
  requireKind(frame, SIDECAR_PACKET_KIND.subscribeResult);
  const value = decodeJsonRecord(frame.payload, "subscribe result packet");
  exactKeys(value, ["requestKey", "result"], "subscribe result packet");
  return {
    requestKey: nonEmptyString(value.requestKey, "subscribe result.requestKey"),
    result: parseSerializedSubscribeResult(value.result),
  };
}

export function encodeUnsubscribeRequest(input: {
  readonly requestKey: string;
  readonly subscriptionId: string;
  readonly authorityEpoch: string;
}): Uint8Array {
  return encodeJsonSidecarPacket(SIDECAR_PACKET_KIND.unsubscribeRequest, {
    requestKey: input.requestKey,
    request: {
      subscriptionId: input.subscriptionId,
      authorityEpoch: input.authorityEpoch,
    },
  });
}

export function decodeUnsubscribeResult(frame: SidecarFrame): {
  readonly requestKey: string;
  readonly ok: boolean;
} {
  requireKind(frame, SIDECAR_PACKET_KIND.unsubscribeResult);
  const value = decodeJsonRecord(frame.payload, "unsubscribe result packet");
  exactKeys(value, ["requestKey", "result"], "unsubscribe result packet");
  const result = plainRecord(value.result, "unsubscribe result");
  if (result.ok === true) {
    exactKeys(result, ["ok"], "unsubscribe result success");
  } else if (result.ok === false) {
    exactKeys(result, ["ok", "failure"], "unsubscribe result failure");
    validateUnsubscribeFailure(result.failure);
  } else {
    throw new TypeError("unsubscribe result.ok must be boolean");
  }
  return {
    requestKey: nonEmptyString(value.requestKey, "unsubscribe result.requestKey"),
    ok: result.ok,
  };
}

export function encodeSetTempoRatioControl(input: {
  readonly requestKey: string;
  readonly authorityEpoch: string;
  readonly tempoRatio: number;
}): Uint8Array {
  const envelope = createControlRequestEnvelope({
    requestKey: input.requestKey,
    operationKey: "deck.setTempoRatio",
    payload: {
      authorityEpoch: input.authorityEpoch,
      tempoRatio: input.tempoRatio,
    },
  });
  return encodeJsonSidecarPacket(SIDECAR_PACKET_KIND.controlRequest, envelope);
}

export function decodeControlResponse(
  frame: SidecarFrame,
): ControlSuccessEnvelope | ControlFailureEnvelope {
  requireKind(frame, SIDECAR_PACKET_KIND.controlResponse);
  const value = decodeJson(frame.payload, "control response");
  const validated = validateControlResponseEnvelope(value);
  if (!validated.ok) throw new TypeError(validated.failure.message);
  return validated.value;
}

export function decodeWarmPublication(frame: SidecarFrame): SidecarWarmPublication {
  requireKind(frame, SIDECAR_PACKET_KIND.warmPublication);
  if (frame.payload.byteLength < 4) {
    throw new TypeError("warm publication payload is shorter than metadata length prefix");
  }
  const view = new DataView(
    frame.payload.buffer,
    frame.payload.byteOffset,
    frame.payload.byteLength,
  );
  const metadataByteLength = view.getUint32(0, true);
  if (metadataByteLength > frame.payload.byteLength - 4) {
    throw new TypeError("warm publication metadata length exceeds packet payload");
  }
  const metadataEnd = 4 + metadataByteLength;
  const metadata = decodeJsonRecord(
    frame.payload.subarray(4, metadataEnd),
    "warm publication metadata",
  );
  exactKeys(metadata, ["attachment", "diagnostics"], "warm publication metadata");
  const attachment = parseSerializedPublicationAttachment(metadata.attachment);
  const diagnostics = plainRecord(metadata.diagnostics, "warm publication diagnostics");
  exactKeys(diagnostics, ["upstreamCoalescedPublicationCount"], "warm publication diagnostics");
  const frameBytes = Uint8Array.from(frame.payload.subarray(metadataEnd));
  if (frameBytes.byteLength === 0) throw new TypeError("warm publication frame bytes are empty");
  return {
    attachment,
    frameBytes,
    upstreamCoalescedPublicationCount: nonNegativeSafeInteger(
      diagnostics.upstreamCoalescedPublicationCount,
      "warm publication upstreamCoalescedPublicationCount",
    ),
  };
}

export function encodePublicationCredit(input: {
  readonly subscriptionId: string;
  readonly authorityEpoch: string;
  readonly publicationSequence: string;
}): Uint8Array {
  return encodeJsonSidecarPacket(SIDECAR_PACKET_KIND.publicationCredit, input);
}

export function encodeMetricsRequest(requestKey: string): Uint8Array {
  return encodeJsonSidecarPacket(SIDECAR_PACKET_KIND.metricsRequest, { requestKey });
}

export function decodeMetricsResponse(frame: SidecarFrame): SidecarMetricsResponse {
  requireKind(frame, SIDECAR_PACKET_KIND.metricsResponse);
  const value = decodeJsonRecord(frame.payload, "metrics response");
  exactKeys(value, ["requestKey", "metrics"], "metrics response");
  const metrics = plainRecord(value.metrics, "metrics response.metrics");
  exactKeys(
    metrics,
    [
      "maxInFlightCount",
      "maxPendingCount",
      "pendingCount",
      "upstreamCoalescedPublicationCount",
      "latestDeliveredPublicationSequence",
    ],
    "metrics response.metrics",
  );
  const latest = metrics.latestDeliveredPublicationSequence;
  if (latest !== null && !isCanonicalU64Hex(latest)) {
    throw new TypeError("metrics latestDeliveredPublicationSequence must be null or u64 hex");
  }
  return {
    requestKey: nonEmptyString(value.requestKey, "metrics response.requestKey"),
    metrics: {
      maxInFlightCount: nonNegativeSafeInteger(metrics.maxInFlightCount, "maxInFlightCount"),
      maxPendingCount: nonNegativeSafeInteger(metrics.maxPendingCount, "maxPendingCount"),
      pendingCount: nonNegativeSafeInteger(metrics.pendingCount, "pendingCount"),
      upstreamCoalescedPublicationCount: nonNegativeSafeInteger(
        metrics.upstreamCoalescedPublicationCount,
        "upstreamCoalescedPublicationCount",
      ),
      latestDeliveredPublicationSequence: latest,
    },
  };
}

export function encodeShutdown(): Uint8Array {
  return encodeJsonSidecarPacket(SIDECAR_PACKET_KIND.shutdown, {});
}

export function encodeJsonSidecarPacket(
  packetKind: SidecarPacketKind,
  value: JsonObject | Readonly<Record<string, unknown>>,
): Uint8Array {
  const json = JSON.stringify(value);
  if (json === undefined) throw new TypeError("sidecar JSON packet is not serializable");
  const encoded = encodeSidecarFrame({ packetKind, payload: encoder.encode(json) });
  if (!encoded.ok) throw new RangeError(encoded.failure.detail);
  return encoded.bytes;
}

function decodeJson(payload: Uint8Array, label: string): unknown {
  let json: string;
  try {
    json = decoder.decode(payload);
  } catch {
    throw new TypeError(`${label} is not valid UTF-8`);
  }
  try {
    return JSON.parse(json) as unknown;
  } catch {
    throw new TypeError(`${label} is not valid JSON`);
  }
}

function decodeJsonRecord(payload: Uint8Array, label: string): Record<string, unknown> {
  return plainRecord(decodeJson(payload, label), label);
}

function requireKind(frame: SidecarFrame, expected: SidecarPacketKind): void {
  if (frame.packetKind !== expected) {
    throw new TypeError(
      `sidecar packet kind ${frame.packetKind} does not match expected ${expected}`,
    );
  }
}

function plainRecord(value: unknown, label: string): Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new TypeError(`${label} must be a plain object`);
  }
  const prototype = Object.getPrototypeOf(value);
  if (prototype !== null && prototype !== Object.prototype) {
    throw new TypeError(`${label} must be a plain object`);
  }
  return value as Record<string, unknown>;
}

function exactKeys(
  value: Record<string, unknown>,
  expected: readonly string[],
  label: string,
): void {
  if (JSON.stringify(Object.keys(value).toSorted()) !== JSON.stringify([...expected].toSorted())) {
    throw new TypeError(`${label} has unexpected fields`);
  }
}

function nonEmptyString(value: unknown, label: string): string {
  if (typeof value !== "string" || value.length === 0) {
    throw new TypeError(`${label} must be a non-empty string`);
  }
  return value;
}

function canonicalEpoch(value: unknown, label: string): string {
  if (!isCanonicalAuthorityEpoch(value)) {
    throw new TypeError(`${label} must be a canonical authority epoch`);
  }
  return value;
}

function validateUnsubscribeFailure(value: unknown): void {
  const failure = plainRecord(value, "unsubscribe result.failure");
  const kind = nonEmptyString(failure.kind, "unsubscribe result.failure.kind");
  switch (kind) {
    case "authorityNotReady":
      exactKeys(failure, ["kind", "state"], "unsubscribe authorityNotReady failure");
      if (failure.state !== "starting") {
        throw new TypeError("unsubscribe authorityNotReady state must be starting");
      }
      break;
    case "sessionMismatch":
      exactKeys(
        failure,
        ["kind", "expectedAuthorityEpoch", "providedAuthorityEpoch"],
        "unsubscribe sessionMismatch failure",
      );
      canonicalEpoch(failure.expectedAuthorityEpoch, "unsubscribe failure.expectedAuthorityEpoch");
      canonicalEpoch(failure.providedAuthorityEpoch, "unsubscribe failure.providedAuthorityEpoch");
      break;
    case "requestIllegalInCurrentProductState":
      exactKeys(failure, ["kind", "detail"], "unsubscribe illegal-state failure");
      nonEmptyString(failure.detail, "unsubscribe failure.detail");
      break;
    default:
      throw new TypeError(`unknown unsubscribe failure kind: ${kind}`);
  }
}

function nonNegativeSafeInteger(value: unknown, label: string): number {
  if (typeof value !== "number" || !Number.isSafeInteger(value) || value < 0) {
    throw new TypeError(`${label} must be a non-negative safe integer`);
  }
  return value;
}
