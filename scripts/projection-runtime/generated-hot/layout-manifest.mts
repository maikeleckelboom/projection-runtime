import { readFile } from "node:fs/promises";
import {
  dotPathToPropertyName,
  dotPathToSymbolName,
  isSafeDotPath,
  isSafeFixtureName,
  isSafeGeneratedPropertyNameFromDotPath,
  isSafeSymbolStem,
} from "./identifiers.mts";
import {
  type GeneratedHotScalarTypeV0,
  isGeneratedHotScalarTypeV0,
  scalarByteWidth,
} from "./scalars-v0.mts";
import { assertNever } from "./source.mts";

export type EnumStorageType = "u8";

export type FixedScalarShape = {
  readonly kind: "FixedScalar";
  readonly type: GeneratedHotScalarTypeV0;
};

export type FixedEnumShape = {
  readonly kind: "FixedEnum";
  readonly storage: EnumStorageType;
  readonly variants: readonly string[];
};

export type FixedStringEncodedShape = {
  readonly kind: "FixedStringEncoded";
  readonly byteLength: number;
  readonly encoding: "ascii";
};

export type FixedVectorShape = {
  readonly kind: "FixedVector";
  readonly elementType: GeneratedHotScalarTypeV0;
  readonly length: number;
};

export type BoundedArrayShape = {
  readonly kind: "BoundedArray";
  readonly elementType: GeneratedHotScalarTypeV0;
  readonly maxLength: number;
};

export type SupportedFieldShape =
  | FixedScalarShape
  | FixedEnumShape
  | FixedStringEncodedShape
  | FixedVectorShape
  | BoundedArrayShape;

export type HotFieldEntry = {
  readonly dotPath: string;
  readonly absoluteOffset: number;
  readonly byteSpan: number;
  readonly shape: SupportedFieldShape;
};

export type HotReservationEntry = {
  readonly dotPath: string;
  readonly countFieldOffset: number;
  readonly elementsOffset: number;
  readonly maxCount: number;
  readonly unitByteLength: number;
};

export type HotLayoutManifest = {
  readonly blockASize: number;
  readonly blockBStartOffset: number;
  readonly baselineEpochOffset: number;
  readonly continuityGenOffset: number;
  readonly contractKey: string;
  readonly fieldDataOrigin: number;
  readonly hotAbiVersion: number;
  readonly hotLayoutVersion: string;
  readonly seqlockOffset: number;
  readonly publicationSeqOffset: number;
  readonly totalRegionByteLength: number;
  readonly fields: readonly HotFieldEntry[];
  readonly reservations: readonly HotReservationEntry[];
  readonly mutableRegionByteLength: number;
};

export async function readHotLayoutManifest(path: string): Promise<HotLayoutManifest> {
  const parsed: unknown = JSON.parse(await readFile(path, "utf8"));

  if (!isRecord(parsed)) {
    throw new Error(`${path} must contain an object manifest`);
  }

  const seqlockOffset = parsed.seqlockOffset;
  const publicationSeqOffset = parsed.publicationSeqOffset;
  const totalRegionByteLength = parsed.totalRegionByteLength;
  const blockASize = parsed.blockASize;
  const blockBStartOffset = parsed.blockBStartOffset;
  const baselineEpochOffset = parsed.baselineEpochOffset;
  const continuityGenOffset = parsed.continuityGenOffset;
  const contractKey = parsed.contractKey;
  const fieldDataOrigin = parsed.fieldDataOrigin;
  const hotAbiVersion = parsed.hotAbiVersion;
  const hotLayoutVersion = parsed.hotLayoutVersion;
  const fields = parsed.fields;
  const reservations = parsed.reservations;
  const mutableRegionByteLength = parsed.mutableRegionByteLength;

  if (
    typeof contractKey !== "string" ||
    typeof hotAbiVersion !== "number" ||
    !Number.isSafeInteger(hotAbiVersion) ||
    typeof hotLayoutVersion !== "string" ||
    typeof seqlockOffset !== "number" ||
    typeof publicationSeqOffset !== "number" ||
    typeof totalRegionByteLength !== "number" ||
    typeof blockASize !== "number" ||
    typeof blockBStartOffset !== "number" ||
    typeof baselineEpochOffset !== "number" ||
    typeof continuityGenOffset !== "number" ||
    typeof fieldDataOrigin !== "number" ||
    !Array.isArray(fields) ||
    !Array.isArray(reservations) ||
    typeof mutableRegionByteLength !== "number" ||
    !Number.isSafeInteger(mutableRegionByteLength)
  ) {
    throw new Error(`${path} is not a supported hot layout manifest`);
  }

  return {
    blockASize,
    blockBStartOffset,
    baselineEpochOffset,
    continuityGenOffset,
    contractKey,
    fieldDataOrigin,
    hotAbiVersion,
    hotLayoutVersion,
    seqlockOffset,
    publicationSeqOffset,
    totalRegionByteLength,
    mutableRegionByteLength,
    fields: fields.map((field: unknown, index: number) => readHotField(field, path, index)),
    reservations: reservations.map((reservation: unknown, index: number) =>
      readHotReservation(reservation, path, index),
    ),
  };
}

