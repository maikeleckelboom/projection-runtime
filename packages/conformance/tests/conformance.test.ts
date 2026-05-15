import { readdirSync, readFileSync } from "node:fs";
import { cp, mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { SeqlokError } from "@seqlok/base";
import { describe, expect, expectTypeOf, it } from "vitest";

import * as conformance from "../src/index";
import {
  type ConformanceError,
  createConformanceError,
  listProjectionRuntimeFixtures,
  loadProjectionRuntimeFixture,
  type ProjectionRuntimeFixtureFailure,
  runProjectionRuntimeConformance,
  runProjectionRuntimeFixture,
} from "../src/index";

const repoRoot = resolve(fileURLToPath(new URL("../../..", import.meta.url)));
const fixtureRoot = resolve(repoRoot, "fixtures/projection-runtime");
const hotBasicFixtureRoot = resolve(fixtureRoot, "hot-basic-v0");
const conformanceSourceRoot = resolve(repoRoot, "packages/conformance/src");

function sourceText(root: string): string {
  let text = "";

  for (const entry of readdirSync(root, { withFileTypes: true })) {
    const path = resolve(root, entry.name);
    if (entry.isDirectory()) {
      text += sourceText(path);
      continue;
    }

    if (entry.isFile() && entry.name.endsWith(".ts")) {
      text += readFileSync(path, "utf8");
    }
  }

  return text;
}

describe("@seqlok/conformance fixture discovery", () => {
  it("discovers hot-basic-v0", async () => {
    await expect(listProjectionRuntimeFixtures()).resolves.toContain("hot-basic-v0");
  });

  it("returns deterministic ASCII code-unit discovery order", async () => {
    await withTempFixtureRoot(async (root) => {
      await mkdir(resolve(root, "z-fixture"));
      await mkdir(resolve(root, "a-fixture"));
      await mkdir(resolve(root, "Z-fixture"));
      await mkdir(resolve(root, "A-fixture"));
      await mkdir(resolve(root, "_fixture"));
      await mkdir(resolve(root, "0-fixture"));
      await writeFile(resolve(root, "not-a-fixture.txt"), "");

      await expect(listProjectionRuntimeFixtures({ fixtureRoot: root })).resolves.toEqual([
        "0-fixture",
        "A-fixture",
        "Z-fixture",
        "_fixture",
        "a-fixture",
        "z-fixture",
      ]);
    });
  });
});

describe("@seqlok/conformance fixture loading", () => {
  it("loads every required hot-basic-v0 artifact", async () => {
    const fixture = await loadProjectionRuntimeFixture("hot-basic-v0");

    expect(fixture.fixtureName).toBe("hot-basic-v0");
    expect(fixture.fixturePath).toBe("fixtures/projection-runtime/hot-basic-v0");
    expect(fixture.artifacts.readme).toContain("# hot-basic-v0");
    expect(fixture.artifacts.authoredContract).toMatchObject({ key: "fixture.hotBasic" });
    expect(fixture.artifacts.canonicalManifest).toMatchObject({ key: "fixture.hotBasic" });
    expect(fixture.artifacts.hotLayoutManifest).toMatchObject({
      contractKey: "fixture.hotBasic",
    });
    expect(fixture.artifacts.hotByteFixture).toMatchObject({
      fixtureKind: "hot-byte-fixture",
      contractKey: "fixture.hotBasic",
    });
    expect(fixture.artifacts.hotBlockAFixture).toMatchObject({
      fixtureKind: "hot-block-a-fixture",
      contractKey: "fixture.hotBasic",
    });
    expect(fixture.artifacts.hotBlockBFixture).toMatchObject({
      fixtureKind: "hot-block-b-fixture",
      seqlockCounter: "0000000000000002",
    });
    expect(fixture.artifacts.hotCompleteFixtureRegion).toMatchObject({
      fixtureKind: "hot-complete-fixture-region",
      contractKey: "fixture.hotBasic",
      instanceKey: "hot-basic-v0.instance",
    });
    expect(fixture.artifacts.resolvedContract).toMatchObject({
      manifest: { key: "fixture.hotBasic" },
    });
  });

  it("loads hot-basic-v0 hot-byte-fixture.json with layout-matched metadata", async () => {
    const fixture = await loadProjectionRuntimeFixture("hot-basic-v0");
    const hotLayoutManifest = cloneRecord(fixture.artifacts.hotLayoutManifest);
    const hotByteFixture = cloneRecord(fixture.artifacts.hotByteFixture);
    const expected = cloneRecord(hotByteFixture.expected);

    expect(hotByteFixture.hotLayoutVersion).toBe(hotLayoutManifest.hotLayoutVersion);
    expect(hotByteFixture.totalRegionByteLength).toBe(hotLayoutManifest.totalRegionByteLength);
    expect(hotByteFixture.fieldDataOrigin).toBe(96);
    expect(hotByteFixture.values).toEqual({
      cursor: 123,
      health: "warn",
      level: 0.75,
      peaks: [0.125, 0.25, 0.5],
      phase: 12.5,
    });
    expect(expected.decodedValues).toEqual(hotByteFixture.values);
  });

  it("reports missing required fixture files explicitly", async () => {
    await withTempFixtureRoot(async (root) => {
      const copiedFixtureRoot = resolve(root, "broken-fixture");
      await cp(hotBasicFixtureRoot, copiedFixtureRoot, { recursive: true });
      await rm(resolve(copiedFixtureRoot, "hot-layout-manifest.json"));

      const result = await runProjectionRuntimeFixture("broken-fixture", { fixtureRoot: root });

      expect(result).toMatchObject({
        fixtureName: "broken-fixture",
        passed: false,
      });
      expect(result.failures).toEqual([
        expect.objectContaining({
          artifact: "fixture-file",
          failureCode: "missingRequiredFixtureFile",
          fixtureFile: "hot-layout-manifest.json",
        }),
      ]);
      expect(result.failures[0]?.relativePath).toContain("broken-fixture/hot-layout-manifest.json");
    });
  });

  it("loads hot-basic-v0 hot-block-a-fixture.json with layout-matched metadata", async () => {
    const fixture = await loadProjectionRuntimeFixture("hot-basic-v0");
    const hotLayoutManifest = cloneRecord(fixture.artifacts.hotLayoutManifest);
    const hotBlockAFixture = cloneRecord(fixture.artifacts.hotBlockAFixture);

    expect(hotBlockAFixture.hotLayoutVersion).toBe(hotLayoutManifest.hotLayoutVersion);
    expect(hotBlockAFixture.fieldCount).toBe(hotLayoutManifest.fields.length);
    expect(hotBlockAFixture.mutableRegionByteLength).toBe(
      hotLayoutManifest.mutableRegionByteLength,
    );
    expect(hotBlockAFixture.semanticVersion).toBe(
      (fixture.artifacts.resolvedContract as Record<string, unknown>).semanticVersion,
    );
    expect(hotBlockAFixture.instanceKey).toBe("hot-basic-v0.instance");
  });

  it("reports missing hot-byte-fixture.json explicitly", async () => {
    await withTempFixtureRoot(async (root) => {
      const copiedFixtureRoot = resolve(root, "broken-fixture");
      await cp(hotBasicFixtureRoot, copiedFixtureRoot, { recursive: true });
      await rm(resolve(copiedFixtureRoot, "hot-byte-fixture.json"));

      const result = await runProjectionRuntimeFixture("broken-fixture", { fixtureRoot: root });

      expect(result).toMatchObject({
        fixtureName: "broken-fixture",
        passed: false,
      });
      expect(result.failures).toEqual([
        expect.objectContaining({
          artifact: "fixture-file",
          failureCode: "missingRequiredFixtureFile",
          fixtureFile: "hot-byte-fixture.json",
        }),
      ]);
      expect(result.failures[0]?.relativePath).toContain("broken-fixture/hot-byte-fixture.json");
    });
  });

  it("reports missing hot-block-a-fixture.json explicitly", async () => {
    await withTempFixtureRoot(async (root) => {
      const copiedFixtureRoot = resolve(root, "broken-fixture");
      await cp(hotBasicFixtureRoot, copiedFixtureRoot, { recursive: true });
      await rm(resolve(copiedFixtureRoot, "hot-block-a-fixture.json"));

      const result = await runProjectionRuntimeFixture("broken-fixture", { fixtureRoot: root });

      expect(result).toMatchObject({
        fixtureName: "broken-fixture",
        passed: false,
      });
      expect(result.failures).toEqual([
        expect.objectContaining({
          artifact: "fixture-file",
          failureCode: "missingRequiredFixtureFile",
          fixtureFile: "hot-block-a-fixture.json",
        }),
      ]);
      expect(result.failures[0]?.relativePath).toContain("broken-fixture/hot-block-a-fixture.json");
    });
  });

  it("loads hot-basic-v0 hot-block-b-fixture.json with deterministic metadata", async () => {
    const fixture = await loadProjectionRuntimeFixture("hot-basic-v0");
    const hotBlockBFixture = cloneRecord(fixture.artifacts.hotBlockBFixture);
    const expected = cloneRecord(hotBlockBFixture.expected);

    expect(hotBlockBFixture).toMatchObject({
      fixtureKind: "hot-block-b-fixture",
      seqlockCounter: "0000000000000002",
      baselineEpoch: 7,
      continuityGeneration: 3,
      publicationSequence: "000000000000002a",
    });
    expect(expected.blockBBytesHex).toBe("020000000000000007000000030000002a00000000000000");
    expect(expected.decoded).toEqual({
      seqlockCounter: "0000000000000002",
      baselineEpoch: 7,
      continuityGeneration: 3,
      publicationSequence: "000000000000002a",
    });
  });

  it("reports missing hot-block-b-fixture.json explicitly", async () => {
    await withTempFixtureRoot(async (root) => {
      const copiedFixtureRoot = resolve(root, "broken-fixture");
      await cp(hotBasicFixtureRoot, copiedFixtureRoot, { recursive: true });
      await rm(resolve(copiedFixtureRoot, "hot-block-b-fixture.json"));

      const result = await runProjectionRuntimeFixture("broken-fixture", { fixtureRoot: root });

      expect(result).toMatchObject({
        fixtureName: "broken-fixture",
        passed: false,
      });
      expect(result.failures).toEqual([
        expect.objectContaining({
          artifact: "fixture-file",
          failureCode: "missingRequiredFixtureFile",
          fixtureFile: "hot-block-b-fixture.json",
        }),
      ]);
      expect(result.failures[0]?.relativePath).toContain("broken-fixture/hot-block-b-fixture.json");
    });
  });

  it("loads hot-basic-v0 hot-complete-fixture-region.json with deterministic slices", async () => {
    const fixture = await loadProjectionRuntimeFixture("hot-basic-v0");
    const hotLayoutManifest = cloneRecord(fixture.artifacts.hotLayoutManifest);
    const hotCompleteFixtureRegion = cloneRecord(fixture.artifacts.hotCompleteFixtureRegion);
    const decoded = cloneRecord(hotCompleteFixtureRegion.decoded);

    expect(hotCompleteFixtureRegion).toMatchObject({
      fixtureKind: "hot-complete-fixture-region",
      contractKey: "fixture.hotBasic",
      instanceKey: "hot-basic-v0.instance",
      hotLayoutVersion: hotLayoutManifest.hotLayoutVersion,
      totalRegionByteLength: hotLayoutManifest.totalRegionByteLength,
    });
    expect(typeof hotCompleteFixtureRegion.blockABytesHex).toBe("string");
    expect(typeof hotCompleteFixtureRegion.blockBBytesHex).toBe("string");
    expect(typeof hotCompleteFixtureRegion.fieldBytesHex).toBe("string");
    expect(typeof hotCompleteFixtureRegion.completeFixtureRegionBytesHex).toBe("string");
    expect(decoded.fieldValues).toEqual({
      cursor: 123,
      health: "warn",
      level: 0.75,
      peaks: [0.125, 0.25, 0.5],
      phase: 12.5,
    });
  });

  it("reports missing hot-complete-fixture-region.json explicitly", async () => {
    await withTempFixtureRoot(async (root) => {
      const copiedFixtureRoot = resolve(root, "broken-fixture");
      await cp(hotBasicFixtureRoot, copiedFixtureRoot, { recursive: true });
      await rm(resolve(copiedFixtureRoot, "hot-complete-fixture-region.json"));

      const result = await runProjectionRuntimeFixture("broken-fixture", { fixtureRoot: root });

      expect(result).toMatchObject({
        fixtureName: "broken-fixture",
        passed: false,
      });
      expect(result.failures).toEqual([
        expect.objectContaining({
          artifact: "fixture-file",
          failureCode: "missingRequiredFixtureFile",
          fixtureFile: "hot-complete-fixture-region.json",
        }),
      ]);
      expect(result.failures[0]?.relativePath).toContain(
        "broken-fixture/hot-complete-fixture-region.json",
      );
    });
  });
});

describe("@seqlok/conformance execution", () => {
  it("passes hot-basic-v0 conformance", async () => {
    const result = await runProjectionRuntimeFixture("hot-basic-v0");

    expect(result).toEqual({
      fixtureName: "hot-basic-v0",
      fixturePath: "fixtures/projection-runtime/hot-basic-v0",
      passed: true,
      failures: [],
    });
  });

  it("passes aggregate projection-runtime conformance", async () => {
    const result = await runProjectionRuntimeConformance();

    expect(result.totalCount).toBeGreaterThanOrEqual(1);
    expect(result.passedCount).toBe(result.totalCount);
    expect(result.failedCount).toBe(0);
    expect(result.fixtures.map((fixture) => fixture.fixtureName)).toContain("hot-basic-v0");
  });

  it("reports canonical-manifest failures for changed in-memory expected manifests", async () => {
    const fixture = await loadProjectionRuntimeFixture("hot-basic-v0");
    const canonicalManifest = cloneRecord(fixture.artifacts.canonicalManifest);
    canonicalManifest.key = "fixture.changed";

    const result = await runProjectionRuntimeFixture(fixture, {
      expectedArtifacts: { canonicalManifest },
    });

    expectFailure(result.failures, "canonical-manifest");
    expect(result).toMatchObject({
      fixtureName: "hot-basic-v0",
      fixturePath: "fixtures/projection-runtime/hot-basic-v0",
      passed: false,
    });
  });

  it("reports hot-layout-manifest failures for changed in-memory expected layouts", async () => {
    const fixture = await loadProjectionRuntimeFixture("hot-basic-v0");
    const hotLayoutManifest = cloneRecord(fixture.artifacts.hotLayoutManifest);
    hotLayoutManifest.totalRegionByteLength = 999;

    const result = await runProjectionRuntimeFixture(fixture, {
      expectedArtifacts: { hotLayoutManifest },
    });

    expectFailure(result.failures, "hot-layout-manifest");
  });

  it("reports hot-byte-fixture failures for changed in-memory expected bytes", async () => {
    const fixture = await loadProjectionRuntimeFixture("hot-basic-v0");
    const hotByteFixture = cloneRecord(fixture.artifacts.hotByteFixture);
    const expected = cloneRecord(hotByteFixture.expected);
    expected.fieldBytesHex = "00";
    hotByteFixture.expected = expected;

    const result = await runProjectionRuntimeFixture(fixture, {
      expectedArtifacts: { hotByteFixture },
    });

    const failure = expectFailure(result.failures, "hot-byte-fixture");
    expect(failure.reason).toBe("hot-byte-fixture does not match golden artifact");
  });

  it("reports hot-block-a-fixture failures for changed in-memory expected bytes", async () => {
    const fixture = await loadProjectionRuntimeFixture("hot-basic-v0");
    const hotBlockAFixture = cloneRecord(fixture.artifacts.hotBlockAFixture);
    const expected = cloneRecord(hotBlockAFixture.expected);
    expected.blockABytesHex = "00";
    hotBlockAFixture.expected = expected;

    const result = await runProjectionRuntimeFixture(fixture, {
      expectedArtifacts: { hotBlockAFixture },
    });

    const failure = expectFailure(result.failures, "hot-block-a-fixture");
    expect(failure.reason).toBe("hot-block-a-fixture does not match golden artifact");
  });

  it("reports hot-block-b-fixture failures for changed in-memory expected bytes", async () => {
    const fixture = await loadProjectionRuntimeFixture("hot-basic-v0");
    const hotBlockBFixture = cloneRecord(fixture.artifacts.hotBlockBFixture);
    const expected = cloneRecord(hotBlockBFixture.expected);
    expected.blockBBytesHex = "000000000000000007000000030000002a00000000000000";
    hotBlockBFixture.expected = expected;

    const result = await runProjectionRuntimeFixture(fixture, {
      expectedArtifacts: { hotBlockBFixture },
    });

    const failure = expectFailure(result.failures, "hot-block-b-fixture");
    expect(failure.failureCode).toBe("headerValidationFailed");
    expect(failure.reason).toContain("hot-block-b-fixture validation failed");
  });

  it("reports hot-complete-fixture-region failures for changed in-memory expected bytes", async () => {
    const fixture = await loadProjectionRuntimeFixture("hot-basic-v0");
    const hotCompleteFixtureRegion = cloneRecord(fixture.artifacts.hotCompleteFixtureRegion);
    const decoded = cloneRecord(hotCompleteFixtureRegion.decoded);
    decoded.fieldValues = { cursor: 999 };
    hotCompleteFixtureRegion.decoded = decoded;

    const result = await runProjectionRuntimeFixture(fixture, {
      expectedArtifacts: { hotCompleteFixtureRegion },
    });

    const failure = expectFailure(result.failures, "hot-complete-fixture-region");
    expect(failure.reason).toBe("hot-complete-fixture-region does not match golden artifact");
  });

  it("reports resolved-contract failures for changed in-memory expected contracts", async () => {
    const fixture = await loadProjectionRuntimeFixture("hot-basic-v0");
    const resolvedContract = cloneRecord(fixture.artifacts.resolvedContract);
    resolvedContract.semanticVersion = "0000000000000000";

    const result = await runProjectionRuntimeFixture(fixture, {
      expectedArtifacts: { resolvedContract },
    });

    expectFailure(result.failures, "resolved-contract");
  });

  it("reports hot-layout-version failures when top-level and lane versions diverge", async () => {
    const fixture = await loadProjectionRuntimeFixture("hot-basic-v0");
    const resolvedContract = cloneRecord(fixture.artifacts.resolvedContract);
    resolvedContract.hotLayoutVersion = "0000000000000000";

    const result = await runProjectionRuntimeFixture(fixture, {
      expectedArtifacts: { resolvedContract },
    });

    expectFailure(result.failures, "hot-layout-version");
  });

  it("reports expectedU64Hex for malformed hot-block-b-fixture seqlockCounter", async () => {
    const fixture = await loadProjectionRuntimeFixture("hot-basic-v0");
    const hotBlockBFixture = cloneRecord(fixture.artifacts.hotBlockBFixture);
    hotBlockBFixture.seqlockCounter = "0x0000000000000002";

    const result = await runProjectionRuntimeFixture(fixture, {
      expectedArtifacts: { hotBlockBFixture },
    });

    const failure = expectFailure(result.failures, "hot-block-b-fixture");
    expect(failure.failureCode).toBe("expectedU64Hex");
  });

  it("reports expectedU64Hex for malformed hot-block-b-fixture publicationSequence", async () => {
    const fixture = await loadProjectionRuntimeFixture("hot-basic-v0");
    const hotBlockBFixture = cloneRecord(fixture.artifacts.hotBlockBFixture);
    hotBlockBFixture.publicationSequence = "000000000000002A";

    const result = await runProjectionRuntimeFixture(fixture, {
      expectedArtifacts: { hotBlockBFixture },
    });

    const failure = expectFailure(result.failures, "hot-block-b-fixture");
    expect(failure.failureCode).toBe("expectedU64Hex");
  });

  it("reports expectedU64Hex for malformed hot-block-a-fixture semanticVersion", async () => {
    const fixture = await loadProjectionRuntimeFixture("hot-basic-v0");
    const hotBlockAFixture = cloneRecord(fixture.artifacts.hotBlockAFixture);
    hotBlockAFixture.semanticVersion = "000000000000000g";

    const result = await runProjectionRuntimeFixture(fixture, {
      expectedArtifacts: { hotBlockAFixture },
    });

    const failure = expectFailure(result.failures, "hot-block-a-fixture");
    expect(failure.failureCode).toBe("expectedU64Hex");
  });

  it("reports expectedU64Hex for malformed hot-block-a-fixture hotLayoutVersion", async () => {
    const fixture = await loadProjectionRuntimeFixture("hot-basic-v0");
    const hotBlockAFixture = cloneRecord(fixture.artifacts.hotBlockAFixture);
    hotBlockAFixture.hotLayoutVersion = "000000000000002";

    const result = await runProjectionRuntimeFixture(fixture, {
      expectedArtifacts: { hotBlockAFixture },
    });

    const failure = expectFailure(result.failures, "hot-block-a-fixture");
    expect(failure.failureCode).toBe("expectedU64Hex");
  });

  it("includes fixture name and artifact-specific failure details", async () => {
    const fixture = await loadProjectionRuntimeFixture("hot-basic-v0");
    const canonicalManifest = cloneRecord(fixture.artifacts.canonicalManifest);
    canonicalManifest.family = "changed";

    const result = await runProjectionRuntimeFixture(fixture, {
      expectedArtifacts: { canonicalManifest },
    });
    const failure = expectFailure(result.failures, "canonical-manifest");

    expect(result.fixtureName).toBe("hot-basic-v0");
    expect(result.fixturePath).toBe("fixtures/projection-runtime/hot-basic-v0");
    expect(failure.reason).toBe("canonical-manifest does not match golden artifact");
    expect(failure.expected).toMatchObject({ family: "changed" });
    expect(failure.actual).toMatchObject({ family: "replaceable-snapshot" });
  });
});

describe("@seqlok/conformance error model", () => {
  it("conformance fixture-file errors are SeqlokError values with domain-coded code", () => {
    const error: ConformanceError = createConformanceError("fixtureFileRejected", {
      failureCode: "invalidFixtureName",
      fixtureName: "test",
    });
    expect(error).toBeInstanceOf(SeqlokError);
    expect(error.code).toBe("conformance.fixtureFileRejected");
    expect(error.details.fixtureName).toBe("test");
    expect(error.details.failureCode).toBe("invalidFixtureName");
  });

  it("fixture-file failure carries stable code and details", async () => {
    await withTempFixtureRoot(async (root) => {
      const copiedFixtureRoot = resolve(root, "broken-fixture");
      await cp(hotBasicFixtureRoot, copiedFixtureRoot, { recursive: true });
      await rm(resolve(copiedFixtureRoot, "hot-layout-manifest.json"));

      const result = await runProjectionRuntimeFixture("broken-fixture", { fixtureRoot: root });

      expect(result.passed).toBe(false);
      expect(result.failures).toEqual([
        expect.objectContaining({
          artifact: "fixture-file",
          failureCode: "missingRequiredFixtureFile",
        }),
      ]);
    });
  });

  it("has no production generic Error subclass construction", () => {
    const text = sourceText(conformanceSourceRoot);
    expect(text).not.toContain("throw new Error");
    expect(text).not.toContain("throw new RangeError");
    expect(text).not.toContain("throw new TypeError");
  });

  it("has no production code: string in issue types", () => {
    const text = sourceText(conformanceSourceRoot);
    expect(text).not.toMatch(/code\s*:\s*string/);
  });

  it("has no production runtime conformance error subclass or subclass checks", () => {
    const text = sourceText(conformanceSourceRoot);
    expect(text).not.toContain("class ConformanceError");
    expect(text).not.toContain("instanceof ConformanceError");
    expect(text).not.toContain("issueCode?: string");
  });
});

describe("@seqlok/conformance public surface", () => {
  it("does not export a runtime ConformanceError class", () => {
    expect("ConformanceError" in conformance).toBe(false);
    expect("createConformanceError" in conformance).toBe(true);
    expect("isConformanceError" in conformance).toBe(true);
  });

  it("exports the intended conformance type surface", () => {
    expectTypeOf<ConformanceError["code"]>().toEqualTypeOf<
      | "conformance.fixtureFileRejected"
      | "conformance.fixtureShapeRejected"
      | "conformance.fixtureArtifactMismatch"
      | "conformance.fixtureCompileRejected"
    >();
  });
});

async function withTempFixtureRoot(callback: (root: string) => Promise<void>): Promise<void> {
  const root = await mkdir(resolve(tmpdir(), `seqlok-conformance-${process.pid}-${Date.now()}`), {
    recursive: true,
  });

  if (root === undefined) {
    throw new Error("failed to create temporary fixture root");
  }

  try {
    await callback(root);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
}

function cloneRecord(value: unknown): Record<string, unknown> {
  return structuredClone(value) as Record<string, unknown>;
}

function expectFailure(
  failures: readonly ProjectionRuntimeFixtureFailure[],
  artifact: ProjectionRuntimeFixtureFailure["artifact"],
): ProjectionRuntimeFixtureFailure {
  const failure = failures.find((entry) => entry.artifact === artifact);
  expect(failure).toBeDefined();

  if (failure === undefined) {
    throw new Error(`expected ${artifact} failure`);
  }

  return failure;
}
