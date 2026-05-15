import type { HotLayoutManifest } from "../manifest";
import { readBoundedArray, writeBoundedArray } from "./bounded-array";
import { readEnum, writeEnum } from "./enum";
import { throwByteIssue } from "./issue";
import { readScalar, writeScalar } from "./scalar";
import { readFixedString, writeFixedString } from "./string";
import type { HotFieldValue, HotFieldValues } from "./types";
import { assertNoUnknownValues, assertValueRecord } from "./value";
import { readVector, writeVector } from "./vector";
import { createReservationMap, relativeOffset } from "./window";

export function writeHotFieldValues(
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
    writeHotFieldValue(view, origin, bytes.byteLength, field, value, reservationByPath, offset);
  }
}

export function readHotFieldValues(
  manifest: HotLayoutManifest,
  bytes: Uint8Array,
  origin: number,
): HotFieldValues {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const reservationByPath = createReservationMap(manifest);
  const values: Record<string, HotFieldValue> = {};

  for (const field of manifest.fields) {
    const offset = relativeOffset(field.absoluteOffset, origin, bytes.byteLength, field.dotPath);
    values[field.dotPath] = readHotFieldValue(
      view,
      origin,
      bytes.byteLength,
      field,
      reservationByPath,
      offset,
    );
  }

  return values;
}

function writeHotFieldValue(
  view: DataView,
  origin: number,
  byteLength: number,
  field: HotLayoutManifest["fields"][number],
  value: HotFieldValue,
  reservationByPath: ReturnType<typeof createReservationMap>,
  offset: number,
): void {
  switch (field.shape.kind) {
    case "FixedScalar":
      writeScalar(view, offset, field.shape.type, value, `values.${field.dotPath}`);
      return;

    case "FixedEnum":
      writeEnum(view, offset, field.shape, value, `values.${field.dotPath}`);
      return;

    case "FixedVector":
      writeVector(view, offset, field.shape, value, `values.${field.dotPath}`);
      return;

    case "FixedStringEncoded":
      writeFixedString(view, offset, field.shape, value, `values.${field.dotPath}`);
      return;

    case "BoundedArray":
      writeBoundedArray(view, origin, byteLength, field, field.shape, value, reservationByPath);
      return;

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

function readHotFieldValue(
  view: DataView,
  origin: number,
  byteLength: number,
  field: HotLayoutManifest["fields"][number],
  reservationByPath: ReturnType<typeof createReservationMap>,
  offset: number,
): HotFieldValue {
  switch (field.shape.kind) {
    case "FixedScalar":
      return readScalar(view, offset, field.shape.type, `values.${field.dotPath}`);

    case "FixedEnum":
      return readEnum(view, offset, field.shape, `values.${field.dotPath}`);

    case "FixedVector":
      return readVector(view, offset, field.shape, `values.${field.dotPath}`);

    case "FixedStringEncoded":
      return readFixedString(view, offset, field.shape, `values.${field.dotPath}`);

    case "BoundedArray":
      return readBoundedArray(view, origin, byteLength, field, field.shape, reservationByPath);

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
