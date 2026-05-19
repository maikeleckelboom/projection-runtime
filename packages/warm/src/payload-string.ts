import type { PayloadReader, PayloadWriter } from "./payload-bytes";
import { compareBytes } from "./payload-bytes";
import { textDecoder, textEncoder, U32_MAX } from "./payload-constants";
import {
  decodeRejected,
  encodeValueRejected,
  type PayloadReadResult,
  type PayloadWriteOutput,
  type PayloadWriteResult,
} from "./payload-failure";
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
  ) => PayloadWriteResult,
): PayloadWriteResult {
  const entriesResult = sortedObjectEntries(value, path, field, "BoundedMap");
  if (!entriesResult.ok) return entriesResult;
  const entries = entriesResult.value;
  if (entries.length > shape.maxEntries) {
    return encodeValueRejected(
      `BoundedMap entry count must be <= ${shape.maxEntries}`,
      path,
      field,
    );
  }

  const keyResults: { key: string; encodedKey: Uint8Array; value: WarmSnapshotValue }[] = [];
  for (const [key, entryValue] of entries) {
    const ekr = encodeBoundedMapKey(key, shape.keyByteLength, `${path}.${key}`, field);
    if (!ekr.ok) return ekr;
    keyResults.push({ key, encodedKey: ekr.value, value: entryValue });
  }
  keyResults.sort((left, right) => compareBytes(left.encodedKey, right.encodedKey));

  writer.writeU32(keyResults.length);
  for (let index = 0; index < keyResults.length; index += 1) {
    const entry = keyResults[index];
    if (entry === undefined) continue;
    writer.writeBytes(entry.encodedKey);
    const valResult = writeFixedValue(
      writer,
      shape.valueShape,
      entry.value,
      `${path}.${entry.key}`,
      field,
    );
    if (!valResult.ok) return valResult;
  }
  return { ok: true };
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
  ) => PayloadReadResult<WarmSnapshotValue>,
): PayloadReadResult<WarmSnapshotMapObject> {
  const offset = reader.offset;
  const countResult = reader.readU32(`${path}.liveCount`, field);
  if (!countResult.ok) return countResult;
  const liveCount = countResult.value;
  if (liveCount > shape.maxEntries) {
    return decodeRejected(
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
    const keyBytesResult = reader.readBytes(shape.keyByteLength, `${path}.${index}.key`, field);
    if (!keyBytesResult.ok) return keyBytesResult;
    const keyBytes = keyBytesResult.value;
    if (previousKeyBytes !== undefined && compareBytes(previousKeyBytes, keyBytes) >= 0) {
      return decodeRejected(
        "malformedPayload",
        "BoundedMap encoded keys must be strictly increasing",
        `${path}.${index}.key`,
        field,
        keyOffset,
      );
    }

    const keyResult = decodeBoundedMapKey(keyBytes, `${path}.${index}.key`, field, keyOffset);
    if (!keyResult.ok) return keyResult;
    const key = keyResult.value;
    const valResult = readFixedValue(reader, shape.valueShape, `${path}.${key}`, field);
    if (!valResult.ok) return valResult;
    map[key] = valResult.value;
    previousKeyBytes = keyBytes;
  }
  return { ok: true, value: map };
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
  ) => PayloadWriteResult,
): PayloadWriteResult {
  const entriesResult = sortedObjectEntries(value, path, field, "VariableMap");
  if (!entriesResult.ok) return entriesResult;
  const entries = entriesResult.value;
  const encodedEntries: { key: string; encodedKey: Uint8Array; value: WarmSnapshotValue }[] = [];
  for (const [key, entryValue] of entries) {
    const ekr = encodeUtf8Strict(key, `${path}.${key}`, field);
    if (!ekr.ok) return ekr;
    encodedEntries.push({ key, encodedKey: ekr.value, value: entryValue });
  }
  encodedEntries.sort((left, right) => compareBytes(left.encodedKey, right.encodedKey));

  writer.writeU32(encodedEntries.length);
  for (const entry of encodedEntries) {
    writer.writeU32(entry.encodedKey.byteLength);
    writer.writeBytes(entry.encodedKey);
    const valResult = writeValue(writer, shape, entry.value, `${path}.${entry.key}`, field);
    if (!valResult.ok) return valResult;
  }
  return { ok: true };
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
  ) => PayloadReadResult<WarmSnapshotValue>,
): PayloadReadResult<WarmSnapshotMapObject> {
  const countResult = reader.readU32(`${path}.liveCount`, field);
  if (!countResult.ok) return countResult;
  const liveCount = countResult.value;
  const map: Record<string, WarmSnapshotValue> = {};
  let previousKeyBytes: Uint8Array | undefined;

  for (let index = 0; index < liveCount; index += 1) {
    const keyLengthOffset = reader.offset;
    const keyByteLengthResult = reader.readU32(`${path}.${index}.keyByteLength`, field);
    if (!keyByteLengthResult.ok) return keyByteLengthResult;
    const keyByteLength = keyByteLengthResult.value;
    const keyOffset = reader.offset;
    const keyBytesResult = reader.readBytes(keyByteLength, `${path}.${index}.key`, field);
    if (!keyBytesResult.ok) return keyBytesResult;
    const keyBytes = keyBytesResult.value;

    if (previousKeyBytes !== undefined && compareBytes(previousKeyBytes, keyBytes) >= 0) {
      return decodeRejected(
        "malformedPayload",
        "VariableMap keys must be strictly increasing",
        `${path}.${index}.key`,
        field,
        keyOffset,
      );
    }

    const keyResult = decodeUtf8Strict(keyBytes, `${path}.${index}.key`, field, keyOffset);
    if (!keyResult.ok) return keyResult;
    const key = keyResult.value;
    const valResult = readValue(reader, shape, `${path}.${key}`, field);
    if (!valResult.ok) return valResult;
    map[key] = valResult.value;
    previousKeyBytes = keyBytes;

    if (keyByteLength > U32_MAX) {
      return decodeRejected(
        "malformedPayload",
        "VariableMap keyByteLength must fit in u32",
        `${path}.${index}.keyByteLength`,
        field,
        keyLengthOffset,
      );
    }
  }
  return { ok: true, value: map };
}

