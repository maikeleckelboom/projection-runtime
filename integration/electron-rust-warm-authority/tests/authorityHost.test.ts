import { EventEmitter } from "node:events";
import type { MessagePortMain } from "electron";
import { describe, expect, it } from "vitest";
import { AuthorityHost } from "../src/authorityHost.js";
import {
  DECK_RUNTIME_CONTRACT_KEY,
  DECK_RUNTIME_SEMANTIC_VERSION,
  DECK_RUNTIME_WARM_CODEC_VERSION,
  PROJECTION_INSTANCE_KEY,
} from "../src/contract.js";
import type {
  HostToPreloadMessage,
  PreloadToHostMessage,
  SerializedSubscribePublicationAck,
} from "../src/portProtocol.js";
import { encodeU64Hex } from "../src/wireValues.js";

describe("Electron authority host client teardown", () => {
  it("treats a renderer post failure as client-local instead of killing the authority", () => {
    const host = new AuthorityHost({ authorityExecutablePath: "unused" });
    const port = new FakePort();
    host.attachRendererPort(port as unknown as MessagePortMain);
    const internals = hostInternals(host);
    const client = [...internals.clients.values()][0];
    if (client === undefined) throw new Error("test client was not attached");
    port.throwOnPost = true;

    expect(() =>
      internals.send(client, {
        kind: "hostFailure",
        code: "test.closedPort",
        message: "simulated renderer teardown",
      }),
    ).not.toThrow();
    expect(internals.clients.size).toBe(0);
    expect(port.closeCount).toBe(1);
  });

  it("retires and unsubscribes a successful ack that arrives after its client closed", () => {
    const host = new AuthorityHost({ authorityExecutablePath: "unused" });
    const authority = new FakeAuthority();
    const internals = hostInternals(host);
    internals.authority = authority;
    internals.authorityState = "ready";
    internals.authorityEpoch = "101";

    const port = new FakePort();
    const detach = host.attachRendererPort(port as unknown as MessagePortMain);
    const client = [...internals.clients.values()][0];
    if (client === undefined) throw new Error("test client was not attached");
    const message: Extract<PreloadToHostMessage, { readonly kind: "subscribeRuntime" }> = {
      kind: "subscribeRuntime",
      requestKey: "renderer-subscribe-1",
      request: {
        contractKey: DECK_RUNTIME_CONTRACT_KEY,
        projectionInstanceKey: PROJECTION_INSTANCE_KEY,
        lane: "warm",
        expectedSemanticVersion: encodeU64Hex(DECK_RUNTIME_SEMANTIC_VERSION),
        expectedLaneVersion: encodeU64Hex(DECK_RUNTIME_WARM_CODEC_VERSION),
      },
    };
    internals.subscribeClient(client, message);
    const sidecarRequestKey = authority.subscribeRequestKey;
    if (sidecarRequestKey === null) throw new Error("subscribe was not forwarded");

    detach();
    internals.handleSubscribeResult({
      kind: "subscribeResult",
      requestKey: sidecarRequestKey,
      result: { ok: true, ack: subscribeAck },
    });

    expect(authority.unsubscribeCalls).toEqual([
      {
        requestKey: expect.stringContaining("late-cleanup-unsubscribe"),
        subscriptionId: "subscription-late",
        authorityEpoch: "101",
      },
    ]);
    expect(internals.retiredSubscriptions.has("101\u0000subscription-late")).toBe(true);
    expect(authority.terminateCount).toBe(0);

    const cleanupRequest = authority.unsubscribeCalls[0];
    if (cleanupRequest === undefined) throw new Error("late cleanup was not requested");
    internals.handleUnsubscribeResult({
      kind: "unsubscribeResult",
      requestKey: cleanupRequest.requestKey,
      ok: true,
    });
    expect(internals.retiredSubscriptions.has("101\u0000subscription-late")).toBe(false);
  });

  it("records renderer subscription closure only after Rust confirms cleanup", () => {
    const host = new AuthorityHost({ authorityExecutablePath: "unused" });
    const authority = new FakeAuthority();
    const internals = hostInternals(host);
    internals.authority = authority;
    internals.authorityState = "ready";
    internals.authorityEpoch = "101";
    const port = new FakePort();
    const detach = host.attachRendererPort(port as unknown as MessagePortMain);
    const client = [...internals.clients.values()][0];
    if (client === undefined) throw new Error("test client was not attached");
    internals.subscribeClient(client, subscribeMessage);
    const subscribeRequestKey = authority.subscribeRequestKey;
    if (subscribeRequestKey === null) throw new Error("subscribe was not forwarded");
    internals.handleSubscribeResult({
      kind: "subscribeResult",
      requestKey: subscribeRequestKey,
      result: { ok: true, ack: subscribeAck },
    });

    detach();
    expect(internals.proofAudit.closedSubscriptions.has("subscription-late")).toBe(false);
    const cleanupRequest = authority.unsubscribeCalls[0];
    if (cleanupRequest === undefined) throw new Error("renderer cleanup was not requested");
    internals.handleUnsubscribeResult({
      kind: "unsubscribeResult",
      requestKey: cleanupRequest.requestKey,
      ok: true,
    });

    expect(internals.proofAudit.closedSubscriptions.has("subscription-late")).toBe(true);
    expect(internals.retiredSubscriptions.has("101\u0000subscription-late")).toBe(false);
  });

  it("fails the authority when Rust rejects a correlated unsubscribe", () => {
    const host = new AuthorityHost({ authorityExecutablePath: "unused" });
    const authority = new FakeAuthority();
    const internals = hostInternals(host);
    internals.authority = authority;
    internals.authorityState = "ready";
    internals.authorityEpoch = "101";
    const port = new FakePort();
    const detach = host.attachRendererPort(port as unknown as MessagePortMain);
    const client = [...internals.clients.values()][0];
    if (client === undefined) throw new Error("test client was not attached");
    internals.subscribeClient(client, subscribeMessage);
    const subscribeRequestKey = authority.subscribeRequestKey;
    if (subscribeRequestKey === null) throw new Error("subscribe was not forwarded");
    internals.handleSubscribeResult({
      kind: "subscribeResult",
      requestKey: subscribeRequestKey,
      result: { ok: true, ack: subscribeAck },
    });
    detach();
    const cleanupRequest = authority.unsubscribeCalls[0];
    if (cleanupRequest === undefined) throw new Error("renderer cleanup was not requested");

    internals.handleUnsubscribeResult({
      kind: "unsubscribeResult",
      requestKey: cleanupRequest.requestKey,
      ok: false,
    });

    expect(internals.authorityFailureLatched).toBe(true);
    expect(authority.terminateCount).toBe(1);
    expect(internals.proofAudit.closedSubscriptions.has("subscription-late")).toBe(false);
  });

  it("treats an uncorrelated unsubscribe result as an authority protocol failure", () => {
    const host = new AuthorityHost({ authorityExecutablePath: "unused" });
    const authority = new FakeAuthority();
    const internals = hostInternals(host);
    internals.authority = authority;
    internals.authorityState = "ready";
    internals.authorityEpoch = "101";

    internals.handleUnsubscribeResult({
      kind: "unsubscribeResult",
      requestKey: "unknown-unsubscribe-request",
      ok: true,
    });

    expect(internals.authorityFailureLatched).toBe(true);
    expect(authority.terminateCount).toBe(1);
  });
});

