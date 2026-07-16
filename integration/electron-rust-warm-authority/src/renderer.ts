import type {
  AuthorityClientState,
  AutomatedProofSummary,
  DeckRuntimePublication,
} from "./bridgeTypes.js";

const RELOAD_STATE_KEY = "exclave.electron-rust-warm-authority.proof.v1";
const PRE_READY_PROBE_KEY = "exclave.electron-rust-warm-authority.pre-ready.v1";
const PROOF_STATE_VERSION = 1;
const AUTOMATED_TEMPO_RATIO = 1.25;
const STANDARD_TIMEOUT_MS = 12_000;
const RESTART_TIMEOUT_MS = 18_000;
const RELOAD_TIMEOUT_MS = 15_000;
const QUIET_WINDOW_MS = 300;
const FLOW_PAUSE_MS = 700;

type PendingReloadProof = {
  readonly version: typeof PROOF_STATE_VERSION;
  readonly phase: "awaitingReload";
  readonly initialAuthorityEpoch: string;
  readonly replacementAuthorityEpoch: string;
  readonly controlTempoRatio: number;
  readonly reloadBeforeSamplePosition: string;
  readonly reloadBeforePublicationSequence: string;
};

type CompletedReloadProof = {
  readonly version: typeof PROOF_STATE_VERSION;
  readonly phase: "complete";
  readonly summary: AutomatedProofSummary;
};

type StoredProofState = PendingReloadProof | CompletedReloadProof;

const client = window.exclaveDeck;
let authorityState = client.getAuthorityState();
let latestPublication: DeckRuntimePublication | null = null;
let publicationOrdinal = 0;
let unavailableTransitionOrdinal = 0;
let previousProcessState = authorityState.processState;
let runtimeUnsubscribe: (() => void) | null = null;
let proofRunning = false;

const elements = {
  authorityProcess: element("authority-process"),
  authorityEpoch: element("authority-epoch"),
  subscriptionState: element("subscription-state"),
  lastFailure: element("last-failure"),
  projectionInstance: element("snapshot-projection-instance"),
  baselineEpoch: element("snapshot-baseline-epoch"),
  continuityGeneration: element("snapshot-continuity-generation"),
  sequence: element("snapshot-sequence"),
  samplePosition: element("snapshot-sample-position"),
  tempoRatio: element("snapshot-tempo-ratio"),
  transport: element("snapshot-transport"),
  mediaTime: element("snapshot-media-time"),
  beatPhase: element("snapshot-beat-phase"),
  level: element("snapshot-level"),
  loopActive: element("snapshot-loop-active"),
  stemGains: element("snapshot-stem-gains"),
  upstreamCoalesced: element("upstream-coalesced"),
  downstreamCoalesced: element("downstream-coalesced"),
  skippedPublications: element("skipped-publications"),
  upstreamBounds: element("upstream-bounds"),
  downstreamBounds: element("downstream-bounds"),
  proofBadge: element("proof-badge"),
  proofStep: element("proof-step"),
  proofLog: element("proof-log"),
  controlResult: element("control-result"),
  subscribeButton: button("subscribe-button"),
  tempoInput: input("tempo-input"),
  tempoButton: button("tempo-button"),
  reloadButton: button("reload-button"),
  restartButton: button("restart-button"),
  proofButton: button("proof-button"),
};

client.subscribeAuthorityState((state) => {
  if (previousProcessState !== "unavailable" && state.processState === "unavailable") {
    unavailableTransitionOrdinal += 1;
  }
  previousProcessState = state.processState;
  authorityState = state;
  renderAuthorityState(state);
});

elements.subscribeButton.addEventListener("click", () => {
  try {
    explicitSubscribe("Manual subscription requested.");
  } catch (error) {
    showControlError(error);
  }
});

elements.tempoButton.addEventListener("click", () => {
  void applyManualTempo();
});

elements.reloadButton.addEventListener("click", () => {
  window.location.reload();
});

