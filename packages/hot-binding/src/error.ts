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

export const HOT_BINDING_ISSUE_DEFS = {
  "input.requestInvalid": "hot binding input must be a non-array object",
  "input.regionViewInvalid": "region must be a Uint8Array",
  "input.regionBufferNotShared": "region must be backed by SharedArrayBuffer",
  "input.regionViewTooShort": "region byteLength must cover totalRegionByteLength",
  "input.totalRegionByteLengthInvalid": "totalRegionByteLength must be a safe positive integer",
  "input.seqlockOffsetInvalid": "seqlockOffset must be a safe non-negative integer",
  "input.seqlockOffsetOutOfRange":
    "seqlock counter byte range must fit inside totalRegionByteLength",
  "input.seqlockOffsetMisaligned": "seqlock counter view must be u64-aligned",
  "input.publicationSequenceOffsetInvalid":
    "publicationSequenceOffset must be a safe non-negative integer",
  "input.publicationSequenceOffsetOutOfRange":
    "publicationSequence counter byte range must fit inside totalRegionByteLength",
  "input.publicationSequenceOffsetMisaligned":
    "publicationSequence counter view must be u64-aligned",
  "input.counterViewsOverlap":
    "seqlock and publicationSequence counter byte ranges must not overlap",
} as const;

export type HotBindingIssueCode = keyof typeof HOT_BINDING_ISSUE_DEFS;

export interface HotBindingIssue extends JsonObject {
  readonly code: HotBindingIssueCode;
  readonly path: string;
  readonly detail?: string;
  readonly message: string;
}

export function createHotBindingIssue(
  code: HotBindingIssueCode,
  path: string,
  detail?: string,
): HotBindingIssue {
  return {
    code,
    path,
    ...(detail === undefined ? {} : { detail }),
    message:
      detail === undefined
        ? HOT_BINDING_ISSUE_DEFS[code]
        : `${HOT_BINDING_ISSUE_DEFS[code]}: ${detail}`,
  };
}

export interface HotBindingInputRejectedDetails extends ErrorDetails {
  readonly where: "bindHotReadRegion" | "bindHotPublishRegion";
  readonly detail: string;
  readonly issueCount: number;
  readonly issues: readonly HotBindingIssue[];
}

interface HotBindingDomainDefs {
  readonly inputRejected: DomainDef;
}

const HOT_BINDING_DEFS: HotBindingDomainDefs = {
  inputRejected: {
    message: "Hot binding input was rejected",
    meta: {
      severity: "error",
      recoverable: true,
      boundarySafe: true,
    },
  },
};

const HOT_BINDING_DOMAIN: ErrorDomainWithFactory<"hotBinding", HotBindingDomainDefs> =
  defineErrorDomain("hotBinding", HOT_BINDING_DEFS);

export const HOT_BINDING_ERRORS: DomainRegistry<"hotBinding", HotBindingDomainDefs> =
  HOT_BINDING_DOMAIN.registry as DomainRegistry<"hotBinding", HotBindingDomainDefs>;

export type HotBindingDomain = typeof HOT_BINDING_DOMAIN;
export type HotBindingErrorCode = ErrorCodeOf<HotBindingDomain>;
export type HotBindingErrorKey = ErrorKeyFromCode<HotBindingErrorCode>;

interface HotBindingDetailsByKey {
  readonly inputRejected: HotBindingInputRejectedDetails;
}

export type HotBindingError = ExclaveError<"hotBinding.inputRejected"> & {
  readonly details: HotBindingInputRejectedDetails;
};

export const createHotBindingError: KeyedErrorFactoryOf<
  HotBindingDomain,
  HotBindingDetailsByKey
> = (key, details, cause) => HOT_BINDING_DOMAIN.createError(key, details, cause);

export function createHotBindingInputRejectedError(
  where: HotBindingInputRejectedDetails["where"],
  issues: readonly HotBindingIssue[],
  cause?: unknown,
): HotBindingError {
  const sortedIssues = sortHotBindingIssues(issues);
  return createHotBindingError(
    "inputRejected",
    {
      where,
      detail: formatHotBindingDetail(sortedIssues),
      issueCount: sortedIssues.length,
      issues: sortedIssues,
    },
    cause,
  ) as HotBindingError;
}

export function isHotBindingError(value: unknown): value is HotBindingError {
  return isExclaveError(value) && value.code === HOT_BINDING_ERRORS.inputRejected.code;
}

export function sortHotBindingIssues(
  issues: readonly HotBindingIssue[],
): readonly HotBindingIssue[] {
  return [...issues].sort(compareIssue);
}

function compareIssue(left: HotBindingIssue, right: HotBindingIssue): number {
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

function formatHotBindingDetail(issues: readonly HotBindingIssue[]): string {
  const countLabel = issues.length === 1 ? "1 issue" : `${issues.length} issues`;
  const issueSummary = issues
    .map((issue) => `${issue.code}@${issue.path.length === 0 ? "<root>" : issue.path}`)
    .join("; ");

  return `${countLabel}: ${issueSummary}`;
}
