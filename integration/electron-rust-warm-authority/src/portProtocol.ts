import type { AutomatedProofSummary, TransportDiagnostics } from "./bridgeTypes.js";
import { isCanonicalAuthorityEpoch, isCanonicalU64Hex } from "./wireValues.js";

export type SerializedSubscribePublicationRequest = {
  readonly contractKey: string;
  readonly projectionInstanceKey: string;
  readonly lane: "warm";
  readonly expectedSemanticVersion: string;
  readonly expectedLaneVersion: string;
};

export type SerializedSubscribePublicationAck = {
  readonly contractKey: string;
  readonly projectionInstanceKey: string;
  readonly lane: "warm";
  readonly subscriptionId: string;
  readonly authorityEpoch: string;
  readonly semanticVersion: string;
  readonly laneVersion: string;
  readonly baselineEpoch: number;
  readonly continuityGeneration: number;
};

export type SerializedPublicationAttachment = {
  readonly kind: "publication.warmFrame";
  readonly attachmentVersion: 1;
  readonly streamKey: string;
  readonly subscriptionId: string;
  readonly authorityEpoch: string;
  readonly contractKey: string;
  readonly projectionInstanceKey: string;
  readonly lane: "warm";
};

export type SerializedSubscribeResult =
  | { readonly ok: true; readonly ack: SerializedSubscribePublicationAck }
  | {
      readonly ok: false;
      readonly failure: Readonly<Record<string, unknown>> & { readonly kind: string };
    };

export type HostToPreloadMessage =
  | { readonly kind: "authorityStarting"; readonly authorityEpoch: string }
  | { readonly kind: "authorityReady"; readonly authorityEpoch: string }
  | {
      readonly kind: "authorityUnavailable";
      readonly replacedAuthorityEpoch: string;
    }
  | {
      readonly kind: "subscribeResult";
      readonly requestKey: string;
      readonly result: SerializedSubscribeResult;
    }
  | {
      readonly kind: "unsubscribeResult";
      readonly requestKey: string;
      readonly ok: boolean;
    }
  | {
      readonly kind: "controlResponse";
      readonly requestKey: string;
      readonly response: Readonly<Record<string, unknown>>;
    }
  | {
      readonly kind: "publication";
      readonly attachment: SerializedPublicationAttachment;
      readonly frameBytes: Uint8Array;
      readonly upstreamCoalescedPublicationCount: number;
      readonly downstreamCoalescedPublicationCount: number;
    }
  | {
      readonly kind: "transportDiagnostics";
      readonly diagnostics: TransportDiagnostics;
    }
  | { readonly kind: "proofResult"; readonly requestKey: string; readonly ok: true }
  | {
      readonly kind: "hostFailure";
      readonly code: string;
      readonly message: string;
    };

export type PreloadToHostMessage =
  | {
      readonly kind: "subscribeRuntime";
      readonly requestKey: string;
      readonly request: SerializedSubscribePublicationRequest;
    }
  | {
      readonly kind: "unsubscribeRuntime";
      readonly requestKey: string;
      readonly subscriptionId: string;
      readonly authorityEpoch: string;
    }
  | {
      readonly kind: "setTempoRatio";
      readonly requestKey: string;
      readonly authorityEpoch: string;
      readonly value: number;
    }
  | {
      readonly kind: "publicationApplied";
      readonly subscriptionId: string;
      readonly authorityEpoch: string;
      readonly publicationSequence: string;
    }
  | {
      readonly kind: "proofSetPublicationFlowPaused";
      readonly requestKey: string;
      readonly paused: boolean;
    }
  | { readonly kind: "proofRestartAuthority"; readonly requestKey: string }
  | {
      readonly kind: "proofReloadCheckpoint";
      readonly requestKey: string;
      readonly phase: "before" | "after";
      readonly samplePosition: string;
      readonly publicationSequence: string;
    }
  | {
      readonly kind: "proofComplete";
      readonly requestKey: string;
      readonly summary: AutomatedProofSummary;
    };

