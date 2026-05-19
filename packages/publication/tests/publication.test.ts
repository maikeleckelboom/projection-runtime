import {
  applyPublicationFrameAttachmentToConsumer,
  applyWarmFrameToPublicationConsumer,
  createPublicationAuthorityModel,
  createPublicationFrameAttachment,
  createPublicationFrameAttachmentFromAck,
  createPublicationWarmFrameDelivery,
  createWaitingPublicationConsumerSubscription,
  createWarmPublicationConsumerState,
  createWarmPublicationRuntime,
  invalidatePublicationConsumerSubscription,
  invalidateWarmPublicationRuntimeSubscriptions,
  PUBLICATION_TRANSPORT_ATTACHMENT_VERSION,
  type PublicationConsumerState,
  type PublicationFrameAttachment,
  type PublicationSubscribeFailure,
  type PublicationSubscriptionInvalidatedEvent,
  type PublicationSurfaceReadyEvent,
  type PublicationSurfaceRecord,
  type PublicationTransportAttachmentVersion,
  type PublicationWarmFrameDelivery,
  type PublicationWarmRuntimeModel,
  type PublicationWarmStreamBinding,
  type PublicationWarmSurfaceRecord,
  publishInitialWarmSnapshot,
  publishWarmSnapshot,
  type SubscribePublicationAck,
  type SubscribePublicationRequest,
  type SubscriptionId,
  subscribePublication,
  subscribeWarmPublication,
  updateWarmPublicationRuntimeAuthoritySession,
} from "@exclave/publication";
import {
  decodeWarmSnapshotPayload,
  encodeWarmLaneFrame,
  encodeWarmSnapshotPayload,
  type WarmLaneFrame,
  type WarmSnapshotObject,
  type WarmSnapshotPayloadManifest,
} from "@exclave/warm";
import { describe, expect, expectTypeOf, it } from "vitest";

type FixtureSnapshot = WarmSnapshotObject & {
  readonly tempo: number;
  readonly playing: boolean;
};

const CONTRACT_KEY = "deck.runtime";
const INSTANCE_KEY = "deck.a";
const SEMANTIC_VERSION = 0x0102_0304_0506_0708n;
const WARM_CODEC_VERSION = 0x1112_1314_1516_1718n;
const STREAM_KEY = "deck-runtime-v0.warm";

const fixtureManifest = {
  warmCodecVersion: WARM_CODEC_VERSION,
  fields: [
    { dotPath: "tempo", fieldId: 1, shape: { kind: "FixedScalar", type: "f64" } },
    { dotPath: "playing", fieldId: 2, shape: { kind: "FixedScalar", type: "bool" } },
  ],
} as const satisfies WarmSnapshotPayloadManifest;

describe("@exclave/publication public exports", () => {
  it("exports request, ack, failure, and event protocol types", () => {
    expectTypeOf<SubscribePublicationRequest>().toEqualTypeOf<{
      readonly contractKey: string;
      readonly projectionInstanceKey: string;
      readonly lane: "warm" | "cold";
      readonly expectedSemanticVersion: bigint;
      readonly expectedLaneVersion: bigint;
    }>();
    expectTypeOf<SubscribePublicationAck["authorityEpoch"]>().toEqualTypeOf<bigint>();
    expectTypeOf<SubscriptionId>().toEqualTypeOf<string>();
    expectTypeOf<PublicationSubscribeFailure["kind"]>().toEqualTypeOf<
      | "authorityUnavailable"
      | "authorityNotReady"
      | "sessionMismatch"
      | "surfaceUnavailable"
      | "surfaceDeferredNotReady"
      | "notDeclaredLane"
      | "coldLaneNotRatified"
      | "streamIncompatible"
      | "unknownSurface"
    >();
    expectTypeOf<PublicationSurfaceReadyEvent["kind"]>().toEqualTypeOf<"publicationSurfaceReady">();
    expectTypeOf<
      PublicationSubscriptionInvalidatedEvent["kind"]
    >().toEqualTypeOf<"subscriptionInvalidated">();
    expectTypeOf<PublicationTransportAttachmentVersion>().toEqualTypeOf<1>();
    expectTypeOf<PublicationFrameAttachment["kind"]>().toEqualTypeOf<"publication.warmFrame">();
    expectTypeOf<PublicationWarmFrameDelivery>().toEqualTypeOf<{
      readonly subscriptionId: string;
      readonly authorityEpoch: bigint;
      readonly bytes: Uint8Array;
    }>();
  });

  it("exports publication transport attachment version", () => {
    expect(PUBLICATION_TRANSPORT_ATTACHMENT_VERSION).toBe(1);
  });
});

