import type { AuthoritySessionDescriptor, SessionInvalidationEvent } from "@exclave/session";
import { decodeWarmLaneFrame, type WarmFrameCodecOptions, type WarmLaneFrame } from "@exclave/warm";
import {
  createSubscribePublicationAck,
  createSubscribePublicationRequest,
  type PublicationLane,
  type PublicationSubscribeFailure,
  type PublicationSubscribeResult,
  type PublicationSubscriptionInvalidatedEvent,
  type SubscribePublicationAck,
  type SubscribePublicationRequest,
  type SubscriptionId,
  type WarmFrameRejectedEvent,
  type WarmStreamFatalEvent,
} from "./protocol";

export type PublicationSurfaceStatus = "ready" | "deferredNotReady" | "unavailable";

export type PublicationSurfaceRecord = {
  readonly contractKey: string;
  readonly projectionInstanceKey: string;
  readonly lane: PublicationLane;
  readonly semanticVersion: bigint;
  readonly laneVersion: bigint;
  readonly baselineEpoch: number;
  readonly continuityGeneration: number;
  readonly status: PublicationSurfaceStatus;
};

export type PublicationAuthorityModel = {
  readonly session: AuthoritySessionDescriptor;
  readonly surfaces: readonly PublicationSurfaceRecord[];
  readonly nextSubscriptionOrdinal: number;
  readonly subscriptionIdPrefix: string;
};

export type PublicationWarmFrameDelivery = {
  readonly subscriptionId: SubscriptionId;
  readonly authorityEpoch: bigint;
  readonly bytes: Uint8Array;
};

export type PublicationConsumerState<TProjectionState> =
  | { readonly kind: "noSubscription" }
  | {
      readonly kind: "subscribedWaitingForInitialSnapshot";
      readonly ack: SubscribePublicationAck;
    }
  | {
      readonly kind: "live";
      readonly ack: SubscribePublicationAck;
      readonly latestFrame: WarmLaneFrame;
      readonly latestProjectionState: TProjectionState;
      readonly laneSequencePresent: boolean;
    }
  | {
      readonly kind: "stale";
      readonly ack: SubscribePublicationAck;
      readonly reason:
        | "authorityEpochReplaced"
        | "authorityUnavailable"
        | "subscriptionInvalidated";
      readonly invalidation: SessionInvalidationEvent | PublicationSubscriptionInvalidatedEvent;
      readonly lastGoodFrame?: WarmLaneFrame;
      readonly lastGoodProjectionState?: TProjectionState;
    }
  | {
      readonly kind: "failed";
      readonly failure:
        | PublicationSubscribeFailure
        | PublicationFrameApplyFailure
        | WarmFrameRejectedEvent
        | WarmStreamFatalEvent;
    }
  | {
      readonly kind: "closed";
      readonly ack?: SubscribePublicationAck;
      readonly lastGoodFrame?: WarmLaneFrame;
      readonly lastGoodProjectionState?: TProjectionState;
    };

export type PublicationFrameApplyFailure =
  | {
      readonly kind: "subscriptionNotLive";
      readonly state: PublicationConsumerState<unknown>["kind"];
      readonly subscriptionId?: SubscriptionId;
    }
  | {
      readonly kind: "subscriptionMismatch";
      readonly expectedSubscriptionId: SubscriptionId;
      readonly providedSubscriptionId: SubscriptionId;
    }
  | {
      readonly kind: "sessionMismatch";
      readonly expectedAuthorityEpoch: bigint;
      readonly providedAuthorityEpoch: bigint;
    }
  | {
      readonly kind: "initialSnapshotMetadataMismatch";
      readonly expectedBaselineEpoch: number;
      readonly providedBaselineEpoch: number;
      readonly expectedContinuityGeneration: number;
      readonly providedContinuityGeneration: number;
    }
  | {
      readonly kind: "payloadDecodeRejected";
      readonly detail: string;
    };

export type PublicationFrameApplyResult<TProjectionState> =
  | { readonly ok: true; readonly state: PublicationConsumerState<TProjectionState> }
  | {
      readonly ok: false;
      readonly state: PublicationConsumerState<TProjectionState>;
      readonly failure:
        | PublicationFrameApplyFailure
        | WarmFrameRejectedEvent
        | WarmStreamFatalEvent;
    };