export function parseHostToPreloadMessage(value: unknown): HostToPreloadMessage {
  const message = plainRecord(value, "host message");
  const kind = nonEmptyString(message.kind, "host message.kind");

  switch (kind) {
    case "authorityStarting":
    case "authorityReady":
      exactKeys(message, ["kind", "authorityEpoch"], kind);
      return {
        kind,
        authorityEpoch: authorityEpoch(message.authorityEpoch, `${kind}.authorityEpoch`),
      };
    case "authorityUnavailable":
      exactKeys(message, ["kind", "replacedAuthorityEpoch"], kind);
      return {
        kind,
        replacedAuthorityEpoch: authorityEpoch(
          message.replacedAuthorityEpoch,
          `${kind}.replacedAuthorityEpoch`,
        ),
      };
    case "subscribeResult":
      exactKeys(message, ["kind", "requestKey", "result"], kind);
      return {
        kind,
        requestKey: nonEmptyString(message.requestKey, `${kind}.requestKey`),
        result: parseSerializedSubscribeResult(message.result),
      };
    case "unsubscribeResult":
      exactKeys(message, ["kind", "requestKey", "ok"], kind);
      if (typeof message.ok !== "boolean") throw new TypeError(`${kind}.ok must be boolean`);
      return {
        kind,
        requestKey: nonEmptyString(message.requestKey, `${kind}.requestKey`),
        ok: message.ok,
      };
    case "controlResponse":
      exactKeys(message, ["kind", "requestKey", "response"], kind);
      return {
        kind,
        requestKey: nonEmptyString(message.requestKey, `${kind}.requestKey`),
        response: plainRecord(message.response, `${kind}.response`),
      };
    case "publication":
      exactKeys(
        message,
        [
          "kind",
          "attachment",
          "frameBytes",
          "upstreamCoalescedPublicationCount",
          "downstreamCoalescedPublicationCount",
        ],
        kind,
      );
      if (!(message.frameBytes instanceof Uint8Array)) {
        throw new TypeError("publication.frameBytes must be Uint8Array");
      }
      return {
        kind,
        attachment: parseSerializedPublicationAttachment(message.attachment),
        frameBytes: new Uint8Array(message.frameBytes),
        upstreamCoalescedPublicationCount: nonNegativeSafeInteger(
          message.upstreamCoalescedPublicationCount,
          "publication.upstreamCoalescedPublicationCount",
        ),
        downstreamCoalescedPublicationCount: nonNegativeSafeInteger(
          message.downstreamCoalescedPublicationCount,
          "publication.downstreamCoalescedPublicationCount",
        ),
      };
    case "transportDiagnostics":
      exactKeys(message, ["kind", "diagnostics"], kind);
      return { kind, diagnostics: parseTransportDiagnostics(message.diagnostics) };
    case "proofResult":
      exactKeys(message, ["kind", "requestKey", "ok"], kind);
      if (message.ok !== true) throw new TypeError("proofResult.ok must be true");
      return {
        kind,
        requestKey: nonEmptyString(message.requestKey, "proofResult.requestKey"),
        ok: true,
      };
    case "hostFailure":
      exactKeys(message, ["kind", "code", "message"], kind);
      return {
        kind,
        code: nonEmptyString(message.code, "hostFailure.code"),
        message: nonEmptyString(message.message, "hostFailure.message"),
      };
    default:
      throw new TypeError(`unknown host message kind: ${kind}`);
  }
}

