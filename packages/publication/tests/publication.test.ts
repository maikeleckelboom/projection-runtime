import {
  applyWarmFrameToPublicationConsumer,
  createPublicationAuthorityModel,
  createPublicationFrameAttachment,
  createPublicationFrameAttachmentFromAck,
  createPublicationWarmFrameDelivery,
  createWaitingPublicationConsumerSubscription,
  invalidatePublicationConsumerSubscription,
  PUBLICATION_TRANSPORT_ATTACHMENT_VERSION,
  type PublicationConsumerState,
  type PublicationFrameAttachment,
  type PublicationSubscribeFailure,
  type PublicationSubscriptionInvalidatedEvent,
  type PublicationSurfaceReadyEvent,
  type PublicationSurfaceRecord,
  type PublicationTransportAttachmentVersion,
  type PublicationWarmFrameDelivery,
  type SubscribePublicationAck,
  type SubscribePublicationRequest,
  type SubscriptionId,
  subscribePublication,
} from "@exclave/publication";
import { encodeWarmLaneFrame, type WarmLaneFrame } from "@exclave/warm";
import { describe, expect, expectTypeOf, it } from "vitest";

type FixtureSnapshot = {
  readonly tempo: number;
  readonly playing: boolean;
};

const CONTRACT_KEY = "deck.runtime";
const INSTANCE_KEY = "deck.a";
const SEMANTIC_VERSION = 0x0102_0304_0506_0708n;
const WARM_CODEC_VERSION = 0x1112_1314_1516_1718n;

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
): Uint8Array {
  const frame: WarmLaneFrame = {
    contractKey: ack.contractKey,
    projectionInstanceKey: ack.projectionInstanceKey,
    semanticVersion: ack.semanticVersion,
    warmCodecVersion: ack.laneVersion,
    baselineEpoch: ack.baselineEpoch,
    continuityGeneration: ack.continuityGeneration,
    publicationSequence,
    payload: encodeFixtureSnapshot(snapshot),
  };
  const encoded = encodeWarmLaneFrame(frame);
  if (!encoded.ok) throw new Error("expected warm frame encode to succeed");
  return encoded.bytes;
}

function encodeFixtureSnapshot(snapshot: FixtureSnapshot): Uint8Array {
  const bytes = new Uint8Array(9);
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  view.setFloat64(0, snapshot.tempo, true);
  bytes[8] = snapshot.playing ? 1 : 0;
  return bytes;
}

function decodeFixtureSnapshot(payload: Uint8Array): FixtureSnapshot {
  const view = new DataView(payload.buffer, payload.byteOffset, payload.byteLength);
  return {
    tempo: view.getFloat64(0, true),
    playing: payload[8] === 1,
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
