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

export const HOT_CODEC_ISSUE_DEFS = {
  "input.invalid": "hot layout planning input must be an object",
  "input.contractKeyInvalid": "contractKey must be a non-empty string",
  "hot.invalid": "hot lane declaration must be an object",
  "hot.codecUnsupported": "hot codec must be mapped-fixed",
  "hot.reservationsInvalid": "hot reservations must be an array",
  "field.listInvalid": "fields must be an array",
  "field.countOutOfRange": "field count must fit in u32",
  "field.invalid": "field entry must be an object",
  "field.dotPathInvalid": "field dotPath must be a non-empty string",
  "field.duplicateDotPath": "field dotPath must be unique",
  "field.fieldIdInvalid": "fieldId must be a u32 number",
  "field.duplicateFieldId": "fieldId must be unique within one hot layout",
  "field.orderInvalid": "fields must be sorted lexicographically by UTF-8 dotPath",
  "field.hotNotAdmissible": "shape is hot-admissible only when its dotPath is reserved",
  "reservation.invalid": "hot reservation must be a non-empty dotPath string",
  "reservation.duplicate": "hot reservation dotPath must be unique",
  "reservation.unknownField": "hot reservation names a field that does not exist",
  "reservation.wrongShape": "hot reservation must name a BoundedArray or BoundedMap field",
  "shape.invalid": "field shape must be an object",
  "shape.nanSentinelInvalid": "nanSentinel must be true when present",
  "shape.numericOutOfRange": "numeric shape value is out of range",
  "shape.mapKeyEncodingUnsupported": "BoundedMap keyEncoding must be fixed-ascii",
  "shape.mapValueUnsupported":
    "BoundedMap valueShape must be FixedScalar, FixedEnum, or FixedVector",
  "shape.unknownKind": "field shape kind is not supported by hot-codec",
  "shape.scalarUnsupported": "scalar type is not supported by hot-codec",
  "shape.enumStorageUnsupported": "FixedEnum storage must be u8, u16, or u32",
  "shape.stringEncodingUnsupported": "FixedStringEncoded encoding must be utf8 or ascii",
  "shape.variantsInvalid": "FixedEnum variants must be non-empty strings",
  "shape.variableStringUnsupported": "VariableString is not hot-admissible",
  "shape.variableMapUnsupported": "VariableMap is not hot-admissible",
  "layout.numericOutOfRange": "computed offset or byte length must be a safe u32 integer",
  "byte.hexInvalid":
    "hex bytes must be lowercase, even-length, and contain no prefix or separators",
  "byte.layoutInvalid": "hot layout manifest has an invalid field data window",
  "byte.valuesInvalid": "hot field values must be an object",
  "byte.valueUnknown": "unknown hot field value",
  "byte.bytesLengthInvalid": "hot bytes length does not match expected region or field data length",
  "byte.valueMissing": "missing value for hot field",
  "byte.shapeUnsupported": "shape byte encoding is not supported by this hot-codec helper",
  "byte.boolInvalid": "bool field byte must be 0 or 1",
  "byte.valueInvalid": "field value has an invalid type",
  "byte.variantInvalid": "invalid FixedEnum variant",
  "byte.variantOrdinalInvalid": "FixedEnum ordinal is outside variants",
  "byte.valueLengthInvalid": "FixedVector value length does not match expected length",
  "byte.stringDecodeInvalid": "FixedStringEncoded bytes are invalid",
  "byte.valueTooLong": "encoded string length exceeds allocated byte length",
  "byte.countInvalid": "BoundedArray count exceeds maximum",
  "byte.stringEncodingInvalid": "string contains a non-ascii code unit",
  "byte.valueOutOfRange": "value is outside valid range",
  "byte.reservationMissing": "missing hot reservation metadata",
  "byte.fixtureRegionContractKeyMismatch": "fixture region contractKey must match manifest",
  "byte.fixtureRegionFieldDataOriginInvalid":
    "fixture region manifest fieldDataOrigin must match hot ABI",
  "byte.fixtureRegionLengthInvalid": "fixture region byte length is invalid",
  "header.byteLengthInvalid": "Block A header byte length is invalid",
  "header.magicInvalid": "Block A header magic bytes are invalid",
  "header.hotAbiVersionUnsupported": "Block A header hotAbiVersion is not supported",
  "header.reservedNonZero": "Block A header reserved bytes must be zero",
  "header.contractKeyEmpty": "contractKey must not be empty",
  "header.instanceKeyEmpty": "instanceKey must not be empty",
  "header.semanticVersionOutOfRange": "semanticVersion must be a u64",
  "header.hotLayoutVersionOutOfRange": "hotLayoutVersion must be a u64",
  "header.fieldCountOutOfRange": "fieldCount must be a u32",
  "header.mutableRegionByteLengthOutOfRange": "mutableRegionByteLength must be a u32",
  "header.contractKeyHashMismatch": "contractKey hash mismatch",
  "header.instanceKeyHashMismatch": "instanceKey hash mismatch",
  "header.semanticVersionMismatch": "semanticVersion mismatch",
  "header.hotLayoutVersionMismatch": "hotLayoutVersion mismatch",
  "header.fieldCountMismatch": "fieldCount mismatch",
  "header.mutableRegionByteLengthMismatch": "mutableRegionByteLength mismatch",
  "header.blockBByteLengthInvalid": "Block B header byte length is invalid",
  "header.seqlockCounterOutOfRange": "seqlockCounter must be a u64",
  "header.baselineEpochOutOfRange": "baselineEpoch must be a u32",
  "header.continuityGenerationOutOfRange": "continuityGeneration must be a u32",
  "header.publicationSequenceOutOfRange": "publicationSequence must be a u64",
  "header.seqlockCounterMismatch": "seqlockCounter mismatch",
  "header.baselineEpochMismatch": "baselineEpoch mismatch",
  "header.continuityGenerationMismatch": "continuityGeneration mismatch",
  "header.publicationSequenceMismatch": "publicationSequence mismatch",
} as const;

