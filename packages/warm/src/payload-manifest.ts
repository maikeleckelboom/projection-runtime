import type { AbiEnumStorageType, AbiScalarType, AbiStringEncoding } from "@exclave/base";
import { compareUtf8, unsignedMaxForStorage } from "./payload-bytes";
import { textDecoder, textEncoder, U16_MAX, U32_MAX, U64_MAX } from "./payload-constants";
import type {
  NormalizedField,
  WarmSnapshotPayloadManifest,
  WarmSnapshotPayloadShape,
} from "./payload-types";

export function normalizeManifest(manifest: WarmSnapshotPayloadManifest):
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

  const sortedFields = [...fields].sort((left, right) =>
    compareUtf8(left.dotPath, right.dotPath, textEncoder),
  );
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
