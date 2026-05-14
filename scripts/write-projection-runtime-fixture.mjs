#!/usr/bin/env node

import { execFileSync } from "node:child_process";
import { readFile, writeFile } from "node:fs/promises";
import Module, { createRequire } from "node:module";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const fixtureRoot = resolve(repoRoot, "fixtures/projection-runtime/hot-basic-v0");
const require = createRequire(import.meta.url);

registerWorkspaceTsRequireHook();

const { compileAuthoredProjectionContract } = require("@seqlok/compiler");
const { bytesToHex, decodeHotFieldValues, encodeHotFieldValues } = require("@seqlok/hot-codec");

const authoredContractPath = resolve(fixtureRoot, "authored-contract.json");
const canonicalManifestPath = resolve(fixtureRoot, "canonical-manifest.json");
const hotLayoutManifestPath = resolve(fixtureRoot, "hot-layout-manifest.json");
const hotByteFixturePath = resolve(fixtureRoot, "hot-byte-fixture.json");
const resolvedContractPath = resolve(fixtureRoot, "resolved-contract.json");

const hotBasicSampleValues = {
  cursor: 123,
  health: "warn",
  level: 0.75,
  peaks: [0.125, 0.25, 0.5],
  phase: 12.5,
};

const authoredContract = JSON.parse(await readFile(authoredContractPath, "utf8"));
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
await writeJson(resolvedContractPath, resolved);
formatGeneratedJson();

async function writeJson(path, value) {
  await writeFile(path, `${stableStringify(value)}\n`);
}

function stableStringify(value) {
  return JSON.stringify(toFixtureJson(value), null, 2);
}

function toFixtureJson(value) {
  if (typeof value === "bigint") {
    return encodeU64Hex(value);
  }

  if (Array.isArray(value)) {
    return value.map(toFixtureJson);
  }

  if (value !== null && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value)
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([key, nested]) => [key, toFixtureJson(nested)]),
    );
  }

  return value;
}

function encodeU64Hex(value) {
  if (value < 0n || value > 0xffff_ffff_ffff_ffffn) {
    throw new RangeError("fixture u64 value is out of range");
  }

  return value.toString(16).padStart(16, "0");
}

function createHotByteFixture(hotLayoutManifest, values) {
  const encoded = encodeHotFieldValues(hotLayoutManifest, values);
  const fieldBytesHex = bytesToHex(encoded.fieldBytes);
  const regionBytesHex = bytesToHex(encoded.regionBytes);
  const decodedFromField = decodeHotFieldValues(hotLayoutManifest, encoded.fieldBytes).values;
  const decodedFromRegion = decodeHotFieldValues(hotLayoutManifest, encoded.regionBytes).values;

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
      regionBytesHex,
      decodedValues: encoded.decodedValues,
    },
  };
}

function registerWorkspaceTsRequireHook() {
  const typescript = require("typescript");
  const aliases = new Map([
    ["@seqlok/base", resolve(repoRoot, "packages/base/src/index.ts")],
    ["@seqlok/primitives", resolve(repoRoot, "packages/primitives/src/index.ts")],
    ["@seqlok/schema", resolve(repoRoot, "packages/schema/src/index.ts")],
    ["@seqlok/hot-codec", resolve(repoRoot, "packages/hot-codec/src/index.ts")],
    ["@seqlok/compiler", resolve(repoRoot, "packages/compiler/src/index.ts")],
  ]);
  const resolveFilename = Module._resolveFilename;

  Module._resolveFilename = function resolveWorkspaceAlias(request, parent, isMain, options) {
    return aliases.get(request) ?? resolveFilename.call(this, request, parent, isMain, options);
  };

  require.extensions[".ts"] = function compileWorkspaceTs(module, filename) {
    const source = require("node:fs").readFileSync(filename, "utf8");
    const { outputText } = typescript.transpileModule(source, {
      compilerOptions: {
        esModuleInterop: true,
        module: typescript.ModuleKind.CommonJS,
        target: typescript.ScriptTarget.ES2022,
      },
      fileName: filename,
    });

    module._compile(outputText, filename);
  };
}

function formatGeneratedJson() {
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
      "fixtures/projection-runtime/hot-basic-v0/resolved-contract.json",
    ],
    { cwd: repoRoot, stdio: "inherit" },
  );
}
