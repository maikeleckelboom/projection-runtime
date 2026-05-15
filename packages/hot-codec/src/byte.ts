import { readHotFieldValues, writeHotFieldValues } from "./byte/field";
import type { HotLayoutManifest } from "./manifest";

export { bytesToHex, hexToBytes } from "./byte/hex";
export type {
  HotByteDecodeResult,
  HotByteEncodeResult,
  HotFieldScalarValue,
  HotFieldValue,
  HotFieldValues,
} from "./byte/types";

import type { HotByteDecodeResult, HotByteEncodeResult, HotFieldValues } from "./byte/types";
import { assertManifestByteWindow, inferByteOrigin } from "./byte/window";

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
  return { values: readHotFieldValues(manifest, bytes, origin) };
}
