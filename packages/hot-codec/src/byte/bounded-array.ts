import type { HotFieldEntry, HotReservationEntry } from "../manifest";
import type { HotLayoutPlanningBoundedArrayShape } from "../shape";
import { readScalar, writeScalar } from "./scalar";
import type { HotFieldScalarValue, HotFieldValue } from "./types";
import { throwByteIssue } from "./types";
import { requireArray } from "./value";
import { relativeOffset, reservationFor } from "./window";

export function writeBoundedArray(
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

export function readBoundedArray(
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
