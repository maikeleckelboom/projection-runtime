import type { JsonObject } from "@exclave/base";
import { checkJsonObjectRoot } from "@exclave/base";
import type { BindingValidityFailure } from "@exclave/session";
import { throwInputRejected } from "./errors";
import type { WarmFailure, WarmFailureCode } from "./warm-failure";

const CANONICAL_EPOCH_RE = /^(?:0|[1-9][0-9]*)$/;

function encodeEpoch(epoch: string): string {
  if (!CANONICAL_EPOCH_RE.test(epoch)) {
    throwInputRejected(
      `authorityEpoch must be a canonical non-negative decimal string, got: ${epoch}`,
    );
  }
  return epoch;
}

export function createStaleBindingWarmFailure(failure: BindingValidityFailure): WarmFailure {
  const code: WarmFailureCode = "warm.staleBinding";

  const binding = failure.binding;
  const bindingDetails: Record<string, unknown> = {
    authorityKey: binding.authorityKey,
    surfaceKey: binding.surfaceKey,
    authorityEpoch: encodeEpoch(String(binding.authorityEpoch)),
  };

  const details: Record<string, unknown> = {
    reason: failure.reason,
    rebindRequired: failure.rebindRequired,
    binding: bindingDetails,
  };

  if (failure.reason === "bindingInvalidated") {
    details.invalidationReason = failure.invalidationReason;
  }

  if ("expected" in failure) {
    const expected = failure.expected;
    details.expected = {
      authorityKey: expected.authorityKey,
      surfaceKey: expected.surfaceKey,
      authorityEpoch: encodeEpoch(String(expected.authorityEpoch)),
    };
  }

  const detailsResult = checkJsonObjectRoot(details);
  if (!detailsResult.ok) {
    throwInputRejected(
      `internal: projected failure details are not JSON-safe: ${detailsResult.reason}`,
    );
  }

  return {
    code,
    message: `Warm stream rejected: ${failure.reason}`,
    details: detailsResult.value as JsonObject,
  };
}
