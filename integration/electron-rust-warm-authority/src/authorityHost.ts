import {
  type ControlFailureEnvelope,
  type ControlSuccessEnvelope,
  createControlFailureEnvelope,
} from "@exclave/control-plane";
import { decodeWarmLaneFrame } from "@exclave/warm";
import type { MessagePortMain } from "electron";
import { AuthorityProcess, type AuthorityProcessEvent } from "./authorityProcess.js";
import { RendererPublicationDelivery, type RoutedWarmPublication } from "./boundedDelivery.js";
import type { AutomatedProofSummary, TransportDiagnostics } from "./bridgeTypes.js";
import {
  DECK_RUNTIME_CONTRACT_KEY,
  DECK_RUNTIME_SEMANTIC_VERSION,
  DECK_RUNTIME_WARM_CODEC_VERSION,
  PROJECTION_INSTANCE_KEY,
  WARM_STREAM_KEY,
} from "./contract.js";
import {
  type HostToPreloadMessage,
  type PreloadToHostMessage,
  parsePreloadToHostMessage,
  type SerializedSubscribePublicationAck,
} from "./portProtocol.js";
import {
  AutomatedProofAudit,
  type AutomatedProofReport,
  type ReloadCheckpoint,
} from "./proofAudit.js";
import type { SidecarTransportMetrics, SidecarWarmPublication } from "./sidecarMessages.js";
import { decodeU64Hex, encodeU64Hex } from "./wireValues.js";

export const CLIENT_PORT_CHANNEL = "exclave:deck-client-port";

export type AuthorityHostOptions = {
  readonly authorityExecutablePath: string;
  readonly integrationTestEpochs?: readonly string[];
  readonly integrationReadyDelayMs?: number;
  readonly restartDelayMs?: number;
  readonly downstreamProofWindowMs?: number;
  readonly onProofComplete?: (report: AutomatedProofReport) => void;
  readonly onProofFailure?: (message: string) => void;
  readonly onAuthorityProcessSpawned?: (pid: number) => void;
};

export type AuthorityStopReport = {
  readonly processStopped: boolean;
  readonly exitCode: number | null;
  readonly exitWasExpected: boolean;
};

type ClientSession = {
  readonly id: number;
  readonly port: MessagePortMain;
  delivery: RendererPublicationDelivery;
  subscription: SerializedSubscribePublicationAck | null;
  closed: boolean;
  upstreamCreditsPaused: boolean;
  proofFlowPauseEstablished: boolean;
  flowResumeInFlight: boolean;
  deferredCredit: PublicationCredit | null;
  pauseTimer: NodeJS.Timeout | null;
  previousSentSequence: bigint | null;
  skippedPublicationCount: number;
};

type PublicationCredit = {
  readonly subscriptionId: string;
  readonly authorityEpoch: string;
  readonly publicationSequence: string;
};

type PendingClientRequest = {
  readonly client: ClientSession;
  readonly rendererRequestKey: string;
};

type PendingSubscribe = PendingClientRequest & {
  readonly authorityEpoch: string;
  readonly requestedWhileStarting: boolean;
};

type PendingControl =
  | ({ readonly kind: "renderer" } & PendingClientRequest)
  | {
      readonly kind: "staleEpochProbe";
      readonly staleAuthorityEpoch: string;
      readonly currentAuthorityEpoch: string;
    };

type PendingUnsubscribe = {
  readonly client: ClientSession;
  readonly rendererRequestKey: string | null;
  readonly retiredSubscriptionKey: string;
  readonly recordClosedSubscriptionId: string | null;
};

type PendingMetricsRequest = {
  readonly resolve: (metrics: SidecarTransportMetrics) => void;
  readonly reject: (error: Error) => void;
  readonly timeout: NodeJS.Timeout;
};

type AuthorityState = "unavailable" | "starting" | "ready";

export class AuthorityHost {
  private readonly options: Required<
    Pick<AuthorityHostOptions, "restartDelayMs" | "downstreamProofWindowMs">
  > &
    AuthorityHostOptions;
  private readonly clients = new Map<number, ClientSession>();
  private readonly subscriptionOwners = new Map<string, ClientSession>();
  private readonly retiredSubscriptions = new Map<string, SerializedSubscribePublicationAck>();
  private readonly pendingSubscribes = new Map<string, PendingSubscribe>();
  private readonly pendingUnsubscribes = new Map<string, PendingUnsubscribe>();
  private readonly pendingControls = new Map<string, PendingControl>();
  private readonly pendingMetrics = new Map<string, PendingMetricsRequest>();
  private readonly proofAudit = new AutomatedProofAudit();
  private readonly seenAuthorityEpochs = new Set<string>();
  private authority: AuthorityProcess | null = null;
  private authorityState: AuthorityState = "unavailable";
  private authorityFailureLatched = false;
  private authorityEpoch: string | null = null;
  private nextClientId = 1;
  private nextSidecarRequestOrdinal = 1;
  private authorityStartOrdinal = 0;
  private stopping = false;
  private restartTimer: NodeJS.Timeout | null = null;
  private proofCompletionStarted = false;
  private restartProofInFlight = false;
  private staleEpochForControlProbe: string | null = null;
  private retiredDownstreamCoalescedCount = 0;
  private retiredSkippedPublicationCount = 0;
  private maxDownstreamInFlightCount = 0;
  private maxDownstreamPendingCount = 0;
  private retiredUpstreamCoalescedCount = 0;
  private observedCurrentUpstreamCoalescedCount = 0;
  private currentAuthorityMetrics: SidecarTransportMetrics | null = null;
  private maxUpstreamInFlightCount = 0;
  private maxUpstreamPendingCount = 0;
  private lastAuthorityExit: Extract<AuthorityProcessEvent, { readonly kind: "exit" }> | null =
    null;

  constructor(options: AuthorityHostOptions) {
    this.options = {
      ...options,
      restartDelayMs: options.restartDelayMs ?? 300,
      downstreamProofWindowMs: options.downstreamProofWindowMs ?? 180,
    };
  }

