import {
  type DomainDef,
  type DomainRegistry,
  defineErrorDomain,
  type ErrorCodeOf,
  type ErrorDetails,
  type ErrorDomainWithFactory,
  type ErrorKeyFromCode,
  type JsonObject,
  SeqlokError,
} from "@seqlok/base";

export interface HotCodecIssue extends JsonObject {
  readonly code: string;
  readonly path: string;
  readonly message: string;
}

export interface HotCodecLayoutRejectedDetails extends ErrorDetails {
  readonly where: "planHotLayoutManifest";
  readonly detail: string;
  readonly issueCount: number;
  readonly issues: readonly HotCodecIssue[];
}

export interface HotByteCodecRejectedDetails extends ErrorDetails {
  readonly where: "hotByteCodec";
  readonly detail: string;
  readonly issueCount: number;
  readonly issues: readonly HotCodecIssue[];
}

interface HotCodecDomainDefs {
  readonly layoutRejected: DomainDef;
  readonly byteRejected: DomainDef;
}

const HOT_CODEC_DEFS: HotCodecDomainDefs = {
  layoutRejected: {
    message: "Hot layout planning input was rejected",
    meta: {
      severity: "error",
      recoverable: true,
      boundarySafe: true,
    },
  },
  byteRejected: {
    message: "Hot byte codec input was rejected",
    meta: {
      severity: "error",
      recoverable: true,
      boundarySafe: true,
    },
  },
};

const HOT_CODEC_DOMAIN: ErrorDomainWithFactory<"hotCodec", HotCodecDomainDefs> = defineErrorDomain(
  "hotCodec",
  HOT_CODEC_DEFS,
);

const HOT_CODEC_ERRORS: DomainRegistry<"hotCodec", HotCodecDomainDefs> =
  HOT_CODEC_DOMAIN.registry as DomainRegistry<"hotCodec", HotCodecDomainDefs>;

export type HotCodecDomain = typeof HOT_CODEC_DOMAIN;
export type HotCodecErrorCode = ErrorCodeOf<HotCodecDomain>;
export type HotCodecErrorKey = ErrorKeyFromCode<HotCodecErrorCode>;

export class HotCodecError extends SeqlokError<"hotCodec.layoutRejected"> {
  readonly issues: readonly HotCodecIssue[];

  constructor(issues: readonly HotCodecIssue[], cause?: unknown) {
    const sortedIssues = sortHotCodecIssues(issues);
    super(
      HOT_CODEC_ERRORS.layoutRejected.code,
      HOT_CODEC_ERRORS.layoutRejected.message,
      {
        where: "planHotLayoutManifest",
        detail: formatHotCodecDetail(sortedIssues),
        issueCount: sortedIssues.length,
        issues: sortedIssues,
      } satisfies HotCodecLayoutRejectedDetails,
      HOT_CODEC_ERRORS.layoutRejected.meta,
      cause,
    );
    this.issues = sortedIssues;
  }
}

export class HotByteCodecError extends SeqlokError<"hotCodec.byteRejected"> {
  readonly issues: readonly HotCodecIssue[];

  constructor(issues: readonly HotCodecIssue[], cause?: unknown) {
    const sortedIssues = sortHotCodecIssues(issues);
    super(
      HOT_CODEC_ERRORS.byteRejected.code,
      HOT_CODEC_ERRORS.byteRejected.message,
      {
        where: "hotByteCodec",
        detail: formatHotCodecDetail(sortedIssues),
        issueCount: sortedIssues.length,
        issues: sortedIssues,
      } satisfies HotByteCodecRejectedDetails,
      HOT_CODEC_ERRORS.byteRejected.meta,
      cause,
    );
    this.issues = sortedIssues;
  }
}

export function sortHotCodecIssues(issues: readonly HotCodecIssue[]): readonly HotCodecIssue[] {
  return [...issues].sort(compareIssue);
}

function compareIssue(left: HotCodecIssue, right: HotCodecIssue): number {
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

function formatHotCodecDetail(issues: readonly HotCodecIssue[]): string {
  const countLabel = issues.length === 1 ? "1 issue" : `${issues.length} issues`;
  const issueSummary = issues
    .map((issue) => `${issue.code}@${issue.path.length === 0 ? "<root>" : issue.path}`)
    .join("; ");

  return `${countLabel}: ${issueSummary}`;
}
