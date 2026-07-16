import { describe, expect, it } from "vitest";
import type { AutomatedProofSummary, TransportDiagnostics } from "../src/bridgeTypes.js";
import { AutomatedProofAudit } from "../src/proofAudit.js";

describe("automated Electron/Rust proof audit", () => {
  it("accepts distinct authority epochs, a replaced renderer, and bounded transport evidence", () => {
    const audit = completeAudit();

    expect(audit.complete(summary, diagnostics)).toMatchObject({
      ok: true,
      authorityEpochs: ["101", "202"],
      authorityPids: [1001, 1002],
      replacementReadyToExplicitSubscribeMs: 300,
      startupOrderingProved: true,
      preReadySubscriptionRejected: true,
      staleEpochControlRejected: true,
      subscriptions: {
        initialContinuityGeneration: 1,
        replacementContinuityGeneration: 2,
      },
      reload: {
        authoritySurvived: true,
        rendererClientReplaced: true,
        oldSubscriptionClosed: true,
      },
    });
  });

  it("rejects authority epoch reuse before a proof can be completed", () => {
    const audit = new AutomatedProofAudit();
    audit.recordAuthorityStarting("101");
    audit.recordAuthorityReady("101", 1001, 1_000);

    expect(() => audit.recordAuthorityStarting("101")).toThrow(/reused epoch/u);
  });

  it("rejects transport observations that never filled and replaced both pending slots", () => {
    const audit = completeAudit();

    expect(() =>
      audit.complete(summary, {
        ...diagnostics,
        upstreamCoalescedPublicationCount: 0,
      }),
    ).toThrow(/upstream pending replacement/u);
  });

  it("requires restart rebase while preserving continuity across renderer reload", () => {
    expect(() => completeAudit([1, 1]).complete(summary, diagnostics)).toThrow(
      /did not increment continuity generation/u,
    );
    expect(() => completeAudit([2, 3]).complete(summary, diagnostics)).toThrow(
      /renderer reload changed continuity generation/u,
    );
  });
});

function completeAudit(
  replacementContinuity: readonly [number, number] = [2, 2],
): AutomatedProofAudit {
  const audit = new AutomatedProofAudit();
  audit.recordAuthorityStarting("101");
  audit.recordPreReadySubscriptionRejected("101");
  audit.recordAuthorityReady("101", 1001, 1_000);
  audit.recordSubscription({
    authorityEpoch: "101",
    subscriptionId: "subscription-initial",
    baselineEpoch: 1,
    continuityGeneration: 1,
  });
  audit.recordSuccessfulControl("101", 1.25);
  audit.recordRestartRequest();
  audit.recordAuthorityStarting("202");
  audit.recordAuthorityReady("202", 1002, 2_000);
  audit.recordStaleEpochControlRejected("101", "202");
  audit.recordSubscribeRequest("202", 2_300);
  audit.recordSubscription({
    authorityEpoch: "202",
    subscriptionId: "subscription-before",
    baselineEpoch: 1,
    continuityGeneration: replacementContinuity[0],
  });
  audit.recordReloadCheckpoint({
    phase: "before",
    samplePosition: "1000",
    publicationSequence: "0000000000000064",
    authorityEpoch: "202",
    authorityPid: 1002,
    clientId: 1,
    subscriptionId: "subscription-before",
  });
  audit.recordClientClosed("subscription-before");
  audit.recordSubscription({
    authorityEpoch: "202",
    subscriptionId: "subscription-after",
    baselineEpoch: 1,
    continuityGeneration: replacementContinuity[1],
  });
  audit.recordReloadCheckpoint({
    phase: "after",
    samplePosition: "2000",
    publicationSequence: "000000000000006e",
    authorityEpoch: "202",
    authorityPid: 1002,
    clientId: 2,
    subscriptionId: "subscription-after",
  });
  return audit;
}

const summary: AutomatedProofSummary = {
  controlTempoRatio: 1.25,
  reloadBeforeSamplePosition: "1000",
  reloadAfterSamplePosition: "2000",
  reloadBeforePublicationSequence: "0000000000000064",
  reloadAfterPublicationSequence: "000000000000006e",
  initialAuthorityEpoch: "101",
  replacementAuthorityEpoch: "202",
  finalPublicationSequence: "0000000000000078",
};

const diagnostics: TransportDiagnostics = {
  upstreamCoalescedPublicationCount: 5,
  downstreamCoalescedPublicationCount: 7,
  skippedPublicationCount: 9,
  maxUpstreamInFlightCount: 1,
  maxUpstreamPendingCount: 1,
  maxDownstreamInFlightCount: 1,
  maxDownstreamPendingCount: 1,
  latestDeliveredPublicationSequence: "0000000000000078",
};
