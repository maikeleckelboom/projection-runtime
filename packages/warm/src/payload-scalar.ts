import type { AbiScalarType } from "@exclave/base";
import type { PayloadReader, PayloadWriter } from "./payload-bytes";
import { readUnsignedStorage, writeUnsignedStorage } from "./payload-bytes";
import { F32_MAX, I64_MAX, I64_MIN, U16_MAX, U32_MAX, U64_MAX } from "./payload-constants";
import {
  decodeRejected,
  encodeValueRejected,
  type PayloadReadResult,
  type PayloadWriteOutput,
  type PayloadWriteResult,
} from "./payload-failure";
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
): PayloadWriteResult {
  switch (type) {
    case "bool":
      if (typeof value !== "boolean") {
        return encodeValueRejected("bool value must be a boolean", path, field);
      }
      writer.writeU8(value ? 1 : 0);
      return { ok: true };

    case "u8": {
      const result = requireInteger(value, 0, 0xff, path, field);
      if (!result.ok) return result;
      writer.writeU8(result.value);
      return { ok: true };
    }

    case "u16": {
      const result = requireInteger(value, 0, U16_MAX, path, field);
      if (!result.ok) return result;
      writer.writeU16(result.value);
      return { ok: true };
    }

    case "u32": {
      const result = requireInteger(value, 0, U32_MAX, path, field);
      if (!result.ok) return result;
      writer.writeU32(result.value);
      return { ok: true };
    }

    case "u64": {
      const result = requireBigInt(value, 0n, U64_MAX, path, field);
      if (!result.ok) return result;
      writer.writeU64(result.value);
      return { ok: true };
    }

    case "i8": {
      const result = requireInteger(value, -0x80, 0x7f, path, field);
      if (!result.ok) return result;
      writer.writeI8(result.value);
      return { ok: true };
    }

    case "i16": {
      const result = requireInteger(value, -0x8000, 0x7fff, path, field);
      if (!result.ok) return result;
      writer.writeI16(result.value);
      return { ok: true };
    }

    case "i32": {
      const result = requireInteger(value, -0x8000_0000, 0x7fff_ffff, path, field);
      if (!result.ok) return result;
      writer.writeI32(result.value);
      return { ok: true };
    }

    case "i64": {
      const result = requireBigInt(value, I64_MIN, I64_MAX, path, field);
      if (!result.ok) return result;
      writer.writeI64(result.value);
      return { ok: true };
    }

    case "f32": {
      const numberResult = requireFloat(value, nanSentinel, path, field);
      if (!numberResult.ok) return numberResult;
      const numberValue = numberResult.value;
      if (Number.isFinite(numberValue) && Math.abs(numberValue) > F32_MAX) {
        return encodeValueRejected(
          "f32 value must be finite after IEEE-754 f32 encoding",
          path,
          field,
        );
      }
      writer.writeF32(numberValue);
      return { ok: true };
    }

    case "f64": {
      const result = requireFloat(value, nanSentinel, path, field);
      if (!result.ok) return result;
      writer.writeF64(result.value);
      return { ok: true };
    }
  }
}

