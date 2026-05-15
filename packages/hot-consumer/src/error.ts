import {
  type DomainDef,
  type DomainRegistry,
  defineErrorDomain,
  type ErrorCodeOf,
  type ErrorDetails,
  type ErrorDomainWithFactory,
  type ErrorKeyFromCode,
  isSeqlokError,
  type JsonObject,
  type KeyedErrorFactoryOf,
  type SeqlokError,
} from "@seqlok/base";

export const HOT_CONSUMER_ISSUE_DEFS = {
  "input.requestInvalid": "hot read attempt input must be an object",
  "input.sequenceViewInvalid": "sequence view must be a BigUint64Array",
  "input.sequenceViewTooShort": "sequence view must contain at least one u64 counter",
  "input.readCandidateInvalid": "readCandidate must be a function",
  "input.stateInvalid": "hot read state must expose a mutable lastGood slot",
  "input.optionsInvalid": "hot read options must be an object when provided",
  "input.maxWriterActivePollsInvalid": "maxWriterActivePolls must be a non-negative safe integer",
  "input.maxTornReadsInvalid": "maxTornReads must be a non-negative safe integer",
} as const;

export type HotConsumerIssueCode = keyof typeof HOT_CONSUMER_ISSUE_DEFS;

export interface HotConsumerIssue extends JsonObject {
  readonly code: HotConsumerIssueCode;
  readonly path: string;
  readonly detail?: string;
  readonly message: string;
}

export function createHotConsumerIssue(
  code: HotConsumerIssueCode,
  path: string,
  detail?: string,
): HotConsumerIssue {
  return {
    code,
    path,
    ...(detail === undefined ? {} : { detail }),
    message:
      detail === undefined
        ? HOT_CONSUMER_ISSUE_DEFS[code]
        : `${HOT_CONSUMER_ISSUE_DEFS[code]}: ${detail}`,
  };
}

export interface HotConsumerInputRejectedDetails extends ErrorDetails {
  readonly where: "tryReadHotSnapshot";
  readonly detail: string;
  readonly issueCount: number;
  readonly issues: readonly HotConsumerIssue[];
}

interface HotConsumerDomainDefs {
  readonly inputRejected: DomainDef;
}

const HOT_CONSUMER_DEFS: HotConsumerDomainDefs = {
  inputRejected: {
    message: "Hot consumer input was rejected",
    meta: {
      severity: "error",
      recoverable: true,
      boundarySafe: true,
    },
  },
};

const HOT_CONSUMER_DOMAIN: ErrorDomainWithFactory<"hotConsumer", HotConsumerDomainDefs> =
  defineErrorDomain("hotConsumer", HOT_CONSUMER_DEFS);

export const HOT_CONSUMER_ERRORS: DomainRegistry<"hotConsumer", HotConsumerDomainDefs> =
  HOT_CONSUMER_DOMAIN.registry as DomainRegistry<"hotConsumer", HotConsumerDomainDefs>;

export type HotConsumerDomain = typeof HOT_CONSUMER_DOMAIN;
export type HotConsumerErrorCode = ErrorCodeOf<HotConsumerDomain>;
export type HotConsumerErrorKey = ErrorKeyFromCode<HotConsumerErrorCode>;

interface HotConsumerDetailsByKey {
  readonly inputRejected: HotConsumerInputRejectedDetails;
}

export type HotConsumerError = SeqlokError<"hotConsumer.inputRejected"> & {
  readonly details: HotConsumerInputRejectedDetails;
};

export const createHotConsumerError: KeyedErrorFactoryOf<
  HotConsumerDomain,
  HotConsumerDetailsByKey
> = (key, details, cause) => HOT_CONSUMER_DOMAIN.createError(key, details, cause);

export function createHotConsumerInputRejectedError(
  issues: readonly HotConsumerIssue[],
  cause?: unknown,
): HotConsumerError {
  const sortedIssues = sortHotConsumerIssues(issues);
  return createHotConsumerError(
    "inputRejected",
    {
      where: "tryReadHotSnapshot",
      detail: formatHotConsumerDetail(sortedIssues),
      issueCount: sortedIssues.length,
      issues: sortedIssues,
    },
    cause,
  ) as HotConsumerError;
}

export function isHotConsumerError(value: unknown): value is HotConsumerError {
  return isSeqlokError(value) && value.code === HOT_CONSUMER_ERRORS.inputRejected.code;
}

export function sortHotConsumerIssues(
  issues: readonly HotConsumerIssue[],
): readonly HotConsumerIssue[] {
  return [...issues].sort(compareIssue);
}

function compareIssue(left: HotConsumerIssue, right: HotConsumerIssue): number {
  const pathOrder = compareString(left.path, right.path);
  if (pathOrder !== 0) {
    return pathOrder;
  }

  return compareString(left.code, right.code);
}

function compareString(left: string, right: string): number {
  if (left < right) {
    return -1;
  }

  if (left > right) {
    return 1;
  }

  return 0;
}

function formatHotConsumerDetail(issues: readonly HotConsumerIssue[]): string {
  const countLabel = issues.length === 1 ? "1 issue" : `${issues.length} issues`;
  const issueSummary = issues
    .map((issue) => `${issue.code}@${issue.path.length === 0 ? "<root>" : issue.path}`)
    .join("; ");

  return `${countLabel}: ${issueSummary}`;
}