export function parsePreloadToHostMessage(value: unknown): PreloadToHostMessage {
  const message = plainRecord(value, "preload message");
  const kind = nonEmptyString(message.kind, "preload message.kind");

  switch (kind) {
    case "subscribeRuntime":
      exactKeys(message, ["kind", "requestKey", "request"], kind);
      return {
        kind,
        requestKey: nonEmptyString(message.requestKey, `${kind}.requestKey`),
        request: parseSubscribeRequest(message.request),
      };
    case "unsubscribeRuntime":
      exactKeys(message, ["kind", "requestKey", "subscriptionId", "authorityEpoch"], kind);
      return {
        kind,
        requestKey: nonEmptyString(message.requestKey, `${kind}.requestKey`),
        subscriptionId: nonEmptyString(message.subscriptionId, `${kind}.subscriptionId`),
        authorityEpoch: authorityEpoch(message.authorityEpoch, `${kind}.authorityEpoch`),
      };
    case "setTempoRatio":
      exactKeys(message, ["kind", "requestKey", "authorityEpoch", "value"], kind);
      if (
        typeof message.value !== "number" ||
        !Number.isFinite(message.value) ||
        message.value < 0.5 ||
        message.value > 2
      ) {
        throw new TypeError("setTempoRatio.value must be finite and in [0.5, 2]");
      }
      return {
        kind,
        requestKey: nonEmptyString(message.requestKey, `${kind}.requestKey`),
        authorityEpoch: authorityEpoch(message.authorityEpoch, `${kind}.authorityEpoch`),
        value: message.value,
      };
    case "publicationApplied":
      exactKeys(message, ["kind", "subscriptionId", "authorityEpoch", "publicationSequence"], kind);
      return {
        kind,
        subscriptionId: nonEmptyString(message.subscriptionId, `${kind}.subscriptionId`),
        authorityEpoch: authorityEpoch(message.authorityEpoch, `${kind}.authorityEpoch`),
        publicationSequence: u64Hex(message.publicationSequence, `${kind}.publicationSequence`),
      };
    case "proofSetPublicationFlowPaused":
      exactKeys(message, ["kind", "requestKey", "paused"], kind);
      if (typeof message.paused !== "boolean")
        throw new TypeError(`${kind}.paused must be boolean`);
      return {
        kind,
        requestKey: nonEmptyString(message.requestKey, `${kind}.requestKey`),
        paused: message.paused,
      };
    case "proofRestartAuthority":
      exactKeys(message, ["kind", "requestKey"], kind);
      return { kind, requestKey: nonEmptyString(message.requestKey, `${kind}.requestKey`) };
    case "proofReloadCheckpoint":
      exactKeys(
        message,
        ["kind", "requestKey", "phase", "samplePosition", "publicationSequence"],
        kind,
      );
      if (message.phase !== "before" && message.phase !== "after") {
        throw new TypeError(`${kind}.phase must be before or after`);
      }
      return {
        kind,
        requestKey: nonEmptyString(message.requestKey, `${kind}.requestKey`),
        phase: message.phase,
        samplePosition: authorityEpoch(message.samplePosition, `${kind}.samplePosition`),
        publicationSequence: u64Hex(message.publicationSequence, `${kind}.publicationSequence`),
      };
    case "proofComplete":
      exactKeys(message, ["kind", "requestKey", "summary"], kind);
      return {
        kind,
        requestKey: nonEmptyString(message.requestKey, `${kind}.requestKey`),
        summary: parseAutomatedProofSummary(message.summary),
      };
    default:
      throw new TypeError(`unknown preload message kind: ${kind}`);
  }
}

function parseSubscribeRequest(value: unknown): SerializedSubscribePublicationRequest {
  const request = plainRecord(value, "subscribe request");
  exactKeys(
    request,
    [
      "contractKey",
      "projectionInstanceKey",
      "lane",
      "expectedSemanticVersion",
      "expectedLaneVersion",
    ],
    "subscribe request",
  );
  if (request.lane !== "warm") throw new TypeError("subscribe request.lane must be warm");
  return {
    contractKey: nonEmptyString(request.contractKey, "subscribe request.contractKey"),
    projectionInstanceKey: nonEmptyString(
      request.projectionInstanceKey,
      "subscribe request.projectionInstanceKey",
    ),
    lane: "warm",
    expectedSemanticVersion: u64Hex(
      request.expectedSemanticVersion,
      "subscribe request.expectedSemanticVersion",
    ),
    expectedLaneVersion: u64Hex(
      request.expectedLaneVersion,
      "subscribe request.expectedLaneVersion",
    ),
  };
}

