import type { AbiEnumStorageType, AbiScalarType, AbiStringEncoding } from "@exclave/base";

export type WarmSnapshotPayloadEncodeFailureReason =
  | "invalidManifest"
  | "invalidSnapshotObject"
  | "snapshotFieldMissing"
  | "snapshotFieldUnknown"
  | "invalidSnapshotValue";

export type WarmSnapshotPayloadDecodeFailureReason =
  | "invalidManifest"
  | "invalidPayloadInput"
  | "malformedPayload"
  | "invalidUtf8";

export type WarmSnapshotPayloadEncodeFailure = {
  readonly kind: "warmSnapshotPayloadEncodeFailure";
  readonly reason: WarmSnapshotPayloadEncodeFailureReason;
  readonly detail: string;
  readonly path?: string;
  readonly fieldDotPath?: string;
  readonly fieldId?: number;
};

export type WarmSnapshotPayloadDecodeFailure = {
  readonly kind: "warmSnapshotPayloadDecodeFailure";
  readonly reason: WarmSnapshotPayloadDecodeFailureReason;
  readonly detail: string;
  readonly path?: string;
  readonly fieldDotPath?: string;
  readonly fieldId?: number;
  readonly offset?: number;
};

export type WarmSnapshotPayloadEncodeResult =
  | { readonly ok: true; readonly bytes: Uint8Array }
  | { readonly ok: false; readonly failure: WarmSnapshotPayloadEncodeFailure };

export type WarmSnapshotPayloadDecodeResult =
  | { readonly ok: true; readonly snapshot: WarmSnapshotObject }
  | { readonly ok: false; readonly failure: WarmSnapshotPayloadDecodeFailure };

export interface WarmSnapshotPayloadManifest {
  readonly fields: readonly WarmSnapshotPayloadField[];
  readonly warmCodecVersion?: bigint;
}

export interface WarmSnapshotPayloadField {
  readonly dotPath: string;
  readonly fieldId?: number;
  readonly shape: WarmSnapshotPayloadShape;
}

export type WarmSnapshotPayloadShape =
  | WarmSnapshotPayloadFixedScalarShape
  | WarmSnapshotPayloadFixedEnumShape
  | WarmSnapshotPayloadFixedVectorShape
  | WarmSnapshotPayloadBoundedArrayShape
  | WarmSnapshotPayloadBoundedMapShape
  | WarmSnapshotPayloadVariableMapShape
  | WarmSnapshotPayloadFixedStringEncodedShape
  | WarmSnapshotPayloadVariableStringShape;

export interface WarmSnapshotPayloadFixedScalarShape {
  readonly kind: "FixedScalar";
  readonly type: AbiScalarType;
  readonly nanSentinel?: true;
}

export interface WarmSnapshotPayloadFixedEnumShape {
  readonly kind: "FixedEnum";
  readonly storage: AbiEnumStorageType;
  readonly variants: readonly string[];
}

export interface WarmSnapshotPayloadFixedVectorShape {
  readonly kind: "FixedVector";
  readonly elementType: AbiScalarType;
  readonly length: number;
}

export interface WarmSnapshotPayloadBoundedArrayShape {
  readonly kind: "BoundedArray";
  readonly elementType: AbiScalarType;
  readonly maxLength: number;
}

export interface WarmSnapshotPayloadBoundedMapShape {
  readonly kind: "BoundedMap";
  readonly keyEncoding?: "fixed-ascii";
  readonly keyByteLength: number;
  readonly valueShape: WarmSnapshotPayloadFixedValueShape;
  readonly maxEntries: number;
}

export interface WarmSnapshotPayloadVariableMapShape {
  readonly kind: "VariableMap";
  readonly valueShape: WarmSnapshotPayloadShape;
}

export interface WarmSnapshotPayloadFixedStringEncodedShape {
  readonly kind: "FixedStringEncoded";
  readonly byteLength: number;
  readonly encoding: AbiStringEncoding;
}

