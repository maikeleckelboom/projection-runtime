import { validateControlResponseEnvelope } from "@exclave/control-plane";
import {
  closePublicationConsumerSubscription,
  createPublicationConsumerState,
  createSubscribePublicationAck,
  createWaitingPublicationConsumerSubscription,
  invalidatePublicationConsumerSubscription,
  type SubscribePublicationAck,
} from "@exclave/publication";
import { contextBridge, ipcRenderer } from "electron";
import type {
  AuthorityClientState,
  AutomatedProofSummary,
  ControlResult,
  DeckRuntimePublication,
  ExclaveDeckClient,
  TransportDiagnostics,
} from "./bridgeTypes.js";
import {
  DECK_RUNTIME_CONTRACT_KEY,
  DECK_RUNTIME_SEMANTIC_VERSION,
  DECK_RUNTIME_WARM_CODEC_VERSION,
  type DeckRuntimeWarmSnapshot,
  PROJECTION_INSTANCE_KEY,
} from "./contract.js";
import {
  type HostToPreloadMessage,
  type PreloadToHostMessage,
  parseHostToPreloadMessage,
  type SerializedSubscribePublicationAck,
} from "./portProtocol.js";
import {
  acknowledgeThenNotify,
  applyDeckRuntimePublication,
  performBeforeNotification,
  validateRetiredDeckRuntimePublication,
} from "./preloadPublication.js";
import { PreloadSubscriptionIntent, PreloadSubscriptionState } from "./preloadSubscriptionState.js";
import { takeCorrelatedRequest } from "./requestCorrelation.js";
import {
  decodeAuthorityEpoch,
  decodeU64Hex,
  encodeU64Hex,
  isCanonicalAuthorityEpoch,
  isCanonicalU64Hex,
} from "./wireValues.js";

const CLIENT_PORT_CHANNEL = "exclave:deck-client-port";

type ProofRequest = Extract<
  PreloadToHostMessage,
  {
    readonly kind:
      | "proofSetPublicationFlowPaused"
      | "proofRestartAuthority"
      | "proofReloadCheckpoint"
      | "proofComplete";
  }
>;

let port: MessagePort | null = null;
let nextRequestOrdinal = 1;
let processState: AuthorityClientState["processState"] = "unavailable";
let authorityEpoch: string | null = null;
let subscriptionState: AuthorityClientState["subscriptionState"] = "none";
let lastFailure: string | null = null;
let publicationConsumer = createPublicationConsumerState<DeckRuntimeWarmSnapshot>();
const subscriptions = new PreloadSubscriptionState();
const subscriptionIntent = new PreloadSubscriptionIntent();
let publicationsPaused = false;
let heldPublication: Extract<HostToPreloadMessage, { readonly kind: "publication" }> | null = null;
let previousPublicationSequence: bigint | null = null;
let skippedPublicationCount = 0;
let diagnostics = emptyDiagnostics();
let clientProtocolFailed = false;

const authorityStateListeners = new Set<(state: AuthorityClientState) => void>();
const runtimeListeners = new Set<(publication: DeckRuntimePublication) => void>();
const pendingControls = new Map<
  string,
  { readonly resolve: (result: ControlResult) => void; readonly reject: (error: Error) => void }
>();
const pendingProofs = new Map<
  string,
  { readonly resolve: () => void; readonly reject: (error: Error) => void }
>();

ipcRenderer.on(CLIENT_PORT_CHANNEL, (event) => {
  if (port !== null) {
    return;
  }
  const receivedPort = event.ports[0];
  if (receivedPort === undefined || event.ports.length !== 1) {
    failClientProtocol("preload.clientPortInvalid", "expected exactly one private client port");
    return;
  }

  port = receivedPort;
  receivedPort.onmessage = (messageEvent) => receiveHostMessage(messageEvent.data);
  receivedPort.onmessageerror = () => {
    failClientProtocol("preload.messageDecodeFailed", "private client port message decode failed");
  };
  receivedPort.start();
  flushRuntimeSubscriptionIntent();
});

