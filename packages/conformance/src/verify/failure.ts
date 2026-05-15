import { encodeFixtureJson } from "../encode";
import { isConformanceError } from "../error";
import type { ProjectionRuntimeFixture, ProjectionRuntimeFixtureName } from "../fixtures";
import type {
  ProjectionRuntimeFixtureFailure,
  ProjectionRuntimeFixtureFailureArtifact,
  ProjectionRuntimeFixtureResult,
} from "../run";

export function fixtureFileFailureResult(
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

export function conformanceFailureFromError(
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
