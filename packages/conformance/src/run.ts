import { isDeepStrictEqual } from "node:util";

import { compileAuthoredProjectionContract } from "@seqlok/compiler";
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

import { encodeFixtureJson } from "./encode";
import {
  type ConformanceArtifactName,
  type ConformanceFailureArtifactName,
  type ConformanceFailureCode,
  createConformanceError,
  isConformanceError,
} from "./error";
import {
  listProjectionRuntimeFixtures,
  loadProjectionRuntimeFixture,
  type ProjectionRuntimeFixture,
  type ProjectionRuntimeFixtureArtifacts,
  type ProjectionRuntimeFixtureName,
  type ProjectionRuntimeFixtureRootOptions,
} from "./fixtures";

export type ProjectionRuntimeArtifactName = Exclude<
  ConformanceArtifactName,
  "authored-contract" | "readme"
>;

export type ProjectionRuntimeFixtureFailureArtifact = ConformanceFailureArtifactName;

export interface ProjectionRuntimeFixtureFailure {
  readonly artifact: ProjectionRuntimeFixtureFailureArtifact;
  readonly failureCode: ConformanceFailureCode;
  readonly reason: string;
  readonly expected?: unknown;
  readonly actual?: unknown;
  readonly fixtureFile?: string;
  readonly relativePath?: string;
}

export interface ProjectionRuntimeFixtureResult {
  readonly fixtureName: string;
  readonly fixturePath: string;
  readonly passed: boolean;
  readonly failures: readonly ProjectionRuntimeFixtureFailure[];
}

export interface ProjectionRuntimeConformanceResult {
  readonly passed: boolean;
  readonly totalCount: number;
  readonly passedCount: number;
  readonly failedCount: number;
  readonly fixtures: readonly ProjectionRuntimeFixtureResult[];
}

export interface RunProjectionRuntimeFixtureOptions extends ProjectionRuntimeFixtureRootOptions {
  readonly expectedArtifacts?: Partial<
    Pick<
      ProjectionRuntimeFixtureArtifacts,
      | "canonicalManifest"
      | "hotByteFixture"
      | "hotBlockAFixture"
      | "hotBlockBFixture"
      | "hotCompleteFixtureRegion"
      | "hotLayoutManifest"
      | "resolvedContract"
    >
  >;
}

type AuthoredProjectionContractInput = Parameters<typeof compileAuthoredProjectionContract>[0];

export async function runProjectionRuntimeFixture(
  fixture: ProjectionRuntimeFixtureName | ProjectionRuntimeFixture,
  options: RunProjectionRuntimeFixtureOptions = {},
): Promise<ProjectionRuntimeFixtureResult> {
  let loadedFixture: ProjectionRuntimeFixture;

  try {
    loadedFixture =
      typeof fixture === "string" ? await loadProjectionRuntimeFixture(fixture, options) : fixture;
  } catch (error) {
    return fixtureFileFailureResult(fixture, error);
  }

  const artifacts = loadedFixture.artifacts;
  const expectedCanonicalManifest =
    options.expectedArtifacts?.canonicalManifest ?? artifacts.canonicalManifest;
  const expectedHotByteFixture =
    options.expectedArtifacts?.hotByteFixture ?? artifacts.hotByteFixture;
  const expectedHotBlockAFixture =
    options.expectedArtifacts?.hotBlockAFixture ?? artifacts.hotBlockAFixture;
  const expectedHotBlockBFixture =
    options.expectedArtifacts?.hotBlockBFixture ?? artifacts.hotBlockBFixture;
  const expectedHotCompleteFixtureRegion =
    options.expectedArtifacts?.hotCompleteFixtureRegion ?? artifacts.hotCompleteFixtureRegion;
  const expectedHotLayoutManifest =
    options.expectedArtifacts?.hotLayoutManifest ?? artifacts.hotLayoutManifest;
  const expectedResolvedContract =
    options.expectedArtifacts?.resolvedContract ?? artifacts.resolvedContract;

  const compileResult = compileAuthoredProjectionContract(
    artifacts.authoredContract as AuthoredProjectionContractInput,
  );
  if (!compileResult.ok) {
    return {
      fixtureName: loadedFixture.fixtureName,
      fixturePath: loadedFixture.fixturePath,
      passed: false,
      failures: [
        {
          artifact: "compile",
          failureCode: "compilerRejected",
          reason: "compiler rejected authored-contract.json",
          actual: compileResult.error.details.issues,
        },
      ],
    };
  }

  const resolved = compileResult.value;
  const hotLayoutManifest = resolved.laneManifests?.hot;
  const failures: ProjectionRuntimeFixtureFailure[] = [];

  appendArtifactComparison(
    failures,
    "canonical-manifest",
    expectedCanonicalManifest,
    resolved.manifest,
  );
  appendArtifactComparison(
    failures,
    "hot-layout-manifest",
    expectedHotLayoutManifest,
    hotLayoutManifest,
  );
  appendHotByteFixtureComparison(failures, expectedHotByteFixture, hotLayoutManifest);
  appendHotBlockAFixtureComparison(failures, expectedHotBlockAFixture, hotLayoutManifest, resolved);
  appendHotBlockBFixtureComparison(failures, expectedHotBlockBFixture);
  appendHotCompleteFixtureRegionComparison(
    failures,
    expectedHotCompleteFixtureRegion,
    expectedHotByteFixture,
    expectedHotBlockBFixture,
    hotLayoutManifest,
    resolved,
  );
  appendArtifactComparison(failures, "resolved-contract", expectedResolvedContract, resolved);
  appendHotLayoutVersionCheck(failures, "expected", expectedResolvedContract);
  appendHotLayoutVersionCheck(failures, "actual", resolved);

  return {
    fixtureName: loadedFixture.fixtureName,
    fixturePath: loadedFixture.fixturePath,
    passed: failures.length === 0,
    failures,
  };
}

