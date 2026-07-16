import type { AutomatedProofSummary, TransportDiagnostics } from "./bridgeTypes.js";

export type ReloadCheckpoint = {
  readonly phase: "before" | "after";
  readonly samplePosition: string;
  readonly publicationSequence: string;
  readonly authorityEpoch: string;
  readonly authorityPid: number;
  readonly clientId: number;
  readonly subscriptionId: string | null;
};

export type AutomatedProofReport = {
  readonly ok: true;
  readonly authorityEpochs: readonly [string, string];
  readonly authorityPids: readonly [number, number];
  readonly replacementReadyToExplicitSubscribeMs: number;
  readonly controlTempoRatio: number;
  readonly startupOrderingProved: true;
  readonly preReadySubscriptionRejected: true;
  readonly staleEpochControlRejected: true;
  readonly subscriptions: {
    readonly initialBaselineEstablished: true;
    readonly replacementRebased: true;
    readonly reloadBaselineEstablished: true;
    readonly initialContinuityGeneration: number;
    readonly replacementContinuityGeneration: number;
  };
  readonly reload: {
    readonly authoritySurvived: true;
    readonly rendererClientReplaced: true;
    readonly oldSubscriptionClosed: true;
    readonly samplePositionAdvanced: true;
    readonly publicationSequenceAdvanced: true;
  };
  readonly diagnostics: TransportDiagnostics;
};

type ReadyAuthority = {
  readonly authorityEpoch: string;
  readonly authorityPid: number;
  readonly readyAtMs: number;
};

type SuccessfulControl = {
  readonly authorityEpoch: string;
  readonly tempoRatio: number;
};

type ObservedSubscription = {
  readonly authorityEpoch: string;
  readonly subscriptionId: string;
  readonly baselineEpoch: number;
  readonly continuityGeneration: number;
};

const MINIMUM_NO_AUTO_RESUBSCRIBE_WINDOW_MS = 150;

export class AutomatedProofAudit {
  private readonly startingEpochs: string[] = [];
  private readonly readyAuthorities: ReadyAuthority[] = [];
  private readonly subscriptions: ObservedSubscription[] = [];
  private readonly closedSubscriptions = new Set<string>();
  private restartRequestCount = 0;
  private successfulControl: SuccessfulControl | null = null;
  private beforeReload: ReloadCheckpoint | null = null;
  private afterReload: ReloadCheckpoint | null = null;
  private firstReplacementSubscribeAtMs: number | null = null;
  private preReadyRejectedAuthorityEpoch: string | null = null;
  private staleEpochControlRejection: {
    readonly staleAuthorityEpoch: string;
    readonly currentAuthorityEpoch: string;
  } | null = null;

  recordAuthorityStarting(authorityEpoch: string): void {
    if (
      this.startingEpochs.includes(authorityEpoch) ||
      this.readyAuthorities.some((authority) => authority.authorityEpoch === authorityEpoch)
    ) {
      throw new Error(`authorityStarting reused epoch ${authorityEpoch}`);
    }
    this.startingEpochs.push(authorityEpoch);
  }

  recordAuthorityReady(authorityEpoch: string, authorityPid: number, nowMs = Date.now()): void {
    if (this.startingEpochs[this.readyAuthorities.length] !== authorityEpoch) {
      throw new Error(
        `authorityReady epoch ${authorityEpoch} was not preceded by authorityStarting`,
      );
    }
    const previous = this.readyAuthorities.at(-1);
    if (previous?.authorityEpoch === authorityEpoch) {
      throw new Error(`authorityReady repeated epoch ${authorityEpoch}`);
    }
    if (this.readyAuthorities.some((authority) => authority.authorityEpoch === authorityEpoch)) {
      throw new Error(`authority epoch ${authorityEpoch} was reused`);
    }
    this.readyAuthorities.push({ authorityEpoch, authorityPid, readyAtMs: nowMs });
  }

  recordRestartRequest(): void {
    this.restartRequestCount += 1;
  }

  recordSubscribeRequest(authorityEpoch: string, nowMs = Date.now()): void {
    const replacement = this.readyAuthorities[1];
    if (
      replacement !== undefined &&
      replacement.authorityEpoch === authorityEpoch &&
      this.firstReplacementSubscribeAtMs === null
    ) {
      this.firstReplacementSubscribeAtMs = nowMs;
    }
  }

  recordSuccessfulControl(authorityEpoch: string, tempoRatio: number): void {
    this.successfulControl = { authorityEpoch, tempoRatio };
  }

  recordStaleEpochControlRejected(
    staleAuthorityEpoch: string,
    currentAuthorityEpoch: string,
  ): void {
    this.staleEpochControlRejection = { staleAuthorityEpoch, currentAuthorityEpoch };
  }

  recordSubscription(subscription: ObservedSubscription): void {
    if (
      this.subscriptions.some(
        (observed) =>
          observed.authorityEpoch === subscription.authorityEpoch &&
          observed.subscriptionId === subscription.subscriptionId,
      )
    ) {
      throw new Error(`subscription identity ${subscription.subscriptionId} was reused`);
    }
    this.subscriptions.push(subscription);
  }