describe("publication subscribe protocol", () => {
  it("rejects cold subscribe with coldLaneNotRatified", () => {
    const model = readyModel();
    const result = subscribePublication(model, {
      ...request(),
      lane: "cold",
    });

    expect(result.result).toEqual({
      ok: false,
      failure: {
        kind: "coldLaneNotRatified",
        contractKey: CONTRACT_KEY,
        projectionInstanceKey: INSTANCE_KEY,
      },
    });
  });

  it("reports authorityNotReady for starting authority sessions", () => {
    const model = createPublicationAuthorityModel({
      session: { state: "starting", authorityEpoch: 1n },
      surfaces: [readySurface()],
    });

    const result = subscribePublication(model, request());

    expect(result.result).toEqual({
      ok: false,
      failure: { kind: "authorityNotReady", state: "starting" },
    });
  });

  it("keeps surfaceDeferredNotReady and surfaceUnavailable distinct", () => {
    const deferred = subscribePublication(
      createPublicationAuthorityModel({
        session: { state: "ready", authorityEpoch: 1n },
        surfaces: [readySurface({ status: "deferredNotReady" })],
      }),
      request(),
    );
    const unavailable = subscribePublication(
      createPublicationAuthorityModel({
        session: { state: "ready", authorityEpoch: 1n },
        surfaces: [readySurface({ status: "unavailable" })],
      }),
      request(),
    );

    expect(deferred.result).toEqual({
      ok: false,
      failure: {
        kind: "surfaceDeferredNotReady",
        contractKey: CONTRACT_KEY,
        projectionInstanceKey: INSTANCE_KEY,
      },
    });
    expect(unavailable.result).toEqual({
      ok: false,
      failure: {
        kind: "surfaceUnavailable",
        contractKey: CONTRACT_KEY,
        projectionInstanceKey: INSTANCE_KEY,
      },
    });
  });

  it("subscribes after authority ready and returns an ack bound to authorityEpoch", () => {
    const result = subscribePublication(readyModel(), request());

    expect(result.result.ok).toBe(true);
    if (!result.result.ok) throw new Error("expected subscribe ack");

    expect(result.result.ack).toMatchObject({
      contractKey: CONTRACT_KEY,
      projectionInstanceKey: INSTANCE_KEY,
      lane: "warm",
      subscriptionId: "subscription-1",
      authorityEpoch: 1n,
      semanticVersion: SEMANTIC_VERSION,
      laneVersion: WARM_CODEC_VERSION,
      baselineEpoch: 7,
      continuityGeneration: 3,
    });
  });

  it("SubscribePublicationAck does not carry snapshot payload, body, or frame bytes", () => {
    const result = subscribePublication(readyModel(), request());
    if (!result.result.ok) throw new Error("expected subscribe ack");

    const ackKeys = Object.keys(result.result.ack);

    expect(ackKeys).not.toContain("payload");
    expect(ackKeys).not.toContain("body");
    expect(ackKeys).not.toContain("bytes");
    expect(ackKeys).not.toContain("frame");
    expect("handleId" in result.result.ack).toBe(false);
    expect("hotRegionKey" in result.result.ack).toBe(false);
  });
});

