import { describe, expect, it } from "vitest";
import { RendererPublicationDelivery, type RoutedWarmPublication } from "../src/boundedDelivery.js";

describe("renderer publication delivery", () => {
  it("keeps one in-flight and one replaceable pending latest publication", () => {
    const delivery = new RendererPublicationDelivery();

    expect(delivery.offer(publication("0000000000000001"))).toMatchObject({ action: "send" });
    expect(delivery.offer(publication("0000000000000002"))).toEqual({ action: "held" });
    expect(delivery.offer(publication("0000000000000003"))).toEqual({ action: "replaced" });

    expect(delivery.metrics()).toEqual({
      inFlightCount: 1,
      pendingCount: 1,
      maxInFlightCount: 1,
      maxPendingCount: 1,
      downstreamCoalescedPublicationCount: 1,
      latestDeliveredPublicationSequence: "0000000000000001",
    });

    const acknowledged = delivery.acknowledge({
      subscriptionId: "subscription-1",
      authorityEpoch: "7",
      publicationSequence: "0000000000000001",
    });
    expect(acknowledged).toMatchObject({
      ok: true,
      nextPublication: { publicationSequence: "0000000000000003" },
    });
    expect(delivery.metrics().latestDeliveredPublicationSequence).toBe("0000000000000003");
  });

  it("does not release capacity for stale acknowledgements", () => {
    const delivery = new RendererPublicationDelivery();
    delivery.offer(publication("0000000000000001"));
    delivery.offer(publication("0000000000000002"));

    expect(
      delivery.acknowledge({
        subscriptionId: "old-subscription",
        authorityEpoch: "7",
        publicationSequence: "0000000000000001",
      }),
    ).toEqual({ ok: false, reason: "stalePublicationIdentity" });
    expect(
      delivery.acknowledge({
        subscriptionId: "subscription-1",
        authorityEpoch: "6",
        publicationSequence: "0000000000000001",
      }),
    ).toEqual({ ok: false, reason: "stalePublicationIdentity" });
    expect(
      delivery.acknowledge({
        subscriptionId: "subscription-1",
        authorityEpoch: "7",
        publicationSequence: "0000000000000002",
      }),
    ).toEqual({ ok: false, reason: "stalePublicationIdentity" });
    expect(delivery.metrics()).toMatchObject({ inFlightCount: 1, pendingCount: 1 });
  });

  it("releases all pending state on close", () => {
    const delivery = new RendererPublicationDelivery();
    delivery.offer(publication("0000000000000001"));
    delivery.offer(publication("0000000000000002"));

    delivery.close();

    expect(delivery.metrics()).toMatchObject({ inFlightCount: 0, pendingCount: 0 });
  });
});

function publication(publicationSequence: string): RoutedWarmPublication {
  return {
    kind: "publication",
    attachment: {
      kind: "publication.warmFrame",
      attachmentVersion: 1,
      streamKey: "deck-runtime-v0.warm",
      subscriptionId: "subscription-1",
      authorityEpoch: "7",
      contractKey: "fixture.deckRuntime",
      projectionInstanceKey: "deck-runtime-v0.instance",
      lane: "warm",
    },
    frameBytes: new Uint8Array([1]),
    publicationSequence,
    upstreamCoalescedPublicationCount: 0,
    downstreamCoalescedPublicationCount: 0,
  };
}