  start(): void {
    if (this.stopping) throw new Error("authority host is stopping");
    if (this.authority !== null) throw new Error("authority host is already started");
    this.startAuthority();
  }

  attachRendererPort(port: MessagePortMain): () => void {
    if (this.stopping) throw new Error("cannot attach a renderer while authority host is stopping");
    const client: ClientSession = {
      id: this.nextClientId,
      port,
      delivery: new RendererPublicationDelivery(),
      subscription: null,
      closed: false,
      upstreamCreditsPaused: false,
      proofFlowPauseEstablished: false,
      flowResumeInFlight: false,
      deferredCredit: null,
      pauseTimer: null,
      previousSentSequence: null,
      skippedPublicationCount: 0,
    };
    this.nextClientId += 1;
    this.clients.set(client.id, client);

    port.on("message", (event) => this.receiveClientMessage(client, event.data));
    port.on("close", () => this.closeClient(client));
    port.start();

    if (this.authorityEpoch !== null && this.authorityState !== "unavailable") {
      this.send(client, {
        kind: this.authorityState === "ready" ? "authorityReady" : "authorityStarting",
        authorityEpoch: this.authorityEpoch,
      });
    }

    return () => this.closeClient(client);
  }

  async stop(): Promise<AuthorityStopReport> {
    this.stopping = true;
    if (this.restartTimer !== null) {
      clearTimeout(this.restartTimer);
      this.restartTimer = null;
    }
    for (const client of [...this.clients.values()]) this.closeClient(client);
    this.rejectPendingMetrics(new Error("authority host stopped"));

    const authority = this.authority;
    const processStopped = authority === null ? true : await authority.stop();
    this.authority = null;
    this.authorityState = "unavailable";
    this.authorityEpoch = null;

    return {
      processStopped,
      exitCode: this.lastAuthorityExit?.code ?? null,
      exitWasExpected: this.lastAuthorityExit?.expected ?? authority === null,
    };
  }

  private startAuthority(): void {
    const configuredEpoch = this.options.integrationTestEpochs?.[this.authorityStartOrdinal];
    if (this.options.integrationTestEpochs !== undefined && configuredEpoch === undefined) {
      this.broadcastFailure(
        "host.testEpochsExhausted",
        "authority restart exceeded deterministic test epoch allocation",
      );
      return;
    }

    const continuityGeneration = this.authorityStartOrdinal + 1;
    if (continuityGeneration > 0xffff_ffff) {
      this.broadcastFailure(
        "host.continuityGenerationExhausted",
        "authority restart exhausted the u32 continuity generation domain",
      );
      return;
    }
    this.authorityStartOrdinal = continuityGeneration;
    this.authorityState = "starting";
    this.authorityFailureLatched = false;
    this.authorityEpoch = null;
    this.currentAuthorityMetrics = null;
    this.observedCurrentUpstreamCoalescedCount = 0;

    const authority = new AuthorityProcess({
      executablePath: this.options.authorityExecutablePath,
      continuityGeneration,
      ...(configuredEpoch !== undefined ? { integrationTestEpoch: configuredEpoch } : {}),
      ...(this.options.integrationReadyDelayMs !== undefined
        ? { integrationReadyDelayMs: this.options.integrationReadyDelayMs }
        : {}),
    });
    this.authority = authority;
    authority.onEvent((event) => this.receiveAuthorityEvent(authority, event));
    const pid = authority.start();
    if (pid !== null) this.options.onAuthorityProcessSpawned?.(pid);
  }

  private receiveAuthorityEvent(authority: AuthorityProcess, event: AuthorityProcessEvent): void {
    if (authority !== this.authority && event.kind !== "exit") return;
    if (authority === this.authority && this.authorityFailureLatched && event.kind !== "exit") {
      return;
    }

    switch (event.kind) {
      case "authorityStarting":
        this.handleAuthorityStarting(event.authorityEpoch);
        break;
      case "authorityReady":
        this.handleAuthorityReady(event.authorityEpoch);
        break;
      case "subscribeResult":
        this.handleSubscribeResult(event);
        break;
      case "unsubscribeResult":
        this.handleUnsubscribeResult(event);
        break;
      case "controlResponse":
        this.handleControlResponse(event.response);
        break;
      case "warmPublication":
        this.handleWarmPublication(event);
        break;
      case "metricsResponse":
        this.handleMetricsResponse(event.requestKey, event.metrics);
        break;
      case "protocolFailure":
        this.failAuthority(event.message, false);
        break;
      case "exit":
        this.handleAuthorityExit(authority, event);
        break;
    }
  }

  private handleAuthorityStarting(authorityEpoch: string): void {
    if (this.authorityEpoch !== null || this.seenAuthorityEpochs.has(authorityEpoch)) {
      this.failAuthority(`authority reused or repeated epoch ${authorityEpoch}`);
      return;
    }
    try {
      this.proofAudit.recordAuthorityStarting(authorityEpoch);
    } catch (error) {
      this.failAuthority(errorMessage(error));
      return;
    }
    this.seenAuthorityEpochs.add(authorityEpoch);
    this.authorityEpoch = authorityEpoch;
    this.authorityState = "starting";
    this.broadcast({ kind: "authorityStarting", authorityEpoch });
  }

  private handleAuthorityReady(authorityEpoch: string): void {
    const authority = this.authority;
    if (
      authority === null ||
      this.authorityState !== "starting" ||
      this.authorityEpoch !== authorityEpoch ||
      authority.pid === null
    ) {
      this.failAuthority("authorityReady did not match the active starting authority");
      return;
    }
    this.authorityState = "ready";
    try {
      this.proofAudit.recordAuthorityReady(authorityEpoch, authority.pid);
    } catch (error) {
      this.failAuthority(errorMessage(error));
      return;
    }
    this.broadcast({ kind: "authorityReady", authorityEpoch });
    const staleAuthorityEpoch = this.staleEpochForControlProbe;
    if (staleAuthorityEpoch !== null) {
      this.staleEpochForControlProbe = null;
      this.probeStaleEpochControl(staleAuthorityEpoch, authorityEpoch);
    }
  }

