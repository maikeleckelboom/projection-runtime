import type { JsonObject } from "@exclave/base";
import type { BindingValidityFailure } from "@exclave/session";

import type { ControlFailure, ControlFailureCode } from "./control-envelope";
import { throwInputRejected } from "./errors";
import { checkJsonObjectRoot } from "./json-safety";

export type ControlBindingFailureDetails = {
  readonly reason: string;
  readonly rebindRequired: boolean;
  readonly binding: {
    readonly authorityKey: string;
    readonly surfaceKey: string;
    readonly authorityEpoch: string;
  };
  readonly expected?: {
    readonly authorityKey: string;
    readonly surfaceKey: string;
    readonly authorityEpoch: string;
  };
  readonly invalidationReason?: string;
};

function encodeEpoch(epoch: bigint): string {
  if (epoch < 0n) {
    throwInputRejected("Negative authorityEpoch is not allowed");
  }

  return String(epoch);
}

function buildBindingDetails(binding: {
  readonly authorityKey: string;
  readonly surfaceKey: string;
  readonly authorityEpoch: bigint;
}): {
  readonly authorityKey: string;
  readonly surfaceKey: string;
  readonly authorityEpoch: string;
} {
  return {
    authorityKey: binding.authorityKey,
    surfaceKey: binding.surfaceKey,
    authorityEpoch: encodeEpoch(binding.authorityEpoch),
  };
}

function buildExpectedDetails(expected: {
  readonly authorityKey: string;
  readonly surfaceKey: string;
  readonly authorityEpoch: bigint;
}): {
  readonly authorityKey: string;
  readonly surfaceKey: string;
  readonly authorityEpoch: string;
} {
  return {
    authorityKey: expected.authorityKey,
    surfaceKey: expected.surfaceKey,
    authorityEpoch: encodeEpoch(expected.authorityEpoch),
  };
}

export function createBindingInvalidControlFailure(
  failure: BindingValidityFailure,
): ControlFailure {
  const code: ControlFailureCode = "control.bindingInvalid";

  const details: ControlBindingFailureDetails = {
    reason: failure.reason,
    rebindRequired: failure.rebindRequired,
    binding: buildBindingDetails(failure.binding),
    ...(failure.reason === "bindingInvalidated"
      ? { invalidationReason: failure.invalidationReason }
      : {}),
    ...("expected" in failure ? { expected: buildExpectedDetails(failure.expected) } : {}),
  };

  const validated = checkJsonObjectRoot(details);
  if (!validated.ok) {
    throwInputRejected(
      `internal: projected failure details are not JSON-safe: ${validated.reason}`,
    );
  }

  return {
    code,
    message: `Binding validity failure: ${failure.reason}`,
    details: validated.value as JsonObject,
  };
}
