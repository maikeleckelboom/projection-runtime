import type { JsonObject } from "@exclave/base";
import { checkJsonObjectRoot, type JsonSafetyResult } from "@exclave/base";
import { throwInputRejected } from "./errors";
import type { WarmFailure } from "./warm-failure";
import { createWarmOwner, type WarmOwner } from "./warm-owner";

export const WARM_ENVELOPE_VERSION = 1 as const;

export type WarmEnvelopeVersion = typeof WARM_ENVELOPE_VERSION;

export type WarmStreamKey = string;

export type WarmFrameKey = string;

export type WarmFrameSequence = string;

export type WarmFrameKind = string;

export type WarmFrameEnvelope = {
  readonly kind: "warm.frame";
  readonly envelopeVersion: 1;
  readonly streamKey: WarmStreamKey;
  readonly frameKey: WarmFrameKey;
  readonly sequence: WarmFrameSequence;
  readonly frameKind: WarmFrameKind;
  readonly owner: WarmOwner;
  readonly payload: JsonObject;
};

export type WarmValidationResult<T> =
  | { readonly ok: true; readonly value: T }
  | { readonly ok: false; readonly failure: WarmFailure };

const CANONICAL_SEQUENCE_RE = /^(?:0|[1-9][0-9]*)$/;

const OWNED_ROOT_KEYS: ReadonlySet<string> = new Set([
  "kind",
  "envelopeVersion",
  "streamKey",
  "frameKey",
  "sequence",
  "frameKind",
  "owner",
  "payload",
]);

function assertNonEmptyString(value: unknown, label: string): string {
  if (typeof value !== "string") {
    throwInputRejected(`${label} must be a string`);
  }
  if (value.length === 0) {
    throwInputRejected(`${label} must be a non-empty string`);
  }
  return value;
}

function assertCanonicalSequenceString(value: unknown, label: string): string {
  if (typeof value !== "string") {
    throwInputRejected(`${label} must be a string, not a number or bigint`);
  }
  if (!CANONICAL_SEQUENCE_RE.test(value)) {
    throwInputRejected(`${label} must be a canonical non-negative decimal string (e.g. "0", "42")`);
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

function checkExactRootKeys(
  value: Record<string, unknown>,
  allowedKeys: ReadonlySet<string>,
): string | null {
  try {
    const keys = Object.keys(value);
    for (const key of keys) {
      if (!allowedKeys.has(key)) {
        return `Unexpected field: ${key}`;
      }
    }
    return null;
  } catch {
    return "Object inspection failed during exact-key check";
  }
}

function validationFailure(message: string): WarmValidationResult<never> {
  return {
    ok: false as const,
    failure: { code: "warm.invalidEnvelope", message },
  };
}

function validationSuccess<T>(value: T): WarmValidationResult<T> {
  return { ok: true as const, value };
}

export function createWarmFrameEnvelope(input: {
  readonly streamKey: WarmStreamKey;
  readonly frameKey: WarmFrameKey;
  readonly sequence: WarmFrameSequence;
  readonly frameKind: WarmFrameKind;
  readonly owner: WarmOwner;
  readonly payload: JsonObject;
}): WarmFrameEnvelope {
  assertPlainObject(input, "warm frame input");
  assertExactRootKeys(input, OWNED_ROOT_KEYS, "warm frame input");

  const streamKey = assertNonEmptyString(input.streamKey, "warm frame streamKey");
  const frameKey = assertNonEmptyString(input.frameKey, "warm frame frameKey");
  const sequence = assertCanonicalSequenceString(input.sequence, "warm frame sequence");
  const frameKind = assertNonEmptyString(input.frameKind, "warm frame frameKind");

  const owner = createWarmOwner(input.owner);

  const payloadResult: JsonSafetyResult = checkJsonObjectRoot(input.payload);
  if (!payloadResult.ok) {
    throwInputRejected(`warm frame payload is not JSON-safe: ${payloadResult.reason}`);
  }

  return {
    kind: "warm.frame",
    envelopeVersion: WARM_ENVELOPE_VERSION,
    streamKey,
    frameKey,
    sequence,
    frameKind,
    owner,
    payload: input.payload,
  };
}

export function validateWarmFrameEnvelope(value: unknown): WarmValidationResult<WarmFrameEnvelope> {
  const rootResult = checkJsonObjectRoot(value);
  if (!rootResult.ok) {
    return validationFailure(
      `Warm frame envelope is not a plain data object: ${rootResult.reason}`,
    );
  }

  const obj = rootResult.value as Record<string, unknown>;

  const keysError = checkExactRootKeys(obj, OWNED_ROOT_KEYS);
  if (keysError !== null) {
    return validationFailure(keysError);
  }

  if (obj.kind !== "warm.frame") {
    return validationFailure(`Expected kind "warm.frame", got ${JSON.stringify(obj.kind)}`);
  }

  if (obj.envelopeVersion !== WARM_ENVELOPE_VERSION) {
    return validationFailure(
      `Expected envelopeVersion ${WARM_ENVELOPE_VERSION}, got ${JSON.stringify(obj.envelopeVersion)}`,
    );
  }

  if (typeof obj.streamKey !== "string" || obj.streamKey.length === 0) {
    return validationFailure("streamKey must be a non-empty string");
  }

  if (typeof obj.frameKey !== "string" || obj.frameKey.length === 0) {
    return validationFailure("frameKey must be a non-empty string");
  }

  if (typeof obj.sequence !== "string" || !CANONICAL_SEQUENCE_RE.test(obj.sequence)) {
    return validationFailure(
      'sequence must be a canonical non-negative decimal string (e.g. "0", "42")',
    );
  }

  if (typeof obj.frameKind !== "string" || obj.frameKind.length === 0) {
    return validationFailure("frameKind must be a non-empty string");
  }

  let owner: WarmOwner;
  try {
    owner = createWarmOwner(obj.owner as unknown as WarmOwner);
  } catch {
    return validationFailure("owner is invalid");
  }

  const payloadResult: JsonSafetyResult = checkJsonObjectRoot(obj.payload);
  if (!payloadResult.ok) {
    return validationFailure(`payload is not JSON-safe: ${payloadResult.reason}`);
  }

  return validationSuccess({
    kind: "warm.frame",
    envelopeVersion: WARM_ENVELOPE_VERSION,
    streamKey: obj.streamKey,
    frameKey: obj.frameKey,
    sequence: obj.sequence,
    frameKind: obj.frameKind,
    owner,
    payload: obj.payload as JsonObject,
  });
}
