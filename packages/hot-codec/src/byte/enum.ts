import type { HotLayoutPlanningFixedEnumShape } from "../shape";
import type { EnumStorageType, HotFieldValue } from "./types";
import { throwByteIssue } from "./types";
import { requireInteger } from "./value";

export function writeEnum(
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

export function readEnum(
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