  recordPreReadySubscriptionRejected(authorityEpoch: string): void {
    if (this.preReadyRejectedAuthorityEpoch !== null) {
      throw new Error("pre-ready subscription rejection was repeated");
    }
    this.preReadyRejectedAuthorityEpoch = authorityEpoch;
  }

  recordReloadCheckpoint(checkpoint: ReloadCheckpoint): void {
    if (checkpoint.phase === "before") {
      if (this.beforeReload !== null) throw new Error("before-reload checkpoint was repeated");
      this.beforeReload = checkpoint;
      return;
    }
    if (this.afterReload !== null) throw new Error("after-reload checkpoint was repeated");
    this.afterReload = checkpoint;
  }

  recordClientClosed(subscriptionId: string | null): void {
    if (subscriptionId !== null) this.closedSubscriptions.add(subscriptionId);
  }

  complete(
    summary: AutomatedProofSummary,
    diagnostics: TransportDiagnostics,
  ): AutomatedProofReport {
    if (this.readyAuthorities.length !== 2) {
      throw new Error(
        `proof requires exactly two ready authority epochs, observed ${this.readyAuthorities.length}`,
      );
    }
    const initial = this.readyAuthorities[0];
    const replacement = this.readyAuthorities[1];
    if (initial === undefined || replacement === undefined) {
      throw new Error("proof authority records are incomplete");
    }
    if (this.restartRequestCount !== 1) {
      throw new Error(
        `proof requires one explicit authority restart, observed ${this.restartRequestCount}`,
      );
    }
    if (summary.initialAuthorityEpoch !== initial.authorityEpoch) {
      throw new Error("proof summary initial authority epoch does not match host observation");
    }
    if (summary.replacementAuthorityEpoch !== replacement.authorityEpoch) {
      throw new Error("proof summary replacement authority epoch does not match host observation");
    }
    if (initial.authorityEpoch === replacement.authorityEpoch) {
      throw new Error("replacement authority reused the initial epoch");
    }
    if (
      this.startingEpochs.length !== 2 ||
      this.startingEpochs[0] !== initial.authorityEpoch ||
      this.startingEpochs[1] !== replacement.authorityEpoch
    ) {
      throw new Error("authority starting/ready lifecycle order was not proved for both processes");
    }
    if (this.preReadyRejectedAuthorityEpoch !== initial.authorityEpoch) {
      throw new Error("initial authority did not reject a real pre-ready subscription");
    }

    const staleControl = this.staleEpochControlRejection;
    if (
      staleControl === null ||
      staleControl.staleAuthorityEpoch !== initial.authorityEpoch ||
      staleControl.currentAuthorityEpoch !== replacement.authorityEpoch
    ) {
      throw new Error("replacement authority did not reject an old-epoch control request");
    }

    const initialSubscriptions = this.subscriptions.filter(
      (subscription) => subscription.authorityEpoch === initial.authorityEpoch,
    );
    const replacementSubscriptions = this.subscriptions.filter(
      (subscription) => subscription.authorityEpoch === replacement.authorityEpoch,
    );
    if (initialSubscriptions.length !== 1) {
      throw new Error("initial authority did not establish exactly one baseline subscription");
    }
    if (replacementSubscriptions.length !== 2) {
      throw new Error(
        "replacement authority did not establish explicit pre- and post-reload baselines",
      );
    }
    const initialSubscription = initialSubscriptions[0];
    const replacementBeforeReload = replacementSubscriptions[0];
    const replacementAfterReload = replacementSubscriptions[1];
    if (
      initialSubscription === undefined ||
      replacementBeforeReload === undefined ||
      replacementAfterReload === undefined
    ) {
      throw new Error("subscription continuity evidence was incomplete");
    }
    for (const subscription of this.subscriptions) {
      if (subscription.baselineEpoch < 1 || subscription.continuityGeneration < 1) {
        throw new Error("subscription acknowledgement did not establish baseline continuity");
      }
      if (subscription.baselineEpoch !== initialSubscription.baselineEpoch) {
        throw new Error("same-domain authority restart unexpectedly replaced the baseline epoch");
      }
    }
    if (
      replacementBeforeReload.continuityGeneration !==
      initialSubscription.continuityGeneration + 1
    ) {
      throw new Error("replacement authority did not increment continuity generation");
    }
    if (
      replacementAfterReload.continuityGeneration !== replacementBeforeReload.continuityGeneration
    ) {
      throw new Error("renderer reload changed continuity generation within one authority process");
    }

    const replacementSubscribeAt = this.firstReplacementSubscribeAtMs;
    if (replacementSubscribeAt === null) {
      throw new Error("replacement authority was never explicitly subscribed");
    }
    const replacementReadyToExplicitSubscribeMs = replacementSubscribeAt - replacement.readyAtMs;
    if (replacementReadyToExplicitSubscribeMs < MINIMUM_NO_AUTO_RESUBSCRIBE_WINDOW_MS) {
      throw new Error(
        `replacement subscription arrived after ${replacementReadyToExplicitSubscribeMs} ms; no-auto-resubscribe proof requires at least ${MINIMUM_NO_AUTO_RESUBSCRIBE_WINDOW_MS} ms`,
      );
    }

    const control = this.successfulControl;
    if (control === null) throw new Error("typed tempo control did not succeed");
    if (
      control.authorityEpoch !== initial.authorityEpoch ||
      control.tempoRatio !== summary.controlTempoRatio
    ) {
      throw new Error("typed tempo control result does not match the proof summary");
    }

    const before = this.beforeReload;
    const after = this.afterReload;
    if (before === null || after === null)
      throw new Error("renderer reload checkpoints are incomplete");
    assertCheckpointMatchesSummary(before, summary);
    assertCheckpointMatchesSummary(after, summary);
    if (
      before.authorityEpoch !== replacement.authorityEpoch ||
      after.authorityEpoch !== replacement.authorityEpoch
    ) {
      throw new Error("authority epoch changed across renderer reload");
    }
    if (before.authorityPid !== after.authorityPid) {
      throw new Error("authority process changed across renderer reload");
    }
    if (before.clientId === after.clientId) {
      throw new Error("renderer client identity did not change across reload");
    }
    if (before.subscriptionId === null || !this.closedSubscriptions.has(before.subscriptionId)) {
      throw new Error("old renderer subscription was not closed during reload");
    }
    if (BigInt(after.samplePosition) <= BigInt(before.samplePosition)) {
      throw new Error("authoritative sample position did not advance across renderer reload");
    }
    if (decodeSequence(after.publicationSequence) <= decodeSequence(before.publicationSequence)) {
      throw new Error("publication sequence did not advance across renderer reload");
    }
    if (
      decodeSequence(summary.finalPublicationSequence) <= decodeSequence(after.publicationSequence)
    ) {
      throw new Error("final explicit resubscription did not advance beyond the reload checkpoint");
    }

    assertBoundedDiagnostics(diagnostics);

    return {
      ok: true,
      authorityEpochs: [initial.authorityEpoch, replacement.authorityEpoch],
      authorityPids: [initial.authorityPid, replacement.authorityPid],
      replacementReadyToExplicitSubscribeMs,
      controlTempoRatio: control.tempoRatio,
      startupOrderingProved: true,
      preReadySubscriptionRejected: true,
      staleEpochControlRejected: true,
      subscriptions: {
        initialBaselineEstablished: true,
        replacementRebased: true,
        reloadBaselineEstablished: true,
        initialContinuityGeneration: initialSubscription.continuityGeneration,
        replacementContinuityGeneration: replacementBeforeReload.continuityGeneration,
      },
      reload: {
        authoritySurvived: true,
        rendererClientReplaced: true,
        oldSubscriptionClosed: true,
        samplePositionAdvanced: true,
        publicationSequenceAdvanced: true,
      },
      diagnostics,
    };
  }
}

