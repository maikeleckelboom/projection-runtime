import type { SpecAst } from "./ast";

export interface SchemaValidationIssue {
  readonly path: string;
  readonly message: string;
}

export class SchemaValidationError extends Error {
  readonly issues: readonly SchemaValidationIssue[];

  constructor(issues: readonly SchemaValidationIssue[]) {
    super(issues.map((issue) => `${issue.path}: ${issue.message}`).join("; "));
    this.name = "SchemaValidationError";
    this.issues = issues;
    Object.setPrototypeOf(this, new.target.prototype);
  }
}

const PARAM_SCALAR_KINDS = new Set(["f32", "i32", "u32", "bool", "enum"]);
const PARAM_ARRAY_KINDS = new Set([
  "f32.array",
  "i32.array",
  "u32.array",
  "u8.array",
  "i8.array",
  "i16.array",
  "u16.array",
  "bool.array",
  "enum.array",
]);
const METER_SCALAR_KINDS = new Set(["f32", "f64", "i32", "u32", "bool", "enum"]);
const METER_ARRAY_KINDS = new Set([...PARAM_ARRAY_KINDS, "f64.array"]);

interface PlaneRules {
  readonly scalarKinds: ReadonlySet<string>;
  readonly arrayKinds: ReadonlySet<string>;
  readonly rangedKinds: ReadonlySet<string>;
  readonly unsignedRangedKinds: ReadonlySet<string>;
  readonly integerRangedKinds: ReadonlySet<string>;
}

const PARAM_RULES: PlaneRules = {
  scalarKinds: PARAM_SCALAR_KINDS,
  arrayKinds: PARAM_ARRAY_KINDS,
  rangedKinds: new Set(["f32", "i32", "u32"]),
  unsignedRangedKinds: new Set(["u32"]),
  integerRangedKinds: new Set(["i32", "u32"]),
};

