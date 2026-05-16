import {
  createHotPublisherInputRejectedError,
  createHotPublisherIssue,
  type HotPublisherIssue,
} from "./error";

export type HotPublishInput = {
  readonly seqlock: BigUint64Array;
  readonly publicationSequence: BigUint64Array;
  readonly writeRegion: () => void;
};

export type HotPublishResult = {
  readonly previousSeqlockCounter: bigint;
  readonly seqlockCounter: bigint;
  readonly previousPublicationSequence: bigint;
  readonly publicationSequence: bigint;
};

type ValidatedHotPublishInput = {
  readonly seqlock: BigUint64Array;
  readonly publicationSequence: BigUint64Array;
  readonly writeRegion: () => void;
};

const U64_MAX = 0xffff_ffff_ffff_ffffn;
const MAX_SEQLOCK_COUNTER_BEFORE_PUBLISH = U64_MAX - 2n;
const MAX_PUBLICATION_SEQUENCE_BEFORE_PUBLISH = U64_MAX - 1n;

export function publishHotRegion(input: HotPublishInput): HotPublishResult {
  const { seqlock, publicationSequence, writeRegion } = validateHotPublishInput(input);

  const previousSeqlockCounter = Atomics.load(seqlock, 0);

  if ((previousSeqlockCounter & 1n) === 1n) {
    throw createHotPublisherInputRejectedError([
      createHotPublisherIssue("input.seqlockCounterOdd", "input.seqlock"),
    ]);
  }

  if (previousSeqlockCounter > MAX_SEQLOCK_COUNTER_BEFORE_PUBLISH) {
    throw createHotPublisherInputRejectedError([
      createHotPublisherIssue("input.seqlockCounterOverflow", "input.seqlock"),
    ]);
  }

  const previousPublicationSequence = Atomics.load(publicationSequence, 0);

  if (previousPublicationSequence > MAX_PUBLICATION_SEQUENCE_BEFORE_PUBLISH) {
    throw createHotPublisherInputRejectedError([
      createHotPublisherIssue("input.publicationSequenceOverflow", "input.publicationSequence"),
    ]);
  }

  const activeSeqlockCounter = previousSeqlockCounter + 1n;
  const committedSeqlockCounter = previousSeqlockCounter + 2n;
  const committedPublicationSequence = previousPublicationSequence + 1n;

  Atomics.store(seqlock, 0, activeSeqlockCounter);
  writeRegion();
  Atomics.store(publicationSequence, 0, committedPublicationSequence);
  Atomics.store(seqlock, 0, committedSeqlockCounter);

  return {
    previousSeqlockCounter,
    seqlockCounter: committedSeqlockCounter,
    previousPublicationSequence,
    publicationSequence: committedPublicationSequence,
  };
}

function validateHotPublishInput(input: HotPublishInput): ValidatedHotPublishInput {
  const issues: HotPublisherIssue[] = [];

  if (!isRecord(input)) {
    throw createHotPublisherInputRejectedError([
      createHotPublisherIssue("input.requestInvalid", "input"),
    ]);
  }

  const seqlock = input.seqlock;
  const publicationSequence = input.publicationSequence;
  const writeRegion = input.writeRegion;

  if (seqlock instanceof BigUint64Array) {
    if (!(seqlock.buffer instanceof SharedArrayBuffer)) {
      issues.push(createHotPublisherIssue("input.seqlockBufferNotShared", "input.seqlock"));
    }
    if (seqlock.length < 1) {
      issues.push(createHotPublisherIssue("input.seqlockViewTooShort", "input.seqlock"));
    }
  } else {
    issues.push(createHotPublisherIssue("input.seqlockViewInvalid", "input.seqlock"));
  }

  if (publicationSequence instanceof BigUint64Array) {
    if (!(publicationSequence.buffer instanceof SharedArrayBuffer)) {
      issues.push(
        createHotPublisherIssue(
          "input.publicationSequenceBufferNotShared",
          "input.publicationSequence",
        ),
      );
    }
    if (publicationSequence.length < 1) {
      issues.push(
        createHotPublisherIssue(
          "input.publicationSequenceViewTooShort",
          "input.publicationSequence",
        ),
      );
    }
  } else {
    issues.push(
      createHotPublisherIssue("input.publicationSequenceViewInvalid", "input.publicationSequence"),
    );
  }

  if (typeof writeRegion !== "function") {
    issues.push(createHotPublisherIssue("input.writeRegionInvalid", "input.writeRegion"));
  }

  if (
    seqlock instanceof BigUint64Array &&
    publicationSequence instanceof BigUint64Array &&
    seqlock.buffer instanceof SharedArrayBuffer &&
    publicationSequence.buffer instanceof SharedArrayBuffer &&
    seqlock.length >= 1 &&
    publicationSequence.length >= 1 &&
    counterViewsOverlap(seqlock, publicationSequence)
  ) {
    issues.push(createHotPublisherIssue("input.counterViewsOverlap", "input.publicationSequence"));
  }

  if (issues.length > 0) {
    throw createHotPublisherInputRejectedError(issues);
  }

  return {
    seqlock: seqlock as BigUint64Array,
    publicationSequence: publicationSequence as BigUint64Array,
    writeRegion: writeRegion as () => void,
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function counterViewsOverlap(
  seqlock: BigUint64Array,
  publicationSequence: BigUint64Array,
): boolean {
  if (seqlock.buffer !== publicationSequence.buffer) {
    return false;
  }

  const seqlockStart = seqlock.byteOffset;
  const seqlockEnd = seqlockStart + BigUint64Array.BYTES_PER_ELEMENT;
  const publicationSequenceStart = publicationSequence.byteOffset;
  const publicationSequenceEnd = publicationSequenceStart + BigUint64Array.BYTES_PER_ELEMENT;

  return byteRangesOverlap(
    seqlockStart,
    seqlockEnd,
    publicationSequenceStart,
    publicationSequenceEnd,
  );
}

function byteRangesOverlap(startA: number, endA: number, startB: number, endB: number): boolean {
  return startA < endB && startB < endA;
}