export function writeFixedString(
  writer: PayloadWriter,
  shape: WarmSnapshotPayloadFixedStringEncodedShape,
  value: WarmSnapshotValue,
  path: string,
  field: FieldContext,
): PayloadWriteResult {
  if (typeof value !== "string") {
    return encodeValueRejected("FixedStringEncoded value must be a string", path, field);
  }

  const bytesResult =
    shape.encoding === "ascii"
      ? encodeAscii(value, path, field)
      : encodeUtf8Strict(value, path, field);
  if (!bytesResult.ok) return bytesResult;
  const bytes = bytesResult.value;
  if (bytes.byteLength > shape.byteLength) {
    return encodeValueRejected(
      `FixedStringEncoded byte length must be <= ${shape.byteLength}`,
      path,
      field,
    );
  }

  writer.writeU16(bytes.byteLength);
  writer.writeBytes(bytes);
  return { ok: true };
}

export function readFixedString(
  reader: PayloadReader,
  shape: WarmSnapshotPayloadFixedStringEncodedShape,
  path: string,
  field: FieldContext,
): PayloadReadResult<string> {
  const offset = reader.offset;
  const lenResult = reader.readU16(`${path}.liveByteLength`, field);
  if (!lenResult.ok) return lenResult;
  const liveByteLength = lenResult.value;
  if (liveByteLength > shape.byteLength) {
    return decodeRejected(
      "malformedPayload",
      `FixedStringEncoded liveByteLength ${liveByteLength} exceeds byteLength ${shape.byteLength}`,
      path,
      field,
      offset,
    );
  }

  const bytesResult = reader.readBytes(liveByteLength, `${path}.bytes`, field);
  if (!bytesResult.ok) return bytesResult;
  const bytes = bytesResult.value;
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
): PayloadWriteResult {
  if (typeof value !== "string") {
    return encodeValueRejected("VariableString value must be a string", path, field);
  }

  const bytesResult = encodeUtf8Strict(value, path, field);
  if (!bytesResult.ok) return bytesResult;
  const bytes = bytesResult.value;
  writer.writeU32(bytes.byteLength);
  writer.writeBytes(bytes);
  return { ok: true };
}

export function readVariableString(
  reader: PayloadReader,
  path: string,
  field: FieldContext,
): PayloadReadResult<string> {
  const offset = reader.offset;
  const lenResult = reader.readU32(`${path}.liveByteLength`, field);
  if (!lenResult.ok) return lenResult;
  const liveByteLength = lenResult.value;
  const bytesResult = reader.readBytes(liveByteLength, `${path}.bytes`, field);
  if (!bytesResult.ok) return bytesResult;
  return decodeUtf8Strict(bytesResult.value, path, field, offset + 4);
}