const METER_RULES: PlaneRules = {
  scalarKinds: METER_SCALAR_KINDS,
  arrayKinds: METER_ARRAY_KINDS,
  rangedKinds: new Set(),
  unsignedRangedKinds: new Set(),
  integerRangedKinds: new Set(),
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function addIssue(issues: SchemaValidationIssue[], path: string, message: string): false {
  issues.push({ path, message });
  return false;
}

function isPositiveInteger(value: unknown): value is number {
  return typeof value === "number" && Number.isInteger(value) && value >= 1;
}

function validateEnumVocabulary(
  values: unknown,
  path: string,
  issues: SchemaValidationIssue[],
): boolean {
  if (!Array.isArray(values)) {
    return addIssue(issues, `${path}.values`, "must be an array");
  }

  if (values.length === 0) {
    return addIssue(issues, `${path}.values`, "must not be empty");
  }

  let valid = true;
  const seen = new Set<string>();
  for (let index = 0; index < values.length; index += 1) {
    const value = values[index];
    const valuePath = `${path}.values[${index}]`;

    if (typeof value !== "string" || value.length === 0) {
      valid = addIssue(issues, valuePath, "must be a non-empty string");
      continue;
    }

    if (seen.has(value)) {
      valid = addIssue(issues, valuePath, "duplicate enum label");
      continue;
    }

    seen.add(value);
  }

  return valid;
}

function validateRangeProperty(
  def: Record<string, unknown>,
  key: "min" | "max",
  path: string,
  issues: SchemaValidationIssue[],
  rules: PlaneRules,
  kind: string,
): boolean {
  if (!(key in def)) {
    return true;
  }

  const value = def[key];
  const propertyPath = `${path}.${key}`;

  if (rules.integerRangedKinds.has(kind) && !Number.isInteger(value)) {
    return addIssue(issues, propertyPath, "must be an integer");
  }

  if (!rules.integerRangedKinds.has(kind) && typeof value !== "number") {
    return addIssue(issues, propertyPath, "must be a number");
  }

  if (rules.unsignedRangedKinds.has(kind) && typeof value === "number" && value < 0) {
    return addIssue(issues, propertyPath, "must be non-negative");
  }

  return true;
}

function validateLeaf(
  def: Record<string, unknown>,
  path: string,
  issues: SchemaValidationIssue[],
  rules: PlaneRules,
): boolean {
  if (typeof def.kind !== "string") {
    return addIssue(issues, `${path}.kind`, "must be a string");
  }

  const kind = def.kind;
  if (!rules.scalarKinds.has(kind) && !rules.arrayKinds.has(kind)) {
    return addIssue(issues, `${path}.kind`, `unsupported kind: ${kind}`);
  }

  let valid = true;
  const allowedKeys = new Set(["kind"]);

  if (rules.arrayKinds.has(kind)) {
    allowedKeys.add("length");
    if (!("length" in def)) {
      valid = addIssue(issues, `${path}.length`, "required for array kind");
    } else if (!isPositiveInteger(def.length)) {
      valid = addIssue(issues, `${path}.length`, "must be a positive integer");
    }
  }

  if (rules.rangedKinds.has(kind)) {
    allowedKeys.add("min");
    allowedKeys.add("max");
    valid = validateRangeProperty(def, "min", path, issues, rules, kind) && valid;
    valid = validateRangeProperty(def, "max", path, issues, rules, kind) && valid;
  }

  if (kind === "enum" || kind === "enum.array") {
    allowedKeys.add("values");
    if (!("values" in def)) {
      valid = addIssue(issues, `${path}.values`, `required for ${kind}`);
    } else {
      valid = validateEnumVocabulary(def.values, path, issues) && valid;
    }
  }

  for (const key of Object.keys(def)) {
    if (!allowedKeys.has(key)) {
      valid = addIssue(issues, `${path}.${key}`, `unknown property on ${kind} def`);
    }
  }

  return valid;
}

function validateNamespace(
  node: unknown,
  path: string,
  issues: SchemaValidationIssue[],
  rules: PlaneRules,
): boolean {
  if (!isRecord(node)) {
    return addIssue(issues, path, "namespace must be an object");
  }

  let valid = true;
  for (const [key, value] of Object.entries(node)) {
    const childPath = `${path}.${key}`;

    if (!isRecord(value)) {
      valid = addIssue(issues, childPath, "namespace entry must be an object");
      continue;
    }

    if (typeof value.kind === "string" || "kind" in value) {
      valid = validateLeaf(value, childPath, issues, rules) && valid;
      continue;
    }

    valid = validateNamespace(value, childPath, issues, rules) && valid;
  }

  return valid;
}

export function validateSpecAst(spec: unknown): spec is SpecAst {
  const issues: SchemaValidationIssue[] = [];

  if (!isRecord(spec)) {
    throw new SchemaValidationError([{ path: "", message: "spec must be an object" }]);
  }

  const allowedTopLevelKeys = new Set(["$schema", "id", "params", "meters"]);
  for (const key of Object.keys(spec)) {
    if (!allowedTopLevelKeys.has(key)) {
      issues.push({ path: key, message: "unknown top-level property" });
    }
  }

  if (
    "$schema" in spec &&
    spec.$schema !== undefined &&
    (typeof spec.$schema !== "string" || spec.$schema.length === 0)
  ) {
    issues.push({ path: "$schema", message: "must be a non-empty string when present" });
  }

  if (
    "id" in spec &&
    spec.id !== undefined &&
    (typeof spec.id !== "string" || spec.id.length === 0)
  ) {
    issues.push({ path: "id", message: "must be a non-empty string when present" });
  }

  if ("params" in spec && spec.params !== undefined) {
    validateNamespace(spec.params, "params", issues, PARAM_RULES);
  }

  if ("meters" in spec && spec.meters !== undefined) {
    validateNamespace(spec.meters, "meters", issues, METER_RULES);
  }

  if (issues.length > 0) {
    throw new SchemaValidationError(issues);
  }

  return true;
}