function readHotField(value: unknown, path: string, index: number): HotFieldEntry {
  if (!isRecord(value)) {
    throw new Error(`${path}.fields.${index} must be an object`);
  }

  const dotPath = value.dotPath;
  const absoluteOffset = value.absoluteOffset;
  const byteSpan = value.byteSpan;
  const shape = value.shape;

  if (typeof dotPath !== "string" || !isSafeDotPath(dotPath)) {
    throw new Error(
      `${path}.fields.${index}.dotPath is not supported by generated hot artifact v0`,
    );
  }

  if (typeof absoluteOffset !== "number" || typeof byteSpan !== "number") {
    throw new Error(`${path}.fields.${index} is missing required layout data`);
  }

  return {
    dotPath,
    absoluteOffset,
    byteSpan,
    shape: readSupportedShape(shape, `${path}.fields.${index}.shape`),
  };
}

function readHotReservation(value: unknown, path: string, index: number): HotReservationEntry {
  if (!isRecord(value)) {
    throw new Error(`${path}.reservations.${index} must be an object`);
  }

  const dotPath = value.dotPath;
  const countFieldOffset = value.countFieldOffset;
  const elementsOffset = value.elementsOffset;
  const maxCount = value.maxCount;
  const unitByteLength = value.unitByteLength;

  if (
    typeof dotPath !== "string" ||
    !isSafeDotPath(dotPath) ||
    typeof countFieldOffset !== "number" ||
    typeof elementsOffset !== "number" ||
    typeof maxCount !== "number" ||
    typeof unitByteLength !== "number"
  ) {
    throw new Error(`${path}.reservations.${index} is not a supported reservation`);
  }

  return {
    dotPath,
    countFieldOffset,
    elementsOffset,
    maxCount,
    unitByteLength,
  };
}

function readSupportedShape(value: unknown, path: string): SupportedFieldShape {
  if (!isRecord(value)) {
    throw new Error(`${path} must be an object`);
  }

  switch (value.kind) {
    case "FixedScalar":
      if (!isGeneratedHotScalarTypeV0(value.type)) {
        throw new Error(`${path}.type is not supported by generated hot artifact v0`);
      }
      return { kind: "FixedScalar", type: value.type };

    case "FixedEnum":
      if (
        value.storage !== "u8" ||
        !Array.isArray(value.variants) ||
        !value.variants.every((variant: unknown) => typeof variant === "string")
      ) {
        throw new Error(`${path} is not a supported fixed enum shape`);
      }
      return {
        kind: "FixedEnum",
        storage: value.storage,
        variants: value.variants as readonly string[],
      };

    case "FixedStringEncoded":
      if (typeof value.byteLength !== "number" || value.encoding !== "ascii") {
        throw new Error(`${path} is not a supported fixed string shape`);
      }
      return {
        kind: "FixedStringEncoded",
        byteLength: value.byteLength,
        encoding: value.encoding,
      };

    case "FixedVector":
      if (!isGeneratedHotScalarTypeV0(value.elementType) || typeof value.length !== "number") {
        throw new Error(`${path} is not a supported fixed vector shape`);
      }
      return {
        kind: "FixedVector",
        elementType: value.elementType,
        length: value.length,
      };

    case "BoundedArray":
      if (!isGeneratedHotScalarTypeV0(value.elementType) || typeof value.maxLength !== "number") {
        throw new Error(`${path} is not a supported bounded array shape`);
      }
      return {
        kind: "BoundedArray",
        elementType: value.elementType,
        maxLength: value.maxLength,
      };

    default:
      throw new Error(`${path} is not supported by generated hot artifact v0`);
  }
}

