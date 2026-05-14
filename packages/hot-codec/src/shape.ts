import type { HotCodecIssue } from "./error";

const UINT16_MAX = 0xffff;
const UINT32_MAX = 0xffffffff;

type ScalarType =
  | "bool"
  | "u8"
  | "u16"
  | "u32"
  | "u64"
  | "i8"
  | "i16"
  | "i32"
  | "i64"
  | "f32"
  | "f64";

type EnumStorageType = "u8" | "u16" | "u32";

type StringEncoding = "utf8" | "ascii";

export interface HotLayoutPlanningFixedScalarShape {
  readonly kind: "FixedScalar";
  readonly type: ScalarType;
  readonly nanSentinel?: true;
}

export interface HotLayoutPlanningFixedEnumShape {
  readonly kind: "FixedEnum";
  readonly variants: readonly string[];
  readonly storage: EnumStorageType;
}

export interface HotLayoutPlanningFixedVectorShape {
  readonly kind: "FixedVector";
  readonly elementType: ScalarType;
  readonly length: number;
}

export interface HotLayoutPlanningFixedStringEncodedShape {
  readonly kind: "FixedStringEncoded";
  readonly byteLength: number;
  readonly encoding: StringEncoding;
}

export interface HotLayoutPlanningBoundedArrayShape {
  readonly kind: "BoundedArray";
  readonly elementType: ScalarType;
  readonly maxLength: number;
}

export interface HotLayoutPlanningBoundedMapShape {
  readonly kind: "BoundedMap";
  readonly keyEncoding: "fixed-ascii";
  readonly keyByteLength: number;
  readonly valueShape: HotLayoutPlanningFixedValueShape;
  readonly maxEntries: number;
}

export interface HotLayoutPlanningVariableStringShape {
  readonly kind: "VariableString";
}

export interface HotLayoutPlanningVariableMapShape {
  readonly kind: "VariableMap";
  readonly valueShape: HotLayoutPlanningShape;
}

export type HotLayoutPlanningFixedValueShape =
  | HotLayoutPlanningFixedScalarShape
  | HotLayoutPlanningFixedEnumShape
  | HotLayoutPlanningFixedVectorShape;

export type HotLayoutPlanningShape =
  | HotLayoutPlanningFixedValueShape
  | HotLayoutPlanningFixedStringEncodedShape
  | HotLayoutPlanningBoundedArrayShape
  | HotLayoutPlanningBoundedMapShape
  | HotLayoutPlanningVariableStringShape
  | HotLayoutPlanningVariableMapShape;

export interface ReservationMetrics {
  readonly countFieldOffset: number;
  readonly elementsOffset: number;
  readonly maxCount: number;
  readonly unitByteLength: number;
}

export function compareUtf8(left: string, right: string): number {
  return Buffer.compare(Buffer.from(left, "utf8"), Buffer.from(right, "utf8"));
}

export function roundUpPad(currentEnd: number, alignment: number): number {
  if (alignment === 1) {
    return 0;
  }

  const remainder = currentEnd % alignment;
  if (remainder === 0) {
    return 0;
  }

  return alignment - remainder;
}

export function roundUp(value: number, alignment: number): number {
  return value + roundUpPad(value, alignment);
}

export function naturalAlignment(shape: HotLayoutPlanningShape): number {
  switch (shape.kind) {
    case "FixedScalar":
      return scalarAlignment(shape.type);

    case "FixedEnum":
      return scalarAlignment(shape.storage);

    case "FixedVector":
      return scalarAlignment(shape.elementType);

    case "FixedStringEncoded":
      return 1;

    case "BoundedArray":
      return Math.max(4, scalarAlignment(shape.elementType));

    case "BoundedMap":
      return Math.max(4, valueAlignment(shape.valueShape));

    case "VariableString":
    case "VariableMap":
      throw new Error(`${shape.kind} has no hot-lane natural alignment`);
  }
}

