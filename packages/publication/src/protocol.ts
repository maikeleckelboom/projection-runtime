import type {
  AuthorityEpoch,
  AuthorityNotReadyFailure,
  AuthorityUnavailableFailure,
  SessionBoundFailure,
  SessionMismatchFailure,
} from "@exclave/session";
import type { WarmFrameDecodeFailureReason } from "@exclave/warm";
import { throwInputRejected } from "./errors";

export type ContractKey = string;
export type ProjectionInstanceKey = string;
export type SubscriptionId = string;
export type PublicationLane = "warm" | "cold";
export type SemanticVersion = bigint;
export type LaneVersion = bigint;
export type BaselineEpoch = number;
export type ContinuityGeneration = number;

export type SubscribePublicationRequest = {
  readonly contractKey: ContractKey;
  readonly projectionInstanceKey: ProjectionInstanceKey;
  readonly lane: PublicationLane;
  readonly expectedSemanticVersion: SemanticVersion;
  readonly expectedLaneVersion: LaneVersion;
};

export type SubscribePublicationAck = {
  readonly contractKey: ContractKey;
  readonly projectionInstanceKey: ProjectionInstanceKey;
  readonly lane: PublicationLane;
  readonly subscriptionId: SubscriptionId;
  readonly authorityEpoch: AuthorityEpoch;
  readonly semanticVersion: SemanticVersion;
  readonly laneVersion: LaneVersion;
  readonly baselineEpoch: BaselineEpoch;
  readonly continuityGeneration: ContinuityGeneration;
};

export type PublicationSurfaceReadyEvent = {
  readonly kind: "publicationSurfaceReady";
  readonly authorityEpoch: AuthorityEpoch;
  readonly contractKey: ContractKey;
  readonly projectionInstanceKey: ProjectionInstanceKey;
  readonly lane: PublicationLane;
};

export type PublicationSubscriptionInvalidatedEvent = {
  readonly kind: "subscriptionInvalidated";
  readonly subscriptionId: SubscriptionId;
  readonly authorityEpoch: AuthorityEpoch;
  readonly contractKey: ContractKey;
  readonly projectionInstanceKey: ProjectionInstanceKey;
  readonly reason: "authorityRestart" | "projectionReplaced" | "sessionExpired" | "revoked";
};

export type PublicationSubscribeFailure =
  | AuthorityUnavailableFailure
  | AuthorityNotReadyFailure
  | SessionMismatchFailure
  | {
      readonly kind: "surfaceUnavailable";
      readonly contractKey: ContractKey;
      readonly projectionInstanceKey: ProjectionInstanceKey;
    }
  | {
      readonly kind: "surfaceDeferredNotReady";
      readonly contractKey: ContractKey;
      readonly projectionInstanceKey: ProjectionInstanceKey;
    }
  | {
      readonly kind: "notDeclaredLane";
      readonly contractKey: ContractKey;
      readonly lane: PublicationLane;
    }
  | {
      readonly kind: "coldLaneNotRatified";
      readonly contractKey: ContractKey;
      readonly projectionInstanceKey: ProjectionInstanceKey;
    }
  | {
      readonly kind: "streamIncompatible";
      readonly contractKey: ContractKey;
      readonly consumerSemanticVersion: SemanticVersion;
      readonly surfaceSemanticVersion: SemanticVersion;
      readonly consumerLaneVersion: LaneVersion;
      readonly surfaceLaneVersion: LaneVersion;
      readonly detail: string;
    }
  | {
      readonly kind: "unknownSurface";
      readonly contractKey: ContractKey;
      readonly projectionInstanceKey: ProjectionInstanceKey;
    };

export type PublicationSubscribeResult =
  | { readonly ok: true; readonly ack: SubscribePublicationAck }
  | { readonly ok: false; readonly failure: PublicationSubscribeFailure };

export type WarmFrameRejectedEvent = {
  readonly kind: "warmFrameRejected";
  readonly subscriptionId: SubscriptionId;
  readonly authorityEpoch: AuthorityEpoch;
  readonly contractKey: ContractKey;
  readonly projectionInstanceKey: ProjectionInstanceKey;
  readonly reason: WarmFrameDecodeFailureReason;
  readonly detail?: string;
};

