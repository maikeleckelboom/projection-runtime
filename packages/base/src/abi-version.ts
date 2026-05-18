import { panic } from "./panic";

export type AbiScalarType =
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

export type AbiStringEncoding = "utf8" | "ascii";

export type AbiEnumStorageType = "u8" | "u16" | "u32";

export interface AbiByteWriter {
  writeU8(value: number): void;
  writeU16Le(value: number): void;
  writeU32Le(value: number): void;
  writeUtf8(value: string): void;
}

function rejectOutOfRange(value: number, max: number, label: string): void {
  if (!Number.isInteger(value) || value < 0 || value > max) {
    panic(`canonical byte writer: ${label} value out of range: ${value}`);
  }
}

export class AbiCanonicalByteWriter implements AbiByteWriter {
  private readonly chunks: number[] = [];

  writeU8(value: number): void {
    rejectOutOfRange(value, 0xff, "u8");
    this.chunks.push(value);
  }

  writeU16Le(value: number): void {
    rejectOutOfRange(value, 0xffff, "u16");
    this.chunks.push(value & 0xff, (value >>> 8) & 0xff);
  }

  writeU32Le(value: number): void {
    rejectOutOfRange(value, 0xffffffff, "u32");
    this.chunks.push(
      value & 0xff,
      (value >>> 8) & 0xff,
      (value >>> 16) & 0xff,
      (value >>> 24) & 0xff,
    );
  }

  writeUtf8(value: string): void {
    this.chunks.push(...new TextEncoder().encode(value));
  }

  toUint8Array(): Uint8Array {
    return Uint8Array.from(this.chunks);
  }
}

export type AbiShape =
  | AbiFixedScalarShape
  | AbiFixedEnumShape
  | AbiFixedVectorShape
  | AbiBoundedArrayShape
  | AbiBoundedMapShape
  | AbiVariableMapShape
  | AbiFixedStringEncodedShape
  | AbiVariableStringShape;

export interface AbiFixedScalarShape {
  readonly kind: "FixedScalar";
  readonly type: AbiScalarType;
  readonly nanSentinel?: true;
}

export interface AbiFixedEnumShape {
  readonly kind: "FixedEnum";
  readonly storage: AbiEnumStorageType;
  readonly variants: readonly string[];
}

export interface AbiFixedVectorShape {
  readonly kind: "FixedVector";
  readonly elementType: AbiScalarType;
  readonly length: number;
}

export interface AbiBoundedArrayShape {
  readonly kind: "BoundedArray";
  readonly elementType: AbiScalarType;
  readonly maxLength: number;
}

export interface AbiBoundedMapShape {
  readonly kind: "BoundedMap";
  readonly keyByteLength: number;
  readonly maxEntries: number;
  readonly valueShape: AbiShape;
}

export interface AbiVariableMapShape {
  readonly kind: "VariableMap";
  readonly valueShape: AbiShape;
}

export interface AbiFixedStringEncodedShape {
  readonly kind: "FixedStringEncoded";
  readonly byteLength: number;
  readonly encoding: AbiStringEncoding;
}

export interface AbiVariableStringShape {
  readonly kind: "VariableString";
}

const SHAPE_IDS = {
  FixedScalar: 0x01,
  FixedEnum: 0x02,
  FixedVector: 0x03,
  BoundedArray: 0x04,
  BoundedMap: 0x05,
  VariableMap: 0x06,
  FixedStringEncoded: 0x07,
  VariableString: 0x08,
} as const;

const SCALAR_IDS = {
  bool: 0x01,
  u8: 0x02,
  u16: 0x03,
  u32: 0x04,
  u64: 0x05,
  i8: 0x06,
  i16: 0x07,
  i32: 0x08,
  i64: 0x09,
  f32: 0x0a,
  f64: 0x0b,
} as const;

const STRING_ENCODING_IDS = {
  utf8: 0x01,
  ascii: 0x02,
} as const;

export function writeAbiShapeBytes(shape: AbiShape, writer: AbiByteWriter): void {
  switch (shape.kind) {
    case "FixedScalar":
      writer.writeU8(SHAPE_IDS.FixedScalar);
      writer.writeU8(SCALAR_IDS[shape.type]);
      writer.writeU8(shape.nanSentinel === true ? 1 : 0);
      return;

    case "FixedEnum":
      writer.writeU8(SHAPE_IDS.FixedEnum);
      writer.writeU8(SCALAR_IDS[shape.storage]);
      writer.writeU16Le(shape.variants.length);
      for (const variant of shape.variants) {
        writer.writeUtf8(variant);
        writer.writeU8(0);
      }
      return;

    case "FixedVector":
      writer.writeU8(SHAPE_IDS.FixedVector);
      writer.writeU8(SCALAR_IDS[shape.elementType]);
      writer.writeU32Le(shape.length);
      return;

    case "BoundedArray":
      writer.writeU8(SHAPE_IDS.BoundedArray);
      writer.writeU8(SCALAR_IDS[shape.elementType]);
      writer.writeU32Le(shape.maxLength);
      return;

    case "BoundedMap":
      writer.writeU8(SHAPE_IDS.BoundedMap);
      writer.writeU16Le(shape.keyByteLength);
      writer.writeU32Le(shape.maxEntries);
      writeAbiShapeBytes(shape.valueShape, writer);
      return;

    case "VariableMap":
      writer.writeU8(SHAPE_IDS.VariableMap);
      writeAbiShapeBytes(shape.valueShape, writer);
      return;

    case "FixedStringEncoded":
      writer.writeU8(SHAPE_IDS.FixedStringEncoded);
      writer.writeU16Le(shape.byteLength);
      writer.writeU8(STRING_ENCODING_IDS[shape.encoding]);
      return;

    case "VariableString":
      writer.writeU8(SHAPE_IDS.VariableString);
      return;
  }
}

export function readU64PrefixBigEndian(bytes: Uint8Array): bigint {
  let value = 0n;

  for (let index = 0; index < 8; index += 1) {
    const byte = bytes[index];
    if (byte === undefined) {
      panic("SHA-256 digest unexpectedly shorter than 8 bytes");
    }

    value = (value << 8n) | BigInt(byte);
  }

  return value;
}