elements.restartButton.addEventListener("click", () => {
  void restartAuthorityManually();
});

elements.proofButton.addEventListener("click", () => {
  if (proofRunning) return;
  sessionStorage.removeItem(RELOAD_STATE_KEY);
  sessionStorage.removeItem(PRE_READY_PROBE_KEY);
  void runAutomatedProof(null, null);
});

renderAuthorityState(authorityState);
renderPublication(null);

const storedProof = readStoredProof();
if (storedProof?.phase === "complete") {
  renderCompletedProof(storedProof.summary);
} else if (new URLSearchParams(window.location.search).get("manual") !== "1") {
  void runAutomatedProof(storedProof, readPreReadyProbeEpoch());
}

async function runAutomatedProof(
  stored: PendingReloadProof | null,
  preReadyProbeEpoch: string | null,
): Promise<void> {
  proofRunning = true;
  setInteractiveControlsDisabled(true);
  setProofStatus("working", stored === null ? "Starting" : "Resuming");

  try {
    if (stored === null) {
      await runBeforeReload(preReadyProbeEpoch);
    } else {
      await runAfterReload(stored);
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : "unknown proof failure";
    setProofStatus("failed", "Failed");
    setProofStep(message);
    appendProofLog(`FAIL: ${message}`);
    emitProofOutcome(false, message);
    proofRunning = false;
    setInteractiveControlsDisabled(false);
  }
}

async function runBeforeReload(preReadyProbeEpoch: string | null): Promise<never> {
  if (preReadyProbeEpoch === null) return runPreReadyProbe();
  const initialAuthorityEpoch = preReadyProbeEpoch;
  setProofStep("Connecting the operational renderer after authority readiness.");
  const initialReady = await waitForAuthorityState(
    (state) => state.processState === "ready" && state.authorityEpoch === initialAuthorityEpoch,
    "initial authority ready",
  );
  requireEpoch(initialReady.authorityEpoch, "initial authority epoch");
  sessionStorage.removeItem(PRE_READY_PROBE_KEY);
  appendProofLog(`Authority ready at epoch ${initialAuthorityEpoch}.`);

  setProofStep("Subscribing to the generated warm contract.");
  explicitSubscribe("Automated initial subscription requested.");
  const firstPublication = await waitForPublication(
    (publication) => publication.authorityEpoch === initialAuthorityEpoch,
    "initial warm baseline",
  );
  const firstSequence = parseSequence(firstPublication.publicationSequence);
  const progressingPublication = await waitForPublication(
    (publication) =>
      publication.authorityEpoch === initialAuthorityEpoch &&
      parseSequence(publication.publicationSequence) > firstSequence,
    "warm publication sequence progress",
  );
  appendProofLog(
    `Warm sequence advanced to ${progressingPublication.publicationSequence}; generic payload decode is live.`,
  );

  setProofStep("Freezing delivery to exercise both bounded queues.");
  const samplePositionBeforeFreeze = progressingPublication.snapshot.samplePosition;
  const sequenceBeforeFreeze = parseSequence(progressingPublication.publicationSequence);
  await client.proof.setPublicationFlowPaused(true);
  await delay(FLOW_PAUSE_MS);
  await client.proof.setPublicationFlowPaused(false);
  const boundedState = await waitForAuthorityState(
    (state) =>
      state.diagnostics.upstreamCoalescedPublicationCount > 0 &&
      state.diagnostics.downstreamCoalescedPublicationCount > 0 &&
      state.diagnostics.skippedPublicationCount > 0,
    "upstream and downstream coalescing plus an observed sequence gap",
  );
  assertBoundedCounts(boundedState);
  const resumedPublication = await waitForPublication(
    (publication) =>
      publication.authorityEpoch === initialAuthorityEpoch &&
      parseSequence(publication.publicationSequence) > sequenceBeforeFreeze &&
      publication.snapshot.samplePosition > samplePositionBeforeFreeze,
    "engine timeline progress while renderer delivery was frozen",
  );
  appendProofLog(
    `Coalescing observed upstream=${boundedState.diagnostics.upstreamCoalescedPublicationCount}, downstream=${boundedState.diagnostics.downstreamCoalescedPublicationCount}, skips=${boundedState.diagnostics.skippedPublicationCount}; engine sample advanced to ${resumedPublication.snapshot.samplePosition.toString(10)}.`,
  );

  setProofStep("Issuing the typed tempo control.");
  const beforeControlSequence = parseSequence(
    requirePublication("publication before control").publicationSequence,
  );
  const control = await client.setTempoRatio(AUTOMATED_TEMPO_RATIO);
  if (!control.ok) {
    throw new Error(`typed control failed (${control.code}): ${control.message}`);
  }
  if (
    control.authorityEpoch !== initialAuthorityEpoch ||
    !nearlyEqual(control.tempoRatio, AUTOMATED_TEMPO_RATIO)
  ) {
    throw new Error("typed control response did not correlate to the active authority and value");
  }
  const controlledPublication = await waitForPublication(
    (publication) =>
      publication.authorityEpoch === initialAuthorityEpoch &&
      parseSequence(publication.publicationSequence) > beforeControlSequence &&
      nearlyEqual(publication.snapshot.tempoRatio, AUTOMATED_TEMPO_RATIO),
    "tempo control effect in a later warm snapshot",
  );
  appendProofLog(
    `Typed tempo ${AUTOMATED_TEMPO_RATIO.toFixed(2)} appeared at sequence ${controlledPublication.publicationSequence}.`,
  );

  setProofStep("Restarting the authority and rejecting epoch reuse.");
  const unavailableBeforeRestart = unavailableTransitionOrdinal;
  await client.proof.restartAuthority();
  await waitForCondition(
    () => unavailableTransitionOrdinal > unavailableBeforeRestart,
    "authority unavailable transition",
    RESTART_TIMEOUT_MS,
  );
  const replacementReady = await waitForAuthorityState(
    (state) =>
      state.processState === "ready" &&
      state.authorityEpoch !== null &&
      state.authorityEpoch !== initialAuthorityEpoch,
    "replacement authority ready with a fresh epoch",
    RESTART_TIMEOUT_MS,
  );
  const replacementAuthorityEpoch = requireEpoch(
    replacementReady.authorityEpoch,
    "replacement authority epoch",
  );
  if (isActiveSubscription(replacementReady.subscriptionState)) {
    throw new Error("authority restart silently re-subscribed the stale consumer");
  }
  const publicationsAtReplacementReady = publicationOrdinal;
  await delay(QUIET_WINDOW_MS);
  if (publicationOrdinal !== publicationsAtReplacementReady) {
    throw new Error("publication delivery resumed without an explicit post-restart subscription");
  }
  appendProofLog(
    `Observed unavailable → epoch ${replacementAuthorityEpoch}; no implicit re-subscription occurred.`,
  );

  setProofStep("Explicitly subscribing to the replacement authority.");
  explicitSubscribe("Automated replacement subscription requested.");
  const replacementPublication = await waitForPublication(
    (publication) => publication.authorityEpoch === replacementAuthorityEpoch,
    "replacement authority warm baseline",
  );
  appendProofLog(`Replacement baseline arrived at ${replacementPublication.publicationSequence}.`);

  setProofStep("Recording the pre-reload checkpoint.");
  const reloadBeforeSamplePosition = samplePositionString(replacementPublication);
  await client.proof.recordReloadCheckpoint(
    "before",
    reloadBeforeSamplePosition,
    replacementPublication.publicationSequence,
  );
  const pendingReload: PendingReloadProof = {
    version: PROOF_STATE_VERSION,
    phase: "awaitingReload",
    initialAuthorityEpoch,
    replacementAuthorityEpoch,
    controlTempoRatio: AUTOMATED_TEMPO_RATIO,
    reloadBeforeSamplePosition,
    reloadBeforePublicationSequence: replacementPublication.publicationSequence,
  };
  sessionStorage.setItem(RELOAD_STATE_KEY, JSON.stringify(pendingReload));
  appendProofLog("Checkpoint recorded; reloading the sandboxed renderer once.");
  window.location.reload();
  return new Promise<never>(() => undefined);
}

async function runPreReadyProbe(): Promise<never> {
  setProofStep("Observing starting and a typed pre-ready subscription rejection.");
  const starting = await waitForAuthorityState(
    (state) => state.processState === "starting" && state.authorityEpoch !== null,
    "initial authority starting",
  );
  const initialAuthorityEpoch = requireEpoch(
    starting.authorityEpoch,
    "initial starting authority epoch",
  );
  explicitSubscribe("Automated pre-ready subscription requested.");
  await waitForAuthorityState(
    (state) =>
      state.subscriptionState === "failed" &&
      state.lastFailure?.includes("authorityNotReady") === true,
    "typed authorityNotReady subscription failure",
  );
  appendProofLog("Rust rejected the pre-ready subscription with authorityNotReady.");
  await waitForAuthorityState(
    (state) => state.processState === "ready" && state.authorityEpoch === initialAuthorityEpoch,
    "initial authority ready after pre-ready probe",
  );
  sessionStorage.setItem(PRE_READY_PROBE_KEY, initialAuthorityEpoch);
  appendProofLog("Closing the probe renderer before the operational client connects.");
  window.location.reload();
  return new Promise<never>(() => undefined);
}

async function runAfterReload(stored: PendingReloadProof): Promise<void> {
  appendProofLog("Renderer reload detected from a validated session checkpoint.");
  setProofStep("Proving the Rust epoch survived renderer reload.");
  const ready = await waitForAuthorityState(
    (state) => state.processState === "ready" && state.authorityEpoch !== null,
    "authority ready after renderer reload",
    RELOAD_TIMEOUT_MS,
  );
  if (ready.authorityEpoch !== stored.replacementAuthorityEpoch) {
    throw new Error(
      `authority epoch changed across renderer reload (${stored.replacementAuthorityEpoch} → ${ready.authorityEpoch ?? "none"})`,
    );
  }
  if (isActiveSubscription(ready.subscriptionState)) {
    throw new Error("the reloaded renderer inherited the old subscription");
  }
  const publicationsBeforeQuietWindow = publicationOrdinal;
  await delay(QUIET_WINDOW_MS);
  if (publicationOrdinal !== publicationsBeforeQuietWindow) {
    throw new Error("the old subscription delivered into the reloaded renderer");
  }
  appendProofLog(
    `Epoch ${stored.replacementAuthorityEpoch} survived; the new renderer has no inherited subscription.`,
  );

  setProofStep("Explicitly subscribing after renderer reload.");
  explicitSubscribe("Automated post-reload subscription requested.");
  const beforeSequence = parseSequence(stored.reloadBeforePublicationSequence);
  const beforeSamplePosition = parseDecimal(stored.reloadBeforeSamplePosition);
  const afterPublication = await waitForPublication(
    (publication) =>
      publication.authorityEpoch === stored.replacementAuthorityEpoch &&
      parseSequence(publication.publicationSequence) > beforeSequence &&
      publication.snapshot.samplePosition > beforeSamplePosition,
    "post-reload sequence and sample progress",
    RELOAD_TIMEOUT_MS,
  );
  const reloadAfterSamplePosition = samplePositionString(afterPublication);
  await client.proof.recordReloadCheckpoint(
    "after",
    reloadAfterSamplePosition,
    afterPublication.publicationSequence,
  );
  appendProofLog(
    `Post-reload baseline advanced to sequence ${afterPublication.publicationSequence} and sample ${reloadAfterSamplePosition}.`,
  );

  const afterSequence = parseSequence(afterPublication.publicationSequence);
  const finalPublication = await waitForPublication(
    (publication) =>
      publication.authorityEpoch === stored.replacementAuthorityEpoch &&
      parseSequence(publication.publicationSequence) > afterSequence,
    "final publication progress",
  );
  const summary: AutomatedProofSummary = {
    controlTempoRatio: stored.controlTempoRatio,
    reloadBeforeSamplePosition: stored.reloadBeforeSamplePosition,
    reloadAfterSamplePosition,
    reloadBeforePublicationSequence: stored.reloadBeforePublicationSequence,
    reloadAfterPublicationSequence: afterPublication.publicationSequence,
    initialAuthorityEpoch: stored.initialAuthorityEpoch,
    replacementAuthorityEpoch: stored.replacementAuthorityEpoch,
    finalPublicationSequence: finalPublication.publicationSequence,
  };

  setProofStep("Submitting the complete proof to the host validator.");
  await client.proof.completeAutomatedProof(summary);
  sessionStorage.setItem(
    RELOAD_STATE_KEY,
    JSON.stringify({ version: PROOF_STATE_VERSION, phase: "complete", summary }),
  );
  setProofStatus("passed", "Passed");
  setProofStep("Lifecycle, backpressure, control, restart, and reload proof passed.");
  appendProofLog(`PASS: final sequence ${summary.finalPublicationSequence}.`);
  emitProofOutcome(true, summary);
  proofRunning = false;
  setInteractiveControlsDisabled(false);
}

function explicitSubscribe(logMessage: string): void {
  if (runtimeUnsubscribe !== null) {
    runtimeUnsubscribe();
    runtimeUnsubscribe = null;
  }
  latestPublication = null;
  renderPublication(null);
  runtimeUnsubscribe = client.subscribeRuntime((publication) => {
    latestPublication = publication;
    publicationOrdinal += 1;
    renderPublication(publication);
  });
  appendProofLog(logMessage);
}

async function applyManualTempo(): Promise<void> {
  elements.tempoButton.disabled = true;
  try {
    const value = Number(elements.tempoInput.value);
    const result = await client.setTempoRatio(value);
    elements.controlResult.textContent = result.ok
      ? `Accepted ${result.tempoRatio.toFixed(2)} at authority epoch ${result.authorityEpoch}.`
      : `Rejected (${result.code}): ${result.message}`;
  } catch (error) {
    showControlError(error);
  } finally {
    elements.tempoButton.disabled = proofRunning;
  }
}

async function restartAuthorityManually(): Promise<void> {
  elements.restartButton.disabled = true;
  try {
    await client.proof.restartAuthority();
    elements.controlResult.textContent =
      "Proof-only restart requested. Explicitly subscribe after the replacement is ready.";
  } catch (error) {
    showControlError(error);
  } finally {
    elements.restartButton.disabled = proofRunning;
  }
}

function renderAuthorityState(state: AuthorityClientState): void {
  elements.authorityProcess.textContent = titleCase(state.processState);
  elements.authorityEpoch.textContent = state.authorityEpoch ?? "—";
  elements.subscriptionState.textContent = titleCase(state.subscriptionState);
  elements.lastFailure.textContent = state.lastFailure ?? "—";
  elements.upstreamCoalesced.textContent = String(
    state.diagnostics.upstreamCoalescedPublicationCount,
  );
  elements.downstreamCoalesced.textContent = String(
    state.diagnostics.downstreamCoalescedPublicationCount,
  );
  elements.skippedPublications.textContent = String(state.diagnostics.skippedPublicationCount);
  elements.upstreamBounds.textContent = `${state.diagnostics.maxUpstreamInFlightCount} / ${state.diagnostics.maxUpstreamPendingCount}`;
  elements.downstreamBounds.textContent = `${state.diagnostics.maxDownstreamInFlightCount} / ${state.diagnostics.maxDownstreamPendingCount}`;
}

function renderPublication(publication: DeckRuntimePublication | null): void {
  if (publication === null) {
    for (const target of [
      elements.sequence,
      elements.projectionInstance,
      elements.baselineEpoch,
      elements.continuityGeneration,
      elements.samplePosition,
      elements.tempoRatio,
      elements.transport,
      elements.mediaTime,
      elements.beatPhase,
      elements.level,
      elements.loopActive,
      elements.stemGains,
    ]) {
      target.textContent = "—";
    }
    return;
  }

  const snapshot = publication.snapshot;
  elements.projectionInstance.textContent = publication.projectionInstanceKey;
  elements.baselineEpoch.textContent = String(publication.baselineEpoch);
  elements.continuityGeneration.textContent = String(publication.continuityGeneration);
  elements.sequence.textContent = publication.publicationSequence;
  elements.samplePosition.textContent = snapshot.samplePosition.toString(10);
  elements.tempoRatio.textContent = snapshot.tempoRatio.toFixed(3);
  elements.transport.textContent = snapshot.transportState;
  elements.mediaTime.textContent = `${snapshot.mediaTimeSeconds.toFixed(3)} s`;
  elements.beatPhase.textContent = snapshot.beatPhase01.toFixed(3);
  elements.level.textContent = snapshot.level.toFixed(3);
  elements.loopActive.textContent = snapshot.loopActive ? "Yes" : "No";
  elements.stemGains.textContent = snapshot.stemGains.map((gain) => gain.toFixed(3)).join(", ");
}

function renderCompletedProof(summary: AutomatedProofSummary): void {
  setProofStatus("passed", "Passed");
  setProofStep("The previous automated proof completed successfully in this renderer session.");
  appendProofLog(
    `Stored PASS: epochs ${summary.initialAuthorityEpoch} → ${summary.replacementAuthorityEpoch}, final sequence ${summary.finalPublicationSequence}.`,
  );
}

function setProofStatus(tone: "working" | "passed" | "failed", label: string): void {
  elements.proofBadge.dataset.tone = tone;
  elements.proofBadge.textContent = label;
  document.documentElement.dataset.proofStatus = tone;
}

function setProofStep(message: string): void {
  elements.proofStep.textContent = message;
}

function appendProofLog(message: string): void {
  console.info("EXCLAVE_ELECTRON_RUST_WARM_PROOF_STEP", message);
  const item = document.createElement("li");
  item.textContent = message;
  elements.proofLog.append(item);
  while (elements.proofLog.childElementCount > 24) {
    elements.proofLog.firstElementChild?.remove();
  }
}

function setInteractiveControlsDisabled(disabled: boolean): void {
  elements.subscribeButton.disabled = disabled;
  elements.tempoInput.disabled = disabled;
  elements.tempoButton.disabled = disabled;
  elements.reloadButton.disabled = disabled;
  elements.restartButton.disabled = disabled;
  elements.proofButton.disabled = disabled;
}

function showControlError(error: unknown): void {
  elements.controlResult.textContent =
    error instanceof Error ? error.message : "The control request failed.";
}

async function waitForAuthorityState(
  predicate: (state: AuthorityClientState) => boolean,
  label: string,
  timeoutMs = STANDARD_TIMEOUT_MS,
): Promise<AuthorityClientState> {
  return waitForValue(() => authorityState, predicate, label, timeoutMs);
}

async function waitForPublication(
  predicate: (publication: DeckRuntimePublication) => boolean,
  label: string,
  timeoutMs = STANDARD_TIMEOUT_MS,
): Promise<DeckRuntimePublication> {
  return waitForValue(
    () => latestPublication,
    (publication): publication is DeckRuntimePublication =>
      publication !== null && predicate(publication),
    label,
    timeoutMs,
  );
}

async function waitForValue<T, U extends T>(
  read: () => T,
  predicate: (value: T) => value is U,
  label: string,
  timeoutMs: number,
): Promise<U>;
async function waitForValue<T>(
  read: () => T,
  predicate: (value: T) => boolean,
  label: string,
  timeoutMs: number,
): Promise<T>;
async function waitForValue<T>(
  read: () => T,
  predicate: (value: T) => boolean,
  label: string,
  timeoutMs: number,
): Promise<T> {
  const deadline = performance.now() + timeoutMs;
  while (performance.now() <= deadline) {
    const value = read();
    if (predicate(value)) return value;
    await delay(20);
  }
  throw new Error(`timed out waiting for ${label}`);
}

async function waitForCondition(
  predicate: () => boolean,
  label: string,
  timeoutMs: number,
): Promise<void> {
  await waitForValue(predicate, (value) => value, label, timeoutMs);
}

function assertBoundedCounts(state: AuthorityClientState): void {
  const diagnostics = state.diagnostics;
  if (
    diagnostics.maxUpstreamInFlightCount !== 1 ||
    diagnostics.maxUpstreamPendingCount !== 1 ||
    diagnostics.maxDownstreamInFlightCount !== 1 ||
    diagnostics.maxDownstreamPendingCount !== 1
  ) {
    throw new Error("each transport boundary must prove exactly one in-flight and one pending");
  }
}

function readStoredProof(): PendingReloadProof | CompletedReloadProof | null {
  const encoded = sessionStorage.getItem(RELOAD_STATE_KEY);
  if (encoded === null) return null;
  try {
    return parseStoredProof(JSON.parse(encoded));
  } catch (error) {
    sessionStorage.removeItem(RELOAD_STATE_KEY);
    appendProofLog(
      `Discarded an invalid reload checkpoint: ${error instanceof Error ? error.message : "invalid data"}.`,
    );
    return null;
  }
}

function readPreReadyProbeEpoch(): string | null {
  const value = sessionStorage.getItem(PRE_READY_PROBE_KEY);
  if (value === null) return null;
  try {
    return canonicalDecimal(value, "pre-ready probe epoch");
  } catch {
    sessionStorage.removeItem(PRE_READY_PROBE_KEY);
    return null;
  }
}

function parseStoredProof(value: unknown): StoredProofState {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new TypeError("checkpoint must be a plain object");
  }
  const record = value as Record<string, unknown>;
  if (record.version !== PROOF_STATE_VERSION) {
    throw new TypeError("checkpoint version is unsupported");
  }
  if (record.phase === "awaitingReload") {
    const pending: PendingReloadProof = {
      version: PROOF_STATE_VERSION,
      phase: "awaitingReload",
      initialAuthorityEpoch: canonicalDecimal(record.initialAuthorityEpoch, "initial epoch"),
      replacementAuthorityEpoch: canonicalDecimal(
        record.replacementAuthorityEpoch,
        "replacement epoch",
      ),
      controlTempoRatio: finiteNumber(record.controlTempoRatio, "control tempo ratio"),
      reloadBeforeSamplePosition: canonicalDecimal(
        record.reloadBeforeSamplePosition,
        "pre-reload sample position",
      ),
      reloadBeforePublicationSequence: canonicalSequence(
        record.reloadBeforePublicationSequence,
        "pre-reload publication sequence",
      ),
    };
    if (pending.initialAuthorityEpoch === pending.replacementAuthorityEpoch) {
      throw new TypeError("checkpoint authority epochs must differ");
    }
    return pending;
  }
  if (record.phase === "complete") {
    return {
      version: PROOF_STATE_VERSION,
      phase: "complete",
      summary: parseCompletedSummary(record.summary),
    };
  }
  throw new TypeError("checkpoint phase is invalid");
}

