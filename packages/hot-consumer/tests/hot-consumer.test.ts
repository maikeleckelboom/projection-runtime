import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { ExclaveError } from "@exclave/base";
import {
  decodeHotCompleteFixtureRegion,
  HOT_SEQLOCK_U64_OFFSET,
  type HotLayoutManifest,
  hexToBytes,
} from "@exclave/hot-codec";
import { afterEach, describe, expect, expectTypeOf, it, vi } from "vitest";

import * as hotConsumer from "../src/index";
import {
  createHotReadState,
  HOT_CONSUMER_ERRORS,
  HOT_READ_DEFAULTS,
  type HotConsumerError,
  type HotConsumerIssueCode,
  isHotConsumerError,
  type TryReadHotSnapshotInput,
  tryReadHotSnapshot,
} from "../src/index";

const repoRoot = resolve(fileURLToPath(new URL("../../..", import.meta.url)));
const hotBasicLayoutPath = resolve(
  repoRoot,
  "fixtures/projection-runtime/hot-basic-v0/hot-layout-manifest.json",
);
const hotBasicCompleteFixtureRegionPath = resolve(
  repoRoot,
  "fixtures/projection-runtime/hot-basic-v0/hot-complete-fixture-region.json",
);
const hotExchangeLayoutPath = resolve(
  repoRoot,
  "fixtures/projection-runtime/hot-exchange-v0/hot-layout-manifest.json",
);
const hotExchangeByteFixturePath = resolve(
  repoRoot,
  "fixtures/projection-runtime/hot-exchange-v0/hot-byte-fixture.json",
);
const hotExchangeCompleteFixtureRegionPath = resolve(
  repoRoot,
  "fixtures/projection-runtime/hot-exchange-v0/hot-complete-fixture-region.json",
);

function sequenceView(initial: bigint): BigUint64Array {
  const sequence = new BigUint64Array(new SharedArrayBuffer(8));
  Atomics.store(sequence, 0, initial);
  return sequence;
}

function expectHotConsumerError(action: () => unknown): HotConsumerError {
  try {
    action();
  } catch (error) {
    expect(error).toBeInstanceOf(ExclaveError);
    expect(isHotConsumerError(error)).toBe(true);
    expect((error as HotConsumerError).code).toBe(HOT_CONSUMER_ERRORS.inputRejected.code);
    return error as HotConsumerError;
  }

  throw new Error("expected hot consumer failure");
}

function hotBasicLayout(): HotLayoutManifest {
  return readHotLayoutFixture(hotBasicLayoutPath);
}

function hotExchangeLayout(): HotLayoutManifest {
  return readHotLayoutFixture(hotExchangeLayoutPath);
}

function readHotLayoutFixture(path: string): HotLayoutManifest {
  const raw = JSON.parse(readFileSync(path, "utf8")) as Record<string, unknown>;
  const hotLayoutVersion = raw.hotLayoutVersion;

  if (typeof hotLayoutVersion !== "string") {
    throw new Error(`${path} hotLayoutVersion must be a hex string`);
  }

  return {
    ...raw,
    hotLayoutVersion: BigInt(`0x${hotLayoutVersion}`),
  } as unknown as HotLayoutManifest;
}

function hotBasicCompleteFixtureRegionBytes(): Uint8Array {
  return readCompleteFixtureRegionBytes(hotBasicCompleteFixtureRegionPath);
}

function hotExchangeCompleteFixtureRegionBytes(): Uint8Array {
  return readCompleteFixtureRegionBytes(hotExchangeCompleteFixtureRegionPath);
}

function readCompleteFixtureRegionBytes(path: string): Uint8Array {
  const artifact = JSON.parse(readFileSync(path, "utf8")) as Record<string, unknown>;
  const hex = artifact.completeFixtureRegionBytesHex;

  if (typeof hex !== "string") {
    throw new Error(`${path} complete fixture region bytes must be hex`);
  }

  return hexToBytes(hex);
}

