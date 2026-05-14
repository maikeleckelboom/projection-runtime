import {
  type AssertTrue,
  type DomainDef,
  type DomainRegistry,
  defineErrorDomain,
  type ErrorCodeOf,
  type ErrorDetails,
  type ErrorDomainWithFactory,
  type ErrorKeyFromCode,
  type ErrorKeyOf,
  type IsExact,
  type KeyedErrorFactoryOf,
} from "@seqlok/base";

export type PrimitivesErrorCode = ErrorCodeOf<PrimitivesDomain>;
export type PrimitivesErrorKey = ErrorKeyFromCode<PrimitivesErrorCode>;

export interface PrimitivesPlaneInvalidDetails extends ErrorDetails {
  readonly where: string;
  readonly detail: string;
  readonly plane: string;
}

export interface PrimitivesAlignmentInvalidDetails extends ErrorDetails {
  readonly where: string;
  readonly detail: string;
  readonly value: number;
  readonly align: number;
}

export interface PrimitivesAtomicsFailedDetails extends ErrorDetails {
  readonly where: string;
  readonly detail: string;
  readonly operation: "loadAtomicU32" | "addAtomicU32" | "loadAtomicU64";
  readonly index: number;
  readonly length: number;
  readonly delta?: number;
}

interface PrimitivesDomainDefs {
  readonly planeInvalid: DomainDef;
  readonly alignmentInvalid: DomainDef;
  readonly atomicsFailed: DomainDef;
}

const PRIMITIVES_DEFS: PrimitivesDomainDefs = {
  planeInvalid: {
    message: "Plane key is invalid",
    meta: {
      severity: "error",
      recoverable: true,
      boundarySafe: true,
    },
  },
  alignmentInvalid: {
    message: "Alignment request is invalid",
    meta: {
      severity: "error",
      recoverable: true,
      boundarySafe: true,
    },
  },
  atomicsFailed: {
    message: "Atomics operation failed",
    meta: {
      severity: "fatal",
      recoverable: false,
      boundarySafe: false,
    },
  },
};

export const PRIMITIVES_DOMAIN: ErrorDomainWithFactory<"primitives", PrimitivesDomainDefs> =
  defineErrorDomain("primitives", PRIMITIVES_DEFS);

export type PrimitivesDomain = typeof PRIMITIVES_DOMAIN;
export type PrimitivesErrorsMap = DomainRegistry<"primitives", PrimitivesDomainDefs>;

export const PRIMITIVES_ERRORS: PrimitivesErrorsMap =
  PRIMITIVES_DOMAIN.registry as PrimitivesErrorsMap;

type ExpectedPrimitivesErrorCode =
  | "primitives.planeInvalid"
  | "primitives.alignmentInvalid"
  | "primitives.atomicsFailed";

export type _PrimitivesCodesMatch = AssertTrue<
  IsExact<PrimitivesErrorCode, ExpectedPrimitivesErrorCode>
>;

export interface PrimitivesErrorDetailsByKey {
  readonly planeInvalid: PrimitivesPlaneInvalidDetails;
  readonly alignmentInvalid: PrimitivesAlignmentInvalidDetails;
  readonly atomicsFailed: PrimitivesAtomicsFailedDetails;
}

export type _PrimitivesDetailKeysMatch = AssertTrue<
  IsExact<keyof PrimitivesErrorDetailsByKey, ErrorKeyOf<PrimitivesDomain>>
>;

export type PrimitivesErrorFactory = KeyedErrorFactoryOf<
  PrimitivesDomain,
  PrimitivesErrorDetailsByKey
>;

export const createPrimitivesError: PrimitivesErrorFactory = (key, details, cause) =>
  PRIMITIVES_DOMAIN.createError(key, details, cause);

type DomainKeys = ErrorKeyOf<PrimitivesDomain>;
type KeysEqual = IsExact<PrimitivesErrorKey, DomainKeys>;
export type _PrimitivesKeysMatch = AssertTrue<KeysEqual>;