describe("modeled warm publication runtime", () => {
  it("subscribes, emits an initial attachment, decodes payload state, and applies later frames", () => {
    let runtime = readyWarmRuntime();
    const subscribed = subscribeWarmPublication(runtime, request());
    expect(subscribed.result.ok).toBe(true);
    if (!subscribed.result.ok) throw new Error("expected warm subscribe ack");

    runtime = subscribed.model;
    const binding = subscribed.result.binding;
    let consumer = createWarmPublicationConsumerState(binding);
    expect(consumer.kind).toBe("subscribedWaitingForInitialSnapshot");

    const initial = publishInitialWarmSnapshot(runtime, {
      subscriptionId: binding.ack.subscriptionId,
      snapshot: { tempo: 128, playing: true },
    });
    expect(initial.ok).toBe(true);
    if (!initial.ok) throw new Error("expected initial snapshot publication");
    runtime = initial.model;

    expect(initial.attachment).toMatchObject({
      kind: "publication.warmFrame",
      attachmentVersion: PUBLICATION_TRANSPORT_ATTACHMENT_VERSION,
      streamKey: STREAM_KEY,
      subscriptionId: binding.ack.subscriptionId,
      authorityEpoch: 1n,
      contractKey: CONTRACT_KEY,
      projectionInstanceKey: INSTANCE_KEY,
      lane: "warm",
    });

    const initialApplied = applyPublicationFrameAttachmentToConsumer(
      consumer,
      binding,
      initial.attachment,
    );
    expect(initialApplied.ok).toBe(true);
    if (!initialApplied.ok) throw new Error("expected initial attachment to apply");
    consumer = initialApplied.state;
    expect(consumer.kind).toBe("live");
    if (consumer.kind !== "live") throw new Error("expected live consumer");
    expect(consumer.latestProjectionState).toEqual({ tempo: 128, playing: true });
    expect(consumer.latestFrame.publicationSequence).toBe(1n);
    expect(consumer.latestFrame.laneSequence).toBe(0);

    const later = publishWarmSnapshot(runtime, {
      subscriptionId: binding.ack.subscriptionId,
      snapshot: { tempo: 129, playing: false },
    });
    expect(later.ok).toBe(true);
    if (!later.ok) throw new Error("expected later snapshot publication");

    const laterApplied = applyPublicationFrameAttachmentToConsumer(
      consumer,
      binding,
      later.attachment,
    );
    expect(laterApplied.ok).toBe(true);
    if (!laterApplied.ok) throw new Error("expected later attachment to apply");
    if (laterApplied.state.kind !== "live") throw new Error("expected live state");
    expect(laterApplied.state.latestProjectionState).toEqual({ tempo: 129, playing: false });
    expect(laterApplied.state.latestFrame.publicationSequence).toBe(2n);
    expect(laterApplied.state.latestFrame.laneSequence).toBe(1);
  });

  it("rejects warm publish before the required initial snapshot is emitted", () => {
    const subscribed = subscribeWarmPublication(readyWarmRuntime(), request());
    if (!subscribed.result.ok) throw new Error("expected warm subscribe ack");

    const rejected = publishWarmSnapshot(subscribed.model, {
      subscriptionId: subscribed.result.ack.subscriptionId,
      snapshot: { tempo: 129, playing: false },
    });

    expect(rejected.ok).toBe(false);
    if (!rejected.ok) {
      expect(rejected.failure).toEqual({
        kind: "initialSnapshotRequired",
        subscriptionId: subscribed.result.ack.subscriptionId,
      });
    }
  });

  it("returns existing typed subscribe failures for unavailable runtime surfaces", () => {
    const cases: ReadonlyArray<{
      readonly name: string;
      readonly runtime: PublicationWarmRuntimeModel;
      readonly request: SubscribePublicationRequest;
      readonly expectedKind: PublicationSubscribeFailure["kind"];
    }> = [
      {
        name: "authorityNotReady",
        runtime: createWarmPublicationRuntime({
          session: { state: "starting", authorityEpoch: 1n },
          surfaces: [readyWarmSurface()],
        }),
        request: request(),
        expectedKind: "authorityNotReady",
      },
      {
        name: "deferred",
        runtime: createWarmPublicationRuntime({
          session: { state: "ready", authorityEpoch: 1n },
          surfaces: [readyWarmSurface({ status: "deferredNotReady" })],
        }),
        request: request(),
        expectedKind: "surfaceDeferredNotReady",
      },
      {
        name: "unavailable",
        runtime: createWarmPublicationRuntime({
          session: { state: "ready", authorityEpoch: 1n },
          surfaces: [readyWarmSurface({ status: "unavailable" })],
        }),
        request: request(),
        expectedKind: "surfaceUnavailable",
      },
      {
        name: "cold",
        runtime: readyWarmRuntime(),
        request: { ...request(), lane: "cold" },
        expectedKind: "coldLaneNotRatified",
      },
      {
        name: "unknown",
        runtime: readyWarmRuntime(),
        request: { ...request(), contractKey: "unknown.contract" },
        expectedKind: "unknownSurface",
      },
      {
        name: "incompatible",
        runtime: readyWarmRuntime(),
        request: { ...request(), expectedLaneVersion: WARM_CODEC_VERSION + 1n },
        expectedKind: "streamIncompatible",
      },
    ];

    for (const testCase of cases) {
      const result = subscribeWarmPublication(testCase.runtime, testCase.request);
      expect(result.result.ok, testCase.name).toBe(false);
      if (!result.result.ok) {
        expect(result.result.failure.kind).toBe(testCase.expectedKind);
      }
    }
  });

  it("rejects typed attachment mismatches before updating consumer state", () => {
    const { binding, consumer, attachment } = liveRuntimeAttachment();

    const cases: ReadonlyArray<{
      readonly name: string;
      readonly attachment: PublicationFrameAttachment;
      readonly expectedKind: string;
    }> = [
      {
        name: "attachmentVersion",
        attachment: { ...attachment, attachmentVersion: 99 as never },
        expectedKind: "attachmentVersionMismatch",
      },
      {
        name: "streamKey",
        attachment: { ...attachment, streamKey: "other.warm" },
        expectedKind: "streamKeyMismatch",
      },
      {
        name: "subscriptionId",
        attachment: { ...attachment, subscriptionId: "subscription-other" },
        expectedKind: "subscriptionMismatch",
      },
      {
        name: "authorityEpoch",
        attachment: { ...attachment, authorityEpoch: 2n },
        expectedKind: "sessionMismatch",
      },
      {
        name: "contractKey",
        attachment: { ...attachment, contractKey: "other.contract" },
        expectedKind: "attachmentContractKeyMismatch",
      },
      {
        name: "projectionInstanceKey",
        attachment: { ...attachment, projectionInstanceKey: "other.instance" },
        expectedKind: "attachmentProjectionInstanceKeyMismatch",
      },
      {
        name: "lane",
        attachment: { ...attachment, lane: "cold" as never },
        expectedKind: "attachmentLaneMismatch",
      },
    ];

    for (const testCase of cases) {
      const rejected = applyPublicationFrameAttachmentToConsumer(
        consumer,
        binding,
        testCase.attachment,
      );
      expect(rejected.ok, testCase.name).toBe(false);
      if (!rejected.ok) {
        expect(rejected.failure.kind).toBe(testCase.expectedKind);
        expect(rejected.state).toBe(consumer);
      }
    }
  });

  it("rejects frame metadata mismatches carried inside otherwise typed attachments", () => {
    const subscribed = subscribeWarmPublication(readyWarmRuntime(), request());
    if (!subscribed.result.ok) throw new Error("expected warm subscribe ack");
    const binding = subscribed.result.binding;
    const waiting = createWarmPublicationConsumerState(binding);

    const semanticMismatch = applyPublicationFrameAttachmentToConsumer(
      waiting,
      binding,
      attachmentForFrame(
        binding,
        warmFrameBytes(
          { ...binding.ack, semanticVersion: binding.ack.semanticVersion + 1n },
          { tempo: 128, playing: true },
          1n,
          0,
        ),
      ),
    );
    expect(semanticMismatch.ok).toBe(false);
    if (!semanticMismatch.ok) {
      expect(semanticMismatch.failure.kind).toBe("warmStreamFatal");
      if (semanticMismatch.failure.kind === "warmStreamFatal") {
        expect(semanticMismatch.failure.reason).toBe("semanticVersionMismatch");
      }
    }

    const codecMismatch = applyPublicationFrameAttachmentToConsumer(
      waiting,
      binding,
      attachmentForFrame(
        binding,
        warmFrameBytes(
          { ...binding.ack, laneVersion: binding.ack.laneVersion + 1n },
          { tempo: 128, playing: true },
          1n,
          0,
        ),
      ),
    );
    expect(codecMismatch.ok).toBe(false);
    if (!codecMismatch.ok) {
      expect(codecMismatch.failure.kind).toBe("warmStreamFatal");
      if (codecMismatch.failure.kind === "warmStreamFatal") {
        expect(codecMismatch.failure.reason).toBe("codecVersionMismatch");
      }
    }

    const baselineMismatch = applyPublicationFrameAttachmentToConsumer(
      waiting,
      binding,
      attachmentForFrame(
        binding,
        warmFrameBytes(
          { ...binding.ack, baselineEpoch: binding.ack.baselineEpoch + 1 },
          { tempo: 128, playing: true },
          1n,
          0,
        ),
      ),
    );
    expect(baselineMismatch.ok).toBe(false);
    if (!baselineMismatch.ok) {
      expect(baselineMismatch.failure.kind).toBe("initialSnapshotMetadataMismatch");
    }

    const continuityMismatch = applyPublicationFrameAttachmentToConsumer(
      waiting,
      binding,
      attachmentForFrame(
        binding,
        warmFrameBytes(
          { ...binding.ack, continuityGeneration: binding.ack.continuityGeneration + 1 },
          { tempo: 128, playing: true },
          1n,
          0,
        ),
      ),
    );
    expect(continuityMismatch.ok).toBe(false);
    if (!continuityMismatch.ok) {
      expect(continuityMismatch.failure.kind).toBe("initialSnapshotMetadataMismatch");
    }

    const live = liveRuntimeAttachment();
    const liveBaselineMismatch = applyPublicationFrameAttachmentToConsumer(
      live.consumer,
      live.binding,
      attachmentForFrame(
        live.binding,
        warmFrameBytes(
          { ...live.binding.ack, baselineEpoch: live.binding.ack.baselineEpoch + 1 },
          { tempo: 129, playing: true },
          2n,
          1,
        ),
      ),
    );
    expect(liveBaselineMismatch.ok).toBe(false);
    if (!liveBaselineMismatch.ok) {
      expect(liveBaselineMismatch.failure.kind).toBe("streamMetadataMismatch");
    }
  });

  it("rejects laneSequence toggles and non-advancing replay frames", () => {
    const { binding, consumer } = liveRuntimeAttachment();
    if (consumer.kind !== "live") throw new Error("expected live consumer");

    const noLaneSequence = applyPublicationFrameAttachmentToConsumer(
      consumer,
      binding,
      attachmentForFrame(binding, warmFrameBytes(binding.ack, { tempo: 130, playing: true }, 2n)),
    );
    expect(noLaneSequence.ok).toBe(false);
    if (!noLaneSequence.ok) {
      expect(noLaneSequence.failure.kind).toBe("warmStreamFatal");
      if (noLaneSequence.failure.kind === "warmStreamFatal") {
        expect(noLaneSequence.failure.reason).toBe("laneSequencePresenceToggled");
      }
    }

    const replay = applyPublicationFrameAttachmentToConsumer(
      consumer,
      binding,
      attachmentForFrame(
        binding,
        warmFrameBytes(binding.ack, { tempo: 130, playing: true }, 1n, 1),
      ),
    );
    expect(replay.ok).toBe(false);
    if (!replay.ok) {
      expect(replay.failure.kind).toBe("publicationSequenceNotAdvanced");
    }
  });

  it("invalidates old authority subscriptions and rebinds under the replacement epoch", () => {
    const live = liveRuntimeAttachment();
    const replacementSession = { state: "ready" as const, authorityEpoch: 2n };
    const invalidatedRuntime = updateWarmPublicationRuntimeAuthoritySession(
      live.runtime,
      replacementSession,
    );
    const oldSubscription = invalidatedRuntime.subscriptions.find(
      (subscription) => subscription.binding.ack.subscriptionId === live.binding.ack.subscriptionId,
    );
    expect(oldSubscription?.state).toBe("invalidated");

    const rejectedOldPublish = publishWarmSnapshot(invalidatedRuntime, {
      subscriptionId: live.binding.ack.subscriptionId,
      snapshot: { tempo: 130, playing: true },
    });
    expect(rejectedOldPublish.ok).toBe(false);
    if (!rejectedOldPublish.ok) {
      expect(rejectedOldPublish.failure.kind).toBe("subscriptionInvalidated");
    }

    const staleConsumer = invalidatePublicationConsumerSubscription(live.consumer, {
      kind: "authorityEpochReplaced",
      replacedAuthorityEpoch: 1n,
      replacingAuthorityEpoch: 2n,
    });
    const rejectedOldAttachment = applyPublicationFrameAttachmentToConsumer(
      staleConsumer,
      live.binding,
      live.attachment,
    );
    expect(rejectedOldAttachment.ok).toBe(false);
    if (!rejectedOldAttachment.ok) {
      expect(rejectedOldAttachment.failure.kind).toBe("subscriptionNotLive");
    }

    const reboundRuntime = createWarmPublicationRuntime({
      session: replacementSession,
      surfaces: [readyWarmSurface({ baselineEpoch: 8, continuityGeneration: 0 })],
      subscriptions: invalidatedRuntime.subscriptions,
      nextSubscriptionOrdinal: invalidatedRuntime.nextSubscriptionOrdinal,
    });
    const rebound = subscribeWarmPublication(reboundRuntime, request());
    expect(rebound.result.ok).toBe(true);
    if (!rebound.result.ok) throw new Error("expected rebound subscribe ack");
    expect(rebound.result.ack.subscriptionId).toBe("subscription-2");
    expect(rebound.result.ack.authorityEpoch).toBe(2n);

    const reboundConsumer = createWarmPublicationConsumerState(rebound.result.binding);
    const oldAttachmentAgainstNew = applyPublicationFrameAttachmentToConsumer(
      reboundConsumer,
      rebound.result.binding,
      live.attachment,
    );
    expect(oldAttachmentAgainstNew.ok).toBe(false);
    if (!oldAttachmentAgainstNew.ok) {
      expect(oldAttachmentAgainstNew.failure.kind).toBe("subscriptionMismatch");
    }

    const reboundInitial = publishInitialWarmSnapshot(rebound.model, {
      subscriptionId: rebound.result.ack.subscriptionId,
      snapshot: { tempo: 131, playing: false },
    });
    expect(reboundInitial.ok).toBe(true);
    if (!reboundInitial.ok) throw new Error("expected rebound initial snapshot");

    const reboundApplied = applyPublicationFrameAttachmentToConsumer(
      reboundConsumer,
      rebound.result.binding,
      reboundInitial.attachment,
    );
    expect(reboundApplied.ok).toBe(true);
    if (!reboundApplied.ok) throw new Error("expected rebound attachment to apply");
    if (reboundApplied.state.kind !== "live") throw new Error("expected rebound live state");
    expect(reboundApplied.state.latestProjectionState).toEqual({ tempo: 131, playing: false });
  });

  it("supports per-subscription invalidation in the authority runtime model", () => {
    const live = liveRuntimeAttachment();
    const invalidated = invalidateWarmPublicationRuntimeSubscriptions(live.runtime, {
      kind: "subscriptionInvalidated",
      subscriptionId: live.binding.ack.subscriptionId,
      authorityEpoch: live.binding.ack.authorityEpoch,
      contractKey: live.binding.ack.contractKey,
      projectionInstanceKey: live.binding.ack.projectionInstanceKey,
      reason: "revoked",
    });

    const rejected = publishWarmSnapshot(invalidated, {
      subscriptionId: live.binding.ack.subscriptionId,
      snapshot: { tempo: 132, playing: true },
    });

    expect(rejected.ok).toBe(false);
    if (!rejected.ok) {
      expect(rejected.failure.kind).toBe("subscriptionInvalidated");
    }
  });
});

