import { isDeepStrictEqual } from "node:util";

import {
  bytesToHex,
  decodeHotFieldValues,
  encodeHotFieldValues,
  type HotFieldValues,
  type HotLayoutManifest,
} from "@exclave/hot-codec";

import { encodeFixtureJson } from "../encode";
import { createConformanceError } from "../error";
import type { ProjectionRuntimeFixtureFailure } from "../run";
import { appendArtifactComparison } from "./artifact";
import { conformanceFailureFromError } from "./failure";
import { getObjectProperty, isRecord } from "./shape";

export function appendHotByteFixtureComparison(
  failures: ProjectionRuntimeFixtureFailure[],
  expectedHotByteFixture: unknown,
  hotLayoutManifest: HotLayoutManifest | undefined,
): void {
  try {
    appendArtifactComparison(
      failures,
      "hot-byte-fixture",
      expectedHotByteFixture,
      createHotByteFixtureArtifact(hotLayoutManifest, expectedHotByteFixture),
    );
  } catch (error) {
    failures.push(conformanceFailureFromError(error, "hot-byte-fixture", expectedHotByteFixture));
  }
}

function createHotByteFixtureArtifact(
  hotLayoutManifest: HotLayoutManifest | undefined,
  expectedHotByteFixture: unknown,
): unknown {
  if (hotLayoutManifest === undefined) {
    throw createConformanceError("fixtureShapeRejected", {
      artifact: "hot-byte-fixture",
      detail: "hot-byte-fixture requires a hot layout manifest",
      failureCode: "missingHotLayoutManifest",
    });
  }

  const values = getObjectProperty(expectedHotByteFixture, "values");
  if (!isRecord(values)) {
    throw createConformanceError("fixtureShapeRejected", {
      artifact: "hot-byte-fixture",
      detail: "hot-byte-fixture values must be an object",
      failureCode: "valuesNotObject",
    });
  }

  const normalizedValues = normalizeHotFieldValues(hotLayoutManifest, values as HotFieldValues);
  const encoded = encodeHotFieldValues(hotLayoutManifest, normalizedValues);
  const decodedFromField = decodeHotFieldValues(hotLayoutManifest, encoded.fieldBytes).values;
  const decodedFromRegion = decodeHotFieldValues(
    hotLayoutManifest,
    encoded.fixtureRegionBytes,
  ).values;

  if (
    !isDeepStrictEqual(encodeFixtureJson(decodedFromField), encodeFixtureJson(decodedFromRegion))
  ) {
    throw createConformanceError("fixtureArtifactMismatch", {
      artifact: "hot-byte-fixture",
      detail: "hot-byte-fixture field and region decoding diverged",
      failureCode: "fieldRegionDecodeDiverged",
    });
  }

  return {
    fixtureKind: "hot-byte-fixture",
    contractKey: hotLayoutManifest.contractKey,
    hotLayoutVersion: hotLayoutManifest.hotLayoutVersion,
    totalRegionByteLength: hotLayoutManifest.totalRegionByteLength,
    fieldDataOrigin: hotLayoutManifest.fieldDataOrigin,
    values,
    expected: {
      fieldBytesHex: bytesToHex(encoded.fieldBytes),
      fixtureRegionBytesHex: bytesToHex(encoded.fixtureRegionBytes),
      decodedValues: decodedFromRegion,
    },
  };
}

function normalizeHotFieldValues(
  hotLayoutManifest: HotLayoutManifest,
  values: HotFieldValues,
): HotFieldValues {
  return Object.fromEntries(
    Object.entries(values).map(([key, value]) => {
      const field = hotLayoutManifest.fields.find((entry) => entry.dotPath === key);

      if (field?.shape.kind === "FixedScalar" && isBigIntScalar(field.shape.type)) {
        return [key, parseFixtureBigInt(value, `values.${key}`)];
      }

      if (field?.shape.kind === "FixedVector" && isBigIntScalar(field.shape.elementType)) {
        return [key, parseFixtureBigIntArray(value, `values.${key}`)];
      }

      if (field?.shape.kind === "BoundedArray" && isBigIntScalar(field.shape.elementType)) {
        return [key, parseFixtureBigIntArray(value, `values.${key}`)];
      }

      return [key, value];
    }),
  );
}

function isBigIntScalar(type: string): boolean {
  return type === "u64" || type === "i64";
}

function parseFixtureBigInt(value: unknown, path: string): bigint {
  if (typeof value === "bigint") {
    return value;
  }

  if (typeof value === "string" && /^[0-9a-f]{16}$/.test(value)) {
    return BigInt(`0x${value}`);
  }

  throw createConformanceError("fixtureShapeRejected", {
    artifact: "hot-byte-fixture",
    detail: `${path} must be a 16-character lowercase hex string for a 64-bit hot field`,
    failureCode: "expectedU64Hex",
    path,
  });
}

function parseFixtureBigIntArray(value: unknown, path: string): readonly bigint[] {
  if (!Array.isArray(value)) {
    throw createConformanceError("fixtureShapeRejected", {
      artifact: "hot-byte-fixture",
      detail: `${path} must be an array`,
      failureCode: "valuesNotObject",
      path,
    });
  }

  return value.map((entry, index) => parseFixtureBigInt(entry, `${path}.${index}`));
}
