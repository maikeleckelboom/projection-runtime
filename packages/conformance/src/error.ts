import {
  defineErrorDomain,
  type ErrorCodeOf,
  type ErrorDetails,
  type ErrorDomainWithFactory,
  type ErrorKeyFromCode,
  SeqlokError,
} from "@seqlok/base";

export interface ConformanceErrorDetails extends ErrorDetails {
  readonly fixtureName?: string;
  readonly fixturePath?: string;
  readonly fixtureFile?: string;
  readonly relativePath?: string;
  readonly artifact?: string;
  readonly reason?: string;
  readonly issueCode?: string;
  readonly path?: string;
}

interface ConformanceDomainDefs {
  readonly fixtureFileRejected: {
    readonly message: string;
    readonly meta: {
      readonly severity: "error";
      readonly recoverable: true;
      readonly boundarySafe: true;
    };
  };
  readonly fixtureShapeRejected: {
    readonly message: string;
    readonly meta: {
      readonly severity: "error";
      readonly recoverable: true;
      readonly boundarySafe: true;
    };
  };
  readonly fixtureArtifactMismatch: {
    readonly message: string;
    readonly meta: {
      readonly severity: "error";
      readonly recoverable: true;
      readonly boundarySafe: true;
    };
  };
  readonly fixtureCompileRejected: {
    readonly message: string;
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

export type ConformanceErrorCode = ErrorCodeOf<typeof CONFORMANCE_DOMAIN>;
export type ConformanceErrorKey = ErrorKeyFromCode<ConformanceErrorCode>;

export class ConformanceError extends SeqlokError<ConformanceErrorCode> {
  override readonly details: ConformanceErrorDetails;

  constructor(
    code: ConformanceErrorCode,
    message: string,
    details: ConformanceErrorDetails = {},
    cause?: unknown,
  ) {
    const key = code.replace("conformance.", "") as ConformanceErrorKey;
    const descriptor = CONFORMANCE_DOMAIN.registry[key];
    super(code, message, details, descriptor.meta, cause);
    this.details = details;
    Object.setPrototypeOf(this, new.target.prototype);
  }
}