describe("modeled warm subscription lifecycle", () => {
  it("carries warm publication frames through a typed attachment boundary", () => {
    const ack = subscribeAck();
    const frameBytes = warmFrameBytes(ack, { tempo: 128, playing: true });
    const attachment = createPublicationFrameAttachmentFromAck({
      streamKey: "deck-runtime-v0.warm",
      ack,
      frameBytes,
    });

    expect(attachment).toMatchObject({
      kind: "publication.warmFrame",
      attachmentVersion: PUBLICATION_TRANSPORT_ATTACHMENT_VERSION,
      streamKey: "deck-runtime-v0.warm",
      subscriptionId: ack.subscriptionId,
      authorityEpoch: ack.authorityEpoch,
      contractKey: ack.contractKey,
      projectionInstanceKey: ack.projectionInstanceKey,
      lane: "warm",
    });
    expect(Object.keys(attachment).sort()).toEqual([
      "attachmentVersion",
      "authorityEpoch",
      "contractKey",
      "frameBytes",
      "kind",
      "lane",
      "projectionInstanceKey",
      "streamKey",
      "subscriptionId",
    ]);
    expect(Object.keys(attachment)).not.toEqual(
      expect.arrayContaining(["body", "payload", "resourceBody"]),
    );

    const delivery = createPublicationWarmFrameDelivery(attachment);
    expect(delivery).toEqual({
      subscriptionId: ack.subscriptionId,
      authorityEpoch: ack.authorityEpoch,
      bytes: attachment.frameBytes,
    });

    const applied = applyWarmFrameToPublicationConsumer(
      createWaitingPublicationConsumerSubscription<FixtureSnapshot>(ack),
      delivery,
      decodeFixtureSnapshot,
    );

    expect(applied.ok).toBe(true);
  });

  it("rejects attachments whose warm frame identity disagrees with the attachment", () => {
    const ack = subscribeAck();
    const frameBytes = warmFrameBytes(
      { ...ack, projectionInstanceKey: "deck.other" },
      { tempo: 128, playing: true },
    );

    expect(() =>
      createPublicationFrameAttachment({
        kind: "publication.warmFrame",
        attachmentVersion: PUBLICATION_TRANSPORT_ATTACHMENT_VERSION,
        streamKey: "deck-runtime-v0.warm",
        subscriptionId: ack.subscriptionId,
        authorityEpoch: ack.authorityEpoch,
        contractKey: ack.contractKey,
        projectionInstanceKey: ack.projectionInstanceKey,
        lane: "warm",
        frameBytes,
      }),
    ).toThrow();
  });

  it("rejects resource bodies and body-shaped objects as publication frame attachments", () => {
    const ack = subscribeAck();

    expect(() =>
      createPublicationFrameAttachment({
        kind: "publication.warmFrame",
        attachmentVersion: PUBLICATION_TRANSPORT_ATTACHMENT_VERSION,
        streamKey: "deck-runtime-v0.warm",
        subscriptionId: ack.subscriptionId,
        authorityEpoch: ack.authorityEpoch,
        contractKey: ack.contractKey,
        projectionInstanceKey: ack.projectionInstanceKey,
        lane: "warm",
        frameBytes: { body: new Uint8Array([1, 2, 3]) } as never,
      }),
    ).toThrow();

    expect(() =>
      createPublicationFrameAttachment({
        kind: "publication.warmFrame",
        attachmentVersion: PUBLICATION_TRANSPORT_ATTACHMENT_VERSION,
        streamKey: "deck-runtime-v0.warm",
        subscriptionId: ack.subscriptionId,
        authorityEpoch: ack.authorityEpoch,
        contractKey: ack.contractKey,
        projectionInstanceKey: ack.projectionInstanceKey,
        lane: "warm",
        frameBytes: new Uint8Array([1, 2, 3]),
      }),
    ).toThrow();
  });

  it("rejects warm frames whose baselineEpoch disagrees with the subscribe ack", () => {
    const ack = subscribeAck();
    const frameBytes = warmFrameBytes(
      { ...ack, baselineEpoch: ack.baselineEpoch + 1 },
      { tempo: 128, playing: true },
    );

    expect(() =>
      createPublicationFrameAttachmentFromAck({
        streamKey: "deck-runtime-v0.warm",
        ack,
        frameBytes,
      }),
    ).toThrow();
  });

  it("rejects warm frames whose continuityGeneration disagrees with the subscribe ack", () => {
    const ack = subscribeAck();
    const frameBytes = warmFrameBytes(
      { ...ack, continuityGeneration: ack.continuityGeneration + 1 },
      { tempo: 128, playing: true },
    );

    expect(() =>
      createPublicationFrameAttachmentFromAck({
        streamKey: "deck-runtime-v0.warm",
        ack,
        frameBytes,
      }),
    ).toThrow();
  });

  it("rejects cold-lane acks because v1 attachments only carry warm frames", () => {
    const ack: SubscribePublicationAck = {
      ...subscribeAck(),
      lane: "cold",
    };

    expect(() =>
      createPublicationFrameAttachmentFromAck({
        streamKey: "deck-runtime-v0.cold",
        ack,
        frameBytes: warmFrameBytes(subscribeAck(), { tempo: 128, playing: true }),
      }),
    ).toThrow();
  });

  it("applies the first complete warm snapshot after ack", () => {
    const ack = subscribeAck();
    const waiting = createWaitingPublicationConsumerSubscription<FixtureSnapshot>(ack);
    const bytes = warmFrameBytes(ack, { tempo: 128, playing: true });

    const applied = applyWarmFrameToPublicationConsumer(
      waiting,
      { subscriptionId: ack.subscriptionId, authorityEpoch: ack.authorityEpoch, bytes },
      decodeFixtureSnapshot,
    );

    expect(applied.ok).toBe(true);
    if (!applied.ok) throw new Error("expected initial snapshot to apply");

    expect(applied.state.kind).toBe("live");
    if (applied.state.kind !== "live") throw new Error("expected live state");
    expect(applied.state.latestProjectionState).toEqual({ tempo: 128, playing: true });
    expect(applied.state.latestFrame.publicationSequence).toBe(1n);
  });

  it("invalidates the old subscription on authorityEpochReplaced", () => {
    const live = liveConsumerState({ tempo: 128, playing: true });
    const stale = invalidateOldAuthority(live);

    expect(stale.kind).toBe("stale");
    if (stale.kind !== "stale") throw new Error("expected stale state");
    expect(stale.reason).toBe("authorityEpochReplaced");
    expect("latestProjectionState" in stale).toBe(false);
    expect(stale.lastGoodProjectionState).toEqual({ tempo: 128, playing: true });
  });

  it("rejects later frames on an invalidated old subscription", () => {
    const ack = subscribeAck();
    const live = liveConsumerState({ tempo: 128, playing: true });
    const stale = invalidateOldAuthority(live);
    const bytes = warmFrameBytes(ack, { tempo: 129, playing: true }, 2n);

    const rejected = applyWarmFrameToPublicationConsumer(
      stale,
      { subscriptionId: ack.subscriptionId, authorityEpoch: ack.authorityEpoch, bytes },
      decodeFixtureSnapshot,
    );

    expect(rejected.ok).toBe(false);
    if (!rejected.ok) {
      expect(rejected.failure.kind).toBe("subscriptionNotLive");
    }
  });

  it("rebinds after new authorityReady with a new subscriptionId and accepts a new initial snapshot", () => {
    const firstAttempt = subscribePublication(readyModel(), request());
    if (!firstAttempt.result.ok) throw new Error("expected first ack");

    const replacementModel = createPublicationAuthorityModel({
      session: { state: "ready", authorityEpoch: 2n },
      surfaces: [readySurface({ baselineEpoch: 8, continuityGeneration: 0 })],
      nextSubscriptionOrdinal: firstAttempt.model.nextSubscriptionOrdinal,
    });
    const secondAttempt = subscribePublication(replacementModel, request());
    if (!secondAttempt.result.ok) throw new Error("expected second ack");

    expect(secondAttempt.result.ack.subscriptionId).toBe("subscription-2");
    expect(secondAttempt.result.ack.subscriptionId).not.toBe(
      firstAttempt.result.ack.subscriptionId,
    );
    expect(secondAttempt.result.ack.authorityEpoch).toBe(2n);

    const waiting = createWaitingPublicationConsumerSubscription<FixtureSnapshot>(
      secondAttempt.result.ack,
    );
    const bytes = warmFrameBytes(secondAttempt.result.ack, { tempo: 131, playing: false });
    const applied = applyWarmFrameToPublicationConsumer(
      waiting,
      {
        subscriptionId: secondAttempt.result.ack.subscriptionId,
        authorityEpoch: secondAttempt.result.ack.authorityEpoch,
        bytes,
      },
      decodeFixtureSnapshot,
    );

    expect(applied.ok).toBe(true);
    if (!applied.ok) throw new Error("expected rebound snapshot to apply");
    if (applied.state.kind !== "live") throw new Error("expected live rebound state");
    expect(applied.state.latestProjectionState).toEqual({ tempo: 131, playing: false });
  });

  it("does not let old authorityEpoch traffic update the new subscription", () => {
    const replacementAck = {
      ...subscribeAck(),
      subscriptionId: "subscription-2",
      authorityEpoch: 2n,
      baselineEpoch: 8,
      continuityGeneration: 0,
    };
    const waiting = createWaitingPublicationConsumerSubscription<FixtureSnapshot>(replacementAck);
    const bytes = warmFrameBytes(replacementAck, { tempo: 140, playing: true });

    const rejected = applyWarmFrameToPublicationConsumer(
      waiting,
      { subscriptionId: replacementAck.subscriptionId, authorityEpoch: 1n, bytes },
      decodeFixtureSnapshot,
    );

    expect(rejected.ok).toBe(false);
    if (!rejected.ok) {
      expect(rejected.failure).toEqual({
        kind: "sessionMismatch",
        expectedAuthorityEpoch: 2n,
        providedAuthorityEpoch: 1n,
      });
      expect(rejected.state).toBe(waiting);
    }

    const ignoredOldEvent = invalidatePublicationConsumerSubscription(waiting, {
      kind: "authorityUnavailable",
      replacedAuthorityEpoch: 1n,
      state: "stopped",
    });
    expect(ignoredOldEvent).toBe(waiting);
  });

  it("keeps subscription and hot handle open distinct by runtime shape", () => {
    const ack = subscribeAck();

    expect(ack.subscriptionId).toBe("subscription-1");
    expect("handleId" in ack).toBe(false);
    expect("hotRegionKey" in ack).toBe(false);
    expect("mappingDescriptor" in ack).toBe(false);
  });
});

