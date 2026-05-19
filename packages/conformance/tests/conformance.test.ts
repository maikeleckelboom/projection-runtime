import { execFileSync, spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { cp, mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { ExclaveError } from "@exclave/base";
import {
  type CompileProjectionResult,
  type CompileProjectionSuccess,
  compileAuthoredProjectionContract,
  emitTypeScriptProjectionConsumerBindingSource,
  type ResolvedProjectionContract,
} from "@exclave/compiler";
import { type HotBindingError, isHotBindingError } from "@exclave/hot-binding";
import {
  bytesToHex,
  decodeHotCompleteFixtureRegion,
  HOT_BASELINE_EPOCH_U32_OFFSET,
  HOT_CONTINUITY_GENERATION_U32_OFFSET,
  HOT_PUBLICATION_SEQUENCE_U64_OFFSET,
  HOT_SEQLOCK_U64_OFFSET,
  type HotLayoutManifest,
  hexToBytes,
} from "@exclave/hot-codec";
import ts from "typescript";
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
import { writeGeneratedRustHotWriter } from "../../../scripts/projection-runtime/write-generated-rust-hot-writer.mts";
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
const warmPayloadFixtureRoot = resolve(fixtureRoot, "warm-payload-v0");
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
  "generated/consumer-binding.ts",
  "generated/hot-reader.ts",
  "generated/hot-writer.ts",
  "generated/hot_writer.rs",
  "generated/artifacts.json",
] as const;
const GENERATED_CONSUMER_BINDING_FIXTURE_FILES = [
  ...GENERATED_FIXTURE_FILES,
  "generated/consumer-binding.ts",
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

type HotExchangeRustWriterOutput = {
  readonly fixtureKind: "rust-hot-writer-output";
  readonly fixtureName: string;
  readonly contractKey: string;
  readonly hotAbiVersion: number;
  readonly hotLayoutVersion: string;
  readonly hotRegionBytesHex: string;
  readonly snapshot: {
    readonly displayName: string;
    readonly gain: number;
    readonly levelVector: readonly number[];
    readonly phase: number;
    readonly revision: number;
  };
  readonly blockB: {
    readonly seqlockCounter: string;
    readonly baselineEpoch: number;
    readonly continuityGeneration: number;
    readonly publicationSequence: string;
  };
};

type RustWarmOutput = {
  readonly fixtureKind: "rust-warm-output";
  readonly fixtureName: string;
  readonly contractKey: string;
  readonly semanticVersion: string;
  readonly warmCodecVersion: string;
  readonly payloadBytesHex: string;
  readonly frameBytesHex: string;
  readonly decodedFrame: {
    readonly frameByteLength: number;
    readonly contractKey: string;
    readonly projectionInstanceKey: string;
    readonly semanticVersion: string;
    readonly warmCodecVersion: string;
    readonly baselineEpoch: number;
    readonly continuityGeneration: number;
    readonly publicationSequence: string;
    readonly laneSequence?: number;
    readonly payloadBytesHex: string;
  };
  readonly decodedSnapshot: Record<string, unknown>;
};

type LiveDeckRuntimeFrame = {
  readonly frameIndex: number;
  readonly hotRegionBytesHex: string;
  readonly publishResult: {
    readonly previousPublicationSequence: string;
    readonly publicationSequence: string;
    readonly previousSeqlockCounter: string;
    readonly seqlockCounter: string;
  };
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

type LiveDeckRuntimeOutput = {
  readonly fixtureKind: "rust-live-hot-publication-output";
  readonly fixtureName: string;
  readonly contractKey: string;
  readonly hotAbiVersion: number;
  readonly hotLayoutVersion: string;
  readonly totalRegionByteLength: number;
  readonly frames: readonly LiveDeckRuntimeFrame[];
};

describe("@exclave/conformance fixture discovery", () => {
  it("discovers all checked-in projection-runtime fixtures", async () => {
    await expect(listProjectionRuntimeFixtures()).resolves.toEqual(
      expect.arrayContaining([
        "deck-runtime-v0",
        "hot-basic-v0",
        "hot-exchange-v0",
        "warm-payload-v0",
      ]),
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
      ...(hotByteFixture.values as Record<string, unknown>),
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

  it("loads warm-payload-v0 as a warm-only payload codec fixture", async () => {
    const fixture = await loadProjectionRuntimeFixture("warm-payload-v0");
    const warmPayloadFixture = cloneRecord(fixture.artifacts.warmPayloadFixture);
    const rustWarmOutput = cloneRecord(fixture.artifacts.rustWarmOutput);

    expect(fixture.fixtureName).toBe("warm-payload-v0");
    expect(fixture.fixtureProfile).toBe("warm-payload-codec");
    expect(fixture.fixturePath).toBe("fixtures/projection-runtime/warm-payload-v0");
    expect(fixture.artifacts.authoredContract).toMatchObject({
      key: "fixture.warmPayload.v0",
      lanes: { warm: {} },
    });
    expect(fixture.artifacts.hotLayoutManifest).toBeUndefined();
    expect(fixture.artifacts.hotByteFixture).toBeUndefined();
    expect(warmPayloadFixture).toMatchObject({
      fixtureKind: "warm-payload-fixture",
      contractKey: "fixture.warmPayload.v0",
      warmCodecVersion: "63b9e47293d654c5",
      expected: {
        payloadBytesHex:
          "012a0000000000003f0000803f0200000005000000616c706861010000004105000000627261766f0100000042020000000700000405000000726561647903006d69780200000061000000016200000002020500436166c3a9",
      },
    });
    expect(rustWarmOutput).toMatchObject({
      fixtureKind: "rust-warm-output",
      fixtureName: "warm-payload-v0",
      contractKey: "fixture.warmPayload.v0",
      semanticVersion: "10fbe25177301279",
      warmCodecVersion: "63b9e47293d654c5",
      payloadBytesHex:
        "012a0000000000003f0000803f0200000005000000616c706861010000004105000000627261766f0100000042020000000700000405000000726561647903006d69780200000061000000016200000002020500436166c3a9",
      decodedFrame: {
        frameByteLength: 184,
        contractKey: "fixture.warmPayload.v0",
        projectionInstanceKey: "warm-payload-v0.instance",
        payloadBytesHex:
          "012a0000000000003f0000803f0200000005000000616c706861010000004105000000627261766f0100000042020000000700000405000000726561647903006d69780200000061000000016200000002020500436166c3a9",
      },
    });
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
      const source = cloneRecord(artifactManifest.source);
      const artifacts = cloneRecord(artifactManifest.artifacts);

      expect(artifactManifest).toMatchObject({
        artifactManifestVersion: 1,
        fixtureName: profile.fixtureName,
        symbolStem: profile.symbolStem,
        source: {
          hotLayoutManifest: "../hot-layout-manifest.json",
          hotBlockAFixture: "../hot-block-a-fixture.json",
          hotCompleteFixtureRegion: "../hot-complete-fixture-region.json",
          resolvedContract: "../resolved-contract.json",
        },
        artifacts: {
          reader: "hot-reader.ts",
          rustWriter: "hot_writer.rs",
          writer: "hot-writer.ts",
        },
      });
      expect(readFileSync(resolve(generatedRoot, source.hotLayoutManifest as string)));
      expect(readFileSync(resolve(generatedRoot, source.hotBlockAFixture as string)));
      expect(readFileSync(resolve(generatedRoot, source.hotCompleteFixtureRegion as string)));
      expect(readFileSync(resolve(generatedRoot, source.resolvedContract as string)));
      expect(readFileSync(resolve(generatedRoot, artifacts.reader as string)));
      expect(readFileSync(resolve(generatedRoot, artifacts.rustWriter as string)));
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
    expect(hotBlockAFixture.fieldCount).toBe(
      (hotLayoutManifest.fields as readonly unknown[]).length,
    );
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

  it("reports missing warm-payload-fixture.json explicitly for warm payload fixtures", async () => {
    await withTempFixtureRoot(async (root) => {
      const copiedFixtureRoot = resolve(root, "broken-warm-fixture");
      await cp(warmPayloadFixtureRoot, copiedFixtureRoot, { recursive: true });
      await rm(resolve(copiedFixtureRoot, "warm-payload-fixture.json"));

      const result = await runProjectionRuntimeFixture("broken-warm-fixture", {
        fixtureRoot: root,
      });

      expect(result).toMatchObject({
        fixtureName: "broken-warm-fixture",
        passed: false,
      });
      expect(result.failures).toEqual([
        expect.objectContaining({
          artifact: "fixture-file",
          failureCode: "missingRequiredFixtureFile",
          fixtureFile: "warm-payload-fixture.json",
        }),
      ]);
      expect(result.failures[0]?.relativePath).toContain(
        "broken-warm-fixture/warm-payload-fixture.json",
      );
    });
  });

  it("reports missing rust-warm-output.json explicitly for warm payload fixtures", async () => {
    await withTempFixtureRoot(async (root) => {
      const copiedFixtureRoot = resolve(root, "broken-warm-fixture");
      await cp(warmPayloadFixtureRoot, copiedFixtureRoot, { recursive: true });
      await rm(resolve(copiedFixtureRoot, "rust-warm-output.json"));

      const result = await runProjectionRuntimeFixture("broken-warm-fixture", {
        fixtureRoot: root,
      });

      expect(result).toMatchObject({
        fixtureName: "broken-warm-fixture",
        passed: false,
      });
      expect(result.failures).toEqual([
        expect.objectContaining({
          artifact: "fixture-file",
          failureCode: "missingRequiredFixtureFile",
          fixtureFile: "rust-warm-output.json",
        }),
      ]);
      expect(result.failures[0]?.relativePath).toContain(
        "broken-warm-fixture/rust-warm-output.json",
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

  it("passes warm-payload-v0 conformance", async () => {
    const result = await runProjectionRuntimeFixture("warm-payload-v0");

    expect(result).toEqual({
      fixtureName: "warm-payload-v0",
      fixturePath: "fixtures/projection-runtime/warm-payload-v0",
      passed: true,
      failures: [],
    });
  });

  it("proves warm-payload-v0 Rust/TypeScript payload and full frame byte agreement", async () => {
    const fixture = await loadProjectionRuntimeFixture("warm-payload-v0");
    const warmPayloadFixture = cloneRecord(fixture.artifacts.warmPayloadFixture);
    const expected = cloneRecord(warmPayloadFixture.expected);
    const expectedDecodedFrame = cloneRecord(expected.decodedFrame);
    const committedRustOutput = cloneRecord(fixture.artifacts.rustWarmOutput) as RustWarmOutput;

    const rustOutput = JSON.parse(
      execFileSync(
        "cargo",
        [
          "run",
          "--quiet",
          "-p",
          "warm-abi-conformance",
          "--",
          "warm-payload-v0",
          "fixtures/projection-runtime/warm-payload-v0",
        ],
        {
          cwd: repoRoot,
          encoding: "utf8",
        },
      ),
    ) as RustWarmOutput;

    expect(rustOutput).toEqual(committedRustOutput);
    expect(rustOutput.fixtureKind).toBe("rust-warm-output");
    expect(rustOutput.fixtureName).toBe("warm-payload-v0");
    expect(rustOutput.contractKey).toBe(warmPayloadFixture.contractKey);
    expect(rustOutput.semanticVersion).toBe(warmPayloadFixture.semanticVersion);
    expect(rustOutput.warmCodecVersion).toBe(warmPayloadFixture.warmCodecVersion);
    expect(rustOutput.payloadBytesHex).toBe(expected.payloadBytesHex);
    expect(rustOutput.frameBytesHex).toBe(expected.frameBytesHex);
    expect(rustOutput.decodedFrame).toEqual({
      frameByteLength: expected.frameBytesHex.length / 2 - 4,
      contractKey: warmPayloadFixture.contractKey,
      projectionInstanceKey: expectedDecodedFrame.projectionInstanceKey,
      semanticVersion: warmPayloadFixture.semanticVersion,
      warmCodecVersion: warmPayloadFixture.warmCodecVersion,
      baselineEpoch: expectedDecodedFrame.baselineEpoch,
      continuityGeneration: expectedDecodedFrame.continuityGeneration,
      publicationSequence: expectedDecodedFrame.publicationSequence,
      laneSequence: expectedDecodedFrame.laneSequence,
      payloadBytesHex: expected.payloadBytesHex,
    });
    expect(rustOutput.decodedSnapshot).toEqual(expected.decodedSnapshot);
  }, 30_000);

  it("passes aggregate projection-runtime conformance", async () => {
    const result = await runProjectionRuntimeConformance();

    expect(result.totalCount).toBeGreaterThanOrEqual(3);
    expect(result.passedCount).toBe(result.totalCount);
    expect(result.failedCount).toBe(0);
    expect(result.fixtures.map((fixture) => fixture.fixtureName)).toEqual(
      expect.arrayContaining([
        "deck-runtime-v0",
        "hot-basic-v0",
        "hot-exchange-v0",
        "warm-payload-v0",
      ]),
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
    const reader = createHotExchangeReader(region, { instanceKey: "hot-exchange-v0.instance" });

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
    const reader = createDeckRuntimeReader(region, { instanceKey: "deck-runtime-v0.instance" });

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

  it("reads generated Rust-written deck-runtime-v0 hot region bytes through the generated reader", async () => {
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
    const reader = createDeckRuntimeReader(region, { instanceKey: "deck-runtime-v0.instance" });
    const result = reader.tryRead({
      maxWriterActivePolls: 0,
      maxTornReads: 0,
    });
    const view = new DataView(region.buffer, region.byteOffset, region.byteLength);
    const fixture = await loadProjectionRuntimeFixture("deck-runtime-v0");
    const existingCompleteRegion = cloneRecord(fixture.artifacts.hotCompleteFixtureRegion);
    const hotBlockAFixture = cloneRecord(fixture.artifacts.hotBlockAFixture);
    const expectedBlockA = cloneRecord(cloneRecord(hotBlockAFixture.expected).decoded);
    const hotLayoutFields = hotLayoutManifest.fields;
    if (!Array.isArray(hotLayoutFields)) {
      throw new Error("deck-runtime hot layout manifest fields must be an array");
    }
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
    const decoded = decodeHotCompleteFixtureRegion(
      decodeHotLayoutManifestFixture(hotLayoutManifest),
      bytes,
      {
        expectedContractKey: "fixture.deckRuntime",
        expectedInstanceKey: "deck-runtime-v0.instance",
      },
    );

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
    expect(decoded.blockA.regionMagicHex).toBe(expectedBlockA.regionMagicHex);
    expect(decoded.blockA.hotAbiVersion).toBe(expectedBlockA.hotAbiVersion);
    expect(decoded.blockA.contractKeyHashHex).toBe(expectedBlockA.contractKeyHashHex);
    expect(decoded.blockA.instanceKeyHashHex).toBe(expectedBlockA.instanceKeyHashHex);
    expect(decoded.blockA.semanticVersion).toBe(
      BigInt(`0x${expectedBlockA.semanticVersion as string}`),
    );
    expect(decoded.blockA.hotLayoutVersion).toBe(
      BigInt(`0x${expectedBlockA.hotLayoutVersion as string}`),
    );
    expect(decoded.blockA.fieldCount).toBe(hotLayoutFields.length);
    expect(decoded.blockA.mutableRegionByteLength).toBe(hotLayoutManifest.mutableRegionByteLength);
    expect(decoded.blockA.reservedHex).toBe(expectedBlockA.reservedHex);
    expect(decoded.blockB).toEqual({
      seqlockCounter: 0x0000_0000_0000_0002n,
      baselineEpoch: 7,
      continuityGeneration: 3,
      publicationSequence: 0x0000_0000_0000_0001n,
    });
    expect(decoded.fieldValues).toEqual(expectedSnapshot);
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
    expect(
      readUnusedStemGainSlotBytes(region, hotLayoutManifest, expectedSnapshot.stemGains),
    ).toEqual(new Uint8Array(8));
    expect(readDeckRuntimeSnapshotUnchecked(region)).toEqual(expectedSnapshot);
  }, 30_000);

  it("reads generated Rust-written hot-exchange-v0 hot region bytes through the generated reader", async () => {
    const artifactManifestRelativePath =
      "fixtures/projection-runtime/hot-exchange-v0/generated/artifacts.json";
    const artifactManifestPath = resolve(fixtureRoot, "hot-exchange-v0/generated/artifacts.json");
    const artifactManifest = JSON.parse(readFileSync(artifactManifestPath, "utf8")) as Record<
      string,
      unknown
    >;
    const hotLayoutManifest = JSON.parse(
      readFileSync(resolve(fixtureRoot, "hot-exchange-v0/hot-layout-manifest.json"), "utf8"),
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
          "write-hot-exchange",
          artifactManifestRelativePath,
        ],
        {
          cwd: repoRoot,
          encoding: "utf8",
        },
      ),
    ) as HotExchangeRustWriterOutput;
    const bytes = hexToBytes(rustOutput.hotRegionBytesHex);
    const region = copyIntoSharedRegion(bytes);
    const reader = createHotExchangeReader(region, { instanceKey: "hot-exchange-v0.instance" });
    const result = reader.tryRead({
      maxWriterActivePolls: 0,
      maxTornReads: 0,
    });
    const view = new DataView(region.buffer, region.byteOffset, region.byteLength);

    const expectedSnapshot = {
      displayName: "deckB-hot",
      gain: 0.5,
      levelVector: [0, 0.25, 0.75, 1],
      phase: 256.25,
      revision: 57_006,
    } satisfies HotExchangeSnapshot;

    expect(rustOutput).toMatchObject({
      fixtureKind: "rust-hot-writer-output",
      fixtureName: artifactManifest.fixtureName,
      contractKey: artifactManifest.contractKey,
      hotAbiVersion: artifactManifest.hotAbiVersion,
      hotLayoutVersion: artifactManifest.hotLayoutVersion,
      snapshot: expectedSnapshot,
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

    expect(result.ok).toBe(true);
    if (!result.ok) {
      throw new Error("expected generated hot-exchange reader to consume Rust-written bytes");
    }
    expect(result.sequence).toBe(0x0000_0000_0000_0002n);
    expect(result.sequence % 2n).toBe(0n);
    expect(result.snapshot).toEqual(expectedSnapshot);
    expect(Atomics.load(blockBSeqlockView(region), 0)).toBe(0x0000_0000_0000_0002n);
    expect(view.getUint32(HOT_BASELINE_EPOCH_U32_OFFSET, true)).toBe(7);
    expect(view.getUint32(HOT_CONTINUITY_GENERATION_U32_OFFSET, true)).toBe(3);
    expect(Atomics.load(blockBPublicationSequenceView(region), 0)).toBe(0x0000_0000_0000_0001n);
    expect(readHotExchangeSnapshotUnchecked(region)).toEqual(expectedSnapshot);

    const displayNameLayout = fixedStringFieldLayout(hotLayoutManifest, "displayName");
    const unusedBytes = region.slice(
      displayNameLayout.absoluteOffset + "deckB-hot".length,
      displayNameLayout.absoluteOffset + displayNameLayout.byteLength,
    );
    expect(unusedBytes).toEqual(new Uint8Array(7));
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
    const writer = createDeckRuntimeWriter(region, { instanceKey: "deck-runtime-v0.instance" });
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
    const writer = createHotExchangeWriter(region, { instanceKey: "hot-exchange-v0.instance" });
    const snapshot = {
      displayName: "deckB-hot",
      gain: 0.5,
      levelVector: [0, 0.25, 0.75, 1],
      phase: 256.25,
      revision: 57_006,
    } satisfies HotExchangeSnapshot;

    const publishResult = writer.publish(snapshot);
    const reader = createHotExchangeReader(region, { instanceKey: "hot-exchange-v0.instance" });
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
    const writer = createDeckRuntimeWriter(region, { instanceKey: "deck-runtime-v0.instance" });
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
    const reader = createDeckRuntimeReader(region, { instanceKey: "deck-runtime-v0.instance" });
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
    const result = createHotExchangeReader(region, {
      instanceKey: "hot-exchange-v0.instance",
    }).tryRead({
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
    const result = createDeckRuntimeReader(region, {
      instanceKey: "deck-runtime-v0.instance",
    }).tryRead({
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

    expectHotBindingIssue(
      () => createHotExchangeReader(region, { instanceKey: "hot-exchange-v0.instance" }),
      "input.regionBufferNotShared",
    );
  });

  it("rejects generated hot-exchange reader regions shorter than the manifest length", () => {
    const region = new Uint8Array(new SharedArrayBuffer(151));

    expectHotBindingIssue(
      () => createHotExchangeReader(region, { instanceKey: "hot-exchange-v0.instance" }),
      "input.regionViewTooShort",
    );
  });

  it("rejects generated hot-exchange reader regions with a misaligned seqlock view", async () => {
    const fixture = await loadProjectionRuntimeFixture("hot-exchange-v0");
    const completeRegion = cloneRecord(fixture.artifacts.hotCompleteFixtureRegion);
    const bytes = hexToBytes(completeRegion.completeFixtureRegionBytesHex as string);
    const region = copyIntoSharedRegion(bytes, 4);

    expectHotBindingIssue(
      () => createHotExchangeReader(region, { instanceKey: "hot-exchange-v0.instance" }),
      "input.seqlockOffsetMisaligned",
    );
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
        () =>
          createDeckRuntimeReader(region, { instanceKey: "deck-runtime-v0.instance" }).tryRead({
            maxWriterActivePolls: 0,
            maxTornReads: 0,
          }),
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

    const result = createDeckRuntimeReader(region, {
      instanceKey: "deck-runtime-v0.instance",
    }).tryRead({
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
      createDeckRuntimeWriter(region, { instanceKey: "deck-runtime-v0.instance" }).publish(
        validDeckRuntimeSnapshot(),
      );
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

  it("rejects generated deck-runtime-v0 reader with wrong Block A headers before read", async () => {
    const fixture = await loadProjectionRuntimeFixture("deck-runtime-v0");
    const completeRegion = cloneRecord(fixture.artifacts.hotCompleteFixtureRegion);

    for (const testCase of [
      {
        name: "magic",
        mutate: (view: DataView) => view.setUint32(0, 0xefbe_adde, true),
      },
      {
        name: "contractKeyHash",
        mutate: (_view: DataView, bytes: Uint8Array) => bytes.fill(0, 8, 24),
      },
      {
        name: "semanticVersion",
        mutate: (view: DataView) => view.setBigUint64(40, 0n, true),
      },
      {
        name: "hotLayoutVersion",
        mutate: (view: DataView) => view.setBigUint64(48, 0n, true),
      },
      {
        name: "fieldCount",
        mutate: (view: DataView) => view.setUint32(56, 99, true),
      },
      {
        name: "mutableRegionByteLength",
        mutate: (view: DataView) => view.setUint32(60, 99, true),
      },
    ] as const) {
      const bytes = hexToBytes(completeRegion.completeFixtureRegionBytesHex as string);
      const region = copyIntoSharedRegion(bytes);
      const view = new DataView(region.buffer, region.byteOffset, region.byteLength);
      testCase.mutate(view, region);

      assertHotBindingBlockARejected(testCase.name, () =>
        createDeckRuntimeReader(region, { instanceKey: "deck-runtime-v0.instance" }),
      );
    }
  });

  it("rejects generated deck-runtime-v0 writer with wrong Block A headers before publish", async () => {
    const fixture = await loadProjectionRuntimeFixture("deck-runtime-v0");
    const completeRegion = cloneRecord(fixture.artifacts.hotCompleteFixtureRegion);

    for (const testCase of [
      {
        name: "magic",
        mutate: (view: DataView) => view.setUint32(0, 0xefbe_adde, true),
      },
      {
        name: "contractKeyHash",
        mutate: (_view: DataView, bytes: Uint8Array) => bytes.fill(0, 8, 24),
      },
      {
        name: "hotLayoutVersion",
        mutate: (view: DataView) => view.setBigUint64(48, 0n, true),
      },
      {
        name: "fieldCount",
        mutate: (view: DataView) => view.setUint32(56, 99, true),
      },
    ] as const) {
      const bytes = hexToBytes(completeRegion.completeFixtureRegionBytesHex as string);
      const region = copyIntoSharedRegion(bytes);
      const view = new DataView(region.buffer, region.byteOffset, region.byteLength);
      testCase.mutate(view, region);

      assertHotBindingBlockARejected(testCase.name, () =>
        createDeckRuntimeWriter(region, { instanceKey: "deck-runtime-v0.instance" }),
      );
    }
  });

  it("rejects generated deck-runtime-v0 reader with wrong instance key", async () => {
    const fixture = await loadProjectionRuntimeFixture("deck-runtime-v0");
    const completeRegion = cloneRecord(fixture.artifacts.hotCompleteFixtureRegion);
    const bytes = hexToBytes(completeRegion.completeFixtureRegionBytesHex as string);
    const region = copyIntoSharedRegion(bytes);

    expectHotBindingIssue(
      () => createDeckRuntimeReader(region, { instanceKey: "wrong.instance" }),
      "input.blockAHeaderInvalid",
    );
  });

  it("rejects generated deck-runtime-v0 writer with wrong instance key", async () => {
    const fixture = await loadProjectionRuntimeFixture("deck-runtime-v0");
    const completeRegion = cloneRecord(fixture.artifacts.hotCompleteFixtureRegion);
    const bytes = hexToBytes(completeRegion.completeFixtureRegionBytesHex as string);
    const region = copyIntoSharedRegion(bytes);

    expectHotBindingIssue(
      () => createDeckRuntimeWriter(region, { instanceKey: "wrong.instance" }),
      "input.blockAHeaderInvalid",
    );
  });

  it("rejects generated hot-exchange-v0 reader with wrong Block A headers before read", async () => {
    const fixture = await loadProjectionRuntimeFixture("hot-exchange-v0");
    const completeRegion = cloneRecord(fixture.artifacts.hotCompleteFixtureRegion);

    for (const testCase of [
      {
        name: "magic",
        mutate: (view: DataView) => view.setUint32(0, 0xefbe_adde, true),
      },
      {
        name: "contractKeyHash",
        mutate: (_view: DataView, bytes: Uint8Array) => bytes.fill(0, 8, 24),
      },
      {
        name: "semanticVersion",
        mutate: (view: DataView) => view.setBigUint64(40, 0n, true),
      },
      {
        name: "hotLayoutVersion",
        mutate: (view: DataView) => view.setBigUint64(48, 0n, true),
      },
      {
        name: "fieldCount",
        mutate: (view: DataView) => view.setUint32(56, 99, true),
      },
      {
        name: "mutableRegionByteLength",
        mutate: (view: DataView) => view.setUint32(60, 99, true),
      },
    ] as const) {
      const bytes = hexToBytes(completeRegion.completeFixtureRegionBytesHex as string);
      const region = copyIntoSharedRegion(bytes);
      const view = new DataView(region.buffer, region.byteOffset, region.byteLength);
      testCase.mutate(view, region);

      assertHotBindingBlockARejected(testCase.name, () =>
        createHotExchangeReader(region, { instanceKey: "hot-exchange-v0.instance" }),
      );
    }
  });

  it("rejects generated hot-exchange-v0 writer with wrong Block A headers before publish", async () => {
    const fixture = await loadProjectionRuntimeFixture("hot-exchange-v0");
    const completeRegion = cloneRecord(fixture.artifacts.hotCompleteFixtureRegion);

    for (const testCase of [
      {
        name: "magic",
        mutate: (view: DataView) => view.setUint32(0, 0xefbe_adde, true),
      },
      {
        name: "contractKeyHash",
        mutate: (_view: DataView, bytes: Uint8Array) => bytes.fill(0, 8, 24),
      },
      {
        name: "hotLayoutVersion",
        mutate: (view: DataView) => view.setBigUint64(48, 0n, true),
      },
      {
        name: "fieldCount",
        mutate: (view: DataView) => view.setUint32(56, 99, true),
      },
    ] as const) {
      const bytes = hexToBytes(completeRegion.completeFixtureRegionBytesHex as string);
      const region = copyIntoSharedRegion(bytes);
      const view = new DataView(region.buffer, region.byteOffset, region.byteLength);
      testCase.mutate(view, region);

      assertHotBindingBlockARejected(testCase.name, () =>
        createHotExchangeWriter(region, { instanceKey: "hot-exchange-v0.instance" }),
      );
    }
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

  it("keeps generated Rust hot writer sources zero-discovery", () => {
    const sources = ["deck-runtime-v0", "hot-exchange-v0"].map((fixtureName) =>
      readFileSync(resolve(fixtureRoot, fixtureName, "generated/hot_writer.rs"), "utf8"),
    );

    for (const source of sources) {
      expect(source).toContain("publish_");
      expect(source).toContain("Snapshot");
      expect(source).not.toContain(".fields");
      expect(source).not.toContain("dotPath");
      expect(source).not.toContain("shape");
      expect(source).not.toContain(".find(");
      expect(source).not.toContain("SharedArrayBuffer");
      expect(source).not.toContain("@exclave");
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

  it("rejects generated Rust writer enum variants that cannot become Rust enum variants", async () => {
    await expectGeneratedRustWriterManifestRejected((manifest) => {
      const fields = manifest.fields as Record<string, unknown>[];
      const transportState = fields.find((field) => field.dotPath === "transportState");
      if (transportState === undefined) {
        throw new Error("deck-runtime manifest must contain transportState");
      }
      const shape = cloneRecord(transportState.shape);
      shape.variants = ["not-safe"];
      transportState.shape = shape;
    }, "variant not-safe is not supported by generated Rust writer v0");
  });

  describe("@exclave/conformance consumer binding source", () => {
    const consumerBindingProfiles = [
      { fixtureName: "hot-basic-v0", symbolStem: "HotBasic", constStem: "hotBasic" },
      { fixtureName: "deck-runtime-v0", symbolStem: "DeckRuntime", constStem: "deckRuntime" },
      {
        fixtureName: "hot-exchange-v0",
        symbolStem: "HotExchange",
        constStem: "hotExchange",
      },
    ] as const;

    function unwrapCompileResult(result: CompileProjectionResult): ResolvedProjectionContract {
      expect(result.ok).toBe(true);
      return (result as CompileProjectionSuccess).value;
    }

    for (const profile of consumerBindingProfiles) {
      describe(profile.fixtureName, () => {
        it("committed consumer binding source has expected header and content", async () => {
          const committedPath = resolve(
            fixtureRoot,
            profile.fixtureName,
            "generated",
            "consumer-binding.ts",
          );
          const committedSource = readFileSync(committedPath, "utf8");
          const expectedHeader = `// Generated from fixtures/projection-runtime/${profile.fixtureName}/resolved-contract.json. Do not edit by hand.`;

          expect(committedSource).toContain(expectedHeader);
          expect(committedSource).toContain(`export const ${profile.constStem}Fields`);
          expect(committedSource).toContain(`export type ${profile.symbolStem}FieldPath`);
          expect(committedSource).toContain(`export const ${profile.constStem}FieldIds`);
          expect(committedSource).toContain(
            `export const ${profile.constStem}ConsumerBindingMetadata`,
          );
          expect(committedSource).toContain(
            `export const ${profile.constStem}ConsumerBindingRuntimeAvailability`,
          );
          expect(committedSource).toContain(`export type ${profile.symbolStem}ConsumerBinding`);
        });

        it("consumer binding source is deterministic", async () => {
          const fixture = await loadProjectionRuntimeFixture(profile.fixtureName);
          const authoredContract = fixture.artifacts.authoredContract;
          const resolved = unwrapCompileResult(compileAuthoredProjectionContract(authoredContract));
          const first = emitTypeScriptProjectionConsumerBindingSource({
            resolved,
            symbolStem: profile.symbolStem,
          });
          const second = emitTypeScriptProjectionConsumerBindingSource({
            resolved,
            symbolStem: profile.symbolStem,
          });

          expect(second).toBe(first);
        });

        it("consumer binding source has static source-shape-only runtime availability", async () => {
          const fixture = await loadProjectionRuntimeFixture(profile.fixtureName);
          const authoredContract = fixture.artifacts.authoredContract;
          const resolved = unwrapCompileResult(compileAuthoredProjectionContract(authoredContract));
          const source = emitTypeScriptProjectionConsumerBindingSource({
            resolved,
            symbolStem: profile.symbolStem,
          });
          const sourceFile = ts.createSourceFile(
            `${profile.fixtureName}/generated/consumer-binding.ts`,
            source,
            ts.ScriptTarget.ES2024,
            true,
          );
          const runtimeAvailabilityConst = sourceFile.statements.find(
            (statement): statement is ts.VariableStatement =>
              ts.isVariableStatement(statement) &&
              statement.declarationList.declarations.some(
                (declaration) =>
                  ts.isIdentifier(declaration.name) &&
                  declaration.name.text ===
                    `${profile.constStem}ConsumerBindingRuntimeAvailability`,
              ),
          );

          expect(runtimeAvailabilityConst).toBeDefined();
          expect(
            runtimeAvailabilityConst?.declarationList.declarations[0]?.initializer?.getText(
              sourceFile,
            ),
          ).toBe('{\n  hot: "source-shape-only",\n} as const');
        });

        it("consumer binding type includes runtimeAvailability as a readonly static marker", async () => {
          const fixture = await loadProjectionRuntimeFixture(profile.fixtureName);
          const authoredContract = fixture.artifacts.authoredContract;
          const resolved = unwrapCompileResult(compileAuthoredProjectionContract(authoredContract));
          const source = emitTypeScriptProjectionConsumerBindingSource({
            resolved,
            symbolStem: profile.symbolStem,
          });
          const sourceFile = ts.createSourceFile(
            `${profile.fixtureName}/generated/consumer-binding.ts`,
            source,
            ts.ScriptTarget.ES2024,
            true,
          );
          const consumerBindingType = sourceFile.statements.find(
            (statement): statement is ts.TypeAliasDeclaration =>
              ts.isTypeAliasDeclaration(statement) &&
              statement.name.text === `${profile.symbolStem}ConsumerBinding`,
          );

          expect(consumerBindingType).toBeDefined();
          if (
            consumerBindingType === undefined ||
            !ts.isTypeLiteralNode(consumerBindingType.type)
          ) {
            throw new Error(`${profile.symbolStem}ConsumerBinding must be a type literal`);
          }

          const runtimeAvailabilityMember = consumerBindingType.type.members.find(
            (member): member is ts.PropertySignature =>
              ts.isPropertySignature(member) &&
              ts.isIdentifier(member.name) &&
              member.name.text === "runtimeAvailability",
          );

          expect(runtimeAvailabilityMember).toBeDefined();
          expect(
            runtimeAvailabilityMember?.modifiers?.some(
              (modifier) => modifier.kind === ts.SyntaxKind.ReadonlyKeyword,
            ),
          ).toBe(true);
          expect(runtimeAvailabilityMember?.type?.getText(sourceFile)).toBe(
            `typeof ${profile.constStem}ConsumerBindingRuntimeAvailability`,
          );
        });

        it("consumer binding artifact exports source-shape declarations without runtime creator values", () => {
          const committedPath = resolve(
            fixtureRoot,
            profile.fixtureName,
            "generated",
            "consumer-binding.ts",
          );
          const committedSource = readFileSync(committedPath, "utf8");
          const sourceFile = ts.createSourceFile(
            committedPath,
            committedSource,
            ts.ScriptTarget.ES2024,
            true,
          );
          const exportedValueDeclarations = sourceFile.statements.flatMap((statement) => {
            if (!hasExportModifier(statement) || !ts.isVariableStatement(statement)) return [];
            return statement.declarationList.declarations.map((declaration) =>
              declaration.name.getText(sourceFile),
            );
          });

          expect(exportedValueDeclarations).toEqual([
            `${profile.constStem}Fields`,
            `${profile.constStem}FieldIds`,
            `${profile.constStem}ConsumerBindingMetadata`,
            `${profile.constStem}ConsumerBindingRuntimeAvailability`,
          ]);
          expect(
            sourceFile.statements.filter(
              (statement) =>
                hasExportModifier(statement) &&
                (ts.isFunctionDeclaration(statement) || ts.isClassDeclaration(statement)),
            ),
          ).toEqual([]);
        });
      });
    }

    it("committed consumer binding artifacts typecheck against real package exports", () => {
      const hotConsumerIndexPath = resolve(repoRoot, "packages/hot-consumer/src/index.ts");
      const baseIndexPath = resolve(repoRoot, "packages/base/src/index.ts");
      const committedConsumerBindingPaths = consumerBindingProfiles.map((profile) =>
        resolve(fixtureRoot, profile.fixtureName, "generated", "consumer-binding.ts"),
      );

      const compilerHost = ts.createCompilerHost({
        strict: true,
        noEmit: true,
        moduleResolution: ts.ModuleResolutionKind.Bundler,
        module: ts.ModuleKind.ESNext,
        target: ts.ScriptTarget.ES2024,
        paths: {
          "@exclave/hot-consumer": [hotConsumerIndexPath],
          "@exclave/base": [baseIndexPath],
        },
        baseUrl: repoRoot,
      });

      const program = ts.createProgram({
        rootNames: committedConsumerBindingPaths,
        options: {
          strict: true,
          noEmit: true,
          moduleResolution: ts.ModuleResolutionKind.Bundler,
          module: ts.ModuleKind.ESNext,
          target: ts.ScriptTarget.ES2024,
          paths: {
            "@exclave/hot-consumer": [hotConsumerIndexPath],
            "@exclave/base": [baseIndexPath],
          },
          baseUrl: repoRoot,
        },
        host: compilerHost,
      });

      const diagnostics = ts
        .getPreEmitDiagnostics(program)
        .filter(
          (diagnostic) =>
            diagnostic.file !== undefined &&
            committedConsumerBindingPaths.includes(diagnostic.file.fileName),
        );

      const diagnosticMessages = diagnostics.map((diagnostic) => {
        const message = ts.flattenDiagnosticMessageText(diagnostic.messageText, "\n");
        const lineAndChar =
          diagnostic.file !== undefined && diagnostic.start !== undefined
            ? `:${ts.getLineAndCharacterOfPosition(diagnostic.file, diagnostic.start).line + 1}`
            : "";
        return `${diagnostic.file?.fileName ?? "<unknown>"}${lineAndChar}: ${message}`;
      });

      expect(diagnosticMessages).toEqual([]);
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

  it("live Rust hot publication proves repeated publication across one region", () => {
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

    const output = JSON.parse(
      execFileSync(
        "cargo",
        [
          "run",
          "--quiet",
          "-p",
          "hot-abi-conformance",
          "--",
          "live-deck-runtime",
          artifactManifestRelativePath,
        ],
        {
          cwd: repoRoot,
          encoding: "utf8",
        },
      ),
    ) as LiveDeckRuntimeOutput;

    expect(output.fixtureKind).toBe("rust-live-hot-publication-output");
    expect(output.fixtureName).toBe(artifactManifest.fixtureName);
    expect(output.contractKey).toBe(artifactManifest.contractKey);
    expect(output.hotAbiVersion).toBe(artifactManifest.hotAbiVersion);
    expect(output.hotLayoutVersion).toBe(artifactManifest.hotLayoutVersion);
    expect(output.totalRegionByteLength).toBe(hotLayoutManifest.totalRegionByteLength);
    expect(output.frames).toHaveLength(3);

    const expectedFrames = [
      {
        frameIndex: 1,
        publishResult: {
          previousPublicationSequence: "0x0000000000000000",
          publicationSequence: "0x0000000000000001",
          previousSeqlockCounter: "0x0000000000000000",
          seqlockCounter: "0x0000000000000002",
        },
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
        readerSequence: 0x0000_0000_0000_0002n,
        readerBlockBPubSeq: 0x0000_0000_0000_0001n,
      },
      {
        frameIndex: 2,
        publishResult: {
          previousPublicationSequence: "0x0000000000000001",
          publicationSequence: "0x0000000000000002",
          previousSeqlockCounter: "0x0000000000000002",
          seqlockCounter: "0x0000000000000004",
        },
        snapshot: {
          beatPhase01: 0.75,
          level: 0.5,
          loopActive: true,
          mediaTimeSeconds: 256.0,
          samplePosition: "0x0040000000000000",
          stemGains: [0.5, 0.75],
          tempoRatio: 1.5,
          transportState: "playing",
        },
        blockB: {
          seqlockCounter: "0x0000000000000004",
          baselineEpoch: 7,
          continuityGeneration: 3,
          publicationSequence: "0x0000000000000002",
        },
        readerSequence: 0x0000_0000_0000_0004n,
        readerBlockBPubSeq: 0x0000_0000_0000_0002n,
      },
      {
        frameIndex: 3,
        publishResult: {
          previousPublicationSequence: "0x0000000000000002",
          publicationSequence: "0x0000000000000003",
          previousSeqlockCounter: "0x0000000000000004",
          seqlockCounter: "0x0000000000000006",
        },
        snapshot: {
          beatPhase01: 0.125,
          level: 0.875,
          loopActive: false,
          mediaTimeSeconds: 512.5,
          samplePosition: "0x0080000000000000",
          stemGains: [0.75, 1.0],
          tempoRatio: 0.75,
          transportState: "cueing",
        },
        blockB: {
          seqlockCounter: "0x0000000000000006",
          baselineEpoch: 7,
          continuityGeneration: 3,
          publicationSequence: "0x0000000000000003",
        },
        readerSequence: 0x0000_0000_0000_0006n,
        readerBlockBPubSeq: 0x0000_0000_0000_0003n,
      },
    ] as const;

    for (const [i, expected] of expectedFrames.entries()) {
      const frame = output.frames[i];
      expect(frame).toBeDefined();
      if (frame === undefined) return;

      expect(frame.frameIndex).toBe(expected.frameIndex);
      expect(frame.publishResult).toEqual(expected.publishResult);
      expect(frame.snapshot).toEqual(expected.snapshot);
      expect(frame.blockB).toEqual(expected.blockB);

      // Assert publishResult agrees with encoded region Block B metadata
      expect(frame.publishResult.publicationSequence).toBe(frame.blockB.publicationSequence);
      expect(frame.publishResult.seqlockCounter).toBe(frame.blockB.seqlockCounter);

      // Assert previous values prove accumulation (not one-shot regions)
      if (i === 0) {
        expect(frame.publishResult.previousPublicationSequence).toBe("0x0000000000000000");
        expect(frame.publishResult.previousSeqlockCounter).toBe("0x0000000000000000");
      } else {
        const prev = output.frames[i - 1];
        expect(prev).toBeDefined();
        if (prev === undefined) return;
        expect(frame.publishResult.previousPublicationSequence).toBe(
          prev.publishResult.publicationSequence,
        );
        expect(frame.publishResult.previousSeqlockCounter).toBe(prev.publishResult.seqlockCounter);
      }

      // Decode region bytes and validate through generated TypeScript reader
      const bytes = hexToBytes(frame.hotRegionBytesHex);
      expect(bytes.byteLength).toBe(output.totalRegionByteLength);

      const region = copyIntoSharedRegion(bytes);
      const reader = createDeckRuntimeReader(region, {
        instanceKey: "deck-runtime-v0.instance",
      });
      const result = reader.tryRead({
        maxWriterActivePolls: 0,
        maxTornReads: 0,
      });

      expect(result.ok).toBe(true);
      if (!result.ok) {
        throw new Error(
          `frame ${expected.frameIndex}: expected generated deck-runtime reader to succeed`,
        );
      }

      // Assert reader result matches expected seqlock sequence
      expect(result.sequence).toBe(expected.readerSequence);
      expect(result.sequence % 2n).toBe(0n);

      // Assert snapshot values match expected frame values
      expect(result.snapshot.beatPhase01).toBeCloseTo(expected.snapshot.beatPhase01);
      expect(result.snapshot.level).toBeCloseTo(expected.snapshot.level);
      expect(result.snapshot.loopActive).toBe(expected.snapshot.loopActive);
      expect(result.snapshot.mediaTimeSeconds).toBe(expected.snapshot.mediaTimeSeconds);
      expect(result.snapshot.samplePosition).toBe(BigInt(expected.snapshot.samplePosition));
      expect(result.snapshot.stemGains).toEqual(expected.snapshot.stemGains);
      expect(result.snapshot.tempoRatio).toBeCloseTo(expected.snapshot.tempoRatio);
      expect(result.snapshot.transportState).toBe(expected.snapshot.transportState);
      expect(typeof result.snapshot.samplePosition).toBe("bigint");
      expect(typeof result.snapshot.loopActive).toBe("boolean");

      // Assert Block B metadata through raw region views
      const view = new DataView(region.buffer, region.byteOffset, region.byteLength);
      expect(Atomics.load(blockBSeqlockView(region), 0)).toBe(expected.readerSequence);
      expect(view.getUint32(HOT_BASELINE_EPOCH_U32_OFFSET, true)).toBe(
        expected.blockB.baselineEpoch,
      );
      expect(view.getUint32(HOT_CONTINUITY_GENERATION_U32_OFFSET, true)).toBe(
        expected.blockB.continuityGeneration,
      );
      expect(Atomics.load(blockBPublicationSequenceView(region), 0)).toBe(
        expected.readerBlockBPubSeq,
      );
      expect(readDeckRuntimeSnapshotUnchecked(region)).toEqual(result.snapshot);
    }

    // Assert monotonic publication over time
    for (let i = 1; i < 3; i++) {
      const prev = output.frames[i - 1];
      const current = output.frames[i];
      expect(prev).toBeDefined();
      expect(current).toBeDefined();
      if (prev === undefined || current === undefined) return;
      expect(
        BigInt(current.publishResult.publicationSequence) >
          BigInt(prev.publishResult.publicationSequence),
      ).toBe(true);
      expect(
        BigInt(current.publishResult.seqlockCounter) > BigInt(prev.publishResult.seqlockCounter),
      ).toBe(true);
    }
  }, 30_000);
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

function hasExportModifier(statement: ts.Statement): boolean {
  return (
    ts.canHaveModifiers(statement) &&
    ts
      .getModifiers(statement)
      ?.some((modifier) => modifier.kind === ts.SyntaxKind.ExportKeyword) === true
  );
}

function decodeHotLayoutManifestFixture(value: unknown): HotLayoutManifest {
  const hotLayoutManifest = cloneRecord(value);
  const hotLayoutVersion = hotLayoutManifest.hotLayoutVersion;

  if (typeof hotLayoutVersion !== "string") {
    throw new Error("hot layout fixture version must be a hex string");
  }

  return {
    ...hotLayoutManifest,
    hotLayoutVersion: BigInt(`0x${hotLayoutVersion}`),
  } as HotLayoutManifest;
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

  return GENERATED_CONSUMER_BINDING_FIXTURE_FILES;
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

function readUnusedStemGainSlotBytes(
  region: Uint8Array,
  hotLayoutManifest: Record<string, unknown>,
  logicalValues: readonly unknown[],
): Uint8Array {
  const reservations = hotLayoutManifest.reservations;
  if (!Array.isArray(reservations)) {
    throw new Error("deck-runtime hot layout manifest reservations must be an array");
  }

  const reservation = reservations.find(
    (entry): entry is Record<string, unknown> =>
      typeof entry === "object" &&
      entry !== null &&
      !Array.isArray(entry) &&
      entry.dotPath === "stemGains",
  );

  if (reservation === undefined) {
    throw new Error("deck-runtime hot layout manifest must contain a stemGains reservation");
  }

  const elementsOffset = reservation.elementsOffset;
  const maxCount = reservation.maxCount;
  const unitByteLength = reservation.unitByteLength;
  if (
    typeof elementsOffset !== "number" ||
    typeof maxCount !== "number" ||
    typeof unitByteLength !== "number"
  ) {
    throw new Error("deck-runtime stemGains reservation offsets must be numeric");
  }

  const unusedStart = elementsOffset + logicalValues.length * unitByteLength;
  const unusedEnd = elementsOffset + maxCount * unitByteLength;
  return region.slice(unusedStart, unusedEnd);
}

function fixedStringFieldLayout(
  manifest: Record<string, unknown>,
  dotPath: string,
): { absoluteOffset: number; byteLength: number } {
  const fields = manifest.fields;
  if (!Array.isArray(fields)) {
    throw new Error("hot layout manifest fields must be an array");
  }
  const field = fields.find(
    (entry): entry is Record<string, unknown> =>
      typeof entry === "object" &&
      entry !== null &&
      !Array.isArray(entry) &&
      entry.dotPath === dotPath,
  );
  if (field === undefined) {
    throw new Error(`hot layout manifest field "${dotPath}" not found`);
  }
  const absoluteOffset = field.absoluteOffset;
  if (typeof absoluteOffset !== "number") {
    throw new Error(`hot layout manifest field "${dotPath}" absoluteOffset must be a number`);
  }
  const shape = field.shape;
  if (typeof shape !== "object" || shape === null || Array.isArray(shape)) {
    throw new Error(`hot layout manifest field "${dotPath}" shape must be an object`);
  }
  const shapeRecord = shape as Record<string, unknown>;
  if (shapeRecord.kind !== "FixedStringEncoded") {
    throw new Error(
      `hot layout manifest field "${dotPath}" shape.kind must be "FixedStringEncoded"`,
    );
  }
  if (shapeRecord.encoding !== "ascii") {
    throw new Error(`hot layout manifest field "${dotPath}" shape.encoding must be "ascii"`);
  }
  const byteLength = shapeRecord.byteLength;
  if (typeof byteLength !== "number") {
    throw new Error(`hot layout manifest field "${dotPath}" shape.byteLength must be a number`);
  }
  return { absoluteOffset, byteLength };
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
        semanticVersion: "e3636f7cdffa73b2",
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
        semanticVersion: "e3636f7cdffa73b2",
        manifestPath,
        outputPath,
        generatedFromPath: "fixtures/projection-runtime/malformed-fixture/hot-layout-manifest.json",
      }),
    ).rejects.toThrow(expectedMessage);
  });
}

async function expectGeneratedRustWriterManifestRejected(
  mutateManifest: (manifest: Record<string, unknown>) => void,
  expectedMessage: string,
): Promise<void> {
  const baseManifest = JSON.parse(
    readFileSync(resolve(fixtureRoot, "deck-runtime-v0/hot-layout-manifest.json"), "utf8"),
  ) as Record<string, unknown>;

  mutateManifest(baseManifest);

  await withTempFixtureRoot(async (root) => {
    const manifestPath = resolve(root, "hot-layout-manifest.json");
    const outputPath = resolve(root, "generated/hot_writer.rs");
    await writeFile(manifestPath, `${JSON.stringify(baseManifest, null, 2)}\n`);

    await expect(
      writeGeneratedRustHotWriter({
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
  const writer = createHotExchangeWriter(region, { instanceKey: "hot-exchange-v0.instance" });

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
  const writer = createDeckRuntimeWriter(region, { instanceKey: "deck-runtime-v0.instance" });

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

function assertHotBindingBlockARejected(caseName: string, action: () => unknown): void {
  try {
    action();
    throw new Error(`${caseName}: expected hot binding failure`);
  } catch (error) {
    expect(isHotBindingError(error), caseName).toBe(true);
    expect(
      (error as HotBindingError).details.issues.map((issue) => issue.code),
      caseName,
    ).toContain("input.blockAHeaderInvalid");
  }
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
