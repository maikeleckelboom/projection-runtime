import { createSubscribePublicationAck, type SubscribePublicationAck } from "@exclave/publication";
import { describe, expect, it } from "vitest";
import {
  DECK_RUNTIME_CONTRACT_KEY,
  DECK_RUNTIME_SEMANTIC_VERSION,
  DECK_RUNTIME_WARM_CODEC_VERSION,
  PROJECTION_INSTANCE_KEY,
} from "../src/contract.js";
import {
  PreloadSubscriptionIntent,
  PreloadSubscriptionState,
} from "../src/preloadSubscriptionState.js";

describe("isolated preload subscription state", () => {
  it("retains an early renderer intent until both port and authority are bindable", () => {
    const intent = new PreloadSubscriptionIntent();
    intent.request();

    expect(
      intent.consume({
        portConnected: false,
        authorityBindable: false,
        subscriptionOccupied: false,
      }),
    ).toBe("wait");
    expect(
      intent.consume({
        portConnected: true,
        authorityBindable: true,
        subscriptionOccupied: false,
      }),
    ).toBe("start");
    expect(
      intent.consume({
        portConnected: true,
        authorityBindable: true,
        subscriptionOccupied: false,
      }),
    ).toBe("none");
  });

  it("cancels retained intent on authority replacement instead of auto-resubscribing", () => {
    const intent = new PreloadSubscriptionIntent();
    intent.request();
    intent.cancel();

    expect(
      intent.consume({
        portConnected: true,
        authorityBindable: true,
        subscriptionOccupied: false,
      }),
    ).toBe("none");
  });

  it("cleans up a successful subscribe ack after immediate renderer disposal", () => {
    const state = new PreloadSubscriptionState();
    const ack = subscribeAck("101", "subscription-cancelled", 1);

    expect(state.beginSubscribe("subscribe-1", "101")).toBe("send");
    expect(state.cancelPendingSubscribe()).toBe(true);
    expect(state.completeSubscribeSuccess("subscribe-1", ack)).toEqual({
      kind: "cleanup",
      ack,
    });
    expect(state.currentAck).toBeNull();
    expect(state.publicationBinding("101", "subscription-cancelled")).toEqual({
      kind: "retired",
      ack,
    });

    state.trackUnsubscribe("unsubscribe-1", ack);
    expect(state.completeUnsubscribe("unsubscribe-1", true)).toBe(ack);
    expect(state.publicationBinding("101", "subscription-cancelled").kind).toBe("unknown");
  });

  it("revives a cancelled pending subscribe when a new listener arrives before the ack", () => {
    const state = new PreloadSubscriptionState();
    const ack = subscribeAck("101", "subscription-revived", 1);

    expect(state.beginSubscribe("subscribe-1", "101")).toBe("send");
    state.cancelPendingSubscribe();
    expect(state.beginSubscribe("subscribe-1", "101")).toBe("resumed");
    expect(state.completeSubscribeSuccess("subscribe-1", ack)).toEqual({
      kind: "active",
      ack,
    });
    expect(state.currentAck).toBe(ack);
  });

  it("rejects uncorrelated replies and makes old bindings unknown after authority exit", () => {
    const state = new PreloadSubscriptionState();
    const ack = subscribeAck("101", "subscription-old", 1);
    state.beginSubscribe("subscribe-1", "101");
    state.completeSubscribeSuccess("subscribe-1", ack);

    expect(() => state.completeUnsubscribe("unknown", true)).toThrow(
      "uncorrelated preload unsubscribe result",
    );
    state.invalidateAuthority("101");
    expect(state.currentAck).toBeNull();
    expect(state.publicationBinding("101", "subscription-old")).toEqual({ kind: "unknown" });
  });
});

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
