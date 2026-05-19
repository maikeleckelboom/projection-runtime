import { compileAuthoredProjectionContract } from "@exclave/compiler";

import type {
  ConformanceArtifactName,
  ConformanceFailureArtifactName,
  ConformanceFailureCode,
} from "./error";
import {
  listProjectionRuntimeFixtures,
  loadProjectionRuntimeFixture,
  type ProjectionRuntimeFixture,
  type ProjectionRuntimeFixtureArtifacts,
  type ProjectionRuntimeFixtureName,
  type ProjectionRuntimeFixtureRootOptions,
} from "./fixtures";
import { appendArtifactComparison } from "./verify/artifact";
import { fixtureFileFailureResult } from "./verify/failure";
import { appendHotBlockAFixtureComparison } from "./verify/hot-block-a";
import { appendHotBlockBFixtureComparison } from "./verify/hot-block-b";
import { appendHotByteFixtureComparison } from "./verify/hot-byte";
import { appendHotCompleteFixtureRegionComparison } from "./verify/hot-complete-region";
import { appendHotLayoutVersionCheck } from "./verify/hot-layout-version";
import { appendWarmPayloadFixtureComparison } from "./verify/warm-payload";

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
      | "warmPayloadFixture"
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
  const expectedWarmPayloadFixture =
    options.expectedArtifacts?.warmPayloadFixture ?? artifacts.warmPayloadFixture;

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
  const failures: ProjectionRuntimeFixtureFailure[] = [];

  appendArtifactComparison(
    failures,
    "canonical-manifest",
    expectedCanonicalManifest,
    resolved.manifest,
  );
  appendArtifactComparison(failures, "resolved-contract", expectedResolvedContract, resolved);

  if (loadedFixture.fixtureProfile === "hot-codec") {
    const hotLayoutManifest = resolved.laneManifests?.hot;
    appendArtifactComparison(
      failures,
      "hot-layout-manifest",
      expectedHotLayoutManifest,
      hotLayoutManifest,
    );
    appendHotByteFixtureComparison(failures, expectedHotByteFixture, hotLayoutManifest);
    appendHotBlockAFixtureComparison(
      failures,
      expectedHotBlockAFixture,
      hotLayoutManifest,
      resolved,
    );
    appendHotBlockBFixtureComparison(failures, expectedHotBlockBFixture);
    appendHotCompleteFixtureRegionComparison(
      failures,
      expectedHotCompleteFixtureRegion,
      expectedHotByteFixture,
      expectedHotBlockBFixture,
      hotLayoutManifest,
      resolved,
    );
    appendHotLayoutVersionCheck(failures, "expected", expectedResolvedContract);
    appendHotLayoutVersionCheck(failures, "actual", resolved);
  } else {
    appendWarmPayloadFixtureComparison(failures, expectedWarmPayloadFixture, resolved);
  }

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
