import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { cp, mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { ExclaveError } from "@exclave/base";
import { decodeHotCompleteFixtureRegion, hexToBytes } from "@exclave/hot-codec";
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
const GENERATED_FIXTURE_FILES = [
  "canonical-manifest.json",
  "hot-layout-manifest.json",
  "hot-byte-fixture.json",
  "hot-block-a-fixture.json",
  "hot-block-b-fixture.json",
  "hot-complete-fixture-region.json",
  "resolved-contract.json",
] as const;

describe("@exclave/conformance fixture discovery", () => {
  it("discovers all checked-in projection-runtime fixtures", async () => {
    await expect(listProjectionRuntimeFixtures()).resolves.toEqual(
      expect.arrayContaining(["deck-runtime-v0", "hot-basic-v0", "hot-exchange-v0"]),
    );
  });

  it("returns deterministic ASCII code-unit discovery order", async () => {
    await withTempFixtureRoot(async (root) => {
      await mkdir(resolve(root, "y-fixture"));
      await mkdir(resolve(root, "b-fixture"));
      await mkdir(resolve(root, "A-fixture"));
      await mkdir(resolve(root, "_fixture"));
      await mkdir(resolve(root, "0-fixture"));
      await writeFile(resolve(root, "not-a-fixture.txt"), "");

      await expect(listProjectionRuntimeFixtures({ fixtureRoot: root })).resolves.toEqual([
        "0-fixture",
        "A-fixture",
        "_fixture",
        "b-fixture",
        "y-fixture",
      ]);
    });
  });
});

describe("@exclave/conformance fixture loading", () => {
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

  it("loads deck-runtime-v0 with product-shaped hot values", async () => {
    const fixture = await loadProjectionRuntimeFixture("deck-runtime-v0");
    const hotByteFixture = cloneRecord(fixture.artifacts.hotByteFixture);
    const expected = cloneRecord(hotByteFixture.expected);

    expect(fixture.fixtureName).toBe("deck-runtime-v0");
    expect(fixture.fixturePath).toBe("fixtures/projection-runtime/deck-runtime-v0");
    expect(fixture.artifacts.authoredContract).toMatchObject({ key: "fixture.deckRuntime" });
    expect(fixture.artifacts.hotLayoutManifest).toMatchObject({
      contractKey: "fixture.deckRuntime",
    });
    expect(hotByteFixture.values).toEqual({
      beatPhase01: 0.375,
      level: 0.8125,
      loopActive: true,
      mediaTimeSeconds: 98.125,
      samplePosition: "0000000000420b00",
      stemGains: [1, 0.875, 0.5, 0.25],
      tempoRatio: 1.025,
      transportState: "playing",
    });
    expect(expected.decodedValues).toEqual({
      ...hotByteFixture.values,
      tempoRatio: 1.024999976158142,
    });
  });

  it("loads hot-exchange-v0 with fixture-backed hot exchange values", async () => {
    const fixture = await loadProjectionRuntimeFixture("hot-exchange-v0");
    const hotByteFixture = cloneRecord(fixture.artifacts.hotByteFixture);
    const expected = cloneRecord(hotByteFixture.expected);

    expect(fixture.fixtureName).toBe("hot-exchange-v0");
    expect(fixture.fixturePath).toBe("fixtures/projection-runtime/hot-exchange-v0");
    expect(fixture.artifacts.authoredContract).toMatchObject({
      key: "fixture.hotExchange.v0",
    });
    expect(fixture.artifacts.hotLayoutManifest).toMatchObject({
      contractKey: "fixture.hotExchange.v0",
      totalRegionByteLength: 152,
    });
    expect(hotByteFixture.values).toEqual({
      displayName: "deckA-hot",
      gain: 0.625,
      levelVector: [0.125, 0.25, 0.5, 1],
      phase: 128.5,
      revision: 57_005,
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

describe("@exclave/conformance execution", () => {
  it("passes hot-basic-v0 conformance", async () => {
    const result = await runProjectionRuntimeFixture("hot-basic-v0");

    expect(result).toEqual({
      fixtureName: "hot-basic-v0",
      fixturePath: "fixtures/projection-runtime/hot-basic-v0",
      passed: true,
      failures: [],
    });
  });

  it("passes deck-runtime-v0 conformance", async () => {
    const result = await runProjectionRuntimeFixture("deck-runtime-v0");

    expect(result).toEqual({
      fixtureName: "deck-runtime-v0",
      fixturePath: "fixtures/projection-runtime/deck-runtime-v0",
      passed: true,
      failures: [],
    });
  });

  it("passes hot-exchange-v0 conformance", async () => {
    const result = await runProjectionRuntimeFixture("hot-exchange-v0");

    expect(result).toEqual({
      fixtureName: "hot-exchange-v0",
      fixturePath: "fixtures/projection-runtime/hot-exchange-v0",
      passed: true,
      failures: [],
    });
  });

  it("passes aggregate projection-runtime conformance", async () => {
    const result = await runProjectionRuntimeConformance();

    expect(result.totalCount).toBeGreaterThanOrEqual(3);
    expect(result.passedCount).toBe(result.totalCount);
    expect(result.failedCount).toBe(0);
    expect(result.fixtures.map((fixture) => fixture.fixtureName)).toEqual(
      expect.arrayContaining(["deck-runtime-v0", "hot-basic-v0", "hot-exchange-v0"]),
    );
  });

  it("decodes deck-runtime-v0 complete fixture region through the public hot codec", async () => {
    const fixture = await loadProjectionRuntimeFixture("deck-runtime-v0");
    const hotLayoutManifest = decodeHotLayoutManifestFixture(fixture.artifacts.hotLayoutManifest);
    const completeRegion = cloneRecord(fixture.artifacts.hotCompleteFixtureRegion);
    const bytes = hexToBytes(completeRegion.completeFixtureRegionBytesHex as string);
    const decoded = decodeHotCompleteFixtureRegion(hotLayoutManifest, bytes, {
      expectedContractKey: "fixture.deckRuntime",
      expectedInstanceKey: "deck-runtime-v0.instance",
    });

    expect(decoded.fieldValues).toEqual({
      beatPhase01: 0.375,
      level: 0.8125,
      loopActive: true,
      mediaTimeSeconds: 98.125,
      samplePosition: 4_328_192n,
      stemGains: [1, 0.875, 0.5, 0.25],
      tempoRatio: 1.024999976158142,
      transportState: "playing",
    });
  });

  it("decodes hot-exchange-v0 complete fixture region through the public hot codec", async () => {
    const fixture = await loadProjectionRuntimeFixture("hot-exchange-v0");
    const hotLayoutManifest = decodeHotLayoutManifestFixture(fixture.artifacts.hotLayoutManifest);
    const completeRegion = cloneRecord(fixture.artifacts.hotCompleteFixtureRegion);
    const bytes = hexToBytes(completeRegion.completeFixtureRegionBytesHex as string);
    const decoded = decodeHotCompleteFixtureRegion(hotLayoutManifest, bytes, {
      expectedContractKey: "fixture.hotExchange.v0",
      expectedInstanceKey: "hot-exchange-v0.instance",
    });

    expect(decoded.fieldValues).toEqual({
      displayName: "deckA-hot",
      gain: 0.625,
      levelVector: [0.125, 0.25, 0.5, 1],
      phase: 128.5,
      revision: 57_005,
    });
  });

  it("regenerates projection-runtime fixture artifacts deterministically", () => {
    const before = readGeneratedFixtureFiles([
      "hot-basic-v0",
      "deck-runtime-v0",
      "hot-exchange-v0",
    ]);

    execFileSync("node", ["scripts/write-projection-runtime-fixture.mts"], {
      cwd: repoRoot,
      stdio: "pipe",
    });

    expect(
      readGeneratedFixtureFiles(["hot-basic-v0", "deck-runtime-v0", "hot-exchange-v0"]),
    ).toEqual(before);
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

  it("reports malformed Block A contract key hash as hot-complete-fixture-region failure", async () => {
    const fixture = await loadProjectionRuntimeFixture("hot-basic-v0");
    const hotCompleteFixtureRegion = cloneRecord(fixture.artifacts.hotCompleteFixtureRegion);
    hotCompleteFixtureRegion.completeFixtureRegionBytesHex =
      "53514c4b01000000000000000000000000000000000000006bfdf9c4ab5400e4eb43e196fac78389a0066b1cf371b2675c4988fd97b83e8f05000000400000000000000000000000020000000000000007000000030000002a000000000000007b000000010000000000403f030000000000003e0000803e0000003f000000000000000000002940";

    const result = await runProjectionRuntimeFixture(fixture, {
      expectedArtifacts: { hotCompleteFixtureRegion },
    });

    const failure = expectFailure(result.failures, "hot-complete-fixture-region");
    expect(failure.failureCode).toBe("artifactMismatch");
  });

  it("reports malformed Block A instance key hash as hot-complete-fixture-region failure", async () => {
    const fixture = await loadProjectionRuntimeFixture("hot-basic-v0");
    const hotCompleteFixtureRegion = cloneRecord(fixture.artifacts.hotCompleteFixtureRegion);
    hotCompleteFixtureRegion.instanceKey = "wrong.instance";

    const result = await runProjectionRuntimeFixture(fixture, {
      expectedArtifacts: { hotCompleteFixtureRegion },
    });

    const failure = expectFailure(result.failures, "hot-complete-fixture-region");
    expect(failure.failureCode).toBe("artifactMismatch");
  });

  it("reports malformed complete-region field-data slice as hot-complete-fixture-region failure", async () => {
    const fixture = await loadProjectionRuntimeFixture("hot-basic-v0");
    const hotCompleteFixtureRegion = cloneRecord(fixture.artifacts.hotCompleteFixtureRegion);
    hotCompleteFixtureRegion.fieldBytesHex = "00";

    const result = await runProjectionRuntimeFixture(fixture, {
      expectedArtifacts: { hotCompleteFixtureRegion },
    });

    const failure = expectFailure(result.failures, "hot-complete-fixture-region");
    expect(failure.failureCode).toBe("artifactMismatch");
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

describe("@exclave/conformance error model", () => {
  it("conformance fixture-file errors are ExclaveError values with domain-coded code", () => {
    const error: ConformanceError = createConformanceError("fixtureFileRejected", {
      failureCode: "invalidFixtureName",
      fixtureName: "test",
    });
    expect(error).toBeInstanceOf(ExclaveError);
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
});

describe("@exclave/conformance internal topology", () => {
  it("keeps run.ts as the projection-runtime orchestration surface", () => {
    const runSource = readFileSync(resolve(conformanceSourceRoot, "run.ts"), "utf8");

    expect(runSource).toContain("export async function runProjectionRuntimeFixture");
    expect(runSource).toContain("export async function runProjectionRuntimeConformance");
  });
});

describe("@exclave/conformance public surface", () => {
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
  const root = await mkdir(resolve(tmpdir(), `exclave-conformance-${process.pid}-${Date.now()}`), {
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

function decodeHotLayoutManifestFixture(value: unknown) {
  const hotLayoutManifest = cloneRecord(value);
  const hotLayoutVersion = hotLayoutManifest.hotLayoutVersion;

  if (typeof hotLayoutVersion !== "string") {
    throw new Error("hot layout fixture version must be a hex string");
  }

  return {
    ...hotLayoutManifest,
    hotLayoutVersion: BigInt(`0x${hotLayoutVersion}`),
  };
}

function readGeneratedFixtureFiles(
  fixtureNames: readonly ["hot-basic-v0", "deck-runtime-v0", "hot-exchange-v0"][number][],
): Record<string, string> {
  return Object.fromEntries(
    fixtureNames.flatMap((fixtureName) =>
      GENERATED_FIXTURE_FILES.map((fileName) => [
        `${fixtureName}/${fileName}`,
        readFileSync(resolve(fixtureRoot, fixtureName, fileName), "utf8"),
      ]),
    ),
  );
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
