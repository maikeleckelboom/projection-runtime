import type { AuthoritySessionDescriptor, SessionInvalidationEvent } from "@exclave/session";
import {
  decodeWarmSnapshotPayload,
  encodeWarmLaneFrame,
  encodeWarmSnapshotPayload,
  type WarmFrameCodecOptions,
  type WarmFrameEncodeFailure,
  type WarmSnapshotObject,
  type WarmSnapshotPayloadEncodeFailure,
  type WarmSnapshotPayloadManifest,
} from "@exclave/warm";
import { throwDecodeRejected, throwSurfaceNotFound } from "./errors";
import type {
  PublicationSubscribeFailure,
  PublicationSubscriptionInvalidatedEvent,
  SubscribePublicationAck,
  SubscribePublicationRequest,
  SubscriptionId,
} from "./protocol";
import {
  applyWarmFrameToPublicationConsumer,
  createPublicationAuthorityModel,
  createWaitingPublicationConsumerSubscription,
  type PublicationConsumerState,
  type PublicationFrameApplyFailure,
  type PublicationFrameApplyResult,
  type PublicationSurfaceRecord,
  subscribePublication,
} from "./subscription";
import {
  createPublicationFrameAttachmentFromAck,
  createPublicationWarmFrameDelivery,
  PUBLICATION_TRANSPORT_ATTACHMENT_VERSION,
  type PublicationFrameAttachment,
  type PublicationStreamKey,
  type PublicationTransportAttachmentVersion,
} from "./transport-attachment";

export type WarmSubscribePublicationAck = Omit<SubscribePublicationAck, "lane"> & {
  readonly lane: "warm";
};

export type PublicationWarmSurfaceRecord = Omit<PublicationSurfaceRecord, "lane"> & {
  readonly lane: "warm";
  readonly streamKey: PublicationStreamKey;
  readonly payloadManifest: WarmSnapshotPayloadManifest;
  readonly laneSequenceMode?: "absent" | "present";
};

export type PublicationWarmStreamBinding = {
  readonly streamKey: PublicationStreamKey;
  readonly attachmentVersion: PublicationTransportAttachmentVersion;
  readonly ack: WarmSubscribePublicationAck;
  readonly payloadManifest: WarmSnapshotPayloadManifest;
};

export type PublicationWarmAuthoritySubscriptionState =
  | "subscribedWaitingForInitialSnapshot"
  | "live"
  | "invalidated";

export type PublicationWarmAuthoritySubscription = {
  readonly binding: PublicationWarmStreamBinding;
  readonly state: PublicationWarmAuthoritySubscriptionState;
  readonly nextPublicationSequence: bigint;
  readonly nextLaneSequence?: number;
  readonly invalidation?: SessionInvalidationEvent | PublicationSubscriptionInvalidatedEvent;
};

export type PublicationWarmRuntimeModel = {
  readonly session: AuthoritySessionDescriptor;
  readonly surfaces: readonly PublicationWarmSurfaceRecord[];
  readonly subscriptions: readonly PublicationWarmAuthoritySubscription[];
  readonly nextSubscriptionOrdinal: number;
  readonly subscriptionIdPrefix: string;
};

export type PublicationWarmSubscribeResult =
  | {
      readonly ok: true;
      readonly ack: WarmSubscribePublicationAck;
      readonly binding: PublicationWarmStreamBinding;
    }
  | { readonly ok: false; readonly failure: PublicationSubscribeFailure };

export type PublicationWarmRuntimeFailure =
  | {
      readonly kind: "subscriptionNotFound";
      readonly subscriptionId: SubscriptionId;
    }
  | {
      readonly kind: "subscriptionInvalidated";
      readonly subscriptionId: SubscriptionId;
      readonly authorityEpoch: bigint;
      readonly invalidation?: SessionInvalidationEvent | PublicationSubscriptionInvalidatedEvent;
    }
  | {
      readonly kind: "initialSnapshotRequired";
      readonly subscriptionId: SubscriptionId;
    }
  | {
      readonly kind: "initialSnapshotAlreadyPublished";
      readonly subscriptionId: SubscriptionId;
    }
  | {
      readonly kind: "authoritySessionNotReady";
      readonly subscriptionId: SubscriptionId;
      readonly state: AuthoritySessionDescriptor["state"];
    }
  | {
      readonly kind: "authoritySessionMismatch";
      readonly subscriptionId: SubscriptionId;
      readonly expectedAuthorityEpoch: bigint;
      readonly providedAuthorityEpoch: bigint;
    }
  | {
      readonly kind: "warmManifestCodecVersionMismatch";
      readonly subscriptionId: SubscriptionId;
      readonly manifestWarmCodecVersion: bigint;
      readonly ackWarmCodecVersion: bigint;
    }
  | {
      readonly kind: "warmPayloadEncodeRejected";
      readonly subscriptionId: SubscriptionId;
      readonly failure: WarmSnapshotPayloadEncodeFailure;
    }
  | {
      readonly kind: "warmFrameEncodeRejected";
      readonly subscriptionId: SubscriptionId;
      readonly failure: WarmFrameEncodeFailure;
    }
  | {
      readonly kind: "attachmentRejected";
      readonly subscriptionId: SubscriptionId;
      readonly detail: string;
    };