export interface WarmSnapshotPayloadVariableStringShape {
  readonly kind: "VariableString";
}

export type WarmSnapshotPayloadFixedValueShape =
  | WarmSnapshotPayloadFixedScalarShape
  | WarmSnapshotPayloadFixedEnumShape
  | WarmSnapshotPayloadFixedVectorShape;

export type WarmSnapshotScalarValue = boolean | number | bigint | string;
export type WarmSnapshotValue =
  | WarmSnapshotScalarValue
  | readonly WarmSnapshotValue[]
  | WarmSnapshotMapObject;

export interface WarmSnapshotObject {
  readonly [key: string]: WarmSnapshotValue;
}

export interface WarmSnapshotMapObject {
  readonly [key: string]: WarmSnapshotValue;
}

type NormalizedField = {
  readonly dotPath: string;
  readonly fieldId?: number;
  readonly shape: WarmSnapshotPayloadShape;
};

type FieldContext = {
  readonly dotPath: string;
  readonly fieldId?: number;
};

type ObjectKeysResult =
  | { readonly ok: true; readonly stringKeys: readonly string[]; readonly symbolCount: number }
  | { readonly ok: false; readonly detail: string };

const U16_MAX = 0xffff;
const U32_MAX = 0xffff_ffff;
const U64_MAX = 0xffff_ffff_ffff_ffffn;
const I64_MIN = -0x8000_0000_0000_0000n;
const I64_MAX = 0x7fff_ffff_ffff_ffffn;
const F32_MAX = 3.4028234663852886e38;
const textEncoder = new TextEncoder();
const textDecoder = new TextDecoder("utf-8", { fatal: true });

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
        undefined,
        reader.offset,
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

function normalizeManifest(manifest: WarmSnapshotPayloadManifest):
  | { readonly ok: true; readonly fields: readonly NormalizedField[] }
  | {
      readonly ok: false;
      readonly detail: string;
      readonly path?: string;
    } {
  if (!isPlainRecord(manifest)) {
    return { ok: false, detail: "warm snapshot payload manifest must be a plain object" };
  }

  if ("warmCodecVersion" in manifest && manifest.warmCodecVersion !== undefined) {
    const warmCodecVersion = manifest.warmCodecVersion;
    if (
      typeof warmCodecVersion !== "bigint" ||
      warmCodecVersion < 0n ||
      warmCodecVersion > U64_MAX
    ) {
      return {
        ok: false,
        detail: "warmCodecVersion must fit in u64 when present",
        path: "manifest.warmCodecVersion",
      };
    }
  }

  if (!Array.isArray(manifest.fields)) {
    return { ok: false, detail: "manifest.fields must be an array", path: "manifest.fields" };
  }

  const fields: NormalizedField[] = [];
  for (let index = 0; index < manifest.fields.length; index += 1) {
    const field = manifest.fields[index];
    const path = `manifest.fields.${index}`;
    if (!isPlainRecord(field)) {
      return { ok: false, detail: "manifest field must be a plain object", path };
    }

    if (!isValidUtf8String(field.dotPath) || field.dotPath.length === 0) {
      return {
        ok: false,
        detail: "manifest field dotPath must be non-empty valid UTF-8 text",
        path: `${path}.dotPath`,
      };
    }

    const fieldIdValue = field.fieldId;
    if (fieldIdValue !== undefined && !isU32(fieldIdValue)) {
      return { ok: false, detail: "manifest fieldId must fit in u32", path: `${path}.fieldId` };
    }

    const shape = field.shape as WarmSnapshotPayloadShape;
    const shapeIssue = validateShape(shape, `${path}.shape`, false);
    if (shapeIssue !== null) {
      return { ok: false, detail: shapeIssue.detail, path: shapeIssue.path };
    }

    fields.push(
      fieldIdValue === undefined
        ? { dotPath: field.dotPath, shape }
        : { dotPath: field.dotPath, fieldId: fieldIdValue, shape },
    );
  }

  const sortedFields = [...fields].sort((left, right) => compareUtf8(left.dotPath, right.dotPath));
  for (let index = 1; index < sortedFields.length; index += 1) {
    const previous = sortedFields[index - 1];
    const current = sortedFields[index];
    if (previous !== undefined && current !== undefined && previous.dotPath === current.dotPath) {
      return {
        ok: false,
        detail: `duplicate manifest field dotPath ${current.dotPath}`,
        path: `manifest.fields.${index}.dotPath`,
      };
    }
  }

  return { ok: true, fields: sortedFields };
}

