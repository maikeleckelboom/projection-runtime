import type { ProjectionRuntimeFixtureFailure } from "../run";
import { appendArtifactComparison } from "./artifact";

export function appendResolvedContractComparison(
  failures: ProjectionRuntimeFixtureFailure[],
  expectedResolvedContract: unknown,
  resolved: unknown,
): void {
  appendArtifactComparison(failures, "resolved-contract", expectedResolvedContract, resolved);
}