function parseCompletedSummary(value: unknown): AutomatedProofSummary {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new TypeError("completed summary must be a plain object");
  }
  const record = value as Record<string, unknown>;
  return {
    controlTempoRatio: finiteNumber(record.controlTempoRatio, "control tempo ratio"),
    reloadBeforeSamplePosition: canonicalDecimal(
      record.reloadBeforeSamplePosition,
      "pre-reload sample position",
    ),
    reloadAfterSamplePosition: canonicalDecimal(
      record.reloadAfterSamplePosition,
      "post-reload sample position",
    ),
    reloadBeforePublicationSequence: canonicalSequence(
      record.reloadBeforePublicationSequence,
      "pre-reload publication sequence",
    ),
    reloadAfterPublicationSequence: canonicalSequence(
      record.reloadAfterPublicationSequence,
      "post-reload publication sequence",
    ),
    initialAuthorityEpoch: canonicalDecimal(record.initialAuthorityEpoch, "initial epoch"),
    replacementAuthorityEpoch: canonicalDecimal(
      record.replacementAuthorityEpoch,
      "replacement epoch",
    ),
    finalPublicationSequence: canonicalSequence(
      record.finalPublicationSequence,
      "final publication sequence",
    ),
  };
}

function canonicalDecimal(value: unknown, label: string): string {
  if (typeof value !== "string" || !/^(0|[1-9][0-9]*)$/.test(value)) {
    throw new TypeError(`${label} is not a canonical unsigned decimal string`);
  }
  return value;
}

