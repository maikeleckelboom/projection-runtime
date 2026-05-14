import { createHotByteRejectedError, createHotCodecIssue, type HotCodecIssueCode } from "./error";
import type { HotFieldEntry, HotLayoutManifest, HotReservationEntry } from "./manifest";
import type {
  HotLayoutPlanningBoundedArrayShape,
  HotLayoutPlanningFixedEnumShape,
  HotLayoutPlanningFixedScalarShape,
  HotLayoutPlanningFixedStringEncodedShape,
  HotLayoutPlanningFixedVectorShape,
} from "./shape";

type ScalarType = HotLayoutPlanningFixedScalarShape["type"];
type EnumStorageType = HotLayoutPlanningFixedEnumShape["storage"];

export type HotFieldScalarValue = boolean | number | bigint | string;
export type HotFieldValue = HotFieldScalarValue | readonly HotFieldScalarValue[];
export type HotFieldValues = Readonly<Record<string, HotFieldValue>>;

export interface HotByteEncodeResult {
  readonly fieldBytes: Uint8Array;
  readonly fixtureRegionBytes: Uint8Array;
  readonly decodedValues: HotFieldValues;
}

export interface HotByteDecodeResult {
  readonly values: HotFieldValues;
}

export function encodeHotFieldValues(
  manifest: HotLayoutManifest,
  values: HotFieldValues,
): HotByteEncodeResult {
  const fixtureRegionBytes = encodeHotFixtureRegion(manifest, values);
  const fieldBytes = fixtureRegionBytes.slice(
    manifest.fieldDataOrigin,
    manifest.totalRegionByteLength,
  );
  const decodedValues = decodeHotFieldValues(manifest, fixtureRegionBytes).values;

  return { fieldBytes, fixtureRegionBytes, decodedValues };
}

export function encodeHotFieldData(
  manifest: HotLayoutManifest,
  values: HotFieldValues,
): Uint8Array {
  assertManifestByteWindow(manifest);
  const bytes = new Uint8Array(manifest.totalRegionByteLength - manifest.fieldDataOrigin);
  writeHotFieldValues(manifest, values, bytes, manifest.fieldDataOrigin);
  return bytes;
}

export function encodeHotFixtureRegion(
  manifest: HotLayoutManifest,
  values: HotFieldValues,
): Uint8Array {
  assertManifestByteWindow(manifest);
  const bytes = new Uint8Array(manifest.totalRegionByteLength);
  writeHotFieldValues(manifest, values, bytes, 0);
  return bytes;
}

export function decodeHotFieldValues(
  manifest: HotLayoutManifest,
  bytes: Uint8Array,
): HotByteDecodeResult {
  assertManifestByteWindow(manifest);
  const origin = inferByteOrigin(manifest, bytes);
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const reservationByPath = createReservationMap(manifest);
  const values: Record<string, HotFieldValue> = {};

  for (const field of manifest.fields) {
    const offset = relativeOffset(field.absoluteOffset, origin, bytes.byteLength, field.dotPath);

    switch (field.shape.kind) {
      case "FixedScalar":
        values[field.dotPath] = readScalar(
          view,
          offset,
          field.shape.type,
          `values.${field.dotPath}`,
        );
        break;

      case "FixedEnum":
        values[field.dotPath] = readEnum(view, offset, field.shape, `values.${field.dotPath}`);
        break;

      case "FixedVector":
        values[field.dotPath] = readVector(view, offset, field.shape, `values.${field.dotPath}`);
        break;

      case "FixedStringEncoded":
        values[field.dotPath] = readFixedString(
          view,
          offset,
          field.shape,
          `values.${field.dotPath}`,
        );
        break;

      case "BoundedArray":
        values[field.dotPath] = readBoundedArray(
          view,
          origin,
          bytes.byteLength,
          field,
          field.shape,
          reservationByPath,
        );
        break;

      case "BoundedMap":
      case "VariableString":
      case "VariableMap":
        throwByteIssue(
          "byte.shapeUnsupported",
          `fields.${field.dotPath}.shape`,
          `${field.shape.kind} byte encoding is not supported by this hot-codec helper`,
        );
    }
  }

  return { values };
}

export function bytesToHex(bytes: Uint8Array): string {
  let hex = "";
  for (const byte of bytes) {
    hex += byte.toString(16).padStart(2, "0");
  }
  return hex;
}

