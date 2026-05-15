import {
  createHotConsumerInputRejectedError,
  createHotConsumerIssue,
  type HotConsumerIssue,
} from "./error";

export type HotReadOptions = {
  readonly maxWriterActivePolls?: number;
  readonly maxTornReads?: number;
};

export const HOT_READ_DEFAULTS: Required<HotReadOptions> = {
  maxWriterActivePolls: 2,
  maxTornReads: 2,
};

export type HotReadState<TSnapshot> = {
  lastGood: TSnapshot | null;
};

export type HotReadAttemptFailureReason = "writerActiveBudgetExhausted" | "tornReadBudgetExhausted";

export type HotReadAttemptResult<TSnapshot> =
  | {
      readonly ok: true;
      readonly snapshot: TSnapshot;
      readonly lastGood: TSnapshot;
      readonly sequence: bigint;
      readonly writerActivePolls: number;
      readonly tornReads: number;
      readonly usedFallback: false;
    }
  | {
      readonly ok: false;
      readonly snapshot: TSnapshot | null;
      readonly lastGood: TSnapshot | null;
      readonly reason: HotReadAttemptFailureReason;
      readonly writerActivePolls: number;
      readonly tornReads: number;
      readonly usedFallback: true;
    };

export type TryReadHotSnapshotInput<TSnapshot> = {
  readonly sequence: BigUint64Array;
  readonly readCandidate: () => TSnapshot;
  readonly state: HotReadState<TSnapshot>;
  readonly options?: HotReadOptions;
};

type ValidatedHotReadAttemptInput<TSnapshot> = {
  readonly sequence: BigUint64Array;
  readonly readCandidate: () => TSnapshot;
  readonly state: HotReadState<TSnapshot>;
  readonly maxWriterActivePolls: number;
  readonly maxTornReads: number;
};

export function createHotReadState<TSnapshot = unknown>(): HotReadState<TSnapshot> {
  return { lastGood: null };
}

export function tryReadHotSnapshot<TSnapshot>(
  input: TryReadHotSnapshotInput<TSnapshot>,
): HotReadAttemptResult<TSnapshot> {
  const { sequence, readCandidate, state, maxWriterActivePolls, maxTornReads } =
    validateHotReadAttemptInput(input);

  let writerActivePolls = 0;
  let tornReads = 0;

  for (;;) {
    const seq1 = readSequenceCounter(sequence);

    if (isWriterActive(seq1)) {
      writerActivePolls += 1;
      if (writerActivePolls > maxWriterActivePolls) {
        return createFallbackResult(
          "writerActiveBudgetExhausted",
          state,
          writerActivePolls,
          tornReads,
        );
      }
      continue;
    }

    const candidate = readCandidate();
    const seq2 = readSequenceCounter(sequence);

    if (seq2 === seq1) {
      state.lastGood = candidate;
      return {
        ok: true,
        snapshot: candidate,
        lastGood: candidate,
        sequence: seq2,
        writerActivePolls,
        tornReads,
        usedFallback: false,
      };
    }

    tornReads += 1;
    if (tornReads > maxTornReads) {
      return createFallbackResult("tornReadBudgetExhausted", state, writerActivePolls, tornReads);
    }
  }
}

function readSequenceCounter(sequence: BigUint64Array): bigint {
  return Atomics.load(sequence, 0);
}

function isWriterActive(sequence: bigint): boolean {
  return (sequence & 1n) === 1n;
}

function createFallbackResult<TSnapshot>(
  reason: HotReadAttemptFailureReason,
  state: HotReadState<TSnapshot>,
  writerActivePolls: number,
  tornReads: number,
): HotReadAttemptResult<TSnapshot> {
  const lastGood = state.lastGood;

  return {
    ok: false,
    snapshot: lastGood,
    lastGood,
    reason,
    writerActivePolls,
    tornReads,
    usedFallback: true,
  };
}

function validateHotReadAttemptInput<TSnapshot>(
  input: TryReadHotSnapshotInput<TSnapshot>,
): ValidatedHotReadAttemptInput<TSnapshot> {
  const issues: HotConsumerIssue[] = [];

  if (!isRecord(input)) {
    throw createHotConsumerInputRejectedError([
      createHotConsumerIssue("input.requestInvalid", "input"),
    ]);
  }

  const sequence = input.sequence;
  const readCandidate = input.readCandidate;
  const state = input.state;
  const options = input.options;

  if (sequence instanceof BigUint64Array) {
    if (!(sequence.buffer instanceof SharedArrayBuffer)) {
      issues.push(createHotConsumerIssue("input.sequenceBufferNotShared", "input.sequence"));
    }
    if (sequence.length < 1) {
      issues.push(createHotConsumerIssue("input.sequenceViewTooShort", "input.sequence"));
    }
  } else {
    issues.push(createHotConsumerIssue("input.sequenceViewInvalid", "input.sequence"));
  }

  if (typeof readCandidate !== "function") {
    issues.push(createHotConsumerIssue("input.readCandidateInvalid", "input.readCandidate"));
  }

  if (!isMutableHotReadState(state)) {
    issues.push(createHotConsumerIssue("input.stateInvalid", "input.state"));
  }

  if (options !== undefined && !isRecord(options)) {
    issues.push(createHotConsumerIssue("input.optionsInvalid", "input.options"));
  }

  const optionRecord = isRecord(options) ? options : undefined;
  const maxWriterActivePolls = readBudget(
    optionRecord,
    "maxWriterActivePolls",
    HOT_READ_DEFAULTS.maxWriterActivePolls,
    "input.maxWriterActivePollsInvalid",
    "input.options.maxWriterActivePolls",
    issues,
  );
  const maxTornReads = readBudget(
    optionRecord,
    "maxTornReads",
    HOT_READ_DEFAULTS.maxTornReads,
    "input.maxTornReadsInvalid",
    "input.options.maxTornReads",
    issues,
  );

  if (issues.length > 0) {
    throw createHotConsumerInputRejectedError(issues);
  }

  return {
    sequence: sequence as BigUint64Array,
    readCandidate: readCandidate as () => TSnapshot,
    state: state as HotReadState<TSnapshot>,
    maxWriterActivePolls,
    maxTornReads,
  };
}

function readBudget(
  options: Record<string, unknown> | undefined,
  key: keyof Required<HotReadOptions>,
  defaultValue: number,
  issueCode: "input.maxWriterActivePollsInvalid" | "input.maxTornReadsInvalid",
  path: string,
  issues: HotConsumerIssue[],
): number {
  const value = options?.[key];

  if (value === undefined) {
    return defaultValue;
  }

  if (typeof value !== "number" || !Number.isSafeInteger(value) || value < 0) {
    issues.push(createHotConsumerIssue(issueCode, path));
    return defaultValue;
  }

  return value;
}

function isMutableHotReadState(value: unknown): value is HotReadState<unknown> {
  if (!isRecord(value)) {
    return false;
  }

  const descriptor = Object.getOwnPropertyDescriptor(value, "lastGood");
  if (descriptor === undefined) {
    return false;
  }

  if ("writable" in descriptor) {
    return descriptor.writable;
  }

  return descriptor.get !== undefined && descriptor.set !== undefined;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}
