import {
  type AuthoredProjectionContract,
  SchemaValidationError,
  validateAuthoredProjectionContract,
} from "@exclave/schema";

import {
  type CompilerError,
  type CompilerIssue,
  createCompilerError,
  createCompilerIssue,
} from "./error";
import type { FieldIdDeriver } from "./field-id";
import { flattenAuthoredFields } from "./fields";
import { compileHotLayoutManifest } from "./hot";
import { canonicalizeLanes } from "./lanes";
import type { LaneManifests, ResolvedProjectionContract } from "./manifest";
import { deriveSemanticVersion } from "./version";
import { deriveWarmCodecManifest } from "./warm";

export type CompileProjectionResult = CompileProjectionSuccess | CompileProjectionFailure;

export interface CompileProjectionSuccess {
  readonly ok: true;
  readonly value: ResolvedProjectionContract;
}

export interface CompileProjectionFailure {
  readonly ok: false;
  readonly error: CompilerError;
}

export interface CompileProjectionOptions {
  readonly fieldIdDeriver?: FieldIdDeriver;
}

export function compileAuthoredProjectionContract(
  contract: AuthoredProjectionContract,
): CompileProjectionResult {
  return compileAuthoredProjectionContractWithOptions(contract, {});
}

export function compileAuthoredProjectionContractWithOptions(
  contract: AuthoredProjectionContract,
  options: CompileProjectionOptions,
): CompileProjectionResult {
  const schemaIssues = validateSchemaBoundary(contract);
  if (schemaIssues.length > 0) {
    return failure(schemaIssues);
  }

  const flattened = flattenAuthoredFields(contract.key, contract.fields, options.fieldIdDeriver);
  const canonicalLanes = canonicalizeLanes(
    contract.lanes,
    flattened.fields,
    flattened.fieldLocalHotReservations,
  );
  const issues = [...flattened.issues, ...canonicalLanes.issues];

  if (issues.length > 0) {
    return failure(issues);
  }

  const manifest = {
    key: contract.key,
    family: contract.family,
    fields: flattened.fields,
    lanes: canonicalLanes.lanes,
  };
  const semanticVersion = deriveSemanticVersion(manifest);
  const hotLayout =
    manifest.lanes.hot === undefined ? undefined : compileHotLayoutManifest(manifest);
  if (hotLayout?.ok === false) {
    return failure(hotLayout.issues);
  }
  const warmManifest =
    manifest.lanes.warm === undefined
      ? undefined
      : deriveWarmCodecManifest(manifest, semanticVersion);

  const laneManifests: LaneManifests = {
    ...(hotLayout === undefined ? {} : { hot: hotLayout.value }),
    ...(warmManifest === undefined ? {} : { warm: warmManifest }),
  };
  const hasLaneManifests = hotLayout !== undefined || warmManifest !== undefined;

  return {
    ok: true,
    value: {
      manifest,
      semanticVersion,
      ...(hotLayout === undefined
        ? {}
        : {
            hotLayoutVersion: hotLayout.value.hotLayoutVersion,
          }),
      ...(warmManifest === undefined
        ? {}
        : {
            warmCodecVersion: warmManifest.warmCodecVersion,
          }),
      ...(hasLaneManifests
        ? {
            laneManifests,
          }
        : {}),
    },
  };
}

function validateSchemaBoundary(contract: AuthoredProjectionContract): readonly CompilerIssue[] {
  try {
    validateAuthoredProjectionContract(contract);
    return [];
  } catch (error) {
    if (error instanceof SchemaValidationError) {
      return error.issues.map((issue) =>
        createCompilerIssue("schema.invalid", issue.path, issue.message, "schema"),
      );
    }

    return [createCompilerIssue("schema.invalid", "", undefined, "schema")];
  }
}

function failure(issues: readonly CompilerIssue[]): CompileProjectionFailure {
  return {
    ok: false,
    error: createCompilerError(issues),
  };
}
