import { type ChildProcessWithoutNullStreams, spawn } from "node:child_process";
import type { ControlFailureEnvelope, ControlSuccessEnvelope } from "@exclave/control-plane";
import type {
  SerializedSubscribePublicationRequest,
  SerializedSubscribeResult,
} from "./portProtocol.js";
import {
  createSidecarFrameDecoder,
  SIDECAR_PACKET_KIND,
  type SidecarFrame,
} from "./sidecarFrame.js";
import {
  type AuthorityLifecycleMessage,
  decodeAuthorityLifecycleMessage,
  decodeControlResponse,
  decodeMetricsResponse,
  decodeSubscribeResult,
  decodeUnsubscribeResult,
  decodeWarmPublication,
  encodeMetricsRequest,
  encodePublicationCredit,
  encodeSetTempoRatioControl,
  encodeShutdown,
  encodeSubscribeRequest,
  encodeUnsubscribeRequest,
  type SidecarTransportMetrics,
  type SidecarWarmPublication,
} from "./sidecarMessages.js";

export type AuthorityProcessEvent =
  | AuthorityLifecycleMessage
  | {
      readonly kind: "subscribeResult";
      readonly requestKey: string;
      readonly result: SerializedSubscribeResult;
    }
  | {
      readonly kind: "unsubscribeResult";
      readonly requestKey: string;
      readonly ok: boolean;
    }
  | {
      readonly kind: "controlResponse";
      readonly response: ControlSuccessEnvelope | ControlFailureEnvelope;
    }
  | ({ readonly kind: "warmPublication" } & SidecarWarmPublication)
  | {
      readonly kind: "metricsResponse";
      readonly requestKey: string;
      readonly metrics: SidecarTransportMetrics;
    }
  | {
      readonly kind: "protocolFailure";
      readonly message: string;
    }
  | {
      readonly kind: "exit";
      readonly code: number | null;
      readonly signal: NodeJS.Signals | null;
      readonly expected: boolean;
      readonly stderr: string;
    };

export type AuthorityProcessOptions = {
  readonly executablePath: string;
  readonly continuityGeneration: number;
  readonly integrationTestEpoch?: string;
  readonly integrationReadyDelayMs?: number;
};

const MAX_PENDING_STDIN_BYTE_LENGTH = 256 * 1024;

export class AuthorityProcess {
  private child: ChildProcessWithoutNullStreams | null = null;
  private expectedExit = false;
  private exited = false;
  private protocolFailed = false;
  private stderr = "";
  private stdinBackpressured = false;
  private pendingStdinByteLength = 0;
  private readonly pendingStdinFrames: Uint8Array[] = [];
  private readonly listeners = new Set<(event: AuthorityProcessEvent) => void>();
  private readonly frameDecoder = createSidecarFrameDecoder();
  private readonly closed: Promise<void>;
  private resolveClosed: (() => void) | null = null;

  constructor(private readonly options: AuthorityProcessOptions) {
    this.closed = new Promise((resolve) => {
      this.resolveClosed = resolve;
    });
  }

  get pid(): number | null {
    return this.child?.pid ?? null;
  }