  private handleAuthorityExit(
    authority: AuthorityProcess,
    event: Extract<AuthorityProcessEvent, { readonly kind: "exit" }>,
  ): void {
    this.lastAuthorityExit = event;
    if (authority !== this.authority) return;

    const replacedAuthorityEpoch = this.authorityEpoch;
    const authorityWasAlreadyInvalidated = this.authorityFailureLatched;
    this.authority = null;
    this.authorityState = "unavailable";
    this.authorityEpoch = null;
    this.currentAuthorityMetrics = null;
    if (!authorityWasAlreadyInvalidated) {
      this.rejectAuthorityRequests("authority process exited");
      for (const client of this.clients.values()) this.invalidateClientSubscription(client);
    }
    this.retiredSubscriptions.clear();

    if (replacedAuthorityEpoch !== null && !authorityWasAlreadyInvalidated) {
      if (!this.stopping && !event.expected) {
        this.staleEpochForControlProbe = replacedAuthorityEpoch;
      }
      this.broadcast({ kind: "authorityUnavailable", replacedAuthorityEpoch });
    } else if (
      replacedAuthorityEpoch === null &&
      !this.stopping &&
      !authorityWasAlreadyInvalidated
    ) {
      this.broadcastFailure(
        "host.authorityExitedBeforeEpoch",
        `authority exited before declaring an epoch${event.stderr.length > 0 ? `: ${event.stderr}` : ""}`,
      );
    }

    if (
      replacedAuthorityEpoch !== null &&
      authorityWasAlreadyInvalidated &&
      !this.stopping &&
      !event.expected
    ) {
      this.staleEpochForControlProbe = replacedAuthorityEpoch;
    }
    this.authorityFailureLatched = false;

    if (this.stopping || event.expected) return;
    this.restartTimer = setTimeout(() => {
      this.restartTimer = null;
      if (!this.stopping && this.authority === null) this.startAuthority();
    }, this.options.restartDelayMs);
  }

  private receiveClientMessage(client: ClientSession, value: unknown): void {
    if (client.closed) return;
    let message: PreloadToHostMessage;
    try {
      message = parsePreloadToHostMessage(value);
    } catch (error) {
      this.sendFailure(client, "host.rendererMessageRejected", errorMessage(error));
      return;
    }

    switch (message.kind) {
      case "subscribeRuntime":
        this.subscribeClient(client, message);
        break;
      case "unsubscribeRuntime":
        this.unsubscribeClient(client, message);
        break;
      case "setTempoRatio":
        this.controlTempoRatio(client, message);
        break;
      case "publicationApplied":
        this.acknowledgeRendererPublication(client, message);
        break;
      case "proofSetPublicationFlowPaused":
        this.setProofFlowPaused(client, message.requestKey, message.paused);
        break;
      case "proofRestartAuthority":
        void this.restartAuthorityForProof(client, message.requestKey);
        break;
      case "proofReloadCheckpoint":
        this.recordReloadCheckpoint(client, message);
        break;
      case "proofComplete":
        void this.completeProof(client, message.requestKey, message.summary);
        break;
    }
  }

  private subscribeClient(
    client: ClientSession,
    message: Extract<PreloadToHostMessage, { readonly kind: "subscribeRuntime" }>,
  ): void {
    const authority = this.authority;
    const authorityEpoch = this.authorityEpoch;
    if (authority === null || authorityEpoch === null || this.authorityState === "unavailable") {
      this.send(client, {
        kind: "subscribeResult",
        requestKey: message.requestKey,
        result: { ok: false, failure: { kind: "authorityUnavailable" } },
      });
      return;
    }
    if (client.subscription !== null) {
      this.send(client, {
        kind: "subscribeResult",
        requestKey: message.requestKey,
        result: { ok: false, failure: { kind: "surfaceUnavailable" } },
      });
      return;
    }
    if ([...this.pendingSubscribes.values()].some((pending) => pending.client === client)) {
      this.send(client, {
        kind: "subscribeResult",
        requestKey: message.requestKey,
        result: { ok: false, failure: { kind: "surfaceDeferredNotReady" } },
      });
      return;
    }

    this.proofAudit.recordSubscribeRequest(authorityEpoch);
    const sidecarRequestKey = this.sidecarRequestKey("subscribe");
    this.pendingSubscribes.set(sidecarRequestKey, {
      client,
      rendererRequestKey: message.requestKey,
      authorityEpoch,
      requestedWhileStarting: this.authorityState === "starting",
    });
    authority.subscribe(sidecarRequestKey, message.request);
  }

  private handleSubscribeResult(
    event: Extract<AuthorityProcessEvent, { readonly kind: "subscribeResult" }>,
  ): void {
    const pending = this.pendingSubscribes.get(event.requestKey);
    if (pending === undefined) {
      this.failAuthority(`uncorrelated subscribe result ${event.requestKey}`);
      return;
    }
    this.pendingSubscribes.delete(event.requestKey);
    if (pending.client.closed) {
      if (event.result.ok) {
        try {
          this.retireLateSubscription(pending.client, event.result.ack);
        } catch (error) {
          this.failAuthority(errorMessage(error));
        }
      }
      return;
    }

    if (event.result.ok) {
      try {
        this.assertSubscribeAck(event.result.ack);
        const key = subscriptionKey(
          event.result.ack.authorityEpoch,
          event.result.ack.subscriptionId,
        );
        if (this.subscriptionOwners.has(key)) {
          throw new Error(`duplicate subscription identity ${event.result.ack.subscriptionId}`);
        }
        pending.client.subscription = event.result.ack;
        this.proofAudit.recordSubscription({
          authorityEpoch: event.result.ack.authorityEpoch,
          subscriptionId: event.result.ack.subscriptionId,
          baselineEpoch: event.result.ack.baselineEpoch,
          continuityGeneration: event.result.ack.continuityGeneration,
        });
        pending.client.delivery = new RendererPublicationDelivery();
        pending.client.previousSentSequence = null;
        pending.client.skippedPublicationCount = 0;
        this.subscriptionOwners.set(key, pending.client);
      } catch (error) {
        this.failAuthority(errorMessage(error));
        return;
      }
    } else if (
      pending.requestedWhileStarting &&
      event.result.failure.kind === "authorityNotReady"
    ) {
      try {
        this.proofAudit.recordPreReadySubscriptionRejected(pending.authorityEpoch);
      } catch (error) {
        this.failAuthority(errorMessage(error));
        return;
      }
    }

    this.send(pending.client, {
      kind: "subscribeResult",
      requestKey: pending.rendererRequestKey,
      result: event.result,
    });
  }