const clientApi: ExclaveDeckClient = {
  getAuthorityState: snapshotAuthorityState,
  setTempoRatio,
  subscribeAuthorityState(listener) {
    requireFunction(listener, "authority state listener");
    authorityStateListeners.add(listener);
    safelyNotify(listener, snapshotAuthorityState());
    return () => authorityStateListeners.delete(listener);
  },
  subscribeRuntime(listener) {
    requireFunction(listener, "runtime publication listener");
    runtimeListeners.add(listener);
    subscriptionIntent.request();
    requestRuntimeSubscription();
    return () => {
      runtimeListeners.delete(listener);
      if (runtimeListeners.size === 0) {
        closeRuntimeSubscription();
      }
    };
  },
  proof: {
    async setPublicationFlowPaused(paused) {
      if (typeof paused !== "boolean") throw new TypeError("paused must be boolean");
      const request: ProofRequest = {
        kind: "proofSetPublicationFlowPaused",
        requestKey: requestKey("proof-flow"),
        paused,
      };
      if (paused) {
        publicationsPaused = true;
        try {
          await sendProofRequest(request);
        } catch (error) {
          publicationsPaused = false;
          heldPublication = null;
          throw error;
        }
      } else {
        await sendProofRequest(request);
        publicationsPaused = false;
        const publication = heldPublication;
        heldPublication = null;
        if (publication !== null) applyPublication(publication);
      }
    },
    restartAuthority() {
      return sendProofRequest({
        kind: "proofRestartAuthority",
        requestKey: requestKey("proof-restart"),
      });
    },
    recordReloadCheckpoint(phase, samplePosition, publicationSequence) {
      if (phase !== "before" && phase !== "after") throw new TypeError("phase is invalid");
      if (!isCanonicalAuthorityEpoch(samplePosition)) {
        throw new TypeError("samplePosition must be a canonical unsigned decimal string");
      }
      if (!isCanonicalU64Hex(publicationSequence)) {
        throw new TypeError("publicationSequence must be canonical u64 hex");
      }
      return sendProofRequest({
        kind: "proofReloadCheckpoint",
        requestKey: requestKey(`proof-reload-${phase}`),
        phase,
        samplePosition,
        publicationSequence,
      });
    },
    completeAutomatedProof(summary) {
      validateProofSummary(summary);
      return sendProofRequest({
        kind: "proofComplete",
        requestKey: requestKey("proof-complete"),
        summary,
      });
    },
  },
};

contextBridge.exposeInMainWorld("exclaveDeck", clientApi);

function receiveHostMessage(value: unknown): void {
  if (clientProtocolFailed) return;
  let message: HostToPreloadMessage;
  try {
    message = parseHostToPreloadMessage(value);
  } catch (error) {
    failClientProtocol(
      "preload.hostMessageRejected",
      error instanceof Error ? error.message : "host message validation failed",
    );
    return;
  }

  switch (message.kind) {
    case "authorityStarting":
      processState = "starting";
      authorityEpoch = message.authorityEpoch;
      lastFailure = null;
      notifyAuthorityState();
      flushRuntimeSubscriptionIntent();
      break;
    case "authorityReady":
      processState = "ready";
      authorityEpoch = message.authorityEpoch;
      lastFailure = null;
      notifyAuthorityState();
      flushRuntimeSubscriptionIntent();
      break;
    case "authorityUnavailable":
      handleAuthorityUnavailable(message.replacedAuthorityEpoch);
      break;
    case "subscribeResult":
      handleSubscribeResult(message);
      break;
    case "unsubscribeResult":
      handleUnsubscribeResult(message);
      break;
    case "controlResponse":
      handleControlResponse(message);
      break;
    case "publication":
      if (publicationsPaused) {
        heldPublication = message;
      } else {
        applyPublication(message);
      }
      break;
    case "transportDiagnostics":
      diagnostics = message.diagnostics;
      notifyAuthorityState();
      break;
    case "proofResult": {
      try {
        takeCorrelatedRequest(pendingProofs, message.requestKey, "proof result").resolve();
      } catch (error) {
        failClientProtocol(
          "preload.proofResultRejected",
          error instanceof Error ? error.message : "proof result correlation failed",
        );
      }
      break;
    }
    case "hostFailure":
      rejectPendingRequests(new Error(`${message.code}: ${message.message}`));
      transitionToFailure(message.code, message.message);
      break;
  }
}

function requestRuntimeSubscription(): void {
  flushRuntimeSubscriptionIntent();
}

