import {
  defineErrorDomain,
  type ErrorDomainWithFactory,
  type KeyedErrorFactoryOf,
} from "@exclave/base";

const HOST_CONTRACT_DEFS = {
  inputRejected: {
    message: "Host contract input rejected",
    meta: {
      severity: "error",
      recoverable: false,
      boundarySafe: true,
    },
  },
} as const;

export const hostContractErrorDomain: ErrorDomainWithFactory<
  "host-contract",
  typeof HOST_CONTRACT_DEFS
> = defineErrorDomain("host-contract", HOST_CONTRACT_DEFS);

type HostContractErrorDetails = {
  readonly inputRejected: {
    readonly detail: string;
  };
};

export const createHostContractError: KeyedErrorFactoryOf<
  typeof hostContractErrorDomain,
  HostContractErrorDetails
> = hostContractErrorDomain.createError;

export function throwInputRejected(detail: string): never {
  throw createHostContractError("inputRejected", { detail });
}
