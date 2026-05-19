import type { ResolvedProjectionContract } from "@exclave/compiler";
import {
  decodeWarmLaneFrame,
  decodeWarmSnapshotPayload,
  encodeWarmLaneFrame,
  encodeWarmSnapshotPayload,
  type WarmLaneFrame,
  type WarmSnapshotObject,
  type WarmSnapshotPayloadManifest,
  type WarmSnapshotPayloadShape,
  type WarmSnapshotValue,
} from "@exclave/warm";

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

export function appendWarmPayloadFixtureComparison(
  failures: ProjectionRuntimeFixtureFailure[],
  expectedWarmPayloadFixture: unknown,
  resolved: ResolvedProjectionContract,
): void {
  try {
    appendArtifactComparison(
      failures,
      "warm-payload-fixture",
      expectedWarmPayloadFixture,
      createWarmPayloadFixtureArtifact(expectedWarmPayloadFixture, resolved),
    );
  } catch (error) {
    failures.push(
      conformanceFailureFromError(error, "warm-payload-fixture", expectedWarmPayloadFixture),
    );
  }
}

export function appendRustWarmOutputComparison(
  failures: ProjectionRuntimeFixtureFailure[],
  expectedRustWarmOutput: unknown,
  expectedWarmPayloadFixture: unknown,
  resolved: ResolvedProjectionContract,
  fixtureName: string,
): void {
  try {
    appendArtifactComparison(
      failures,
      "rust-warm-output",
      expectedRustWarmOutput,
      createRustWarmOutputArtifact(expectedWarmPayloadFixture, resolved, fixtureName),
    );
  } catch (error) {
    failures.push(conformanceFailureFromError(error, "rust-warm-output", expectedRustWarmOutput));
  }
}

function createWarmPayloadFixtureArtifact(
  expectedWarmPayloadFixture: unknown,
  resolved: ResolvedProjectionContract,
): unknown {
  const warmManifest = resolved.laneManifests?.warm as WarmSnapshotPayloadManifest | undefined;
  if (warmManifest === undefined) {
    throw createConformanceError("fixtureShapeRejected", {
      artifact: "warm-payload-fixture",
      detail: "warm-payload-fixture requires a warm payload manifest",
      failureCode: "missingWarmPayloadManifest",
    });
  }

  if (!isRecord(expectedWarmPayloadFixture)) {
    throw createConformanceError("fixtureShapeRejected", {
      artifact: "warm-payload-fixture",
      detail: "warm-payload-fixture must be an object",
      failureCode: "fixtureNotObject",
    });
  }

  const snapshotFixture = getObjectProperty(expectedWarmPayloadFixture, "snapshot");
  if (!isRecord(snapshotFixture)) {
    throw createConformanceError("fixtureShapeRejected", {
      artifact: "warm-payload-fixture",
      detail: "warm-payload-fixture snapshot must be an object",
      failureCode: "valuesNotObject",
      path: "snapshot",
    });
  }

  const snapshot = normalizeWarmSnapshotValues(warmManifest, snapshotFixture);
  const encoded = encodeWarmSnapshotPayload(warmManifest, snapshot);
  if (!encoded.ok) {
    throw createConformanceError("fixtureArtifactMismatch", {
      artifact: "warm-payload-fixture",
      detail: encoded.failure.detail,
      failureCode: "warmPayloadEncodeRejected",
      ...(encoded.failure.path === undefined ? {} : { path: encoded.failure.path }),
    });
  }

  const decoded = decodeWarmSnapshotPayload(warmManifest, encoded.bytes);
  if (!decoded.ok) {
    throw createConformanceError("fixtureArtifactMismatch", {
      artifact: "warm-payload-fixture",
      detail: decoded.failure.detail,
      failureCode: "warmPayloadDecodeRejected",
      ...(decoded.failure.path === undefined ? {} : { path: decoded.failure.path }),
    });
  }

  const frameInput = createWarmLaneFrame(expectedWarmPayloadFixture, resolved, encoded.bytes);
  const encodedFrame = encodeWarmLaneFrame(frameInput);
  if (!encodedFrame.ok) {
    throw createConformanceError("fixtureArtifactMismatch", {
      artifact: "warm-payload-fixture",
      detail: encodedFrame.failure.detail,
      failureCode: "warmFrameEncodeRejected",
    });
  }

  const decodedFrame = decodeWarmLaneFrame(encodedFrame.bytes);
  if (!decodedFrame.ok) {
    throw createConformanceError("fixtureArtifactMismatch", {
      artifact: "warm-payload-fixture",
      detail: decodedFrame.failure.detail,
      failureCode: "warmFrameDecodeRejected",
    });
  }

  const decodedFramePayload = decodeWarmSnapshotPayload(warmManifest, decodedFrame.frame.payload);
  if (!decodedFramePayload.ok) {
    throw createConformanceError("fixtureArtifactMismatch", {
      artifact: "warm-payload-fixture",
      detail: decodedFramePayload.failure.detail,
      failureCode: "warmPayloadDecodeRejected",
      ...(decodedFramePayload.failure.path === undefined
        ? {}
        : { path: decodedFramePayload.failure.path }),
    });
  }

  return {
    fixtureKind: "warm-payload-fixture",
    contractKey: resolved.manifest.key,
    semanticVersion: resolved.semanticVersion,
    warmCodecVersion: resolved.warmCodecVersion,
    frame: frameFixtureFromInput(frameInput),
    snapshot: snapshotFixture,
    expected: {
      payloadBytesHex: bytesToHex(encoded.bytes),
      decodedSnapshot: decoded.snapshot,
      frameBytesHex: bytesToHex(encodedFrame.bytes),
      decodedFrame: {
        ...frameFixtureFromInput(decodedFrame.frame),
        payloadBytesHex: bytesToHex(decodedFrame.frame.payload),
      },
      decodedFrameSnapshot: decodedFramePayload.snapshot,
    },
  };
}