export type WarmStreamFatalEvent = {
  readonly kind: "warmStreamFatal";
  readonly subscriptionId: SubscriptionId;
  readonly authorityEpoch: AuthorityEpoch;
  readonly contractKey: ContractKey;
  readonly projectionInstanceKey: ProjectionInstanceKey;
  readonly reason:
    | "codecVersionMismatch"
    | "semanticVersionMismatch"
    | "contractKeyMismatch"
    | "projectionInstanceKeyMismatch"
    | "laneSequencePresenceToggled";
  readonly detail: string;
};

export type UnsubscribePublicationRequest = {
  readonly subscriptionId: SubscriptionId;
  readonly authorityEpoch: AuthorityEpoch;
};

export type UnsubscribePublicationResult =
  | { readonly ok: true }
  | { readonly ok: false; readonly failure: SessionBoundFailure };

const REQUEST_KEYS: ReadonlySet<string> = new Set([
  "contractKey",
  "projectionInstanceKey",
  "lane",
  "expectedSemanticVersion",
  "expectedLaneVersion",
]);

const ACK_KEYS: ReadonlySet<string> = new Set([
  "contractKey",
  "projectionInstanceKey",
  "lane",
  "subscriptionId",
  "authorityEpoch",
  "semanticVersion",
  "laneVersion",
  "baselineEpoch",
  "continuityGeneration",
]);

const SURFACE_READY_KEYS: ReadonlySet<string> = new Set([
  "kind",
  "authorityEpoch",
  "contractKey",
  "projectionInstanceKey",
  "lane",
]);

const SUBSCRIPTION_INVALIDATED_KEYS: ReadonlySet<string> = new Set([
  "kind",
  "subscriptionId",
  "authorityEpoch",
  "contractKey",
  "projectionInstanceKey",
  "reason",
]);

const U32_MAX = 0xffff_ffff;

export function createSubscribePublicationRequest(
  input: SubscribePublicationRequest,
): SubscribePublicationRequest {
  const obj = assertPlainObject(input, "subscribe publication request");
  assertExactRootKeys(obj, REQUEST_KEYS, "subscribe publication request");
  return {
    contractKey: assertNonEmptyString(obj.contractKey, "request.contractKey"),
    projectionInstanceKey: assertNonEmptyString(
      obj.projectionInstanceKey,
      "request.projectionInstanceKey",
    ),
    lane: assertPublicationLane(obj.lane, "request.lane"),
    expectedSemanticVersion: assertNonNegativeBigInt(
      obj.expectedSemanticVersion,
      "request.expectedSemanticVersion",
    ),
    expectedLaneVersion: assertNonNegativeBigInt(
      obj.expectedLaneVersion,
      "request.expectedLaneVersion",
    ),
  };
}

export function createSubscribePublicationAck(
  input: SubscribePublicationAck,
): SubscribePublicationAck {
  const obj = assertPlainObject(input, "subscribe publication ack");
  assertExactRootKeys(obj, ACK_KEYS, "subscribe publication ack");
  return {
    contractKey: assertNonEmptyString(obj.contractKey, "ack.contractKey"),
    projectionInstanceKey: assertNonEmptyString(
      obj.projectionInstanceKey,
      "ack.projectionInstanceKey",
    ),
    lane: assertPublicationLane(obj.lane, "ack.lane"),
    subscriptionId: assertNonEmptyString(obj.subscriptionId, "ack.subscriptionId"),
    authorityEpoch: assertNonNegativeBigInt(obj.authorityEpoch, "ack.authorityEpoch"),
    semanticVersion: assertNonNegativeBigInt(obj.semanticVersion, "ack.semanticVersion"),
    laneVersion: assertNonNegativeBigInt(obj.laneVersion, "ack.laneVersion"),
    baselineEpoch: assertU32(obj.baselineEpoch, "ack.baselineEpoch"),
    continuityGeneration: assertU32(obj.continuityGeneration, "ack.continuityGeneration"),
  };
}

