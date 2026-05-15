import {
  bytesToHex,
  decodeHotCompleteFixtureRegion,
  encodeHotBlockAHeader,
  encodeHotBlockBHeader,
  encodeHotCompleteFixtureRegion,
  encodeHotFieldValues,
  HOT_BLOCK_A_BYTE_LENGTH,
  HOT_BLOCK_B_BYTE_OFFSET,
  HOT_BLOCK_B_END_OFFSET,
  HOT_FIELD_DATA_BYTE_OFFSET,
  type HotBlockAHeaderInput,
  type HotBlockBHeaderInput,
  type HotFieldValues,
  type HotLayoutManifest,
  hexToBytes,
} from "@seqlok/hot-codec";

import { encodeFixtureJson } from "../encode";
import { createConformanceError } from "../error";
import type { ProjectionRuntimeFixtureFailure } from "../run";
import { appendArtifactComparison } from "./artifact";
import { conformanceFailureFromError } from "./failure";
import {
  getNumberProperty,
  getObjectProperty,
  getStringProperty,
  getU64HexProperty,
  getU64Property,
  isRecord,
} from "./shape";

export function appendHotCompleteFixtureRegionComparison(
  failures: ProjectionRuntimeFixtureFailure[],
  expectedHotCompleteFixtureRegion: unknown,
  expectedHotByteFixture: unknown,
  expectedHotBlockBFixture: unknown,
  hotLayoutManifest: HotLayoutManifest | undefined,
  resolved: unknown,
): void {
  try {
    appendArtifactComparison(
      failures,
      "hot-complete-fixture-region",
      expectedHotCompleteFixtureRegion,
      createHotCompleteFixtureRegionArtifact(
        expectedHotCompleteFixtureRegion,
        expectedHotByteFixture,
        expectedHotBlockBFixture,
        hotLayoutManifest,
        resolved,
      ),
    );
  } catch (error) {
    failures.push(
      conformanceFailureFromError(
        error,
        "hot-complete-fixture-region",
        expectedHotCompleteFixtureRegion,
      ),
    );
  }
}