export function fieldByteSpan(shape: HotLayoutPlanningShape): number {
  switch (shape.kind) {
    case "FixedScalar":
      return scalarByteWidth(shape.type);

    case "FixedEnum":
      return enumByteWidth(shape.storage);

    case "FixedVector":
      return scalarByteWidth(shape.elementType) * shape.length;

    case "FixedStringEncoded":
      return shape.byteLength;

    case "BoundedArray":
      return boundedArraySpan(shape);

    case "BoundedMap":
      return boundedMapSpan(shape);

    case "VariableString":
    case "VariableMap":
      throw new Error(`${shape.kind} has no hot-lane byte span`);
  }
}

export function reservationMetrics(
  shape: HotLayoutPlanningBoundedArrayShape | HotLayoutPlanningBoundedMapShape,
  absoluteOffset: number,
): ReservationMetrics {
  switch (shape.kind) {
    case "BoundedArray": {
      const elemPad = roundUpPad(4, scalarAlignment(shape.elementType));
      return {
        countFieldOffset: absoluteOffset,
        elementsOffset: absoluteOffset + 4 + elemPad,
        maxCount: shape.maxLength,
        unitByteLength: scalarByteWidth(shape.elementType),
      };
    }

    case "BoundedMap": {
      const vAlign = valueAlignment(shape.valueShape);
      const entryAreaPad = roundUpPad(4, Math.max(1, vAlign));
      return {
        countFieldOffset: absoluteOffset,
        elementsOffset: absoluteOffset + 4 + entryAreaPad,
        maxCount: shape.maxEntries,
        unitByteLength: boundedMapEntrySize(shape),
      };
    }
  }
}

export function cloneShape(shape: HotLayoutPlanningShape): HotLayoutPlanningShape {
  switch (shape.kind) {
    case "FixedScalar":
      if (shape.nanSentinel === true) {
        return { kind: "FixedScalar", type: shape.type, nanSentinel: true };
      }

      return { kind: "FixedScalar", type: shape.type };

    case "FixedEnum":
      return { kind: "FixedEnum", variants: [...shape.variants], storage: shape.storage };

    case "FixedVector":
      return { kind: "FixedVector", elementType: shape.elementType, length: shape.length };

    case "FixedStringEncoded":
      return {
        kind: "FixedStringEncoded",
        byteLength: shape.byteLength,
        encoding: shape.encoding,
      };

    case "BoundedArray":
      return { kind: "BoundedArray", elementType: shape.elementType, maxLength: shape.maxLength };

    case "BoundedMap":
      return {
        kind: "BoundedMap",
        keyEncoding: shape.keyEncoding,
        keyByteLength: shape.keyByteLength,
        valueShape: cloneFixedValueShape(shape.valueShape),
        maxEntries: shape.maxEntries,
      };

    case "VariableString":
      return { kind: "VariableString" };

    case "VariableMap":
      return { kind: "VariableMap", valueShape: cloneShape(shape.valueShape) };
  }
}

