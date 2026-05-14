import {
  type HotCodecIssue,
  type HotLayoutManifest,
  type HotLayoutPlanningInput,
  planHotLayoutManifest,
} from "@seqlok/hot-codec";

import type { CompilerIssue } from "./error";
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
        {
          source: "compiler",
          code: "lane.hotMissing",
          path: "manifest.lanes.hot",
          message: "hot lane declaration is required to plan a hot layout",
        },
      ],
    };
  }

  const planned = planHotLayoutManifest(toHotLayoutPlanningInput(manifest));
  if (!planned.ok) {
    return {
      ok: false,
      issues: planned.error.issues.map(toCompilerIssue),
    };
  }

  return { ok: true, value: planned.value };
}

function toHotLayoutPlanningInput(manifest: CanonicalProjectionManifest): HotLayoutPlanningInput {
  const hot = manifest.lanes.hot;
  if (hot === undefined) {
    throw new Error("hot lane declaration is required to plan a hot layout");
  }

  return {
    contractKey: manifest.key,
    fields: manifest.fields,
    hot,
  };
}

function toCompilerIssue(issue: HotCodecIssue): CompilerIssue {
  return {
    source: "hot-codec",
    code: "hot-codec.planningFailed",
    causeCode: issue.code,
    path: issue.path,
    message: issue.message,
  };
}