function canonicalSequence(value: unknown, label: string): string {
  if (typeof value !== "string" || !/^[0-9a-f]{16}$/.test(value)) {
    throw new TypeError(`${label} is not a canonical u64 hex string`);
  }
  return value;
}

function finiteNumber(value: unknown, label: string): number {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    throw new TypeError(`${label} is not finite`);
  }
  return value;
}

function parseSequence(value: string): bigint {
  return BigInt(`0x${canonicalSequence(value, "publication sequence")}`);
}

function parseDecimal(value: string): bigint {
  return BigInt(canonicalDecimal(value, "unsigned decimal value"));
}

function samplePositionString(publication: DeckRuntimePublication): string {
  const samplePosition = publication.snapshot.samplePosition;
  if (samplePosition < 0n) throw new Error("warm sample position must be unsigned");
  return samplePosition.toString(10);
}

function requireEpoch(value: string | null, label: string): string {
  return canonicalDecimal(value, label);
}

function requirePublication(label: string): DeckRuntimePublication {
  if (latestPublication === null) throw new Error(`${label} is unavailable`);
  return latestPublication;
}

function isActiveSubscription(state: AuthorityClientState["subscriptionState"]): boolean {
  return state === "subscribing" || state === "waitingForBaseline" || state === "live";
}

