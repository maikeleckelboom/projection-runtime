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
} as const;

export const publicationErrorDomain: ErrorDomainWithFactory<
  "publication",
  typeof PUBLICATION_DEFS
> = defineErrorDomain("publication", PUBLICATION_DEFS);

type PublicationErrorDetails = {
  readonly inputRejected: {
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