type InternalClient = {
  readonly id: number;
};

type HostInternals = {
  authority: FakeAuthority | null;
  authorityState: "unavailable" | "starting" | "ready";
  authorityEpoch: string | null;
  authorityFailureLatched: boolean;
  readonly clients: Map<number, InternalClient>;
  readonly retiredSubscriptions: Map<string, SerializedSubscribePublicationAck>;
  readonly proofAudit: {
    readonly closedSubscriptions: Set<string>;
  };
  send(client: InternalClient, message: HostToPreloadMessage): boolean;
  subscribeClient(
    client: InternalClient,
    message: Extract<PreloadToHostMessage, { readonly kind: "subscribeRuntime" }>,
  ): void;
  handleSubscribeResult(event: {
    readonly kind: "subscribeResult";
    readonly requestKey: string;
    readonly result:
      | { readonly ok: true; readonly ack: SerializedSubscribePublicationAck }
      | { readonly ok: false; readonly failure: { readonly kind: string } };
  }): void;
  handleUnsubscribeResult(event: {
    readonly kind: "unsubscribeResult";
    readonly requestKey: string;
    readonly ok: boolean;
  }): void;
};

function hostInternals(host: AuthorityHost): HostInternals {
  return host as unknown as HostInternals;
}

class FakePort extends EventEmitter {
  throwOnPost = false;
  closeCount = 0;

  postMessage(_message: unknown): void {
    if (this.throwOnPost) throw new Error("port is closed");
  }

  start(): void {}

  close(): void {
    this.closeCount += 1;
    this.emit("close");
  }
}

class FakeAuthority {
  readonly pid = 4242;
  subscribeRequestKey: string | null = null;
  readonly unsubscribeCalls: Array<{
    readonly requestKey: string;
    readonly subscriptionId: string;
    readonly authorityEpoch: string;
  }> = [];
  terminateCount = 0;

  subscribe(requestKey: string): void {
    this.subscribeRequestKey = requestKey;
  }

  unsubscribe(input: {
    readonly requestKey: string;
    readonly subscriptionId: string;
    readonly authorityEpoch: string;
  }): void {
    this.unsubscribeCalls.push(input);
  }

  terminateForProtocolFailure(): void {
    this.terminateCount += 1;
  }
}

const subscribeAck: SerializedSubscribePublicationAck = {
  contractKey: DECK_RUNTIME_CONTRACT_KEY,
  projectionInstanceKey: PROJECTION_INSTANCE_KEY,
  lane: "warm",
  subscriptionId: "subscription-late",
  authorityEpoch: "101",
  semanticVersion: encodeU64Hex(DECK_RUNTIME_SEMANTIC_VERSION),
  laneVersion: encodeU64Hex(DECK_RUNTIME_WARM_CODEC_VERSION),
  baselineEpoch: 1,
  continuityGeneration: 1,
};

const subscribeMessage: Extract<PreloadToHostMessage, { readonly kind: "subscribeRuntime" }> = {
  kind: "subscribeRuntime",
  requestKey: "renderer-subscribe-shared",
  request: {
    contractKey: DECK_RUNTIME_CONTRACT_KEY,
    projectionInstanceKey: PROJECTION_INSTANCE_KEY,
    lane: "warm",
    expectedSemanticVersion: encodeU64Hex(DECK_RUNTIME_SEMANTIC_VERSION),
    expectedLaneVersion: encodeU64Hex(DECK_RUNTIME_WARM_CODEC_VERSION),
  },
};
