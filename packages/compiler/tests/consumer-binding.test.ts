import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

import type { AuthoredProjectionContract } from "@exclave/schema";
import ts from "typescript";
import { describe, expect, it } from "vitest";

import {
  type CompileProjectionResult,
  type CompileProjectionSuccess,
  compileAuthoredProjectionContract,
  emitTypeScriptProjectionConsumerBindingSource,
  type ResolvedProjectionContract,
} from "../src/index";

const repoRoot = resolve(fileURLToPath(new URL("../../..", import.meta.url)));
const hotBasicFixtureRoot = resolve(repoRoot, "fixtures/projection-runtime/hot-basic-v0");

function unwrap(result: CompileProjectionResult): ResolvedProjectionContract {
  expect(result.ok).toBe(true);
  return (result as CompileProjectionSuccess).value;
}

function readFixtureJson(fileName: string): unknown {
  return JSON.parse(readFileSync(resolve(hotBasicFixtureRoot, fileName), "utf8"));
}

describe("@exclave/compiler consumer binding source", () => {
  it("emits deterministic public consumer binding source for an existing hot fixture", () => {
    const authoredContract = readFixtureJson(
      "authored-contract.json",
    ) as AuthoredProjectionContract;
    const first = unwrap(compileAuthoredProjectionContract(authoredContract));
    const second = unwrap(compileAuthoredProjectionContract(authoredContract));

    const firstSource = emitTypeScriptProjectionConsumerBindingSource({
      resolved: first,
      symbolStem: "HotBasic",
    });
    const secondSource = emitTypeScriptProjectionConsumerBindingSource({
      resolved: second,
      symbolStem: "HotBasic",
    });

    expect(secondSource).toBe(firstSource);
    expect(
      firstSource,
    ).toBe(`import type { HotReadAttemptResult, HotReadOptions } from "@exclave/hot-consumer";

export const hotBasicFields = {
  cursor: "cursor",
  health: "health",
  level: "level",
  peaks: "peaks",
  phase: "phase",
} as const;

export type HotBasicFieldPath =
  | "cursor"
  | "health"
  | "level"
  | "peaks"
  | "phase";

export const hotBasicFieldIds = {
  "cursor": 2041288779,
  "health": 194776614,
  "level": 2702269473,
  "peaks": 2500593086,
  "phase": 3513240106,
} as const;

export const hotBasicConsumerBindingMetadata = {
  contractKey: "fixture.hotBasic",
  semanticVersion: 0x67b271f31c6b06a0n,
  hotLayoutVersion: 0x8f3eb897fd88495cn,
} as const;

export const hotBasicConsumerBindingRuntimeStatus = {
  hot: "source-shape-only",
} as const;

export type HotBasicProjectionSnapshot = {
  readonly cursor: number;
  readonly health: "ok" | "warn" | "fail";
  readonly level: number;
  readonly peaks: readonly number[];
  readonly phase: number;
};

export type HotBasicHotSnapshot = {
  readonly cursor: number;
  readonly health: "ok" | "warn" | "fail";
  readonly level: number;
  readonly peaks: readonly number[];
  readonly phase: number;
};

export type HotBasicHotReadSurface = {
  readonly lane: "hot";
  readonly hotLayoutVersion: typeof hotBasicConsumerBindingMetadata.hotLayoutVersion;
  readonly tryReadLatest: (
    options?: HotReadOptions,
  ) => HotReadAttemptResult<HotBasicHotSnapshot>;
};

export type HotBasicConsumerBinding = {
  readonly fields: typeof hotBasicFields;
  readonly fieldIds: typeof hotBasicFieldIds;
  readonly metadata: typeof hotBasicConsumerBindingMetadata;
  readonly runtimeStatus: typeof hotBasicConsumerBindingRuntimeStatus;
  readonly hot: HotBasicHotReadSurface;
};
`);
  });

  it("emits warm snapshot shape without importing warm runtime or decoding payloads", () => {
    const resolved = unwrap(
      compileAuthoredProjectionContract({
        key: "fixture.warmOnly",
        family: "replaceable-snapshot",
        fields: {
          zed: { kind: "variable-string" },
          transport: {
            tempo: { kind: "fixed-scalar", type: "f64" },
            phase: { kind: "fixed-scalar", type: "f64" },
          },
        },
        lanes: {
          warm: {},
        },
      }),
    );

    const source = emitTypeScriptProjectionConsumerBindingSource({
      resolved,
      symbolStem: "WarmOnly",
    });

    expect(source).not.toContain("@exclave/warm");
    expect(source).not.toContain("decodeWarm");
    expect(source).not.toContain("bind");
    expect(source).toContain('warm: "source-shape-only"');
    expect(source).toContain("export type WarmOnlyWarmSnapshot = {");
    expect(source).toContain("readonly snapshot: WarmOnlyWarmSnapshot;");
    expect(source).toContain("warmCodecVersion:");
  });

  it("generates hot binding source that typechecks against real @exclave/hot-consumer exports", () => {
    const authoredContract = readFixtureJson(
      "authored-contract.json",
    ) as AuthoredProjectionContract;
    const resolved = unwrap(compileAuthoredProjectionContract(authoredContract));

    const source = emitTypeScriptProjectionConsumerBindingSource({
      resolved,
      symbolStem: "HotBasic",
    });

    const generatedFileName = resolve(
      repoRoot,
      "packages/compiler/tests/__generated_hot_basic_binding__.ts",
    );
    const hotConsumerIndexPath = resolve(repoRoot, "packages/hot-consumer/src/index.ts");
    const baseIndexPath = resolve(repoRoot, "packages/base/src/index.ts");

    const compilerHost = ts.createCompilerHost({
      strict: true,
      noEmit: true,
      moduleResolution: ts.ModuleResolutionKind.NodeJs,
      module: ts.ModuleKind.ESNext,
      target: ts.ScriptTarget.ES2024,
      paths: {
        "@exclave/hot-consumer": [hotConsumerIndexPath],
        "@exclave/base": [baseIndexPath],
      },
      baseUrl: repoRoot,
    });

    const originalGetSourceFile = compilerHost.getSourceFile;
    compilerHost.getSourceFile = (
      fileName: string,
      languageVersionOrOptions: ts.ScriptTarget | ts.CreateSourceFileOptions,
      onError?: (message: string) => void,
      shouldCreateNewSourceFile?: boolean,
    ): ts.SourceFile | undefined => {
      if (fileName === generatedFileName) {
        return ts.createSourceFile(
          fileName,
          source,
          languageVersionOrOptions as ts.ScriptTarget,
          true,
        );
      }

      return originalGetSourceFile(
        fileName,
        languageVersionOrOptions,
        onError,
        shouldCreateNewSourceFile,
      );
    };

    const program = ts.createProgram({
      rootNames: [generatedFileName],
      options: {
        strict: true,
        noEmit: true,
        moduleResolution: ts.ModuleResolutionKind.NodeJs,
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
          diagnostic.file !== undefined && diagnostic.file.fileName === generatedFileName,
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