export function createPublicationAuthorityModel(input: {
  readonly session: AuthoritySessionDescriptor;
  readonly surfaces: readonly PublicationSurfaceRecord[];
  readonly nextSubscriptionOrdinal?: number;
  readonly subscriptionIdPrefix?: string;
}): PublicationAuthorityModel {
  return {
    session: input.session,
    surfaces: input.surfaces.map((surface) => ({ ...surface })),
    nextSubscriptionOrdinal: input.nextSubscriptionOrdinal ?? 1,
    subscriptionIdPrefix: input.subscriptionIdPrefix ?? "subscription-",
  };
}

export function updatePublicationAuthoritySession(
  model: PublicationAuthorityModel,
  session: AuthoritySessionDescriptor,
): PublicationAuthorityModel {
  return { ...model, session };
}

export function subscribePublication(
  model: PublicationAuthorityModel,
  request: SubscribePublicationRequest,
): { readonly model: PublicationAuthorityModel; readonly result: PublicationSubscribeResult } {
  const normalizedRequest = createSubscribePublicationRequest(request);
  const session = model.session;
  if (session.state !== "ready") {
    return { model, result: { ok: false, failure: failureForUnavailableSession(session) } };
  }

  if (normalizedRequest.lane === "cold") {
    return {
      model,
      result: {
        ok: false,
        failure: {
          kind: "coldLaneNotRatified",
          contractKey: normalizedRequest.contractKey,
          projectionInstanceKey: normalizedRequest.projectionInstanceKey,
        },
      },
    };
  }

  const surface = findSurface(model.surfaces, normalizedRequest);
  if (surface === "unknownSurface") {
    return {
      model,
      result: {
        ok: false,
        failure: {
          kind: "unknownSurface",
          contractKey: normalizedRequest.contractKey,
          projectionInstanceKey: normalizedRequest.projectionInstanceKey,
        },
      },
    };
  }
  if (surface === "notDeclaredLane") {
    return {
      model,
      result: {
        ok: false,
        failure: {
          kind: "notDeclaredLane",
          contractKey: normalizedRequest.contractKey,
          lane: normalizedRequest.lane,
        },
      },
    };
  }

  if (surface.status === "unavailable") {
    return {
      model,
      result: {
        ok: false,
        failure: {
          kind: "surfaceUnavailable",
          contractKey: surface.contractKey,
          projectionInstanceKey: surface.projectionInstanceKey,
        },
      },
    };
  }
  if (surface.status === "deferredNotReady") {
    return {
      model,
      result: {
        ok: false,
        failure: {
          kind: "surfaceDeferredNotReady",
          contractKey: surface.contractKey,
          projectionInstanceKey: surface.projectionInstanceKey,
        },
      },
    };
  }

  if (
    normalizedRequest.expectedSemanticVersion !== surface.semanticVersion ||
    normalizedRequest.expectedLaneVersion !== surface.laneVersion
  ) {
    return {
      model,
      result: {
        ok: false,
        failure: {
          kind: "streamIncompatible",
          contractKey: surface.contractKey,
          consumerSemanticVersion: normalizedRequest.expectedSemanticVersion,
          surfaceSemanticVersion: surface.semanticVersion,
          consumerLaneVersion: normalizedRequest.expectedLaneVersion,
          surfaceLaneVersion: surface.laneVersion,
          detail: "consumer expected versions do not match the publication surface",
        },
      },
    };
  }

  const subscriptionId = `${model.subscriptionIdPrefix}${model.nextSubscriptionOrdinal}`;
  const ack = createSubscribePublicationAck({
    contractKey: surface.contractKey,
    projectionInstanceKey: surface.projectionInstanceKey,
    lane: surface.lane,
    subscriptionId,
    authorityEpoch: session.authorityEpoch,
    semanticVersion: surface.semanticVersion,
    laneVersion: surface.laneVersion,
    baselineEpoch: surface.baselineEpoch,
    continuityGeneration: surface.continuityGeneration,
  });

  return {
    model: {
      ...model,
      nextSubscriptionOrdinal: model.nextSubscriptionOrdinal + 1,
    },
    result: { ok: true, ack },
  };
}

export function createPublicationConsumerState<
  TProjectionState,
>(): PublicationConsumerState<TProjectionState> {
  return { kind: "noSubscription" };
}

export function createWaitingPublicationConsumerSubscription<TProjectionState>(
  ack: SubscribePublicationAck,
): PublicationConsumerState<TProjectionState> {
  return {
    kind: "subscribedWaitingForInitialSnapshot",
    ack: createSubscribePublicationAck(ack),
  };
}

export function failPublicationConsumerSubscription<TProjectionState>(
  failure: PublicationSubscribeFailure,
): PublicationConsumerState<TProjectionState> {
  return { kind: "failed", failure };
}

