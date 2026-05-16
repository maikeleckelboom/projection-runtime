import { execFileSync, spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { cp, mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { ExclaveError } from "@exclave/base";
import { type HotBindingError, isHotBindingError } from "@exclave/hot-binding";
import {
  bytesToHex,
  decodeHotCompleteFixtureRegion,
  HOT_BASELINE_EPOCH_U32_OFFSET,
  HOT_CONTINUITY_GENERATION_U32_OFFSET,
  HOT_PUBLICATION_SEQUENCE_U64_OFFSET,
  HOT_SEQLOCK_U64_OFFSET,
  hexToBytes,
} from "@exclave/hot-codec";
import { describe, expect, expectTypeOf, it } from "vitest";

import {
  createDeckRuntimeReader,
  type DeckRuntimeSnapshot,
  readDeckRuntimeSnapshotUnchecked,
} from "../../../fixtures/projection-runtime/deck-runtime-v0/generated/hot-reader.ts";
import { createDeckRuntimeWriter } from "../../../fixtures/projection-runtime/deck-runtime-v0/generated/hot-writer.ts";
import {
  createHotExchangeReader,
  type HotExchangeSnapshot,
  readHotExchangeSnapshotUnchecked,
} from "../../../fixtures/projection-runtime/hot-exchange-v0/generated/hot-reader.ts";
import { createHotExchangeWriter } from "../../../fixtures/projection-runtime/hot-exchange-v0/generated/hot-writer.ts";
import { writeGeneratedHotReader } from "../../../scripts/projection-runtime/write-generated-hot-reader.mts";
import { writeGeneratedHotWriter } from "../../../scripts/projection-runtime/write-generated-hot-writer.mts";
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
const GENERATED_HOT_ARTIFACT_FIXTURE_FILES = [
  ...GENERATED_FIXTURE_FILES,
  "generated/hot-reader.ts",
  "generated/hot-writer.ts",
  "generated/artifacts.json",
] as const;

type RustHotWriterOutput = {
  readonly fixtureKind: "rust-hot-writer-output";
  readonly fixtureName: string;
  readonly contractKey: string;
  readonly hotAbiVersion: number;
  readonly hotLayoutVersion: string;
  readonly hotRegionBytesHex: string;
  readonly snapshot: {
    readonly beatPhase01: number;
    readonly level: number;
    readonly loopActive: boolean;
    readonly mediaTimeSeconds: number;
    readonly samplePosition: string;
    readonly stemGains: readonly number[];
    readonly tempoRatio: number;
    readonly transportState: string;
  };
  readonly blockB: {
    readonly seqlockCounter: string;
    readonly baselineEpoch: number;
    readonly continuityGeneration: number;
    readonly publicationSequence: string;
  };
};

type RustHotReaderOutput = {
  readonly fixtureKind: "rust-hot-reader-output";
  readonly fixtureName: string;
  readonly contractKey: string;
  readonly hotAbiVersion: number;
  readonly hotLayoutVersion: string;
  readonly hotRegionBytesHex: string;
  readonly snapshot: {
    readonly beatPhase01: number;
    readonly level: number;
    readonly loopActive: boolean;
    readonly mediaTimeSeconds: number;
    readonly samplePosition: string;
    readonly stemGains: readonly number[];
    readonly tempoRatio: number;
    readonly transportState: string;
  };
  readonly blockB: {
    readonly seqlockCounter: string;
    readonly baselineEpoch: number;
    readonly continuityGeneration: number;
    readonly publicationSequence: string;
  };
};

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

  it("keeps generated hot artifact manifests consistent with their layout manifests", () => {
    const profiles = [
      {
        fixtureName: "hot-exchange-v0",
        symbolStem: "HotExchange",
      },
      {
        fixtureName: "deck-runtime-v0",
        symbolStem: "DeckRuntime",
      },
    ] as const;

    for (const profile of profiles) {
      const generatedRoot = resolve(fixtureRoot, profile.fixtureName, "generated");
      const artifactManifest = JSON.parse(
        readFileSync(resolve(generatedRoot, "artifacts.json"), "utf8"),
      ) as Record<string, unknown>;
      const hotLayoutManifest = JSON.parse(
        readFileSync(resolve(generatedRoot, "../hot-layout-manifest.json"), "utf8"),
      ) as Record<string, unknown>;
      const artifacts = cloneRecord(artifactManifest.artifacts);

      expect(artifactManifest).toMatchObject({
        artifactManifestVersion: 1,
        fixtureName: profile.fixtureName,
        symbolStem: profile.symbolStem,
        source: {
          hotLayoutManifest: "../hot-layout-manifest.json",
        },
        artifacts: {
          reader: "hot-reader.ts",
          writer: "hot-writer.ts",
        },
      });
      expect(readFileSync(resolve(generatedRoot, artifacts.reader as string)));
      expect(readFileSync(resolve(generatedRoot, artifacts.writer as string)));
      expect(artifactManifest.contractKey).toBe(hotLayoutManifest.contractKey);
      expect(artifactManifest.hotAbiVersion).toBe(hotLayoutManifest.hotAbiVersion);
      expect(artifactManifest.hotLayoutVersion).toBe(hotLayoutManifest.hotLayoutVersion);
    }
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

  it("reads hot-exchange-v0 through the generated contract-shaped hot reader", async () => {
    const fixture = await loadProjectionRuntimeFixture("hot-exchange-v0");
    const completeRegion = cloneRecord(fixture.artifacts.hotCompleteFixtureRegion);
    const bytes = hexToBytes(completeRegion.completeFixtureRegionBytesHex as string);
    const region = copyIntoSharedRegion(bytes);
    const reader = createHotExchangeReader(region);

    const result = reader.tryRead({
      maxWriterActivePolls: 0,
      maxTornReads: 0,
    });

    expect(result.ok).toBe(true);
    if (!result.ok) {
      throw new Error("expected generated hot-exchange reader to succeed");
    }
    expect(result.sequence).toBe(2n);
    expect(result.snapshot).toEqual(cloneRecord(completeRegion.decoded).fieldValues);
    expect(readHotExchangeSnapshotUnchecked(region)).toEqual(result.snapshot);
  });

  it("reads deck-runtime-v0 through the generated contract-shaped hot reader", async () => {
    const fixture = await loadProjectionRuntimeFixture("deck-runtime-v0");
    const completeRegion = cloneRecord(fixture.artifacts.hotCompleteFixtureRegion);
    const bytes = hexToBytes(completeRegion.completeFixtureRegionBytesHex as string);
    const region = copyIntoSharedRegion(bytes);
    const reader = createDeckRuntimeReader(region);

    const result = reader.tryRead({
      maxWriterActivePolls: 0,
      maxTornReads: 0,
    });

    expect(result.ok).toBe(true);
    if (!result.ok) {
      throw new Error("expected generated deck-runtime reader to succeed");
    }
    const expected = deckRuntimeExpectedFieldValues(completeRegion);
    expect(result.sequence).toBe(2n);
    expect(result.snapshot).toEqual(expected);
    expect(readDeckRuntimeSnapshotUnchecked(region)).toEqual(result.snapshot);
    expect(typeof result.snapshot.samplePosition).toBe("bigint");
    expect(typeof result.snapshot.loopActive).toBe("boolean");
    expect(result.snapshot.transportState).toBe("playing");
    expect(result.snapshot.stemGains).toEqual([1, 0.875, 0.5, 0.25]);
  });

  it("reads Rust-written deck-runtime-v0 hot region bytes through the generated reader", async () => {
    const artifactManifestRelativePath =
      "fixtures/projection-runtime/deck-runtime-v0/generated/artifacts.json";
    const artifactManifestPath = resolve(fixtureRoot, "deck-runtime-v0/generated/artifacts.json");
    const artifactManifest = JSON.parse(readFileSync(artifactManifestPath, "utf8")) as Record<
      string,
      unknown
    >;
    const hotLayoutManifest = JSON.parse(
      readFileSync(resolve(fixtureRoot, "deck-runtime-v0/hot-layout-manifest.json"), "utf8"),
    ) as Record<string, unknown>;
    const rustOutput = JSON.parse(
      execFileSync(
        "cargo",
        [
          "run",
          "--quiet",
          "-p",
          "hot-abi-conformance",
          "--",
          "write-deck-runtime",
          artifactManifestRelativePath,
        ],
        {
          cwd: repoRoot,
          encoding: "utf8",
        },
      ),
    ) as RustHotWriterOutput;
    const bytes = hexToBytes(rustOutput.hotRegionBytesHex);
    const region = copyIntoSharedRegion(bytes);
    const reader = createDeckRuntimeReader(region);
    const result = reader.tryRead({
      maxWriterActivePolls: 0,
      maxTornReads: 0,
    });
    const view = new DataView(region.buffer, region.byteOffset, region.byteLength);
    const existingCompleteRegion = cloneRecord(
      (await loadProjectionRuntimeFixture("deck-runtime-v0")).artifacts.hotCompleteFixtureRegion,
    );
    const expectedSnapshot = {
      beatPhase01: 0.5,
      level: 0.25,
      loopActive: false,
      mediaTimeSeconds: 128.5,
      samplePosition: 0x0020_0000_0000_0000n,
      stemGains: [0.25, 0.5],
      tempoRatio: 1.25,
      transportState: "paused",
    } satisfies DeckRuntimeSnapshot;

    expect(rustOutput).toMatchObject({
      fixtureKind: "rust-hot-writer-output",
      fixtureName: artifactManifest.fixtureName,
      contractKey: artifactManifest.contractKey,
      hotAbiVersion: artifactManifest.hotAbiVersion,
      hotLayoutVersion: artifactManifest.hotLayoutVersion,
      snapshot: {
        beatPhase01: 0.5,
        level: 0.25,
        loopActive: false,
        mediaTimeSeconds: 128.5,
        samplePosition: "0x0020000000000000",
        stemGains: [0.25, 0.5],
        tempoRatio: 1.25,
        transportState: "paused",
      },
      blockB: {
        seqlockCounter: "0x0000000000000002",
        baselineEpoch: 7,
        continuityGeneration: 3,
        publicationSequence: "0x0000000000000001",
      },
    });
    expect(rustOutput.contractKey).toBe(hotLayoutManifest.contractKey);
    expect(rustOutput.hotAbiVersion).toBe(hotLayoutManifest.hotAbiVersion);
    expect(rustOutput.hotLayoutVersion).toBe(hotLayoutManifest.hotLayoutVersion);
    expect(rustOutput.hotRegionBytesHex).toMatch(/^[\da-f]+$/);
    expect(bytes.byteLength).toBe(hotLayoutManifest.totalRegionByteLength);
    expect(
      decodeHotCompleteFixtureRegion(decodeHotLayoutManifestFixture(hotLayoutManifest), bytes, {
        expectedContractKey: "fixture.deckRuntime",
        expectedInstanceKey: "deck-runtime-v0.instance",
      }).fieldValues,
    ).toEqual(expectedSnapshot);
    expect(rustOutput.hotRegionBytesHex).not.toBe(
      existingCompleteRegion.completeFixtureRegionBytesHex,
    );

    expect(result.ok).toBe(true);
    if (!result.ok) {
      throw new Error("expected generated deck-runtime reader to consume Rust-written bytes");
    }
    expect(result.sequence).toBe(0x0000_0000_0000_0002n);
    expect(result.sequence % 2n).toBe(0n);
    expect(result.snapshot).toEqual(expectedSnapshot);
    expect(result.snapshot).not.toEqual(deckRuntimeExpectedFieldValues(existingCompleteRegion));
    expect(typeof result.snapshot.samplePosition).toBe("bigint");
    expect(typeof result.snapshot.loopActive).toBe("boolean");
    expect(result.snapshot.transportState).toBe("paused");
    expect(result.snapshot.stemGains).toEqual([0.25, 0.5]);
    expect(Atomics.load(blockBSeqlockView(region), 0)).toBe(0x0000_0000_0000_0002n);
    expect(view.getUint32(HOT_BASELINE_EPOCH_U32_OFFSET, true)).toBe(7);
    expect(view.getUint32(HOT_CONTINUITY_GENERATION_U32_OFFSET, true)).toBe(3);
    expect(Atomics.load(blockBPublicationSequenceView(region), 0)).toBe(0x0000_0000_0000_0001n);
    expect(readDeckRuntimeSnapshotUnchecked(region)).toEqual(expectedSnapshot);
  }, 30_000);

  it("rejects malformed deck-runtime-v0 Block A bytes through the Rust reader", async () => {
    const fixture = await loadProjectionRuntimeFixture("deck-runtime-v0");
    const completeRegion = cloneRecord(fixture.artifacts.hotCompleteFixtureRegion);
    const artifactManifestRelativePath =
      "fixtures/projection-runtime/deck-runtime-v0/generated/artifacts.json";

    for (const testCase of [
      {
        name: "regionMagic",
        mutate: (view: DataView) => view.setUint32(0, 0xefbe_adde, true),
        stderr: "Block A regionMagic mismatch: expected 53514c4b",
      },
      {
        name: "hotAbiVersion",
        mutate: (view: DataView) => view.setUint32(4, 2, true),
        stderr: "Block A hotAbiVersion mismatch: expected 1, got 2",
      },
      {
        name: "contractKeyHash",
        mutate: (_view: DataView, bytes: Uint8Array) => bytes.fill(0, 8, 24),
        stderr: "Block A contractKeyHash mismatch",
      },
      {
        name: "instanceKeyHash",
        mutate: (_view: DataView, bytes: Uint8Array) => bytes.fill(0, 24, 40),
        stderr: "Block A instanceKeyHash mismatch",
      },
      {
        name: "semanticVersion",
        mutate: (view: DataView) => view.setBigUint64(40, 0n, true),
        stderr: "Block A semanticVersion mismatch",
      },
      {
        name: "hotLayoutVersion",
        mutate: (view: DataView) => view.setBigUint64(48, 0n, true),
        stderr: "Block A hotLayoutVersion mismatch",
      },
      {
        name: "fieldCount",
        mutate: (view: DataView) => view.setUint32(56, 99, true),
        stderr: "Block A fieldCount mismatch: expected 8, got 99",
      },
      {
        name: "mutableRegionByteLength",
        mutate: (view: DataView) => view.setUint32(60, 99, true),
        stderr: "Block A mutableRegionByteLength mismatch: expected 88, got 99",
      },
      {
        name: "reserved",
        mutate: (_view: DataView, bytes: Uint8Array) => {
          bytes[64] = 0xff;
        },
        stderr: "Block A reserved bytes must be zero",
      },
    ] as const) {
      const bytes = hexToBytes(completeRegion.completeFixtureRegionBytesHex as string);
      const region = copyIntoSharedRegion(bytes);
      const view = new DataView(region.buffer, region.byteOffset, region.byteLength);
      testCase.mutate(view, region);
      const result = spawnSync(
        "cargo",
        [
          "run",
          "--quiet",
          "-p",
          "hot-abi-conformance",
          "--",
          "read-deck-runtime",
          artifactManifestRelativePath,
          bytesToHex(region),
        ],
        {
          cwd: repoRoot,
          encoding: "utf8",
        },
      );

      expect(result.status, testCase.name).not.toBe(0);
      expect(result.stderr, testCase.name).toContain(testCase.stderr);
    }
  }, 30_000);

  it("decodes generated TypeScript-written deck-runtime-v0 hot region bytes through the Rust reader", async () => {
    const artifactManifestRelativePath =
      "fixtures/projection-runtime/deck-runtime-v0/generated/artifacts.json";
    const artifactManifestPath = resolve(fixtureRoot, "deck-runtime-v0/generated/artifacts.json");
    const artifactManifest = JSON.parse(readFileSync(artifactManifestPath, "utf8")) as Record<
      string,
      unknown
    >;
    const hotLayoutManifest = JSON.parse(
      readFileSync(resolve(fixtureRoot, "deck-runtime-v0/hot-layout-manifest.json"), "utf8"),
    ) as Record<string, unknown>;
    const fixture = await loadProjectionRuntimeFixture("deck-runtime-v0");
    const completeRegion = cloneRecord(fixture.artifacts.hotCompleteFixtureRegion);
    const bytes = hexToBytes(completeRegion.completeFixtureRegionBytesHex as string);
    const region = copyIntoSharedRegion(bytes);
    const previousSeqlockCounter = Atomics.load(blockBSeqlockView(region), 0);
    const previousPublicationSequence = Atomics.load(blockBPublicationSequenceView(region), 0);
    const writer = createDeckRuntimeWriter(region);
    const snapshot = {
      beatPhase01: 0.375,
      level: 0.8125,
      loopActive: true,
      mediaTimeSeconds: 98.125,
      samplePosition: 0x0000_0000_0042_0b00n,
      stemGains: [1, 0.875],
      tempoRatio: 1.025,
      transportState: "playing",
    } satisfies DeckRuntimeSnapshot;

    const publishResult = writer.publish(snapshot);
    const hotRegionBytesHex = bytesToHex(region);
    const rustOutput = JSON.parse(
      execFileSync(
        "cargo",
        [
          "run",
          "--quiet",
          "-p",
          "hot-abi-conformance",
          "--",
          "read-deck-runtime",
          artifactManifestRelativePath,
          hotRegionBytesHex,
        ],
        {
          cwd: repoRoot,
          encoding: "utf8",
        },
      ),
    ) as RustHotReaderOutput;

    expect(publishResult).toEqual({
      previousSeqlockCounter,
      seqlockCounter: previousSeqlockCounter + 2n,
      previousPublicationSequence,
      publicationSequence: previousPublicationSequence + 1n,
    });
    expect(rustOutput.fixtureKind).toBe("rust-hot-reader-output");
    expect(rustOutput.fixtureName).toBe("deck-runtime-v0");
    expect(rustOutput.fixtureName).toBe(artifactManifest.fixtureName);
    expect(rustOutput.contractKey).toBe("fixture.deckRuntime");
    expect(rustOutput.contractKey).toBe(artifactManifest.contractKey);
    expect(rustOutput.hotAbiVersion).toBe(hotLayoutManifest.hotAbiVersion);
    expect(rustOutput.hotLayoutVersion).toBe(hotLayoutManifest.hotLayoutVersion);
    expect(rustOutput.hotRegionBytesHex).toBe(hotRegionBytesHex);
    expect(rustOutput.snapshot.beatPhase01).toBeCloseTo(snapshot.beatPhase01);
    expect(rustOutput.snapshot.level).toBeCloseTo(snapshot.level);
    expect(rustOutput.snapshot.loopActive).toBe(snapshot.loopActive);
    expect(rustOutput.snapshot.mediaTimeSeconds).toBe(snapshot.mediaTimeSeconds);
    expect(rustOutput.snapshot.samplePosition).toBe(formatU64HexPrefixed(snapshot.samplePosition));
    expect(rustOutput.snapshot.stemGains).toEqual(snapshot.stemGains);
    expect(rustOutput.snapshot.stemGains).toHaveLength(2);
    expect(rustOutput.snapshot.tempoRatio).toBeCloseTo(snapshot.tempoRatio);
    expect(rustOutput.snapshot.transportState).toBe("playing");
    expect(rustOutput.blockB).toEqual({
      seqlockCounter: formatU64HexPrefixed(previousSeqlockCounter + 2n),
      baselineEpoch: 7,
      continuityGeneration: 3,
      publicationSequence: formatU64HexPrefixed(previousPublicationSequence + 1n),
    });
  }, 30_000);

  it("publishes hot-exchange-v0 through the generated writer and reads it back through the generated reader", async () => {
    const fixture = await loadProjectionRuntimeFixture("hot-exchange-v0");
    const completeRegion = cloneRecord(fixture.artifacts.hotCompleteFixtureRegion);
    const bytes = hexToBytes(completeRegion.completeFixtureRegionBytesHex as string);
    const region = copyIntoSharedRegion(bytes);
    const seqlock = blockBSeqlockView(region);
    const publicationSequence = blockBPublicationSequenceView(region);
    const previousSeqlockCounter = Atomics.load(seqlock, 0);
    const previousPublicationSequence = Atomics.load(publicationSequence, 0);
    const writer = createHotExchangeWriter(region);
    const snapshot = {
      displayName: "deckB-hot",
      gain: 0.5,
      levelVector: [0, 0.25, 0.75, 1],
      phase: 256.25,
      revision: 57_006,
    } satisfies HotExchangeSnapshot;

    const publishResult = writer.publish(snapshot);
    const reader = createHotExchangeReader(region);
    const readResult = reader.tryRead({
      maxWriterActivePolls: 0,
      maxTornReads: 0,
    });

    expect(publishResult).toEqual({
      previousSeqlockCounter,
      seqlockCounter: previousSeqlockCounter + 2n,
      previousPublicationSequence,
      publicationSequence: previousPublicationSequence + 1n,
    });
    expect(Atomics.load(seqlock, 0)).toBe(previousSeqlockCounter + 2n);
    expect(Atomics.load(publicationSequence, 0)).toBe(previousPublicationSequence + 1n);
    expect(readResult.ok).toBe(true);
    if (!readResult.ok) {
      throw new Error("expected generated hot-exchange round trip to succeed");
    }
    expect(readResult.sequence).toBe(previousSeqlockCounter + 2n);
    expect(readResult.snapshot).toEqual(snapshot);
    expect(readHotExchangeSnapshotUnchecked(region)).toEqual(snapshot);
  });

  it("publishes deck-runtime-v0 through the generated writer and reads it back through the generated reader", async () => {
    const fixture = await loadProjectionRuntimeFixture("deck-runtime-v0");
    const completeRegion = cloneRecord(fixture.artifacts.hotCompleteFixtureRegion);
    const bytes = hexToBytes(completeRegion.completeFixtureRegionBytesHex as string);
    const region = copyIntoSharedRegion(bytes);
    const seqlock = blockBSeqlockView(region);
    const publicationSequence = blockBPublicationSequenceView(region);
    const previousSeqlockCounter = Atomics.load(seqlock, 0);
    const previousPublicationSequence = Atomics.load(publicationSequence, 0);
    const writer = createDeckRuntimeWriter(region);
    const snapshot = {
      beatPhase01: 0.5,
      level: 0.25,
      loopActive: false,
      mediaTimeSeconds: 128.5,
      samplePosition: 9_007_199_254_740_992n,
      stemGains: [0.25, 0.5],
      tempoRatio: 1.25,
      transportState: "paused",
    } satisfies DeckRuntimeSnapshot;

    const publishResult = writer.publish(snapshot);
    const reader = createDeckRuntimeReader(region);
    const readResult = reader.tryRead({
      maxWriterActivePolls: 0,
      maxTornReads: 0,
    });

    expect(publishResult).toEqual({
      previousSeqlockCounter,
      seqlockCounter: previousSeqlockCounter + 2n,
      previousPublicationSequence,
      publicationSequence: previousPublicationSequence + 1n,
    });
    expect(Atomics.load(seqlock, 0)).toBe(previousSeqlockCounter + 2n);
    expect(Atomics.load(publicationSequence, 0)).toBe(previousPublicationSequence + 1n);
    expect(readResult.ok).toBe(true);
    if (!readResult.ok) {
      throw new Error("expected generated deck-runtime round trip to succeed");
    }
    expect(readResult.sequence).toBe(previousSeqlockCounter + 2n);
    expect(readResult.snapshot).toEqual(snapshot);
    expect(typeof readResult.snapshot.samplePosition).toBe("bigint");
    expect(typeof readResult.snapshot.loopActive).toBe("boolean");
    expect(readResult.snapshot.stemGains).toEqual([0.25, 0.5]);
    expect(readResult.snapshot.transportState).toBe("paused");
    expect(readDeckRuntimeSnapshotUnchecked(region)).toEqual(snapshot);
  });

  it("binds the generated hot-exchange seqlock view with a non-zero region byteOffset", async () => {
    const fixture = await loadProjectionRuntimeFixture("hot-exchange-v0");
    const completeRegion = cloneRecord(fixture.artifacts.hotCompleteFixtureRegion);
    const bytes = hexToBytes(completeRegion.completeFixtureRegionBytesHex as string);
    const region = copyIntoSharedRegion(bytes, 8);
    const result = createHotExchangeReader(region).tryRead({
      maxWriterActivePolls: 0,
      maxTornReads: 0,
    });

    expect(result.ok).toBe(true);
    if (!result.ok) {
      throw new Error("expected generated non-zero byteOffset read to succeed");
    }
    expect(result.sequence).toBe(2n);
    expect(result.snapshot).toEqual(cloneRecord(completeRegion.decoded).fieldValues);
  });

  it("binds the generated deck-runtime seqlock view with a non-zero region byteOffset", async () => {
    const fixture = await loadProjectionRuntimeFixture("deck-runtime-v0");
    const completeRegion = cloneRecord(fixture.artifacts.hotCompleteFixtureRegion);
    const bytes = hexToBytes(completeRegion.completeFixtureRegionBytesHex as string);
    const region = copyIntoSharedRegion(bytes, 8);
    const result = createDeckRuntimeReader(region).tryRead({
      maxWriterActivePolls: 0,
      maxTornReads: 0,
    });

    expect(result.ok).toBe(true);
    if (!result.ok) {
      throw new Error("expected generated non-zero byteOffset deck-runtime read to succeed");
    }
    expect(result.sequence).toBe(2n);
    expect(result.snapshot).toEqual(deckRuntimeExpectedFieldValues(completeRegion));
  });

  it("rejects generated hot-exchange reader regions without SharedArrayBuffer backing", async () => {
    const fixture = await loadProjectionRuntimeFixture("hot-exchange-v0");
    const completeRegion = cloneRecord(fixture.artifacts.hotCompleteFixtureRegion);
    const bytes = hexToBytes(completeRegion.completeFixtureRegionBytesHex as string);
    const region = new Uint8Array(bytes.byteLength);
    region.set(bytes);

    expectHotBindingIssue(() => createHotExchangeReader(region), "input.regionBufferNotShared");
  });

  it("rejects generated hot-exchange reader regions shorter than the manifest length", () => {
    const region = new Uint8Array(new SharedArrayBuffer(151));

    expectHotBindingIssue(() => createHotExchangeReader(region), "input.regionViewTooShort");
  });

  it("rejects generated hot-exchange reader regions with a misaligned seqlock view", async () => {
    const fixture = await loadProjectionRuntimeFixture("hot-exchange-v0");
    const completeRegion = cloneRecord(fixture.artifacts.hotCompleteFixtureRegion);
    const bytes = hexToBytes(completeRegion.completeFixtureRegionBytesHex as string);
    const region = copyIntoSharedRegion(bytes, 4);

    expectHotBindingIssue(() => createHotExchangeReader(region), "input.seqlockOffsetMisaligned");
  });

  it("rejects invalid generated deck-runtime bounded-array counts", async () => {
    const fixture = await loadProjectionRuntimeFixture("deck-runtime-v0");
    const completeRegion = cloneRecord(fixture.artifacts.hotCompleteFixtureRegion);
    const bytes = hexToBytes(completeRegion.completeFixtureRegionBytesHex as string);
    const region = copyIntoSharedRegion(bytes);
    const view = new DataView(region.buffer, region.byteOffset, region.byteLength);
    view.setUint32(128, 5, true);

    expect(() => readDeckRuntimeSnapshotUnchecked(region)).toThrow(RangeError);
    expect(() => readDeckRuntimeSnapshotUnchecked(region)).toThrow(
      "stemGains bounded array count exceeds maxCount",
    );
  });

  it("rejects invalid generated deck-runtime enum discriminants", async () => {
    const fixture = await loadProjectionRuntimeFixture("deck-runtime-v0");
    const completeRegion = cloneRecord(fixture.artifacts.hotCompleteFixtureRegion);
    const bytes = hexToBytes(completeRegion.completeFixtureRegionBytesHex as string);
    const region = copyIntoSharedRegion(bytes);
    const view = new DataView(region.buffer, region.byteOffset, region.byteLength);
    view.setUint8(152, 9);

    expect(() => readDeckRuntimeSnapshotUnchecked(region)).toThrow(RangeError);
    expect(() => readDeckRuntimeSnapshotUnchecked(region)).toThrow(
      "transportState enum discriminant is outside variants",
    );
  });

  it("rejects invalid generated deck-runtime bool bytes", async () => {
    const fixture = await loadProjectionRuntimeFixture("deck-runtime-v0");
    const completeRegion = cloneRecord(fixture.artifacts.hotCompleteFixtureRegion);
    const bytes = hexToBytes(completeRegion.completeFixtureRegionBytesHex as string);
    const region = copyIntoSharedRegion(bytes);
    const view = new DataView(region.buffer, region.byteOffset, region.byteLength);
    view.setUint8(104, 2);

    expect(() => readDeckRuntimeSnapshotUnchecked(region)).toThrow(RangeError);
    expect(() => readDeckRuntimeSnapshotUnchecked(region)).toThrow(
      "loopActive bool byte must be 0 or 1",
    );
  });

  it("rejects Rust-written deck-runtime malformed bytes through the generated reader", () => {
    const artifactManifestRelativePath =
      "fixtures/projection-runtime/deck-runtime-v0/generated/artifacts.json";
    const rustOutput = JSON.parse(
      execFileSync(
        "cargo",
        [
          "run",
          "--quiet",
          "-p",
          "hot-abi-conformance",
          "--",
          "write-deck-runtime",
          artifactManifestRelativePath,
        ],
        {
          cwd: repoRoot,
          encoding: "utf8",
        },
      ),
    ) as RustHotWriterOutput;

    for (const testCase of [
      {
        name: "stemGains count",
        mutate: (view: DataView) => view.setUint32(128, 5, true),
        message: "stemGains bounded array count exceeds maxCount",
      },
      {
        name: "transportState discriminant",
        mutate: (view: DataView) => view.setUint8(152, 9),
        message: "transportState enum discriminant is outside variants",
      },
      {
        name: "loopActive bool byte",
        mutate: (view: DataView) => view.setUint8(104, 2),
        message: "loopActive bool byte must be 0 or 1",
      },
    ] as const) {
      const bytes = hexToBytes(rustOutput.hotRegionBytesHex);
      const region = copyIntoSharedRegion(bytes);
      const view = new DataView(region.buffer, region.byteOffset, region.byteLength);
      testCase.mutate(view);

      expect(() => readDeckRuntimeSnapshotUnchecked(region), testCase.name).toThrow(RangeError);
      expect(() => readDeckRuntimeSnapshotUnchecked(region), testCase.name).toThrow(
        testCase.message,
      );
      expect(
        () => createDeckRuntimeReader(region).tryRead({ maxWriterActivePolls: 0, maxTornReads: 0 }),
        testCase.name,
      ).toThrow(testCase.message);
    }
  }, 30_000);

  it("rejects odd seqlock deck-runtime bytes through the generated bounded reader", async () => {
    const fixture = await loadProjectionRuntimeFixture("deck-runtime-v0");
    const completeRegion = cloneRecord(fixture.artifacts.hotCompleteFixtureRegion);
    const bytes = hexToBytes(completeRegion.completeFixtureRegionBytesHex as string);
    const region = copyIntoSharedRegion(bytes);
    Atomics.store(blockBSeqlockView(region), 0, 3n);

    const result = createDeckRuntimeReader(region).tryRead({
      maxWriterActivePolls: 0,
      maxTornReads: 0,
    });

    expect(result).toEqual({
      ok: false,
      snapshot: null,
      lastGood: null,
      reason: "writerActiveBudgetExhausted",
      writerActivePolls: 1,
      tornReads: 0,
      usedFallback: true,
    });
  });

  it("rejects malformed TypeScript-written deck-runtime bytes through the Rust reader", async () => {
    const fixture = await loadProjectionRuntimeFixture("deck-runtime-v0");
    const completeRegion = cloneRecord(fixture.artifacts.hotCompleteFixtureRegion);
    const artifactManifestRelativePath =
      "fixtures/projection-runtime/deck-runtime-v0/generated/artifacts.json";

    for (const testCase of [
      {
        name: "stemGains count",
        mutate: (view: DataView) => view.setUint32(128, 5, true),
        stderr: "stemGains bounded array count exceeds maxCount: expected <= 4, got 5",
      },
      {
        name: "transportState discriminant",
        mutate: (view: DataView) => view.setUint8(152, 9),
        stderr: "transportState enum discriminant is outside variants: 9",
      },
      {
        name: "loopActive bool byte",
        mutate: (view: DataView) => view.setUint8(104, 2),
        stderr: "loopActive bool byte must be 0 or 1, got 2",
      },
      {
        name: "odd seqlock",
        mutate: (_view: DataView, region: Uint8Array) =>
          Atomics.store(blockBSeqlockView(region), 0, 3n),
        stderr:
          "seqlockCounter indicates writer-active state: expected even counter, got 0x0000000000000003",
      },
    ] as const) {
      const bytes = hexToBytes(completeRegion.completeFixtureRegionBytesHex as string);
      const region = copyIntoSharedRegion(bytes);
      createDeckRuntimeWriter(region).publish(validDeckRuntimeSnapshot());
      const view = new DataView(region.buffer, region.byteOffset, region.byteLength);
      testCase.mutate(view, region);
      const result = spawnSync(
        "cargo",
        [
          "run",
          "--quiet",
          "-p",
          "hot-abi-conformance",
          "--",
          "read-deck-runtime",
          artifactManifestRelativePath,
          bytesToHex(region),
        ],
        {
          cwd: repoRoot,
          encoding: "utf8",
        },
      );

      expect(result.status, testCase.name).not.toBe(0);
      expect(result.stdout, testCase.name).toBe("");
      expect(result.stderr, testCase.name).toContain(testCase.stderr);
    }
  }, 30_000);

  it("rejects generated hot-exchange writer displayName values that exceed the fixed byte length before publishing", async () => {
    await expectHotExchangeWriterSnapshotRejected(
      {
        ...validHotExchangeSnapshot(),
        displayName: "12345678901234567",
      },
      "displayName must fit",
    );
  });

  it("rejects generated hot-exchange writer displayName values with non-ASCII text before publishing", async () => {
    await expectHotExchangeWriterSnapshotRejected(
      {
        ...validHotExchangeSnapshot(),
        displayName: "deck-\u00e1",
      },
      "displayName must contain ASCII only",
    );
  });

  it("rejects generated deck-runtime writer samplePosition values outside u64 before publishing", async () => {
    await expectDeckRuntimeWriterSnapshotRejected(
      {
        ...validDeckRuntimeSnapshot(),
        samplePosition: 0x1_0000_0000_0000_0000n,
      },
      "samplePosition must be a bigint in u64 range",
    );
  });

  it("rejects generated deck-runtime writer stemGains values longer than maxCount before publishing", async () => {
    await expectDeckRuntimeWriterSnapshotRejected(
      {
        ...validDeckRuntimeSnapshot(),
        stemGains: [0, 0.25, 0.5, 0.75, 1],
      },
      "stemGains length must be <=",
    );
  });

  it("rejects generated deck-runtime writer stemGains values with non-finite elements before publishing", async () => {
    await expectDeckRuntimeWriterSnapshotRejected(
      {
        ...validDeckRuntimeSnapshot(),
        stemGains: [0.25, Number.NaN],
      },
      "stemGains.1 must be a finite number",
    );
  });

  it("rejects generated deck-runtime writer invalid transportState values before publishing", async () => {
    await expectDeckRuntimeWriterSnapshotRejected(
      {
        ...validDeckRuntimeSnapshot(),
        transportState: "seeking",
      } as unknown as DeckRuntimeSnapshot,
      "transportState must be one of the generated variants",
    );
  });

  it("rejects generated deck-runtime writer non-boolean loopActive values before publishing", async () => {
    await expectDeckRuntimeWriterSnapshotRejected(
      {
        ...validDeckRuntimeSnapshot(),
        loopActive: "true",
      } as unknown as DeckRuntimeSnapshot,
      "loopActive must be a boolean",
    );
  });

  it("keeps generated hot reader sources zero-discovery", () => {
    const sources = ["deck-runtime-v0", "hot-exchange-v0"].map((fixtureName) =>
      readFileSync(resolve(fixtureRoot, fixtureName, "generated/hot-reader.ts"), "utf8"),
    );

    for (const source of sources) {
      expect(source).toContain("bindHotReadRegion");
      expect(source).not.toContain(".fields");
      expect(source).not.toContain("dotPath");
      expect(source).not.toContain("shape");
      expect(source).not.toContain(".find(");
      expect(source).not.toContain("new BigUint64Array");
      expect(source).not.toContain("SharedArrayBuffer");
      expect(source).not.toContain("byteOffset + SEQLOCK_OFFSET");
      expect(source).not.toContain("publicationSequence view is not u64-aligned");
      expect(source).not.toContain("@exclave/hot-codec");
    }
  });

  it("keeps generated hot writer sources zero-discovery", () => {
    const sources = ["deck-runtime-v0", "hot-exchange-v0"].map((fixtureName) =>
      readFileSync(resolve(fixtureRoot, fixtureName, "generated/hot-writer.ts"), "utf8"),
    );

    for (const source of sources) {
      expect(source).toContain("bindHotPublishRegion");
      expect(source).toContain("publishHotRegion");
      expect(source).not.toContain(".fields");
      expect(source).not.toContain("dotPath");
      expect(source).not.toContain("shape");
      expect(source).not.toContain(".find(");
      expect(source).not.toContain("new BigUint64Array");
      expect(source).not.toContain("SharedArrayBuffer");
      expect(source).not.toContain("byteOffset + SEQLOCK_OFFSET");
      expect(source).not.toContain("publicationSequence view is not u64-aligned");
      expect(source).not.toContain("@exclave/hot-codec");
    }
  });

  it("rejects generated reader manifests with duplicate field dotPaths", async () => {
    await expectGeneratedReaderManifestRejected((manifest) => {
      const fields = manifest.fields as Record<string, unknown>[];
      fields[1] = {
        ...fields[1],
        dotPath: fields[0]?.dotPath,
      };
    }, "duplicates beatPhase01");
  });

  it("rejects bounded array fields without reservations", async () => {
    await expectGeneratedReaderManifestRejected((manifest) => {
      manifest.reservations = [];
    }, "must contain exactly one stemGains reservation");
  });

  it("rejects reservations without bounded array fields", async () => {
    await expectGeneratedReaderManifestRejected((manifest) => {
      const reservations = manifest.reservations as Record<string, unknown>[];
      manifest.reservations = [
        ...reservations,
        {
          ...reservations[0],
          dotPath: "level",
        },
      ];
    }, "does not belong to a BoundedArray field");
  });

  it("rejects generated reader manifests with out-of-range field offsets", async () => {
    await expectGeneratedReaderManifestRejected((manifest) => {
      const fields = manifest.fields as Record<string, unknown>[];
      fields[0] = {
        ...fields[0],
        absoluteOffset: 159,
      };
    }, "byte range exceeds totalRegionByteLength");
  });

  it("rejects duplicate generated reader constant names", async () => {
    await expectGeneratedReaderManifestRejected((manifest) => {
      const fields = manifest.fields as Record<string, unknown>[];
      fields[0] = {
        ...fields[0],
        dotPath: "xML",
      };
      fields[1] = {
        ...fields[1],
        dotPath: "xMl",
      };
    }, "generates duplicate constant X_ML_OFFSET");
  });

  it("rejects generated writer manifests with duplicate field dotPaths", async () => {
    await expectGeneratedWriterManifestRejected((manifest) => {
      const fields = manifest.fields as Record<string, unknown>[];
      fields[1] = {
        ...fields[1],
        dotPath: fields[0]?.dotPath,
      };
    }, "duplicates beatPhase01");
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
      generatedFixtureFilesFor(fixtureName).map((fileName) => [
        `${fixtureName}/${fileName}`,
        readFileSync(resolve(fixtureRoot, fixtureName, fileName), "utf8"),
      ]),
    ),
  );
}

function generatedFixtureFilesFor(
  fixtureName: "hot-basic-v0" | "deck-runtime-v0" | "hot-exchange-v0",
): readonly string[] {
  if (fixtureName === "deck-runtime-v0" || fixtureName === "hot-exchange-v0") {
    return GENERATED_HOT_ARTIFACT_FIXTURE_FILES;
  }

  return GENERATED_FIXTURE_FILES;
}

function deckRuntimeExpectedFieldValues(completeRegion: Record<string, unknown>) {
  const decoded = cloneRecord(completeRegion.decoded);
  const fieldValues = cloneRecord(decoded.fieldValues);
  const samplePosition = fieldValues.samplePosition;

  if (typeof samplePosition !== "string") {
    throw new Error("deck-runtime fixture samplePosition must be hex u64");
  }

  return {
    ...fieldValues,
    samplePosition: BigInt(`0x${samplePosition}`),
  };
}

async function expectGeneratedReaderManifestRejected(
  mutateManifest: (manifest: Record<string, unknown>) => void,
  expectedMessage: string,
): Promise<void> {
  const baseManifest = JSON.parse(
    readFileSync(resolve(fixtureRoot, "deck-runtime-v0/hot-layout-manifest.json"), "utf8"),
  ) as Record<string, unknown>;

  mutateManifest(baseManifest);

  await withTempFixtureRoot(async (root) => {
    const manifestPath = resolve(root, "hot-layout-manifest.json");
    const outputPath = resolve(root, "generated/hot-reader.ts");
    await writeFile(manifestPath, `${JSON.stringify(baseManifest, null, 2)}\n`);

    await expect(
      writeGeneratedHotReader({
        fixtureName: "malformed-fixture",
        symbolStem: "MalformedFixture",
        manifestPath,
        outputPath,
        generatedFromPath: "fixtures/projection-runtime/malformed-fixture/hot-layout-manifest.json",
      }),
    ).rejects.toThrow(expectedMessage);
  });
}

async function expectGeneratedWriterManifestRejected(
  mutateManifest: (manifest: Record<string, unknown>) => void,
  expectedMessage: string,
): Promise<void> {
  const baseManifest = JSON.parse(
    readFileSync(resolve(fixtureRoot, "deck-runtime-v0/hot-layout-manifest.json"), "utf8"),
  ) as Record<string, unknown>;

  mutateManifest(baseManifest);

  await withTempFixtureRoot(async (root) => {
    const manifestPath = resolve(root, "hot-layout-manifest.json");
    const outputPath = resolve(root, "generated/hot-writer.ts");
    await writeFile(manifestPath, `${JSON.stringify(baseManifest, null, 2)}\n`);

    await expect(
      writeGeneratedHotWriter({
        fixtureName: "malformed-fixture",
        symbolStem: "MalformedFixture",
        manifestPath,
        outputPath,
        generatedFromPath: "fixtures/projection-runtime/malformed-fixture/hot-layout-manifest.json",
      }),
    ).rejects.toThrow(expectedMessage);
  });
}

async function expectHotExchangeWriterSnapshotRejected(
  snapshot: HotExchangeSnapshot,
  expectedMessage: string,
): Promise<void> {
  const fixture = await loadProjectionRuntimeFixture("hot-exchange-v0");
  const completeRegion = cloneRecord(fixture.artifacts.hotCompleteFixtureRegion);
  const bytes = hexToBytes(completeRegion.completeFixtureRegionBytesHex as string);
  const region = copyIntoSharedRegion(bytes);
  const seqlock = blockBSeqlockView(region);
  const publicationSequence = blockBPublicationSequenceView(region);
  const beforeSeqlockCounter = Atomics.load(seqlock, 0);
  const beforePublicationSequence = Atomics.load(publicationSequence, 0);
  const beforeSnapshot = readHotExchangeSnapshotUnchecked(region);
  const writer = createHotExchangeWriter(region);

  expect(() => writer.publish(snapshot)).toThrow(expectedMessage);
  expect(Atomics.load(seqlock, 0)).toBe(beforeSeqlockCounter);
  expect(Atomics.load(publicationSequence, 0)).toBe(beforePublicationSequence);
  expect(readHotExchangeSnapshotUnchecked(region)).toEqual(beforeSnapshot);
}

async function expectDeckRuntimeWriterSnapshotRejected(
  snapshot: DeckRuntimeSnapshot,
  expectedMessage: string,
): Promise<void> {
  const fixture = await loadProjectionRuntimeFixture("deck-runtime-v0");
  const completeRegion = cloneRecord(fixture.artifacts.hotCompleteFixtureRegion);
  const bytes = hexToBytes(completeRegion.completeFixtureRegionBytesHex as string);
  const region = copyIntoSharedRegion(bytes);
  const seqlock = blockBSeqlockView(region);
  const publicationSequence = blockBPublicationSequenceView(region);
  const beforeSeqlockCounter = Atomics.load(seqlock, 0);
  const beforePublicationSequence = Atomics.load(publicationSequence, 0);
  const beforeSnapshot = readDeckRuntimeSnapshotUnchecked(region);
  const writer = createDeckRuntimeWriter(region);

  expect(() => writer.publish(snapshot)).toThrow(expectedMessage);
  expect(Atomics.load(seqlock, 0)).toBe(beforeSeqlockCounter);
  expect(Atomics.load(publicationSequence, 0)).toBe(beforePublicationSequence);
  expect(readDeckRuntimeSnapshotUnchecked(region)).toEqual(beforeSnapshot);
}

function validHotExchangeSnapshot(): HotExchangeSnapshot {
  return {
    displayName: "deckB-hot",
    gain: 0.5,
    levelVector: [0, 0.25, 0.75, 1],
    phase: 256.25,
    revision: 57_006,
  };
}

function validDeckRuntimeSnapshot(): DeckRuntimeSnapshot {
  return {
    beatPhase01: 0.5,
    level: 0.25,
    loopActive: false,
    mediaTimeSeconds: 128.5,
    samplePosition: 9_007_199_254_740_992n,
    stemGains: [0.25, 0.5],
    tempoRatio: 1.25,
    transportState: "paused",
  };
}

function blockBSeqlockView(region: Uint8Array): BigUint64Array {
  return new BigUint64Array(region.buffer, region.byteOffset + HOT_SEQLOCK_U64_OFFSET, 1);
}

function blockBPublicationSequenceView(region: Uint8Array): BigUint64Array {
  return new BigUint64Array(
    region.buffer,
    region.byteOffset + HOT_PUBLICATION_SEQUENCE_U64_OFFSET,
    1,
  );
}

function copyIntoSharedRegion(bytes: Uint8Array, byteOffset = 0): Uint8Array {
  const region = new Uint8Array(new SharedArrayBuffer(byteOffset + bytes.byteLength), byteOffset);
  region.set(bytes);
  return region;
}

function formatU64HexPrefixed(value: bigint): string {
  return `0x${value.toString(16).padStart(16, "0")}`;
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

function expectHotBindingIssue(action: () => unknown, expectedCode: string): HotBindingError {
  try {
    action();
  } catch (error) {
    expect(isHotBindingError(error)).toBe(true);
    expect((error as HotBindingError).details.issues.map((issue) => issue.code)).toContain(
      expectedCode,
    );
    return error as HotBindingError;
  }

  throw new Error("expected hot binding failure");
}