export function validateHotLayoutManifest(
  manifest: HotLayoutManifest,
  path: string,
  options: {
    readonly getGeneratedConstantNames: (field: HotFieldEntry) => readonly string[];
    readonly extraRootConstantNames?: readonly string[];
  },
): void {
  requireSafePositiveInteger(manifest.totalRegionByteLength, `${path}.totalRegionByteLength`);
  requireSafeNonNegativeInteger(manifest.seqlockOffset, `${path}.seqlockOffset`);
  requireRangeEnd(
    manifest.seqlockOffset,
    8,
    manifest.totalRegionByteLength,
    `${path}.seqlockOffset`,
  );

  const fieldNames = new Set<string>();
  const boundedArrayFields = new Map<string, HotFieldEntry>();
  const generatedPropertyNames = new Set<string>();
  const generatedSymbolNames = new Set<string>();
  const generatedConstantNames = new Set<string>([
    ...(options.extraRootConstantNames ?? []),
    "SEQLOCK_OFFSET",
    "TOTAL_REGION_BYTE_LENGTH",
    "U64_BYTE_ALIGNMENT",
  ]);

  for (const [index, field] of manifest.fields.entries()) {
    const fieldPath = `${path}.fields.${index}`;

    requireSafeNonNegativeInteger(field.absoluteOffset, `${fieldPath}.absoluteOffset`);
    requireSafeNonNegativeInteger(field.byteSpan, `${fieldPath}.byteSpan`);
    requireRangeEnd(
      field.absoluteOffset,
      field.byteSpan,
      manifest.totalRegionByteLength,
      fieldPath,
    );

    if (fieldNames.has(field.dotPath)) {
      throw new Error(`${fieldPath}.dotPath duplicates ${field.dotPath}`);
    }
    fieldNames.add(field.dotPath);

    if (!isSafeGeneratedPropertyNameFromDotPath(field.dotPath)) {
      throw new Error(`${fieldPath}.dotPath is not a safe generated TS property name`);
    }

    const derivedPropertyName = dotPathToPropertyName(field.dotPath);
    if (generatedPropertyNames.has(derivedPropertyName)) {
      throw new Error(
        `${fieldPath}.dotPath derives to property name '${derivedPropertyName}' that conflicts with another field`,
      );
    }
    generatedPropertyNames.add(derivedPropertyName);

    const derivedSymbolName = dotPathToSymbolName(field.dotPath);
    if (generatedSymbolNames.has(derivedSymbolName)) {
      throw new Error(
        `${fieldPath}.dotPath derives to symbol name '${derivedSymbolName}' that conflicts with another field`,
      );
    }
    generatedSymbolNames.add(derivedSymbolName);

    validateFieldShape(field, fieldPath);

    for (const constantName of options.getGeneratedConstantNames(field)) {
      if (generatedConstantNames.has(constantName)) {
        throw new Error(`${fieldPath} generates duplicate constant ${constantName}`);
      }
      generatedConstantNames.add(constantName);
    }

    if (field.shape.kind === "BoundedArray") {
      boundedArrayFields.set(field.dotPath, field);
    }
  }

  for (const [index, reservation] of manifest.reservations.entries()) {
    const reservationPath = `${path}.reservations.${index}`;

    validateReservation(reservation, manifest.totalRegionByteLength, reservationPath);

    const field = boundedArrayFields.get(reservation.dotPath);
    if (field === undefined) {
      throw new Error(`${reservationPath}.dotPath does not belong to a BoundedArray field`);
    }

    validateBoundedArrayReservation(field, reservation, reservationPath);
  }

  for (const [dotPath, field] of boundedArrayFields) {
    const matches = manifest.reservations.filter((reservation) => reservation.dotPath === dotPath);

    if (matches.length !== 1 || matches[0] === undefined) {
      throw new Error(`${path}.reservations must contain exactly one ${dotPath} reservation`);
    }

    validateBoundedArrayReservation(field, matches[0], `${path}.reservations.${dotPath}`);
  }
}

export function validateFieldShape(field: HotFieldEntry, path: string): void {
  switch (field.shape.kind) {
    case "FixedScalar":
      requireByteSpan(field, scalarByteWidth(field.shape.type));
      return;

    case "FixedEnum":
      requireByteSpan(field, 1);
      if (field.shape.variants.length === 0) {
        throw new Error(`${path}.shape.variants must not be empty`);
      }
      if (field.shape.variants.length > 256) {
        throw new Error(`${path}.shape.variants must fit in u8 storage`);
      }
      if (new Set(field.shape.variants).size !== field.shape.variants.length) {
        throw new Error(`${path}.shape.variants must be unique`);
      }
      return;

    case "FixedStringEncoded":
      requireSafePositiveInteger(field.shape.byteLength, `${path}.shape.byteLength`);
      requireByteSpan(field, field.shape.byteLength);
      return;

    case "FixedVector":
      requireSafePositiveInteger(field.shape.length, `${path}.shape.length`);
      requireByteSpan(field, field.shape.length * scalarByteWidth(field.shape.elementType));
      return;

    case "BoundedArray":
      requireSafePositiveInteger(field.shape.maxLength, `${path}.shape.maxLength`);
      return;

    default:
      assertNever(field.shape, `${path}.shape is not supported`);
  }
}