export function applyWarmFrameToPublicationConsumer<TProjectionState>(
  state: PublicationConsumerState<TProjectionState>,
  delivery: PublicationWarmFrameDelivery,
  decodePayload: (payload: Uint8Array) => TProjectionState,
  options: WarmFrameCodecOptions = {},
): PublicationFrameApplyResult<TProjectionState> {
  if (state.kind !== "subscribedWaitingForInitialSnapshot" && state.kind !== "live") {
    const failure: PublicationFrameApplyFailure = {
      kind: "subscriptionNotLive",
      state: state.kind,
      ...("ack" in state ? { subscriptionId: state.ack.subscriptionId } : {}),
    };
    return { ok: false, state, failure };
  }

  const ack = state.ack;
  if (delivery.subscriptionId !== ack.subscriptionId) {
    const failure: PublicationFrameApplyFailure = {
      kind: "subscriptionMismatch",
      expectedSubscriptionId: ack.subscriptionId,
      providedSubscriptionId: delivery.subscriptionId,
    };
    return { ok: false, state, failure };
  }

  if (delivery.authorityEpoch !== ack.authorityEpoch) {
    const failure: PublicationFrameApplyFailure = {
      kind: "sessionMismatch",
      expectedAuthorityEpoch: ack.authorityEpoch,
      providedAuthorityEpoch: delivery.authorityEpoch,
    };
    return { ok: false, state, failure };
  }

  const decoded = decodeWarmLaneFrame(delivery.bytes, options);
  if (!decoded.ok) {
    const rejected = createWarmFrameRejectedEvent(
      ack,
      decoded.failure.reason,
      decoded.failure.detail,
    );
    return { ok: false, state, failure: rejected };
  }

  const frame = decoded.frame;
  const fatal = fatalEventForFrame(state, frame);
  if (fatal !== null) {
    const failedState: PublicationConsumerState<TProjectionState> = {
      kind: "failed",
      failure: fatal,
    };
    return { ok: false, state: failedState, failure: fatal };
  }

  if (
    state.kind === "subscribedWaitingForInitialSnapshot" &&
    (frame.baselineEpoch !== ack.baselineEpoch ||
      frame.continuityGeneration !== ack.continuityGeneration)
  ) {
    const failure: PublicationFrameApplyFailure = {
      kind: "initialSnapshotMetadataMismatch",
      expectedBaselineEpoch: ack.baselineEpoch,
      providedBaselineEpoch: frame.baselineEpoch,
      expectedContinuityGeneration: ack.continuityGeneration,
      providedContinuityGeneration: frame.continuityGeneration,
    };
    return { ok: false, state, failure };
  }

  let latestProjectionState: TProjectionState;
  try {
    latestProjectionState = decodePayload(frame.payload);
  } catch (error) {
    const failure: PublicationFrameApplyFailure = {
      kind: "payloadDecodeRejected",
      detail: error instanceof Error ? error.message : "payload decoder rejected snapshot bytes",
    };
    return { ok: false, state, failure };
  }

  return {
    ok: true,
    state: {
      kind: "live",
      ack,
      latestFrame: frame,
      latestProjectionState,
      laneSequencePresent: frame.laneSequence !== undefined,
    },
  };
}

export function invalidatePublicationConsumerSubscription<TProjectionState>(
  state: PublicationConsumerState<TProjectionState>,
  invalidation: SessionInvalidationEvent | PublicationSubscriptionInvalidatedEvent,
): PublicationConsumerState<TProjectionState> {
  if (state.kind !== "subscribedWaitingForInitialSnapshot" && state.kind !== "live") {
    return state;
  }

  const ack = state.ack;
  if (!invalidationTargetsAck(invalidation, ack)) {
    return state;
  }

  const lastGood =
    state.kind === "live"
      ? {
          lastGoodFrame: state.latestFrame,
          lastGoodProjectionState: state.latestProjectionState,
        }
      : {};

  return {
    kind: "stale",
    ack,
    reason:
      invalidation.kind === "subscriptionInvalidated"
        ? "subscriptionInvalidated"
        : invalidation.kind,
    invalidation,
    ...lastGood,
  };
}