  private unsubscribeClient(
    client: ClientSession,
    message: Extract<PreloadToHostMessage, { readonly kind: "unsubscribeRuntime" }>,
  ): void {
    const subscription = client.subscription;
    if (
      subscription === null ||
      subscription.subscriptionId !== message.subscriptionId ||
      subscription.authorityEpoch !== message.authorityEpoch
    ) {
      this.send(client, {
        kind: "unsubscribeResult",
        requestKey: message.requestKey,
        ok: false,
      });
      return;
    }

    const authority = this.authority;
    this.releaseDeferredCredit(client);
    this.removeSubscriptionRoute(client);
    if (authority === null || this.authorityEpoch !== message.authorityEpoch) {
      this.send(client, {
        kind: "unsubscribeResult",
        requestKey: message.requestKey,
        ok: false,
      });
      return;
    }

    const sidecarRequestKey = this.sidecarRequestKey("unsubscribe");
    const retiredSubscriptionKey = subscriptionKey(message.authorityEpoch, message.subscriptionId);
    this.pendingUnsubscribes.set(sidecarRequestKey, {
      client,
      rendererRequestKey: message.requestKey,
      retiredSubscriptionKey,
      recordClosedSubscriptionId: subscription.subscriptionId,
    });
    authority.unsubscribe({
      requestKey: sidecarRequestKey,
      subscriptionId: message.subscriptionId,
      authorityEpoch: message.authorityEpoch,
    });
  }

  private handleUnsubscribeResult(
    event: Extract<AuthorityProcessEvent, { readonly kind: "unsubscribeResult" }>,
  ): void {
    const pending = this.pendingUnsubscribes.get(event.requestKey);
    if (pending === undefined) {
      this.failAuthority(`uncorrelated unsubscribe result ${event.requestKey}`);
      return;
    }
    this.pendingUnsubscribes.delete(event.requestKey);
    if (!event.ok) {
      this.failAuthority(`authority rejected correlated unsubscribe ${event.requestKey}`);
      return;
    }
    this.retiredSubscriptions.delete(pending.retiredSubscriptionKey);
    if (pending.recordClosedSubscriptionId !== null) {
      this.proofAudit.recordClientClosed(pending.recordClosedSubscriptionId);
    }
    if (!pending.client.closed && pending.rendererRequestKey !== null) {
      this.send(pending.client, {
        kind: "unsubscribeResult",
        requestKey: pending.rendererRequestKey,
        ok: event.ok,
      });
    }
  }

  private controlTempoRatio(
    client: ClientSession,
    message: Extract<PreloadToHostMessage, { readonly kind: "setTempoRatio" }>,
  ): void {
    const authority = this.authority;
    if (
      authority === null ||
      this.authorityState !== "ready" ||
      this.authorityEpoch !== message.authorityEpoch
    ) {
      this.sendControlFailure(
        client,
        message.requestKey,
        "authority is unavailable or the renderer epoch is stale",
      );
      return;
    }
    if (
      [...this.pendingControls.values()].some(
        (pending) => pending.kind === "renderer" && pending.client === client,
      )
    ) {
      this.sendControlFailure(client, message.requestKey, "one typed control is already in flight");
      return;
    }

    const sidecarRequestKey = this.sidecarRequestKey("control");
    this.pendingControls.set(sidecarRequestKey, {
      kind: "renderer",
      client,
      rendererRequestKey: message.requestKey,
    });
    authority.setTempoRatio({
      requestKey: sidecarRequestKey,
      authorityEpoch: message.authorityEpoch,
      tempoRatio: message.value,
    });
  }

  private handleControlResponse(response: ControlSuccessEnvelope | ControlFailureEnvelope): void {
    const pending = this.pendingControls.get(response.requestKey);
    if (pending === undefined) {
      this.failAuthority(`uncorrelated control response ${response.requestKey}`);
      return;
    }
    this.pendingControls.delete(response.requestKey);
    if (pending.kind === "staleEpochProbe") {
      if (
        response.ok ||
        response.failure.code !== "control.bindingInvalid" ||
        response.failure.details?.reason !== "authorityEpochMismatch"
      ) {
        this.failAuthority("replacement authority accepted or misclassified an old-epoch control");
        return;
      }
      this.proofAudit.recordStaleEpochControlRejected(
        pending.staleAuthorityEpoch,
        pending.currentAuthorityEpoch,
      );
      return;
    }
    if (pending.client.closed) return;

    const rendererResponse = { ...response, requestKey: pending.rendererRequestKey };
    if (rendererResponse.ok) {
      try {
        const payload = rendererResponse.payload as Record<string, unknown>;
        const returnedAuthorityEpoch = payload.authorityEpoch;
        const returnedTempoRatio = payload.tempoRatio;
        if (
          Object.keys(payload).toSorted().join(",") !== "authorityEpoch,tempoRatio" ||
          typeof returnedAuthorityEpoch !== "string" ||
          returnedAuthorityEpoch !== this.authorityEpoch ||
          typeof returnedTempoRatio !== "number" ||
          !Number.isFinite(returnedTempoRatio)
        ) {
          throw new Error("authority returned an invalid setTempoRatio payload");
        }
        this.proofAudit.recordSuccessfulControl(returnedAuthorityEpoch, returnedTempoRatio);
      } catch (error) {
        this.failAuthority(errorMessage(error));
        return;
      }
    }

    this.send(pending.client, {
      kind: "controlResponse",
      requestKey: pending.rendererRequestKey,
      response: rendererResponse,
    });
  }