function flushRuntimeSubscriptionIntent(): void {
  if (clientProtocolFailed) return;
  const occupied =
    subscriptions.currentAck !== null ||
    (subscriptions.pendingSubscribeRequestKey !== null && subscriptionState === "subscribing");
  const intentAction = subscriptionIntent.consume({
    portConnected: port !== null,
    authorityBindable: processState !== "unavailable" && authorityEpoch !== null,
    subscriptionOccupied: occupied,
  });
  if (intentAction === "none" || intentAction === "satisfied") return;
  if (intentAction === "wait") {
    subscriptionState = "subscribing";
    lastFailure = null;
    notifyAuthorityState();
    return;
  }
  if (port === null || authorityEpoch === null) {
    transitionToFailure("preload.subscribeStateRejected", "subscription intent lost readiness");
    return;
  }
  if (subscriptionState === "waitingForBaseline" || subscriptionState === "live") {
    return;
  }

  const pendingKey = subscriptions.pendingSubscribeRequestKey;
  const key = pendingKey ?? requestKey("subscribe");
  let subscriptionAction: "send" | "resumed";
  try {
    subscriptionAction = subscriptions.beginSubscribe(key, authorityEpoch);
  } catch (error) {
    transitionToFailure(
      "preload.subscribeStateRejected",
      error instanceof Error ? error.message : "subscribe state transition failed",
    );
    return;
  }
  subscriptionState = "subscribing";
  lastFailure = null;
  notifyAuthorityState();
  if (subscriptionAction === "resumed") return;
  postToHost({
    kind: "subscribeRuntime",
    requestKey: key,
    request: {
      contractKey: DECK_RUNTIME_CONTRACT_KEY,
      projectionInstanceKey: PROJECTION_INSTANCE_KEY,
      lane: "warm",
      expectedSemanticVersion: encodeU64Hex(DECK_RUNTIME_SEMANTIC_VERSION),
      expectedLaneVersion: encodeU64Hex(DECK_RUNTIME_WARM_CODEC_VERSION),
    },
  });
}

function handleSubscribeResult(
  message: Extract<HostToPreloadMessage, { readonly kind: "subscribeResult" }>,
): void {
  if (!message.result.ok) {
    let cancelled: boolean;
    try {
      cancelled = subscriptions.completeSubscribeFailure(message.requestKey).cancelled;
    } catch (error) {
      transitionToFailure(
        "preload.staleSubscribeResult",
        error instanceof Error ? error.message : "stale subscribe result was rejected",
      );
      return;
    }
    if (cancelled) {
      subscriptionState = "closed";
      lastFailure = null;
      notifyAuthorityState();
      return;
    }
    subscriptionState = "failed";
    lastFailure = `subscription failed: ${message.result.failure.kind}`;
    notifyAuthorityState();
    return;
  }

  let completion:
    | { readonly kind: "active"; readonly ack: SubscribePublicationAck }
    | { readonly kind: "cleanup"; readonly ack: SubscribePublicationAck };
  try {
    const ack = deserializeAck(message.result.ack);
    assertAckMatchesGeneratedContract(ack);
    completion = subscriptions.completeSubscribeSuccess(message.requestKey, ack);
  } catch (error) {
    transitionToFailure(
      "preload.subscribeAckRejected",
      error instanceof Error ? error.message : "subscribe ack validation failed",
    );
    return;
  }

  if (completion.kind === "cleanup") {
    publicationConsumer = closePublicationConsumerSubscription(publicationConsumer);
    subscriptionState = "closed";
    lastFailure = null;
    performBeforeNotification(
      () => sendUnsubscribe(completion.ack),
      () => notifyAuthorityState(),
    );
    return;
  }

  publicationConsumer = createWaitingPublicationConsumerSubscription(completion.ack);
  subscriptionState = "waitingForBaseline";
  previousPublicationSequence = null;
  skippedPublicationCount = 0;
  notifyAuthorityState();
}

