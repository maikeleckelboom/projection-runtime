import {
  type DomainDef,
  type DomainRegistry,
  defineErrorDomain,
  type ErrorCodeOf,
  type ErrorDetails,
  type ErrorDomainWithFactory,
  type ErrorKeyFromCode,
  type ExclaveError,
  isExclaveError,
  type JsonObject,
  type KeyedErrorFactoryOf,
} from "@exclave/base";

export const HOT_PUBLISHER_ISSUE_DEFS = {
  "input.requestInvalid": "hot publication input must be an object",
  "input.seqlockViewInvalid": "seqlock view must be a BigUint64Array",
  "input.seqlockBufferNotShared": "seqlock view must be backed by SharedArrayBuffer",
  "input.seqlockViewTooShort": "seqlock view must contain at least one u64 counter",
  "input.seqlockCounterOdd": "seqlock counter must be even before publication",
  "input.seqlockCounterOverflow": "seqlock counter cannot be incremented by two within u64",
  "input.publicationSequenceViewInvalid": "publicationSequence view must be a BigUint64Array",
  "input.publicationSequenceBufferNotShared":
    "publicationSequence view must be backed by SharedArrayBuffer",
  "input.publicationSequenceViewTooShort":
    "publicationSequence view must contain at least one u64 counter",
  "input.publicationSequenceOverflow":
    "publicationSequence cannot be incremented by one within u64",
  "input.counterViewsOverlap": "seqlock and publicationSequence counter views must not overlap",
  "input.writeRegionInvalid": "writeRegion must be a function",
} as const;

export type HotPublisherIssueCode = keyof typeof HOT_PUBLISHER_ISSUE_DEFS;

export interface HotPublisherIssue extends JsonObject {
  readonly code: HotPublisherIssueCode;
  readonly path: string;
  readonly detail?: string;
  readonly message: string;
}

export function createHotPublisherIssue(
  code: HotPublisherIssueCode,
  path: string,
  detail?: string,
): HotPublisherIssue {
  return {
    code,
    path,
    ...(detail === undefined ? {} : { detail }),
    message:
      detail === undefined
        ? HOT_PUBLISHER_ISSUE_DEFS[code]
        : `${HOT_PUBLISHER_ISSUE_DEFS[code]}: ${detail}`,
  };
}

export interface HotPublisherInputRejectedDetails extends ErrorDetails {
  readonly where: "publishHotRegion";
  readonly detail: string;
  readonly issueCount: number;
  readonly issues: readonly HotPublisherIssue[];
}

interface HotPublisherDomainDefs {
  readonly inputRejected: DomainDef;
}

const HOT_PUBLISHER_DEFS: HotPublisherDomainDefs = {
  inputRejected: {
    message: "Hot publisher input was rejected",
    meta: {
      severity: "error",
      recoverable: true,
      boundarySafe: true,
    },
  },
};

const HOT_PUBLISHER_DOMAIN: ErrorDomainWithFactory<"hotPublisher", HotPublisherDomainDefs> =
  defineErrorDomain("hotPublisher", HOT_PUBLISHER_DEFS);

export const HOT_PUBLISHER_ERRORS: DomainRegistry<"hotPublisher", HotPublisherDomainDefs> =
  HOT_PUBLISHER_DOMAIN.registry as DomainRegistry<"hotPublisher", HotPublisherDomainDefs>;

export type HotPublisherDomain = typeof HOT_PUBLISHER_DOMAIN;
export type HotPublisherErrorCode = ErrorCodeOf<HotPublisherDomain>;
export type HotPublisherErrorKey = ErrorKeyFromCode<HotPublisherErrorCode>;

interface HotPublisherDetailsByKey {
  readonly inputRejected: HotPublisherInputRejectedDetails;
}

export type HotPublisherError = ExclaveError<"hotPublisher.inputRejected"> & {
  readonly details: HotPublisherInputRejectedDetails;
};

export const createHotPublisherError: KeyedErrorFactoryOf<
  HotPublisherDomain,
  HotPublisherDetailsByKey
> = (key, details, cause) => HOT_PUBLISHER_DOMAIN.createError(key, details, cause);

export function createHotPublisherInputRejectedError(
  issues: readonly HotPublisherIssue[],
  cause?: unknown,
): HotPublisherError {
  const sortedIssues = sortHotPublisherIssues(issues);
  return createHotPublisherError(
    "inputRejected",
    {
      where: "publishHotRegion",
      detail: formatHotPublisherDetail(sortedIssues),
      issueCount: sortedIssues.length,
      issues: sortedIssues,
    },
    cause,
  ) as HotPublisherError;
}

export function isHotPublisherError(value: unknown): value is HotPublisherError {
  return isExclaveError(value) && value.code === HOT_PUBLISHER_ERRORS.inputRejected.code;
}

export function sortHotPublisherIssues(
  issues: readonly HotPublisherIssue[],
): readonly HotPublisherIssue[] {
  return [...issues].sort(compareIssue);
}

function compareIssue(left: HotPublisherIssue, right: HotPublisherIssue): number {
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

function formatHotPublisherDetail(issues: readonly HotPublisherIssue[]): string {
  const countLabel = issues.length === 1 ? "1 issue" : `${issues.length} issues`;
  const issueSummary = issues
    .map((issue) => `${issue.code}@${issue.path.length === 0 ? "<root>" : issue.path}`)
    .join("; ");

  return `${countLabel}: ${issueSummary}`;
}
