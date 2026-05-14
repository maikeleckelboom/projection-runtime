import {
  type DomainRegistry,
  defineErrorDomain,
  type ErrorCodeOf,
  type ErrorDetails,
  type ErrorDomainWithFactory,
  type ErrorKeyFromCode,
  type JsonObject,
  type KeyedErrorFactoryOf,
  type SeqlokError,
} from "@seqlok/base";
import type { HotCodecIssueCode } from "@seqlok/hot-codec";

export const COMPILER_ISSUE_DEFS = {
  "schema.invalid": "schema validation failed",
  "field.malformedTree": "field tree entry must be an object",
  "field.duplicateDotPath": "duplicate canonical field dotPath",
  "field.fieldIdInvalid": "fieldId derivation must produce a u32 number",
  "field.fieldIdCollision": "fieldId collides with another field",
  "field.countOutOfRange": "field count exceeds canonical u32 encoding range",
  "field.enumVariantCountOutOfRange": "enum variant count exceeds canonical u16 encoding range",
  "field.enumVariantContainsNul": "enum variant cannot contain a null byte",
  "field.lengthOutOfRange": "fixed-vector length exceeds canonical u32 encoding range",
  "field.byteLengthOutOfRange":
    "fixed-string-encoded byteLength exceeds canonical u16 encoding range",
  "field.maxLengthOutOfRange": "bounded-array maxLength exceeds canonical u32 encoding range",
  "field.keyByteLengthOutOfRange": "bounded-map keyByteLength exceeds canonical u16 encoding range",
  "field.maxEntriesOutOfRange": "bounded-map maxEntries exceeds canonical u32 encoding range",
  "lane.hotReservationWithoutHotLane": "hot reservation declared without a hot lane",
  "lane.warmCodecUnsupported": "warm codec must be framed-snapshot",
  "lane.coldMaterializationUnsupported": "cold materialization is not supported",
  "lane.hotReservationUnknownField": "hot reservation names a field that does not exist",
  "lane.hotReservationWrongShape": "hot reservation must name a bounded array or bounded map field",
  "lane.hotFieldNotAdmissible": "field shape is not hot-admissible without a fixed reservation",
  "hot-codec.planningFailed": "hot layout planning failed",
  "lane.hotMissing": "hot lane declaration is required to plan a hot layout",
} as const;

export type CompilerIssueCode = keyof typeof COMPILER_ISSUE_DEFS;

export type CompilerIssueSource = "schema" | "compiler" | "hot-codec";

export interface CompilerIssue extends JsonObject {
  readonly code: CompilerIssueCode;
  readonly path: string;
  readonly detail?: string;
  readonly message: string;
  readonly source?: CompilerIssueSource;
  readonly causeCode?: HotCodecIssueCode;
}

export function createCompilerIssue(
  code: CompilerIssueCode,
  path: string,
  detail?: string,
  source?: CompilerIssueSource,
  causeCode?: HotCodecIssueCode,
): CompilerIssue {
  const issue: CompilerIssue = {
    code,
    path,
    ...(detail === undefined ? {} : { detail }),
    message:
      detail === undefined ? COMPILER_ISSUE_DEFS[code] : `${COMPILER_ISSUE_DEFS[code]}: ${detail}`,
  };

  if (source !== undefined) {
    (issue as Mutable<CompilerIssue>).source = source;
  }

  if (causeCode !== undefined) {
    (issue as Mutable<CompilerIssue>).causeCode = causeCode;
  }

  return issue;
}

type Mutable<T> = { -readonly [K in keyof T]: T[K] };

interface CompilerDomainDefs {
  readonly compilationRejected: {
    readonly message: "Compiler rejected authored projection contract";
    readonly meta: {
      readonly severity: "error";
      readonly recoverable: true;
      readonly boundarySafe: true;
    };
  };
}

const COMPILER_DEFS: CompilerDomainDefs = {
  compilationRejected: {
    message: "Compiler rejected authored projection contract",
    meta: {
      severity: "error",
      recoverable: true,
      boundarySafe: true,
    },
  },
};

const COMPILER_DOMAIN: ErrorDomainWithFactory<"compiler", CompilerDomainDefs> = defineErrorDomain(
  "compiler",
  COMPILER_DEFS,
);

export const COMPILER_ERRORS: DomainRegistry<"compiler", CompilerDomainDefs> =
  COMPILER_DOMAIN.registry as DomainRegistry<"compiler", CompilerDomainDefs>;

export type CompilerDomain = typeof COMPILER_DOMAIN;
export type CompilerErrorCode = ErrorCodeOf<CompilerDomain>;
export type CompilerErrorKey = ErrorKeyFromCode<CompilerErrorCode>;

export interface CompilerCompilationRejectedDetails extends ErrorDetails {
  readonly detail: string;
  readonly issueCount: number;
  readonly issues: readonly CompilerIssue[];
}

interface CompilerDetailsByKey {
  readonly compilationRejected: CompilerCompilationRejectedDetails;
}

export type CompilerError = SeqlokError<"compiler.compilationRejected"> & {
  readonly details: CompilerCompilationRejectedDetails;
};

export const createCompilerDomainError: KeyedErrorFactoryOf<
  CompilerDomain,
  CompilerDetailsByKey
> = (key, details, cause) => COMPILER_DOMAIN.createError(key, details, cause);

export function createCompilerError(
  issues: readonly CompilerIssue[],
  cause?: unknown,
): CompilerError {
  const sortedIssues = sortCompilerIssues(issues);
  return createCompilerDomainError(
    "compilationRejected",
    {
      detail: formatCompilerDetail(sortedIssues),
      issueCount: sortedIssues.length,
      issues: sortedIssues,
    },
    cause,
  ) as CompilerError;
}

export function sortCompilerIssues(issues: readonly CompilerIssue[]): readonly CompilerIssue[] {
  return [...issues].sort(compareIssue);
}

function compareIssue(left: CompilerIssue, right: CompilerIssue): number {
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

function formatCompilerDetail(issues: readonly CompilerIssue[]): string {
  const countLabel = issues.length === 1 ? "1 issue" : `${issues.length} issues`;
  const issueSummary = issues
    .map((issue) => `${issue.code}@${issue.path.length === 0 ? "<root>" : issue.path}`)
    .join("; ");

  return `${countLabel}: ${issueSummary}`;
}
