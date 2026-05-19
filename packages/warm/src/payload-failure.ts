import type {
  FieldContext,
  WarmSnapshotPayloadDecodeFailureReason,
  WarmSnapshotPayloadDecodeResult,
  WarmSnapshotPayloadEncodeFailureReason,
  WarmSnapshotPayloadEncodeResult,
} from "./payload-types";

export interface WarmPayloadEncodeIssue {
  readonly reason: WarmSnapshotPayloadEncodeFailureReason;
  readonly detail: string;
  readonly path?: string;
  readonly field?: FieldContext;
}

export interface WarmPayloadDecodeIssue {
  readonly reason: WarmSnapshotPayloadDecodeFailureReason;
  readonly detail: string;
  readonly path?: string;
  readonly field?: FieldContext;
  readonly offset?: number;
}

export type PayloadWriteResult =
  | { readonly ok: true }
  | { readonly ok: false; readonly issue: WarmPayloadEncodeIssue };

export type PayloadWriteOutput<T> =
  | { readonly ok: true; readonly value: T }
  | { readonly ok: false; readonly issue: WarmPayloadEncodeIssue };

export type PayloadReadResult<T> =
  | { readonly ok: true; readonly value: T }
  | { readonly ok: false; readonly issue: WarmPayloadDecodeIssue };

export function encodeIssue(
  reason: WarmSnapshotPayloadEncodeFailureReason,
  detail: string,
  path?: string,
  field?: FieldContext,
): WarmPayloadEncodeIssue {
  const issue: WarmPayloadEncodeIssue = { reason, detail };
  if (path !== undefined) (issue as { path?: string }).path = path;
  if (field !== undefined) (issue as { field?: FieldContext }).field = field;
  return issue;
}

export function encodeValueIssue(
  detail: string,
  path: string,
  field: FieldContext,
): WarmPayloadEncodeIssue {
  return { reason: "invalidSnapshotValue", detail, path, field };
}

export function encodeValueRejected(
  detail: string,
  path: string,
  field: FieldContext,
): PayloadWriteResult {
  return { ok: false, issue: encodeValueIssue(detail, path, field) };
}

export function decodeIssue(
  reason: WarmSnapshotPayloadDecodeFailureReason,
  detail: string,
  path?: string,
  field?: FieldContext,
  offset?: number,
): WarmPayloadDecodeIssue {
  const issue: WarmPayloadDecodeIssue = { reason, detail };
  if (path !== undefined) (issue as { path?: string }).path = path;
  if (field !== undefined) (issue as { field?: FieldContext }).field = field;
  if (offset !== undefined) (issue as { offset?: number }).offset = offset;
  return issue;
}

export function decodeRejected(
  reason: WarmSnapshotPayloadDecodeFailureReason,
  detail: string,
  path?: string,
  field?: FieldContext,
  offset?: number,
): PayloadReadResult<never> {
  return { ok: false, issue: decodeIssue(reason, detail, path, field, offset) };
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

export function encodeIssueFailure(issue: WarmPayloadEncodeIssue): WarmSnapshotPayloadEncodeResult {
  return {
    ok: false,
    failure: {
      kind: "warmSnapshotPayloadEncodeFailure",
      reason: issue.reason,
      detail: issue.detail,
      ...(issue.path === undefined ? {} : { path: issue.path }),
      ...(issue.field === undefined ? {} : { fieldDotPath: issue.field.dotPath }),
      ...(issue.field?.fieldId === undefined ? {} : { fieldId: issue.field.fieldId }),
    },
  };
}

export function decodeIssueFailure(issue: WarmPayloadDecodeIssue): WarmSnapshotPayloadDecodeResult {
  return {
    ok: false,
    failure: {
      kind: "warmSnapshotPayloadDecodeFailure",
      reason: issue.reason,
      detail: issue.detail,
      ...(issue.path === undefined ? {} : { path: issue.path }),
      ...(issue.field === undefined ? {} : { fieldDotPath: issue.field.dotPath }),
      ...(issue.field?.fieldId === undefined ? {} : { fieldId: issue.field.fieldId }),
      ...(issue.offset === undefined ? {} : { offset: issue.offset }),
    },
  };
}