function applyPublication(
  message: Extract<HostToPreloadMessage, { readonly kind: "publication" }>,
): void {
  const binding = subscriptions.publicationBinding(
    message.attachment.authorityEpoch,
    message.attachment.subscriptionId,
  );
  if (binding.kind === "retired") {
    try {
      validateRetiredDeckRuntimePublication(binding.ack, message);
    } catch (error) {
      transitionToFailure(
        "preload.retiredPublicationRejected",
        error instanceof Error ? error.message : "retired publication validation failed",
      );
    }
    return;
  }
  if (binding.kind === "unknown") {
    transitionToFailure(
      "preload.publicationWithoutAck",
      "publication arrived without an active or retired subscribe acknowledgement",
    );
    return;
  }

  try {
    const applied = applyDeckRuntimePublication({
      consumer: publicationConsumer,
      ack: binding.ack,
      message,
      previousPublicationSequence,
      skippedPublicationCount,
    });
    publicationConsumer = applied.consumer;
    subscriptionState = "live";
    lastFailure = null;
    previousPublicationSequence = applied.previousPublicationSequence;
    skippedPublicationCount = applied.skippedPublicationCount;
    diagnostics = {
      ...diagnostics,
      upstreamCoalescedPublicationCount: message.upstreamCoalescedPublicationCount,
      downstreamCoalescedPublicationCount: message.downstreamCoalescedPublicationCount,
      skippedPublicationCount,
      latestDeliveredPublicationSequence: applied.publicationSequence,
    };

    acknowledgeThenNotify({
      acknowledge: () =>
        postToHost({
          kind: "publicationApplied",
          subscriptionId: message.attachment.subscriptionId,
          authorityEpoch: message.attachment.authorityEpoch,
          publicationSequence: applied.publicationSequence,
        }),
      listeners: runtimeListeners,
      notify: safelyNotify,
      value: applied.publication,
    });
    notifyAuthorityState();
  } catch (error) {
    transitionToFailure(
      "preload.publicationRejected",
      error instanceof Error ? error.message : "publication validation failed",
    );
  }
}

function handleAuthorityUnavailable(replacedAuthorityEpoch: string): void {
  if (
    publicationConsumer.kind === "subscribedWaitingForInitialSnapshot" ||
    publicationConsumer.kind === "live"
  ) {
    publicationConsumer = invalidatePublicationConsumerSubscription(publicationConsumer, {
      kind: "authorityUnavailable",
      replacedAuthorityEpoch: decodeAuthorityEpoch(replacedAuthorityEpoch),
      state: "stopped",
    });
  }
  subscriptions.invalidateAuthority(replacedAuthorityEpoch);
  subscriptionIntent.cancel();
  processState = "unavailable";
  authorityEpoch = null;
  subscriptionState = publicationConsumer.kind === "stale" ? "stale" : "closed";
  publicationsPaused = false;
  heldPublication = null;
  rejectPendingRequests(
    new Error(`authority ${replacedAuthorityEpoch} became unavailable before control completion`),
  );
  lastFailure = "authority unavailable; retained publication is stale";
  notifyAuthorityState();
}

function closeRuntimeSubscription(): void {
  subscriptionIntent.cancel();
  if (subscriptions.cancelPendingSubscribe()) {
    publicationConsumer = closePublicationConsumerSubscription(publicationConsumer);
    subscriptionState = "closed";
    heldPublication = null;
    lastFailure = null;
    notifyAuthorityState();
    return;
  }
  const ack = subscriptions.closeActive();
  publicationConsumer = closePublicationConsumerSubscription(publicationConsumer);
  subscriptionState = "closed";
  heldPublication = null;
  if (ack === null) {
    notifyAuthorityState();
  } else {
    performBeforeNotification(
      () => sendUnsubscribe(ack),
      () => notifyAuthorityState(),
    );
  }
}

function sendUnsubscribe(ack: SubscribePublicationAck): void {
  if (port === null) return;
  const key = requestKey("unsubscribe");
  subscriptions.trackUnsubscribe(key, ack);
  postToHost({
    kind: "unsubscribeRuntime",
    requestKey: key,
    subscriptionId: ack.subscriptionId,
    authorityEpoch: ack.authorityEpoch.toString(10),
  });
}

function handleUnsubscribeResult(
  message: Extract<HostToPreloadMessage, { readonly kind: "unsubscribeResult" }>,
): void {
  try {
    subscriptions.completeUnsubscribe(message.requestKey, message.ok);
  } catch (error) {
    transitionToFailure(
      "preload.unsubscribeResultRejected",
      error instanceof Error ? error.message : "unsubscribe result validation failed",
    );
  }
}

