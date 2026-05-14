import type { AuthoredFieldShape, AuthoredProjectionContract } from "./ast";

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

const SEGMENT_PATTERN = /^[a-z][a-zA-Z0-9]*$/;
const PATH_PATTERN = /^[a-z][a-zA-Z0-9]*(?:\.[a-z][a-zA-Z0-9]*)*$/;

const SCALAR_TYPES = new Set([
  "bool",
  "u8",
  "u16",
  "u32",
  "u64",
  "i8",
  "i16",
  "i32",
  "i64",
  "f32",
  "f64",
]);
const ENUM_STORAGE_TYPES = new Set(["u8", "u16", "u32"]);
const STRING_ENCODINGS = new Set(["utf8", "ascii"]);
const FIELD_KINDS = new Set([
  "fixed-scalar",
  "fixed-enum",
  "fixed-vector",
  "bounded-array",
  "bounded-map",
  "variable-map",
  "fixed-string-encoded",
  "variable-string",
]);

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

function validateAllowedKeys(
  record: Record<string, unknown>,
  allowedKeys: ReadonlySet<string>,
  path: string,
  issues: SchemaValidationIssue[],
): boolean {
  let valid = true;
  for (const key of Object.keys(record)) {
    if (!allowedKeys.has(key)) {
      valid = addIssue(issues, path ? `${path}.${key}` : key, "unknown property") && valid;
    }
  }
  return valid;
}

function validateStringLiteral(
  value: unknown,
  allowedValues: ReadonlySet<string>,
  path: string,
  issues: SchemaValidationIssue[],
): boolean {
  if (typeof value !== "string") {
    return addIssue(issues, path, "must be a string");
  }

  if (!allowedValues.has(value)) {
    return addIssue(issues, path, `unsupported value: ${value}`);
  }

  return true;
}

function validateTrueLiteral(
  value: unknown,
  path: string,
  issues: SchemaValidationIssue[],
): boolean {
  if (value !== true) {
    return addIssue(issues, path, "must be true when present");
  }

  return true;
}

function validateEnumVariants(
  variants: unknown,
  path: string,
  issues: SchemaValidationIssue[],
): boolean {
  if (!Array.isArray(variants)) {
    return addIssue(issues, path, "must be an array");
  }

  if (variants.length === 0) {
    return addIssue(issues, path, "must not be empty");
  }

  let valid = true;
  const seen = new Set<string>();
  for (let index = 0; index < variants.length; index += 1) {
    const variant = variants[index];
    const variantPath = `${path}[${index}]`;

    if (typeof variant !== "string" || variant.length === 0) {
      valid = addIssue(issues, variantPath, "must be a non-empty string") && valid;
      continue;
    }

    if (seen.has(variant)) {
      valid = addIssue(issues, variantPath, "duplicate enum variant") && valid;
      continue;
    }

    seen.add(variant);
  }

  return valid;
}

function validateRequiredProperty(
  record: Record<string, unknown>,
  key: string,
  path: string,
  issues: SchemaValidationIssue[],
): boolean {
  if (!(key in record)) {
    return addIssue(issues, `${path}.${key}`, "required");
  }

  return true;
}

function validateFixedValueShape(
  shape: unknown,
  path: string,
  issues: SchemaValidationIssue[],
): boolean {
  if (!isRecord(shape)) {
    return addIssue(issues, path, "must be an object");
  }

  if (
    shape.kind !== "fixed-scalar" &&
    shape.kind !== "fixed-enum" &&
    shape.kind !== "fixed-vector"
  ) {
    return addIssue(issues, `${path}.kind`, "must be a fixed value shape");
  }

  return validateFieldShape(shape, path, issues);
}