export type PublicationWarmPublishResult =
  | {
      readonly ok: true;
      readonly model: PublicationWarmRuntimeModel;
      readonly binding: PublicationWarmStreamBinding;
      readonly attachment: PublicationFrameAttachment;
    }
  | {
      readonly ok: false;
      readonly model: PublicationWarmRuntimeModel;
      readonly failure: PublicationWarmRuntimeFailure;
    };

export function createWarmPublicationRuntime(input: {
  readonly session: AuthoritySessionDescriptor;
  readonly surfaces: readonly PublicationWarmSurfaceRecord[];
  readonly subscriptions?: readonly PublicationWarmAuthoritySubscription[];
  readonly nextSubscriptionOrdinal?: number;
  readonly subscriptionIdPrefix?: string;
}): PublicationWarmRuntimeModel {
  return {
    session: input.session,
    surfaces: input.surfaces.map((surface) => ({ ...surface })),
    subscriptions: (input.subscriptions ?? []).map((subscription) => ({ ...subscription })),
    nextSubscriptionOrdinal: input.nextSubscriptionOrdinal ?? 1,
    subscriptionIdPrefix: input.subscriptionIdPrefix ?? "subscription-",
  };
}

export function subscribeWarmPublication(
  model: PublicationWarmRuntimeModel,
  request: SubscribePublicationRequest,
): {
  readonly model: PublicationWarmRuntimeModel;
  readonly result: PublicationWarmSubscribeResult;
} {
  const authority = createPublicationAuthorityModel({
    session: model.session,
    surfaces: model.surfaces.map(surfaceForSubscribe),
    nextSubscriptionOrdinal: model.nextSubscriptionOrdinal,
    subscriptionIdPrefix: model.subscriptionIdPrefix,
  });
  const subscribed = subscribePublication(authority, request);

  if (!subscribed.result.ok) {
    return { model, result: subscribed.result };
  }

  const ack = toWarmAck(subscribed.result.ack);
  const surface = findSurfaceForAck(model.surfaces, ack);
  const binding: PublicationWarmStreamBinding = {
    streamKey: surface.streamKey,
    attachmentVersion: PUBLICATION_TRANSPORT_ATTACHMENT_VERSION,
    ack,
    payloadManifest: surface.payloadManifest,
  };
  const subscription: PublicationWarmAuthoritySubscription = {
    binding,
    state: "subscribedWaitingForInitialSnapshot",
    nextPublicationSequence: 1n,
    ...(surface.laneSequenceMode === "present" ? { nextLaneSequence: 0 } : {}),
  };

  return {
    model: {
      ...model,
      nextSubscriptionOrdinal: subscribed.model.nextSubscriptionOrdinal,
      subscriptions: [...model.subscriptions, subscription],
    },
    result: { ok: true, ack, binding },
  };
}

export function createWarmPublicationConsumerState(
  binding: PublicationWarmStreamBinding,
): PublicationConsumerState<WarmSnapshotObject> {
  return createWaitingPublicationConsumerSubscription<WarmSnapshotObject>(binding.ack);
}

export function publishInitialWarmSnapshot(
  model: PublicationWarmRuntimeModel,
  input: {
    readonly subscriptionId: SubscriptionId;
    readonly snapshot: WarmSnapshotObject;
  },
  options: WarmFrameCodecOptions = {},
): PublicationWarmPublishResult {
  return publishWarmSnapshotForState(model, input, "initial", options);
}

export function publishWarmSnapshot(
  model: PublicationWarmRuntimeModel,
  input: {
    readonly subscriptionId: SubscriptionId;
    readonly snapshot: WarmSnapshotObject;
  },
  options: WarmFrameCodecOptions = {},
): PublicationWarmPublishResult {
  return publishWarmSnapshotForState(model, input, "live", options);
}

