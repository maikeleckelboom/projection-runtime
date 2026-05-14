import { panic } from "@seqlok/base";
import {
  type HotCodecIssue,
  type HotLayoutManifest,
  type HotLayoutPlanningInput,
  planHotLayoutManifest,
} from "@seqlok/hot-codec";

import { type CompilerIssue, createCompilerIssue } from "./error";
import type { CanonicalProjectionManifest } from "./manifest";

export type CompileHotLayoutResult = CompileHotLayoutSuccess | CompileHotLayoutFailure;

export interface CompileHotLayoutSuccess {
  readonly ok: true;
  readonly value: HotLayoutManifest;
}

export interface CompileHotLayoutFailure {
  readonly ok: false;
  readonly issues: readonly CompilerIssue[];
}

export function compileHotLayoutManifest(
  manifest: CanonicalProjectionManifest,
): CompileHotLayoutResult {
  const hot = manifest.lanes.hot;
  if (hot === undefined) {
    return {
      ok: false,
      issues: [
        createCompilerIssue(
          "lane.hotMissing",
          "manifest.lanes.hot",
          "hot lane declaration is required to plan a hot layout",
          "compiler",
        ),
      ],
    };
  }

  const planned = planHotLayoutManifest(toHotLayoutPlanningInput(manifest));
  if (!planned.ok) {
    return {
      ok: false,
      issues: planned.error.details.issues.map(toCompilerIssue),
    };
  }

  return { ok: true, value: planned.value };
}

function toHotLayoutPlanningInput(manifest: CanonicalProjectionManifest): HotLayoutPlanningInput {
  const hot = manifest.lanes.hot;
  if (hot === undefined) {
    panic("hot lane declaration is required to plan a hot layout");
  }

  return {
    contractKey: manifest.key,
    fields: manifest.fields,
    hot,
  };
}

function toCompilerIssue(issue: HotCodecIssue): CompilerIssue {
  return createCompilerIssue(
    "hot-codec.planningFailed",
    issue.path,
    issue.message,
    "hot-codec",
    issue.code,
  );
}
