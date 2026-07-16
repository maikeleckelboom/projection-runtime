import type { SubscribePublicationAck } from "@exclave/publication";

type PendingSubscribe = {
  readonly requestKey: string;
  readonly authorityEpoch: string;
  cancelled: boolean;
};

type PublicationBinding =
  | { readonly kind: "active"; readonly ack: SubscribePublicationAck }
  | { readonly kind: "retired"; readonly ack: SubscribePublicationAck }
  | { readonly kind: "unknown" };

export class PreloadSubscriptionIntent {
  private requested = false;

  request(): void {
    this.requested = true;
  }

  cancel(): void {
    this.requested = false;
  }

  consume(input: {
    readonly portConnected: boolean;
    readonly authorityBindable: boolean;
    readonly subscriptionOccupied: boolean;
  }): "none" | "wait" | "satisfied" | "start" {
    if (!this.requested) return "none";
    if (input.subscriptionOccupied) {
      this.requested = false;
      return "satisfied";
    }
    if (!input.portConnected || !input.authorityBindable) return "wait";
    this.requested = false;
    return "start";
  }
}

export class PreloadSubscriptionState {
  private pendingSubscribe: PendingSubscribe | null = null;
  private activeAck: SubscribePublicationAck | null = null;
  private readonly retiredAcks = new Map<string, SubscribePublicationAck>();
  private readonly pendingUnsubscribes = new Map<string, SubscribePublicationAck>();

  get currentAck(): SubscribePublicationAck | null {
    return this.activeAck;
  }

  get pendingSubscribeRequestKey(): string | null {
    return this.pendingSubscribe?.requestKey ?? null;
  }

  beginSubscribe(requestKey: string, authorityEpoch: string): "send" | "resumed" {
    if (this.activeAck !== null) throw new Error("an active preload subscription already exists");
    const pending = this.pendingSubscribe;
    if (pending !== null) {
      if (pending.authorityEpoch !== authorityEpoch) {
        throw new Error("a pending preload subscription belongs to another authority epoch");
      }
      if (!pending.cancelled) throw new Error("a preload subscription is already pending");
      pending.cancelled = false;
      return "resumed";
    }
    this.pendingSubscribe = { requestKey, authorityEpoch, cancelled: false };
    return "send";
  }

  cancelPendingSubscribe(): boolean {
    if (this.pendingSubscribe === null) return false;
    this.pendingSubscribe.cancelled = true;
    return true;
  }

  completeSubscribeFailure(requestKey: string): { readonly cancelled: boolean } {
    const pending = this.requirePendingSubscribe(requestKey);
    this.pendingSubscribe = null;
    return { cancelled: pending.cancelled };
  }

  completeSubscribeSuccess(
    requestKey: string,
    ack: SubscribePublicationAck,
  ): { readonly kind: "active" | "cleanup"; readonly ack: SubscribePublicationAck } {
    const pending = this.requirePendingSubscribe(requestKey);
    if (ack.authorityEpoch.toString(10) !== pending.authorityEpoch) {
      throw new Error("subscribe acknowledgement authority epoch does not match its request");
    }
    this.pendingSubscribe = null;
    if (pending.cancelled) {
      this.retire(ack);
      return { kind: "cleanup", ack };
    }
    this.activeAck = ack;
    return { kind: "active", ack };
  }

  closeActive(): SubscribePublicationAck | null {
    const ack = this.activeAck;
    this.activeAck = null;
    if (ack !== null) this.retire(ack);
    return ack;
  }

  trackUnsubscribe(requestKey: string, ack: SubscribePublicationAck): void {
    if (this.pendingUnsubscribes.has(requestKey)) {
      throw new Error(`duplicate preload unsubscribe request ${requestKey}`);
    }
    if (
      !this.retiredAcks.has(subscriptionKey(ack.authorityEpoch.toString(10), ack.subscriptionId))
    ) {
      throw new Error("unsubscribe must target a retired preload subscription");
    }
    this.pendingUnsubscribes.set(requestKey, ack);
  }

  completeUnsubscribe(requestKey: string, ok: boolean): SubscribePublicationAck {
    const ack = this.pendingUnsubscribes.get(requestKey);
    if (ack === undefined) throw new Error(`uncorrelated preload unsubscribe result ${requestKey}`);
    this.pendingUnsubscribes.delete(requestKey);
    if (!ok) throw new Error(`host rejected preload unsubscribe ${requestKey}`);
    this.retiredAcks.delete(subscriptionKey(ack.authorityEpoch.toString(10), ack.subscriptionId));
    return ack;
  }

  publicationBinding(authorityEpoch: string, subscriptionId: string): PublicationBinding {
    const key = subscriptionKey(authorityEpoch, subscriptionId);
    if (
      this.activeAck !== null &&
      subscriptionKey(this.activeAck.authorityEpoch.toString(10), this.activeAck.subscriptionId) ===
        key
    ) {
      return { kind: "active", ack: this.activeAck };
    }
    const retired = this.retiredAcks.get(key);
    return retired === undefined ? { kind: "unknown" } : { kind: "retired", ack: retired };
  }

  invalidateAuthority(authorityEpoch: string): void {
    if (this.activeAck?.authorityEpoch.toString(10) === authorityEpoch) this.activeAck = null;
    if (this.pendingSubscribe?.authorityEpoch === authorityEpoch) this.pendingSubscribe = null;
    for (const [key, ack] of this.retiredAcks) {
      if (ack.authorityEpoch.toString(10) === authorityEpoch) this.retiredAcks.delete(key);
    }
    for (const [requestKey, ack] of this.pendingUnsubscribes) {
      if (ack.authorityEpoch.toString(10) === authorityEpoch) {
        this.pendingUnsubscribes.delete(requestKey);
      }
    }
  }

  private requirePendingSubscribe(requestKey: string): PendingSubscribe {
    const pending = this.pendingSubscribe;
    if (pending === null || pending.requestKey !== requestKey) {
      throw new Error(`uncorrelated preload subscribe result ${requestKey}`);
    }
    return pending;
  }

  private retire(ack: SubscribePublicationAck): void {
    const key = subscriptionKey(ack.authorityEpoch.toString(10), ack.subscriptionId);
    if (this.retiredAcks.has(key)) {
      throw new Error(`duplicate retired preload subscription ${ack.subscriptionId}`);
    }
    this.retiredAcks.set(key, ack);
  }
}

function subscriptionKey(authorityEpoch: string, subscriptionId: string): string {
  return `${authorityEpoch}\u0000${subscriptionId}`;
}