export function hexToBytes(hex: string): Uint8Array {
  if (!/^(?:[0-9a-f]{2})*$/u.test(hex)) {
    throwByteIssue(
      "byte.hexInvalid",
      "hex",
      "hex bytes must be lowercase, even-length, and contain no prefix or separators",
    );
  }

  const bytes = new Uint8Array(hex.length / 2);
  for (let index = 0; index < bytes.length; index += 1) {
    bytes[index] = Number.parseInt(hex.slice(index * 2, index * 2 + 2), 16);
  }

  return bytes;
}

function writeHotFieldValues(
  manifest: HotLayoutManifest,
  values: HotFieldValues,
  bytes: Uint8Array,
  origin: number,
): void {
  assertValueRecord(values);
  assertNoUnknownValues(manifest, values);

  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const reservationByPath = createReservationMap(manifest);

  for (const field of manifest.fields) {
    const value = values[field.dotPath];
    if (value === undefined) {
      throwByteIssue(
        "byte.valueMissing",
        `values.${field.dotPath}`,
        `missing value for hot field ${field.dotPath}`,
      );
    }

    const offset = relativeOffset(field.absoluteOffset, origin, bytes.byteLength, field.dotPath);

    switch (field.shape.kind) {
      case "FixedScalar":
        writeScalar(view, offset, field.shape.type, value, `values.${field.dotPath}`);
        break;

      case "FixedEnum":
        writeEnum(view, offset, field.shape, value, `values.${field.dotPath}`);
        break;

      case "FixedVector":
        writeVector(view, offset, field.shape, value, `values.${field.dotPath}`);
        break;

      case "FixedStringEncoded":
        writeFixedString(view, offset, field.shape, value, `values.${field.dotPath}`);
        break;

      case "BoundedArray":
        writeBoundedArray(
          view,
          origin,
          bytes.byteLength,
          field,
          field.shape,
          value,
          reservationByPath,
        );
        break;

      case "BoundedMap":
      case "VariableString":
      case "VariableMap":
        throwByteIssue(
          "byte.shapeUnsupported",
          `fields.${field.dotPath}.shape`,
          `${field.shape.kind} byte encoding is not supported by this hot-codec helper`,
        );
    }
  }
}

function assertManifestByteWindow(manifest: HotLayoutManifest): void {
  if (
    !Number.isSafeInteger(manifest.fieldDataOrigin) ||
    !Number.isSafeInteger(manifest.totalRegionByteLength) ||
    manifest.fieldDataOrigin < 0 ||
    manifest.totalRegionByteLength < manifest.fieldDataOrigin
  ) {
    throwByteIssue(
      "byte.layoutInvalid",
      "manifest",
      "hot layout manifest has an invalid field data window",
    );
  }
}

function assertValueRecord(values: HotFieldValues): void {
  if (values === null || typeof values !== "object" || Array.isArray(values)) {
    throwByteIssue("byte.valuesInvalid", "values", "hot field values must be an object");
  }
}

function assertNoUnknownValues(manifest: HotLayoutManifest, values: HotFieldValues): void {
  const fieldPaths = new Set(manifest.fields.map((field) => field.dotPath));

  for (const key of Object.keys(values)) {
    if (!fieldPaths.has(key)) {
      throwByteIssue("byte.valueUnknown", `values.${key}`, `unknown hot field value ${key}`);
    }
  }
}

function inferByteOrigin(manifest: HotLayoutManifest, bytes: Uint8Array): number {
  if (bytes.byteLength === manifest.totalRegionByteLength) {
    return 0;
  }

  const fieldByteLength = manifest.totalRegionByteLength - manifest.fieldDataOrigin;
  if (bytes.byteLength === fieldByteLength) {
    return manifest.fieldDataOrigin;
  }

  throwByteIssue(
    "byte.bytesLengthInvalid",
    "bytes",
    `hot bytes length must be ${manifest.totalRegionByteLength} for a region or ${fieldByteLength} for field data`,
  );
}

function relativeOffset(
  absoluteOffset: number,
  origin: number,
  byteLength: number,
  dotPath: string,
): number {
  const offset = absoluteOffset - origin;
  if (!Number.isSafeInteger(offset) || offset < 0 || offset >= byteLength) {
    throwByteIssue(
      "byte.layoutInvalid",
      `fields.${dotPath}.absoluteOffset`,
      `field ${dotPath} absolute offset is outside the provided byte window`,
    );
  }

  return offset;
}

