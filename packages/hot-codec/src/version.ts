import { createHash } from "node:crypto";

import type { HotFieldEntry, HotLayoutManifest, HotLayoutVersion } from "./manifest";
import type { HotLayoutPlanningShape } from "./shape";
import { compareUtf8 } from "./shape";

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

interface HotLayoutVersionInput {
  readonly fields: readonly HotFieldEntry[];
  readonly reservations: readonly HotLayoutManifest["reservations"][number][];
}

export function deriveHotLayoutVersion(input: HotLayoutVersionInput): HotLayoutVersion {
  const digest = createHash("sha256").update(canonicalHotLayoutBytes(input)).digest();
  return readU64PrefixBigEndian(digest);
}

function canonicalHotLayoutBytes(input: HotLayoutVersionInput): Uint8Array {
  const fields = [...input.fields].sort((left, right) => compareUtf8(left.dotPath, right.dotPath));
  const reservations = [...input.reservations].sort((left, right) =>
    compareUtf8(left.dotPath, right.dotPath),
  );
  const writer = new ByteWriter();

  writer.writeUtf8("mapped-fixed");
  writer.writeU8(0);
  writer.writeU32Le(fields.length);

  for (const field of fields) {
    writer.writeUtf8(field.dotPath);
    writer.writeU8(0);
    writer.writeU32Le(field.fieldId);
    writeShape(field.shape, writer);
    writer.writeU32Le(field.absoluteOffset);
  }

  writer.writeU32Le(reservations.length);
  for (const reservation of reservations) {
    writer.writeUtf8(reservation.dotPath);
    writer.writeU8(0);
    writer.writeU32Le(reservation.countFieldOffset);
    writer.writeU32Le(reservation.elementsOffset);
    writer.writeU32Le(reservation.maxCount);
    writer.writeU32Le(reservation.unitByteLength);
  }

  return writer.toUint8Array();
}

function writeShape(shape: HotLayoutPlanningShape, writer: ByteWriter): void {
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
      writeShape(shape.valueShape, writer);
      return;

    case "VariableMap":
      writer.writeU8(SHAPE_IDS.VariableMap);
      writeShape(shape.valueShape, writer);
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

function readU64PrefixBigEndian(bytes: Uint8Array): bigint {
  let value = 0n;

  for (let index = 0; index < 8; index += 1) {
    const byte = bytes[index];
    if (byte === undefined) {
      throw new Error("SHA-256 digest unexpectedly shorter than 8 bytes");
    }

    value = (value << 8n) | BigInt(byte);
  }

  return value;
}

class ByteWriter {
  private readonly chunks: number[] = [];

  writeU8(value: number): void {
    assertUnsignedInteger(value, 0xff, "u8");
    this.chunks.push(value & 0xff);
  }

  writeU16Le(value: number): void {
    assertUnsignedInteger(value, 0xffff, "u16");
    this.writeU8(value & 0xff);
    this.writeU8((value >>> 8) & 0xff);
  }

  writeU32Le(value: number): void {
    assertUnsignedInteger(value, 0xffffffff, "u32");
    this.writeU8(value & 0xff);
    this.writeU8((value >>> 8) & 0xff);
    this.writeU8((value >>> 16) & 0xff);
    this.writeU8((value >>> 24) & 0xff);
  }

  writeUtf8(value: string): void {
    this.chunks.push(...Buffer.from(value, "utf8"));
  }

  toUint8Array(): Uint8Array {
    return Uint8Array.from(this.chunks);
  }
}

function assertUnsignedInteger(value: number, max: number, label: string): void {
  if (Number.isInteger(value) && value >= 0 && value <= max) {
    return;
  }

  throw new RangeError(`canonical hot layout ${label} value is out of range`);
}
