import { ExclaveError } from "@exclave/base";
import { describe, expect, expectTypeOf, it, vi } from "vitest";

import * as hotPublisher from "../src/index";
import {
  HOT_PUBLISHER_ERRORS,
  type HotPublisherError,
  type HotPublisherIssueCode,
  type HotPublishInput,
  isHotPublisherError,
  publishHotRegion,
} from "../src/index";

const U64_MAX = 0xffff_ffff_ffff_ffffn;

function u64View(initial: bigint, shared = true): BigUint64Array {
  const buffer = shared ? new SharedArrayBuffer(8) : new ArrayBuffer(8);
  const view = new BigUint64Array(buffer);
  view[0] = initial;
  return view;
}

function expectHotPublisherError(action: () => unknown): HotPublisherError {
  try {
    action();
  } catch (error) {
    expect(error).toBeInstanceOf(ExclaveError);
    expect(isHotPublisherError(error)).toBe(true);
    expect((error as HotPublisherError).code).toBe(HOT_PUBLISHER_ERRORS.inputRejected.code);
    return error as HotPublisherError;
  }

  throw new Error("expected hot publisher failure");
}

describe("@exclave/hot-publisher publication transitions", () => {
  it("stores odd during writeRegion, then commits next even seqlock and next publication sequence", () => {
    const seqlock = u64View(2n);
    const publicationSequence = u64View(42n);
    const observed: bigint[] = [];

    const result = publishHotRegion({
      seqlock,
      publicationSequence,
      writeRegion: () => {
        observed.push(Atomics.load(seqlock, 0));
        observed.push(Atomics.load(publicationSequence, 0));
      },
    });

    expect(observed).toEqual([3n, 42n]);
    expect(Atomics.load(seqlock, 0)).toBe(4n);
    expect(Atomics.load(publicationSequence, 0)).toBe(43n);
    expect(result).toEqual({
      previousSeqlockCounter: 2n,
      seqlockCounter: 4n,
      previousPublicationSequence: 42n,
      publicationSequence: 43n,
    });
  });

  it("rejects an odd starting seqlock before invoking writeRegion", () => {
    const writeRegion = vi.fn();
    const error = expectHotPublisherError(() =>
      publishHotRegion({
        seqlock: u64View(3n),
        publicationSequence: u64View(42n),
        writeRegion,
      }),
    );

    expect(writeRegion).not.toHaveBeenCalled();
    expect(error.details.issues.map((issue) => issue.code)).toEqual(["input.seqlockCounterOdd"]);
  });

  it("rejects seqlock overflow before publication", () => {
    const writeRegion = vi.fn();
    const seqlock = u64View(U64_MAX - 1n);
    const publicationSequence = u64View(42n);
    const error = expectHotPublisherError(() =>
      publishHotRegion({
        seqlock,
        publicationSequence,
        writeRegion,
      }),
    );

    expect(writeRegion).not.toHaveBeenCalled();
    expect(Atomics.load(seqlock, 0)).toBe(U64_MAX - 1n);
    expect(Atomics.load(publicationSequence, 0)).toBe(42n);
    expect(error.details.issues.map((issue) => issue.code)).toEqual([
      "input.seqlockCounterOverflow",
    ]);
  });

  it("rejects publicationSequence overflow before mutation", () => {
    const writeRegion = vi.fn();
    const seqlock = u64View(2n);
    const publicationSequence = u64View(U64_MAX);
    const error = expectHotPublisherError(() =>
      publishHotRegion({
        seqlock,
        publicationSequence,
        writeRegion,
      }),
    );

    expect(writeRegion).not.toHaveBeenCalled();
    expect(Atomics.load(seqlock, 0)).toBe(2n);
    expect(Atomics.load(publicationSequence, 0)).toBe(U64_MAX);
    expect(error.details.issues.map((issue) => issue.code)).toEqual([
      "input.publicationSequenceOverflow",
    ]);
  });

  it("leaves the seqlock odd, does not increment publicationSequence, and propagates writeRegion throws", () => {
    const seqlock = u64View(2n);
    const publicationSequence = u64View(42n);
    const thrown = new Error("write failed");

    try {
      publishHotRegion({
        seqlock,
        publicationSequence,
        writeRegion: () => {
          throw thrown;
        },
      });
    } catch (error) {
      expect(error).toBe(thrown);
      expect(Atomics.load(seqlock, 0)).toBe(3n);
      expect(Atomics.load(publicationSequence, 0)).toBe(42n);
      return;
    }

    throw new Error("expected writeRegion to throw");
  });
});

