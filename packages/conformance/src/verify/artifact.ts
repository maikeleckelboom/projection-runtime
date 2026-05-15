import { isDeepStrictEqual } from "node:util";

import { encodeFixtureJson } from "../encode";
import type { ProjectionRuntimeArtifactName, ProjectionRuntimeFixtureFailure } from "../run";

export function appendArtifactComparison(
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