export function applyPublicationFrameAttachmentToConsumer(
  state: PublicationConsumerState<WarmSnapshotObject>,
  binding: PublicationWarmStreamBinding,
  attachment: PublicationFrameAttachment,
  options: WarmFrameCodecOptions = {},
): PublicationFrameApplyResult<WarmSnapshotObject> {
  const failure = validateAttachmentForBinding(binding, attachment);
  if (failure !== null) {
    return { ok: false, state, failure };
  }

  let delivery: ReturnType<typeof createPublicationWarmFrameDelivery>;
  try {
    delivery = createPublicationWarmFrameDelivery(attachment, options);
  } catch (error) {
    return {
      ok: false,
      state,
      failure: {
        kind: "attachmentRejected",
        detail: errorMessage(error, "publication frame attachment rejected"),
      },
    };
  }

  return applyWarmFrameToPublicationConsumer(
    state,
    delivery,
    (payload) => {
      const decoded = decodeWarmSnapshotPayload(binding.payloadManifest, payload);
      if (!decoded.ok) {
        throwDecodeRejected(decoded.failure.detail);
      }
      return decoded.snapshot;
    },
    options,
  );
}

export function updateWarmPublicationRuntimeAuthoritySession(
  model: PublicationWarmRuntimeModel,
  session: AuthoritySessionDescriptor,
): PublicationWarmRuntimeModel {
  const invalidation = sessionInvalidationForReplacement(model.session, session);
  const nextModel = { ...model, session };
  return invalidation === null
    ? nextModel
    : invalidateWarmPublicationRuntimeSubscriptions(nextModel, invalidation);
}

export function invalidateWarmPublicationRuntimeSubscriptions(
  model: PublicationWarmRuntimeModel,
  invalidation: SessionInvalidationEvent | PublicationSubscriptionInvalidatedEvent,
): PublicationWarmRuntimeModel {
  return {
    ...model,
    subscriptions: model.subscriptions.map((subscription) =>
      invalidationTargetsBinding(invalidation, subscription.binding)
        ? {
            ...subscription,
            state: "invalidated",
            invalidation,
          }
        : subscription,
    ),
  };
}