describe("@exclave/hot-publisher input errors and public error surface", () => {
  it("rejects non-object input", () => {
    const error = expectHotPublisherError(() =>
      publishHotRegion(null as unknown as HotPublishInput),
    );

    expect(error.details.issues.map((issue) => issue.code)).toEqual(["input.requestInvalid"]);
  });

  it("rejects non-BigUint64Array seqlock views", () => {
    const error = expectHotPublisherError(() =>
      publishHotRegion({
        seqlock: new Uint8Array(new SharedArrayBuffer(8)),
        publicationSequence: u64View(42n),
        writeRegion: () => undefined,
      } as unknown as HotPublishInput),
    );

    expect(error.details.issues.map((issue) => issue.code)).toEqual(["input.seqlockViewInvalid"]);
  });

  it("rejects seqlock views not backed by SharedArrayBuffer", () => {
    const error = expectHotPublisherError(() =>
      publishHotRegion({
        seqlock: u64View(2n, false),
        publicationSequence: u64View(42n),
        writeRegion: () => undefined,
      }),
    );

    expect(error.details.issues.map((issue) => issue.code)).toEqual([
      "input.seqlockBufferNotShared",
    ]);
  });

  it("rejects too-short seqlock views", () => {
    const error = expectHotPublisherError(() =>
      publishHotRegion({
        seqlock: new BigUint64Array(new SharedArrayBuffer(0)),
        publicationSequence: u64View(42n),
        writeRegion: () => undefined,
      }),
    );

    expect(error.details.issues.map((issue) => issue.code)).toEqual(["input.seqlockViewTooShort"]);
  });

  it("rejects non-BigUint64Array publicationSequence views", () => {
    const error = expectHotPublisherError(() =>
      publishHotRegion({
        seqlock: u64View(2n),
        publicationSequence: new Uint8Array(new SharedArrayBuffer(8)),
        writeRegion: () => undefined,
      } as unknown as HotPublishInput),
    );

    expect(error.details.issues.map((issue) => issue.code)).toEqual([
      "input.publicationSequenceViewInvalid",
    ]);
  });

  it("rejects publicationSequence views not backed by SharedArrayBuffer", () => {
    const error = expectHotPublisherError(() =>
      publishHotRegion({
        seqlock: u64View(2n),
        publicationSequence: u64View(42n, false),
        writeRegion: () => undefined,
      }),
    );

    expect(error.details.issues.map((issue) => issue.code)).toEqual([
      "input.publicationSequenceBufferNotShared",
    ]);
  });

  it("rejects too-short publicationSequence views", () => {
    const error = expectHotPublisherError(() =>
      publishHotRegion({
        seqlock: u64View(2n),
        publicationSequence: new BigUint64Array(new SharedArrayBuffer(0)),
        writeRegion: () => undefined,
      }),
    );

    expect(error.details.issues.map((issue) => issue.code)).toEqual([
      "input.publicationSequenceViewTooShort",
    ]);
  });

  it("rejects invalid writeRegion", () => {
    const error = expectHotPublisherError(() =>
      publishHotRegion({
        seqlock: u64View(2n),
        publicationSequence: u64View(42n),
        writeRegion: "not-a-function",
      } as unknown as HotPublishInput),
    );

    expect(error.details.issues.map((issue) => issue.code)).toEqual(["input.writeRegionInvalid"]);
  });

  it("collects stable issue codes and paths before touching Atomics", () => {
    const loadSpy = vi.spyOn(Atomics, "load");
    const error = expectHotPublisherError(() =>
      publishHotRegion({
        seqlock: new BigUint64Array(new ArrayBuffer(0)),
        publicationSequence: new BigUint64Array(new ArrayBuffer(0)),
        writeRegion: undefined,
      } as unknown as HotPublishInput),
    );

    expect(loadSpy).not.toHaveBeenCalled();
    expect(error.details.issues.map((issue) => [issue.code, issue.path])).toEqual([
      ["input.publicationSequenceBufferNotShared", "input.publicationSequence"],
      ["input.publicationSequenceViewTooShort", "input.publicationSequence"],
      ["input.seqlockBufferNotShared", "input.seqlock"],
      ["input.seqlockViewTooShort", "input.seqlock"],
      ["input.writeRegionInvalid", "input.writeRegion"],
    ]);
  });

  it("keeps HotPublisherError type-only while exporting descriptor, creator, and predicate helpers", () => {
    expect("HotPublisherError" in hotPublisher).toBe(false);
    expect(HOT_PUBLISHER_ERRORS.inputRejected.code).toBe("hotPublisher.inputRejected");
    expect(typeof hotPublisher.createHotPublisherInputRejectedError).toBe("function");
    expect(typeof hotPublisher.isHotPublisherError).toBe("function");
    expectTypeOf<HotPublisherError>().toMatchTypeOf<ExclaveError<"hotPublisher.inputRejected">>();
  });

  it("exports the intended issue code surface", () => {
    expectTypeOf<HotPublisherIssueCode>().toEqualTypeOf<
      | "input.requestInvalid"
      | "input.seqlockViewInvalid"
      | "input.seqlockBufferNotShared"
      | "input.seqlockViewTooShort"
      | "input.seqlockCounterOdd"
      | "input.seqlockCounterOverflow"
      | "input.publicationSequenceViewInvalid"
      | "input.publicationSequenceBufferNotShared"
      | "input.publicationSequenceViewTooShort"
      | "input.publicationSequenceOverflow"
      | "input.counterViewsOverlap"
      | "input.writeRegionInvalid"
    >();
  });

  it("rejects array input with input.requestInvalid", () => {
    const error = expectHotPublisherError(() => publishHotRegion([] as unknown as HotPublishInput));

    expect(error.details.issues.map((issue) => issue.code)).toEqual(["input.requestInvalid"]);
  });

  it("rejects the same BigUint64Array as both seqlock and publicationSequence with input.counterViewsOverlap", () => {
    const shared = new SharedArrayBuffer(BigUint64Array.BYTES_PER_ELEMENT);
    const view = new BigUint64Array(shared);
    view[0] = 2n;

    const error = expectHotPublisherError(() =>
      publishHotRegion({
        seqlock: view,
        publicationSequence: view,
        writeRegion: () => undefined,
      }),
    );

    expect(error.details.issues.map((issue) => issue.code)).toEqual(["input.counterViewsOverlap"]);
  });

  it("rejects separate views with the same byteOffset over the same SharedArrayBuffer with input.counterViewsOverlap", () => {
    const shared = new SharedArrayBuffer(BigUint64Array.BYTES_PER_ELEMENT);
    const seqlock = new BigUint64Array(shared, 0, 1);
    const publicationSequence = new BigUint64Array(shared, 0, 1);
    seqlock[0] = 2n;
    publicationSequence[0] = 42n;

    const error = expectHotPublisherError(() =>
      publishHotRegion({
        seqlock,
        publicationSequence,
        writeRegion: () => undefined,
      }),
    );

    expect(error.details.issues.map((issue) => issue.code)).toEqual(["input.counterViewsOverlap"]);
  });

  it("accepts non-overlapping views over the same SharedArrayBuffer", () => {
    const shared = new SharedArrayBuffer(BigUint64Array.BYTES_PER_ELEMENT * 2);
    const seqlock = new BigUint64Array(shared, 0, 1);
    const publicationSequence = new BigUint64Array(shared, BigUint64Array.BYTES_PER_ELEMENT, 1);
    seqlock[0] = 2n;
    publicationSequence[0] = 42n;

    const result = publishHotRegion({
      seqlock,
      publicationSequence,
      writeRegion: () => undefined,
    });

    expect(result).toEqual({
      previousSeqlockCounter: 2n,
      seqlockCounter: 4n,
      previousPublicationSequence: 42n,
      publicationSequence: 43n,
    });
  });
});
