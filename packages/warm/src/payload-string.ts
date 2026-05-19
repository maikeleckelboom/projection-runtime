import type { PayloadReader, PayloadWriter } from "./payload-bytes";
import { compareBytes } from "./payload-bytes";
import { textDecoder, textEncoder, U32_MAX } from "./payload-constants";
import { encodeValueProblem, WarmDecodeProblem } from "./payload-failure";
import type {
  FieldContext,
  WarmSnapshotMapObject,
  WarmSnapshotPayloadBoundedMapShape,
  WarmSnapshotPayloadFixedStringEncodedShape,
  WarmSnapshotPayloadFixedValueShape,
  WarmSnapshotPayloadShape,
  WarmSnapshotValue,
} from "./payload-types";

export function writeBoundedMap(
  writer: PayloadWriter,
  shape: WarmSnapshotPayloadBoundedMapShape,
  value: WarmSnapshotValue,
  path: string,
  field: FieldContext,
  writeFixedValue: (
    writer: PayloadWriter,
    shape: WarmSnapshotPayloadFixedValueShape,
    value: WarmSnapshotValue,
    path: string,
    field: FieldContext,
  ) => void,
): void {
  const entries = sortedObjectEntries(value, path, field, "BoundedMap");
  if (entries.length > shape.maxEntries) {
    encodeValueProblem(`BoundedMap entry count must be <= ${shape.maxEntries}`, path, field);
  }

  const encodedEntries = entries.map(([key, entryValue]) => ({
    key,
    encodedKey: encodeBoundedMapKey(key, shape.keyByteLength, `${path}.${key}`, field),
    value: entryValue,
  }));
  encodedEntries.sort((left, right) => compareBytes(left.encodedKey, right.encodedKey));

  writer.writeU32(encodedEntries.length);
  for (let index = 0; index < encodedEntries.length; index += 1) {
    const entry = encodedEntries[index];
    if (entry === undefined) continue;
    writer.writeBytes(entry.encodedKey);
    writeFixedValue(writer, shape.valueShape, entry.value, `${path}.${entry.key}`, field);
  }
}

export function readBoundedMap(
  reader: PayloadReader,
  shape: WarmSnapshotPayloadBoundedMapShape,
  path: string,
  field: FieldContext,
  readFixedValue: (
    reader: PayloadReader,
    shape: WarmSnapshotPayloadFixedValueShape,
    path: string,
    field: FieldContext,
  ) => WarmSnapshotValue,
): WarmSnapshotMapObject {
  const offset = reader.offset;
  const liveCount = reader.readU32(`${path}.liveCount`, field);
  if (liveCount > shape.maxEntries) {
    throw new WarmDecodeProblem(
      "malformedPayload",
      `BoundedMap liveCount ${liveCount} exceeds maxEntries ${shape.maxEntries}`,
      path,
      field,
      offset,
    );
  }

  const map: Record<string, WarmSnapshotValue> = {};
  let previousKeyBytes: Uint8Array | undefined;
  for (let index = 0; index < liveCount; index += 1) {
    const keyOffset = reader.offset;
    const keyBytes = reader.readBytes(shape.keyByteLength, `${path}.${index}.key`, field);
    if (previousKeyBytes !== undefined && compareBytes(previousKeyBytes, keyBytes) >= 0) {
      throw new WarmDecodeProblem(
        "malformedPayload",
        "BoundedMap encoded keys must be strictly increasing",
        `${path}.${index}.key`,
        field,
        keyOffset,
      );
    }

    const key = decodeBoundedMapKey(keyBytes, `${path}.${index}.key`, field, keyOffset);
    map[key] = readFixedValue(reader, shape.valueShape, `${path}.${key}`, field);
    previousKeyBytes = keyBytes;
  }
  return map;
}

export function writeVariableMap(
  writer: PayloadWriter,
  shape: WarmSnapshotPayloadShape,
  value: WarmSnapshotValue,
  path: string,
  field: FieldContext,
  writeValue: (
    writer: PayloadWriter,
    shape: WarmSnapshotPayloadShape,
    value: WarmSnapshotValue,
    path: string,
    field: FieldContext,
  ) => void,
): void {
  const entries = sortedObjectEntries(value, path, field, "VariableMap");
  const encodedEntries = entries.map(([key, entryValue]) => ({
    key,
    encodedKey: encodeUtf8Strict(key, `${path}.${key}`, field),
    value: entryValue,
  }));
  encodedEntries.sort((left, right) => compareBytes(left.encodedKey, right.encodedKey));

  writer.writeU32(encodedEntries.length);
  for (const entry of encodedEntries) {
    writer.writeU32(entry.encodedKey.byteLength);
    writer.writeBytes(entry.encodedKey);
    writeValue(writer, shape, entry.value, `${path}.${entry.key}`, field);
  }
}