function validateShape(
  shape: unknown,
  path: string,
  boundedMapValueShape: boolean,
): { readonly detail: string; readonly path: string } | null {
  if (!isPlainRecord(shape)) {
    return { detail: "shape must be a plain object", path };
  }

  switch (shape.kind) {
    case "FixedScalar":
      if (!isScalarType(shape.type)) {
        return { detail: "FixedScalar.type is unsupported", path: `${path}.type` };
      }
      if ("nanSentinel" in shape && shape.nanSentinel !== true && shape.nanSentinel !== undefined) {
        return {
          detail: "FixedScalar.nanSentinel must be true when present",
          path: `${path}.nanSentinel`,
        };
      }
      return null;

    case "FixedEnum":
      if (!isEnumStorageType(shape.storage)) {
        return { detail: "FixedEnum.storage is unsupported", path: `${path}.storage` };
      }
      if (!Array.isArray(shape.variants) || shape.variants.length === 0) {
        return { detail: "FixedEnum.variants must be a non-empty array", path: `${path}.variants` };
      }
      if (shape.variants.length - 1 > unsignedMaxForStorage(shape.storage)) {
        return {
          detail: "FixedEnum variant count exceeds declared storage width",
          path: `${path}.variants`,
        };
      }
      return validateUniqueStringArray(shape.variants, `${path}.variants`);

    case "FixedVector":
      if (!isScalarType(shape.elementType)) {
        return { detail: "FixedVector.elementType is unsupported", path: `${path}.elementType` };
      }
      if (!isPositiveU32(shape.length)) {
        return {
          detail: "FixedVector.length must be a positive u32 value",
          path: `${path}.length`,
        };
      }
      return null;

    case "BoundedArray":
      if (!isScalarType(shape.elementType)) {
        return { detail: "BoundedArray.elementType is unsupported", path: `${path}.elementType` };
      }
      if (!isPositiveU32(shape.maxLength)) {
        return {
          detail: "BoundedArray.maxLength must be a positive u32 value",
          path: `${path}.maxLength`,
        };
      }
      return null;

    case "BoundedMap":
      if (boundedMapValueShape) {
        return {
          detail: "BoundedMap valueShape must be FixedScalar, FixedEnum, or FixedVector",
          path,
        };
      }
      if (
        "keyEncoding" in shape &&
        shape.keyEncoding !== undefined &&
        shape.keyEncoding !== "fixed-ascii"
      ) {
        return {
          detail: "BoundedMap.keyEncoding must be fixed-ascii",
          path: `${path}.keyEncoding`,
        };
      }
      if (!isPositiveU16(shape.keyByteLength)) {
        return {
          detail: "BoundedMap.keyByteLength must be a positive u16 value",
          path: `${path}.keyByteLength`,
        };
      }
      if (!isPositiveU32(shape.maxEntries)) {
        return {
          detail: "BoundedMap.maxEntries must be a positive u32 value",
          path: `${path}.maxEntries`,
        };
      }
      if (!isPlainRecord(shape.valueShape)) {
        return {
          detail: "BoundedMap.valueShape must be a plain object",
          path: `${path}.valueShape`,
        };
      }
      if (
        shape.valueShape.kind !== "FixedScalar" &&
        shape.valueShape.kind !== "FixedEnum" &&
        shape.valueShape.kind !== "FixedVector"
      ) {
        return {
          detail: "BoundedMap valueShape must be FixedScalar, FixedEnum, or FixedVector",
          path: `${path}.valueShape.kind`,
        };
      }
      return validateShape(shape.valueShape, `${path}.valueShape`, true);

    case "VariableMap":
      return validateShape(shape.valueShape, `${path}.valueShape`, false);

    case "FixedStringEncoded":
      if (!isPositiveU16(shape.byteLength)) {
        return {
          detail: "FixedStringEncoded.byteLength must be a positive u16 value",
          path: `${path}.byteLength`,
        };
      }
      if (!isStringEncoding(shape.encoding)) {
        return {
          detail: "FixedStringEncoded.encoding is unsupported",
          path: `${path}.encoding`,
        };
      }
      return null;

    case "VariableString":
      return null;

    default:
      return { detail: "shape kind is unsupported", path: `${path}.kind` };
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
      writeBoundedMap(writer, shape, value, path, field);
      return;

    case "VariableMap":
      writeVariableMap(writer, shape, value, path, field);
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
      return readBoundedMap(reader, shape, path, field);

    case "VariableMap":
      return readVariableMap(reader, shape, path, field);

    case "FixedStringEncoded":
      return readFixedString(reader, shape, path, field);

    case "VariableString":
      return readVariableString(reader, path, field);
  }
}

