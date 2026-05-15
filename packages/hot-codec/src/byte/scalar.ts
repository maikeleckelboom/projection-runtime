import { throwByteIssue } from "./issue";
import type { HotFieldScalarValue, HotFieldValue, ScalarType } from "./types";
import { requireBigInt, requireBoolean, requireFiniteNumber, requireInteger } from "./value";

export function writeScalar(
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

export function readScalar(
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

export function scalarByteWidth(type: ScalarType): number {
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