export function closePublicationConsumerSubscription<TProjectionState>(
  state: PublicationConsumerState<TProjectionState>,
): PublicationConsumerState<TProjectionState> {
  if (state.kind === "subscribedWaitingForInitialSnapshot") {
    return { kind: "closed", ack: state.ack };
  }
  if (state.kind === "live") {
    return {
      kind: "closed",
      ack: state.ack,
      lastGoodFrame: state.latestFrame,
      lastGoodProjectionState: state.latestProjectionState,
    };
  }
  return { kind: "closed" };
}

function failureForUnavailableSession(
  session: Exclude<AuthoritySessionDescriptor, { readonly state: "ready" }>,
): PublicationSubscribeFailure {
  switch (session.state) {
    case "starting":
    case "stopping":
      return { kind: "authorityNotReady", state: session.state };
    case "stopped":
      return { kind: "authorityUnavailable" };
  }
}

function findSurface(
  surfaces: readonly PublicationSurfaceRecord[],
  request: SubscribePublicationRequest,
): PublicationSurfaceRecord | "unknownSurface" | "notDeclaredLane" {
  const matchingIdentity = surfaces.filter(
    (surface) =>
      surface.contractKey === request.contractKey &&
      surface.projectionInstanceKey === request.projectionInstanceKey,
  );

  if (matchingIdentity.length === 0) {
    return "unknownSurface";
  }

  const matchingLane = matchingIdentity.find((surface) => surface.lane === request.lane);
  return matchingLane ?? "notDeclaredLane";
}

function createWarmFrameRejectedEvent(
  ack: SubscribePublicationAck,
  reason: WarmFrameRejectedEvent["reason"],
  detail: string,
): WarmFrameRejectedEvent {
  return {
    kind: "warmFrameRejected",
    subscriptionId: ack.subscriptionId,
    authorityEpoch: ack.authorityEpoch,
    contractKey: ack.contractKey,
    projectionInstanceKey: ack.projectionInstanceKey,
    reason,
    detail,
  };
}

function fatalEventForFrame<TProjectionState>(
  state: Extract<
    PublicationConsumerState<TProjectionState>,
    { readonly kind: "subscribedWaitingForInitialSnapshot" | "live" }
  >,
  frame: WarmLaneFrame,
): WarmStreamFatalEvent | null {
  const ack = state.ack;
  if (frame.contractKey !== ack.contractKey) {
    return createWarmStreamFatalEvent(
      ack,
      "contractKeyMismatch",
      "warm frame contractKey mismatch",
    );
  }
  if (frame.projectionInstanceKey !== ack.projectionInstanceKey) {
    return createWarmStreamFatalEvent(
      ack,
      "projectionInstanceKeyMismatch",
      "warm frame projectionInstanceKey mismatch",
    );
  }
  if (frame.semanticVersion !== ack.semanticVersion) {
    return createWarmStreamFatalEvent(
      ack,
      "semanticVersionMismatch",
      "warm frame semanticVersion mismatch",
    );
  }
  if (frame.warmCodecVersion !== ack.laneVersion) {
    return createWarmStreamFatalEvent(
      ack,
      "codecVersionMismatch",
      "warm frame warmCodecVersion mismatch",
    );
  }
  if (state.kind === "live" && state.laneSequencePresent !== (frame.laneSequence !== undefined)) {
    return createWarmStreamFatalEvent(
      ack,
      "laneSequencePresenceToggled",
      "warm frame laneSequence presence toggled within one subscription",
    );
  }
  return null;
}

function createWarmStreamFatalEvent(
  ack: SubscribePublicationAck,
  reason: WarmStreamFatalEvent["reason"],
  detail: string,
): WarmStreamFatalEvent {
  return {
    kind: "warmStreamFatal",
    subscriptionId: ack.subscriptionId,
    authorityEpoch: ack.authorityEpoch,
    contractKey: ack.contractKey,
    projectionInstanceKey: ack.projectionInstanceKey,
    reason,
    detail,
  };
}

function invalidationTargetsAck(
  invalidation: SessionInvalidationEvent | PublicationSubscriptionInvalidatedEvent,
  ack: SubscribePublicationAck,
): boolean {
  switch (invalidation.kind) {
    case "authorityEpochReplaced":
      return invalidation.replacedAuthorityEpoch === ack.authorityEpoch;
    case "authorityUnavailable":
      return invalidation.replacedAuthorityEpoch === ack.authorityEpoch;
    case "subscriptionInvalidated":
      return (
        invalidation.authorityEpoch === ack.authorityEpoch &&
        invalidation.subscriptionId === ack.subscriptionId &&
        invalidation.contractKey === ack.contractKey &&
        invalidation.projectionInstanceKey === ack.projectionInstanceKey
      );
  }
}