function writeScalar(
  writer: PayloadWriter,
  type: AbiScalarType,
  nanSentinel: boolean,
  value: WarmSnapshotValue,
  path: string,
  field: FieldContext,
): void {
  switch (type) {
    case "bool":
      if (typeof value !== "boolean") {
        encodeValueProblem("bool value must be a boolean", path, field);
      }
      writer.writeU8(value ? 1 : 0);
      return;

    case "u8":
      writer.writeU8(requireInteger(value, 0, 0xff, path, field));
      return;

    case "u16":
      writer.writeU16(requireInteger(value, 0, U16_MAX, path, field));
      return;

    case "u32":
      writer.writeU32(requireInteger(value, 0, U32_MAX, path, field));
      return;

    case "u64":
      writer.writeU64(requireBigInt(value, 0n, U64_MAX, path, field));
      return;

    case "i8":
      writer.writeI8(requireInteger(value, -0x80, 0x7f, path, field));
      return;

    case "i16":
      writer.writeI16(requireInteger(value, -0x8000, 0x7fff, path, field));
      return;

    case "i32":
      writer.writeI32(requireInteger(value, -0x8000_0000, 0x7fff_ffff, path, field));
      return;

    case "i64":
      writer.writeI64(requireBigInt(value, I64_MIN, I64_MAX, path, field));
      return;

    case "f32": {
      const numberValue = requireFloat(value, nanSentinel, path, field);
      if (Number.isFinite(numberValue) && Math.abs(numberValue) > F32_MAX) {
        encodeValueProblem("f32 value must be finite after IEEE-754 f32 encoding", path, field);
      }
      writer.writeF32(numberValue);
      return;
    }

    case "f64":
      writer.writeF64(requireFloat(value, nanSentinel, path, field));
      return;
  }
}

function readScalar(
  reader: PayloadReader,
  type: AbiScalarType,
  nanSentinel: boolean,
  path: string,
  field: FieldContext,
): WarmSnapshotScalarValue {
  switch (type) {
    case "bool": {
      const value = reader.readU8(path, field);
      if (value === 0) return false;
      if (value === 1) return true;
      throw new WarmDecodeProblem(
        "malformedPayload",
        `bool byte must be 0x00 or 0x01, got 0x${value.toString(16).padStart(2, "0")}`,
        path,
        field,
        reader.offset - 1,
      );
    }

    case "u8":
      return reader.readU8(path, field);

    case "u16":
      return reader.readU16(path, field);

    case "u32":
      return reader.readU32(path, field);

    case "u64":
      return reader.readU64(path, field);

    case "i8":
      return reader.readI8(path, field);

    case "i16":
      return reader.readI16(path, field);

    case "i32":
      return reader.readI32(path, field);

    case "i64":
      return reader.readI64(path, field);

    case "f32":
      return validateDecodedFloat(
        reader.readF32(path, field),
        nanSentinel,
        path,
        field,
        reader.offset - 4,
      );

    case "f64":
      return validateDecodedFloat(
        reader.readF64(path, field),
        nanSentinel,
        path,
        field,
        reader.offset - 8,
      );
  }
}