function publishWarmSnapshotForState(
  model: PublicationWarmRuntimeModel,
  input: {
    readonly subscriptionId: SubscriptionId;
    readonly snapshot: WarmSnapshotObject;
  },
  expectedState: "initial" | "live",
  options: WarmFrameCodecOptions,
): PublicationWarmPublishResult {
  const located = findSubscription(model, input.subscriptionId);
  if (located === null) {
    return {
      ok: false,
      model,
      failure: { kind: "subscriptionNotFound", subscriptionId: input.subscriptionId },
    };
  }

  const subscription = located.subscription;
  if (subscription.state === "invalidated") {
    return {
      ok: false,
      model,
      failure: {
        kind: "subscriptionInvalidated",
        subscriptionId: input.subscriptionId,
        authorityEpoch: subscription.binding.ack.authorityEpoch,
        ...(subscription.invalidation === undefined
          ? {}
          : { invalidation: subscription.invalidation }),
      },
    };
  }

  if (expectedState === "initial" && subscription.state !== "subscribedWaitingForInitialSnapshot") {
    return {
      ok: false,
      model,
      failure: { kind: "initialSnapshotAlreadyPublished", subscriptionId: input.subscriptionId },
    };
  }

  if (expectedState === "live" && subscription.state !== "live") {
    return {
      ok: false,
      model,
      failure: { kind: "initialSnapshotRequired", subscriptionId: input.subscriptionId },
    };
  }

  const sessionFailure = validateModelSessionForPublish(model.session, subscription);
  if (sessionFailure !== null) {
    return {
      ok: false,
      model,
      failure: sessionFailure,
    };
  }

  const manifestWarmCodecVersion = subscription.binding.payloadManifest.warmCodecVersion;
  if (
    manifestWarmCodecVersion !== undefined &&
    manifestWarmCodecVersion !== subscription.binding.ack.laneVersion
  ) {
    return {
      ok: false,
      model,
      failure: {
        kind: "warmManifestCodecVersionMismatch",
        subscriptionId: input.subscriptionId,
        manifestWarmCodecVersion,
        ackWarmCodecVersion: subscription.binding.ack.laneVersion,
      },
    };
  }

  const payload = encodeWarmSnapshotPayload(subscription.binding.payloadManifest, input.snapshot);
  if (!payload.ok) {
    return {
      ok: false,
      model,
      failure: {
        kind: "warmPayloadEncodeRejected",
        subscriptionId: input.subscriptionId,
        failure: payload.failure,
      },
    };
  }

  const ack = subscription.binding.ack;
  const frame = {
    contractKey: ack.contractKey,
    projectionInstanceKey: ack.projectionInstanceKey,
    semanticVersion: ack.semanticVersion,
    warmCodecVersion: ack.laneVersion,
    baselineEpoch: ack.baselineEpoch,
    continuityGeneration: ack.continuityGeneration,
    publicationSequence: subscription.nextPublicationSequence,
    ...(subscription.nextLaneSequence === undefined
      ? {}
      : { laneSequence: subscription.nextLaneSequence }),
    payload: payload.bytes,
  };
  const encodedFrame = encodeWarmLaneFrame(frame, options);
  if (!encodedFrame.ok) {
    return {
      ok: false,
      model,
      failure: {
        kind: "warmFrameEncodeRejected",
        subscriptionId: input.subscriptionId,
        failure: encodedFrame.failure,
      },
    };
  }

  let attachment: PublicationFrameAttachment;
  try {
    attachment = createPublicationFrameAttachmentFromAck(
      {
        streamKey: subscription.binding.streamKey,
        ack,
        frameBytes: encodedFrame.bytes,
      },
      options,
    );
  } catch (error) {
    return {
      ok: false,
      model,
      failure: {
        kind: "attachmentRejected",
        subscriptionId: input.subscriptionId,
        detail: errorMessage(error, "publication frame attachment rejected"),
      },
    };
  }

  const updatedSubscription: PublicationWarmAuthoritySubscription = {
    ...subscription,
    state: "live",
    nextPublicationSequence: subscription.nextPublicationSequence + 1n,
    ...(subscription.nextLaneSequence === undefined
      ? {}
      : { nextLaneSequence: subscription.nextLaneSequence + 1 }),
  };
  const nextSubscriptions = [
    ...model.subscriptions.slice(0, located.index),
    updatedSubscription,
    ...model.subscriptions.slice(located.index + 1),
  ];

  return {
    ok: true,
    model: { ...model, subscriptions: nextSubscriptions },
    binding: subscription.binding,
    attachment,
  };
}

function validateAttachmentForBinding(
  binding: PublicationWarmStreamBinding,
  attachment: PublicationFrameAttachment,
): PublicationFrameApplyFailure | null {
  const raw = attachment as {
    readonly kind?: unknown;
    readonly attachmentVersion?: unknown;
    readonly streamKey?: unknown;
    readonly subscriptionId?: unknown;
    readonly authorityEpoch?: unknown;
    readonly contractKey?: unknown;
    readonly projectionInstanceKey?: unknown;
    readonly lane?: unknown;
    readonly frameBytes?: unknown;
  };
  const ack = binding.ack;

  if (raw.kind !== "publication.warmFrame") {
    return {
      kind: "attachmentKindMismatch",
      expectedKind: "publication.warmFrame",
      providedKind: raw.kind,
    };
  }
  if (raw.attachmentVersion !== binding.attachmentVersion) {
    return {
      kind: "attachmentVersionMismatch",
      expectedAttachmentVersion: binding.attachmentVersion,
      providedAttachmentVersion: raw.attachmentVersion,
    };
  }
  if (raw.streamKey !== binding.streamKey) {
    return {
      kind: "streamKeyMismatch",
      expectedStreamKey: binding.streamKey,
      providedStreamKey: raw.streamKey,
    };
  }
  if (raw.subscriptionId !== ack.subscriptionId) {
    return {
      kind: "subscriptionMismatch",
      expectedSubscriptionId: ack.subscriptionId,
      providedSubscriptionId: String(raw.subscriptionId),
    };
  }
  if (raw.authorityEpoch !== ack.authorityEpoch) {
    return {
      kind: "sessionMismatch",
      expectedAuthorityEpoch: ack.authorityEpoch,
      providedAuthorityEpoch: typeof raw.authorityEpoch === "bigint" ? raw.authorityEpoch : -1n,
    };
  }
  if (raw.contractKey !== ack.contractKey) {
    return {
      kind: "attachmentContractKeyMismatch",
      expectedContractKey: ack.contractKey,
      providedContractKey: raw.contractKey,
    };
  }
  if (raw.projectionInstanceKey !== ack.projectionInstanceKey) {
    return {
      kind: "attachmentProjectionInstanceKeyMismatch",
      expectedProjectionInstanceKey: ack.projectionInstanceKey,
      providedProjectionInstanceKey: raw.projectionInstanceKey,
    };
  }
  if (raw.lane !== "warm") {
    return {
      kind: "attachmentLaneMismatch",
      expectedLane: "warm",
      providedLane: raw.lane,
    };
  }
  if (!(raw.frameBytes instanceof Uint8Array)) {
    return { kind: "attachmentRejected", detail: "attachment.frameBytes must be warm frame bytes" };
  }

  return null;
}

