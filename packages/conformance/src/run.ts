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
import { ConformanceError } from "./error";
import {
  listProjectionRuntimeFixtures,
  loadProjectionRuntimeFixture,
  type ProjectionRuntimeFixture,
  type ProjectionRuntimeFixtureArtifacts,
  type ProjectionRuntimeFixtureName,
  type ProjectionRuntimeFixtureRootOptions,
} from "./fixtures";

export type ProjectionRuntimeArtifactName =
  | "canonical-manifest"
  | "hot-byte-fixture"
  | "hot-block-a-fixture"
  | "hot-layout-manifest"
  | "resolved-contract";

export type ProjectionRuntimeFixtureFailureArtifact =
  | ProjectionRuntimeArtifactName
  | "compile"
  | "fixture-file"
  | "hot-layout-version";

export interface ProjectionRuntimeFixtureFailure {
  readonly artifact: ProjectionRuntimeFixtureFailureArtifact;
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
          reason: "compiler rejected authored-contract.json",
          actual: compileResult.error.issues,
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
    throw new ConformanceError(
      "conformance.fixtureShapeRejected",
      "hot-byte-fixture requires a hot layout manifest",
      { artifact: "hot-byte-fixture", reason: "missingHotLayoutManifest" },
    );
  }

  const values = getObjectProperty(expectedHotByteFixture, "values");
  if (!isRecord(values)) {
    throw new ConformanceError(
      "conformance.fixtureShapeRejected",
      "hot-byte-fixture values must be an object",
      { artifact: "hot-byte-fixture", reason: "valuesNotObject" },
    );
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
    throw new ConformanceError(
      "conformance.fixtureArtifactMismatch",
      "hot-byte-fixture field and region decoding diverged",
      { artifact: "hot-byte-fixture", reason: "fieldRegionDecodeDiverged" },
    );
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
    throw new ConformanceError(
      "conformance.fixtureShapeRejected",
      "hot-block-a-fixture requires a hot layout manifest",
      { artifact: "hot-block-a-fixture", reason: "missingHotLayoutManifest" },
    );
  }
  if (!isRecord(resolved)) {
    throw new ConformanceError(
      "conformance.fixtureShapeRejected",
      "hot-block-a-fixture requires resolved contract",
      { artifact: "hot-block-a-fixture", reason: "missingResolvedContract" },
    );
  }
  if (!isRecord(expectedHotBlockAFixture)) {
    throw new ConformanceError(
      "conformance.fixtureShapeRejected",
      "hot-block-a-fixture must be an object",
      { artifact: "hot-block-a-fixture", reason: "fixtureNotObject" },
    );
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
    throw new ConformanceError(
      "conformance.fixtureArtifactMismatch",
      `hot-block-a-fixture semanticVersion mismatch: expected ${semanticVersion}, resolved ${resolvedSemanticVersion}`,
      { artifact: "hot-block-a-fixture", reason: "semanticVersionMismatch" },
    );
  }

  const manifestHotLayoutVersion = encodeFixtureJson(hotLayoutManifest.hotLayoutVersion);
  if (hotLayoutVersion !== manifestHotLayoutVersion) {
    throw new ConformanceError(
      "conformance.fixtureArtifactMismatch",
      `hot-block-a-fixture hotLayoutVersion mismatch: expected ${hotLayoutVersion}, manifest ${manifestHotLayoutVersion}`,
      { artifact: "hot-block-a-fixture", reason: "hotLayoutVersionMismatch" },
    );
  }

  if (fieldCount !== hotLayoutManifest.fields.length) {
    throw new ConformanceError(
      "conformance.fixtureArtifactMismatch",
      `hot-block-a-fixture fieldCount mismatch: expected ${fieldCount}, manifest ${hotLayoutManifest.fields.length}`,
      { artifact: "hot-block-a-fixture", reason: "fieldCountMismatch" },
    );
  }

  if (mutableRegionByteLength !== hotLayoutManifest.mutableRegionByteLength) {
    throw new ConformanceError(
      "conformance.fixtureArtifactMismatch",
      `hot-block-a-fixture mutableRegionByteLength mismatch: expected ${mutableRegionByteLength}, manifest ${hotLayoutManifest.mutableRegionByteLength}`,
      { artifact: "hot-block-a-fixture", reason: "mutableRegionByteLengthMismatch" },
    );
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
    throw new ConformanceError(
      "conformance.fixtureArtifactMismatch",
      `hot-block-a-fixture validation failed: ${validation.error.message}`,
      { artifact: "hot-block-a-fixture", reason: "headerValidationFailed" },
    );
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
    throw new ConformanceError(
      "conformance.fixtureShapeRejected",
      `expected ${key} to be a string`,
      { path, reason: "expectedString" },
    );
  }
  return value;
}

function getNumberProperty(obj: Record<string, unknown>, key: string, path: string): number {
  const value = obj[key];
  if (typeof value !== "number") {
    throw new ConformanceError(
      "conformance.fixtureShapeRejected",
      `expected ${key} to be a number`,
      { path, reason: "expectedNumber" },
    );
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
  const details = error instanceof ConformanceError ? error.details : {};
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
  if (error instanceof ConformanceError) {
    return {
      artifact: "fixture-file",
      reason: error.message,
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
    reason: error instanceof Error ? error.message : "failed to load fixture files",
  };
}

function conformanceFailureFromError(
  error: unknown,
  artifact: ProjectionRuntimeFixtureFailureArtifact,
  expected?: unknown,
): ProjectionRuntimeFixtureFailure {
  if (error instanceof ConformanceError) {
    return {
      artifact,
      reason: error.message,
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
    reason: error instanceof Error ? error.message : `failed to verify ${artifact}`,
    expected: expected !== undefined ? encodeFixtureJson(expected) : undefined,
  };
}