function writeEnum(
  writer: PayloadWriter,
  shape: WarmSnapshotPayloadFixedEnumShape,
  value: WarmSnapshotValue,
  path: string,
  field: FieldContext,
): void {
  if (typeof value !== "string") {
    encodeValueProblem("FixedEnum value must be a string variant", path, field);
  }

  const index = shape.variants.indexOf(value);
  if (index < 0) {
    encodeValueProblem(`unknown FixedEnum variant ${JSON.stringify(value)}`, path, field);
  }

  writeUnsignedStorage(writer, shape.storage, index);
}

function readEnum(
  reader: PayloadReader,
  shape: WarmSnapshotPayloadFixedEnumShape,
  path: string,
  field: FieldContext,
): string {
  const offset = reader.offset;
  const discriminant = readUnsignedStorage(reader, shape.storage, path, field);
  if (discriminant >= shape.variants.length) {
    throw new WarmDecodeProblem(
      "malformedPayload",
      `FixedEnum discriminant ${discriminant} is outside declared variants`,
      path,
      field,
      offset,
    );
  }

  const variant = shape.variants[discriminant];
  if (variant === undefined) {
    throw new WarmDecodeProblem(
      "malformedPayload",
      `FixedEnum discriminant ${discriminant} is outside declared variants`,
      path,
      field,
      offset,
    );
  }
  return variant;
}

function writeVector(
  writer: PayloadWriter,
  shape: WarmSnapshotPayloadFixedVectorShape,
  value: WarmSnapshotValue,
  path: string,
  field: FieldContext,
): void {
  if (!Array.isArray(value)) {
    encodeValueProblem("FixedVector value must be an array", path, field);
  }
  if (value.length !== shape.length) {
    encodeValueProblem(`FixedVector length must be exactly ${shape.length}`, path, field);
  }

  for (let index = 0; index < value.length; index += 1) {
    writeScalar(
      writer,
      shape.elementType,
      false,
      value[index] as WarmSnapshotValue,
      `${path}.${index}`,
      field,
    );
  }
}

function readVector(
  reader: PayloadReader,
  shape: WarmSnapshotPayloadFixedVectorShape,
  path: string,
  field: FieldContext,
): readonly WarmSnapshotScalarValue[] {
  const values: WarmSnapshotScalarValue[] = [];
  for (let index = 0; index < shape.length; index += 1) {
    values.push(readScalar(reader, shape.elementType, false, `${path}.${index}`, field));
  }
  return values;
}

function writeBoundedArray(
  writer: PayloadWriter,
  shape: WarmSnapshotPayloadBoundedArrayShape,
  value: WarmSnapshotValue,
  path: string,
  field: FieldContext,
): void {
  if (!Array.isArray(value)) {
    encodeValueProblem("BoundedArray value must be an array", path, field);
  }
  if (value.length > shape.maxLength) {
    encodeValueProblem(`BoundedArray length must be <= ${shape.maxLength}`, path, field);
  }

  writer.writeU32(value.length);
  for (let index = 0; index < value.length; index += 1) {
    writeScalar(
      writer,
      shape.elementType,
      false,
      value[index] as WarmSnapshotValue,
      `${path}.${index}`,
      field,
    );
  }
}

function readBoundedArray(
  reader: PayloadReader,
  shape: WarmSnapshotPayloadBoundedArrayShape,
  path: string,
  field: FieldContext,
): readonly WarmSnapshotScalarValue[] {
  const offset = reader.offset;
  const liveCount = reader.readU32(`${path}.liveCount`, field);
  if (liveCount > shape.maxLength) {
    throw new WarmDecodeProblem(
      "malformedPayload",
      `BoundedArray liveCount ${liveCount} exceeds maxLength ${shape.maxLength}`,
      path,
      field,
      offset,
    );
  }

  const values: WarmSnapshotScalarValue[] = [];
  for (let index = 0; index < liveCount; index += 1) {
    values.push(readScalar(reader, shape.elementType, false, `${path}.${index}`, field));
  }
  return values;
}