  onEvent(listener: (event: AuthorityProcessEvent) => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  start(): number | null {
    if (this.child !== null) throw new Error("authority process is already started");

    if (
      !Number.isSafeInteger(this.options.continuityGeneration) ||
      this.options.continuityGeneration < 1 ||
      this.options.continuityGeneration > 0xffff_ffff
    ) {
      throw new RangeError("authority continuity generation must be a nonzero u32");
    }
    const args: string[] = ["--continuity-generation", String(this.options.continuityGeneration)];
    if (this.options.integrationTestEpoch !== undefined) {
      args.push(
        "--integration-test-mode",
        "--test-authority-epoch",
        this.options.integrationTestEpoch,
      );
      if (this.options.integrationReadyDelayMs !== undefined) {
        args.push("--ready-delay-ms", String(this.options.integrationReadyDelayMs));
      }
    }

    const child = spawn(this.options.executablePath, args, {
      shell: false,
      windowsHide: true,
      stdio: ["pipe", "pipe", "pipe"],
    });
    this.child = child;

    child.stdout.on("data", (chunk: Buffer) => this.receiveStdout(chunk));
    child.stdout.on("end", () => this.finishStdout());
    child.stderr.on("data", (chunk: Buffer) => this.receiveStderr(chunk));
    child.stdin.on("error", (error) => {
      if (!this.expectedExit && !this.exited) {
        this.failProtocol(`authority stdin error: ${error.message}`);
      }
    });
    child.on("error", (error) => this.failProtocol(`authority process error: ${error.message}`));
    child.on("close", (code, signal) => {
      if (this.exited) return;
      this.exited = true;
      this.pendingStdinFrames.length = 0;
      this.pendingStdinByteLength = 0;
      this.emit({
        kind: "exit",
        code,
        signal,
        expected: this.expectedExit,
        stderr: this.stderr,
      });
      this.resolveClosed?.();
      this.resolveClosed = null;
    });

    return child.pid ?? null;
  }

  subscribe(requestKey: string, request: SerializedSubscribePublicationRequest): void {
    this.write(encodeSubscribeRequest(requestKey, request));
  }

  unsubscribe(input: {
    readonly requestKey: string;
    readonly subscriptionId: string;
    readonly authorityEpoch: string;
  }): void {
    this.write(encodeUnsubscribeRequest(input));
  }

  setTempoRatio(input: {
    readonly requestKey: string;
    readonly authorityEpoch: string;
    readonly tempoRatio: number;
  }): void {
    this.write(encodeSetTempoRatioControl(input));
  }

  acknowledgePublication(input: {
    readonly subscriptionId: string;
    readonly authorityEpoch: string;
    readonly publicationSequence: string;
  }): void {
    this.write(encodePublicationCredit(input));
  }

  requestMetrics(requestKey: string): void {
    this.write(encodeMetricsRequest(requestKey));
  }

  crashForProof(): void {
    const child = this.requireChild();
    this.expectedExit = false;
    if (!child.kill()) throw new Error("authority process could not be terminated for proof");
  }

  terminateForProtocolFailure(): void {
    this.protocolFailed = true;
    const child = this.requireChild();
    this.expectedExit = false;
    if (!child.kill()) throw new Error("authority process could not be terminated after failure");
  }

  async stop(timeoutMs = 2_000): Promise<boolean> {
    const child = this.child;
    if (child === null || this.exited) return true;
    this.expectedExit = true;

    this.pendingStdinFrames.length = 0;
    this.pendingStdinByteLength = 0;
    if (!child.stdin.destroyed) {
      try {
        if (!this.stdinBackpressured) {
          child.stdin.end(encodeShutdown());
        } else {
          child.stdin.end();
        }
      } catch (error) {
        this.failProtocol(`authority stdin shutdown failed: ${errorMessage(error)}`);
      }
    } else if (!this.protocolFailed) {
      this.failProtocol("authority protocol input closed before shutdown");
    }

    if (await this.waitForClose(timeoutMs)) return true;
    child.kill();
    if (await this.waitForClose(timeoutMs)) return true;
    child.kill("SIGKILL");
    return this.waitForClose(timeoutMs);
  }

  private async waitForClose(timeoutMs: number): Promise<boolean> {
    if (this.exited) return true;
    let timer: NodeJS.Timeout | null = null;
    const timedOut = new Promise<false>((resolve) => {
      timer = setTimeout(() => resolve(false), timeoutMs);
      timer.unref();
    });
    const closed = this.closed.then(() => true);
    const result = await Promise.race([closed, timedOut]);
    if (timer !== null) clearTimeout(timer);
    return result;
  }

  private receiveStdout(chunk: Buffer): void {
    if (this.protocolFailed) return;
    const decoded = this.frameDecoder.push(new Uint8Array(chunk));
    dispatchSidecarFramesUntilFailure(decoded.frames, (frame) => this.receiveFrame(frame));
    if (!decoded.ok) this.failProtocol(decoded.failure.detail);
  }

  private finishStdout(): void {
    if (this.protocolFailed) return;
    const result = this.frameDecoder.finish();
    if (!result.ok) this.failProtocol(result.failure.detail);
  }

  private receiveFrame(frame: SidecarFrame): boolean {
    if (this.protocolFailed) return false;
    try {
      switch (frame.packetKind) {
        case SIDECAR_PACKET_KIND.authorityStarting:
        case SIDECAR_PACKET_KIND.authorityReady:
          this.emit(decodeAuthorityLifecycleMessage(frame));
          break;
        case SIDECAR_PACKET_KIND.subscribeResult: {
          const result = decodeSubscribeResult(frame);
          this.emit({ kind: "subscribeResult", ...result });
          break;
        }
        case SIDECAR_PACKET_KIND.unsubscribeResult: {
          const result = decodeUnsubscribeResult(frame);
          this.emit({ kind: "unsubscribeResult", ...result });
          break;
        }
        case SIDECAR_PACKET_KIND.controlResponse:
          this.emit({ kind: "controlResponse", response: decodeControlResponse(frame) });
          break;
        case SIDECAR_PACKET_KIND.warmPublication:
          this.emit({ kind: "warmPublication", ...decodeWarmPublication(frame) });
          break;
        case SIDECAR_PACKET_KIND.metricsResponse: {
          const response = decodeMetricsResponse(frame);
          this.emit({ kind: "metricsResponse", ...response });
          break;
        }
        default:
          throw new TypeError(`authority emitted host-only packet kind ${frame.packetKind}`);
      }
      return !this.protocolFailed;
    } catch (error) {
      this.failProtocol(
        error instanceof Error ? error.message : "authority packet validation failed",
      );
      return false;
    }
  }

  private receiveStderr(chunk: Buffer): void {
    const next = `${this.stderr}${chunk.toString("utf8")}`;
    this.stderr = next.slice(-64 * 1024);
  }

  private write(bytes: Uint8Array): void {
    if (this.protocolFailed) return;
    const child = this.requireChild();
    if (this.exited || child.stdin.destroyed) {
      this.failProtocol("authority protocol input is closed");
      return;
    }
    if (this.stdinBackpressured) {
      this.enqueueStdinFrame(bytes);
      return;
    }
    try {
      if (!child.stdin.write(bytes) && !this.protocolFailed) this.beginStdinBackpressure();
    } catch (error) {
      this.failProtocol(`authority stdin write failed: ${errorMessage(error)}`);
    }
  }

  private enqueueStdinFrame(bytes: Uint8Array): void {
    if (this.protocolFailed) return;
    const nextByteLength = this.pendingStdinByteLength + bytes.byteLength;
    if (nextByteLength > MAX_PENDING_STDIN_BYTE_LENGTH) {
      this.failProtocol(
        `authority stdin queue exceeded ${MAX_PENDING_STDIN_BYTE_LENGTH} bounded bytes`,
      );
      return;
    }
    this.pendingStdinFrames.push(Uint8Array.from(bytes));
    this.pendingStdinByteLength = nextByteLength;
  }

  private beginStdinBackpressure(): void {
    if (this.stdinBackpressured || this.protocolFailed) return;
    const child = this.requireChild();
    if (this.exited || child.stdin.destroyed) {
      this.failProtocol("authority protocol input closed while awaiting stdin drain");
      return;
    }
    this.stdinBackpressured = true;
    try {
      child.stdin.once("drain", () => this.flushPendingStdinFrames());
    } catch (error) {
      this.failProtocol(`authority stdin drain setup failed: ${errorMessage(error)}`);
    }
  }

  private flushPendingStdinFrames(): void {
    if (this.protocolFailed || this.exited) return;
    const child = this.child;
    if (child === null || child.stdin.destroyed) {
      this.failProtocol("authority protocol input closed while draining queued frames");
      return;
    }
    this.stdinBackpressured = false;
    while (this.pendingStdinFrames.length > 0) {
      const bytes = this.pendingStdinFrames.shift();
      if (bytes === undefined) break;
      this.pendingStdinByteLength -= bytes.byteLength;
      try {
        if (!child.stdin.write(bytes) && !this.protocolFailed) {
          this.beginStdinBackpressure();
          return;
        }
      } catch (error) {
        this.failProtocol(`authority stdin drain write failed: ${errorMessage(error)}`);
        return;
      }
    }
  }

  private requireChild(): ChildProcessWithoutNullStreams {
    if (this.child === null) throw new Error("authority process is not started");
    return this.child;
  }

  private failProtocol(message: string): void {
    if (this.protocolFailed) return;
    this.protocolFailed = true;
    this.emit({ kind: "protocolFailure", message });
    const child = this.child;
    if (child !== null && !this.exited) child.kill();
  }

  private emit(event: AuthorityProcessEvent): void {
    for (const listener of this.listeners) listener(event);
  }
}

export function dispatchSidecarFramesUntilFailure(
  frames: readonly SidecarFrame[],
  receive: (frame: SidecarFrame) => boolean,
): number {
  let dispatchedCount = 0;
  for (const frame of frames) {
    if (!receive(frame)) break;
    dispatchedCount += 1;
  }
  return dispatchedCount;
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
