import {
  defineErrorDomain,
  type ErrorDomainWithFactory,
  type KeyedErrorFactoryOf,
} from "@exclave/base";

const RESOURCE_DEFS = {
  backpressure: {
    message: "Resource capacity is temporarily exhausted",
    meta: { severity: "warning", recoverable: true, boundarySafe: true },
  },
  inputRejected: {
    message: "Resource input rejected",
    meta: {
      severity: "error",
      recoverable: false,
      boundarySafe: true,
    },
  },
} as const;

export const resourceErrorDomain: ErrorDomainWithFactory<"resource", typeof RESOURCE_DEFS> =
  defineErrorDomain("resource", RESOURCE_DEFS);

type ResourceErrorDetails = {
  readonly backpressure: { readonly scope: "handle" | "consumer" | "authority" };
  readonly inputRejected: {
    readonly detail: string;
  };
};

export const createResourceError: KeyedErrorFactoryOf<
  typeof resourceErrorDomain,
  ResourceErrorDetails
> = resourceErrorDomain.createError;

export function throwInputRejected(detail: string): never {
  throw createResourceError("inputRejected", { detail });
}

export function throwResourceBackpressure(scope: "handle" | "consumer" | "authority"): never {
  throw createResourceError("backpressure", { scope });
}