function validateFieldShape(
  shape: Record<string, unknown>,
  path: string,
  issues: SchemaValidationIssue[],
): boolean {
  if (typeof shape.kind !== "string") {
    return addIssue(issues, `${path}.kind`, "must be a string");
  }

  if (!FIELD_KINDS.has(shape.kind)) {
    return addIssue(issues, `${path}.kind`, `unsupported field shape kind: ${shape.kind}`);
  }

  let valid = true;

  switch (shape.kind) {
    case "fixed-scalar": {
      valid = validateAllowedKeys(shape, new Set(["kind", "type", "nanSentinel"]), path, issues) && valid;
      valid = validateRequiredProperty(shape, "type", path, issues) && valid;
      if ("type" in shape) {
        valid = validateStringLiteral(shape.type, SCALAR_TYPES, `${path}.type`, issues) && valid;
      }
      if ("nanSentinel" in shape) {
        valid = validateTrueLiteral(shape.nanSentinel, `${path}.nanSentinel`, issues) && valid;
      }
      return valid;
    }

    case "fixed-enum": {
      valid = validateAllowedKeys(shape, new Set(["kind", "variants", "storage"]), path, issues) && valid;
      valid = validateRequiredProperty(shape, "variants", path, issues) && valid;
      valid = validateRequiredProperty(shape, "storage", path, issues) && valid;
      if ("variants" in shape) {
        valid = validateEnumVariants(shape.variants, `${path}.variants`, issues) && valid;
      }
      if ("storage" in shape) {
        valid = validateStringLiteral(shape.storage, ENUM_STORAGE_TYPES, `${path}.storage`, issues) && valid;
      }
      return valid;
    }

    case "fixed-vector": {
      valid = validateAllowedKeys(shape, new Set(["kind", "elementType", "length"]), path, issues) && valid;
      valid = validateRequiredProperty(shape, "elementType", path, issues) && valid;
      valid = validateRequiredProperty(shape, "length", path, issues) && valid;
      if ("elementType" in shape) {
        valid = validateStringLiteral(shape.elementType, SCALAR_TYPES, `${path}.elementType`, issues) && valid;
      }
      if ("length" in shape && !isPositiveInteger(shape.length)) {
        valid = addIssue(issues, `${path}.length`, "must be a positive integer") && valid;
      }
      return valid;
    }

    case "bounded-array": {
      valid =
        validateAllowedKeys(
          shape,
          new Set(["kind", "elementType", "maxLength", "hotReservation"]),
          path,
          issues,
        ) && valid;
      valid = validateRequiredProperty(shape, "elementType", path, issues) && valid;
      valid = validateRequiredProperty(shape, "maxLength", path, issues) && valid;
      if ("elementType" in shape) {
        valid = validateStringLiteral(shape.elementType, SCALAR_TYPES, `${path}.elementType`, issues) && valid;
      }
      if ("maxLength" in shape && !isPositiveInteger(shape.maxLength)) {
        valid = addIssue(issues, `${path}.maxLength`, "must be a positive integer") && valid;
      }
      if ("hotReservation" in shape) {
        valid = validateTrueLiteral(shape.hotReservation, `${path}.hotReservation`, issues) && valid;
      }
      return valid;
    }

    case "bounded-map": {
      valid =
        validateAllowedKeys(
          shape,
          new Set([
            "kind",
            "keyEncoding",
            "keyByteLength",
            "valueShape",
            "maxEntries",
            "hotReservation",
          ]),
          path,
          issues,
        ) && valid;
      valid = validateRequiredProperty(shape, "keyEncoding", path, issues) && valid;
      valid = validateRequiredProperty(shape, "keyByteLength", path, issues) && valid;
      valid = validateRequiredProperty(shape, "valueShape", path, issues) && valid;
      valid = validateRequiredProperty(shape, "maxEntries", path, issues) && valid;
      if ("keyEncoding" in shape && shape.keyEncoding !== "fixed-ascii") {
        valid = addIssue(issues, `${path}.keyEncoding`, "must be fixed-ascii") && valid;
      }
      if ("keyByteLength" in shape && !isPositiveInteger(shape.keyByteLength)) {
        valid = addIssue(issues, `${path}.keyByteLength`, "must be a positive integer") && valid;
      }
      if ("valueShape" in shape) {
        valid = validateFixedValueShape(shape.valueShape, `${path}.valueShape`, issues) && valid;
      }
      if ("maxEntries" in shape && !isPositiveInteger(shape.maxEntries)) {
        valid = addIssue(issues, `${path}.maxEntries`, "must be a positive integer") && valid;
      }
      if ("hotReservation" in shape) {
        valid = validateTrueLiteral(shape.hotReservation, `${path}.hotReservation`, issues) && valid;
      }
      return valid;
    }

    case "variable-map": {
      valid = validateAllowedKeys(shape, new Set(["kind", "valueShape"]), path, issues) && valid;
      valid = validateRequiredProperty(shape, "valueShape", path, issues) && valid;
      if ("valueShape" in shape) {
        if (isRecord(shape.valueShape)) {
          valid = validateFieldShape(shape.valueShape, `${path}.valueShape`, issues) && valid;
        } else {
          valid = addIssue(issues, `${path}.valueShape`, "must be an object") && valid;
        }
      }
      return valid;
    }

    case "fixed-string-encoded": {
      valid = validateAllowedKeys(shape, new Set(["kind", "byteLength", "encoding"]), path, issues) && valid;
      valid = validateRequiredProperty(shape, "byteLength", path, issues) && valid;
      valid = validateRequiredProperty(shape, "encoding", path, issues) && valid;
      if ("byteLength" in shape && !isPositiveInteger(shape.byteLength)) {
        valid = addIssue(issues, `${path}.byteLength`, "must be a positive integer") && valid;
      }
      if ("encoding" in shape) {
        valid = validateStringLiteral(shape.encoding, STRING_ENCODINGS, `${path}.encoding`, issues) && valid;
      }
      return valid;
    }

    case "variable-string":
      return validateAllowedKeys(shape, new Set(["kind"]), path, issues) && valid;
  }

  return addIssue(issues, `${path}.kind`, `unsupported field shape kind: ${shape.kind}`);
}