function createReservationMap(manifest: HotLayoutManifest): Map<string, HotReservationEntry> {
  return new Map(manifest.reservations.map((reservation) => [reservation.dotPath, reservation]));
}

function reservationFor(
  reservationByPath: ReadonlyMap<string, HotReservationEntry>,
  field: HotFieldEntry,
): HotReservationEntry {
  const reservation = reservationByPath.get(field.dotPath);
  if (reservation === undefined) {
    throwByteIssue(
      "byte.reservationMissing",
      `reservations.${field.dotPath}`,
      `missing hot reservation metadata for ${field.dotPath}`,
    );
  }

  return reservation;
}

function writeScalar(
  view: DataView,
  offset: number,
  type: ScalarType,
  value: HotFieldValue,
  path: string,
): void {
  switch (type) {
    case "bool":
      view.setUint8(offset, requireBoolean(value, path) ? 1 : 0);
      return;

    case "u8":
      view.setUint8(offset, requireInteger(value, path, 0, 0xff));
      return;

    case "u16":
      view.setUint16(offset, requireInteger(value, path, 0, 0xffff), true);
      return;

    case "u32":
      view.setUint32(offset, requireInteger(value, path, 0, 0xffff_ffff), true);
      return;

    case "u64":
      view.setBigUint64(offset, requireBigInt(value, path, 0n, 0xffff_ffff_ffff_ffffn), true);
      return;

    case "i8":
      view.setInt8(offset, requireInteger(value, path, -0x80, 0x7f));
      return;

    case "i16":
      view.setInt16(offset, requireInteger(value, path, -0x8000, 0x7fff), true);
      return;

    case "i32":
      view.setInt32(offset, requireInteger(value, path, -0x8000_0000, 0x7fff_ffff), true);
      return;

    case "i64":
      view.setBigInt64(
        offset,
        requireBigInt(value, path, -0x8000_0000_0000_0000n, 0x7fff_ffff_ffff_ffffn),
        true,
      );
      return;

    case "f32":
      view.setFloat32(offset, requireFiniteNumber(value, path), true);
      return;

    case "f64":
      view.setFloat64(offset, requireFiniteNumber(value, path), true);
      return;
  }
}

function readScalar(
  view: DataView,
  offset: number,
  type: ScalarType,
  path: string,
): HotFieldScalarValue {
  switch (type) {
    case "bool": {
      const value = view.getUint8(offset);
      if (value === 0) {
        return false;
      }
      if (value === 1) {
        return true;
      }
      return throwByteIssue("byte.boolInvalid", path, "bool field byte must be 0 or 1");
    }

    case "u8":
      return view.getUint8(offset);

    case "u16":
      return view.getUint16(offset, true);

    case "u32":
      return view.getUint32(offset, true);

    case "u64":
      return view.getBigUint64(offset, true);

    case "i8":
      return view.getInt8(offset);

    case "i16":
      return view.getInt16(offset, true);

    case "i32":
      return view.getInt32(offset, true);

    case "i64":
      return view.getBigInt64(offset, true);

    case "f32":
      return view.getFloat32(offset, true);

    case "f64":
      return view.getFloat64(offset, true);
  }
}

function writeEnum(
  view: DataView,
  offset: number,
  shape: HotLayoutPlanningFixedEnumShape,
  value: HotFieldValue,
  path: string,
): void {
  if (typeof value !== "string") {
    throwByteIssue("byte.valueInvalid", path, "FixedEnum value must be a variant string");
  }

  const ordinal = shape.variants.indexOf(value);
  if (ordinal === -1) {
    throwByteIssue("byte.variantInvalid", path, `invalid FixedEnum variant ${value}`);
  }

  writeEnumOrdinal(view, offset, shape.storage, ordinal, path);
}

function readEnum(
  view: DataView,
  offset: number,
  shape: HotLayoutPlanningFixedEnumShape,
  path: string,
): string {
  const ordinal = readEnumOrdinal(view, offset, shape.storage);
  const variant = shape.variants[ordinal];
  if (variant === undefined) {
    throwByteIssue("byte.variantOrdinalInvalid", path, "FixedEnum ordinal is outside variants");
  }

  return variant;
}

