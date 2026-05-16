#!/usr/bin/env node

import { execFileSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { writeFile } from "node:fs/promises";
import { registerHooks } from "node:module";
import { dirname, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { writeGeneratedHotArtifactManifest } from "./projection-runtime/write-generated-hot-artifact-manifest.mts";
import { writeGeneratedHotReader } from "./projection-runtime/write-generated-hot-reader.mts";
import { writeGeneratedHotWriter } from "./projection-runtime/write-generated-hot-writer.mts";

type JsonPrimitive = string | number | boolean | null;
type JsonValue = JsonPrimitive | JsonArray | JsonObject;
type JsonArray = readonly JsonValue[];
type JsonObject = { readonly [key: string]: JsonValue };

type FixturePrimitive = JsonPrimitive | bigint;
type FixtureValue = FixturePrimitive | FixtureArray | FixtureObject;
type FixtureArray = readonly FixtureValue[];
type FixtureObject = { readonly [key: string]: FixtureValue | undefined };

type HexU64 = string;

type AuthoredProjectionContract = JsonValue;

type HotBasicSampleValues = {
  readonly cursor: number;
  readonly health: "warn";
  readonly level: number;
  readonly peaks: readonly [number, number, number];
  readonly phase: number;
};

type DeckRuntimeSampleValues = {
  readonly beatPhase01: number;
  readonly level: number;
  readonly loopActive: boolean;
  readonly mediaTimeSeconds: number;
  readonly samplePosition: bigint;
  readonly stemGains: readonly [number, number, number, number];
  readonly tempoRatio: number;
  readonly transportState: "playing";
};

type HotExchangeSampleValues = {
  readonly displayName: string;
  readonly gain: number;
  readonly levelVector: readonly [number, number, number, number];
  readonly phase: number;
  readonly revision: number;
};

type HotFieldValues = Readonly<Record<string, FixtureValue>>;

type HotFieldLayoutManifest = FixtureObject;

type HotLayoutManifest = FixtureObject & {
  readonly contractKey: string;
  readonly hotLayoutVersion: bigint | HexU64;
  readonly totalRegionByteLength: number;
  readonly fieldDataOrigin: number;
  readonly fields: readonly HotFieldLayoutManifest[];
  readonly mutableRegionByteLength: number;
};

type CanonicalManifest = FixtureValue;

type ResolvedProjectionContract = FixtureObject & {
  readonly semanticVersion: bigint | HexU64;
  readonly manifest: CanonicalManifest;
  readonly laneManifests?: {
    readonly hot?: HotLayoutManifest;
  };
};

type CompileFailure = {
  readonly ok: false;
  readonly error: {
    readonly issues: unknown;
  };
};

type CompileSuccess = {
  readonly ok: true;
  readonly value: ResolvedProjectionContract;
};

type CompileResult = CompileSuccess | CompileFailure;

type CompilerModule = {
  readonly compileAuthoredProjectionContract: (
    contract: AuthoredProjectionContract,
  ) => CompileResult;
};

type FixtureProfile<TValues extends HotFieldValues> = {
  readonly fixtureName: string;
  readonly instanceKey: string;
  readonly values: TValues;
};

type GeneratedHotArtifactProfile = {
  readonly fixtureName: string;
  readonly symbolStem: string;
};

type EncodedHotFieldValues<TValues extends HotFieldValues> = {
  readonly fieldBytes: Uint8Array;
  readonly fixtureRegionBytes: Uint8Array;
  readonly decodedValues: TValues;
};

type DecodedHotFieldValues<TValues extends HotFieldValues> = {
  readonly values: TValues;
};

type HotCompleteFixtureRegionInput = {
  readonly blockA: HotBlockAHeaderInput;
  readonly blockB: HotBlockBHeaderInput;
  readonly values: HotFieldValues;
};

type HotBlockAHeaderInput = {
  readonly contractKey: string;
  readonly instanceKey: string;
  readonly semanticVersion: bigint;
  readonly hotLayoutVersion: bigint;
  readonly fieldCount: number;
  readonly mutableRegionByteLength: number;
};

type HotBlockBHeaderInput = {
  readonly seqlockCounter: bigint;
  readonly baselineEpoch: number;
  readonly continuityGeneration: number;
  readonly publicationSequence: bigint;
};

type ValidationResult =
  | { readonly ok: true }
  | {
      readonly ok: false;
      readonly error: {
        readonly message: string;
      };
    };

type HotCodecModule = {
  readonly bytesToHex: (bytes: Uint8Array) => string;
  readonly encodeHotFieldValues: <TValues extends HotFieldValues>(
    hotLayoutManifest: HotLayoutManifest,
    values: TValues,
  ) => EncodedHotFieldValues<TValues>;
  readonly decodeHotFieldValues: <TValues extends HotFieldValues>(
    hotLayoutManifest: HotLayoutManifest,
    bytes: Uint8Array,
  ) => DecodedHotFieldValues<TValues>;
  readonly encodeHotBlockAHeader: (input: HotBlockAHeaderInput) => Uint8Array;
  readonly decodeHotBlockAHeader: (bytes: Uint8Array) => FixtureValue;
  readonly validateHotBlockAHeader: (
    bytes: Uint8Array,
    expected: HotBlockAHeaderInput,
  ) => ValidationResult;
  readonly encodeHotBlockBHeader: (input: HotBlockBHeaderInput) => Uint8Array;
  readonly decodeHotBlockBHeader: (bytes: Uint8Array) => FixtureValue;
  readonly validateHotBlockBHeader: (
    bytes: Uint8Array,
    expected: HotBlockBHeaderInput,
  ) => ValidationResult;
  readonly encodeHotCompleteFixtureRegion: (
    hotLayoutManifest: HotLayoutManifest,
    input: HotCompleteFixtureRegionInput,
  ) => Uint8Array;
};

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const projectionRuntimeFixtureRoot = resolve(repoRoot, "fixtures/projection-runtime");
const workspaceAliases = new Map<string, string>([
  ["@exclave/base", resolve(repoRoot, "packages/base/src/index.ts")],
  ["@exclave/schema", resolve(repoRoot, "packages/schema/src/index.ts")],
  ["@exclave/hot-codec", resolve(repoRoot, "packages/hot-codec/src/index.ts")],
  ["@exclave/compiler", resolve(repoRoot, "packages/compiler/src/index.ts")],
]);

registerWorkspaceTsHooks();

const { compileAuthoredProjectionContract } =
  await importWorkspaceModule<CompilerModule>("@exclave/compiler");
const {
  bytesToHex,
  decodeHotFieldValues,
  encodeHotFieldValues,
  encodeHotBlockAHeader,
  decodeHotBlockAHeader,
  validateHotBlockAHeader,
  encodeHotBlockBHeader,
  decodeHotBlockBHeader,
  validateHotBlockBHeader,
  encodeHotCompleteFixtureRegion,
} = await importWorkspaceModule<HotCodecModule>("@exclave/hot-codec");

const hotBasicSampleValues = {
  cursor: 123,
  health: "warn",
  level: 0.75,
  peaks: [0.125, 0.25, 0.5],
  phase: 12.5,
} satisfies HotBasicSampleValues;

const deckRuntimeSampleValues = {
  beatPhase01: 0.375,
  level: 0.8125,
  loopActive: true,
  mediaTimeSeconds: 98.125,
  samplePosition: 4_328_192n,
  stemGains: [1, 0.875, 0.5, 0.25],
  tempoRatio: 1.025,
  transportState: "playing",
} satisfies DeckRuntimeSampleValues;

const hotExchangeSampleValues = {
  displayName: "deckA-hot",
  gain: 0.625,
  levelVector: [0.125, 0.25, 0.5, 1],
  phase: 128.5,
  revision: 57_005,
} satisfies HotExchangeSampleValues;

const fixtureProfiles: readonly FixtureProfile<HotFieldValues>[] = [
  {
    fixtureName: "hot-basic-v0",
    instanceKey: "hot-basic-v0.instance",
    values: hotBasicSampleValues,
  },
  {
    fixtureName: "deck-runtime-v0",
    instanceKey: "deck-runtime-v0.instance",
    values: deckRuntimeSampleValues,
  },
  {
    fixtureName: "hot-exchange-v0",
    instanceKey: "hot-exchange-v0.instance",
    values: hotExchangeSampleValues,
  },
] as const satisfies readonly FixtureProfile<HotFieldValues>[];

const generatedHotArtifactProfiles: readonly GeneratedHotArtifactProfile[] = [
  {
    fixtureName: "deck-runtime-v0",
    symbolStem: "DeckRuntime",
  },
  {
    fixtureName: "hot-exchange-v0",
    symbolStem: "HotExchange",
  },
] as const;

for (const profile of fixtureProfiles) {
  await writeProjectionRuntimeFixture(profile);
}

formatGeneratedArtifacts();

async function writeProjectionRuntimeFixture<TValues extends HotFieldValues>(
  profile: FixtureProfile<TValues>,
): Promise<void> {
  const fixtureRoot = resolve(projectionRuntimeFixtureRoot, profile.fixtureName);
  const authoredContractPath = resolve(fixtureRoot, "authored-contract.json");
  const canonicalManifestPath = resolve(fixtureRoot, "canonical-manifest.json");
  const hotLayoutManifestPath = resolve(fixtureRoot, "hot-layout-manifest.json");
  const hotByteFixturePath = resolve(fixtureRoot, "hot-byte-fixture.json");
  const hotBlockAFixturePath = resolve(fixtureRoot, "hot-block-a-fixture.json");
  const hotBlockBFixturePath = resolve(fixtureRoot, "hot-block-b-fixture.json");
  const hotCompleteFixtureRegionPath = resolve(fixtureRoot, "hot-complete-fixture-region.json");
  const generatedHotReaderPath = resolve(fixtureRoot, "generated/hot-reader.ts");
  const generatedHotWriterPath = resolve(fixtureRoot, "generated/hot-writer.ts");
  const generatedHotArtifactManifestPath = resolve(fixtureRoot, "generated/artifacts.json");
  const resolvedContractPath = resolve(fixtureRoot, "resolved-contract.json");
  const authoredContract: AuthoredProjectionContract = parseJsonFile(authoredContractPath);
  const result = compileAuthoredProjectionContract(authoredContract);

  if (!result.ok) {
    throw new Error(
      `failed to compile ${authoredContractPath}:\n${JSON.stringify(result.error.issues, null, 2)}`,
    );
  }

  const resolved = result.value;
  const hotLayoutManifest = resolved.laneManifests?.hot;

  if (hotLayoutManifest === undefined) {
    throw new Error(`${authoredContractPath} did not emit a hot lane manifest`);
  }

  await writeJson(canonicalManifestPath, resolved.manifest);
  await writeJson(hotLayoutManifestPath, hotLayoutManifest);
  await writeJson(hotByteFixturePath, createHotByteFixture(hotLayoutManifest, profile.values));
  await writeJson(
    hotBlockAFixturePath,
    createHotBlockAFixture(hotLayoutManifest, resolved, profile),
  );
  await writeJson(hotBlockBFixturePath, createHotBlockBFixture());
  await writeJson(
    hotCompleteFixtureRegionPath,
    createHotCompleteFixtureRegionFixture(hotLayoutManifest, resolved, profile),
  );
  await writeJson(resolvedContractPath, resolved);

  const generatedHotArtifactProfile = generatedHotArtifactProfiles.find(
    (entry) => entry.fixtureName === profile.fixtureName,
  );

  if (generatedHotArtifactProfile !== undefined) {
    await writeGeneratedHotReader({
      fixtureName: generatedHotArtifactProfile.fixtureName,
      symbolStem: generatedHotArtifactProfile.symbolStem,
      manifestPath: hotLayoutManifestPath,
      outputPath: generatedHotReaderPath,
      generatedFromPath: `fixtures/projection-runtime/${generatedHotArtifactProfile.fixtureName}/hot-layout-manifest.json`,
      semanticVersion: decodeU64Hex(resolved.semanticVersion, "semanticVersion")
        .toString(16)
        .padStart(16, "0"),
    });
    await writeGeneratedHotWriter({
      fixtureName: generatedHotArtifactProfile.fixtureName,
      symbolStem: generatedHotArtifactProfile.symbolStem,
      manifestPath: hotLayoutManifestPath,
      outputPath: generatedHotWriterPath,
      generatedFromPath: `fixtures/projection-runtime/${generatedHotArtifactProfile.fixtureName}/hot-layout-manifest.json`,
      semanticVersion: decodeU64Hex(resolved.semanticVersion, "semanticVersion")
        .toString(16)
        .padStart(16, "0"),
    });
    await writeGeneratedHotArtifactManifest({
      fixtureName: generatedHotArtifactProfile.fixtureName,
      symbolStem: generatedHotArtifactProfile.symbolStem,
      manifestPath: hotLayoutManifestPath,
      outputPath: generatedHotArtifactManifestPath,
      generatedFromPath: `fixtures/projection-runtime/${generatedHotArtifactProfile.fixtureName}/hot-layout-manifest.json`,
    });
  }
}

async function importWorkspaceModule<TModule>(specifier: string): Promise<TModule> {
  return (await import(specifier)) as TModule;
}

function parseJsonFile(path: string): JsonValue {
  const parsed: unknown = JSON.parse(readFileSync(path, "utf8"));

  if (!isJsonValue(parsed)) {
    throw new Error(`${path} did not contain JSON-serializable data`);
  }

  return parsed;
}

function isJsonValue(value: unknown): value is JsonValue {
  if (
    value === null ||
    typeof value === "string" ||
    typeof value === "number" ||
    typeof value === "boolean"
  ) {
    return true;
  }

  if (Array.isArray(value)) {
    return value.every(isJsonValue);
  }

  if (typeof value !== "object") {
    return false;
  }

  return Object.values(value).every(isJsonValue);
}

async function writeJson(path: string, value: FixtureValue): Promise<void> {
  await writeFile(path, `${stableStringify(value)}\n`);
}

function stableStringify(value: FixtureValue): string {
  return JSON.stringify(toFixtureJson(value), null, 2);
}

function toFixtureJson(value: FixtureValue): JsonValue {
  if (typeof value === "bigint") {
    return encodeU64Hex(value);
  }

  if (Array.isArray(value)) {
    return value.map(toFixtureJson);
  }

  if (value !== null && typeof value === "object") {
    const entries = Object.entries(value)
      .filter((entry): entry is [string, FixtureValue] => entry[1] !== undefined)
      .sort(([left], [right]) => (left < right ? -1 : left > right ? 1 : 0))
      .map(([key, nested]): [string, JsonValue] => [key, toFixtureJson(nested)]);

    return Object.fromEntries(entries) as JsonObject;
  }

  return value;
}

function encodeU64Hex(value: bigint): HexU64 {
  if (value < 0n || value > 0xffff_ffff_ffff_ffffn) {
    throw new RangeError("fixture u64 value is out of range");
  }

  return value.toString(16).padStart(16, "0");
}

function decodeU64Hex(value: bigint | HexU64, fieldName: string): bigint {
  if (typeof value === "bigint") {
    return value;
  }

  const normalized = value.startsWith("0x") ? value.slice(2) : value;

  if (!/^[\da-fA-F]+$/.test(normalized)) {
    throw new Error(`${fieldName} must be a hex u64 string`);
  }

  return BigInt(`0x${normalized}`);
}

function createHotByteFixture(
  hotLayoutManifest: HotLayoutManifest,
  values: HotFieldValues,
): FixtureObject {
  const encoded = encodeHotFieldValues(hotLayoutManifest, values);
  const fieldBytesHex = bytesToHex(encoded.fieldBytes);
  const fixtureRegionBytesHex = bytesToHex(encoded.fixtureRegionBytes);
  const decodedFromField = decodeHotFieldValues(hotLayoutManifest, encoded.fieldBytes).values;
  const decodedFromRegion = decodeHotFieldValues(
    hotLayoutManifest,
    encoded.fixtureRegionBytes,
  ).values;

  if (stableStringify(decodedFromField) !== stableStringify(decodedFromRegion)) {
    throw new Error("hot byte fixture field and region decoding diverged");
  }

  return {
    fixtureKind: "hot-byte-fixture",
    contractKey: hotLayoutManifest.contractKey,
    hotLayoutVersion: hotLayoutManifest.hotLayoutVersion,
    totalRegionByteLength: hotLayoutManifest.totalRegionByteLength,
    fieldDataOrigin: hotLayoutManifest.fieldDataOrigin,
    values,
    expected: {
      fieldBytesHex,
      fixtureRegionBytesHex,
      decodedValues: encoded.decodedValues,
    },
  };
}

function createHotBlockAFixture(
  hotLayoutManifest: HotLayoutManifest,
  resolved: ResolvedProjectionContract,
  profile: FixtureProfile<HotFieldValues>,
): FixtureObject {
  const input = createHotBlockAInput(hotLayoutManifest, resolved, profile);
  const blockABytes = encodeHotBlockAHeader(input);
  const decoded = decodeHotBlockAHeader(blockABytes);
  const validation = validateHotBlockAHeader(blockABytes, input);

  if (!validation.ok) {
    throw new Error(`hot-block-a-fixture validation failed: ${validation.error.message}`);
  }

  return {
    fixtureKind: "hot-block-a-fixture",
    contractKey: input.contractKey,
    instanceKey: input.instanceKey,
    semanticVersion: resolved.semanticVersion,
    hotLayoutVersion: hotLayoutManifest.hotLayoutVersion,
    fieldCount: input.fieldCount,
    mutableRegionByteLength: input.mutableRegionByteLength,
    expected: {
      blockABytesHex: bytesToHex(blockABytes),
      decoded,
    },
  };
}

function createHotBlockAInput(
  hotLayoutManifest: HotLayoutManifest,
  resolved: ResolvedProjectionContract,
  profile: FixtureProfile<HotFieldValues>,
): HotBlockAHeaderInput {
  const semanticVersion = decodeU64Hex(resolved.semanticVersion, "semanticVersion");
  const hotLayoutVersion = decodeU64Hex(hotLayoutManifest.hotLayoutVersion, "hotLayoutVersion");

  return {
    contractKey: hotLayoutManifest.contractKey,
    instanceKey: profile.instanceKey,
    semanticVersion,
    hotLayoutVersion,
    fieldCount: hotLayoutManifest.fields.length,
    mutableRegionByteLength: hotLayoutManifest.mutableRegionByteLength,
  };
}

function createHotBlockBInput(): HotBlockBHeaderInput {
  return {
    seqlockCounter: 2n,
    baselineEpoch: 7,
    continuityGeneration: 3,
    publicationSequence: 42n,
  };
}

function createHotBlockBFixture(): FixtureObject {
  const input = createHotBlockBInput();
  const blockBBytes = encodeHotBlockBHeader(input);
  const decoded = decodeHotBlockBHeader(blockBBytes);
  const validation = validateHotBlockBHeader(blockBBytes, input);

  if (!validation.ok) {
    throw new Error(`hot-block-b-fixture validation failed: ${validation.error.message}`);
  }

  return {
    fixtureKind: "hot-block-b-fixture",
    seqlockCounter: input.seqlockCounter,
    baselineEpoch: input.baselineEpoch,
    continuityGeneration: input.continuityGeneration,
    publicationSequence: input.publicationSequence,
    expected: {
      blockBBytesHex: bytesToHex(blockBBytes),
      decoded,
    },
  };
}

function createHotCompleteFixtureRegionFixture(
  hotLayoutManifest: HotLayoutManifest,
  resolved: ResolvedProjectionContract,
  profile: FixtureProfile<HotFieldValues>,
): FixtureObject {
  const blockA = createHotBlockAInput(hotLayoutManifest, resolved, profile);
  const blockB = createHotBlockBInput();
  const blockABytes = encodeHotBlockAHeader(blockA);
  const blockBBytes = encodeHotBlockBHeader(blockB);
  const fieldBytes = encodeHotFieldValues(hotLayoutManifest, profile.values).fieldBytes;
  const completeFixtureRegionBytes = encodeHotCompleteFixtureRegion(hotLayoutManifest, {
    blockA,
    blockB,
    values: profile.values,
  });

  return {
    fixtureKind: "hot-complete-fixture-region",
    contractKey: blockA.contractKey,
    instanceKey: blockA.instanceKey,
    hotLayoutVersion: hotLayoutManifest.hotLayoutVersion,
    totalRegionByteLength: hotLayoutManifest.totalRegionByteLength,
    blockABytesHex: bytesToHex(blockABytes),
    blockBBytesHex: bytesToHex(blockBBytes),
    fieldBytesHex: bytesToHex(fieldBytes),
    completeFixtureRegionBytesHex: bytesToHex(completeFixtureRegionBytes),
    decoded: {
      blockA: decodeHotBlockAHeader(blockABytes),
      blockB: decodeHotBlockBHeader(blockBBytes),
      fieldValues: decodeHotFieldValues(hotLayoutManifest, fieldBytes).values,
    },
  };
}

function registerWorkspaceTsHooks(): void {
  registerHooks({
    resolve(specifier, context, nextResolve) {
      const aliasPath = workspaceAliases.get(specifier);

      if (aliasPath !== undefined) {
        return {
          shortCircuit: true,
          url: pathToFileURL(aliasPath).href,
        };
      }

      if (context.parentURL?.startsWith("file:") === true && isExtensionlessRelative(specifier)) {
        const tsUrl = new URL(`${specifier}.ts`, context.parentURL);
        if (existsSync(fileURLToPath(tsUrl))) {
          return {
            shortCircuit: true,
            url: tsUrl.href,
          };
        }
      }

      return nextResolve(specifier, context);
    },
  });
}

function isExtensionlessRelative(specifier: string): boolean {
  return (
    (specifier.startsWith("./") || specifier.startsWith("../")) &&
    !specifier.endsWith(".js") &&
    !specifier.endsWith(".mjs") &&
    !specifier.endsWith(".cjs") &&
    !specifier.endsWith(".json") &&
    !specifier.endsWith(".ts") &&
    !specifier.endsWith(".mts") &&
    !specifier.endsWith(".cts")
  );
}

function formatGeneratedArtifacts(): void {
  const generatedFixturePaths = fixtureProfiles.flatMap((profile) => [
    `fixtures/projection-runtime/${profile.fixtureName}/canonical-manifest.json`,
    `fixtures/projection-runtime/${profile.fixtureName}/hot-layout-manifest.json`,
    `fixtures/projection-runtime/${profile.fixtureName}/hot-byte-fixture.json`,
    `fixtures/projection-runtime/${profile.fixtureName}/hot-block-a-fixture.json`,
    `fixtures/projection-runtime/${profile.fixtureName}/hot-block-b-fixture.json`,
    `fixtures/projection-runtime/${profile.fixtureName}/hot-complete-fixture-region.json`,
    `fixtures/projection-runtime/${profile.fixtureName}/resolved-contract.json`,
  ]);
  const generatedSourcePaths = generatedHotArtifactProfiles.flatMap((profile) => [
    `fixtures/projection-runtime/${profile.fixtureName}/generated/hot-reader.ts`,
    `fixtures/projection-runtime/${profile.fixtureName}/generated/hot-writer.ts`,
    `fixtures/projection-runtime/${profile.fixtureName}/generated/artifacts.json`,
  ]);

  execFileSync(
    process.execPath,
    [
      resolve(repoRoot, "node_modules/@biomejs/biome/bin/biome"),
      "format",
      "--write",
      ...generatedFixturePaths,
      ...generatedSourcePaths,
    ],
    {
      cwd: repoRoot,
      stdio: "inherit",
    },
  );
}