export function validateReservation(
  reservation: HotReservationEntry,
  totalRegionByteLength: number,
  path: string,
): void {
  requireSafeNonNegativeInteger(reservation.countFieldOffset, `${path}.countFieldOffset`);
  requireSafeNonNegativeInteger(reservation.elementsOffset, `${path}.elementsOffset`);
  requireSafePositiveInteger(reservation.maxCount, `${path}.maxCount`);
  requireSafePositiveInteger(reservation.unitByteLength, `${path}.unitByteLength`);
  requireRangeEnd(reservation.countFieldOffset, 4, totalRegionByteLength, path);

  const byteSpan = reservation.maxCount * reservation.unitByteLength;
  if (!Number.isSafeInteger(byteSpan)) {
    throw new Error(`${path} reservation element byte span must be a safe integer`);
  }
  requireRangeEnd(reservation.elementsOffset, byteSpan, totalRegionByteLength, path);
}

export function validateBoundedArrayReservation(
  field: HotFieldEntry,
  reservation: HotReservationEntry,
  path: string,
): void {
  if (field.shape.kind !== "BoundedArray") {
    throw new Error(`${path}.dotPath does not belong to a BoundedArray field`);
  }

  const unitByteLength = scalarByteWidth(field.shape.elementType);

  if (reservation.countFieldOffset !== field.absoluteOffset) {
    throw new Error(`${path}.countFieldOffset must match ${field.dotPath} field absoluteOffset`);
  }

  if (reservation.maxCount !== field.shape.maxLength) {
    throw new Error(`${path}.maxCount must match ${field.dotPath} maxLength`);
  }

  if (reservation.unitByteLength !== unitByteLength) {
    throw new Error(`${path}.unitByteLength must match ${field.dotPath} element byte width`);
  }

  const fieldStart = field.absoluteOffset;
  const fieldEnd = field.absoluteOffset + field.byteSpan;
  const countEnd = reservation.countFieldOffset + 4;
  const elementsEnd =
    reservation.elementsOffset + reservation.maxCount * reservation.unitByteLength;

  if (
    !Number.isSafeInteger(fieldEnd) ||
    !Number.isSafeInteger(countEnd) ||
    !Number.isSafeInteger(elementsEnd)
  ) {
    throw new Error(`${path} bounded array byte windows must be safe integers`);
  }

  if (
    reservation.countFieldOffset < fieldStart ||
    countEnd > fieldEnd ||
    reservation.elementsOffset < fieldStart ||
    elementsEnd > fieldEnd
  ) {
    throw new Error(
      `${path} reservation byte window must stay inside ${field.dotPath} field window`,
    );
  }
}

export function reservationFor(
  manifest: HotLayoutManifest,
  field: HotFieldEntry,
): HotReservationEntry {
  const matches = manifest.reservations.filter(
    (reservation) => reservation.dotPath === field.dotPath,
  );

  if (matches.length !== 1 || matches[0] === undefined) {
    throw new Error(`${field.dotPath} must have exactly one reservation`);
  }

  return matches[0];
}

export function requireByteSpan(field: HotFieldEntry, expected: number): void {
  if (field.byteSpan !== expected) {
    throw new Error(`${field.dotPath} byteSpan must be ${expected}`);
  }
}

export function requireSafePositiveInteger(value: number, path: string): void {
  if (!Number.isSafeInteger(value) || value <= 0) {
    throw new Error(`${path} must be a safe positive integer`);
  }
}

export function requireSafeNonNegativeInteger(value: number, path: string): void {
  if (!Number.isSafeInteger(value) || value < 0) {
    throw new Error(`${path} must be a safe non-negative integer`);
  }
}

export function requireRangeEnd(
  offset: number,
  byteSpan: number,
  totalRegionByteLength: number,
  path: string,
): void {
  const end = offset + byteSpan;
  if (!Number.isSafeInteger(end) || end > totalRegionByteLength) {
    throw new Error(`${path} byte range exceeds totalRegionByteLength`);
  }
}

export function validateGeneratedArtifactProfile({
  fixtureName,
  symbolStem,
  generatedFromPath,
}: {
  readonly fixtureName: string;
  readonly symbolStem: string;
  readonly generatedFromPath: string;
}): void {
  if (!isSafeFixtureName(fixtureName)) {
    throw new Error(`${fixtureName} is not a safe generated hot artifact fixture name`);
  }

  if (!isSafeSymbolStem(symbolStem)) {
    throw new Error(`${fixtureName} symbolStem is not a safe generated TS symbol stem`);
  }

  if (generatedFromPath.includes("\n") || generatedFromPath.includes("\r")) {
    throw new Error(`${fixtureName} generatedFromPath must fit on one generated comment line`);
  }
}

export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