function writeBoundedMap(
  writer: PayloadWriter,
  shape: WarmSnapshotPayloadBoundedMapShape,
  value: WarmSnapshotValue,
  path: string,
  field: FieldContext,
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
    writeValue(writer, shape.valueShape, entry.value, `${path}.${entry.key}`, field);
  }
}

function readBoundedMap(
  reader: PayloadReader,
  shape: WarmSnapshotPayloadBoundedMapShape,
  path: string,
  field: FieldContext,
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
    map[key] = readValue(reader, shape.valueShape, `${path}.${key}`, field);
    previousKeyBytes = keyBytes;
  }
  return map;
}

function writeVariableMap(
  writer: PayloadWriter,
  shape: WarmSnapshotPayloadVariableMapShape,
  value: WarmSnapshotValue,
  path: string,
  field: FieldContext,
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
    writeValue(writer, shape.valueShape, entry.value, `${path}.${entry.key}`, field);
  }
}

function readVariableMap(
  reader: PayloadReader,
  shape: WarmSnapshotPayloadVariableMapShape,
  path: string,
  field: FieldContext,
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
    map[key] = readValue(reader, shape.valueShape, `${path}.${key}`, field);
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

function writeFixedString(
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

function readFixedString(
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

function writeVariableString(
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

function readVariableString(reader: PayloadReader, path: string, field: FieldContext): string {
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

function writeUnsignedStorage(
  writer: PayloadWriter,
  storage: AbiEnumStorageType,
  value: number,
): void {
  switch (storage) {
    case "u8":
      writer.writeU8(value);
      return;
    case "u16":
      writer.writeU16(value);
      return;
    case "u32":
      writer.writeU32(value);
      return;
  }
}

function readUnsignedStorage(
  reader: PayloadReader,
  storage: AbiEnumStorageType,
  path: string,
  field: FieldContext,
): number {
  switch (storage) {
    case "u8":
      return reader.readU8(path, field);
    case "u16":
      return reader.readU16(path, field);
    case "u32":
      return reader.readU32(path, field);
  }
}

function requireInteger(
  value: WarmSnapshotValue,
  min: number,
  max: number,
  path: string,
  field: FieldContext,
): number {
  if (typeof value === "number" && Number.isSafeInteger(value) && value >= min && value <= max) {
    return value;
  }
  encodeValueProblem(`integer value must be in range [${min}, ${max}]`, path, field);
}

function requireBigInt(
  value: WarmSnapshotValue,
  min: bigint,
  max: bigint,
  path: string,
  field: FieldContext,
): bigint {
  if (typeof value === "bigint" && value >= min && value <= max) {
    return value;
  }
  encodeValueProblem(`bigint value must be in range [${min}, ${max}]`, path, field);
}

function requireFloat(
  value: WarmSnapshotValue,
  nanSentinel: boolean,
  path: string,
  field: FieldContext,
): number {
  if (typeof value !== "number") {
    encodeValueProblem("floating scalar value must be a number", path, field);
  }
  if (Number.isFinite(value)) {
    return value;
  }
  if (nanSentinel && Number.isNaN(value)) {
    return value;
  }
  encodeValueProblem("floating scalar value must be finite", path, field);
}

function validateDecodedFloat(
  value: number,
  nanSentinel: boolean,
  path: string,
  field: FieldContext,
  offset: number,
): number {
  if (Number.isFinite(value)) {
    return value;
  }
  if (nanSentinel && Number.isNaN(value)) {
    return value;
  }
  throw new WarmDecodeProblem(
    "malformedPayload",
    "floating scalar bytes decode to a non-finite value",
    path,
    field,
    offset,
  );
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

function isPlainRecord(value: unknown): value is Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return false;
  }

  const proto = Object.getPrototypeOf(value);
  return proto === null || proto === Object.prototype;
}

function isScalarType(value: unknown): value is AbiScalarType {
  return (
    value === "bool" ||
    value === "u8" ||
    value === "u16" ||
    value === "u32" ||
    value === "u64" ||
    value === "i8" ||
    value === "i16" ||
    value === "i32" ||
    value === "i64" ||
    value === "f32" ||
    value === "f64"
  );
}

function isEnumStorageType(value: unknown): value is AbiEnumStorageType {
  return value === "u8" || value === "u16" || value === "u32";
}

function isStringEncoding(value: unknown): value is AbiStringEncoding {
  return value === "utf8" || value === "ascii";
}

function isPositiveU16(value: unknown): value is number {
  return typeof value === "number" && Number.isSafeInteger(value) && value > 0 && value <= U16_MAX;
}

function isPositiveU32(value: unknown): value is number {
  return typeof value === "number" && Number.isSafeInteger(value) && value > 0 && value <= U32_MAX;
}

function isU32(value: unknown): value is number {
  return typeof value === "number" && Number.isSafeInteger(value) && value >= 0 && value <= U32_MAX;
}

function validateUniqueStringArray(
  values: readonly unknown[],
  path: string,
): { readonly detail: string; readonly path: string } | null {
  const seen = new Set<string>();
  for (let index = 0; index < values.length; index += 1) {
    const value = values[index];
    if (typeof value !== "string" || value.length === 0) {
      return { detail: "FixedEnum variants must be non-empty strings", path: `${path}.${index}` };
    }
    if (seen.has(value)) {
      return { detail: `duplicate FixedEnum variant ${value}`, path: `${path}.${index}` };
    }
    seen.add(value);
  }
  return null;
}

function unsignedMaxForStorage(storage: AbiEnumStorageType): number {
  switch (storage) {
    case "u8":
      return 0xff;
    case "u16":
      return U16_MAX;
    case "u32":
      return U32_MAX;
  }
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

function compareUtf8(left: string, right: string): number {
  return compareBytes(textEncoder.encode(left), textEncoder.encode(right));
}

function compareBytes(left: Uint8Array, right: Uint8Array): number {
  const length = Math.min(left.byteLength, right.byteLength);
  for (let index = 0; index < length; index += 1) {
    const leftByte = left[index];
    const rightByte = right[index];
    if (leftByte === undefined || rightByte === undefined) {
      break;
    }
    if (leftByte !== rightByte) {
      return leftByte - rightByte;
    }
  }
  return left.byteLength - right.byteLength;
}

function encodeValueProblem(detail: string, path: string, field: FieldContext): never {
  throw new WarmEncodeProblem("invalidSnapshotValue", detail, path, field);
}

function encodeFailure(
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

function decodeFailure(
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

function encodeProblemFailure(error: WarmEncodeProblem): WarmSnapshotPayloadEncodeResult {
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

function decodeProblemFailure(error: WarmDecodeProblem): WarmSnapshotPayloadDecodeResult {
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

class WarmEncodeProblem extends Error {
  constructor(
    readonly reason: WarmSnapshotPayloadEncodeFailureReason,
    readonly detail: string,
    readonly path?: string,
    readonly field?: FieldContext,
  ) {
    super(detail);
  }
}

class WarmDecodeProblem extends Error {
  constructor(
    readonly reason: WarmSnapshotPayloadDecodeFailureReason,
    readonly detail: string,
    readonly path?: string,
    readonly field?: FieldContext,
    readonly offset?: number,
  ) {
    super(detail);
  }
}

class PayloadWriter {
  private readonly bytes: number[] = [];

  writeU8(value: number): void {
    this.bytes.push(value & 0xff);
  }

  writeI8(value: number): void {
    this.bytes.push(value & 0xff);
  }

  writeU16(value: number): void {
    this.writeDataView(2, (view) => view.setUint16(0, value, true));
  }

  writeI16(value: number): void {
    this.writeDataView(2, (view) => view.setInt16(0, value, true));
  }

  writeU32(value: number): void {
    this.writeDataView(4, (view) => view.setUint32(0, value, true));
  }

  writeI32(value: number): void {
    this.writeDataView(4, (view) => view.setInt32(0, value, true));
  }

  writeU64(value: bigint): void {
    this.writeDataView(8, (view) => view.setBigUint64(0, value, true));
  }

  writeI64(value: bigint): void {
    this.writeDataView(8, (view) => view.setBigInt64(0, value, true));
  }

  writeF32(value: number): void {
    this.writeDataView(4, (view) => view.setFloat32(0, value, true));
  }

  writeF64(value: number): void {
    this.writeDataView(8, (view) => view.setFloat64(0, value, true));
  }

  writeBytes(value: Uint8Array): void {
    for (const byte of value) {
      this.bytes.push(byte);
    }
  }

  toUint8Array(): Uint8Array {
    return Uint8Array.from(this.bytes);
  }

  private writeDataView(byteLength: number, write: (view: DataView) => void): void {
    const bytes = new Uint8Array(byteLength);
    write(new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength));
    this.writeBytes(bytes);
  }
}

class PayloadReader {
  readonly view: DataView;
  offset = 0;

  constructor(readonly bytes: Uint8Array) {
    this.view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  }

  readU8(path: string, field: FieldContext): number {
    this.requireRemaining(1, path, field);
    const value = this.view.getUint8(this.offset);
    this.offset += 1;
    return value;
  }

  readI8(path: string, field: FieldContext): number {
    this.requireRemaining(1, path, field);
    const value = this.view.getInt8(this.offset);
    this.offset += 1;
    return value;
  }

  readU16(path: string, field: FieldContext): number {
    this.requireRemaining(2, path, field);
    const value = this.view.getUint16(this.offset, true);
    this.offset += 2;
    return value;
  }

  readI16(path: string, field: FieldContext): number {
    this.requireRemaining(2, path, field);
    const value = this.view.getInt16(this.offset, true);
    this.offset += 2;
    return value;
  }

  readU32(path: string, field: FieldContext): number {
    this.requireRemaining(4, path, field);
    const value = this.view.getUint32(this.offset, true);
    this.offset += 4;
    return value;
  }

  readI32(path: string, field: FieldContext): number {
    this.requireRemaining(4, path, field);
    const value = this.view.getInt32(this.offset, true);
    this.offset += 4;
    return value;
  }

  readU64(path: string, field: FieldContext): bigint {
    this.requireRemaining(8, path, field);
    const value = this.view.getBigUint64(this.offset, true);
    this.offset += 8;
    return value;
  }

  readI64(path: string, field: FieldContext): bigint {
    this.requireRemaining(8, path, field);
    const value = this.view.getBigInt64(this.offset, true);
    this.offset += 8;
    return value;
  }

  readF32(path: string, field: FieldContext): number {
    this.requireRemaining(4, path, field);
    const value = this.view.getFloat32(this.offset, true);
    this.offset += 4;
    return value;
  }

  readF64(path: string, field: FieldContext): number {
    this.requireRemaining(8, path, field);
    const value = this.view.getFloat64(this.offset, true);
    this.offset += 8;
    return value;
  }

  readBytes(byteLength: number, path: string, field: FieldContext): Uint8Array {
    this.requireRemaining(byteLength, path, field);
    const value = this.bytes.slice(this.offset, this.offset + byteLength);
    this.offset += byteLength;
    return value;
  }

  private requireRemaining(byteLength: number, path: string, field: FieldContext): void {
    if (byteLength < 0 || this.offset > this.bytes.byteLength - byteLength) {
      throw new WarmDecodeProblem(
        "malformedPayload",
        `payload ended before ${byteLength} byte(s) could be read`,
        path,
        field,
        this.offset,
      );
    }
  }
}
