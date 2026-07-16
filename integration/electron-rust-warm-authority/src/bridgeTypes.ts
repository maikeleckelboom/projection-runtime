import type { DeckRuntimeWarmSnapshot } from "./contract.js";

export type AuthorityProcessState = "starting" | "ready" | "unavailable";

export type RuntimeSubscriptionState =
  | "none"
  | "subscribing"
  | "waitingForBaseline"
  | "live"
  | "stale"
  | "failed"
  | "closed";

export type TransportDiagnostics = {
  readonly upstreamCoalescedPublicationCount: number;
  readonly downstreamCoalescedPublicationCount: number;
  readonly skippedPublicationCount: number;
  readonly maxUpstreamInFlightCount: number;
  readonly maxUpstreamPendingCount: number;
  readonly maxDownstreamInFlightCount: number;
  readonly maxDownstreamPendingCount: number;
  readonly latestDeliveredPublicationSequence: string | null;
};

export type AuthorityClientState = {
  readonly processState: AuthorityProcessState;
  readonly authorityEpoch: string | null;
  readonly subscriptionState: RuntimeSubscriptionState;
  readonly lastFailure: string | null;
  readonly diagnostics: TransportDiagnostics;
};

export type DeckRuntimePublication = {
  readonly authorityEpoch: string;
  readonly subscriptionId: string;
  readonly contractKey: string;
  readonly projectionInstanceKey: string;
  readonly baselineEpoch: number;
  readonly continuityGeneration: number;
  readonly publicationSequence: string;
  readonly skippedPublicationCount: number;
  readonly snapshot: DeckRuntimeWarmSnapshot;
};

export type ControlResult =
  | {
      readonly ok: true;
      readonly authorityEpoch: string;
      readonly tempoRatio: number;
    }
  | {
      readonly ok: false;
      readonly code: string;
      readonly message: string;
    };

export type AutomatedProofSummary = {
  readonly controlTempoRatio: number;
  readonly reloadBeforeSamplePosition: string;
  readonly reloadAfterSamplePosition: string;
  readonly reloadBeforePublicationSequence: string;
  readonly reloadAfterPublicationSequence: string;
  readonly initialAuthorityEpoch: string;
  readonly replacementAuthorityEpoch: string;
  readonly finalPublicationSequence: string;
};

export interface ExclaveDeckClient {
  getAuthorityState(): AuthorityClientState;
  setTempoRatio(value: number): Promise<ControlResult>;
  subscribeAuthorityState(listener: (state: AuthorityClientState) => void): () => void;
  subscribeRuntime(listener: (publication: DeckRuntimePublication) => void): () => void;
  readonly proof: {
    setPublicationFlowPaused(paused: boolean): Promise<void>;
    restartAuthority(): Promise<void>;
    recordReloadCheckpoint(
      phase: "before" | "after",
      samplePosition: string,
      publicationSequence: string,
    ): Promise<void>;
    completeAutomatedProof(summary: AutomatedProofSummary): Promise<void>;
  };
}

declare global {
  interface Window {
    readonly exclaveDeck: ExclaveDeckClient;
  }
}
