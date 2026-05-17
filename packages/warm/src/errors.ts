import {
  defineErrorDomain,
  type ErrorDomainWithFactory,
  type KeyedErrorFactoryOf,
} from "@exclave/base";

const WARM_DEFS = {
  inputRejected: {
    message: "Warm input rejected",
    meta: {
      severity: "error",
      recoverable: false,
      boundarySafe: true,
    },
  },
} as const;

export const warmErrorDomain: ErrorDomainWithFactory<"warm", typeof WARM_DEFS> = defineErrorDomain(
  "warm",
  WARM_DEFS,
);

type WarmErrorDetails = {
  readonly inputRejected: {
    readonly detail: string;
  };
};

export const createWarmError: KeyedErrorFactoryOf<typeof warmErrorDomain, WarmErrorDetails> =
  warmErrorDomain.createError;

export function throwInputRejected(detail: string): never {
  throw createWarmError("inputRejected", { detail });
}