async function setTempoRatio(value: number): Promise<ControlResult> {
  if (typeof value !== "number" || !Number.isFinite(value) || value < 0.5 || value > 2) {
    throw new TypeError("tempo ratio must be finite and in [0.5, 2]");
  }
  if (processState !== "ready" || authorityEpoch === null || port === null) {
    return { ok: false, code: "control.authorityUnavailable", message: "authority is not ready" };
  }

  const key = requestKey("control");
  const result = new Promise<ControlResult>((resolve, reject) => {
    pendingControls.set(key, { resolve, reject });
  });
  postToHost({
    kind: "setTempoRatio",
    requestKey: key,
    authorityEpoch,
    value,
  });
  return result;
}

function handleControlResponse(
  message: Extract<HostToPreloadMessage, { readonly kind: "controlResponse" }>,
): void {
  let pending: typeof pendingControls extends Map<string, infer T> ? T : never;
  try {
    pending = takeCorrelatedRequest(pendingControls, message.requestKey, "control response");
  } catch (error) {
    failClientProtocol(
      "preload.controlResponseRejected",
      error instanceof Error ? error.message : "control response correlation failed",
    );
    return;
  }

  const validated = validateControlResponseEnvelope(message.response);
  if (!validated.ok) {
    pending.reject(new Error(validated.failure.message));
    failClientProtocol("preload.controlResponseRejected", validated.failure.message);
    return;
  }
  const response = validated.value;
  if (response.requestKey !== message.requestKey) {
    pending.reject(new Error("control response requestKey mismatch"));
    failClientProtocol("preload.controlResponseRejected", "control response requestKey mismatch");
    return;
  }
  if (!response.ok) {
    pending.resolve({
      ok: false,
      code: response.failure.code,
      message: response.failure.message,
    });
    return;
  }

  try {
    const payload = exactRecord(
      response.payload,
      ["authorityEpoch", "tempoRatio"],
      "control payload",
    );
    const returnedEpoch = payload.authorityEpoch;
    const tempoRatio = payload.tempoRatio;
    if (!isCanonicalAuthorityEpoch(returnedEpoch)) {
      throw new TypeError("control payload authorityEpoch is invalid");
    }
    if (typeof tempoRatio !== "number" || !Number.isFinite(tempoRatio)) {
      throw new TypeError("control payload tempoRatio is invalid");
    }
    pending.resolve({ ok: true, authorityEpoch: returnedEpoch, tempoRatio });
  } catch (error) {
    pending.reject(error instanceof Error ? error : new Error("control payload validation failed"));
  }
}

function sendProofRequest(message: ProofRequest): Promise<void> {
  if (port === null) return Promise.reject(new Error("private host channel is not connected"));
  const result = new Promise<void>((resolve, reject) => {
    pendingProofs.set(message.requestKey, { resolve, reject });
  });
  postToHost(message);
  return result;
}

function postToHost(message: PreloadToHostMessage): void {
  if (clientProtocolFailed) throw new Error("private host channel failed protocol validation");
  if (port === null) throw new Error("private host channel is not connected");
  port.postMessage(message);
}

function deserializeAck(serialized: SerializedSubscribePublicationAck): SubscribePublicationAck {
  return createSubscribePublicationAck({
    contractKey: serialized.contractKey,
    projectionInstanceKey: serialized.projectionInstanceKey,
    lane: serialized.lane,
    subscriptionId: serialized.subscriptionId,
    authorityEpoch: decodeAuthorityEpoch(serialized.authorityEpoch),
    semanticVersion: decodeU64Hex(serialized.semanticVersion, "ack.semanticVersion"),
    laneVersion: decodeU64Hex(serialized.laneVersion, "ack.laneVersion"),
    baselineEpoch: serialized.baselineEpoch,
    continuityGeneration: serialized.continuityGeneration,
  });
}

function assertAckMatchesGeneratedContract(ack: SubscribePublicationAck): void {
  if (
    ack.contractKey !== DECK_RUNTIME_CONTRACT_KEY ||
    ack.projectionInstanceKey !== PROJECTION_INSTANCE_KEY ||
    ack.lane !== "warm" ||
    ack.semanticVersion !== DECK_RUNTIME_SEMANTIC_VERSION ||
    ack.laneVersion !== DECK_RUNTIME_WARM_CODEC_VERSION
  ) {
    throw new Error("subscribe ack does not match the generated deck runtime contract");
  }
}