export type HotCodecIssueCode = keyof typeof HOT_CODEC_ISSUE_DEFS;

export interface HotCodecIssue extends JsonObject {
  readonly code: HotCodecIssueCode;
  readonly path: string;
  readonly detail?: string;
  readonly message: string;
}

export function createHotCodecIssue(
  code: HotCodecIssueCode,
  path: string,
  detail?: string,
): HotCodecIssue {
  return {
    code,
    path,
    ...(detail === undefined ? {} : { detail }),
    message:
      detail === undefined
        ? HOT_CODEC_ISSUE_DEFS[code]
        : `${HOT_CODEC_ISSUE_DEFS[code]}: ${detail}`,
  };
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

export const HOT_CODEC_ERRORS: DomainRegistry<"hotCodec", HotCodecDomainDefs> =
  HOT_CODEC_DOMAIN.registry as DomainRegistry<"hotCodec", HotCodecDomainDefs>;

export type HotCodecDomain = typeof HOT_CODEC_DOMAIN;
export type HotCodecErrorCode = ErrorCodeOf<HotCodecDomain>;
export type HotCodecErrorKey = ErrorKeyFromCode<HotCodecErrorCode>;

interface HotCodecDetailsByKey {
  readonly layoutRejected: HotCodecLayoutRejectedDetails;
  readonly byteRejected: HotByteCodecRejectedDetails;
}

export type HotCodecError = SeqlokError<"hotCodec.layoutRejected"> & {
  readonly details: HotCodecLayoutRejectedDetails;
};

export type HotByteCodecError = SeqlokError<"hotCodec.byteRejected"> & {
  readonly details: HotByteCodecRejectedDetails;
};

export type HotCodecPackageError = HotCodecError | HotByteCodecError;

export const createHotCodecError: KeyedErrorFactoryOf<HotCodecDomain, HotCodecDetailsByKey> = (
  key,
  details,
  cause,
) => HOT_CODEC_DOMAIN.createError(key, details, cause);

export function createHotLayoutRejectedError(
  issues: readonly HotCodecIssue[],
  cause?: unknown,
): HotCodecError {
  const sortedIssues = sortHotCodecIssues(issues);
  return createHotCodecError(
    "layoutRejected",
    {
      where: "planHotLayoutManifest",
      detail: formatHotCodecDetail(sortedIssues),
      issueCount: sortedIssues.length,
      issues: sortedIssues,
    },
    cause,
  ) as HotCodecError;
}

export function createHotByteRejectedError(
  issues: readonly HotCodecIssue[],
  cause?: unknown,
): HotByteCodecError {
  const sortedIssues = sortHotCodecIssues(issues);
  return createHotCodecError(
    "byteRejected",
    {
      where: "hotByteCodec",
      detail: formatHotCodecDetail(sortedIssues),
      issueCount: sortedIssues.length,
      issues: sortedIssues,
    },
    cause,
  ) as HotByteCodecError;
}

export function isHotCodecError(value: unknown): value is HotCodecPackageError {
  return (
    isSeqlokError(value) &&
    (value.code === HOT_CODEC_ERRORS.layoutRejected.code ||
      value.code === HOT_CODEC_ERRORS.byteRejected.code)
  );
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
