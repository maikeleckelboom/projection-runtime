import type { MeterDef, ParamDef, SpecAst, SpecNamespace } from "./ast";
import { validateSpecAst } from "./validation";

type AuthoredLeaf = ParamDef | MeterDef;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isLeaf(value: unknown): value is AuthoredLeaf {
  return isRecord(value) && typeof value.kind === "string";
}

function cloneLeaf<T extends AuthoredLeaf>(leaf: T): T {
  const output: Record<string, unknown> = {};

  for (const key of Object.keys(leaf).sort()) {
    const value = (leaf as Record<string, unknown>)[key];
    output[key] = Array.isArray(value) ? [...value] : value;
  }

  return output as T;
}

function normalizeNamespace<T extends AuthoredLeaf>(namespace: SpecNamespace<T>): SpecNamespace<T> {
  const output: Record<string, T | SpecNamespace<T>> = {};

  for (const key of Object.keys(namespace).sort()) {
    const value = namespace[key];
    output[key] = isLeaf(value)
      ? cloneLeaf(value as T)
      : normalizeNamespace(value as SpecNamespace<T>);
  }

  return output;
}

export function normalizeSpecAst(spec: SpecAst): SpecAst {
  validateSpecAst(spec);

  const output: {
    $schema?: string;
    id?: string;
    params?: SpecNamespace<ParamDef>;
    meters?: SpecNamespace<MeterDef>;
  } = {};

  if (spec.$schema !== undefined) {
    output.$schema = spec.$schema;
  }

  if (spec.id !== undefined) {
    output.id = spec.id;
  }

  if (spec.params !== undefined && Object.keys(spec.params).length > 0) {
    output.params = normalizeNamespace(spec.params);
  }

  if (spec.meters !== undefined && Object.keys(spec.meters).length > 0) {
    output.meters = normalizeNamespace(spec.meters);
  }

  return output;
}