function assertCheckpointMatchesSummary(
  checkpoint: ReloadCheckpoint,
  summary: AutomatedProofSummary,
): void {
  const expectedSamplePosition =
    checkpoint.phase === "before"
      ? summary.reloadBeforeSamplePosition
      : summary.reloadAfterSamplePosition;
  const expectedPublicationSequence =
    checkpoint.phase === "before"
      ? summary.reloadBeforePublicationSequence
      : summary.reloadAfterPublicationSequence;
  if (
    checkpoint.samplePosition !== expectedSamplePosition ||
    checkpoint.publicationSequence !== expectedPublicationSequence
  ) {
    throw new Error(`${checkpoint.phase}-reload checkpoint does not match renderer summary`);
  }
}

function assertBoundedDiagnostics(diagnostics: TransportDiagnostics): void {
  if (
    diagnostics.maxUpstreamInFlightCount !== 1 ||
    diagnostics.maxUpstreamPendingCount !== 1 ||
    diagnostics.maxDownstreamInFlightCount !== 1 ||
    diagnostics.maxDownstreamPendingCount !== 1
  ) {
    throw new Error("transport did not prove the one-in-flight plus one-pending bound");
  }
  if (diagnostics.upstreamCoalescedPublicationCount < 1) {
    throw new Error("Rust authority did not prove upstream pending replacement");
  }
  if (diagnostics.downstreamCoalescedPublicationCount < 1) {
    throw new Error("Electron broker did not prove downstream pending replacement");
  }
  if (diagnostics.skippedPublicationCount < 1) {
    throw new Error("renderer did not observe a sequence gap from replaceable delivery");
  }
  if (diagnostics.latestDeliveredPublicationSequence === null) {
    throw new Error("transport did not retain a latest delivered publication sequence");
  }
}

function decodeSequence(value: string): bigint {
  return BigInt(`0x${value}`);
}
