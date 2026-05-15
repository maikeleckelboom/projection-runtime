import { isDeepStrictEqual } from "node:util";

import {
  bytesToHex,
  decodeHotFieldValues,
  encodeHotFieldValues,
  type HotFieldValues,
  type HotLayoutManifest,
} from "@seqlok/hot-codec";

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

  const encoded = encodeHotFieldValues(hotLayoutManifest, values as HotFieldValues);
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
