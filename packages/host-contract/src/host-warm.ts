import { checkJsonObjectRoot, ExclaveError } from "@exclave/base";
import { WARM_ENVELOPE_VERSION } from "@exclave/warm";
import { throwInputRejected } from "./errors";
import type { HostContractFailure, HostContractValidationResult } from "./host-failure";

export type HostWarmStreamDescriptor = {
  readonly kind: "host.warmStream";
  readonly envelopeVersion: typeof WARM_ENVELOPE_VERSION;
  readonly streamKey: string;
};

const OWNED_ROOT_KEYS: ReadonlySet<string> = new Set(["kind", "envelopeVersion", "streamKey"]);

function assertNonEmptyString(value: unknown, label: string): string {
  if (typeof value !== "string") {
    throwInputRejected(`${label} must be a string`);
  }
  if (value.length === 0) {
    throwInputRejected(`${label} must be a non-empty string`);
  }
  return value;
}

function assertPlainObject(value: unknown, label: string): Record<string, unknown> {
  const result = checkJsonObjectRoot(value);
  if (!result.ok) {
    throwInputRejected(`${label} is not a plain data object: ${result.reason}`);
  }
  return value as Record<string, unknown>;
}

function assertExactRootKeys(
  value: Record<string, unknown>,
  allowedKeys: ReadonlySet<string>,
  label: string,
): void {
  for (const key of Object.keys(value)) {
    if (!allowedKeys.has(key)) {
      throwInputRejected(`${label} must not have extra field: ${key}`);
    }
  }
}

function validationFailure(
  code: "host-contract.invalidDescriptor" | "host-contract.rejected",
  message: string,
): HostContractValidationResult<never> {
  return {
    ok: false as const,
    failure: { code, message } as HostContractFailure,
  };
}

function validationSuccess<T>(value: T): HostContractValidationResult<T> {
  return { ok: true as const, value };
}

export function createHostWarmStreamDescriptorThrowing(input: unknown): HostWarmStreamDescriptor {
  const obj = assertPlainObject(input, "host warm stream descriptor");
  assertExactRootKeys(obj, OWNED_ROOT_KEYS, "host warm stream descriptor");

  if (obj.kind !== "host.warmStream") {
    throwInputRejected(
      `host warm stream descriptor kind must be "host.warmStream", got ${JSON.stringify(obj.kind)}`,
    );
  }

  if (obj.envelopeVersion !== WARM_ENVELOPE_VERSION) {
    throwInputRejected(
      `host warm stream descriptor envelopeVersion must be ${WARM_ENVELOPE_VERSION}, got ${JSON.stringify(obj.envelopeVersion)}`,
    );
  }

  const streamKey = assertNonEmptyString(obj.streamKey, "warm.streamKey");

  return {
    kind: "host.warmStream",
    envelopeVersion: WARM_ENVELOPE_VERSION,
    streamKey,
  };
}

export function createHostWarmStreamDescriptor(
  input: HostWarmStreamDescriptor,
): HostWarmStreamDescriptor {
  return createHostWarmStreamDescriptorThrowing(input);
}

export function validateHostWarmStreamDescriptor(
  value: unknown,
): HostContractValidationResult<HostWarmStreamDescriptor> {
  try {
    return validationSuccess(createHostWarmStreamDescriptorThrowing(value));
  } catch (error) {
    const message =
      error instanceof ExclaveError && typeof error.details.detail === "string"
        ? error.details.detail
        : error instanceof Error
          ? error.message
          : "Unknown validation error";
    const code: "host-contract.rejected" = "host-contract.rejected";
    return validationFailure(code, message);
  }
}
