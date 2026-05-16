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
} from "../src/index";

const repoRoot = resolve(fileURLToPath(new URL("../../..", import.meta.url)));

function loadDeckRuntimeCompleteFixtureRegion(): Uint8Array {
  const path = resolve(
    repoRoot,
    "fixtures/projection-runtime/deck-runtime-v0/hot-complete-fixture-region.json",
  );
  const { completeFixtureRegionBytesHex } = JSON.parse(readFileSync(path, "utf8")) as {
    completeFixtureRegionBytesHex: string;
  };
  const bytes = hexToBytes(completeFixtureRegionBytesHex);
  const region = new Uint8Array(new SharedArrayBuffer(bytes.byteLength));
  region.set(bytes);
  return region;
}

describe("@exclave/session conformance guard proof", () => {
  it("ready binding guard invokes DeckRuntimeReader.tryRead and returns the result", () => {
    const region = loadDeckRuntimeCompleteFixtureRegion();
    const reader = createDeckRuntimeReader(region, {
      instanceKey: "deck-runtime-v0.instance",
    });

    const binding = markAuthorityBindingReady(
      createAuthorityBinding({
        authorityKey: "fixture.deckRuntime",
        surfaceKey: "deck-runtime-v0.instance",
        authorityEpoch: 1n,
      }),
    );
    const expected = {
      authorityKey: "fixture.deckRuntime",
      surfaceKey: "deck-runtime-v0.instance",
      authorityEpoch: 1n,
    };

    const result = guardAuthorityBinding(binding, expected, () =>
      reader.tryRead({ maxWriterActivePolls: 0, maxTornReads: 0 }),
    );

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
  });

  it("invalidated binding guard rejects before DeckRuntimeReader.tryRead", () => {
    const region = loadDeckRuntimeCompleteFixtureRegion();
    const reader = createDeckRuntimeReader(region, {
      instanceKey: "deck-runtime-v0.instance",
    });

    const binding = invalidateAuthorityBinding(
      markAuthorityBindingReady(
        createAuthorityBinding({
          authorityKey: "fixture.deckRuntime",
          surfaceKey: "deck-runtime-v0.instance",
          authorityEpoch: 1n,
        }),
      ),
      "authorityRestarted",
    );
    const expected = {
      authorityKey: "fixture.deckRuntime",
      surfaceKey: "deck-runtime-v0.instance",
      authorityEpoch: 1n,
    };
    const readSpy = vi.fn(() => reader.tryRead({ maxWriterActivePolls: 0, maxTornReads: 0 }));

    const result = guardAuthorityBinding(binding, expected, readSpy);

    expect(result.ok).toBe(false);
    if (result.ok) throw new Error("expected guard to fail");

    expect(result.reason).toBe("bindingInvalidated");
    expect(result.rebindRequired).toBe(true);
    expect(result.invalidationReason).toBe("authorityRestarted");
    expect(readSpy).not.toHaveBeenCalled();
  });
});
