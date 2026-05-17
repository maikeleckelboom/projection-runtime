import {
  defineErrorDomain,
  type ErrorDomainWithFactory,
  type KeyedErrorFactoryOf,
} from "@exclave/base";

const CONTROL_PLANE_DEFS = {
  inputRejected: {
    message: "Control-plane input rejected",
    meta: {
      severity: "error",
      recoverable: false,
      boundarySafe: true,
    },
  },
} as const;

export const controlPlaneErrorDomain: ErrorDomainWithFactory<
  "control-plane",
  typeof CONTROL_PLANE_DEFS
> = defineErrorDomain("control-plane", CONTROL_PLANE_DEFS);

type ControlPlaneErrorDetails = {
  readonly inputRejected: {
    readonly detail: string;
  };
};

export const createControlPlaneError: KeyedErrorFactoryOf<
  typeof controlPlaneErrorDomain,
  ControlPlaneErrorDetails
> = controlPlaneErrorDomain.createError;

export function throwInputRejected(detail: string): never {
  throw createControlPlaneError("inputRejected", { detail });
}