  private handleWarmPublication(publication: SidecarWarmPublication): void {
    const authority = this.authority;
    const currentEpoch = this.authorityEpoch;
    if (authority === null || currentEpoch === null || this.authorityState !== "ready") {
      this.failAuthority("authority emitted a publication while it was not ready");
      return;
    }
    if (publication.attachment.authorityEpoch !== currentEpoch) {
      this.failAuthority("authority emitted a publication for a stale epoch");
      return;
    }

    const key = subscriptionKey(
      publication.attachment.authorityEpoch,
      publication.attachment.subscriptionId,
    );
    const client = this.subscriptionOwners.get(key);
    if (client === undefined) {
      const retiredSubscription = this.retiredSubscriptions.get(key);
      if (retiredSubscription !== undefined) {
        try {
          this.decodePublicationSequence(retiredSubscription, publication);
        } catch (error) {
          this.failAuthority(errorMessage(error));
        }
        return;
      }
      this.failAuthority(`publication targeted unknown subscription ${key}`);
      return;
    }

    let routed: RoutedWarmPublication;
    try {
      routed = this.validateAndRoutePublication(client, publication);
    } catch (error) {
      this.failAuthority(errorMessage(error));
      return;
    }

    this.observedCurrentUpstreamCoalescedCount = Math.max(
      this.observedCurrentUpstreamCoalescedCount,
      publication.upstreamCoalescedPublicationCount,
    );
    const offer = client.delivery.offer(routed);
    this.captureDownstreamBounds(client);
    if (offer.action === "send") this.sendPublication(client, offer.publication);
    if (client.closed) return;

    const credit: PublicationCredit = {
      subscriptionId: publication.attachment.subscriptionId,
      authorityEpoch: publication.attachment.authorityEpoch,
      publicationSequence: routed.publicationSequence,
    };
    if (client.upstreamCreditsPaused) {
      if (client.deferredCredit !== null) {
        this.failAuthority("more than one upstream publication arrived while credit was paused");
        return;
      }
      client.deferredCredit = credit;
    } else {
      authority.acknowledgePublication(credit);
    }
  }

  private probeStaleEpochControl(staleAuthorityEpoch: string, currentAuthorityEpoch: string): void {
    const authority = this.requireReadyAuthority();
    const requestKey = this.sidecarRequestKey("stale-control-proof");
    this.pendingControls.set(requestKey, {
      kind: "staleEpochProbe",
      staleAuthorityEpoch,
      currentAuthorityEpoch,
    });
    authority.setTempoRatio({
      requestKey,
      authorityEpoch: staleAuthorityEpoch,
      tempoRatio: 1.75,
    });
  }

  private validateAndRoutePublication(
    client: ClientSession,
    publication: SidecarWarmPublication,
  ): RoutedWarmPublication {
    const subscription = client.subscription;
    if (subscription === null) throw new Error("publication client has no active subscription");
    const publicationSequence = this.decodePublicationSequence(subscription, publication);
    return {
      kind: "publication",
      attachment: publication.attachment,
      frameBytes: publication.frameBytes,
      publicationSequence,
      upstreamCoalescedPublicationCount: publication.upstreamCoalescedPublicationCount,
      downstreamCoalescedPublicationCount:
        client.delivery.metrics().downstreamCoalescedPublicationCount,
    };
  }

  private decodePublicationSequence(
    subscription: SerializedSubscribePublicationAck,
    publication: SidecarWarmPublication,
  ): string {
    const decoded = decodeWarmLaneFrame(publication.frameBytes);
    if (!decoded.ok) throw new Error(decoded.failure.detail);
    const frame = decoded.frame;
    if (
      publication.attachment.kind !== "publication.warmFrame" ||
      publication.attachment.streamKey !== WARM_STREAM_KEY ||
      publication.attachment.subscriptionId !== subscription.subscriptionId ||
      publication.attachment.authorityEpoch !== subscription.authorityEpoch ||
      publication.attachment.contractKey !== subscription.contractKey ||
      publication.attachment.projectionInstanceKey !== subscription.projectionInstanceKey ||
      frame.contractKey !== subscription.contractKey ||
      frame.projectionInstanceKey !== subscription.projectionInstanceKey ||
      frame.semanticVersion !== DECK_RUNTIME_SEMANTIC_VERSION ||
      frame.warmCodecVersion !== DECK_RUNTIME_WARM_CODEC_VERSION ||
      frame.baselineEpoch !== subscription.baselineEpoch ||
      frame.continuityGeneration !== subscription.continuityGeneration
    ) {
      throw new Error(
        "warm publication identity did not match the acknowledged generated contract",
      );
    }

    return encodeU64Hex(frame.publicationSequence);
  }

  private acknowledgeRendererPublication(
    client: ClientSession,
    message: Extract<PreloadToHostMessage, { readonly kind: "publicationApplied" }>,
  ): void {
    const acknowledged = client.delivery.acknowledge(message);
    if (!acknowledged.ok) {
      this.sendFailure(
        client,
        "host.publicationAckRejected",
        `renderer publication acknowledgement was rejected: ${acknowledged.reason}`,
      );
      return;
    }
    if (acknowledged.nextPublication !== null) {
      this.sendPublication(client, acknowledged.nextPublication);
    } else {
      this.sendDiagnostics(client);
    }
  }

