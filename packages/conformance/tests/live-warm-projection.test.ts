import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { createControlSuccessEnvelope } from "@exclave/control-plane";
import { createHostWarmStreamDescriptor } from "@exclave/host-contract";
import {
  applyWarmFrameToPublicationConsumer,
  createPublicationAuthorityModel,
  createWaitingPublicationConsumerSubscription,
  invalidatePublicationConsumerSubscription,
  type PublicationConsumerState,
  type PublicationSurfaceRecord,
  type SubscribePublicationAck,
  subscribePublication,
} from "@exclave/publication";
import { RESOURCE_PLANE_V1_OPERATION_KEYS } from "@exclave/resource";
import { encodeWarmLaneFrame, WARM_ENVELOPE_VERSION, type WarmLaneFrame } from "@exclave/warm";
import { describe, expect, it } from "vitest";

type FixtureSnapshot = {
  readonly tempo: number;
  readonly playing: boolean;
};

const repoRoot = resolve(fileURLToPath(new URL("../../..", import.meta.url)));
const contractKey = "deck.runtime";
const projectionInstanceKey = "deck.a";
const semanticVersion = 0x0102_0304_0506_0708n;
const laneVersion = 0x1112_1314_1516_1718n;

describe("first live warm projection path conformance", () => {
  it("proves ack, initial warm snapshot, invalidation, rebind, and stale-epoch rejection", () => {
    const starting = createPublicationAuthorityModel({
      session: { state: "starting", authorityEpoch: 1n },
      surfaces: [surface()],
    });
    const startingSubscribe = subscribePublication(starting, request());

    expect(startingSubscribe.result).toEqual({
      ok: false,
      failure: { kind: "authorityNotReady", state: "starting" },
    });

    const ready = createPublicationAuthorityModel({
      session: { state: "ready", authorityEpoch: 1n },
      surfaces: [surface()],
    });
    const firstSubscribe = subscribePublication(ready, request());
    if (!firstSubscribe.result.ok) throw new Error("expected first subscribe ack");

    const firstAck = firstSubscribe.result.ack;
    expect(firstAck.authorityEpoch).toBe(1n);
    expect(Object.keys(firstAck)).not.toEqual(
      expect.arrayContaining(["payload", "body", "bytes", "frame"]),
    );

    const firstWaiting = createWaitingPublicationConsumerSubscription<FixtureSnapshot>(firstAck);
    const firstApplied = applyWarmFrameToPublicationConsumer(
      firstWaiting,
      {
        subscriptionId: firstAck.subscriptionId,
        authorityEpoch: firstAck.authorityEpoch,
        bytes: warmFrameBytes(firstAck, { tempo: 128, playing: true }, 1n),
      },
      decodeSnapshot,
    );

    expect(firstApplied.ok).toBe(true);
    if (!firstApplied.ok) throw new Error("expected first frame to apply");
    if (firstApplied.state.kind !== "live") throw new Error("expected live state");
    expect(firstApplied.state.latestProjectionState).toEqual({ tempo: 128, playing: true });

    const invalidated = invalidateWithReplacement(firstApplied.state);
    expect(invalidated.kind).toBe("stale");

    const oldFrameRejected = applyWarmFrameToPublicationConsumer(
      invalidated,
      {
        subscriptionId: firstAck.subscriptionId,
        authorityEpoch: firstAck.authorityEpoch,
        bytes: warmFrameBytes(firstAck, { tempo: 129, playing: true }, 2n),
      },
      decodeSnapshot,
    );
    expect(oldFrameRejected.ok).toBe(false);
    if (!oldFrameRejected.ok) {
      expect(oldFrameRejected.failure.kind).toBe("subscriptionNotLive");
    }

    const replacement = createPublicationAuthorityModel({
      session: { state: "ready", authorityEpoch: 2n },
      surfaces: [surface({ baselineEpoch: 8, continuityGeneration: 0 })],
      nextSubscriptionOrdinal: firstSubscribe.model.nextSubscriptionOrdinal,
    });
    const rebound = subscribePublication(replacement, request());
    if (!rebound.result.ok) throw new Error("expected rebound subscribe ack");

    const secondAck = rebound.result.ack;
    expect(secondAck.subscriptionId).not.toBe(firstAck.subscriptionId);
    expect(secondAck.authorityEpoch).toBe(2n);

    const secondWaiting = createWaitingPublicationConsumerSubscription<FixtureSnapshot>(secondAck);
    const staleEpochDelivery = applyWarmFrameToPublicationConsumer(
      secondWaiting,
      {
        subscriptionId: secondAck.subscriptionId,
        authorityEpoch: firstAck.authorityEpoch,
        bytes: warmFrameBytes(secondAck, { tempo: 140, playing: true }, 1n),
      },
      decodeSnapshot,
    );
    expect(staleEpochDelivery.ok).toBe(false);
    if (!staleEpochDelivery.ok) {
      expect(staleEpochDelivery.failure).toEqual({
        kind: "sessionMismatch",
        expectedAuthorityEpoch: 2n,
        providedAuthorityEpoch: 1n,
      });
    }

    const secondApplied = applyWarmFrameToPublicationConsumer(
      secondWaiting,
      {
        subscriptionId: secondAck.subscriptionId,
        authorityEpoch: secondAck.authorityEpoch,
        bytes: warmFrameBytes(secondAck, { tempo: 131, playing: false }, 1n),
      },
      decodeSnapshot,
    );
    expect(secondApplied.ok).toBe(true);
    if (!secondApplied.ok) throw new Error("expected rebound frame to apply");
    if (secondApplied.state.kind !== "live") throw new Error("expected rebound live state");
    expect(secondApplied.state.latestProjectionState).toEqual({ tempo: 131, playing: false });
  });

  it("proves control replies, warm frame bytes, resource operations, and host descriptors stay separate", () => {
    const ack = subscribeAck();
    const frameBytes = warmFrameBytes(ack, { tempo: 128, playing: true }, 1n);

    expect(Object.keys(ack)).not.toEqual(
      expect.arrayContaining(["payload", "body", "bytes", "frame"]),
    );
    expect(() =>
      createControlSuccessEnvelope({
        requestKey: "subscribe-publication",
        payload: { warmFrameBytes: frameBytes } as never,
      }),
    ).toThrow();

    const resourceLikePayload = encodeWarmLaneFrame({
      ...warmFrame(ack, { tempo: 128, playing: true }, 1n),
      payload: { body: "resource bytes belong on resource plane" } as never,
    });
    expect(resourceLikePayload.ok).toBe(false);
    if (!resourceLikePayload.ok) {
      expect(resourceLikePayload.failure.reason).toBe("resourceBodyRejected");
    }

    expect([...RESOURCE_PLANE_V1_OPERATION_KEYS]).toEqual([
      "resource.open",
      "resource.readChunk",
      "resource.mapWindow",
      "resource.closeMapping",
      "resource.closeHandle",
    ]);
    expect(publicationSourceText()).not.toContain("@exclave/resource");

    const hostWarm = createHostWarmStreamDescriptor({
      kind: "host.warmStream",
      envelopeVersion: WARM_ENVELOPE_VERSION,
      streamKey: "warm-stream-1",
    });
    expect(Object.keys(hostWarm).sort()).toEqual(["envelopeVersion", "kind", "streamKey"]);
    expect(JSON.stringify(hostWarm)).not.toMatch(/payload|body|bytes|frame/i);
  });
});

