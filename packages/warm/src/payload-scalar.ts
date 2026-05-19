import type { AbiScalarType } from "@exclave/base";
import type { PayloadReader, PayloadWriter } from "./payload-bytes";
import { readUnsignedStorage, writeUnsignedStorage } from "./payload-bytes";
import { F32_MAX, I64_MAX, I64_MIN, U16_MAX, U32_MAX, U64_MAX } from "./payload-constants";
import { encodeValueProblem, WarmDecodeProblem } from "./payload-failure";
import type {
  FieldContext,
  WarmSnapshotPayloadFixedEnumShape,
  WarmSnapshotScalarValue,
  WarmSnapshotValue,
} from "./payload-types";

export function writeScalar(
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

export function readScalar(
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

export function writeEnum(
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

export function readEnum(
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

export function writeVector(
  writer: PayloadWriter,
  shape: { readonly elementType: AbiScalarType; readonly length: number },
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

export function readVector(
  reader: PayloadReader,
  shape: { readonly elementType: AbiScalarType; readonly length: number },
  path: string,
  field: FieldContext,
): readonly WarmSnapshotScalarValue[] {
  const values: WarmSnapshotScalarValue[] = [];
  for (let index = 0; index < shape.length; index += 1) {
    values.push(readScalar(reader, shape.elementType, false, `${path}.${index}`, field));
  }
  return values;
}

export function writeBoundedArray(
  writer: PayloadWriter,
  shape: { readonly elementType: AbiScalarType; readonly maxLength: number },
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

export function readBoundedArray(
  reader: PayloadReader,
  shape: { readonly elementType: AbiScalarType; readonly maxLength: number },
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