function createRustWarmOutputArtifact(
  expectedWarmPayloadFixture: unknown,
  resolved: ResolvedProjectionContract,
  fixtureName: string,
): unknown {
  if (!isRecord(expectedWarmPayloadFixture)) {
    throw createConformanceError("fixtureShapeRejected", {
      artifact: "rust-warm-output",
      detail: "rust-warm-output requires warm-payload-fixture to be an object",
      failureCode: "fixtureNotObject",
    });
  }

  const expected = getObjectProperty(expectedWarmPayloadFixture, "expected");
  if (!isRecord(expected)) {
    throw createConformanceError("fixtureShapeRejected", {
      artifact: "rust-warm-output",
      detail: "warm-payload-fixture expected must be an object",
      failureCode: "fixtureNotObject",
      path: "expected",
    });
  }

  const decodedFrame = getObjectProperty(expected, "decodedFrame");
  if (!isRecord(decodedFrame)) {
    throw createConformanceError("fixtureShapeRejected", {
      artifact: "rust-warm-output",
      detail: "warm-payload-fixture expected.decodedFrame must be an object",
      failureCode: "fixtureNotObject",
      path: "expected.decodedFrame",
    });
  }

  const payloadBytesHex = getHexProperty(expected, "payloadBytesHex", "expected.payloadBytesHex");
  const frameBytesHex = getHexProperty(expected, "frameBytesHex", "expected.frameBytesHex");
  const decodedFramePayloadBytesHex = getHexProperty(
    decodedFrame,
    "payloadBytesHex",
    "expected.decodedFrame.payloadBytesHex",
  );
  const decodedSnapshot = getObjectProperty(expected, "decodedSnapshot");
  if (!isRecord(decodedSnapshot)) {
    throw createConformanceError("fixtureShapeRejected", {
      artifact: "rust-warm-output",
      detail: "warm-payload-fixture expected.decodedSnapshot must be an object",
      failureCode: "fixtureNotObject",
      path: "expected.decodedSnapshot",
    });
  }

  const laneSequence = decodedFrame.laneSequence;
  if (laneSequence !== undefined && typeof laneSequence !== "number") {
    throw createConformanceError("fixtureShapeRejected", {
      artifact: "rust-warm-output",
      detail: "expected.decodedFrame.laneSequence must be a number when present",
      failureCode: "expectedNumber",
      path: "expected.decodedFrame.laneSequence",
    });
  }

  return {
    fixtureKind: "rust-warm-output",
    fixtureName,
    contractKey: resolved.manifest.key,
    semanticVersion: resolved.semanticVersion,
    warmCodecVersion: requireWarmCodecVersion(resolved),
    payloadBytesHex,
    frameBytesHex,
    decodedFrame: {
      frameByteLength: frameBytesHexToFrameByteLength(frameBytesHex),
      contractKey: resolved.manifest.key,
      projectionInstanceKey: getStringProperty(
        decodedFrame,
        "projectionInstanceKey",
        "expected.decodedFrame.projectionInstanceKey",
      ),
      semanticVersion: resolved.semanticVersion,
      warmCodecVersion: requireWarmCodecVersion(resolved),
      baselineEpoch: getNumberProperty(
        decodedFrame,
        "baselineEpoch",
        "expected.decodedFrame.baselineEpoch",
      ),
      continuityGeneration: getNumberProperty(
        decodedFrame,
        "continuityGeneration",
        "expected.decodedFrame.continuityGeneration",
      ),
      publicationSequence: getU64HexProperty(
        decodedFrame,
        "publicationSequence",
        "expected.decodedFrame.publicationSequence",
      ),
      ...(laneSequence === undefined ? {} : { laneSequence }),
      payloadBytesHex: decodedFramePayloadBytesHex,
    },
    decodedSnapshot,
  };
}

