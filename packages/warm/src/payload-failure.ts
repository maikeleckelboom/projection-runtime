// Payload codec result-failure types and internal throw-catch helpers.
// Codec APIs (encode/decode) return { ok, failure } result objects rather than
// throwing ExclaveError, consistent with the framed-snapshot codec pattern.
import type {
  FieldContext,
  WarmSnapshotPayloadDecodeFailureReason,
  WarmSnapshotPayloadDecodeResult,
  WarmSnapshotPayloadEncodeFailureReason,
  WarmSnapshotPayloadEncodeResult,
} from "./payload-types";

export class WarmEncodeProblem extends Error {
  constructor(
    readonly reason: WarmSnapshotPayloadEncodeFailureReason,
    readonly detail: string,
    readonly path: string | undefined = undefined,
    readonly field: FieldContext | undefined = undefined,
  ) {
    super(detail);
  }
}

export class WarmDecodeProblem extends Error {
  constructor(
    readonly reason: WarmSnapshotPayloadDecodeFailureReason,
    readonly detail: string,
    readonly path: string | undefined = undefined,
    readonly field: FieldContext | undefined = undefined,
    readonly offset: number | undefined = undefined,
  ) {
    super(detail);
  }
}

export function encodeFailure(
  reason: WarmSnapshotPayloadEncodeFailureReason,
  detail: string,
  path?: string,
): WarmSnapshotPayloadEncodeResult {
  return {
    ok: false,
    failure: {
      kind: "warmSnapshotPayloadEncodeFailure",
      reason,
      detail,
      ...(path === undefined ? {} : { path }),
    },
  };
}

export function decodeFailure(
  reason: WarmSnapshotPayloadDecodeFailureReason,
  detail: string,
  path?: string,
): WarmSnapshotPayloadDecodeResult {
  return {
    ok: false,
    failure: {
      kind: "warmSnapshotPayloadDecodeFailure",
      reason,
      detail,
      ...(path === undefined ? {} : { path }),
    },
  };
}

export function encodeProblemFailure(error: WarmEncodeProblem): WarmSnapshotPayloadEncodeResult {
  return {
    ok: false,
    failure: {
      kind: "warmSnapshotPayloadEncodeFailure",
      reason: error.reason,
      detail: error.detail,
      ...(error.path === undefined ? {} : { path: error.path }),
      ...(error.field === undefined ? {} : { fieldDotPath: error.field.dotPath }),
      ...(error.field?.fieldId === undefined ? {} : { fieldId: error.field.fieldId }),
    },
  };
}

export function decodeProblemFailure(error: WarmDecodeProblem): WarmSnapshotPayloadDecodeResult {
  return {
    ok: false,
    failure: {
      kind: "warmSnapshotPayloadDecodeFailure",
      reason: error.reason,
      detail: error.detail,
      ...(error.path === undefined ? {} : { path: error.path }),
      ...(error.field === undefined ? {} : { fieldDotPath: error.field.dotPath }),
      ...(error.field?.fieldId === undefined ? {} : { fieldId: error.field.fieldId }),
      ...(error.offset === undefined ? {} : { offset: error.offset }),
    },
  };
}

export function encodeValueProblem(detail: string, path: string, field: FieldContext): never {
  throw new WarmEncodeProblem("invalidSnapshotValue", detail, path, field);
}
