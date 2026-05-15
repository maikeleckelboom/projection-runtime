import {
  type DomainRegistry,
  defineErrorDomain,
  type ErrorCodeOf,
  type ErrorDetails,
  type ErrorDomainWithFactory,
  type ErrorKeyFromCode,
  type ExclaveError,
  isExclaveError,
} from "@exclave/base";

export type ConformanceArtifactName =
  | "authored-contract"
  | "canonical-manifest"
  | "hot-block-a-fixture"
  | "hot-block-b-fixture"
  | "hot-byte-fixture"
  | "hot-complete-fixture-region"
  | "hot-layout-manifest"
  | "readme"
  | "resolved-contract";

export type ConformanceFailureArtifactName =
  | ConformanceArtifactName
  | "compile"
  | "fixture-file"
  | "hot-layout-version";

export type ConformanceFailureCode =
  | "artifactMismatch"
  | "compilerRejected"
  | "expectedNumber"
  | "expectedString"
  | "expectedU64Hex"
  | "fieldCountMismatch"
  | "fieldRegionDecodeDiverged"
  | "fixtureFileLoadFailed"
  | "fixtureNotObject"
  | "headerValidationFailed"
  | "hotLayoutVersionMismatch"
  | "invalidFixtureJson"
  | "invalidFixtureName"
  | "missingHotLayoutManifest"
  | "missingRequiredFixtureFile"
  | "missingResolvedContract"
  | "mutableRegionByteLengthMismatch"
  | "semanticVersionMismatch"
  | "u64OutOfRange"
  | "valuesNotObject";

export interface ConformanceErrorDetails extends ErrorDetails {
  readonly detail?: string;
  readonly fixtureName?: string;
  readonly fixturePath?: string;
  readonly fixtureFile?: string;
  readonly relativePath?: string;
  readonly artifact?: ConformanceFailureArtifactName;
  readonly failureCode?: ConformanceFailureCode;
  readonly path?: string;
}

export interface ConformanceFixtureFileRejectedDetails extends ConformanceErrorDetails {
  readonly failureCode:
    | "fixtureFileLoadFailed"
    | "invalidFixtureJson"
    | "invalidFixtureName"
    | "missingRequiredFixtureFile";
}

export interface ConformanceFixtureShapeRejectedDetails extends ConformanceErrorDetails {
  readonly artifact?: ConformanceFailureArtifactName;
  readonly failureCode:
    | "expectedNumber"
    | "expectedString"
    | "expectedU64Hex"
    | "fixtureNotObject"
    | "missingHotLayoutManifest"
    | "missingResolvedContract"
    | "u64OutOfRange"
    | "valuesNotObject";
}

export interface ConformanceFixtureArtifactMismatchDetails extends ConformanceErrorDetails {
  readonly artifact: ConformanceFailureArtifactName;
  readonly failureCode:
    | "artifactMismatch"
    | "fieldCountMismatch"
    | "fieldRegionDecodeDiverged"
    | "headerValidationFailed"
    | "hotLayoutVersionMismatch"
    | "mutableRegionByteLengthMismatch"
    | "semanticVersionMismatch";
}

export interface ConformanceFixtureCompileRejectedDetails extends ConformanceErrorDetails {
  readonly artifact: "compile";
  readonly failureCode: "compilerRejected";
}

interface ConformanceDomainDefs {
  readonly fixtureFileRejected: {
    readonly message: "Fixture file was rejected";
    readonly meta: {
      readonly severity: "error";
      readonly recoverable: true;
      readonly boundarySafe: true;
    };
  };
  readonly fixtureShapeRejected: {
    readonly message: "Fixture shape was rejected";
    readonly meta: {
      readonly severity: "error";
      readonly recoverable: true;
      readonly boundarySafe: true;
    };
  };
  readonly fixtureArtifactMismatch: {
    readonly message: "Fixture artifact does not match golden";
    readonly meta: {
      readonly severity: "error";
      readonly recoverable: true;
      readonly boundarySafe: true;
    };
  };
  readonly fixtureCompileRejected: {
    readonly message: "Fixture compilation was rejected";
    readonly meta: {
      readonly severity: "error";
      readonly recoverable: true;
      readonly boundarySafe: true;
    };
  };
}

const CONFORMANCE_DEFS: ConformanceDomainDefs = {
  fixtureFileRejected: {
    message: "Fixture file was rejected",
    meta: { severity: "error", recoverable: true, boundarySafe: true },
  },
  fixtureShapeRejected: {
    message: "Fixture shape was rejected",
    meta: { severity: "error", recoverable: true, boundarySafe: true },
  },
  fixtureArtifactMismatch: {
    message: "Fixture artifact does not match golden",
    meta: { severity: "error", recoverable: true, boundarySafe: true },
  },
  fixtureCompileRejected: {
    message: "Fixture compilation was rejected",
    meta: { severity: "error", recoverable: true, boundarySafe: true },
  },
};

const CONFORMANCE_DOMAIN: ErrorDomainWithFactory<"conformance", ConformanceDomainDefs> =
  defineErrorDomain("conformance", CONFORMANCE_DEFS);

export const CONFORMANCE_ERRORS: DomainRegistry<"conformance", ConformanceDomainDefs> =
  CONFORMANCE_DOMAIN.registry as DomainRegistry<"conformance", ConformanceDomainDefs>;

export type ConformanceDomain = typeof CONFORMANCE_DOMAIN;
export type ConformanceErrorCode = ErrorCodeOf<ConformanceDomain>;
export type ConformanceErrorKey = ErrorKeyFromCode<ConformanceErrorCode>;

interface ConformanceDetailsByKey {
  readonly fixtureFileRejected: ConformanceFixtureFileRejectedDetails;
  readonly fixtureShapeRejected: ConformanceFixtureShapeRejectedDetails;
  readonly fixtureArtifactMismatch: ConformanceFixtureArtifactMismatchDetails;
  readonly fixtureCompileRejected: ConformanceFixtureCompileRejectedDetails;
}

export type ConformanceError = ExclaveError<ConformanceErrorCode> & {
  readonly details: ConformanceErrorDetails;
};

export type ConformanceErrorForKey<Key extends keyof ConformanceDetailsByKey> = ExclaveError<
  (typeof CONFORMANCE_ERRORS)[Key]["code"]
> & {
  readonly details: ConformanceDetailsByKey[Key];
};

export function createConformanceError<Key extends keyof ConformanceDetailsByKey>(
  key: Key,
  details: ConformanceDetailsByKey[Key],
  cause?: unknown,
): ConformanceErrorForKey<Key> {
  return CONFORMANCE_DOMAIN.createError(key, details, cause) as ConformanceErrorForKey<Key>;
}

export function isConformanceError(value: unknown): value is ConformanceError {
  return isExclaveError(value) && value.code.startsWith("conformance.");
}