function snapshotAuthorityState(): AuthorityClientState {
  return {
    processState,
    authorityEpoch,
    subscriptionState,
    lastFailure,
    diagnostics: { ...diagnostics },
  };
}

function notifyAuthorityState(): void {
  const state = snapshotAuthorityState();
  for (const listener of authorityStateListeners) safelyNotify(listener, state);
}

function transitionToFailure(code: string, message: string): void {
  subscriptionState = "failed";
  lastFailure = `${code}: ${message}`;
  notifyAuthorityState();
}

function failClientProtocol(code: string, message: string): void {
  if (clientProtocolFailed) return;
  clientProtocolFailed = true;
  const error = new Error(`${code}: ${message}`);
  subscriptionIntent.cancel();
  publicationsPaused = false;
  heldPublication = null;
  rejectPendingRequests(error);
  const failedPort = port;
  port = null;
  if (failedPort !== null) {
    failedPort.onmessage = null;
    failedPort.onmessageerror = null;
    failedPort.close();
  }
  transitionToFailure(code, message);
}

function rejectPendingControls(error: Error): void {
  for (const pending of pendingControls.values()) pending.reject(error);
  pendingControls.clear();
}

function rejectPendingRequests(error: Error): void {
  rejectPendingControls(error);
  for (const pending of pendingProofs.values()) pending.reject(error);
  pendingProofs.clear();
}

function safelyNotify<T>(listener: (value: T) => void, value: T): void {
  try {
    listener(value);
  } catch {
    // Renderer listener failures do not alter validated client state or transport credit.
  }
}

function requestKey(prefix: string): string {
  const key = `${prefix}-${nextRequestOrdinal}`;
  nextRequestOrdinal += 1;
  return key;
}

function emptyDiagnostics(): TransportDiagnostics {
  return {
    upstreamCoalescedPublicationCount: 0,
    downstreamCoalescedPublicationCount: 0,
    skippedPublicationCount: 0,
    maxUpstreamInFlightCount: 0,
    maxUpstreamPendingCount: 0,
    maxDownstreamInFlightCount: 0,
    maxDownstreamPendingCount: 0,
    latestDeliveredPublicationSequence: null,
  };
}

function requireFunction(
  value: unknown,
  label: string,
): asserts value is (...args: never[]) => unknown {
  if (typeof value !== "function") throw new TypeError(`${label} must be a function`);
}

function exactRecord(
  value: unknown,
  expectedKeys: readonly string[],
  label: string,
): Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new TypeError(`${label} must be a plain object`);
  }
  const record = value as Record<string, unknown>;
  if (
    JSON.stringify(Object.keys(record).toSorted()) !== JSON.stringify([...expectedKeys].toSorted())
  ) {
    throw new TypeError(`${label} has unexpected fields`);
  }
  return record;
}

function validateProofSummary(summary: AutomatedProofSummary): void {
  exactRecord(
    summary,
    [
      "controlTempoRatio",
      "reloadBeforeSamplePosition",
      "reloadAfterSamplePosition",
      "reloadBeforePublicationSequence",
      "reloadAfterPublicationSequence",
      "initialAuthorityEpoch",
      "replacementAuthorityEpoch",
      "finalPublicationSequence",
    ],
    "automated proof summary",
  );
  if (
    typeof summary.controlTempoRatio !== "number" ||
    !Number.isFinite(summary.controlTempoRatio)
  ) {
    throw new TypeError("controlTempoRatio must be finite");
  }
  for (const value of [
    summary.reloadBeforeSamplePosition,
    summary.reloadAfterSamplePosition,
    summary.initialAuthorityEpoch,
    summary.replacementAuthorityEpoch,
  ]) {
    if (!isCanonicalAuthorityEpoch(value)) throw new TypeError("proof decimal value is invalid");
  }
  for (const value of [
    summary.reloadBeforePublicationSequence,
    summary.reloadAfterPublicationSequence,
    summary.finalPublicationSequence,
  ]) {
    if (!isCanonicalU64Hex(value)) throw new TypeError("proof sequence value is invalid");
  }
}