  private sendPublication(client: ClientSession, publication: RoutedWarmPublication): void {
    const sequence = decodeU64Hex(publication.publicationSequence, "publication sequence");
    if (client.previousSentSequence !== null && sequence > client.previousSentSequence + 1n) {
      client.skippedPublicationCount = saturatingAdd(
        client.skippedPublicationCount,
        sequence - client.previousSentSequence - 1n,
      );
    }
    client.previousSentSequence = sequence;
    const { publicationSequence: _publicationSequence, ...message } = publication;
    this.send(client, {
      ...message,
      upstreamCoalescedPublicationCount: Math.max(
        publication.upstreamCoalescedPublicationCount,
        this.observedCurrentUpstreamCoalescedCount,
      ),
      downstreamCoalescedPublicationCount:
        client.delivery.metrics().downstreamCoalescedPublicationCount,
    });
    this.sendDiagnostics(client);
  }

  private setProofFlowPaused(
    client: ClientSession,
    rendererRequestKey: string,
    paused: boolean,
  ): void {
    if (paused) {
      if (
        client.pauseTimer !== null ||
        client.proofFlowPauseEstablished ||
        client.flowResumeInFlight
      ) {
        this.sendFailure(
          client,
          "host.proofFlowAlreadyPaused",
          "publication flow is already paused",
        );
        return;
      }
      client.pauseTimer = setTimeout(() => {
        client.pauseTimer = null;
        if (client.closed) return;
        client.upstreamCreditsPaused = true;
        client.proofFlowPauseEstablished = true;
        this.sendProofResult(client, rendererRequestKey);
      }, this.options.downstreamProofWindowMs);
      return;
    }

    if (!client.proofFlowPauseEstablished || client.flowResumeInFlight) {
      this.sendFailure(client, "host.proofFlowNotPaused", "publication flow is not paused");
      return;
    }
    client.proofFlowPauseEstablished = false;
    client.flowResumeInFlight = true;
    client.upstreamCreditsPaused = false;
    this.releaseDeferredCredit(client);
    void this.finishProofFlowResume(client, rendererRequestKey);
  }

  private async finishProofFlowResume(
    client: ClientSession,
    rendererRequestKey: string,
  ): Promise<void> {
    try {
      const metrics = await this.requestAuthorityMetrics();
      this.currentAuthorityMetrics = metrics;
      this.captureAuthorityBounds(metrics);
      this.sendDiagnostics(client);
      this.sendProofResult(client, rendererRequestKey);
    } catch (error) {
      this.sendFailure(client, "host.proofFlowResumeFailed", errorMessage(error));
    } finally {
      client.flowResumeInFlight = false;
    }
  }

  private async restartAuthorityForProof(
    client: ClientSession,
    rendererRequestKey: string,
  ): Promise<void> {
    if (this.restartProofInFlight) {
      this.sendFailure(
        client,
        "host.proofRestartInFlight",
        "authority restart is already in flight",
      );
      return;
    }
    this.restartProofInFlight = true;
    try {
      const authority = this.requireReadyAuthority();
      const metrics = await this.requestAuthorityMetrics();
      this.retireAuthorityMetrics(metrics);
      this.proofAudit.recordRestartRequest();
      authority.crashForProof();
      this.sendProofResult(client, rendererRequestKey);
    } catch (error) {
      this.sendFailure(client, "host.proofRestartFailed", errorMessage(error));
    } finally {
      this.restartProofInFlight = false;
    }
  }

  private recordReloadCheckpoint(
    client: ClientSession,
    message: Extract<PreloadToHostMessage, { readonly kind: "proofReloadCheckpoint" }>,
  ): void {
    const authority = this.authority;
    const authorityEpoch = this.authorityEpoch;
    if (
      authority === null ||
      authority.pid === null ||
      authorityEpoch === null ||
      this.authorityState !== "ready"
    ) {
      this.sendFailure(client, "host.reloadCheckpointRejected", "authority is not ready");
      return;
    }
    const checkpoint: ReloadCheckpoint = {
      phase: message.phase,
      samplePosition: message.samplePosition,
      publicationSequence: message.publicationSequence,
      authorityEpoch,
      authorityPid: authority.pid,
      clientId: client.id,
      subscriptionId: client.subscription?.subscriptionId ?? null,
    };
    try {
      this.proofAudit.recordReloadCheckpoint(checkpoint);
      this.sendProofResult(client, message.requestKey);
    } catch (error) {
      this.sendFailure(client, "host.reloadCheckpointRejected", errorMessage(error));
    }
  }

  private async completeProof(
    client: ClientSession,
    rendererRequestKey: string,
    summary: AutomatedProofSummary,
  ): Promise<void> {
    if (this.proofCompletionStarted) {
      this.sendFailure(client, "host.proofAlreadyCompleted", "automated proof already started");
      return;
    }
    this.proofCompletionStarted = true;
    try {
      const metrics = await this.requestAuthorityMetrics();
      this.currentAuthorityMetrics = metrics;
      this.captureAuthorityBounds(metrics);
      const diagnostics = this.combinedDiagnostics(client);
      const report = this.proofAudit.complete(summary, diagnostics);
      this.send(client, { kind: "transportDiagnostics", diagnostics });
      this.sendProofResult(client, rendererRequestKey);
      queueMicrotask(() => this.options.onProofComplete?.(report));
    } catch (error) {
      this.proofCompletionStarted = false;
      const message = errorMessage(error);
      this.sendFailure(client, "host.automatedProofFailed", message);
      queueMicrotask(() => this.options.onProofFailure?.(message));
    }
  }

  private requestAuthorityMetrics(): Promise<SidecarTransportMetrics> {
    const authority = this.requireReadyAuthority();
    const requestKey = this.sidecarRequestKey("metrics");
    const result = new Promise<SidecarTransportMetrics>((resolve, reject) => {
      const timeout = setTimeout(() => {
        this.pendingMetrics.delete(requestKey);
        reject(new Error("authority metrics request timed out"));
      }, 2_000);
      this.pendingMetrics.set(requestKey, { resolve, reject, timeout });
    });
    authority.requestMetrics(requestKey);
    return result;
  }

