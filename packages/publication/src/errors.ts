import {
  defineErrorDomain,
  type ErrorDomainWithFactory,
  type KeyedErrorFactoryOf,
} from "@exclave/base";

const PUBLICATION_DEFS = {
  inputRejected: {
    message: "Publication input rejected",
    meta: {
      severity: "error",
      recoverable: false,
      boundarySafe: true,
    },
  },
  decodeRejected: {
    message: "Publication warm payload decode rejected",
    meta: {
      severity: "error",
      recoverable: false,
      boundarySafe: true,
    },
  },
  surfaceNotFound: {
    message: "Publication surface not found for subscribe ack",
    meta: {
      severity: "error",
      recoverable: false,
      boundarySafe: true,
    },
  },
} as const;

export const publicationErrorDomain: ErrorDomainWithFactory<
  "publication",
  typeof PUBLICATION_DEFS
> = defineErrorDomain("publication", PUBLICATION_DEFS);

type PublicationErrorDetails = {
  readonly inputRejected: {
    readonly detail: string;
  };
  readonly decodeRejected: {
    readonly detail: string;
  };
  readonly surfaceNotFound: {
    readonly detail: string;
  };
};

export const createPublicationError: KeyedErrorFactoryOf<
  typeof publicationErrorDomain,
  PublicationErrorDetails
> = publicationErrorDomain.createError;

export function throwInputRejected(detail: string): never {
  throw createPublicationError("inputRejected", { detail });
}

export function throwDecodeRejected(detail: string): never {
  throw createPublicationError("decodeRejected", { detail });
}

export function throwSurfaceNotFound(detail: string): never {
  throw createPublicationError("surfaceNotFound", { detail });
}