function hotExchangeExpectedValues(): Record<string, unknown> {
  const artifact = JSON.parse(readFileSync(hotExchangeByteFixturePath, "utf8")) as Record<
    string,
    unknown
  >;

  if (!isRecord(artifact.values)) {
    throw new Error("hot-exchange-v0 values must be an object");
  }

  return artifact.values;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe("@exclave/hot-consumer bounded read attempts", () => {
  it("returns a fresh snapshot on a clean even/even sequence read and stores lastGood", () => {
    const sequence = sequenceView(2n);
    const state = createHotReadState<{ readonly cursor: number }>();

    const result = tryReadHotSnapshot({
      sequence,
      readCandidate: () => ({ cursor: 123 }),
      state,
    });

    expect(result).toEqual({
      ok: true,
      snapshot: { cursor: 123 },
      lastGood: { cursor: 123 },
      sequence: 2n,
      writerActivePolls: 0,
      tornReads: 0,
      usedFallback: false,
    });
    expect(state.lastGood).toEqual({ cursor: 123 });
  });

  it("falls back on writer-active-at-start with a zero budget without reading a candidate", () => {
    const sequence = sequenceView(1n);
    const readCandidate = vi.fn(() => "must-not-run");
    const stateWithLastGood = createHotReadState<string>();
    stateWithLastGood.lastGood = "prior";
    const stateWithoutLastGood = createHotReadState<string>();

    expect(
      tryReadHotSnapshot({
        sequence,
        readCandidate,
        state: stateWithLastGood,
        options: { maxWriterActivePolls: 0 },
      }),
    ).toEqual({
      ok: false,
      snapshot: "prior",
      lastGood: "prior",
      reason: "writerActiveBudgetExhausted",
      writerActivePolls: 1,
      tornReads: 0,
      usedFallback: true,
    });

    expect(
      tryReadHotSnapshot({
        sequence,
        readCandidate,
        state: stateWithoutLastGood,
        options: { maxWriterActivePolls: 0 },
      }).snapshot,
    ).toBeNull();
    expect(readCandidate).not.toHaveBeenCalled();
  });

  it("does not consume torn-read budget for writer-active-at-start", () => {
    const sequence = sequenceView(1n);
    const state = createHotReadState<string>();

    const result = tryReadHotSnapshot({
      sequence,
      readCandidate: vi.fn(() => "must-not-run"),
      state,
      options: {
        maxWriterActivePolls: 0,
        maxTornReads: 0,
      },
    });

    expect(result).toMatchObject({
      ok: false,
      reason: "writerActiveBudgetExhausted",
      writerActivePolls: 1,
      tornReads: 0,
    });
  });

  it("discards a torn candidate and retries when torn-read budget allows", () => {
    const sequence = sequenceView(2n);
    const state = createHotReadState<string>();
    const candidates: string[] = [];

    const result = tryReadHotSnapshot({
      sequence,
      readCandidate: () => {
        if (candidates.length === 0) {
          candidates.push("torn");
          Atomics.store(sequence, 0, 4n);
          return "torn";
        }

        candidates.push("fresh");
        return "fresh";
      },
      state,
      options: {
        maxWriterActivePolls: 0,
        maxTornReads: 1,
      },
    });

    expect(result).toEqual({
      ok: true,
      snapshot: "fresh",
      lastGood: "fresh",
      sequence: 4n,
      writerActivePolls: 0,
      tornReads: 1,
      usedFallback: false,
    });
    expect(candidates).toEqual(["torn", "fresh"]);
    expect(state.lastGood).toBe("fresh");
  });

  it("exhausts torn-read budget without exposing or storing the torn candidate", () => {
    const sequence = sequenceView(2n);
    const state = createHotReadState<string>();
    state.lastGood = "prior";

    const result = tryReadHotSnapshot({
      sequence,
      readCandidate: () => {
        Atomics.store(sequence, 0, 4n);
        return "torn";
      },
      state,
      options: { maxTornReads: 0 },
    });

    expect(result).toEqual({
      ok: false,
      snapshot: "prior",
      lastGood: "prior",
      reason: "tornReadBudgetExhausted",
      writerActivePolls: 0,
      tornReads: 1,
      usedFallback: true,
    });
    expect(state.lastGood).toBe("prior");
  });

  it("does not consume writer-active budget for torn-read-after-even-start", () => {
    const sequence = sequenceView(2n);
    const state = createHotReadState<string>();

    const result = tryReadHotSnapshot({
      sequence,
      readCandidate: () => {
        Atomics.store(sequence, 0, 4n);
        return "torn";
      },
      state,
      options: {
        maxWriterActivePolls: 0,
        maxTornReads: 0,
      },
    });

    expect(result).toMatchObject({
      ok: false,
      reason: "tornReadBudgetExhausted",
      writerActivePolls: 0,
      tornReads: 1,
    });
  });

  it("reports writer-active and torn-read budgets separately across one attempt", () => {
    const sequence = sequenceView(0n);
    const observedSequenceLoads = [1n, 2n, 4n, 4n, 4n];
    const originalLoad = Atomics.load;
    vi.spyOn(Atomics, "load").mockImplementation(((typedArray: BigUint64Array, index: number) => {
      expect(typedArray).toBe(sequence);
      expect(index).toBe(0);
      const next = observedSequenceLoads.shift();
      return next ?? originalLoad(typedArray, index);
    }) as typeof Atomics.load);

    const state = createHotReadState<string>();
    const readCandidate = vi.fn(() => (readCandidate.mock.calls.length === 1 ? "torn" : "fresh"));

    const result = tryReadHotSnapshot({
      sequence,
      readCandidate,
      state,
      options: {
        maxWriterActivePolls: 1,
        maxTornReads: 1,
      },
    });

    expect(result).toMatchObject({
      ok: true,
      snapshot: "fresh",
      writerActivePolls: 1,
      tornReads: 1,
    });
    expect(readCandidate).toHaveBeenCalledTimes(2);
    expect(observedSequenceLoads).toEqual([]);
  });

  it("retains lastGood after failed later reads", () => {
    const sequence = sequenceView(2n);
    const state = createHotReadState<string>();

    expect(
      tryReadHotSnapshot({
        sequence,
        readCandidate: () => "fresh",
        state,
      }).snapshot,
    ).toBe("fresh");

    Atomics.store(sequence, 0, 1n);

    expect(
      tryReadHotSnapshot({
        sequence,
        readCandidate: vi.fn(() => "must-not-run"),
        state,
        options: { maxWriterActivePolls: 0 },
      }),
    ).toMatchObject({
      ok: false,
      snapshot: "fresh",
      lastGood: "fresh",
      reason: "writerActiveBudgetExhausted",
    });
    expect(state.lastGood).toBe("fresh");
  });

  it("uses Atomics.load(sequence, 0) for the sequence counter and no DataView sequence read", () => {
    const sequence = sequenceView(2n);
    const loadSpy = vi.spyOn(Atomics, "load");

    const result = tryReadHotSnapshot({
      sequence,
      readCandidate: () => "fresh",
      state: createHotReadState<string>(),
    });

    expect(result.ok).toBe(true);
    expect(loadSpy).toHaveBeenCalledTimes(2);
    expect(loadSpy).toHaveBeenNthCalledWith(1, sequence, 0);
    expect(loadSpy).toHaveBeenNthCalledWith(2, sequence, 0);
  });

  it("uses hot-codec complete fixture-region decode as a caller-provided readCandidate", () => {
    const manifest = hotBasicLayout();
    const fixtureBytes = hotBasicCompleteFixtureRegionBytes();
    const copiedRegion = new Uint8Array(new SharedArrayBuffer(fixtureBytes.byteLength));
    copiedRegion.set(fixtureBytes);
    const sequence = new BigUint64Array(copiedRegion.buffer, HOT_SEQLOCK_U64_OFFSET, 1);
    type Snapshot = ReturnType<typeof decodeHotCompleteFixtureRegion>;
    const state = createHotReadState<Snapshot>();

    const result = tryReadHotSnapshot({
      sequence,
      readCandidate: () =>
        decodeHotCompleteFixtureRegion(manifest, copiedRegion, {
          expectedContractKey: "fixture.hotBasic",
          expectedInstanceKey: "hot-basic-v0.instance",
        }),
      state,
    });

    expect(result.ok).toBe(true);
    expect(result.snapshot.blockB.seqlockCounter).toBe(2n);
    expect(result.snapshot.fieldValues).toEqual({
      cursor: 123,
      health: "warn",
      level: 0.75,
      peaks: [0.125, 0.25, 0.5],
      phase: 12.5,
    });
    expect(state.lastGood?.fieldValues).toEqual(result.snapshot.fieldValues);
  });

  it("reads the hot-exchange-v0 fixture-backed region through the bounded consumer kernel", () => {
    const manifest = hotExchangeLayout();
    const fixtureBytes = hotExchangeCompleteFixtureRegionBytes();
    const copiedRegion = new Uint8Array(new SharedArrayBuffer(fixtureBytes.byteLength));
    copiedRegion.set(fixtureBytes);
    const sequence = new BigUint64Array(copiedRegion.buffer, HOT_SEQLOCK_U64_OFFSET, 1);
    type Snapshot = ReturnType<typeof decodeHotCompleteFixtureRegion>;
    const state = createHotReadState<Snapshot>();
    const expectedValues = hotExchangeExpectedValues();

    const result = tryReadHotSnapshot({
      sequence,
      readCandidate: () =>
        decodeHotCompleteFixtureRegion(manifest, copiedRegion, {
          expectedContractKey: "fixture.hotExchange.v0",
          expectedInstanceKey: "hot-exchange-v0.instance",
        }),
      state,
      options: {
        maxWriterActivePolls: 0,
        maxTornReads: 0,
      },
    });

    expect(result.ok).toBe(true);
    if (!result.ok) {
      throw new Error("expected hot-exchange fixture read to succeed");
    }
    expect(result.writerActivePolls).toBe(0);
    expect(result.tornReads).toBe(0);
    expect(result.sequence).toBe(2n);
    expect(result.snapshot.blockB).toMatchObject({
      baselineEpoch: 7,
      continuityGeneration: 3,
      publicationSequence: 42n,
      seqlockCounter: 2n,
    });
    expect(result.snapshot.fieldValues).toEqual(expectedValues);
    expect(state.lastGood?.fieldValues).toEqual(expectedValues);
  });

  it("propagates readCandidate errors unchanged and leaves lastGood untouched", () => {
    const sequence = sequenceView(2n);
    const state = createHotReadState<string>();
    state.lastGood = "prior";
    const thrown = new Error("candidate failed");

    try {
      tryReadHotSnapshot({
        sequence,
        readCandidate: () => {
          throw thrown;
        },
        state,
      });
    } catch (error) {
      expect(error).toBe(thrown);
      expect(state.lastGood).toBe("prior");
      return;
    }

    throw new Error("expected readCandidate to throw");
  });
});

describe("@exclave/hot-consumer input errors and public error surface", () => {
  it("uses small explicit defaults and accepts zero budgets", () => {
    expect(HOT_READ_DEFAULTS).toEqual({
      maxWriterActivePolls: 2,
      maxTornReads: 2,
    });

    const sequence = sequenceView(2n);
    const state = createHotReadState<string>();

    expect(
      tryReadHotSnapshot({
        sequence,
        readCandidate: () => "fresh",
        state,
        options: {
          maxWriterActivePolls: 0,
          maxTornReads: 0,
        },
      }),
    ).toMatchObject({
      ok: true,
      snapshot: "fresh",
    });
  });

  it("throws typed Exclave errors for invalid programmer inputs", () => {
    const error = expectHotConsumerError(() =>
      tryReadHotSnapshot({
        sequence: new Uint8Array(8),
        readCandidate: "not-a-function",
        state: {},
        options: {
          maxWriterActivePolls: -1,
          maxTornReads: 1.5,
        },
      } as unknown as TryReadHotSnapshotInput<string>),
    );

    expect(error.details.issues.map((issue) => issue.code)).toEqual(
      expect.arrayContaining<HotConsumerIssueCode>([
        "input.sequenceViewInvalid",
        "input.readCandidateInvalid",
        "input.stateInvalid",
        "input.maxWriterActivePollsInvalid",
        "input.maxTornReadsInvalid",
      ]),
    );

    const tooShort = expectHotConsumerError(() =>
      tryReadHotSnapshot({
        sequence: new BigUint64Array(new SharedArrayBuffer(0)),
        readCandidate: () => "never",
        state: createHotReadState<string>(),
      }),
    );
    expect(tooShort.details.issues.map((issue) => issue.code)).toEqual([
      "input.sequenceViewTooShort",
    ]);

    const unsafe = expectHotConsumerError(() =>
      tryReadHotSnapshot({
        sequence: sequenceView(2n),
        readCandidate: () => "never",
        state: createHotReadState<string>(),
        options: {
          maxWriterActivePolls: Number.MAX_SAFE_INTEGER + 1,
        },
      }),
    );
    expect(unsafe.details.issues.map((issue) => issue.code)).toEqual([
      "input.maxWriterActivePollsInvalid",
    ]);
  });

  it("keeps HotConsumerError type-only while exporting descriptor, creator, and predicate helpers", () => {
    expect("HotConsumerError" in hotConsumer).toBe(false);
    expect(HOT_CONSUMER_ERRORS.inputRejected.code).toBe("hotConsumer.inputRejected");
    expect(typeof hotConsumer.createHotConsumerInputRejectedError).toBe("function");
    expect(typeof hotConsumer.isHotConsumerError).toBe("function");
    expectTypeOf<HotConsumerError>().toMatchTypeOf<ExclaveError<"hotConsumer.inputRejected">>();
  });

  it("rejects a BigUint64Array backed by a normal ArrayBuffer", () => {
    const nonShared = new BigUint64Array(new ArrayBuffer(16));
    nonShared[0] = 2n;

    const readCandidate = vi.fn(() => "must-not-run");
    const state = createHotReadState<string>();

    const error = expectHotConsumerError(() =>
      tryReadHotSnapshot({
        sequence: nonShared,
        readCandidate,
        state,
      }),
    );

    expect(readCandidate).not.toHaveBeenCalled();
    expect(error.details.issues.map((issue) => issue.code)).toEqual([
      "input.sequenceBufferNotShared",
    ]);
  });

  it("reports sequenceBufferNotShared alongside other sequence issues when applicable", () => {
    const nonShared = new BigUint64Array(new ArrayBuffer(0));
    const readCandidate = vi.fn(() => "must-not-run");
    const state = createHotReadState<string>();

    const error = expectHotConsumerError(() =>
      tryReadHotSnapshot({
        sequence: nonShared,
        readCandidate,
        state,
      }),
    );

    expect(readCandidate).not.toHaveBeenCalled();
    expect(error.details.issues.map((issue) => issue.code)).toEqual([
      "input.sequenceBufferNotShared",
      "input.sequenceViewTooShort",
    ]);
  });

  it("does not allow Atomics.load to be reached for a non-shared sequence view", () => {
    const nonShared = new BigUint64Array(new ArrayBuffer(16));
    nonShared[0] = 2n;

    const loadSpy = vi.spyOn(Atomics, "load");

    const readCandidate = vi.fn(() => "must-not-run");
    const state = createHotReadState<string>();

    expect(() =>
      tryReadHotSnapshot({
        sequence: nonShared,
        readCandidate,
        state,
      }),
    ).toThrow();

    expect(loadSpy).not.toHaveBeenCalled();
    expect(readCandidate).not.toHaveBeenCalled();
  });
});
