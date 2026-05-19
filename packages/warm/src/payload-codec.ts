import { PayloadReader, PayloadWriter } from "./payload-bytes";
import {
  decodeFailure,
  decodeIssue,
  decodeIssueFailure,
  encodeFailure,
  encodeIssue,
  encodeIssueFailure,
  type PayloadReadResult,
  type PayloadWriteResult,
} from "./payload-failure";
import { normalizeManifest } from "./payload-manifest";
import {
  readBoundedArray,
  readEnum,
  readScalar,
  readVector,
  writeBoundedArray,
  writeEnum,
  writeScalar,
  writeVector,
} from "./payload-scalar";
import {
  readBoundedMap,
  readFixedString,
  readVariableMap,
  readVariableString,
  writeBoundedMap,
  writeFixedString,
  writeVariableMap,
  writeVariableString,
} from "./payload-string";
import type {
  FieldContext,
  NormalizedField,
  ObjectKeysResult,
  WarmSnapshotObject,
  WarmSnapshotPayloadDecodeResult,
  WarmSnapshotPayloadEncodeResult,
  WarmSnapshotPayloadFixedValueShape,
  WarmSnapshotPayloadManifest,
  WarmSnapshotPayloadShape,
  WarmSnapshotValue,
} from "./payload-types";

export function encodeWarmSnapshotPayload(
  manifest: WarmSnapshotPayloadManifest,
  snapshot: WarmSnapshotObject,
): WarmSnapshotPayloadEncodeResult {
  const normalized = normalizeManifest(manifest);
  if (!normalized.ok) {
    return encodeFailure("invalidManifest", normalized.detail, normalized.path);
  }

  const assertResult = assertPlainSnapshotObject(snapshot, "snapshot");
  if (!assertResult.ok) {
    return encodeIssueFailure(assertResult.issue);
  }

  const fieldsResult = assertSnapshotFields(normalized.fields, snapshot);
  if (!fieldsResult.ok) {
    return encodeIssueFailure(fieldsResult.issue);
  }

  const writer = new PayloadWriter();
  for (const field of normalized.fields) {
    const value = snapshot[field.dotPath];
    if (value === undefined) {
      return encodeIssueFailure(
        encodeIssue(
          "snapshotFieldMissing",
          `missing value for warm field ${field.dotPath}`,
          `snapshot.${field.dotPath}`,
          field,
        ),
      );
    }
    const writeResult = writeValue(writer, field.shape, value, `snapshot.${field.dotPath}`, field);
    if (!writeResult.ok) {
      return encodeIssueFailure(writeResult.issue);
    }
  }

  return { ok: true, bytes: writer.toUint8Array() };
}

export function decodeWarmSnapshotPayload(
  manifest: WarmSnapshotPayloadManifest,
  bytes: Uint8Array,
): WarmSnapshotPayloadDecodeResult {
  const normalized = normalizeManifest(manifest);
  if (!normalized.ok) {
    return decodeFailure("invalidManifest", normalized.detail, normalized.path);
  }

  if (!(bytes instanceof Uint8Array)) {
    return decodeFailure("invalidPayloadInput", "warm snapshot payload bytes must be a Uint8Array");
  }

  const reader = new PayloadReader(bytes);
  const snapshot: Record<string, WarmSnapshotValue> = {};

  for (const field of normalized.fields) {
    const valueResult = readValue(reader, field.shape, `payload.${field.dotPath}`, field);
    if (!valueResult.ok) {
      return decodeIssueFailure(valueResult.issue);
    }
    snapshot[field.dotPath] = valueResult.value;
  }

  if (reader.offset !== bytes.byteLength) {
    return decodeIssueFailure(
      decodeIssue(
        "malformedPayload",
        `warm snapshot payload has ${bytes.byteLength - reader.offset} trailing byte(s)`,
        "payload",
      ),
    );
  }

  return { ok: true, snapshot };
}

function writeValue(
  writer: PayloadWriter,
  shape: WarmSnapshotPayloadShape,
  value: WarmSnapshotValue,
  path: string,
  field: FieldContext,
): PayloadWriteResult {
  switch (shape.kind) {
    case "FixedScalar":
      return writeScalar(writer, shape.type, shape.nanSentinel === true, value, path, field);

    case "FixedEnum":
      return writeEnum(writer, shape, value, path, field);

    case "FixedVector":
      return writeVector(writer, shape, value, path, field);

    case "BoundedArray":
      return writeBoundedArray(writer, shape, value, path, field);

    case "BoundedMap":
      return writeBoundedMap(writer, shape, value, path, field, writeFixedValue);

    case "VariableMap":
      return writeVariableMap(writer, shape.valueShape, value, path, field, writeValue);

    case "FixedStringEncoded":
      return writeFixedString(writer, shape, value, path, field);

    case "VariableString":
      return writeVariableString(writer, value, path, field);
  }
}

