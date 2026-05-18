import { createHash } from "node:crypto";

import { AbiCanonicalByteWriter, readU64PrefixBigEndian, writeAbiShapeBytes } from "@exclave/base";

import { compareUtf8 } from "./fields";
import type {
  CanonicalField,
  CanonicalProjectionManifest,
  SemanticVersion,
  WarmCodecManifest,
  WarmCodecVersion,
  WarmFieldEntry,
} from "./manifest";

const WARM_CODEC_CANONICAL_TAGS = [
  "framed-snapshot",
  "little-endian",
  "frame-length:u32-le",
  "contract-key:u32-len-utf8",
  "projection-instance-key:u32-len-utf8",
  "semantic-version:u64-le",
  "warm-codec-version:u64-le",
  "baseline-epoch:u32-le",
  "continuity-generation:u32-le",
  "publication-sequence:u64-le",
  "lane-sequence:optional-u32-le",
  "payload-length:u32-le",
  "variable-string:u32-len-utf8",
  "variable-map-key:u32-len-utf8",
] as const;

export function deriveWarmCodecManifest(
  manifest: CanonicalProjectionManifest,
  semanticVersion: SemanticVersion,
): WarmCodecManifest {
  const fields = warmFieldEntries(manifest);

  return {
    codec: "framed-snapshot",
    contractKey: manifest.key,
    semanticVersion,
    fields,
    warmCodecVersion: deriveWarmCodecVersion(fields),
  };
}

export function deriveWarmCodecVersion(fields: readonly WarmFieldEntry[]): WarmCodecVersion {
  const digest = createHash("sha256").update(canonicalWarmCodecVersionBytes(fields)).digest();
  return readU64PrefixBigEndian(digest);
}

export function canonicalWarmCodecVersionBytes(fields: readonly WarmFieldEntry[]): Uint8Array {
  const writer = new AbiCanonicalByteWriter();

  for (const tag of WARM_CODEC_CANONICAL_TAGS) {
    writer.writeUtf8(tag);
    writer.writeU8(0);
  }

  const sortedFields = sortedWarmFields(fields);
  writer.writeU32Le(sortedFields.length);
  for (const field of sortedFields) {
    writer.writeUtf8(field.dotPath);
    writer.writeU8(0);
    writer.writeU32Le(field.fieldId);
    writeAbiShapeBytes(field.shape, writer);
  }

  return writer.toUint8Array();
}

function warmFieldEntries(manifest: CanonicalProjectionManifest): readonly WarmFieldEntry[] {
  return sortedCanonicalFields(manifest.fields).map((field) => ({
    dotPath: field.dotPath,
    fieldId: field.fieldId,
    shape: field.shape,
  }));
}

function sortedCanonicalFields(fields: readonly CanonicalField[]): readonly CanonicalField[] {
  return [...fields].sort((left, right) => compareUtf8(left.dotPath, right.dotPath));
}

function sortedWarmFields(fields: readonly WarmFieldEntry[]): readonly WarmFieldEntry[] {
  return [...fields].sort((left, right) => compareUtf8(left.dotPath, right.dotPath));
}
