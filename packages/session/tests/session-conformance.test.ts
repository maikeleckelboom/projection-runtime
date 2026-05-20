import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { hexToBytes } from "@exclave/hot-codec";
import { describe, expect, it, vi } from "vitest";

import { createDeckRuntimeReader } from "../../../fixtures/projection-runtime/deck-runtime-v0/generated/hot-reader.ts";

import {
  createAuthorityBinding,
  guardAuthorityBinding,
  invalidateAuthorityBinding,
  markAuthorityBindingReady,
} from "../src";

const repoRoot = resolve(fileURLToPath(new URL("../../..", import.meta.url)));

type DeckRuntimeFixtureIdentity = {
  readonly contractKey: string;
  readonly instanceKey: string;
  readonly region: Uint8Array;
};

function loadDeckRuntimeFixtureIdentity(): DeckRuntimeFixtureIdentity {
  const path = resolve(
    repoRoot,
    "fixtures/projection-runtime/deck-runtime-v0/hot-complete-fixture-region.json",
  );
  const fixture = JSON.parse(readFileSync(path, "utf8")) as {
    contractKey: string;
    instanceKey: string;
    completeFixtureRegionBytesHex: string;
  };
  const bytes = hexToBytes(fixture.completeFixtureRegionBytesHex);
  const region = new Uint8Array(new SharedArrayBuffer(bytes.byteLength));
  region.set(bytes);
  return {
    contractKey: fixture.contractKey,
    instanceKey: fixture.instanceKey,
    region,
  };
}

describe("@exclave/session guarded fixture read conformance", () => {
  it("ready binding guard invokes DeckRuntimeReader.tryRead and returns the result", () => {
    const { contractKey, instanceKey, region } = loadDeckRuntimeFixtureIdentity();
    const reader = createDeckRuntimeReader(region, { instanceKey });
    const readSpy = vi.fn(() => reader.tryRead({ maxWriterActivePolls: 0, maxTornReads: 0 }));

    const binding = markAuthorityBindingReady(
      createAuthorityBinding({
        authorityKey: contractKey,
        grantKey: instanceKey,
        authorityEpoch: 1n,
      }),
    );
    const expected = {
      authorityKey: contractKey,
      grantKey: instanceKey,
      authorityEpoch: 1n,
    };

    const result = guardAuthorityBinding(binding, expected, readSpy);

    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error("expected guard to succeed");

    const readResult = result.value;
    expect(readResult.ok).toBe(true);
    if (!readResult.ok) throw new Error("expected tryRead to succeed");

    expect(readResult.sequence).toBe(2n);
    expect(readResult.snapshot.beatPhase01).toBe(0.375);
    expect(readResult.snapshot.level).toBe(0.8125);
    expect(readResult.snapshot.loopActive).toBe(true);
    expect(readResult.snapshot.mediaTimeSeconds).toBe(98.125);
    expect(readResult.snapshot.samplePosition).toBe(4_328_192n);
    expect(readResult.snapshot.stemGains).toEqual([1, 0.875, 0.5, 0.25]);
    expect(readResult.snapshot.tempoRatio).toBe(1.024999976158142);
    expect(readResult.snapshot.transportState).toBe("playing");
    expect(readSpy).toHaveBeenCalledTimes(1);
  });

  it("invalidated binding guard rejects before DeckRuntimeReader.tryRead", () => {
    const { contractKey, instanceKey, region } = loadDeckRuntimeFixtureIdentity();
    const reader = createDeckRuntimeReader(region, { instanceKey });

    const binding = invalidateAuthorityBinding(
      markAuthorityBindingReady(
        createAuthorityBinding({
          authorityKey: contractKey,
          grantKey: instanceKey,
          authorityEpoch: 1n,
        }),
      ),
      "authorityRestarted",
    );
    const expected = {
      authorityKey: contractKey,
      grantKey: instanceKey,
      authorityEpoch: 1n,
    };
    const readSpy = vi.fn(() => reader.tryRead({ maxWriterActivePolls: 0, maxTornReads: 0 }));

    const result = guardAuthorityBinding(binding, expected, readSpy);

    expect(result.ok).toBe(false);
    if (result.ok) throw new Error("expected guard to fail");

    expect(result.reason).toBe("bindingInvalidated");
    expect(result.rebindRequired).toBe(true);
    if (result.reason === "bindingInvalidated") {
      expect(result.invalidationReason).toBe("authorityRestarted");
    }
    expect(readSpy).not.toHaveBeenCalled();
  });
});