export async function runProjectionRuntimeConformance(
  options: ProjectionRuntimeFixtureRootOptions = {},
): Promise<ProjectionRuntimeConformanceResult> {
  const fixtureNames = await listProjectionRuntimeFixtures(options);
  const fixtures: ProjectionRuntimeFixtureResult[] = [];

  for (const fixtureName of fixtureNames) {
    fixtures.push(await runProjectionRuntimeFixture(fixtureName, options));
  }

  const passedCount = fixtures.filter((fixture) => fixture.passed).length;
  const failedCount = fixtures.length - passedCount;

  return {
    passed: failedCount === 0,
    totalCount: fixtures.length,
    passedCount,
    failedCount,
    fixtures,
  };
}

function appendArtifactComparison(
  failures: ProjectionRuntimeFixtureFailure[],
  artifact: ProjectionRuntimeArtifactName,
  expectedValue: unknown,
  actualValue: unknown,
): void {
  const expected = encodeFixtureJson(expectedValue);
  const actual = encodeFixtureJson(actualValue);

  if (isDeepStrictEqual(actual, expected)) {
    return;
  }

  failures.push({
    artifact,
    failureCode: "artifactMismatch",
    reason: `${artifact} does not match golden artifact`,
    expected,
    actual,
  });
}

function appendHotByteFixtureComparison(
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

function appendHotBlockAFixtureComparison(
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

function appendHotBlockBFixtureComparison(
  failures: ProjectionRuntimeFixtureFailure[],
  expectedHotBlockBFixture: unknown,
): void {
  try {
    appendArtifactComparison(
      failures,
      "hot-block-b-fixture",
      expectedHotBlockBFixture,
      createHotBlockBFixtureArtifact(expectedHotBlockBFixture),
    );
  } catch (error) {
    failures.push(
      conformanceFailureFromError(error, "hot-block-b-fixture", expectedHotBlockBFixture),
    );
  }
}

function createHotBlockBFixtureArtifact(expectedHotBlockBFixture: unknown): unknown {
  if (!isRecord(expectedHotBlockBFixture)) {
    throw createConformanceError("fixtureShapeRejected", {
      artifact: "hot-block-b-fixture",
      detail: "hot-block-b-fixture must be an object",
      failureCode: "fixtureNotObject",
    });
  }

  const seqlockCounter = getU64HexProperty(
    expectedHotBlockBFixture,
    "seqlockCounter",
    "expected.seqlockCounter",
  );
  const baselineEpoch = getNumberProperty(
    expectedHotBlockBFixture,
    "baselineEpoch",
    "expected.baselineEpoch",
  );
  const continuityGeneration = getNumberProperty(
    expectedHotBlockBFixture,
    "continuityGeneration",
    "expected.continuityGeneration",
  );
  const publicationSequence = getU64HexProperty(
    expectedHotBlockBFixture,
    "publicationSequence",
    "expected.publicationSequence",
  );
  const expected = getObjectProperty(expectedHotBlockBFixture, "expected");
  if (!isRecord(expected)) {
    throw createConformanceError("fixtureShapeRejected", {
      artifact: "hot-block-b-fixture",
      detail: "hot-block-b-fixture expected must be an object",
      failureCode: "fixtureNotObject",
      path: "expected",
    });
  }
  const expectedBlockBBytesHex = getStringProperty(
    expected,
    "blockBBytesHex",
    "expected.blockBBytesHex",
  );

  const input: HotBlockBHeaderInput = {
    seqlockCounter,
    baselineEpoch,
    continuityGeneration,
    publicationSequence,
  };

  const blockBBytes = encodeHotBlockBHeader(input);
  const expectedBlockBBytes = hexToBytes(expectedBlockBBytesHex);
  const decoded = decodeHotBlockBHeader(expectedBlockBBytes);
  const validation = validateHotBlockBHeader(expectedBlockBBytes, input);

  if (!validation.ok) {
    throw createConformanceError("fixtureArtifactMismatch", {
      artifact: "hot-block-b-fixture",
      detail: `hot-block-b-fixture validation failed: ${validation.error.message}`,
      failureCode: "headerValidationFailed",
    });
  }

  return {
    fixtureKind: "hot-block-b-fixture",
    seqlockCounter,
    baselineEpoch,
    continuityGeneration,
    publicationSequence,
    expected: {
      blockBBytesHex: bytesToHex(blockBBytes),
      decoded,
    },
  };
}

function appendHotCompleteFixtureRegionComparison(
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
  const expectedCompleteFixtureRegionBytes = hexToBytes(completeFixtureRegionBytesHex);

  if (expectedCompleteFixtureRegionBytes.byteLength !== hotLayoutManifest.totalRegionByteLength) {
    throw createConformanceError("fixtureArtifactMismatch", {
      artifact: "hot-complete-fixture-region",
      detail: `hot-complete-fixture-region byte length mismatch: expected ${hotLayoutManifest.totalRegionByteLength}, got ${expectedCompleteFixtureRegionBytes.byteLength}`,
      failureCode: "artifactMismatch",
    });
  }

  const expectedBlockABytes = hexToBytes(blockABytesHex);
  const expectedBlockBBytes = hexToBytes(blockBBytesHex);
  const expectedFieldBytes = hexToBytes(fieldBytesHex);
  const expectedConcatenatedBytes = new Uint8Array(
    expectedBlockABytes.byteLength + expectedBlockBBytes.byteLength + expectedFieldBytes.byteLength,
  );
  expectedConcatenatedBytes.set(expectedBlockABytes, 0);
  expectedConcatenatedBytes.set(expectedBlockBBytes, HOT_BLOCK_B_BYTE_OFFSET);
  expectedConcatenatedBytes.set(expectedFieldBytes, HOT_FIELD_DATA_BYTE_OFFSET);

  if (bytesToHex(expectedConcatenatedBytes) !== completeFixtureRegionBytesHex) {
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

function getStringProperty(obj: Record<string, unknown>, key: string, path: string): string {
  const value = obj[key];
  if (typeof value !== "string") {
    throw createConformanceError("fixtureShapeRejected", {
      detail: `expected ${key} to be a string`,
      failureCode: "expectedString",
      path,
    });
  }
  return value;
}

const U64_HEX_RE = /^[0-9a-f]{16}$/;

function getU64Property(obj: Record<string, unknown>, key: string, path: string): bigint {
  const value = obj[key];
  if (typeof value === "bigint") {
    if (value < 0n || value > 0xffff_ffff_ffff_ffffn) {
      throw createConformanceError("fixtureShapeRejected", {
        detail: `expected ${key} to be a u64`,
        failureCode: "u64OutOfRange",
        path,
      });
    }
    return value;
  }

  return getU64HexProperty(obj, key, path);
}

function getU64HexProperty(obj: Record<string, unknown>, key: string, path: string): bigint {
  const value = obj[key];
  if (typeof value !== "string") {
    throw createConformanceError("fixtureShapeRejected", {
      detail: `expected ${key} to be a string`,
      failureCode: "expectedString",
      path,
    });
  }
  if (!U64_HEX_RE.test(value)) {
    throw createConformanceError("fixtureShapeRejected", {
      detail: `expected ${key} to be 16 lowercase hex characters`,
      failureCode: "expectedU64Hex",
      path,
    });
  }
  return BigInt(`0x${value}`);
}

function getNumberProperty(obj: Record<string, unknown>, key: string, path: string): number {
  const value = obj[key];
  if (typeof value !== "number") {
    throw createConformanceError("fixtureShapeRejected", {
      detail: `expected ${key} to be a number`,
      failureCode: "expectedNumber",
      path,
    });
  }
  return value;
}

function appendHotLayoutVersionCheck(
  failures: ProjectionRuntimeFixtureFailure[],
  source: "actual" | "expected",
  resolvedContract: unknown,
): void {
  const encoded = encodeFixtureJson(resolvedContract);
  const topLevelVersion = getObjectProperty(encoded, "hotLayoutVersion");
  const laneVersion = getObjectProperty(
    getObjectProperty(getObjectProperty(encoded, "laneManifests"), "hot"),
    "hotLayoutVersion",
  );

  if (topLevelVersion === undefined || laneVersion === undefined) {
    return;
  }

  if (isDeepStrictEqual(topLevelVersion, laneVersion)) {
    return;
  }

  failures.push({
    artifact: "hot-layout-version",
    failureCode: "hotLayoutVersionMismatch",
    reason: `${source} hotLayoutVersion does not match laneManifests.hot.hotLayoutVersion`,
    expected: laneVersion,
    actual: topLevelVersion,
  });
}

function getObjectProperty(value: unknown, key: string): unknown {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    return undefined;
  }

  return (value as Record<string, unknown>)[key];
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function fixtureFileFailureResult(
  fixture: ProjectionRuntimeFixtureName | ProjectionRuntimeFixture,
  error: unknown,
): ProjectionRuntimeFixtureResult {
  const details = isConformanceError(error) ? error.details : {};
  const fixtureName =
    details.fixtureName ?? (typeof fixture === "string" ? fixture : fixture.fixtureName);
  const fixturePath =
    details.fixturePath ?? (typeof fixture === "string" ? fixture : fixture.fixturePath);
  const failure = fixtureFileFailure(error);

  return {
    fixtureName,
    fixturePath,
    passed: false,
    failures: [failure],
  };
}

function fixtureFileFailure(error: unknown): ProjectionRuntimeFixtureFailure {
  if (isConformanceError(error)) {
    return {
      artifact: "fixture-file",
      failureCode: error.details.failureCode ?? "fixtureFileLoadFailed",
      reason: error.details.detail ?? error.message,
      ...(error.details.fixtureFile === undefined
        ? {}
        : { fixtureFile: error.details.fixtureFile }),
      ...(error.details.relativePath === undefined
        ? {}
        : { relativePath: error.details.relativePath }),
    };
  }

  return {
    artifact: "fixture-file",
    failureCode: "fixtureFileLoadFailed",
    reason: error instanceof Error ? error.message : "failed to load fixture files",
  };
}

function conformanceFailureFromError(
  error: unknown,
  artifact: ProjectionRuntimeFixtureFailureArtifact,
  expected?: unknown,
): ProjectionRuntimeFixtureFailure {
  if (isConformanceError(error)) {
    return {
      artifact,
      failureCode: error.details.failureCode ?? "artifactMismatch",
      reason: error.details.detail ?? error.message,
      expected: expected !== undefined ? encodeFixtureJson(expected) : undefined,
      ...(error.details.fixtureFile === undefined
        ? {}
        : { fixtureFile: error.details.fixtureFile }),
      ...(error.details.relativePath === undefined
        ? {}
        : { relativePath: error.details.relativePath }),
    };
  }

  return {
    artifact,
    failureCode: "artifactMismatch",
    reason: error instanceof Error ? error.message : `failed to verify ${artifact}`,
    expected: expected !== undefined ? encodeFixtureJson(expected) : undefined,
  };
}
