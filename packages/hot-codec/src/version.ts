import { createHash } from "node:crypto";

import { readU64PrefixBigEndian, writeAbiShapeBytes } from "@exclave/base";

import { createHotCodecIssue, createHotLayoutRejectedError } from "./error";
import type { HotFieldEntry, HotLayoutManifest, HotLayoutVersion } from "./manifest";
import { compareUtf8 } from "./shape";

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
    writeAbiShapeBytes(field.shape, writer);
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

// Hot-codec deliberately preserves hot-codec error identity for out-of-range
// numeric values by throwing hotCodec.layoutRejected rather than using the
// shared base panic. Compiler semantic/warm version writers use the shared
// AbiCanonicalByteWriter from @exclave/base instead.

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

  throw createHotLayoutRejectedError([
    createHotCodecIssue(
      "layout.numericOutOfRange",
      `canonicalHotLayout.${label}`,
      `canonical hot layout ${label} value is out of range`,
    ),
  ]);
}