export function parseSerializedSubscribeResult(value: unknown): SerializedSubscribeResult {
  const result = plainRecord(value, "subscribe result");
  if (result.ok === true) {
    exactKeys(result, ["ok", "ack"], "subscribe result success");
    return { ok: true, ack: parseSubscribeAck(result.ack) };
  }
  if (result.ok === false) {
    exactKeys(result, ["ok", "failure"], "subscribe result failure");
    const failure = plainRecord(result.failure, "subscribe result.failure");
    const failureKind = nonEmptyString(failure.kind, "subscribe result.failure.kind");
    const knownKinds = new Set([
      "authorityUnavailable",
      "authorityNotReady",
      "sessionMismatch",
      "surfaceUnavailable",
      "surfaceDeferredNotReady",
      "notDeclaredLane",
      "coldLaneNotRatified",
      "streamIncompatible",
      "unknownSurface",
    ]);
    if (!knownKinds.has(failureKind)) {
      throw new TypeError(`unknown subscribe failure kind: ${failureKind}`);
    }
    return { ok: false, failure: { ...failure, kind: failureKind } };
  }
  throw new TypeError("subscribe result.ok must be boolean");
}

function parseSubscribeAck(value: unknown): SerializedSubscribePublicationAck {
  const ack = plainRecord(value, "subscribe ack");
  exactKeys(
    ack,
    [
      "contractKey",
      "projectionInstanceKey",
      "lane",
      "subscriptionId",
      "authorityEpoch",
      "semanticVersion",
      "laneVersion",
      "baselineEpoch",
      "continuityGeneration",
    ],
    "subscribe ack",
  );
  if (ack.lane !== "warm") throw new TypeError("subscribe ack.lane must be warm");
  return {
    contractKey: nonEmptyString(ack.contractKey, "subscribe ack.contractKey"),
    projectionInstanceKey: nonEmptyString(
      ack.projectionInstanceKey,
      "subscribe ack.projectionInstanceKey",
    ),
    lane: "warm",
    subscriptionId: nonEmptyString(ack.subscriptionId, "subscribe ack.subscriptionId"),
    authorityEpoch: authorityEpoch(ack.authorityEpoch, "subscribe ack.authorityEpoch"),
    semanticVersion: u64Hex(ack.semanticVersion, "subscribe ack.semanticVersion"),
    laneVersion: u64Hex(ack.laneVersion, "subscribe ack.laneVersion"),
    baselineEpoch: u32(ack.baselineEpoch, "subscribe ack.baselineEpoch"),
    continuityGeneration: u32(ack.continuityGeneration, "subscribe ack.continuityGeneration"),
  };
}

export function parseSerializedPublicationAttachment(
  value: unknown,
): SerializedPublicationAttachment {
  const attachment = plainRecord(value, "publication attachment");
  exactKeys(
    attachment,
    [
      "kind",
      "attachmentVersion",
      "streamKey",
      "subscriptionId",
      "authorityEpoch",
      "contractKey",
      "projectionInstanceKey",
      "lane",
    ],
    "publication attachment",
  );
  if (attachment.kind !== "publication.warmFrame") {
    throw new TypeError("publication attachment.kind is invalid");
  }
  if (attachment.attachmentVersion !== 1) {
    throw new TypeError("publication attachment.attachmentVersion must be 1");
  }
  if (attachment.lane !== "warm") throw new TypeError("publication attachment.lane must be warm");
  return {
    kind: "publication.warmFrame",
    attachmentVersion: 1,
    streamKey: nonEmptyString(attachment.streamKey, "publication attachment.streamKey"),
    subscriptionId: nonEmptyString(
      attachment.subscriptionId,
      "publication attachment.subscriptionId",
    ),
    authorityEpoch: authorityEpoch(
      attachment.authorityEpoch,
      "publication attachment.authorityEpoch",
    ),
    contractKey: nonEmptyString(attachment.contractKey, "publication attachment.contractKey"),
    projectionInstanceKey: nonEmptyString(
      attachment.projectionInstanceKey,
      "publication attachment.projectionInstanceKey",
    ),
    lane: "warm",
  };
}