function readyModel(): ReturnType<typeof createPublicationAuthorityModel> {
  return createPublicationAuthorityModel({
    session: { state: "ready", authorityEpoch: 1n },
    surfaces: [readySurface()],
  });
}

function readyWarmRuntime(): PublicationWarmRuntimeModel {
  return createWarmPublicationRuntime({
    session: { state: "ready", authorityEpoch: 1n },
    surfaces: [readyWarmSurface()],
  });
}

function readySurface(overrides: Partial<PublicationSurfaceRecord> = {}): PublicationSurfaceRecord {
  return {
    contractKey: CONTRACT_KEY,
    projectionInstanceKey: INSTANCE_KEY,
    lane: "warm",
    semanticVersion: SEMANTIC_VERSION,
    laneVersion: WARM_CODEC_VERSION,
    baselineEpoch: 7,
    continuityGeneration: 3,
    status: "ready",
    ...overrides,
  };
}

function readyWarmSurface(
  overrides: Partial<PublicationWarmSurfaceRecord> = {},
): PublicationWarmSurfaceRecord {
  return {
    ...readySurface(),
    lane: "warm",
    streamKey: STREAM_KEY,
    payloadManifest: fixtureManifest,
    laneSequenceMode: "present",
    ...overrides,
  };
}

function request(): SubscribePublicationRequest {
  return {
    contractKey: CONTRACT_KEY,
    projectionInstanceKey: INSTANCE_KEY,
    lane: "warm",
    expectedSemanticVersion: SEMANTIC_VERSION,
    expectedLaneVersion: WARM_CODEC_VERSION,
  };
}

