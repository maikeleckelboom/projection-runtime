import { isDeepStrictEqual } from "node:util";

import { compileAuthoredProjectionContract } from "@seqlok/compiler";
import {
  bytesToHex,
  decodeHotFieldValues,
  encodeHotFieldValues,
  type HotFieldValues,
  type HotLayoutManifest,
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
      "canonicalManifest" | "hotByteFixture" | "hotLayoutManifest" | "resolvedContract"
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
    failures.push({
      artifact: "hot-byte-fixture",
      reason: error instanceof Error ? error.message : "failed to verify hot-byte-fixture",
      expected: encodeFixtureJson(expectedHotByteFixture),
    });
  }
}

function createHotByteFixtureArtifact(
  hotLayoutManifest: HotLayoutManifest | undefined,
  expectedHotByteFixture: unknown,
): unknown {
  if (hotLayoutManifest === undefined) {
    throw new Error("hot-byte-fixture requires a hot layout manifest");
  }

  const values = getObjectProperty(expectedHotByteFixture, "values");
  if (!isRecord(values)) {
    throw new Error("hot-byte-fixture values must be an object");
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
    throw new Error("hot-byte-fixture field and region decoding diverged");
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
