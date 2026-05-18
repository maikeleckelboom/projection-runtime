import { createHash } from "node:crypto";

import { readU64PrefixBigEndian, writeAbiShapeBytes } from "@exclave/base";

import { compareUtf8 } from "./fields";
import type { CanonicalField, CanonicalProjectionManifest, SemanticVersion } from "./manifest";

const FAMILY_REPLACEABLE_SNAPSHOT = 0x01;

export function deriveSemanticVersion(manifest: CanonicalProjectionManifest): SemanticVersion {
  const digest = createHash("sha256").update(canonicalSemanticBytes(manifest)).digest();
  return readU64PrefixBigEndian(digest);
}

export function canonicalSemanticBytes(manifest: CanonicalProjectionManifest): Uint8Array {
  const writer = new ByteWriter();
  writer.writeUtf8(manifest.key);
  writer.writeU8(0);
  writer.writeU8(familyId(manifest.family));
  writer.writeU32Le(manifest.fields.length);

  const fields = [...manifest.fields].sort((left, right) =>
    compareUtf8(left.dotPath, right.dotPath),
  );
  for (const field of fields) {
    writeField(field, writer);
  }

  return writer.toUint8Array();
}

function writeField(field: CanonicalField, writer: ByteWriter): void {
  writer.writeUtf8(field.dotPath);
  writer.writeU8(0);
  writeAbiShapeBytes(field.shape, writer);
}

function familyId(family: CanonicalProjectionManifest["family"]): number {
  switch (family) {
    case "replaceable-snapshot":
      return FAMILY_REPLACEABLE_SNAPSHOT;
  }
}

class ByteWriter {
  private readonly chunks: number[] = [];

  writeU8(value: number): void {
    this.chunks.push(value & 0xff);
  }

  writeU16Le(value: number): void {
    this.writeU8(value);
    this.writeU8(value >> 8);
  }

  writeU32Le(value: number): void {
    this.writeU8(value);
    this.writeU8(value >> 8);
    this.writeU8(value >> 16);
    this.writeU8(value >> 24);
  }

  writeUtf8(value: string): void {
    this.chunks.push(...Buffer.from(value, "utf8"));
  }

  toUint8Array(): Uint8Array {
    return Uint8Array.from(this.chunks);
  }
}