function subscribeAck(): SubscribePublicationAck {
  const result = subscribePublication(readyModel(), request());
  if (!result.result.ok) throw new Error("expected subscribe ack");
  return result.result.ack;
}

function warmFrameBytes(
  ack: SubscribePublicationAck,
  snapshot: FixtureSnapshot,
  publicationSequence = 1n,
  laneSequence?: number,
): Uint8Array {
  const frame: WarmLaneFrame = {
    contractKey: ack.contractKey,
    projectionInstanceKey: ack.projectionInstanceKey,
    semanticVersion: ack.semanticVersion,
    warmCodecVersion: ack.laneVersion,
    baselineEpoch: ack.baselineEpoch,
    continuityGeneration: ack.continuityGeneration,
    publicationSequence,
    ...(laneSequence === undefined ? {} : { laneSequence }),
    payload: encodeFixtureSnapshot(snapshot),
  };
  const encoded = encodeWarmLaneFrame(frame);
  if (!encoded.ok) throw new Error("expected warm frame encode to succeed");
  return encoded.bytes;
}

function encodeFixtureSnapshot(snapshot: FixtureSnapshot): Uint8Array {
  const encoded = encodeWarmSnapshotPayload(fixtureManifest, snapshot);
  if (!encoded.ok)
    throw new Error(`expected warm payload encode to succeed: ${encoded.failure.detail}`);
  return encoded.bytes;
}

