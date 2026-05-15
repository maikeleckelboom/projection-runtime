import type { HotFieldEntry, HotLayoutManifest, HotReservationEntry } from "../manifest";
import { throwByteIssue } from "./types";

export function assertManifestByteWindow(manifest: HotLayoutManifest): void {
  if (
    !Number.isSafeInteger(manifest.fieldDataOrigin) ||
    !Number.isSafeInteger(manifest.totalRegionByteLength) ||
    manifest.fieldDataOrigin < 0 ||
    manifest.totalRegionByteLength < manifest.fieldDataOrigin
  ) {
    throwByteIssue(
      "byte.layoutInvalid",
      "manifest",
      "hot layout manifest has an invalid field data window",
    );
  }
}

export function inferByteOrigin(manifest: HotLayoutManifest, bytes: Uint8Array): number {
  if (bytes.byteLength === manifest.totalRegionByteLength) {
    return 0;
  }

  const fieldByteLength = manifest.totalRegionByteLength - manifest.fieldDataOrigin;
  if (bytes.byteLength === fieldByteLength) {
    return manifest.fieldDataOrigin;
  }

  throwByteIssue(
    "byte.bytesLengthInvalid",
    "bytes",
    `hot bytes length must be ${manifest.totalRegionByteLength} for a region or ${fieldByteLength} for field data`,
  );
}

export function relativeOffset(
  absoluteOffset: number,
  origin: number,
  byteLength: number,
  dotPath: string,
): number {
  const offset = absoluteOffset - origin;
  if (!Number.isSafeInteger(offset) || offset < 0 || offset >= byteLength) {
    throwByteIssue(
      "byte.layoutInvalid",
      `fields.${dotPath}.absoluteOffset`,
      `field ${dotPath} absolute offset is outside the provided byte window`,
    );
  }

  return offset;
}

export function createReservationMap(
  manifest: HotLayoutManifest,
): Map<string, HotReservationEntry> {
  return new Map(manifest.reservations.map((reservation) => [reservation.dotPath, reservation]));
}

export function reservationFor(
  reservationByPath: ReadonlyMap<string, HotReservationEntry>,
  field: HotFieldEntry,
): HotReservationEntry {
  const reservation = reservationByPath.get(field.dotPath);
  if (reservation === undefined) {
    throwByteIssue(
      "byte.reservationMissing",
      `reservations.${field.dotPath}`,
      `missing hot reservation metadata for ${field.dotPath}`,
    );
  }

  return reservation;
}