function nearlyEqual(left: number, right: number): boolean {
  return Math.abs(left - right) <= Number.EPSILON * 8;
}

function titleCase(value: string): string {
  return value.replaceAll(/([A-Z])/g, " $1").replace(/^./, (letter) => letter.toUpperCase());
}

function emitProofOutcome(ok: boolean, detail: AutomatedProofSummary | string): void {
  window.dispatchEvent(new CustomEvent("exclave-proof-complete", { detail: { ok, detail } }));
  if (ok) {
    console.info("EXCLAVE_ELECTRON_RUST_WARM_PROOF_PASS", detail);
  } else {
    console.error("EXCLAVE_ELECTRON_RUST_WARM_PROOF_FAIL", detail);
  }
}

function delay(milliseconds: number): Promise<void> {
  return new Promise((resolve) => window.setTimeout(resolve, milliseconds));
}

function element(id: string): HTMLElement {
  const value = document.getElementById(id);
  if (value === null) throw new Error(`required renderer element #${id} is missing`);
  return value;
}

function button(id: string): HTMLButtonElement {
  const value = element(id);
  if (!(value instanceof HTMLButtonElement)) {
    throw new Error(`required renderer element #${id} is not a button`);
  }
  return value;
}

function input(id: string): HTMLInputElement {
  const value = element(id);
  if (!(value instanceof HTMLInputElement)) {
    throw new Error(`required renderer element #${id} is not an input`);
  }
  return value;
}