function writeEnumOrdinal(
  view: DataView,
  offset: number,
  storage: EnumStorageType,
  ordinal: number,
  path: string,
): void {
  switch (storage) {
    case "u8":
      view.setUint8(offset, requireInteger(ordinal, path, 0, 0xff));
      return;

    case "u16":
      view.setUint16(offset, requireInteger(ordinal, path, 0, 0xffff), true);
      return;

    case "u32":
      view.setUint32(offset, requireInteger(ordinal, path, 0, 0xffff_ffff), true);
      return;
  }
}

function readEnumOrdinal(view: DataView, offset: number, storage: EnumStorageType): number {
  switch (storage) {
    case "u8":
      return view.getUint8(offset);

    case "u16":
      return view.getUint16(offset, true);

    case "u32":
      return view.getUint32(offset, true);
  }
}

function writeVector(
  view: DataView,
  offset: number,
  shape: HotLayoutPlanningFixedVectorShape,
  value: HotFieldValue,
  path: string,
): void {
  const values = requireArray(value, path);
  if (values.length !== shape.length) {
    throwByteIssue(
      "byte.valueLengthInvalid",
      path,
      `FixedVector value length must be exactly ${shape.length}`,
    );
  }

  const elementByteWidth = scalarByteWidth(shape.elementType);
  for (let index = 0; index < values.length; index += 1) {
    const element = values[index];
    if (element === undefined) {
      throwByteIssue("byte.valueMissing", `${path}.${index}`, "missing FixedVector element");
    }
    writeScalar(
      view,
      offset + index * elementByteWidth,
      shape.elementType,
      element,
      `${path}.${index}`,
    );
  }
}

function readVector(
  view: DataView,
  offset: number,
  shape: HotLayoutPlanningFixedVectorShape,
  path: string,
): readonly HotFieldScalarValue[] {
  const values: HotFieldScalarValue[] = [];
  const elementByteWidth = scalarByteWidth(shape.elementType);

  for (let index = 0; index < shape.length; index += 1) {
    values.push(
      readScalar(view, offset + index * elementByteWidth, shape.elementType, `${path}.${index}`),
    );
  }

  return values;
}

function writeFixedString(
  view: DataView,
  offset: number,
  shape: HotLayoutPlanningFixedStringEncodedShape,
  value: HotFieldValue,
  path: string,
): void {
  if (typeof value !== "string") {
    throwByteIssue("byte.valueInvalid", path, "FixedStringEncoded value must be a string");
  }

  const bytes = encodeFixedStringValue(value, shape.encoding, path);
  if (bytes.byteLength > shape.byteLength) {
    throwByteIssue(
      "byte.valueTooLong",
      path,
      `encoded string length must be <= ${shape.byteLength} bytes`,
    );
  }

  for (let index = 0; index < bytes.byteLength; index += 1) {
    const byte = bytes[index];
    if (byte === undefined) {
      throwByteIssue("byte.valueMissing", `${path}.${index}`, "missing encoded string byte");
    }
    view.setUint8(offset + index, byte);
  }
}

function readFixedString(
  view: DataView,
  offset: number,
  shape: HotLayoutPlanningFixedStringEncodedShape,
  path: string,
): string {
  const bytes = new Uint8Array(view.buffer, view.byteOffset + offset, shape.byteLength);
  let length = bytes.byteLength;
  while (length > 0 && bytes[length - 1] === 0) {
    length -= 1;
  }

  const liveBytes = bytes.subarray(0, length);
  if (shape.encoding === "ascii") {
    return decodeAscii(liveBytes, path);
  }

  try {
    return new TextDecoder("utf-8", { fatal: true }).decode(liveBytes);
  } catch (error) {
    throw createHotByteRejectedError(
      [
        createHotCodecIssue(
          "byte.stringDecodeInvalid",
          path,
          "FixedStringEncoded utf8 bytes are invalid",
        ),
      ],
      error,
    );
  }
}