function createWarmLaneFrame(
  fixture: Record<string, unknown>,
  resolved: ResolvedProjectionContract,
  payload: Uint8Array,
): WarmLaneFrame {
  const frame = getObjectProperty(fixture, "frame");
  if (!isRecord(frame)) {
    throw createConformanceError("fixtureShapeRejected", {
      artifact: "warm-payload-fixture",
      detail: "warm-payload-fixture frame must be an object",
      failureCode: "fixtureNotObject",
      path: "frame",
    });
  }

  const laneSequence = frame.laneSequence;
  if (laneSequence !== undefined && typeof laneSequence !== "number") {
    throw createConformanceError("fixtureShapeRejected", {
      artifact: "warm-payload-fixture",
      detail: "frame.laneSequence must be a number when present",
      failureCode: "expectedNumber",
      path: "frame.laneSequence",
    });
  }

  return {
    contractKey: resolved.manifest.key,
    projectionInstanceKey: getStringProperty(
      frame,
      "projectionInstanceKey",
      "frame.projectionInstanceKey",
    ),
    semanticVersion: resolved.semanticVersion,
    warmCodecVersion: requireWarmCodecVersion(resolved),
    baselineEpoch: getNumberProperty(frame, "baselineEpoch", "frame.baselineEpoch"),
    continuityGeneration: getNumberProperty(
      frame,
      "continuityGeneration",
      "frame.continuityGeneration",
    ),
    publicationSequence: getU64HexProperty(
      frame,
      "publicationSequence",
      "frame.publicationSequence",
    ),
    ...(laneSequence === undefined ? {} : { laneSequence }),
    payload,
  };
}

function frameFixtureFromInput(frame: WarmLaneFrame): Record<string, unknown> {
  return {
    projectionInstanceKey: frame.projectionInstanceKey,
    baselineEpoch: frame.baselineEpoch,
    continuityGeneration: frame.continuityGeneration,
    publicationSequence: frame.publicationSequence,
    ...(frame.laneSequence === undefined ? {} : { laneSequence: frame.laneSequence }),
  };
}

function normalizeWarmSnapshotValues(
  manifest: WarmSnapshotPayloadManifest,
  values: Record<string, unknown>,
): WarmSnapshotObject {
  return Object.fromEntries(
    manifest.fields.map((field) => [
      field.dotPath,
      normalizeWarmValue(field.shape, values[field.dotPath], `snapshot.${field.dotPath}`),
    ]),
  );
}

