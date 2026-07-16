import {
  createSubscribePublicationAck,
  createWaitingPublicationConsumerSubscription,
  invalidatePublicationConsumerSubscription,
  type SubscribePublicationAck,
} from "@exclave/publication";
import {
  encodeWarmLaneFrame,
  encodeWarmSnapshotPayload,
  type WarmSnapshotObject,
} from "@exclave/warm";
import { describe, expect, it } from "vitest";
import {
  DECK_RUNTIME_CONTRACT_KEY,
  DECK_RUNTIME_SEMANTIC_VERSION,
  DECK_RUNTIME_WARM_CODEC_VERSION,
  deckRuntimeWarmManifest,
  PROJECTION_INSTANCE_KEY,
  WARM_STREAM_KEY,
} from "../src/contract.js";
import type { HostToPreloadMessage } from "../src/portProtocol.js";
import {
  acknowledgeThenNotify,
  applyDeckRuntimePublication,
  performBeforeNotification,
  validateRetiredDeckRuntimePublication,
} from "../src/preloadPublication.js";

describe("isolated preload warm delivery", () => {
  it("acknowledges an applied publication before invoking reentrant renderer callbacks", () => {
    const order: string[] = [];
    acknowledgeThenNotify({
      acknowledge: () => order.push("publicationApplied"),
      listeners: [() => order.push("rendererDisposedSubscription")],
      notify: (listener, value) => listener(value),
      value: undefined,
    });

    expect(order).toEqual(["publicationApplied", "rendererDisposedSubscription"]);
  });

  it("posts unsubscribe before a closed-state callback can reentrantly resubscribe", () => {
    const order: string[] = [];

    performBeforeNotification(
      () => order.push("unsubscribeRuntime"),
      () => order.push("reentrantSubscribeRuntime"),
    );

    expect(order).toEqual(["unsubscribeRuntime", "reentrantSubscribeRuntime"]);
  });

  it("validates a generated warm baseline and rejects corrupted frame bytes", () => {
    const ack = subscribeAck("101", "subscription-1", 1);
    const consumer = createWaitingPublicationConsumerSubscription<DeckSnapshot>(ack);
    const message = publicationMessage(ack, 7n, 48_000n);
    const applied = applyDeckRuntimePublication({
      consumer,
      ack,
      message,
      previousPublicationSequence: null,
      skippedPublicationCount: 0,
    });

    expect(applied.publication.publicationSequence).toBe("0000000000000007");
    expect(applied.publication.snapshot.samplePosition).toBe(48_000n);

    const corrupted = structuredClone(message);
    const lastByteIndex = corrupted.frameBytes.byteLength - 1;
    corrupted.frameBytes[lastByteIndex] = (corrupted.frameBytes[lastByteIndex] ?? 0) ^ 0xff;
    expect(() =>
      applyDeckRuntimePublication({
        consumer,
        ack,
        message: corrupted,
        previousPublicationSequence: null,
        skippedPublicationCount: 0,
      }),
    ).toThrow();
  });

  it("marks an exited authority stale and explicitly rebases on a replacement ack", () => {
    const initialAck = subscribeAck("101", "subscription-initial", 1);
    const initial = applyDeckRuntimePublication({
      consumer: createWaitingPublicationConsumerSubscription<DeckSnapshot>(initialAck),
      ack: initialAck,
      message: publicationMessage(initialAck, 41n, 96_000n),
      previousPublicationSequence: null,
      skippedPublicationCount: 0,
    });
    const stale = invalidatePublicationConsumerSubscription(initial.consumer, {
      kind: "authorityUnavailable",
      replacedAuthorityEpoch: 101n,
      state: "stopped",
    });
    expect(stale.kind).toBe("stale");

    const replacementAck = subscribeAck("202", "subscription-replacement", 2);
    const replacement = applyDeckRuntimePublication({
      consumer: createWaitingPublicationConsumerSubscription<DeckSnapshot>(replacementAck),
      ack: replacementAck,
      message: publicationMessage(replacementAck, 1n, 144_000n),
      previousPublicationSequence: null,
      skippedPublicationCount: 0,
    });
    expect(replacement.publication.authorityEpoch).toBe("202");
    expect(replacement.publication.continuityGeneration).toBe(2);
    expect(replacement.publication.publicationSequence).toBe("0000000000000001");
  });

  it("validates and discards a queued publication for a retired subscription", () => {
    const ack = subscribeAck("101", "subscription-retired", 1);
    expect(() =>
      validateRetiredDeckRuntimePublication(ack, publicationMessage(ack, 9n, 192_000n)),
    ).not.toThrow();
  });
});

type DeckSnapshot = {
  readonly beatPhase01: number;
  readonly level: number;
  readonly loopActive: boolean;
  readonly mediaTimeSeconds: number;
  readonly samplePosition: bigint;
  readonly stemGains: readonly number[];
  readonly tempoRatio: number;
  readonly transportState: "stopped" | "cueing" | "playing" | "paused";
};

function subscribeAck(
  authorityEpoch: string,
  subscriptionId: string,
  continuityGeneration: number,
): SubscribePublicationAck {
  return createSubscribePublicationAck({
    contractKey: DECK_RUNTIME_CONTRACT_KEY,
    projectionInstanceKey: PROJECTION_INSTANCE_KEY,
    lane: "warm",
    subscriptionId,
    authorityEpoch: BigInt(authorityEpoch),
    semanticVersion: DECK_RUNTIME_SEMANTIC_VERSION,
    laneVersion: DECK_RUNTIME_WARM_CODEC_VERSION,
    baselineEpoch: 1,
    continuityGeneration,
  });
}

function publicationMessage(
  ack: SubscribePublicationAck,
  publicationSequence: bigint,
  samplePosition: bigint,
): Extract<HostToPreloadMessage, { readonly kind: "publication" }> {
  const snapshot: DeckSnapshot = {
    beatPhase01: 0.25,
    level: 0.75,
    loopActive: true,
    mediaTimeSeconds: Number(samplePosition) / 48_000,
    samplePosition,
    stemGains: [0.8, 0.6],
    tempoRatio: 1.25,
    transportState: "playing",
  };
  const encodedPayload = encodeWarmSnapshotPayload(
    deckRuntimeWarmManifest,
    snapshot as unknown as WarmSnapshotObject,
  );
  if (!encodedPayload.ok) throw new Error(encodedPayload.failure.detail);
  const encodedFrame = encodeWarmLaneFrame({
    contractKey: ack.contractKey,
    projectionInstanceKey: ack.projectionInstanceKey,
    semanticVersion: ack.semanticVersion,
    warmCodecVersion: ack.laneVersion,
    baselineEpoch: ack.baselineEpoch,
    continuityGeneration: ack.continuityGeneration,
    publicationSequence,
    payload: encodedPayload.bytes,
  });
  if (!encodedFrame.ok) throw new Error(encodedFrame.failure.detail);
  return {
    kind: "publication",
    attachment: {
      kind: "publication.warmFrame",
      attachmentVersion: 1,
      streamKey: WARM_STREAM_KEY,
      subscriptionId: ack.subscriptionId,
      authorityEpoch: ack.authorityEpoch.toString(10),
      contractKey: ack.contractKey,
      projectionInstanceKey: ack.projectionInstanceKey,
      lane: "warm",
    },
    frameBytes: encodedFrame.bytes,
    upstreamCoalescedPublicationCount: 0,
    downstreamCoalescedPublicationCount: 0,
  };
}