function surfaceForSubscribe(surface: PublicationWarmSurfaceRecord): PublicationSurfaceRecord {
  return {
    contractKey: surface.contractKey,
    projectionInstanceKey: surface.projectionInstanceKey,
    lane: surface.lane,
    semanticVersion: surface.semanticVersion,
    laneVersion: surface.laneVersion,
    baselineEpoch: surface.baselineEpoch,
    continuityGeneration: surface.continuityGeneration,
    status: surface.status,
  };
}

function toWarmAck(ack: SubscribePublicationAck): WarmSubscribePublicationAck {
  return { ...ack, lane: "warm" };
}

function findSurfaceForAck(
  surfaces: readonly PublicationWarmSurfaceRecord[],
  ack: WarmSubscribePublicationAck,
): PublicationWarmSurfaceRecord {
  const surface = surfaces.find(
    (candidate) =>
      candidate.contractKey === ack.contractKey &&
      candidate.projectionInstanceKey === ack.projectionInstanceKey &&
      candidate.lane === ack.lane,
  );
  if (surface === undefined) {
    throwSurfaceNotFound(
      `no warm publication surface for contract key ${ack.contractKey}, projection instance key ${ack.projectionInstanceKey}`,
    );
  }
  return surface;
}

function findSubscription(
  model: PublicationWarmRuntimeModel,
  subscriptionId: SubscriptionId,
): {
  readonly index: number;
  readonly subscription: PublicationWarmAuthoritySubscription;
} | null {
  const index = model.subscriptions.findIndex(
    (subscription) => subscription.binding.ack.subscriptionId === subscriptionId,
  );
  if (index < 0) {
    return null;
  }

  const subscription = model.subscriptions[index];
  if (subscription === undefined) {
    return null;
  }

  return { index, subscription };
}

function validateModelSessionForPublish(
  session: AuthoritySessionDescriptor,
  subscription: PublicationWarmAuthoritySubscription,
): PublicationWarmRuntimeFailure | null {
  const subscriptionId = subscription.binding.ack.subscriptionId;
  if (session.state !== "ready") {
    return {
      kind: "authoritySessionNotReady",
      subscriptionId,
      state: session.state,
    };
  }

  const expectedAuthorityEpoch = subscription.binding.ack.authorityEpoch;
  if (session.authorityEpoch !== expectedAuthorityEpoch) {
    return {
      kind: "authoritySessionMismatch",
      subscriptionId,
      expectedAuthorityEpoch,
      providedAuthorityEpoch: session.authorityEpoch,
    };
  }

  return null;
}

function sessionInvalidationForReplacement(
  current: AuthoritySessionDescriptor,
  next: AuthoritySessionDescriptor,
): SessionInvalidationEvent | null {
  const currentEpoch = authorityEpochOf(current);
  if (currentEpoch === undefined) {
    return null;
  }

  const nextEpoch = authorityEpochOf(next);
  if (nextEpoch !== undefined && nextEpoch !== currentEpoch) {
    return {
      kind: "authorityEpochReplaced",
      replacedAuthorityEpoch: currentEpoch,
      replacingAuthorityEpoch: nextEpoch,
    };
  }

  if (next.state === "stopping" || next.state === "stopped") {
    return {
      kind: "authorityUnavailable",
      replacedAuthorityEpoch: currentEpoch,
      state: next.state,
    };
  }

  return null;
}

function authorityEpochOf(session: AuthoritySessionDescriptor): bigint | undefined {
  return session.state === "stopped" ? undefined : session.authorityEpoch;
}

function invalidationTargetsBinding(
  invalidation: SessionInvalidationEvent | PublicationSubscriptionInvalidatedEvent,
  binding: PublicationWarmStreamBinding,
): boolean {
  const ack = binding.ack;
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

function errorMessage(error: unknown, fallback: string): string {
  return error instanceof Error ? error.message : fallback;
}
