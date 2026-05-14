import { isDeepStrictEqual } from "node:util";

import { compileAuthoredProjectionContract } from "@seqlok/compiler";
import {
  bytesToHex,
  decodeHotBlockAHeader,
  decodeHotFieldValues,
  encodeHotBlockAHeader,
  encodeHotFieldValues,
  type HotBlockAHeaderInput,
  type HotFieldValues,
  type HotLayoutManifest,
  validateHotBlockAHeader,
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
      reason: "missingHotLayoutManifest",
    });
  }

  const values = getObjectProperty(expectedHotByteFixture, "values");
  if (!isRecord(values)) {
    throw createConformanceError("fixtureShapeRejected", {
      artifact: "hot-byte-fixture",
      detail: "hot-byte-fixture values must be an object",
      failureCode: "valuesNotObject",
      reason: "valuesNotObject",
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
      reason: "fieldRegionDecodeDiverged",
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
      reason: "missingHotLayoutManifest",
    });
  }
  if (!isRecord(resolved)) {
    throw createConformanceError("fixtureShapeRejected", {
      artifact: "hot-block-a-fixture",
      detail: "hot-block-a-fixture requires resolved contract",
      failureCode: "missingResolvedContract",
      reason: "missingResolvedContract",
    });
  }
  if (!isRecord(expectedHotBlockAFixture)) {
    throw createConformanceError("fixtureShapeRejected", {
      artifact: "hot-block-a-fixture",
      detail: "hot-block-a-fixture must be an object",
      failureCode: "fixtureNotObject",
      reason: "fixtureNotObject",
    });
  }

  const semanticVersion = getStringProperty(
    expectedHotBlockAFixture,
    "semanticVersion",
    "expected.semanticVersion",
  );
  const hotLayoutVersion = getStringProperty(
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
  if (semanticVersion !== resolvedSemanticVersion) {
    throw createConformanceError("fixtureArtifactMismatch", {
      artifact: "hot-block-a-fixture",
      detail: `hot-block-a-fixture semanticVersion mismatch: expected ${semanticVersion}, resolved ${resolvedSemanticVersion}`,
      failureCode: "semanticVersionMismatch",
      reason: "semanticVersionMismatch",
    });
  }

  const manifestHotLayoutVersion = encodeFixtureJson(hotLayoutManifest.hotLayoutVersion);
  if (hotLayoutVersion !== manifestHotLayoutVersion) {
    throw createConformanceError("fixtureArtifactMismatch", {
      artifact: "hot-block-a-fixture",
      detail: `hot-block-a-fixture hotLayoutVersion mismatch: expected ${hotLayoutVersion}, manifest ${manifestHotLayoutVersion}`,
      failureCode: "hotLayoutVersionMismatch",
      reason: "hotLayoutVersionMismatch",
    });
  }

  if (fieldCount !== hotLayoutManifest.fields.length) {
    throw createConformanceError("fixtureArtifactMismatch", {
      artifact: "hot-block-a-fixture",
      detail: `hot-block-a-fixture fieldCount mismatch: expected ${fieldCount}, manifest ${hotLayoutManifest.fields.length}`,
      failureCode: "fieldCountMismatch",
      reason: "fieldCountMismatch",
    });
  }

  if (mutableRegionByteLength !== hotLayoutManifest.mutableRegionByteLength) {
    throw createConformanceError("fixtureArtifactMismatch", {
      artifact: "hot-block-a-fixture",
      detail: `hot-block-a-fixture mutableRegionByteLength mismatch: expected ${mutableRegionByteLength}, manifest ${hotLayoutManifest.mutableRegionByteLength}`,
      failureCode: "mutableRegionByteLengthMismatch",
      reason: "mutableRegionByteLengthMismatch",
    });
  }

  const input: HotBlockAHeaderInput = {
    contractKey,
    instanceKey,
    semanticVersion: BigInt(`0x${semanticVersion}`),
    hotLayoutVersion: BigInt(`0x${hotLayoutVersion}`),
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
      reason: "headerValidationFailed",
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

function getStringProperty(obj: Record<string, unknown>, key: string, path: string): string {
  const value = obj[key];
  if (typeof value !== "string") {
    throw createConformanceError("fixtureShapeRejected", {
      detail: `expected ${key} to be a string`,
      failureCode: "expectedString",
      path,
      reason: "expectedString",
    });
  }
  return value;
}

function getNumberProperty(obj: Record<string, unknown>, key: string, path: string): number {
  const value = obj[key];
  if (typeof value !== "number") {
    throw createConformanceError("fixtureShapeRejected", {
      detail: `expected ${key} to be a number`,
      failureCode: "expectedNumber",
      path,
      reason: "expectedNumber",
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
