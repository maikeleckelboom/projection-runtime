import { PayloadReader, PayloadWriter } from "./payload-bytes";
import {
  decodeFailure,
  decodeProblemFailure,
  encodeFailure,
  encodeProblemFailure,
  WarmDecodeProblem,
  WarmEncodeProblem,
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

  try {
    assertPlainSnapshotObject(snapshot, "snapshot");
    assertSnapshotFields(normalized.fields, snapshot);

    const writer = new PayloadWriter();
    for (const field of normalized.fields) {
      const value = snapshot[field.dotPath];
      if (value === undefined) {
        throw new WarmEncodeProblem(
          "snapshotFieldMissing",
          `missing value for warm field ${field.dotPath}`,
          `snapshot.${field.dotPath}`,
          field,
        );
      }
      writeValue(writer, field.shape, value, `snapshot.${field.dotPath}`, field);
    }

    return { ok: true, bytes: writer.toUint8Array() };
  } catch (error) {
    if (error instanceof WarmEncodeProblem) {
      return encodeProblemFailure(error);
    }
    throw error;
  }
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

  try {
    const reader = new PayloadReader(bytes);
    const snapshot: Record<string, WarmSnapshotValue> = {};

    for (const field of normalized.fields) {
      snapshot[field.dotPath] = readValue(reader, field.shape, `payload.${field.dotPath}`, field);
    }

    if (reader.offset !== bytes.byteLength) {
      throw new WarmDecodeProblem(
        "malformedPayload",
        `warm snapshot payload has ${bytes.byteLength - reader.offset} trailing byte(s)`,
        "payload",
      );
    }

    return { ok: true, snapshot };
  } catch (error) {
    if (error instanceof WarmDecodeProblem) {
      return decodeProblemFailure(error);
    }
    throw error;
  }
}

function writeValue(
  writer: PayloadWriter,
  shape: WarmSnapshotPayloadShape,
  value: WarmSnapshotValue,
  path: string,
  field: FieldContext,
): void {
  switch (shape.kind) {
    case "FixedScalar":
      writeScalar(writer, shape.type, shape.nanSentinel === true, value, path, field);
      return;

    case "FixedEnum":
      writeEnum(writer, shape, value, path, field);
      return;

    case "FixedVector":
      writeVector(writer, shape, value, path, field);
      return;

    case "BoundedArray":
      writeBoundedArray(writer, shape, value, path, field);
      return;

    case "BoundedMap":
      writeBoundedMap(writer, shape, value, path, field, writeFixedValue);
      return;

    case "VariableMap":
      writeVariableMap(writer, shape.valueShape, value, path, field, writeValue);
      return;

    case "FixedStringEncoded":
      writeFixedString(writer, shape, value, path, field);
      return;

    case "VariableString":
      writeVariableString(writer, value, path, field);
      return;
  }
}

function readValue(
  reader: PayloadReader,
  shape: WarmSnapshotPayloadShape,
  path: string,
  field: FieldContext,
): WarmSnapshotValue {
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
): void {
  switch (shape.kind) {
    case "FixedScalar":
      writeScalar(writer, shape.type, shape.nanSentinel === true, value, path, field);
      return;
    case "FixedEnum":
      writeEnum(writer, shape, value, path, field);
      return;
    case "FixedVector":
      writeVector(writer, shape, value, path, field);
      return;
  }
}

function readFixedValue(
  reader: PayloadReader,
  shape: WarmSnapshotPayloadFixedValueShape,
  path: string,
  field: FieldContext,
): WarmSnapshotValue {
  switch (shape.kind) {
    case "FixedScalar":
      return readScalar(reader, shape.type, shape.nanSentinel === true, path, field);
    case "FixedEnum":
      return readEnum(reader, shape, path, field);
    case "FixedVector":
      return readVector(reader, shape, path, field);
  }
}

function assertPlainSnapshotObject(
  value: unknown,
  path: string,
): asserts value is WarmSnapshotObject {
  if (!isPlainRecord(value)) {
    throw new WarmEncodeProblem(
      "invalidSnapshotObject",
      "warm snapshot must be a plain object",
      path,
    );
  }

  const keys = ownEnumerableStringKeys(value);
  if (!keys.ok) {
    throw new WarmEncodeProblem("invalidSnapshotObject", keys.detail, path);
  }
  if (keys.symbolCount > 0) {
    throw new WarmEncodeProblem(
      "invalidSnapshotObject",
      "warm snapshot must not contain symbol keys",
      path,
    );
  }
}

function assertSnapshotFields(
  fields: readonly NormalizedField[],
  snapshot: WarmSnapshotObject,
): void {
  const fieldPaths = new Set(fields.map((field) => field.dotPath));
  const keysResult = ownEnumerableStringKeys(snapshot);
  if (!keysResult.ok) {
    throw new WarmEncodeProblem("invalidSnapshotObject", keysResult.detail, "snapshot");
  }

  for (const key of keysResult.stringKeys) {
    if (!fieldPaths.has(key)) {
      throw new WarmEncodeProblem(
        "snapshotFieldUnknown",
        `unknown warm snapshot field ${key}`,
        `snapshot.${key}`,
      );
    }
  }
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
