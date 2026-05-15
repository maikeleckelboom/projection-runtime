import { isDeepStrictEqual } from "node:util";

import { encodeFixtureJson } from "../encode";
import type { ProjectionRuntimeFixtureFailure } from "../run";
import { getObjectProperty } from "./shape";

export function appendHotLayoutVersionCheck(
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
