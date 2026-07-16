import { describe, expect, it } from "vitest";
import { SIDECAR_PACKET_KIND, type SidecarFrame } from "../src/sidecarFrame.js";
import { decodeUnsubscribeResult } from "../src/sidecarMessages.js";

const encoder = new TextEncoder();

describe("sidecar message projections", () => {
  it("accepts the typed stale-epoch unsubscribe failure emitted by Rust", () => {
    expect(
      decodeUnsubscribeResult(
        jsonFrame({
          requestKey: "host-unsubscribe-1",
          result: {
            ok: false,
            failure: {
              kind: "sessionMismatch",
              expectedAuthorityEpoch: "202",
              providedAuthorityEpoch: "101",
            },
          },
        }),
      ),
    ).toEqual({ requestKey: "host-unsubscribe-1", ok: false });
  });

  it("rejects an unknown unsubscribe failure instead of weakening the boundary", () => {
    expect(() =>
      decodeUnsubscribeResult(
        jsonFrame({
          requestKey: "host-unsubscribe-1",
          result: { ok: false, failure: { kind: "inventedFailure" } },
        }),
      ),
    ).toThrow(/unknown unsubscribe failure/u);
  });
});

function jsonFrame(value: unknown): SidecarFrame {
  return {
    packetKind: SIDECAR_PACKET_KIND.unsubscribeResult,
    payload: encoder.encode(JSON.stringify(value)),
  };
}