  private handleMetricsResponse(requestKey: string, metrics: SidecarTransportMetrics): void {
    const pending = this.pendingMetrics.get(requestKey);
    if (pending === undefined) {
      this.failAuthority(`uncorrelated metrics response ${requestKey}`);
      return;
    }
    this.pendingMetrics.delete(requestKey);
    clearTimeout(pending.timeout);
    pending.resolve(metrics);
  }

  private retireAuthorityMetrics(metrics: SidecarTransportMetrics): void {
    this.retiredUpstreamCoalescedCount += metrics.upstreamCoalescedPublicationCount;
    this.captureAuthorityBounds(metrics);
    this.currentAuthorityMetrics = null;
    this.observedCurrentUpstreamCoalescedCount = 0;
  }

  private captureAuthorityBounds(metrics: SidecarTransportMetrics): void {
    this.maxUpstreamInFlightCount = Math.max(
      this.maxUpstreamInFlightCount,
      metrics.maxInFlightCount,
    );
    this.maxUpstreamPendingCount = Math.max(this.maxUpstreamPendingCount, metrics.maxPendingCount);
  }

  private captureDownstreamBounds(client: ClientSession): void {
    const metrics = client.delivery.metrics();
    this.maxDownstreamInFlightCount = Math.max(
      this.maxDownstreamInFlightCount,
      metrics.maxInFlightCount,
    );
    this.maxDownstreamPendingCount = Math.max(
      this.maxDownstreamPendingCount,
      metrics.maxPendingCount,
    );
  }

  private combinedDiagnostics(client: ClientSession): TransportDiagnostics {
    const currentDelivery = client.delivery.metrics();
    let activeDownstreamCoalesced = 0;
    let activeSkipped = 0;
    for (const activeClient of this.clients.values()) {
      activeDownstreamCoalesced +=
        activeClient.delivery.metrics().downstreamCoalescedPublicationCount;
      activeSkipped += activeClient.skippedPublicationCount;
    }
    const currentUpstreamCoalesced =
      this.currentAuthorityMetrics?.upstreamCoalescedPublicationCount ??
      this.observedCurrentUpstreamCoalescedCount;
    return {
      upstreamCoalescedPublicationCount:
        this.retiredUpstreamCoalescedCount + currentUpstreamCoalesced,
      downstreamCoalescedPublicationCount:
        this.retiredDownstreamCoalescedCount + activeDownstreamCoalesced,
      skippedPublicationCount: this.retiredSkippedPublicationCount + activeSkipped,
      maxUpstreamInFlightCount: this.maxUpstreamInFlightCount,
      maxUpstreamPendingCount: this.maxUpstreamPendingCount,
      maxDownstreamInFlightCount: this.maxDownstreamInFlightCount,
      maxDownstreamPendingCount: this.maxDownstreamPendingCount,
      latestDeliveredPublicationSequence: currentDelivery.latestDeliveredPublicationSequence,
    };
  }

  private sendDiagnostics(client: ClientSession): void {
    this.send(client, {
      kind: "transportDiagnostics",
      diagnostics: this.combinedDiagnostics(client),
    });
  }

  private assertSubscribeAck(ack: SerializedSubscribePublicationAck): void {
    if (
      this.authorityEpoch === null ||
      ack.authorityEpoch !== this.authorityEpoch ||
      ack.contractKey !== DECK_RUNTIME_CONTRACT_KEY ||
      ack.projectionInstanceKey !== PROJECTION_INSTANCE_KEY ||
      ack.lane !== "warm" ||
      decodeU64Hex(ack.semanticVersion, "subscribe semanticVersion") !==
        DECK_RUNTIME_SEMANTIC_VERSION ||
      decodeU64Hex(ack.laneVersion, "subscribe laneVersion") !== DECK_RUNTIME_WARM_CODEC_VERSION
    ) {
      throw new Error("authority subscribe acknowledgement did not match the active contract");
    }
  }

  private invalidateClientSubscription(client: ClientSession, releaseCredit = true): void {
    if (releaseCredit) {
      this.releaseDeferredCredit(client);
    } else {
      client.deferredCredit = null;
    }
    this.retireClientDelivery(client);
    this.removeSubscriptionRoute(client);
    client.delivery = new RendererPublicationDelivery();
    client.previousSentSequence = null;
    client.skippedPublicationCount = 0;
  }

  private removeSubscriptionRoute(client: ClientSession): void {
    const subscription = client.subscription;
    if (subscription !== null) {
      const key = subscriptionKey(subscription.authorityEpoch, subscription.subscriptionId);
      this.subscriptionOwners.delete(key);
      this.retiredSubscriptions.set(key, subscription);
    }
    client.subscription = null;
    client.delivery.close();
    client.upstreamCreditsPaused = false;
    client.proofFlowPauseEstablished = false;
    client.flowResumeInFlight = false;
    if (client.pauseTimer !== null) {
      clearTimeout(client.pauseTimer);
      client.pauseTimer = null;
    }
  }

  private retireLateSubscription(
    client: ClientSession,
    subscription: SerializedSubscribePublicationAck,
  ): void {
    this.assertSubscribeAck(subscription);
    const key = subscriptionKey(subscription.authorityEpoch, subscription.subscriptionId);
    if (this.subscriptionOwners.has(key) || this.retiredSubscriptions.has(key)) {
      throw new Error(`duplicate late subscription identity ${subscription.subscriptionId}`);
    }
    const authority = this.requireReadyAuthority();
    this.retiredSubscriptions.set(key, subscription);
    const requestKey = this.sidecarRequestKey("late-cleanup-unsubscribe");
    this.pendingUnsubscribes.set(requestKey, {
      client,
      rendererRequestKey: null,
      retiredSubscriptionKey: key,
      recordClosedSubscriptionId: null,
    });
    authority.unsubscribe({
      requestKey,
      subscriptionId: subscription.subscriptionId,
      authorityEpoch: subscription.authorityEpoch,
    });
  }

