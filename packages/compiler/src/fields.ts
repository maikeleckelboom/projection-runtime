import type {
  AuthoredFieldShape,
  AuthoredFieldTree,
  AuthoredFixedEnumField,
  AuthoredFixedScalarField,
  AuthoredFixedVectorField,
} from "@seqlok/schema";

import type { CompilerIssue } from "./error";
import { deriveFieldId, type FieldIdDeriver } from "./field-id";
import type {
  CanonicalBoundedMapShape,
  CanonicalField,
  CanonicalFieldShape,
  CanonicalFixedEnumShape,
  CanonicalFixedScalarShape,
  CanonicalFixedVectorShape,
} from "./manifest";

const UINT16_MAX = 0xffff;
const UINT32_MAX = 0xffffffff;

export interface FieldLocalHotReservation {
  readonly dotPath: string;
  readonly path: string;
}

export interface FlattenFieldsResult {
  readonly fields: readonly CanonicalField[];
  readonly fieldLocalHotReservations: readonly FieldLocalHotReservation[];
  readonly issues: readonly CompilerIssue[];
}

export function flattenAuthoredFields(
  contractKey: string,
  tree: AuthoredFieldTree,
  fieldIdDeriver: FieldIdDeriver = deriveFieldId,
): FlattenFieldsResult {
  const fields: CanonicalField[] = [];
  const issues: CompilerIssue[] = [];
  const reservations: FieldLocalHotReservation[] = [];
  const dotPaths = new Set<string>();

  traverseFieldTree(contractKey, tree, [], fields, reservations, issues, dotPaths, fieldIdDeriver);
  fields.sort((left, right) => compareUtf8(left.dotPath, right.dotPath));
  issues.push(...detectFieldIdCollisions(fields));

  if (fields.length > UINT32_MAX) {
    issues.push({
      code: "field.countOutOfRange",
      path: "fields",
      message: "field count exceeds canonical u32 encoding range",
    });
  }

  return { fields, fieldLocalHotReservations: reservations, issues };
}

export function compareUtf8(left: string, right: string): number {
  return Buffer.compare(Buffer.from(left, "utf8"), Buffer.from(right, "utf8"));
}

function traverseFieldTree(
  contractKey: string,
  node: AuthoredFieldTree,
  segments: readonly string[],
  fields: CanonicalField[],
  reservations: FieldLocalHotReservation[],
  issues: CompilerIssue[],
  dotPaths: Set<string>,
  fieldIdDeriver: FieldIdDeriver,
): void {
  for (const segment of Object.keys(node).sort(compareUtf8)) {
    const value = node[segment];
    const childSegments = [...segments, segment];
    const path = childSegments.join(".");
    const issuePath = `fields.${path}`;

    if (!isRecord(value)) {
      issues.push({
        code: "field.malformedTree",
        path: issuePath,
        message: "field tree entry must be an object",
      });
      continue;
    }

    if (typeof value.kind === "string") {
      const shape = value as unknown as AuthoredFieldShape;
      collectEncodingIssues(shape, issuePath, issues);

      if (dotPaths.has(path)) {
        issues.push({
          code: "field.duplicateDotPath",
          path: issuePath,
          message: "duplicate canonical field dotPath",
        });
        continue;
      }

      dotPaths.add(path);
      const fieldId = fieldIdDeriver(contractKey, path);
      if (!Number.isInteger(fieldId) || fieldId < 0 || fieldId > UINT32_MAX) {
        issues.push({
          code: "field.fieldIdInvalid",
          path: issuePath,
          message: "fieldId derivation must produce a u32 number",
        });
      }

      if ("hotReservation" in shape && shape.hotReservation === true) {
        if (shape.kind === "bounded-array" || shape.kind === "bounded-map") {
          reservations.push({ dotPath: path, path: `${issuePath}.hotReservation` });
        } else {
          issues.push({
            code: "lane.hotReservationWrongShape",
            path: `${issuePath}.hotReservation`,
            message: "field-local hotReservation is only legal on bounded-array or bounded-map",
          });
        }
      }

      fields.push({
        dotPath: path,
        fieldId,
        shape: canonicalizeShape(shape),
      });
      continue;
    }

    traverseFieldTree(
      contractKey,
      value as AuthoredFieldTree,
      childSegments,
      fields,
      reservations,
      issues,
      dotPaths,
      fieldIdDeriver,
    );
  }
}

function detectFieldIdCollisions(fields: readonly CanonicalField[]): readonly CompilerIssue[] {
  const issues: CompilerIssue[] = [];
  const seen = new Map<number, CanonicalField>();

  for (const field of fields) {
    const existing = seen.get(field.fieldId);
    if (existing !== undefined) {
      issues.push({
        code: "field.fieldIdCollision",
        path: `fields.${field.dotPath}`,
        message: `fieldId collides with ${existing.dotPath}`,
      });
      continue;
    }

    seen.set(field.fieldId, field);
  }

  return issues;
}