function normalizeWarmValue(
  shape: WarmSnapshotPayloadShape,
  value: unknown,
  path: string,
): WarmSnapshotValue {
  switch (shape.kind) {
    case "FixedScalar":
      if (shape.type === "u64" || shape.type === "i64") {
        return parseFixtureBigInt(value, path);
      }
      return value as WarmSnapshotValue;

    case "FixedEnum":
    case "FixedStringEncoded":
    case "VariableString":
      return value as WarmSnapshotValue;

    case "FixedVector":
      if (!Array.isArray(value)) {
        throw valuesShapeError(`${path} must be an array`, path);
      }
      return value.map((entry, index) =>
        normalizeScalarValue(shape.elementType, entry, `${path}.${index}`),
      );

    case "BoundedArray":
      if (!Array.isArray(value)) {
        throw valuesShapeError(`${path} must be an array`, path);
      }
      return value.map((entry, index) =>
        normalizeScalarValue(shape.elementType, entry, `${path}.${index}`),
      );

    case "BoundedMap":
      return normalizeWarmMapValue(shape.valueShape, value, path);

    case "VariableMap":
      return normalizeWarmMapValue(shape.valueShape, value, path);
  }
}

function normalizeWarmMapValue(
  valueShape: WarmSnapshotPayloadShape,
  value: unknown,
  path: string,
): WarmSnapshotObject {
  if (!isRecord(value)) {
    throw valuesShapeError(`${path} must be an object`, path);
  }

  return Object.fromEntries(
    Object.entries(value).map(([key, entry]) => [
      key,
      normalizeWarmValue(valueShape, entry, `${path}.${key}`),
    ]),
  );
}

function normalizeScalarValue(type: string, value: unknown, path: string): WarmSnapshotValue {
  if (type === "u64" || type === "i64") {
    return parseFixtureBigInt(value, path);
  }
  return value as WarmSnapshotValue;
}

function parseFixtureBigInt(value: unknown, path: string): bigint {
  if (typeof value === "string" && /^[0-9a-f]{16}$/.test(value)) {
    return BigInt(`0x${value}`);
  }

  throw createConformanceError("fixtureShapeRejected", {
    artifact: "warm-payload-fixture",
    detail: `${path} must be a 16-character lowercase hex string for a 64-bit warm field`,
    failureCode: "expectedU64Hex",
    path,
  });
}

function requireWarmCodecVersion(resolved: ResolvedProjectionContract): bigint {
  if (resolved.warmCodecVersion === undefined) {
    throw createConformanceError("fixtureShapeRejected", {
      artifact: "warm-payload-fixture",
      detail: "resolved contract must include warmCodecVersion",
      failureCode: "missingWarmPayloadManifest",
    });
  }

  return resolved.warmCodecVersion;
}

function valuesShapeError(detail: string, path: string): Error {
  return createConformanceError("fixtureShapeRejected", {
    artifact: "warm-payload-fixture",
    detail,
    failureCode: "valuesNotObject",
    path,
  });
}

function bytesToHex(bytes: Uint8Array): string {
  return Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join("");
}

function getHexProperty(obj: Record<string, unknown>, key: string, path: string): string {
  const value = getStringProperty(obj, key, path);
  if (!/^(?:[\da-f]{2})*$/.test(value)) {
    throw createConformanceError("fixtureShapeRejected", {
      artifact: "rust-warm-output",
      detail: `${path} must be lowercase hex bytes`,
      failureCode: "expectedString",
      path,
    });
  }
  return value;
}

function frameBytesHexToFrameByteLength(frameBytesHex: string): number {
  const frameByteLength = frameBytesHex.length / 2 - 4;
  if (!Number.isSafeInteger(frameByteLength) || frameByteLength < 0) {
    throw createConformanceError("fixtureShapeRejected", {
      artifact: "rust-warm-output",
      detail: "expected.frameBytesHex must include a frameByteLength prefix",
      failureCode: "expectedString",
      path: "expected.frameBytesHex",
    });
  }
  return frameByteLength;
}