  private closeClient(client: ClientSession): void {
    if (client.closed) return;
    client.closed = true;
    this.releaseDeferredCredit(client);
    const subscription = client.subscription;
    if (
      subscription !== null &&
      this.authority !== null &&
      this.authorityEpoch === subscription.authorityEpoch
    ) {
      const requestKey = this.sidecarRequestKey("cleanup-unsubscribe");
      const retiredSubscriptionKey = subscriptionKey(
        subscription.authorityEpoch,
        subscription.subscriptionId,
      );
      this.pendingUnsubscribes.set(requestKey, {
        client,
        rendererRequestKey: null,
        retiredSubscriptionKey,
        recordClosedSubscriptionId: subscription.subscriptionId,
      });
      this.authority.unsubscribe({
        requestKey,
        subscriptionId: subscription.subscriptionId,
        authorityEpoch: subscription.authorityEpoch,
      });
    }
    this.captureDownstreamBounds(client);
    const deliveryMetrics = client.delivery.metrics();
    this.retiredDownstreamCoalescedCount += deliveryMetrics.downstreamCoalescedPublicationCount;
    this.retiredSkippedPublicationCount += client.skippedPublicationCount;
    this.removeSubscriptionRoute(client);
    this.clients.delete(client.id);
    try {
      client.port.close();
    } catch {
      // A renderer teardown can close the port before Electron emits its close event.
    }
  }

  private retireClientDelivery(client: ClientSession): void {
    this.captureDownstreamBounds(client);
    this.retiredDownstreamCoalescedCount +=
      client.delivery.metrics().downstreamCoalescedPublicationCount;
    this.retiredSkippedPublicationCount += client.skippedPublicationCount;
  }

  private releaseDeferredCredit(client: ClientSession): void {
    const credit = client.deferredCredit;
    client.deferredCredit = null;
    if (
      credit !== null &&
      this.authority !== null &&
      this.authorityEpoch === credit.authorityEpoch
    ) {
      this.authority.acknowledgePublication(credit);
    }
  }

  private rejectAuthorityRequests(message: string): void {
    for (const pending of this.pendingSubscribes.values()) {
      if (!pending.client.closed) {
        this.send(pending.client, {
          kind: "subscribeResult",
          requestKey: pending.rendererRequestKey,
          result: { ok: false, failure: { kind: "authorityUnavailable" } },
        });
      }
    }
    this.pendingSubscribes.clear();

    for (const pending of this.pendingControls.values()) {
      if (pending.kind === "renderer" && !pending.client.closed) {
        this.sendControlFailure(pending.client, pending.rendererRequestKey, message);
      }
    }
    this.pendingControls.clear();
    this.pendingUnsubscribes.clear();
    this.rejectPendingMetrics(new Error(message));
  }

  private rejectPendingMetrics(error: Error): void {
    for (const pending of this.pendingMetrics.values()) {
      clearTimeout(pending.timeout);
      pending.reject(error);
    }
    this.pendingMetrics.clear();
  }

  private requireReadyAuthority(): AuthorityProcess {
    if (
      this.authority === null ||
      this.authorityEpoch === null ||
      this.authorityState !== "ready"
    ) {
      throw new Error("authority is not ready");
    }
    return this.authority;
  }

  private failAuthority(message: string, terminate = true): void {
    if (this.authorityFailureLatched) return;
    this.authorityFailureLatched = true;
    this.authorityState = "unavailable";
    const replacedAuthorityEpoch = this.authorityEpoch;
    this.rejectAuthorityRequests(message);
    for (const client of this.clients.values()) this.invalidateClientSubscription(client, false);
    if (replacedAuthorityEpoch !== null) {
      this.broadcast({ kind: "authorityUnavailable", replacedAuthorityEpoch });
    }
    this.broadcastFailure("host.authorityProtocolFailure", message);
    const authority = this.authority;
    if (authority !== null && terminate) {
      try {
        authority.terminateForProtocolFailure();
      } catch {
        // The process may already be exiting; the latched host state still rejects further events.
      }
    }
  }

  private sendControlFailure(
    client: ClientSession,
    rendererRequestKey: string,
    message: string,
  ): void {
    const response = createControlFailureEnvelope({
      requestKey: rendererRequestKey,
      failure: { code: "control.rejected", message },
    });
    this.send(client, {
      kind: "controlResponse",
      requestKey: rendererRequestKey,
      response,
    });
  }

  private sendProofResult(client: ClientSession, requestKey: string): void {
    this.send(client, { kind: "proofResult", requestKey, ok: true });
  }

  private sendFailure(client: ClientSession, code: string, message: string): void {
    this.send(client, { kind: "hostFailure", code, message });
  }

  private broadcastFailure(code: string, message: string): void {
    this.broadcast({ kind: "hostFailure", code, message });
  }

  private broadcast(message: HostToPreloadMessage): void {
    for (const client of this.clients.values()) this.send(client, message);
  }

  private send(client: ClientSession, message: HostToPreloadMessage): boolean {
    if (client.closed) return false;
    try {
      client.port.postMessage(message);
      return true;
    } catch {
      this.closeClient(client);
      return false;
    }
  }

  private sidecarRequestKey(kind: string): string {
    const key = `host-${kind}-${this.nextSidecarRequestOrdinal}`;
    this.nextSidecarRequestOrdinal += 1;
    return key;
  }
}

function subscriptionKey(authorityEpoch: string, subscriptionId: string): string {
  return `${authorityEpoch}\u0000${subscriptionId}`;
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : "unknown integration failure";
}

function saturatingAdd(current: number, increment: bigint): number {
  const room = BigInt(Number.MAX_SAFE_INTEGER - current);
  return increment >= room ? Number.MAX_SAFE_INTEGER : current + Number(increment);
}