export function createPublicationSurfaceReadyEvent(
  input: PublicationSurfaceReadyEvent,
): PublicationSurfaceReadyEvent {
  const obj = assertPlainObject(input, "publication surface ready event");
  assertExactRootKeys(obj, SURFACE_READY_KEYS, "publication surface ready event");
  if (obj.kind !== "publicationSurfaceReady") {
    throwInputRejected('event.kind must be "publicationSurfaceReady"');
  }
  return {
    kind: "publicationSurfaceReady",
    authorityEpoch: assertNonNegativeBigInt(obj.authorityEpoch, "event.authorityEpoch"),
    contractKey: assertNonEmptyString(obj.contractKey, "event.contractKey"),
    projectionInstanceKey: assertNonEmptyString(
      obj.projectionInstanceKey,
      "event.projectionInstanceKey",
    ),
    lane: assertPublicationLane(obj.lane, "event.lane"),
  };
}

export function createPublicationSubscriptionInvalidatedEvent(
  input: PublicationSubscriptionInvalidatedEvent,
): PublicationSubscriptionInvalidatedEvent {
  const obj = assertPlainObject(input, "publication subscription invalidated event");
  assertExactRootKeys(
    obj,
    SUBSCRIPTION_INVALIDATED_KEYS,
    "publication subscription invalidated event",
  );
  if (obj.kind !== "subscriptionInvalidated") {
    throwInputRejected('event.kind must be "subscriptionInvalidated"');
  }
  return {
    kind: "subscriptionInvalidated",
    subscriptionId: assertNonEmptyString(obj.subscriptionId, "event.subscriptionId"),
    authorityEpoch: assertNonNegativeBigInt(obj.authorityEpoch, "event.authorityEpoch"),
    contractKey: assertNonEmptyString(obj.contractKey, "event.contractKey"),
    projectionInstanceKey: assertNonEmptyString(
      obj.projectionInstanceKey,
      "event.projectionInstanceKey",
    ),
    reason: assertSubscriptionInvalidationReason(obj.reason),
  };
}

function assertPlainObject(value: unknown, label: string): Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throwInputRejected(`${label} must be a plain object`);
  }

  let proto: object | null;
  try {
    proto = Object.getPrototypeOf(value);
  } catch {
    throwInputRejected(`${label} object inspection failed`);
  }

  if (proto !== null && proto !== Object.prototype) {
    throwInputRejected(`${label} must be a plain object, not a class instance`);
  }

  return value as Record<string, unknown>;
}

function assertExactRootKeys(
  value: Record<string, unknown>,
  allowedKeys: ReadonlySet<string>,
  label: string,
): void {
  for (const key of Reflect.ownKeys(value)) {
    if (typeof key === "symbol") {
      throwInputRejected(`${label} must not have symbol keys`);
    }
    if (!allowedKeys.has(key)) {
      throwInputRejected(`${label} must not have extra field: ${key}`);
    }
  }
}

function assertNonEmptyString(value: unknown, label: string): string {
  if (typeof value !== "string" || value.length === 0) {
    throwInputRejected(`${label} must be a non-empty string`);
  }
  return value;
}

function assertNonNegativeBigInt(value: unknown, label: string): bigint {
  if (typeof value !== "bigint" || value < 0n) {
    throwInputRejected(`${label} must be a non-negative bigint`);
  }
  return value;
}

function assertU32(value: unknown, label: string): number {
  if (typeof value !== "number" || !Number.isSafeInteger(value) || value < 0 || value > U32_MAX) {
    throwInputRejected(`${label} must fit in u32`);
  }
  return value;
}

function assertPublicationLane(value: unknown, label: string): PublicationLane {
  if (value !== "warm" && value !== "cold") {
    throwInputRejected(`${label} must be "warm" or "cold"`);
  }
  return value;
}

function assertSubscriptionInvalidationReason(
  value: unknown,
): PublicationSubscriptionInvalidatedEvent["reason"] {
  if (
    value !== "authorityRestart" &&
    value !== "projectionReplaced" &&
    value !== "sessionExpired" &&
    value !== "revoked"
  ) {
    throwInputRejected(`invalid subscription invalidation reason: ${String(value)}`);
  }
  return value;
}
