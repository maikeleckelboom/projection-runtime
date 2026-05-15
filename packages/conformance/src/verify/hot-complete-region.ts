import { isDeepStrictEqual } from "node:util";

import {
  bytesToHex,
  decodeHotBlockAHeader,
  decodeHotBlockBHeader,
  decodeHotFieldValues,
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
  validateHotBlockAHeader,
  validateHotBlockBHeader,
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
  const encoded = encodeHotFieldValues(hotLayoutManifest, values as HotFieldValues);
  const completeFixtureRegionBytes = encodeHotCompleteFixtureRegion(hotLayoutManifest, {
    blockA,
    blockB,
    values: values as HotFieldValues,
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

  const blockAValidation = validateHotBlockAHeader(
    expectedCompleteFixtureRegionBytes.subarray(0, HOT_BLOCK_A_BYTE_LENGTH),
    blockA,
  );
  if (!blockAValidation.ok) {
    throw createConformanceError("fixtureArtifactMismatch", {
      artifact: "hot-complete-fixture-region",
      detail: `hot-complete-fixture-region Block A validation failed: ${blockAValidation.error.message}`,
      failureCode: "headerValidationFailed",
    });
  }

  const blockBValidation = validateHotBlockBHeader(
    expectedCompleteFixtureRegionBytes.subarray(HOT_BLOCK_B_BYTE_OFFSET, HOT_BLOCK_B_END_OFFSET),
    blockB,
  );
  if (!blockBValidation.ok) {
    throw createConformanceError("fixtureArtifactMismatch", {
      artifact: "hot-complete-fixture-region",
      detail: `hot-complete-fixture-region Block B validation failed: ${blockBValidation.error.message}`,
      failureCode: "headerValidationFailed",
    });
  }

  const decodedFieldValues = decodeHotFieldValues(hotLayoutManifest, expectedFieldBytes).values;
  const decodedFieldValuesFromComplete = decodeHotFieldValues(
    hotLayoutManifest,
    expectedCompleteFixtureRegionBytes.subarray(
      HOT_FIELD_DATA_BYTE_OFFSET,
      hotLayoutManifest.totalRegionByteLength,
    ),
  ).values;

  if (
    !isDeepStrictEqual(
      encodeFixtureJson(decodedFieldValues),
      encodeFixtureJson(decodedFieldValuesFromComplete),
    )
  ) {
    throw createConformanceError("fixtureArtifactMismatch", {
      artifact: "hot-complete-fixture-region",
      detail: "hot-complete-fixture-region field and complete-region field slice decoding diverged",
      failureCode: "fieldRegionDecodeDiverged",
    });
  }

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
      blockA: decodeHotBlockAHeader(
        expectedCompleteFixtureRegionBytes.subarray(0, HOT_BLOCK_A_BYTE_LENGTH),
      ),
      blockB: decodeHotBlockBHeader(
        expectedCompleteFixtureRegionBytes.subarray(
          HOT_BLOCK_B_BYTE_OFFSET,
          HOT_BLOCK_B_END_OFFSET,
        ),
      ),
      fieldValues: decodedFieldValues,
    },
  };
}