function parseTransportDiagnostics(value: unknown): TransportDiagnostics {
  const diagnostics = plainRecord(value, "transport diagnostics");
  const keys = [
    "upstreamCoalescedPublicationCount",
    "downstreamCoalescedPublicationCount",
    "skippedPublicationCount",
    "maxUpstreamInFlightCount",
    "maxUpstreamPendingCount",
    "maxDownstreamInFlightCount",
    "maxDownstreamPendingCount",
    "latestDeliveredPublicationSequence",
  ] as const;
  exactKeys(diagnostics, keys, "transport diagnostics");
  const latest = diagnostics.latestDeliveredPublicationSequence;
  if (latest !== null && !isCanonicalU64Hex(latest)) {
    throw new TypeError("transport diagnostics latest sequence must be null or u64 hex");
  }
  return {
    upstreamCoalescedPublicationCount: nonNegativeSafeInteger(
      diagnostics.upstreamCoalescedPublicationCount,
      keys[0],
    ),
    downstreamCoalescedPublicationCount: nonNegativeSafeInteger(
      diagnostics.downstreamCoalescedPublicationCount,
      keys[1],
    ),
    skippedPublicationCount: nonNegativeSafeInteger(diagnostics.skippedPublicationCount, keys[2]),
    maxUpstreamInFlightCount: nonNegativeSafeInteger(diagnostics.maxUpstreamInFlightCount, keys[3]),
    maxUpstreamPendingCount: nonNegativeSafeInteger(diagnostics.maxUpstreamPendingCount, keys[4]),
    maxDownstreamInFlightCount: nonNegativeSafeInteger(
      diagnostics.maxDownstreamInFlightCount,
      keys[5],
    ),
    maxDownstreamPendingCount: nonNegativeSafeInteger(
      diagnostics.maxDownstreamPendingCount,
      keys[6],
    ),
    latestDeliveredPublicationSequence: latest,
  };
}

function parseAutomatedProofSummary(value: unknown): AutomatedProofSummary {
  const summary = plainRecord(value, "automated proof summary");
  const keys = [
    "controlTempoRatio",
    "reloadBeforeSamplePosition",
    "reloadAfterSamplePosition",
    "reloadBeforePublicationSequence",
    "reloadAfterPublicationSequence",
    "initialAuthorityEpoch",
    "replacementAuthorityEpoch",
    "finalPublicationSequence",
  ] as const;
  exactKeys(summary, keys, "automated proof summary");
  if (
    typeof summary.controlTempoRatio !== "number" ||
    !Number.isFinite(summary.controlTempoRatio)
  ) {
    throw new TypeError("automated proof controlTempoRatio must be finite");
  }
  return {
    controlTempoRatio: summary.controlTempoRatio,
    reloadBeforeSamplePosition: authorityEpoch(summary.reloadBeforeSamplePosition, keys[1]),
    reloadAfterSamplePosition: authorityEpoch(summary.reloadAfterSamplePosition, keys[2]),
    reloadBeforePublicationSequence: u64Hex(summary.reloadBeforePublicationSequence, keys[3]),
    reloadAfterPublicationSequence: u64Hex(summary.reloadAfterPublicationSequence, keys[4]),
    initialAuthorityEpoch: authorityEpoch(summary.initialAuthorityEpoch, keys[5]),
    replacementAuthorityEpoch: authorityEpoch(summary.replacementAuthorityEpoch, keys[6]),
    finalPublicationSequence: u64Hex(summary.finalPublicationSequence, keys[7]),
  };
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
  const actual = Object.keys(value).toSorted();
  const sortedExpected = [...expected].toSorted();
  if (JSON.stringify(actual) !== JSON.stringify(sortedExpected)) {
    throw new TypeError(`${label} has unexpected fields`);
  }
}

function nonEmptyString(value: unknown, label: string): string {
  if (typeof value !== "string" || value.length === 0) {
    throw new TypeError(`${label} must be a non-empty string`);
  }
  return value;
}

function authorityEpoch(value: unknown, label: string): string {
  if (!isCanonicalAuthorityEpoch(value)) {
    throw new TypeError(`${label} must be a canonical authority epoch`);
  }
  return value;
}

function u64Hex(value: unknown, label: string): string {
  if (!isCanonicalU64Hex(value)) {
    throw new TypeError(`${label} must be canonical u64 hex`);
  }
  return value;
}

function nonNegativeSafeInteger(value: unknown, label: string): number {
  if (typeof value !== "number" || !Number.isSafeInteger(value) || value < 0) {
    throw new TypeError(`${label} must be a non-negative safe integer`);
  }
  return value;
}

function u32(value: unknown, label: string): number {
  const decoded = nonNegativeSafeInteger(value, label);
  if (decoded > 0xffff_ffff) throw new RangeError(`${label} must fit in u32`);
  return decoded;
}
