import type { JsonObject } from "@exclave/base";
import { throwInputRejected } from "./errors";
import {
  assertExactRootKeys,
  assertJsonObject,
  assertNonEmptyString,
  assertPlainObject,
  validationFailure,
  validationMessageFromError,
  validationSuccess,
} from "./validation";

export type HostContractFailureCode = "host-contract.invalidDescriptor" | "host-contract.rejected";

export type HostContractFailure = {
  readonly code: HostContractFailureCode;
  readonly message: string;
  readonly details?: JsonObject;
};

export type HostContractValidationResult<T> =
  | { readonly ok: true; readonly value: T }
  | { readonly ok: false; readonly failure: HostContractFailure };

const VALID_CODES: ReadonlySet<string> = new Set([
  "host-contract.invalidDescriptor",
  "host-contract.rejected",
]);

function isFailureCode(value: unknown): value is HostContractFailureCode {
  return typeof value === "string" && VALID_CODES.has(value);
}

export function createHostContractFailure(input: {
  readonly code: HostContractFailureCode;
  readonly message: string;
  readonly details?: JsonObject;
}): HostContractFailure {
  const obj = assertPlainObject(input, "host contract failure");
  assertExactRootKeys(obj, new Set(["code", "message", "details"]), "host contract failure");

  if (!isFailureCode(obj.code)) {
    throwInputRejected(`invalid host contract failure code: ${String(obj.code)}`);
  }

  const code = obj.code as HostContractFailureCode;
  const message = assertNonEmptyString(obj.message, "failure.message");

  if (obj.details !== undefined) {
    assertJsonObject(obj.details, "failure.details");
  }

  return {
    code,
    message,
    ...(obj.details !== undefined ? { details: obj.details as JsonObject } : {}),
  };
}

export function validateHostContractFailure(
  value: unknown,
): HostContractValidationResult<HostContractFailure> {
  try {
    return validationSuccess(
      createHostContractFailure(
        value as {
          readonly code: HostContractFailureCode;
          readonly message: string;
          readonly details?: JsonObject;
        },
      ),
    );
  } catch (error) {
    const message = validationMessageFromError(error);
    const code: "host-contract.invalidDescriptor" = "host-contract.invalidDescriptor";
    return validationFailure(code, message);
  }
}