function canonicalizeShape(shape: AuthoredFieldShape): CanonicalFieldShape {
  switch (shape.kind) {
    case "fixed-scalar":
      return canonicalizeFixedScalar(shape);

    case "fixed-enum":
      return canonicalizeFixedEnum(shape);

    case "fixed-vector":
      return canonicalizeFixedVector(shape);

    case "fixed-string-encoded":
      return {
        kind: "FixedStringEncoded",
        byteLength: shape.byteLength,
        encoding: shape.encoding,
      };

    case "bounded-array":
      return {
        kind: "BoundedArray",
        elementType: shape.elementType,
        maxLength: shape.maxLength,
      };

    case "bounded-map":
      return {
        kind: "BoundedMap",
        keyEncoding: shape.keyEncoding,
        keyByteLength: shape.keyByteLength,
        valueShape: canonicalizeFixedValueShape(shape.valueShape),
        maxEntries: shape.maxEntries,
      };

    case "variable-string":
      return { kind: "VariableString" };

    case "variable-map":
      return {
        kind: "VariableMap",
        valueShape: canonicalizeShape(shape.valueShape),
      };
  }
}

function canonicalizeFixedScalar(shape: AuthoredFixedScalarField): CanonicalFixedScalarShape {
  if (shape.nanSentinel === true) {
    return { kind: "FixedScalar", type: shape.type, nanSentinel: true };
  }

  return { kind: "FixedScalar", type: shape.type };
}

function canonicalizeFixedEnum(shape: AuthoredFixedEnumField): CanonicalFixedEnumShape {
  return {
    kind: "FixedEnum",
    variants: [...shape.variants],
    storage: shape.storage,
  };
}

function canonicalizeFixedVector(shape: AuthoredFixedVectorField): CanonicalFixedVectorShape {
  return {
    kind: "FixedVector",
    elementType: shape.elementType,
    length: shape.length,
  };
}

function canonicalizeFixedValueShape(
  shape: AuthoredFixedScalarField | AuthoredFixedEnumField | AuthoredFixedVectorField,
): CanonicalBoundedMapShape["valueShape"] {
  switch (shape.kind) {
    case "fixed-scalar":
      return canonicalizeFixedScalar(shape);

    case "fixed-enum":
      return canonicalizeFixedEnum(shape);

    case "fixed-vector":
      return canonicalizeFixedVector(shape);
  }
}

function collectEncodingIssues(
  shape: AuthoredFieldShape,
  path: string,
  issues: CompilerIssue[],
): void {
  switch (shape.kind) {
    case "fixed-enum":
      checkUint16(
        shape.variants.length,
        `${path}.variants`,
        "field.enumVariantCountOutOfRange",
        issues,
      );
      for (let index = 0; index < shape.variants.length; index += 1) {
        const variant = shape.variants[index];
        if (variant?.includes("\0")) {
          issues.push({
            code: "field.enumVariantContainsNul",
            path: `${path}.variants[${index}]`,
            message: "enum variant cannot contain a null byte",
          });
        }
      }
      return;

    case "fixed-vector":
      checkUint32(shape.length, `${path}.length`, "field.lengthOutOfRange", issues);
      return;

    case "fixed-string-encoded":
      checkUint16(shape.byteLength, `${path}.byteLength`, "field.byteLengthOutOfRange", issues);
      return;

    case "bounded-array":
      checkUint32(shape.maxLength, `${path}.maxLength`, "field.maxLengthOutOfRange", issues);
      return;

    case "bounded-map":
      checkUint16(
        shape.keyByteLength,
        `${path}.keyByteLength`,
        "field.keyByteLengthOutOfRange",
        issues,
      );
      checkUint32(shape.maxEntries, `${path}.maxEntries`, "field.maxEntriesOutOfRange", issues);
      collectEncodingIssues(shape.valueShape, `${path}.valueShape`, issues);
      return;

    case "variable-map":
      collectEncodingIssues(shape.valueShape, `${path}.valueShape`, issues);
      return;

    case "fixed-scalar":
    case "variable-string":
      return;
  }
}

function checkUint16(value: number, path: string, code: string, issues: CompilerIssue[]): void {
  if (value > UINT16_MAX) {
    issues.push({ code, path, message: "value exceeds canonical u16 encoding range" });
  }
}

function checkUint32(value: number, path: string, code: string, issues: CompilerIssue[]): void {
  if (value > UINT32_MAX) {
    issues.push({ code, path, message: "value exceeds canonical u32 encoding range" });
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