function createHotCompleteFixtureRegionArtifact(
  expectedHotCompleteFixtureRegion: unknown,
  expectedHotByteFixture: unknown,
  expectedHotBlockBFixture: unknown,
  hotLayoutManifest: HotLayoutManifest | undefined,
  resolved: unknown,
): unknown {
  if (hotLayoutManifest === undefined) {
    throw createConformanceError("fixtureShapeRejected", {
      artifact: "hot-complete-fixture-region",
      detail: "hot-complete-fixture-region requires a hot layout manifest",
      failureCode: "missingHotLayoutManifest",
    });
  }
  if (!isRecord(resolved)) {
    throw createConformanceError("fixtureShapeRejected", {
      artifact: "hot-complete-fixture-region",
      detail: "hot-complete-fixture-region requires resolved contract",
      failureCode: "missingResolvedContract",
    });
  }
  if (!isRecord(expectedHotCompleteFixtureRegion)) {
    throw createConformanceError("fixtureShapeRejected", {
      artifact: "hot-complete-fixture-region",
      detail: "hot-complete-fixture-region must be an object",
      failureCode: "fixtureNotObject",
    });
  }
  if (!isRecord(expectedHotByteFixture)) {
    throw createConformanceError("fixtureShapeRejected", {
      artifact: "hot-complete-fixture-region",
      detail: "hot-byte-fixture must be an object",
      failureCode: "fixtureNotObject",
    });
  }
  if (!isRecord(expectedHotBlockBFixture)) {
    throw createConformanceError("fixtureShapeRejected", {
      artifact: "hot-complete-fixture-region",
      detail: "hot-block-b-fixture must be an object",
      failureCode: "fixtureNotObject",
    });
  }

  const contractKey = getStringProperty(
    expectedHotCompleteFixtureRegion,
    "contractKey",
    "expected.contractKey",
  );
  const instanceKey = getStringProperty(
    expectedHotCompleteFixtureRegion,
    "instanceKey",
    "expected.instanceKey",
  );
  const hotLayoutVersion = getU64HexProperty(
    expectedHotCompleteFixtureRegion,
    "hotLayoutVersion",
    "expected.hotLayoutVersion",
  );
  const totalRegionByteLength = getNumberProperty(
    expectedHotCompleteFixtureRegion,
    "totalRegionByteLength",
    "expected.totalRegionByteLength",
  );
  const blockABytesHex = getStringProperty(
    expectedHotCompleteFixtureRegion,
    "blockABytesHex",
    "expected.blockABytesHex",
  );
  const blockBBytesHex = getStringProperty(
    expectedHotCompleteFixtureRegion,
    "blockBBytesHex",
    "expected.blockBBytesHex",
  );
  const fieldBytesHex = getStringProperty(
    expectedHotCompleteFixtureRegion,
    "fieldBytesHex",
    "expected.fieldBytesHex",
  );
  const completeFixtureRegionBytesHex = getStringProperty(
    expectedHotCompleteFixtureRegion,
    "completeFixtureRegionBytesHex",
    "expected.completeFixtureRegionBytesHex",
  );
  const values = getObjectProperty(expectedHotByteFixture, "values");
  if (!isRecord(values)) {
    throw createConformanceError("fixtureShapeRejected", {
      artifact: "hot-complete-fixture-region",
      detail: "hot-complete-fixture-region requires hot-byte-fixture values",
      failureCode: "valuesNotObject",
    });
  }

  if (contractKey !== hotLayoutManifest.contractKey) {
    throw createConformanceError("fixtureArtifactMismatch", {
      artifact: "hot-complete-fixture-region",
      detail: `hot-complete-fixture-region contractKey mismatch: expected ${contractKey}, manifest ${hotLayoutManifest.contractKey}`,
      failureCode: "artifactMismatch",
    });
  }

  if (
    encodeFixtureJson(hotLayoutVersion) !== encodeFixtureJson(hotLayoutManifest.hotLayoutVersion)
  ) {
    throw createConformanceError("fixtureArtifactMismatch", {
      artifact: "hot-complete-fixture-region",
      detail: "hot-complete-fixture-region hotLayoutVersion mismatch",
      failureCode: "hotLayoutVersionMismatch",
    });
  }

  if (totalRegionByteLength !== hotLayoutManifest.totalRegionByteLength) {
    throw createConformanceError("fixtureArtifactMismatch", {
      artifact: "hot-complete-fixture-region",
      detail: `hot-complete-fixture-region totalRegionByteLength mismatch: expected ${totalRegionByteLength}, manifest ${hotLayoutManifest.totalRegionByteLength}`,
      failureCode: "artifactMismatch",
    });
  }

  const blockA: HotBlockAHeaderInput = {
    contractKey,
    instanceKey,
    semanticVersion: getU64Property(resolved, "semanticVersion", "resolved.semanticVersion"),
    hotLayoutVersion,
    fieldCount: hotLayoutManifest.fields.length,
    mutableRegionByteLength: hotLayoutManifest.mutableRegionByteLength,
  };
  const blockB: HotBlockBHeaderInput = {
    seqlockCounter: getU64HexProperty(
      expectedHotBlockBFixture,
      "seqlockCounter",
      "hotBlockBFixture.seqlockCounter",
    ),
    baselineEpoch: getNumberProperty(
      expectedHotBlockBFixture,
      "baselineEpoch",
      "hotBlockBFixture.baselineEpoch",
    ),
    continuityGeneration: getNumberProperty(
      expectedHotBlockBFixture,
      "continuityGeneration",
      "hotBlockBFixture.continuityGeneration",
    ),
    publicationSequence: getU64HexProperty(
      expectedHotBlockBFixture,
      "publicationSequence",
      "hotBlockBFixture.publicationSequence",
    ),
  };

  const blockABytes = encodeHotBlockAHeader(blockA);
  const blockBBytes = encodeHotBlockBHeader(blockB);
  const normalizedValues = normalizeHotFieldValues(hotLayoutManifest, values as HotFieldValues);
  const encoded = encodeHotFieldValues(hotLayoutManifest, normalizedValues);
  const completeFixtureRegionBytes = encodeHotCompleteFixtureRegion(hotLayoutManifest, {
    blockA,
    blockB,
    values: normalizedValues,
  });
  const expectedBlockABytes = hexToBytes(blockABytesHex);
  const expectedBlockBBytes = hexToBytes(blockBBytesHex);
  const expectedFieldBytes = hexToBytes(fieldBytesHex);
  const expectedCompleteFixtureRegionBytes = hexToBytes(completeFixtureRegionBytesHex);

  if (expectedCompleteFixtureRegionBytes.byteLength !== hotLayoutManifest.totalRegionByteLength) {
    throw createConformanceError("fixtureArtifactMismatch", {
      artifact: "hot-complete-fixture-region",
      detail: `hot-complete-fixture-region byte length mismatch: expected ${hotLayoutManifest.totalRegionByteLength}, got ${expectedCompleteFixtureRegionBytes.byteLength}`,
      failureCode: "artifactMismatch",
    });
  }

  if (
    expectedBlockABytes.byteLength !== HOT_BLOCK_A_BYTE_LENGTH ||
    expectedBlockBBytes.byteLength !== HOT_BLOCK_B_END_OFFSET - HOT_BLOCK_B_BYTE_OFFSET ||
    expectedFieldBytes.byteLength !==
      hotLayoutManifest.totalRegionByteLength - HOT_FIELD_DATA_BYTE_OFFSET
  ) {
    throw createConformanceError("fixtureArtifactMismatch", {
      artifact: "hot-complete-fixture-region",
      detail:
        "hot-complete-fixture-region slice byte lengths do not match Block A + Block B + field layout",
      failureCode: "artifactMismatch",
    });
  }

  if (`${blockABytesHex}${blockBBytesHex}${fieldBytesHex}` !== completeFixtureRegionBytesHex) {
    throw createConformanceError("fixtureArtifactMismatch", {
      artifact: "hot-complete-fixture-region",
      detail:
        "hot-complete-fixture-region complete bytes do not equal Block A + Block B + field bytes",
      failureCode: "artifactMismatch",
    });
  }

  const decodeResult = decodeHotCompleteFixtureRegion(
    hotLayoutManifest,
    expectedCompleteFixtureRegionBytes,
    { expectedContractKey: contractKey, expectedInstanceKey: instanceKey },
  );

  return {
    fixtureKind: "hot-complete-fixture-region",
    contractKey,
    instanceKey,
    hotLayoutVersion,
    totalRegionByteLength,
    blockABytesHex: bytesToHex(blockABytes),
    blockBBytesHex: bytesToHex(blockBBytes),
    fieldBytesHex: bytesToHex(encoded.fieldBytes),
    completeFixtureRegionBytesHex: bytesToHex(completeFixtureRegionBytes),
    decoded: {
      blockA: decodeResult.blockA,
      blockB: decodeResult.blockB,
      fieldValues: decodeResult.fieldValues,
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
    artifact: "hot-complete-fixture-region",
    detail: `${path} must be a 16-character lowercase hex string for a 64-bit hot field`,
    failureCode: "expectedU64Hex",
    path,
  });
}

function parseFixtureBigIntArray(value: unknown, path: string): readonly bigint[] {
  if (!Array.isArray(value)) {
    throw createConformanceError("fixtureShapeRejected", {
      artifact: "hot-complete-fixture-region",
      detail: `${path} must be an array`,
      failureCode: "valuesNotObject",
      path,
    });
  }

  return value.map((entry, index) => parseFixtureBigInt(entry, `${path}.${index}`));
}
