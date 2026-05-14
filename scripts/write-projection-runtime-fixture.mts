#!/usr/bin/env node

import {execFileSync} from "node:child_process";
import {readFileSync} from "node:fs";
import {writeFile} from "node:fs/promises";
import Module, {createRequire} from "node:module";
import {dirname, resolve} from "node:path";
import {fileURLToPath} from "node:url";

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
  readonly compileAuthoredProjectionContract: (contract: AuthoredProjectionContract) => CompileResult;
};

type EncodedHotFieldValues<TValues extends HotFieldValues> = {
  readonly fieldBytes: Uint8Array;
  readonly fixtureRegionBytes: Uint8Array;
  readonly decodedValues: TValues;
};

type DecodedHotFieldValues<TValues extends HotFieldValues> = {
  readonly values: TValues;
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
};

type TypeScriptModule = typeof import("typescript");

type ModuleWithResolveFilename = typeof Module & {
  _resolveFilename: (
    request: string,
    parent?: NodeJS.Module,
    isMain?: boolean,
    options?: NodeJS.RequireResolveOptions,
  ) => string;
};

type CompilableModule = NodeJS.Module & {
  _compile: (content: string, filename: string) => void;
};

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const fixtureRoot = resolve(repoRoot, "fixtures/projection-runtime/hot-basic-v0");
const require = createRequire(import.meta.url);

registerWorkspaceTsRequireHook();

const { compileAuthoredProjectionContract } = requireWorkspaceModule<CompilerModule>(
  "@seqlok/compiler",
);
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
} = requireWorkspaceModule<HotCodecModule>("@seqlok/hot-codec");

const authoredContractPath = resolve(fixtureRoot, "authored-contract.json");
const canonicalManifestPath = resolve(fixtureRoot, "canonical-manifest.json");
const hotLayoutManifestPath = resolve(fixtureRoot, "hot-layout-manifest.json");
const hotByteFixturePath = resolve(fixtureRoot, "hot-byte-fixture.json");
const hotBlockAFixturePath = resolve(fixtureRoot, "hot-block-a-fixture.json");
const hotBlockBFixturePath = resolve(fixtureRoot, "hot-block-b-fixture.json");
const resolvedContractPath = resolve(fixtureRoot, "resolved-contract.json");

const hotBasicSampleValues = {
  cursor: 123,
  health: "warn",
  level: 0.75,
  peaks: [0.125, 0.25, 0.5],
  phase: 12.5,
} satisfies HotBasicSampleValues;

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
await writeJson(hotByteFixturePath, createHotByteFixture(hotLayoutManifest, hotBasicSampleValues));
await writeJson(hotBlockAFixturePath, createHotBlockAFixture(hotLayoutManifest, resolved));
await writeJson(hotBlockBFixturePath, createHotBlockBFixture());
await writeJson(resolvedContractPath, resolved);
formatGeneratedJson();

function requireWorkspaceModule<TModule>(specifier: string): TModule {
  return require(specifier) as TModule;
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
  values: HotBasicSampleValues,
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
): FixtureObject {
  const instanceKey = "hot-basic-v0.instance";
  const semanticVersion = decodeU64Hex(resolved.semanticVersion, "semanticVersion");
  const hotLayoutVersion = decodeU64Hex(
    hotLayoutManifest.hotLayoutVersion,
    "hotLayoutVersion",
  );
  const input = {
    contractKey: hotLayoutManifest.contractKey,
    instanceKey,
    semanticVersion,
    hotLayoutVersion,
    fieldCount: hotLayoutManifest.fields.length,
    mutableRegionByteLength: hotLayoutManifest.mutableRegionByteLength,
  } satisfies HotBlockAHeaderInput;
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

function createHotBlockBFixture(): FixtureObject {
  const input = {
    seqlockCounter: 2n,
    baselineEpoch: 7,
    continuityGeneration: 3,
    publicationSequence: 42n,
  } satisfies HotBlockBHeaderInput;
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

function registerWorkspaceTsRequireHook(): void {
  const typescript = requireWorkspaceModule<TypeScriptModule>("typescript");
  const aliases = new Map<string, string>([
    ["@seqlok/base", resolve(repoRoot, "packages/base/src/index.ts")],
    ["@seqlok/primitives", resolve(repoRoot, "packages/primitives/src/index.ts")],
    ["@seqlok/schema", resolve(repoRoot, "packages/schema/src/index.ts")],
    ["@seqlok/hot-codec", resolve(repoRoot, "packages/hot-codec/src/index.ts")],
    ["@seqlok/compiler", resolve(repoRoot, "packages/compiler/src/index.ts")],
  ]);
  const moduleWithResolveFilename = Module as ModuleWithResolveFilename;
  const resolveFilename = moduleWithResolveFilename._resolveFilename;

  moduleWithResolveFilename._resolveFilename = function resolveWorkspaceAlias(
    this: typeof Module,
    request: string,
    parent?: NodeJS.Module,
    isMain?: boolean,
    options?: NodeJS.RequireResolveOptions,
  ): string {
    return aliases.get(request) ?? resolveFilename.call(this, request, parent, isMain, options);
  };

  require.extensions[".ts"] = function compileWorkspaceTs(
    module: NodeJS.Module,
    filename: string,
  ): void {
    const source = readFileSync(filename, "utf8");
    const { outputText } = typescript.transpileModule(source, {
      compilerOptions: {
        esModuleInterop: true,
        module: typescript.ModuleKind.CommonJS,
        target: typescript.ScriptTarget.ES2022,
      },
      fileName: filename,
    });

    (module as CompilableModule)._compile(outputText, filename);
  };
}

function formatGeneratedJson(): void {
  execFileSync(
    "pnpm",
    [
      "exec",
      "biome",
      "format",
      "--write",
      "fixtures/projection-runtime/hot-basic-v0/canonical-manifest.json",
      "fixtures/projection-runtime/hot-basic-v0/hot-layout-manifest.json",
      "fixtures/projection-runtime/hot-basic-v0/hot-byte-fixture.json",
      "fixtures/projection-runtime/hot-basic-v0/hot-block-a-fixture.json",
      "fixtures/projection-runtime/hot-basic-v0/hot-block-b-fixture.json",
      "fixtures/projection-runtime/hot-basic-v0/resolved-contract.json",
    ],
    { cwd: repoRoot, stdio: "inherit" },
  );
}
