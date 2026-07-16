import { describe, expect, it, vi } from "vitest";
import { AuthorityProcess, type AuthorityProcessEvent } from "../src/authorityProcess.js";

const MAX_PENDING_STDIN_BYTE_LENGTH = 256 * 1024;

describe("Electron authority child lifecycle", () => {
  it("reports and closes an unspawnable executable without hanging stop", async () => {
    const authority = new AuthorityProcess({
      executablePath: "C:\\definitely-missing-exclave-authority\\authority.exe",
      continuityGeneration: 1,
    });
    const events: AuthorityProcessEvent[] = [];
    const terminal = new Promise<Extract<AuthorityProcessEvent, { readonly kind: "exit" }>>(
      (resolve) => {
        authority.onEvent((event) => {
          events.push(event);
          if (event.kind === "exit") resolve(event);
        });
      },
    );

    expect(authority.start()).toBeNull();
    const exit = await Promise.race([
      terminal,
      new Promise<never>((_resolve, reject) => {
        setTimeout(() => reject(new Error("unspawnable authority did not close")), 5_000).unref();
      }),
    ]);

    expect(events).toContainEqual({
      kind: "protocolFailure",
      message: expect.stringContaining("authority process error"),
    });
    expect(exit).toMatchObject({ kind: "exit", expected: false });
    await expect(authority.stop(50)).resolves.toBe(true);
  });

  it("keeps pre-start transport use as a programmer error", () => {
    const authority = createAuthority();

    expect(() => authority.requestMetrics("metrics-before-start")).toThrow(
      "authority process is not started",
    );
  });

  it("latches a destroyed after-start stdin as one non-throwing protocol failure", () => {
    const authority = createAuthority();
    const { events, kill } = attachFakeChild(authority, {
      destroyed: true,
      write: vi.fn(() => true),
      once: vi.fn(),
    });

    expect(() => authority.requestMetrics("metrics-closed-1")).not.toThrow();
    expect(() => authority.requestMetrics("metrics-closed-2")).not.toThrow();

    expect(events).toEqual([
      { kind: "protocolFailure", message: "authority protocol input is closed" },
    ]);
    expect(kill).toHaveBeenCalledTimes(1);
  });

  it("turns a synchronous after-start stdin write failure into protocol failure", () => {
    const authority = createAuthority();
    const { events, kill } = attachFakeChild(authority, {
      destroyed: false,
      write: vi.fn(() => {
        throw new Error("synthetic write failure");
      }),
      once: vi.fn(),
    });

    expect(() => authority.requestMetrics("metrics-write-failure")).not.toThrow();

    expect(events).toEqual([
      {
        kind: "protocolFailure",
        message: "authority stdin write failed: synthetic write failure",
      },
    ]);
    expect(kill).toHaveBeenCalledTimes(1);
  });

  it("turns bounded stdin queue exhaustion into protocol failure without escaping", () => {
    const authority = createAuthority();
    const { events, kill } = attachFakeChild(authority, {
      destroyed: false,
      write: vi.fn(() => true),
      once: vi.fn(),
    });
    const internals = authority as unknown as {
      pendingStdinByteLength: number;
      stdinBackpressured: boolean;
    };
    internals.stdinBackpressured = true;
    internals.pendingStdinByteLength = MAX_PENDING_STDIN_BYTE_LENGTH;

    expect(() => authority.requestMetrics("metrics-queue-full")).not.toThrow();

    expect(events).toEqual([
      {
        kind: "protocolFailure",
        message: `authority stdin queue exceeded ${MAX_PENDING_STDIN_BYTE_LENGTH} bounded bytes`,
      },
    ]);
    expect(kill).toHaveBeenCalledTimes(1);
  });

  it("turns a queued stdin drain write failure into protocol failure without escaping", () => {
    const authority = createAuthority();
    let drain: (() => void) | null = null;
    const write = vi
      .fn<() => boolean>()
      .mockReturnValueOnce(false)
      .mockImplementationOnce(() => {
        throw new Error("synthetic drain failure");
      });
    const { events, kill } = attachFakeChild(authority, {
      destroyed: false,
      write,
      once: vi.fn((_event: string, listener: () => void) => {
        drain = listener;
      }),
    });

    expect(() => authority.requestMetrics("metrics-in-flight")).not.toThrow();
    expect(() => authority.requestMetrics("metrics-pending")).not.toThrow();
    expect(drain).not.toBeNull();
    expect(() => (drain as unknown as () => void)()).not.toThrow();

    expect(events).toEqual([
      {
        kind: "protocolFailure",
        message: "authority stdin drain write failed: synthetic drain failure",
      },
    ]);
    expect(kill).toHaveBeenCalledTimes(1);
  });
});

function createAuthority(): AuthorityProcess {
  return new AuthorityProcess({
    executablePath: "unused",
    continuityGeneration: 1,
  });
}

function attachFakeChild(
  authority: AuthorityProcess,
  stdin: {
    readonly destroyed: boolean;
    readonly write: (bytes: Uint8Array) => boolean;
    readonly once: (event: string, listener: () => void) => unknown;
  },
): { readonly events: AuthorityProcessEvent[]; readonly kill: ReturnType<typeof vi.fn> } {
  const events: AuthorityProcessEvent[] = [];
  const kill = vi.fn(() => true);
  authority.onEvent((event) => events.push(event));
  (authority as unknown as { child: unknown }).child = { stdin, kill };
  return { events, kill };
}