export function readVariableMap(
  reader: PayloadReader,
  shape: WarmSnapshotPayloadShape,
  path: string,
  field: FieldContext,
  readValue: (
    reader: PayloadReader,
    shape: WarmSnapshotPayloadShape,
    path: string,
    field: FieldContext,
  ) => WarmSnapshotValue,
): WarmSnapshotMapObject {
  const liveCount = reader.readU32(`${path}.liveCount`, field);
  const map: Record<string, WarmSnapshotValue> = {};
  let previousKeyBytes: Uint8Array | undefined;

  for (let index = 0; index < liveCount; index += 1) {
    const keyLengthOffset = reader.offset;
    const keyByteLength = reader.readU32(`${path}.${index}.keyByteLength`, field);
    const keyOffset = reader.offset;
    const keyBytes = reader.readBytes(keyByteLength, `${path}.${index}.key`, field);

    if (previousKeyBytes !== undefined && compareBytes(previousKeyBytes, keyBytes) >= 0) {
      throw new WarmDecodeProblem(
        "malformedPayload",
        "VariableMap keys must be strictly increasing",
        `${path}.${index}.key`,
        field,
        keyOffset,
      );
    }

    const key = decodeUtf8Strict(keyBytes, `${path}.${index}.key`, field, keyOffset);
    map[key] = readValue(reader, shape, `${path}.${key}`, field);
    previousKeyBytes = keyBytes;

    if (keyByteLength > U32_MAX) {
      throw new WarmDecodeProblem(
        "malformedPayload",
        "VariableMap keyByteLength must fit in u32",
        `${path}.${index}.keyByteLength`,
        field,
        keyLengthOffset,
      );
    }
  }
  return map;
}

export function writeFixedString(
  writer: PayloadWriter,
  shape: WarmSnapshotPayloadFixedStringEncodedShape,
  value: WarmSnapshotValue,
  path: string,
  field: FieldContext,
): void {
  if (typeof value !== "string") {
    encodeValueProblem("FixedStringEncoded value must be a string", path, field);
  }

  const bytes =
    shape.encoding === "ascii"
      ? encodeAscii(value, path, field)
      : encodeUtf8Strict(value, path, field);
  if (bytes.byteLength > shape.byteLength) {
    encodeValueProblem(
      `FixedStringEncoded byte length must be <= ${shape.byteLength}`,
      path,
      field,
    );
  }

  writer.writeU16(bytes.byteLength);
  writer.writeBytes(bytes);
}

export function readFixedString(
  reader: PayloadReader,
  shape: WarmSnapshotPayloadFixedStringEncodedShape,
  path: string,
  field: FieldContext,
): string {
  const offset = reader.offset;
  const liveByteLength = reader.readU16(`${path}.liveByteLength`, field);
  if (liveByteLength > shape.byteLength) {
    throw new WarmDecodeProblem(
      "malformedPayload",
      `FixedStringEncoded liveByteLength ${liveByteLength} exceeds byteLength ${shape.byteLength}`,
      path,
      field,
      offset,
    );
  }

  const bytes = reader.readBytes(liveByteLength, `${path}.bytes`, field);
  if (shape.encoding === "ascii") {
    return decodeAscii(bytes, path, field, offset + 2);
  }
  return decodeUtf8Strict(bytes, path, field, offset + 2);
}

export function writeVariableString(
  writer: PayloadWriter,
  value: WarmSnapshotValue,
  path: string,
  field: FieldContext,
): void {
  if (typeof value !== "string") {
    encodeValueProblem("VariableString value must be a string", path, field);
  }

  const bytes = encodeUtf8Strict(value, path, field);
  writer.writeU32(bytes.byteLength);
  writer.writeBytes(bytes);
}

export function readVariableString(
  reader: PayloadReader,
  path: string,
  field: FieldContext,
): string {
  const offset = reader.offset;
  const liveByteLength = reader.readU32(`${path}.liveByteLength`, field);
  const bytes = reader.readBytes(liveByteLength, `${path}.bytes`, field);
  return decodeUtf8Strict(bytes, path, field, offset + 4);
}

function sortedObjectEntries(
  value: WarmSnapshotValue,
  path: string,
  field: FieldContext,
  label: "BoundedMap" | "VariableMap",
): readonly (readonly [string, WarmSnapshotValue])[] {
  assertPlainMapObject(value, path, field, label);
  const keysResult = ownEnumerableStringKeys(value);
  if (!keysResult.ok) {
    encodeValueProblem(keysResult.detail, path, field);
  }
  if (keysResult.symbolCount > 0) {
    encodeValueProblem(`${label} value must not contain symbol keys`, path, field);
  }

  return keysResult.stringKeys.map((key) => [key, value[key] as WarmSnapshotValue] as const);
}