export function readScalar(
  reader: PayloadReader,
  type: AbiScalarType,
  nanSentinel: boolean,
  path: string,
  field: FieldContext,
): PayloadReadResult<WarmSnapshotScalarValue> {
  switch (type) {
    case "bool": {
      const valResult = reader.readU8(path, field);
      if (!valResult.ok) return valResult;
      const value = valResult.value;
      if (value === 0) return { ok: true, value: false };
      if (value === 1) return { ok: true, value: true };
      return decodeRejected(
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

    case "f32": {
      const valResult = reader.readF32(path, field);
      if (!valResult.ok) return valResult;
      return validateDecodedFloat(valResult.value, nanSentinel, path, field, reader.offset - 4);
    }

    case "f64": {
      const valResult = reader.readF64(path, field);
      if (!valResult.ok) return valResult;
      return validateDecodedFloat(valResult.value, nanSentinel, path, field, reader.offset - 8);
    }
  }
}

export function writeEnum(
  writer: PayloadWriter,
  shape: WarmSnapshotPayloadFixedEnumShape,
  value: WarmSnapshotValue,
  path: string,
  field: FieldContext,
): PayloadWriteResult {
  if (typeof value !== "string") {
    return encodeValueRejected("FixedEnum value must be a string variant", path, field);
  }

  const index = shape.variants.indexOf(value);
  if (index < 0) {
    return encodeValueRejected(`unknown FixedEnum variant ${JSON.stringify(value)}`, path, field);
  }

  writeUnsignedStorage(writer, shape.storage, index);
  return { ok: true };
}

export function readEnum(
  reader: PayloadReader,
  shape: WarmSnapshotPayloadFixedEnumShape,
  path: string,
  field: FieldContext,
): PayloadReadResult<string> {
  const offset = reader.offset;
  const discResult = readUnsignedStorage(reader, shape.storage, path, field);
  if (!discResult.ok) return discResult;
  const discriminant = discResult.value;
  if (discriminant >= shape.variants.length) {
    return decodeRejected(
      "malformedPayload",
      `FixedEnum discriminant ${discriminant} is outside declared variants`,
      path,
      field,
      offset,
    );
  }

  const variant = shape.variants[discriminant];
  if (variant === undefined) {
    return decodeRejected(
      "malformedPayload",
      `FixedEnum discriminant ${discriminant} is outside declared variants`,
      path,
      field,
      offset,
    );
  }
  return { ok: true, value: variant };
}

export function writeVector(
  writer: PayloadWriter,
  shape: { readonly elementType: AbiScalarType; readonly length: number },
  value: WarmSnapshotValue,
  path: string,
  field: FieldContext,
): PayloadWriteResult {
  if (!Array.isArray(value)) {
    return encodeValueRejected("FixedVector value must be an array", path, field);
  }
  if (value.length !== shape.length) {
    return encodeValueRejected(`FixedVector length must be exactly ${shape.length}`, path, field);
  }

  for (let index = 0; index < value.length; index += 1) {
    const result = writeScalar(
      writer,
      shape.elementType,
      false,
      value[index] as WarmSnapshotValue,
      `${path}.${index}`,
      field,
    );
    if (!result.ok) return result;
  }
  return { ok: true };
}

export function readVector(
  reader: PayloadReader,
  shape: { readonly elementType: AbiScalarType; readonly length: number },
  path: string,
  field: FieldContext,
): PayloadReadResult<readonly WarmSnapshotScalarValue[]> {
  const values: WarmSnapshotScalarValue[] = [];
  for (let index = 0; index < shape.length; index += 1) {
    const result = readScalar(reader, shape.elementType, false, `${path}.${index}`, field);
    if (!result.ok) return result;
    values.push(result.value);
  }
  return { ok: true, value: values };
}

export function writeBoundedArray(
  writer: PayloadWriter,
  shape: { readonly elementType: AbiScalarType; readonly maxLength: number },
  value: WarmSnapshotValue,
  path: string,
  field: FieldContext,
): PayloadWriteResult {
  if (!Array.isArray(value)) {
    return encodeValueRejected("BoundedArray value must be an array", path, field);
  }
  if (value.length > shape.maxLength) {
    return encodeValueRejected(`BoundedArray length must be <= ${shape.maxLength}`, path, field);
  }

  writer.writeU32(value.length);
  for (let index = 0; index < value.length; index += 1) {
    const result = writeScalar(
      writer,
      shape.elementType,
      false,
      value[index] as WarmSnapshotValue,
      `${path}.${index}`,
      field,
    );
    if (!result.ok) return result;
  }
  return { ok: true };
}

export function readBoundedArray(
  reader: PayloadReader,
  shape: { readonly elementType: AbiScalarType; readonly maxLength: number },
  path: string,
  field: FieldContext,
): PayloadReadResult<readonly WarmSnapshotScalarValue[]> {
  const offset = reader.offset;
  const countResult = reader.readU32(`${path}.liveCount`, field);
  if (!countResult.ok) return countResult;
  const liveCount = countResult.value;
  if (liveCount > shape.maxLength) {
    return decodeRejected(
      "malformedPayload",
      `BoundedArray liveCount ${liveCount} exceeds maxLength ${shape.maxLength}`,
      path,
      field,
      offset,
    );
  }

  const values: WarmSnapshotScalarValue[] = [];
  for (let index = 0; index < liveCount; index += 1) {
    const result = readScalar(reader, shape.elementType, false, `${path}.${index}`, field);
    if (!result.ok) return result;
    values.push(result.value);
  }
  return { ok: true, value: values };
}

function requireInteger(
  value: WarmSnapshotValue,
  min: number,
  max: number,
  path: string,
  field: FieldContext,
): PayloadWriteOutput<number> {
  if (typeof value === "number" && Number.isSafeInteger(value) && value >= min && value <= max) {
    return { ok: true, value };
  }
  return {
    ok: false,
    issue: {
      reason: "invalidSnapshotValue",
      detail: `integer value must be in range [${min}, ${max}]`,
      path,
      field,
    },
  };
}

function requireBigInt(
  value: WarmSnapshotValue,
  min: bigint,
  max: bigint,
  path: string,
  field: FieldContext,
): PayloadWriteOutput<bigint> {
  if (typeof value === "bigint" && value >= min && value <= max) {
    return { ok: true, value };
  }
  return {
    ok: false,
    issue: {
      reason: "invalidSnapshotValue",
      detail: `bigint value must be in range [${min}, ${max}]`,
      path,
      field,
    },
  };
}

function requireFloat(
  value: WarmSnapshotValue,
  nanSentinel: boolean,
  path: string,
  field: FieldContext,
): PayloadWriteOutput<number> {
  if (typeof value !== "number") {
    return {
      ok: false,
      issue: {
        reason: "invalidSnapshotValue",
        detail: "floating scalar value must be a number",
        path,
        field,
      },
    };
  }
  if (Number.isFinite(value)) {
    return { ok: true, value };
  }
  if (nanSentinel && Number.isNaN(value)) {
    return { ok: true, value };
  }
  return {
    ok: false,
    issue: {
      reason: "invalidSnapshotValue",
      detail: "floating scalar value must be finite",
      path,
      field,
    },
  };
}

function validateDecodedFloat(
  value: number,
  nanSentinel: boolean,
  path: string,
  field: FieldContext,
  offset: number,
): PayloadReadResult<number> {
  if (Number.isFinite(value)) {
    return { ok: true, value };
  }
  if (nanSentinel && Number.isNaN(value)) {
    return { ok: true, value };
  }
  return decodeRejected(
    "malformedPayload",
    "floating scalar bytes decode to a non-finite value",
    path,
    field,
    offset,
  );
}
