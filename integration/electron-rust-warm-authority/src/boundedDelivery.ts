import type { HostToPreloadMessage } from "./portProtocol.js";

export type RoutedWarmPublication = Extract<
  HostToPreloadMessage,
  { readonly kind: "publication" }
> & {
  readonly publicationSequence: string;
};

export type PublicationAppliedIdentity = {
  readonly subscriptionId: string;
  readonly authorityEpoch: string;
  readonly publicationSequence: string;
};

export type RendererDeliveryMetrics = {
  readonly inFlightCount: 0 | 1;
  readonly pendingCount: 0 | 1;
  readonly maxInFlightCount: 0 | 1;
  readonly maxPendingCount: 0 | 1;
  readonly downstreamCoalescedPublicationCount: number;
  readonly latestDeliveredPublicationSequence: string | null;
};

export type RendererOfferResult =
  | { readonly action: "send"; readonly publication: RoutedWarmPublication }
  | { readonly action: "held" }
  | { readonly action: "replaced" };

export type RendererAckResult =
  | {
      readonly ok: true;
      readonly nextPublication: RoutedWarmPublication | null;
    }
  | {
      readonly ok: false;
      readonly reason: "noInFlightPublication" | "stalePublicationIdentity";
    };

export class RendererPublicationDelivery {
  private inFlight: RoutedWarmPublication | null = null;
  private pendingLatest: RoutedWarmPublication | null = null;
  private maxInFlightCount: 0 | 1 = 0;
  private maxPendingCount: 0 | 1 = 0;
  private downstreamCoalescedPublicationCount = 0;
  private latestDeliveredPublicationSequence: string | null = null;

  offer(publication: RoutedWarmPublication): RendererOfferResult {
    if (this.inFlight === null) {
      this.inFlight = publication;
      this.maxInFlightCount = 1;
      this.latestDeliveredPublicationSequence = publication.publicationSequence;
      return { action: "send", publication };
    }

    if (this.pendingLatest === null) {
      this.pendingLatest = publication;
      this.maxPendingCount = 1;
      return { action: "held" };
    }

    this.pendingLatest = publication;
    this.downstreamCoalescedPublicationCount += 1;
    return { action: "replaced" };
  }

  acknowledge(identity: PublicationAppliedIdentity): RendererAckResult {
    if (this.inFlight === null) {
      return { ok: false, reason: "noInFlightPublication" };
    }

    if (!matchesIdentity(this.inFlight, identity)) {
      return { ok: false, reason: "stalePublicationIdentity" };
    }

    const nextPublication = this.pendingLatest;
    this.pendingLatest = null;
    this.inFlight = nextPublication;
    if (nextPublication !== null) {
      this.latestDeliveredPublicationSequence = nextPublication.publicationSequence;
    }
    return { ok: true, nextPublication };
  }

  close(): void {
    this.inFlight = null;
    this.pendingLatest = null;
  }

  metrics(): RendererDeliveryMetrics {
    return {
      inFlightCount: this.inFlight === null ? 0 : 1,
      pendingCount: this.pendingLatest === null ? 0 : 1,
      maxInFlightCount: this.maxInFlightCount,
      maxPendingCount: this.maxPendingCount,
      downstreamCoalescedPublicationCount: this.downstreamCoalescedPublicationCount,
      latestDeliveredPublicationSequence: this.latestDeliveredPublicationSequence,
    };
  }
}

function matchesIdentity(
  publication: RoutedWarmPublication,
  identity: PublicationAppliedIdentity,
): boolean {
  return (
    publication.attachment.subscriptionId === identity.subscriptionId &&
    publication.attachment.authorityEpoch === identity.authorityEpoch &&
    publication.publicationSequence === identity.publicationSequence
  );
}