function decodeFixtureSnapshot(payload: Uint8Array): FixtureSnapshot {
  const decoded = decodeWarmSnapshotPayload(fixtureManifest, payload);
  if (!decoded.ok) {
    throw new Error(`expected warm payload decode to succeed: ${decoded.failure.detail}`);
  }
  return {
    tempo: decoded.snapshot.tempo as number,
    playing: decoded.snapshot.playing as boolean,
  };
}

function liveConsumerState(snapshot: FixtureSnapshot): PublicationConsumerState<FixtureSnapshot> {
  const ack = subscribeAck();
  const waiting = createWaitingPublicationConsumerSubscription<FixtureSnapshot>(ack);
  const applied = applyWarmFrameToPublicationConsumer(
    waiting,
    {
      subscriptionId: ack.subscriptionId,
      authorityEpoch: ack.authorityEpoch,
      bytes: warmFrameBytes(ack, snapshot),
    },
    decodeFixtureSnapshot,
  );
  if (!applied.ok) throw new Error("expected live state");
  return applied.state;
}

function invalidateOldAuthority(
  state: PublicationConsumerState<FixtureSnapshot>,
): PublicationConsumerState<FixtureSnapshot> {
  return invalidatePublicationConsumerSubscription(state, {
    kind: "authorityEpochReplaced",
    replacedAuthorityEpoch: 1n,
    replacingAuthorityEpoch: 2n,
  });
}

