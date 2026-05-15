import {
  bytesToHex,
  decodeHotBlockBHeader,
  encodeHotBlockBHeader,
  type HotBlockBHeaderInput,
  hexToBytes,
  validateHotBlockBHeader,
} from "@exclave/hot-codec";

import { createConformanceError } from "../error";
import type { ProjectionRuntimeFixtureFailure } from "../run";
import { appendArtifactComparison } from "./artifact";
import { conformanceFailureFromError } from "./failure";
import {
  getNumberProperty,
  getObjectProperty,
  getStringProperty,
  getU64HexProperty,
  isRecord,
} from "./shape";

export function appendHotBlockBFixtureComparison(
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