function readValue(
  reader: PayloadReader,
  shape: WarmSnapshotPayloadShape,
  path: string,
  field: FieldContext,
): PayloadReadResult<WarmSnapshotValue> {
  switch (shape.kind) {
    case "FixedScalar":
      return readScalar(reader, shape.type, shape.nanSentinel === true, path, field);

    case "FixedEnum":
      return readEnum(reader, shape, path, field);

    case "FixedVector":
      return readVector(reader, shape, path, field);

    case "BoundedArray":
      return readBoundedArray(reader, shape, path, field);

    case "BoundedMap":
      return readBoundedMap(reader, shape, path, field, readFixedValue);

    case "VariableMap":
      return readVariableMap(reader, shape.valueShape, path, field, readValue);

    case "FixedStringEncoded":
      return readFixedString(reader, shape, path, field);

    case "VariableString":
      return readVariableString(reader, path, field);
  }
}

function writeFixedValue(
  writer: PayloadWriter,
  shape: WarmSnapshotPayloadFixedValueShape,
  value: WarmSnapshotValue,
  path: string,
  field: FieldContext,
): PayloadWriteResult {
  switch (shape.kind) {
    case "FixedScalar":
      return writeScalar(writer, shape.type, shape.nanSentinel === true, value, path, field);
    case "FixedEnum":
      return writeEnum(writer, shape, value, path, field);
    case "FixedVector":
      return writeVector(writer, shape, value, path, field);
  }
}

function readFixedValue(
  reader: PayloadReader,
  shape: WarmSnapshotPayloadFixedValueShape,
  path: string,
  field: FieldContext,
): PayloadReadResult<WarmSnapshotValue> {
  switch (shape.kind) {
    case "FixedScalar":
      return readScalar(reader, shape.type, shape.nanSentinel === true, path, field);
    case "FixedEnum":
      return readEnum(reader, shape, path, field);
    case "FixedVector":
      return readVector(reader, shape, path, field);
  }
}

function assertPlainSnapshotObject(value: unknown, path: string): PayloadWriteResult {
  if (!isPlainRecord(value)) {
    return {
      ok: false,
      issue: encodeIssue("invalidSnapshotObject", "warm snapshot must be a plain object", path),
    };
  }

  const keys = ownEnumerableStringKeys(value);
  if (!keys.ok) {
    return {
      ok: false,
      issue: encodeIssue("invalidSnapshotObject", keys.detail, path),
    };
  }
  if (keys.symbolCount > 0) {
    return {
      ok: false,
      issue: encodeIssue(
        "invalidSnapshotObject",
        "warm snapshot must not contain symbol keys",
        path,
      ),
    };
  }

  return { ok: true };
}

function assertSnapshotFields(
  fields: readonly NormalizedField[],
  snapshot: WarmSnapshotObject,
): PayloadWriteResult {
  const fieldPaths = new Set(fields.map((field) => field.dotPath));
  const keysResult = ownEnumerableStringKeys(snapshot);
  if (!keysResult.ok) {
    return {
      ok: false,
      issue: encodeIssue("invalidSnapshotObject", keysResult.detail, "snapshot"),
    };
  }

  for (const key of keysResult.stringKeys) {
    if (!fieldPaths.has(key)) {
      return {
        ok: false,
        issue: encodeIssue(
          "snapshotFieldUnknown",
          `unknown warm snapshot field ${key}`,
          `snapshot.${key}`,
        ),
      };
    }
  }

  return { ok: true };
}

function isPlainRecord(value: unknown): value is Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return false;
  }

  const proto = Object.getPrototypeOf(value);
  return proto === null || proto === Object.prototype;
}

function ownEnumerableStringKeys(value: object): ObjectKeysResult {
  try {
    const symbolCount = Object.getOwnPropertySymbols(value).length;
    return { ok: true, stringKeys: Object.keys(value), symbolCount };
  } catch (error) {
    return {
      ok: false,
      detail: error instanceof Error ? error.message : "object keys could not be enumerated",
    };
  }
}