function validateFieldTree(
  node: unknown,
  path: string,
  issues: SchemaValidationIssue[],
): boolean {
  if (!isRecord(node)) {
    return addIssue(issues, path, "must be an object");
  }

  let valid = true;
  for (const [segment, value] of Object.entries(node)) {
    const childPath = `${path}.${segment}`;

    if (!SEGMENT_PATTERN.test(segment)) {
      valid = addIssue(issues, childPath, "invalid field path segment") && valid;
    }

    if (!isRecord(value)) {
      valid = addIssue(issues, childPath, "field tree entry must be an object") && valid;
      continue;
    }

    if ("kind" in value) {
      valid = validateFieldShape(value, childPath, issues) && valid;
      continue;
    }

    valid = validateFieldTree(value, childPath, issues) && valid;
  }

  return valid;
}

function validatePath(value: unknown, path: string, issues: SchemaValidationIssue[]): boolean {
  if (typeof value !== "string" || value.length === 0) {
    return addIssue(issues, path, "must be a non-empty string");
  }

  if (!PATH_PATTERN.test(value)) {
    return addIssue(issues, path, "invalid path grammar");
  }

  return true;
}

function validateLaneDeclarations(
  lanes: unknown,
  path: string,
  issues: SchemaValidationIssue[],
): boolean {
  if (!isRecord(lanes)) {
    return addIssue(issues, path, "must be an object");
  }

  let valid = validateAllowedKeys(lanes, new Set(["hot", "warm", "cold"]), path, issues);

  if ("hot" in lanes) {
    if (!isRecord(lanes.hot)) {
      valid = addIssue(issues, `${path}.hot`, "must be an object") && valid;
    } else {
      valid = validateAllowedKeys(lanes.hot, new Set(["reservations"]), `${path}.hot`, issues) && valid;
      if ("reservations" in lanes.hot) {
        if (!Array.isArray(lanes.hot.reservations)) {
          valid = addIssue(issues, `${path}.hot.reservations`, "must be an array") && valid;
        } else {
          lanes.hot.reservations.forEach((reservation, index) => {
            valid =
              validatePath(reservation, `${path}.hot.reservations[${index}]`, issues) && valid;
          });
        }
      }
    }
  }

  if ("warm" in lanes) {
    if (!isRecord(lanes.warm)) {
      valid = addIssue(issues, `${path}.warm`, "must be an object") && valid;
    } else {
      valid = validateAllowedKeys(lanes.warm, new Set(["codec"]), `${path}.warm`, issues) && valid;
      if ("codec" in lanes.warm && lanes.warm.codec !== "framed-snapshot") {
        valid =
          addIssue(issues, `${path}.warm.codec`, "must be framed-snapshot when present") && valid;
      }
    }
  }

  if ("cold" in lanes) {
    if (!isRecord(lanes.cold)) {
      valid = addIssue(issues, `${path}.cold`, "must be an object") && valid;
    } else {
      valid =
        validateAllowedKeys(lanes.cold, new Set(["materialization"]), `${path}.cold`, issues) &&
        valid;
      if (
        "materialization" in lanes.cold &&
        lanes.cold.materialization !== "latest-snapshot" &&
        lanes.cold.materialization !== "checkpointed-snapshot"
      ) {
        valid =
          addIssue(
            issues,
            `${path}.cold.materialization`,
            "must be latest-snapshot or checkpointed-snapshot when present",
          ) && valid;
      }
    }
  }

  return valid;
}

export function validateAuthoredProjectionContract(
  contract: unknown,
): contract is AuthoredProjectionContract {
  const issues: SchemaValidationIssue[] = [];

  if (!isRecord(contract)) {
    throw new SchemaValidationError([{ path: "", message: "contract must be an object" }]);
  }

  const allowedTopLevelKeys = new Set([
    "$schema",
    "key",
    "family",
    "fields",
    "lanes",
    "revisionNote",
  ]);
  validateAllowedKeys(contract, allowedTopLevelKeys, "", issues);

  if (
    "$schema" in contract &&
    contract.$schema !== undefined &&
    (typeof contract.$schema !== "string" || contract.$schema.length === 0)
  ) {
    issues.push({ path: "$schema", message: "must be a non-empty string when present" });
  }

  if (!("key" in contract)) {
    issues.push({ path: "key", message: "required" });
  } else {
    validatePath(contract.key, "key", issues);
  }

  if (!("family" in contract)) {
    issues.push({ path: "family", message: "required" });
  } else if (contract.family !== "replaceable-snapshot") {
    issues.push({ path: "family", message: "must be replaceable-snapshot" });
  }

  if (!("fields" in contract)) {
    issues.push({ path: "fields", message: "required" });
  } else {
    validateFieldTree(contract.fields, "fields", issues);
  }

  if ("lanes" in contract && contract.lanes !== undefined) {
    validateLaneDeclarations(contract.lanes, "lanes", issues);
  }

  if (
    "revisionNote" in contract &&
    contract.revisionNote !== undefined &&
    typeof contract.revisionNote !== "string"
  ) {
    issues.push({ path: "revisionNote", message: "must be a string when present" });
  }

  if (issues.length > 0) {
    throw new SchemaValidationError(issues);
  }

  return true;
}

export type { AuthoredFieldShape };