export function collectShapeIssues(shape: unknown, path: string, issues: HotCodecIssue[]): void {
  if (!isRecord(shape)) {
    issues.push({
      code: "shape.invalid",
      path,
      message: "field shape must be an object",
    });
    return;
  }

  switch (shape.kind) {
    case "FixedScalar":
      validateScalarType(shape.type, `${path}.type`, issues);
      if ("nanSentinel" in shape && shape.nanSentinel !== true && shape.nanSentinel !== undefined) {
        issues.push({
          code: "shape.nanSentinelInvalid",
          path: `${path}.nanSentinel`,
          message: "nanSentinel must be true when present",
        });
      }
      return;

    case "FixedEnum":
      validateStringArray(shape.variants, `${path}.variants`, issues);
      if (Array.isArray(shape.variants) && shape.variants.length > UINT16_MAX) {
        issues.push({
          code: "shape.numericOutOfRange",
          path: `${path}.variants`,
          message: "FixedEnum variant count must fit in u16",
        });
      }
      validateEnumStorage(shape.storage, `${path}.storage`, issues);
      return;

    case "FixedVector":
      validateScalarType(shape.elementType, `${path}.elementType`, issues);
      validatePositiveU32(shape.length, `${path}.length`, issues);
      return;

    case "FixedStringEncoded":
      validatePositiveU16(shape.byteLength, `${path}.byteLength`, issues);
      validateStringEncoding(shape.encoding, `${path}.encoding`, issues);
      return;

    case "BoundedArray":
      validateScalarType(shape.elementType, `${path}.elementType`, issues);
      validatePositiveU32(shape.maxLength, `${path}.maxLength`, issues);
      return;

    case "BoundedMap":
      if (shape.keyEncoding !== "fixed-ascii") {
        issues.push({
          code: "shape.mapKeyEncodingUnsupported",
          path: `${path}.keyEncoding`,
          message: "BoundedMap keyEncoding must be fixed-ascii",
        });
      }
      validatePositiveU16(shape.keyByteLength, `${path}.keyByteLength`, issues);
      validatePositiveU32(shape.maxEntries, `${path}.maxEntries`, issues);
      collectFixedValueShapeIssues(shape.valueShape, `${path}.valueShape`, issues);
      return;

    case "VariableString":
      return;

    case "VariableMap":
      collectShapeIssues(shape.valueShape, `${path}.valueShape`, issues);
      return;

    default:
      issues.push({
        code: "shape.unknownKind",
        path: `${path}.kind`,
        message: "field shape kind is not supported by hot-codec",
      });
  }
}

export function isBoundedShape(
  shape: HotLayoutPlanningShape,
): shape is HotLayoutPlanningBoundedArrayShape | HotLayoutPlanningBoundedMapShape {
  return shape.kind === "BoundedArray" || shape.kind === "BoundedMap";
}

export function isVariableShape(shape: HotLayoutPlanningShape): boolean {
  return shape.kind === "VariableString" || shape.kind === "VariableMap";
}

export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function cloneFixedValueShape(
  shape: HotLayoutPlanningFixedValueShape,
): HotLayoutPlanningFixedValueShape {
  return cloneShape(shape) as HotLayoutPlanningFixedValueShape;
}

function boundedArraySpan(shape: HotLayoutPlanningBoundedArrayShape): number {
  const elemPad = roundUpPad(4, scalarAlignment(shape.elementType));
  return 4 + elemPad + shape.maxLength * scalarByteWidth(shape.elementType);
}

function boundedMapSpan(shape: HotLayoutPlanningBoundedMapShape): number {
  const vAlign = valueAlignment(shape.valueShape);
  const entryAreaPad = roundUpPad(4, Math.max(1, vAlign));
  return 4 + entryAreaPad + shape.maxEntries * boundedMapEntrySize(shape);
}

function boundedMapEntrySize(shape: HotLayoutPlanningBoundedMapShape): number {
  const vAlign = valueAlignment(shape.valueShape);
  const intraPad = roundUpPad(shape.keyByteLength, vAlign);
  const entrySize = shape.keyByteLength + intraPad + valueByteWidth(shape.valueShape);

  if (entrySize % vAlign !== 0) {
    throw new Error("BoundedMap entry size is not divisible by value alignment");
  }

  return entrySize;
}

function valueAlignment(shape: HotLayoutPlanningFixedValueShape): number {
  switch (shape.kind) {
    case "FixedScalar":
      return scalarAlignment(shape.type);

    case "FixedEnum":
      return scalarAlignment(shape.storage);

    case "FixedVector":
      return scalarAlignment(shape.elementType);
  }
}

function valueByteWidth(shape: HotLayoutPlanningFixedValueShape): number {
  switch (shape.kind) {
    case "FixedScalar":
      return scalarByteWidth(shape.type);

    case "FixedEnum":
      return enumByteWidth(shape.storage);

    case "FixedVector":
      return scalarByteWidth(shape.elementType) * shape.length;
  }
}