function liveRuntimeAttachment(): {
  readonly runtime: PublicationWarmRuntimeModel;
  readonly binding: PublicationWarmStreamBinding;
  readonly consumer: PublicationConsumerState<WarmSnapshotObject>;
  readonly attachment: PublicationFrameAttachment;
} {
  const subscribed = subscribeWarmPublication(readyWarmRuntime(), request());
  if (!subscribed.result.ok) throw new Error("expected warm subscribe ack");
  const initial = publishInitialWarmSnapshot(subscribed.model, {
    subscriptionId: subscribed.result.ack.subscriptionId,
    snapshot: { tempo: 128, playing: true },
  });
  if (!initial.ok) throw new Error("expected initial snapshot publication");
  const waiting = createWarmPublicationConsumerState(subscribed.result.binding);
  const applied = applyPublicationFrameAttachmentToConsumer(
    waiting,
    subscribed.result.binding,
    initial.attachment,
  );
  if (!applied.ok) throw new Error("expected initial attachment to apply");

  return {
    runtime: initial.model,
    binding: subscribed.result.binding,
    consumer: applied.state,
    attachment: initial.attachment,
  };
}

function attachmentForFrame(
  binding: PublicationWarmStreamBinding,
  frameBytes: Uint8Array,
): PublicationFrameAttachment {
  return {
    kind: "publication.warmFrame",
    attachmentVersion: PUBLICATION_TRANSPORT_ATTACHMENT_VERSION,
    streamKey: binding.streamKey,
    subscriptionId: binding.ack.subscriptionId,
    authorityEpoch: binding.ack.authorityEpoch,
    contractKey: binding.ack.contractKey,
    projectionInstanceKey: binding.ack.projectionInstanceKey,
    lane: "warm",
    frameBytes,
  };
}