function assertPlainMapObject(
  value: unknown,
  path: string,
  field: FieldContext,
  label: string,
): asserts value is WarmSnapshotMapObject {
  if (!isPlainRecord(value)) {
    encodeValueProblem(`${label} value must be a plain object`, path, field);
  }
}

function isPlainRecord(value: unknown): value is Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return false;
  }

  const proto = Object.getPrototypeOf(value);
  return proto === null || proto === Object.prototype;
}

function ownEnumerableStringKeys(value: object):
  | {
      readonly ok: true;
      readonly stringKeys: readonly string[];
      readonly symbolCount: number;
    }
  | { readonly ok: false; readonly detail: string } {
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

function encodeBoundedMapKey(
  key: string,
  keyByteLength: number,
  path: string,
  field: FieldContext,
): Uint8Array {
  const bytes = encodeAscii(key, path, field);
  if (bytes.includes(0)) {
    encodeValueProblem("BoundedMap key must not contain NUL bytes", path, field);
  }
  if (bytes.byteLength > keyByteLength) {
    encodeValueProblem(`BoundedMap key byte length must be <= ${keyByteLength}`, path, field);
  }

  const padded = new Uint8Array(keyByteLength);
  padded.set(bytes);
  return padded;
}

function decodeBoundedMapKey(
  bytes: Uint8Array,
  path: string,
  field: FieldContext,
  offset: number,
): string {
  let liveLength = bytes.byteLength;
  for (let index = 0; index < bytes.byteLength; index += 1) {
    const byte = bytes[index];
    if (byte === undefined) {
      throw new WarmDecodeProblem(
        "malformedPayload",
        "BoundedMap key byte is missing",
        path,
        field,
        offset + index,
      );
    }
    if (byte === 0) {
      liveLength = index;
      break;
    }
    if (byte > 0x7f) {
      throw new WarmDecodeProblem(
        "malformedPayload",
        "BoundedMap key contains a non-ASCII byte",
        path,
        field,
        offset + index,
      );
    }
  }

  for (let index = liveLength; index < bytes.byteLength; index += 1) {
    if (bytes[index] !== 0) {
      throw new WarmDecodeProblem(
        "malformedPayload",
        "BoundedMap key has non-zero bytes after right padding begins",
        path,
        field,
        offset + index,
      );
    }
  }

  return decodeAscii(bytes.subarray(0, liveLength), path, field, offset);
}

function encodeUtf8Strict(value: string, path: string, field: FieldContext): Uint8Array {
  if (!isValidUtf8String(value)) {
    encodeValueProblem("string value must be valid UTF-8 text", path, field);
  }
  return textEncoder.encode(value);
}

function decodeUtf8Strict(
  bytes: Uint8Array,
  path: string,
  field: FieldContext,
  offset: number,
): string {
  try {
    return textDecoder.decode(bytes);
  } catch {
    throw new WarmDecodeProblem("invalidUtf8", "UTF-8 bytes are invalid", path, field, offset);
  }
}

function encodeAscii(value: string, path: string, field: FieldContext): Uint8Array {
  const bytes = new Uint8Array(value.length);
  for (let index = 0; index < value.length; index += 1) {
    const codeUnit = value.charCodeAt(index);
    if (codeUnit > 0x7f) {
      encodeValueProblem("ascii string contains a non-ASCII code unit", path, field);
    }
    bytes[index] = codeUnit;
  }
  return bytes;
}

function decodeAscii(bytes: Uint8Array, path: string, field: FieldContext, offset: number): string {
  let value = "";
  for (let index = 0; index < bytes.byteLength; index += 1) {
    const byte = bytes[index];
    if (byte === undefined) {
      throw new WarmDecodeProblem(
        "malformedPayload",
        "ascii byte is missing",
        path,
        field,
        offset + index,
      );
    }
    if (byte > 0x7f) {
      throw new WarmDecodeProblem(
        "malformedPayload",
        "ascii string contains a non-ASCII byte",
        path,
        field,
        offset + index,
      );
    }
    value += String.fromCharCode(byte);
  }
  return value;
}

function isValidUtf8String(value: unknown): value is string {
  if (typeof value !== "string") {
    return false;
  }

  const encoded = textEncoder.encode(value);
  try {
    return textDecoder.decode(encoded) === value;
  } catch {
    return false;
  }
}