function scalarAlignment(type: ScalarType): number {
  switch (type) {
    case "bool":
    case "u8":
    case "i8":
      return 1;

    case "u16":
    case "i16":
      return 2;

    case "u32":
    case "i32":
    case "f32":
      return 4;

    case "u64":
    case "i64":
    case "f64":
      return 8;
  }
}

function scalarByteWidth(type: ScalarType): number {
  switch (type) {
    case "bool":
    case "u8":
    case "i8":
      return 1;

    case "u16":
    case "i16":
      return 2;

    case "u32":
    case "i32":
    case "f32":
      return 4;

    case "u64":
    case "i64":
    case "f64":
      return 8;
  }
}

function enumByteWidth(storage: EnumStorageType): number {
  switch (storage) {
    case "u8":
      return 1;

    case "u16":
      return 2;

    case "u32":
      return 4;
  }
}

function collectFixedValueShapeIssues(shape: unknown, path: string, issues: HotCodecIssue[]): void {
  const before = issues.length;
  collectShapeIssues(shape, path, issues);
  if (issues.length > before || !isRecord(shape)) {
    return;
  }

  if (shape.kind !== "FixedScalar" && shape.kind !== "FixedEnum" && shape.kind !== "FixedVector") {
    issues.push({
      code: "shape.mapValueUnsupported",
      path: `${path}.kind`,
      message: "BoundedMap valueShape must be FixedScalar, FixedEnum, or FixedVector",
    });
  }
}

function validateScalarType(value: unknown, path: string, issues: HotCodecIssue[]): void {
  if (
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
  ) {
    return;
  }

  issues.push({
    code: "shape.scalarUnsupported",
    path,
    message: "scalar type is not supported by hot-codec",
  });
}

function validateEnumStorage(value: unknown, path: string, issues: HotCodecIssue[]): void {
  if (value === "u8" || value === "u16" || value === "u32") {
    return;
  }

  issues.push({
    code: "shape.enumStorageUnsupported",
    path,
    message: "FixedEnum storage must be u8, u16, or u32",
  });
}

function validateStringEncoding(value: unknown, path: string, issues: HotCodecIssue[]): void {
  if (value === "utf8" || value === "ascii") {
    return;
  }

  issues.push({
    code: "shape.stringEncodingUnsupported",
    path,
    message: "FixedStringEncoded encoding must be utf8 or ascii",
  });
}

function validateStringArray(value: unknown, path: string, issues: HotCodecIssue[]): void {
  if (!Array.isArray(value) || value.length === 0) {
    issues.push({
      code: "shape.variantsInvalid",
      path,
      message: "FixedEnum variants must be a non-empty string array",
    });
    return;
  }

  for (let index = 0; index < value.length; index += 1) {
    if (typeof value[index] !== "string" || value[index].length === 0) {
      issues.push({
        code: "shape.variantsInvalid",
        path: `${path}.${index}`,
        message: "FixedEnum variants must be non-empty strings",
      });
    }
  }
}

function validatePositiveU16(value: unknown, path: string, issues: HotCodecIssue[]): void {
  if (
    typeof value === "number" &&
    Number.isSafeInteger(value) &&
    value > 0 &&
    value <= UINT16_MAX
  ) {
    return;
  }

  issues.push({
    code: "shape.numericOutOfRange",
    path,
    message: "numeric shape value must be a positive integer that fits in u16",
  });
}

function validatePositiveU32(value: unknown, path: string, issues: HotCodecIssue[]): void {
  if (
    typeof value === "number" &&
    Number.isSafeInteger(value) &&
    value > 0 &&
    value <= UINT32_MAX
  ) {
    return;
  }

  issues.push({
    code: "shape.numericOutOfRange",
    path,
    message: "numeric shape value must be a positive integer that fits in u32",
  });
}