function writeBoundedArray(
  view: DataView,
  origin: number,
  byteLength: number,
  field: HotFieldEntry,
  shape: HotLayoutPlanningBoundedArrayShape,
  value: HotFieldValue,
  reservationByPath: ReadonlyMap<string, HotReservationEntry>,
): void {
  const path = `values.${field.dotPath}`;
  const values = requireArray(value, path);
  const reservation = reservationFor(reservationByPath, field);

  if (values.length > shape.maxLength || values.length > reservation.maxCount) {
    throwByteIssue(
      "byte.valueLengthInvalid",
      path,
      `BoundedArray value length must be <= ${reservation.maxCount}`,
    );
  }

  const countOffset = relativeOffset(
    reservation.countFieldOffset,
    origin,
    byteLength,
    field.dotPath,
  );
  view.setUint32(countOffset, values.length, true);

  for (let index = 0; index < values.length; index += 1) {
    const element = values[index];
    if (element === undefined) {
      throwByteIssue("byte.valueMissing", `${path}.${index}`, "missing BoundedArray element");
    }

    const elementOffset = relativeOffset(
      reservation.elementsOffset + index * reservation.unitByteLength,
      origin,
      byteLength,
      field.dotPath,
    );
    writeScalar(view, elementOffset, shape.elementType, element, `${path}.${index}`);
  }
}

function readBoundedArray(
  view: DataView,
  origin: number,
  byteLength: number,
  field: HotFieldEntry,
  shape: HotLayoutPlanningBoundedArrayShape,
  reservationByPath: ReadonlyMap<string, HotReservationEntry>,
): readonly HotFieldScalarValue[] {
  const path = `values.${field.dotPath}`;
  const reservation = reservationFor(reservationByPath, field);
  const countOffset = relativeOffset(
    reservation.countFieldOffset,
    origin,
    byteLength,
    field.dotPath,
  );
  const count = view.getUint32(countOffset, true);

  if (count > shape.maxLength || count > reservation.maxCount) {
    throwByteIssue(
      "byte.countInvalid",
      path,
      `BoundedArray count must be <= ${reservation.maxCount}`,
    );
  }

  const values: HotFieldScalarValue[] = [];
  for (let index = 0; index < count; index += 1) {
    const elementOffset = relativeOffset(
      reservation.elementsOffset + index * reservation.unitByteLength,
      origin,
      byteLength,
      field.dotPath,
    );
    values.push(readScalar(view, elementOffset, shape.elementType, `${path}.${index}`));
  }

  return values;
}

function encodeFixedStringValue(
  value: string,
  encoding: "ascii" | "utf8",
  path: string,
): Uint8Array {
  if (encoding === "ascii") {
    const bytes = new Uint8Array(value.length);
    for (let index = 0; index < value.length; index += 1) {
      const codeUnit = value.charCodeAt(index);
      if (codeUnit > 0x7f) {
        throwByteIssue(
          "byte.stringEncodingInvalid",
          path,
          "ascii string contains a non-ascii code unit",
        );
      }
      bytes[index] = codeUnit;
    }
    return bytes;
  }

  return new TextEncoder().encode(value);
}

function decodeAscii(bytes: Uint8Array, path: string): string {
  let value = "";
  for (const byte of bytes) {
    if (byte > 0x7f) {
      throwByteIssue("byte.stringDecodeInvalid", path, "ascii string contains a non-ascii byte");
    }
    value += String.fromCharCode(byte);
  }
  return value;
}

function requireBoolean(value: HotFieldValue, path: string): boolean {
  if (typeof value === "boolean") {
    return value;
  }

  throwByteIssue("byte.valueInvalid", path, "bool value must be a boolean");
}

function requireFiniteNumber(value: HotFieldValue, path: string): number {
  if (typeof value === "number" && Number.isFinite(value)) {
    return value;
  }

  throwByteIssue("byte.valueInvalid", path, "floating scalar value must be a finite number");
}

function requireInteger(value: HotFieldValue, path: string, min: number, max: number): number {
  if (typeof value === "number" && Number.isSafeInteger(value) && value >= min && value <= max) {
    return value;
  }

  throwByteIssue("byte.valueOutOfRange", path, `integer value must be in range [${min}, ${max}]`);
}

function requireBigInt(value: HotFieldValue, path: string, min: bigint, max: bigint): bigint {
  if (typeof value === "bigint" && value >= min && value <= max) {
    return value;
  }

  throwByteIssue("byte.valueOutOfRange", path, `bigint value must be in range [${min}, ${max}]`);
}

function requireArray(value: HotFieldValue, path: string): readonly HotFieldScalarValue[] {
  if (Array.isArray(value)) {
    return value;
  }

  throwByteIssue("byte.valueInvalid", path, "field value must be an array");
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

function throwByteIssue(code: HotCodecIssueCode, path: string, message?: string): never {
  throw createHotByteRejectedError([createHotCodecIssue(code, path, message)]);
}