function request(): Parameters<typeof subscribePublication>[1] {
  return {
    contractKey,
    projectionInstanceKey,
    lane: "warm",
    expectedSemanticVersion: semanticVersion,
    expectedLaneVersion: laneVersion,
  };
}

function surface(overrides: Partial<PublicationSurfaceRecord> = {}): PublicationSurfaceRecord {
  return {
    contractKey,
    projectionInstanceKey,
    lane: "warm",
    semanticVersion,
    laneVersion,
    baselineEpoch: 7,
    continuityGeneration: 3,
    status: "ready",
    ...overrides,
  };
}

function subscribeAck(): SubscribePublicationAck {
  const result = subscribePublication(
    createPublicationAuthorityModel({
      session: { state: "ready", authorityEpoch: 1n },
      surfaces: [surface()],
    }),
    request(),
  );
  if (!result.result.ok) throw new Error("expected subscribe ack");
  return result.result.ack;
}

function warmFrame(
  ack: SubscribePublicationAck,
  snapshot: FixtureSnapshot,
  publicationSequence: bigint,
): WarmLaneFrame {
  return {
    contractKey: ack.contractKey,
    projectionInstanceKey: ack.projectionInstanceKey,
    semanticVersion: ack.semanticVersion,
    warmCodecVersion: ack.laneVersion,
    baselineEpoch: ack.baselineEpoch,
    continuityGeneration: ack.continuityGeneration,
    publicationSequence,
    payload: encodeSnapshot(snapshot),
  };
}

function warmFrameBytes(
  ack: SubscribePublicationAck,
  snapshot: FixtureSnapshot,
  publicationSequence: bigint,
): Uint8Array {
  const encoded = encodeWarmLaneFrame(warmFrame(ack, snapshot, publicationSequence));
  if (!encoded.ok) throw new Error("expected warm frame encode to succeed");
  return encoded.bytes;
}

function encodeSnapshot(snapshot: FixtureSnapshot): Uint8Array {
  const bytes = new Uint8Array(9);
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  view.setFloat64(0, snapshot.tempo, true);
  bytes[8] = snapshot.playing ? 1 : 0;
  return bytes;
}

function decodeSnapshot(payload: Uint8Array): FixtureSnapshot {
  const view = new DataView(payload.buffer, payload.byteOffset, payload.byteLength);
  return {
    tempo: view.getFloat64(0, true),
    playing: payload[8] === 1,
  };
}

function invalidateWithReplacement<TProjectionState>(
  state: PublicationConsumerState<TProjectionState>,
): PublicationConsumerState<TProjectionState> {
  return invalidatePublicationConsumerSubscription(state, {
    kind: "authorityEpochReplaced",
    replacedAuthorityEpoch: 1n,
    replacingAuthorityEpoch: 2n,
  });
}

function publicationSourceText(): string {
  return [
    "packages/publication/src/index.ts",
    "packages/publication/src/protocol.ts",
    "packages/publication/src/subscription.ts",
  ]
    .map((path) => readFileSync(resolve(repoRoot, path), "utf8"))
    .join("\n");
}