function sortedObjectEntries(
  value: WarmSnapshotValue,
  path: string,
  field: FieldContext,
  label: "BoundedMap" | "VariableMap",
): PayloadWriteOutput<readonly (readonly [string, WarmSnapshotValue])[]> {
  const assertResult = assertPlainMapObject(value, path, field, label);
  if (!assertResult.ok) return assertResult;
  const mapValue = value as WarmSnapshotMapObject;
  const keysResult = ownEnumerableStringKeys(mapValue);
  if (!keysResult.ok) {
    return {
      ok: false,
      issue: { reason: "invalidSnapshotValue", detail: keysResult.detail, path, field },
    };
  }
  if (keysResult.symbolCount > 0) {
    return {
      ok: false,
      issue: {
        reason: "invalidSnapshotValue",
        detail: `${label} value must not contain symbol keys`,
        path,
        field,
      },
    };
  }

  return {
    ok: true,
    value: keysResult.stringKeys.map((key) => [key, mapValue[key] as WarmSnapshotValue] as const),
  };
}

function assertPlainMapObject(
  value: unknown,
  path: string,
  field: FieldContext,
  label: string,
): PayloadWriteResult {
  if (!isPlainRecord(value)) {
    return encodeValueRejected(`${label} value must be a plain object`, path, field);
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
): PayloadWriteOutput<Uint8Array> {
  const bytesResult = encodeAscii(key, path, field);
  if (!bytesResult.ok) return bytesResult;
  const bytes = bytesResult.value;
  if (bytes.includes(0)) {
    return {
      ok: false,
      issue: {
        reason: "invalidSnapshotValue",
        detail: "BoundedMap key must not contain NUL bytes",
        path,
        field,
      },
    };
  }
  if (bytes.byteLength > keyByteLength) {
    return {
      ok: false,
      issue: {
        reason: "invalidSnapshotValue",
        detail: `BoundedMap key byte length must be <= ${keyByteLength}`,
        path,
        field,
      },
    };
  }

  const padded = new Uint8Array(keyByteLength);
  padded.set(bytes);
  return { ok: true, value: padded };
}

function decodeBoundedMapKey(
  bytes: Uint8Array,
  path: string,
  field: FieldContext,
  offset: number,
): PayloadReadResult<string> {
  let liveLength = bytes.byteLength;
  for (let index = 0; index < bytes.byteLength; index += 1) {
    const byte = bytes[index];
    if (byte === undefined) {
      return decodeRejected(
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
      return decodeRejected(
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
      return decodeRejected(
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

function encodeUtf8Strict(
  value: string,
  path: string,
  field: FieldContext,
): PayloadWriteOutput<Uint8Array> {
  if (!isValidUtf8String(value)) {
    return {
      ok: false,
      issue: {
        reason: "invalidSnapshotValue",
        detail: "string value must be valid UTF-8 text",
        path,
        field,
      },
    };
  }
  return { ok: true, value: textEncoder.encode(value) };
}

function decodeUtf8Strict(
  bytes: Uint8Array,
  path: string,
  field: FieldContext,
  offset: number,
): PayloadReadResult<string> {
  try {
    return { ok: true, value: textDecoder.decode(bytes) };
  } catch {
    return decodeRejected("invalidUtf8", "UTF-8 bytes are invalid", path, field, offset);
  }
}

function encodeAscii(
  value: string,
  path: string,
  field: FieldContext,
): PayloadWriteOutput<Uint8Array> {
  const bytes = new Uint8Array(value.length);
  for (let index = 0; index < value.length; index += 1) {
    const codeUnit = value.charCodeAt(index);
    if (codeUnit > 0x7f) {
      return {
        ok: false,
        issue: {
          reason: "invalidSnapshotValue",
          detail: "ascii string contains a non-ASCII code unit",
          path,
          field,
        },
      };
    }
    bytes[index] = codeUnit;
  }
  return { ok: true, value: bytes };
}

function decodeAscii(
  bytes: Uint8Array,
  path: string,
  field: FieldContext,
  offset: number,
): PayloadReadResult<string> {
  let value = "";
  for (let index = 0; index < bytes.byteLength; index += 1) {
    const byte = bytes[index];
    if (byte === undefined) {
      return decodeRejected(
        "malformedPayload",
        "ascii byte is missing",
        path,
        field,
        offset + index,
      );
    }
    if (byte > 0x7f) {
      return decodeRejected(
        "malformedPayload",
        "ascii string contains a non-ASCII byte",
        path,
        field,
        offset + index,
      );
    }
    value += String.fromCharCode(byte);
  }
  return { ok: true, value };
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
