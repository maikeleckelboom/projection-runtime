import type { ErrorMeta } from "@exclave/base";
import { ExclaveError } from "@exclave/base";

const INPUT_REJECTED_META: ErrorMeta = {
  severity: "error",
  recoverable: false,
  boundarySafe: true,
};

export function throwInputRejected(detail: string): never {
  throw new ExclaveError(
    "resource.inputRejected",
    "Resource input rejected",
    { detail },
    INPUT_REJECTED_META,
  );
}
