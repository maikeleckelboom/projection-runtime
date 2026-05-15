import {
  bytesToHex,
  decodeHotBlockAHeader,
  encodeHotBlockAHeader,
  type HotBlockAHeaderInput,
  type HotLayoutManifest,
  validateHotBlockAHeader,
} from "@exclave/hot-codec";

import { encodeFixtureJson } from "../encode";
import { createConformanceError } from "../error";
import type { ProjectionRuntimeFixtureFailure } from "../run";
import { appendArtifactComparison } from "./artifact";
import { conformanceFailureFromError } from "./failure";
import { getNumberProperty, getStringProperty, getU64HexProperty, isRecord } from "./shape";

export function appendHotBlockAFixtureComparison(
  failures: ProjectionRuntimeFixtureFailure[],
  expectedHotBlockAFixture: unknown,
  hotLayoutManifest: HotLayoutManifest | undefined,
  resolved: unknown,
): void {
  try {
    appendArtifactComparison(
      failures,
      "hot-block-a-fixture",
      expectedHotBlockAFixture,
      createHotBlockAFixtureArtifact(hotLayoutManifest, resolved, expectedHotBlockAFixture),
    );
  } catch (error) {
    failures.push(
      conformanceFailureFromError(error, "hot-block-a-fixture", expectedHotBlockAFixture),
    );
  }
}

function createHotBlockAFixtureArtifact(
  hotLayoutManifest: HotLayoutManifest | undefined,
  resolved: unknown,
  expectedHotBlockAFixture: unknown,
): unknown {
  if (hotLayoutManifest === undefined) {
    throw createConformanceError("fixtureShapeRejected", {
      artifact: "hot-block-a-fixture",
      detail: "hot-block-a-fixture requires a hot layout manifest",
      failureCode: "missingHotLayoutManifest",
    });
  }
  if (!isRecord(resolved)) {
    throw createConformanceError("fixtureShapeRejected", {
      artifact: "hot-block-a-fixture",
      detail: "hot-block-a-fixture requires resolved contract",
      failureCode: "missingResolvedContract",
    });
  }
  if (!isRecord(expectedHotBlockAFixture)) {
    throw createConformanceError("fixtureShapeRejected", {
      artifact: "hot-block-a-fixture",
      detail: "hot-block-a-fixture must be an object",
      failureCode: "fixtureNotObject",
    });
  }

  const semanticVersion = getU64HexProperty(
    expectedHotBlockAFixture,
    "semanticVersion",
    "expected.semanticVersion",
  );
  const hotLayoutVersion = getU64HexProperty(
    expectedHotBlockAFixture,
    "hotLayoutVersion",
    "expected.hotLayoutVersion",
  );
  const fieldCount = getNumberProperty(
    expectedHotBlockAFixture,
    "fieldCount",
    "expected.fieldCount",
  );
  const mutableRegionByteLength = getNumberProperty(
    expectedHotBlockAFixture,
    "mutableRegionByteLength",
    "expected.mutableRegionByteLength",
  );
  const contractKey = getStringProperty(
    expectedHotBlockAFixture,
    "contractKey",
    "expected.contractKey",
  );
  const instanceKey = getStringProperty(
    expectedHotBlockAFixture,
    "instanceKey",
    "expected.instanceKey",
  );

  const resolvedSemanticVersion = encodeFixtureJson(resolved.semanticVersion);
  if (encodeFixtureJson(semanticVersion) !== resolvedSemanticVersion) {
    throw createConformanceError("fixtureArtifactMismatch", {
      artifact: "hot-block-a-fixture",
      detail: `hot-block-a-fixture semanticVersion mismatch: expected ${encodeFixtureJson(semanticVersion)}, resolved ${resolvedSemanticVersion}`,
      failureCode: "semanticVersionMismatch",
    });
  }

  const manifestHotLayoutVersion = encodeFixtureJson(hotLayoutManifest.hotLayoutVersion);
  if (encodeFixtureJson(hotLayoutVersion) !== manifestHotLayoutVersion) {
    throw createConformanceError("fixtureArtifactMismatch", {
      artifact: "hot-block-a-fixture",
      detail: `hot-block-a-fixture hotLayoutVersion mismatch: expected ${encodeFixtureJson(hotLayoutVersion)}, manifest ${manifestHotLayoutVersion}`,
      failureCode: "hotLayoutVersionMismatch",
    });
  }

  if (fieldCount !== hotLayoutManifest.fields.length) {
    throw createConformanceError("fixtureArtifactMismatch", {
      artifact: "hot-block-a-fixture",
      detail: `hot-block-a-fixture fieldCount mismatch: expected ${fieldCount}, manifest ${hotLayoutManifest.fields.length}`,
      failureCode: "fieldCountMismatch",
    });
  }

  if (mutableRegionByteLength !== hotLayoutManifest.mutableRegionByteLength) {
    throw createConformanceError("fixtureArtifactMismatch", {
      artifact: "hot-block-a-fixture",
      detail: `hot-block-a-fixture mutableRegionByteLength mismatch: expected ${mutableRegionByteLength}, manifest ${hotLayoutManifest.mutableRegionByteLength}`,
      failureCode: "mutableRegionByteLengthMismatch",
    });
  }

  const input: HotBlockAHeaderInput = {
    contractKey,
    instanceKey,
    semanticVersion,
    hotLayoutVersion,
    fieldCount,
    mutableRegionByteLength,
  };

  const blockABytes = encodeHotBlockAHeader(input);
  const decoded = decodeHotBlockAHeader(blockABytes);
  const validation = validateHotBlockAHeader(blockABytes, input);

  if (!validation.ok) {
    throw createConformanceError("fixtureArtifactMismatch", {
      artifact: "hot-block-a-fixture",
      detail: `hot-block-a-fixture validation failed: ${validation.error.message}`,
      failureCode: "headerValidationFailed",
    });
  }

  return {
    fixtureKind: "hot-block-a-fixture",
    contractKey,
    instanceKey,
    semanticVersion,
    hotLayoutVersion,
    fieldCount,
    mutableRegionByteLength,
    expected: {
      blockABytesHex: bytesToHex(blockABytes),
      decoded,
    },
  };
}
