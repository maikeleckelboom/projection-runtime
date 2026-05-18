import { panic } from "@exclave/base";
import type { ScalarType } from "@exclave/schema";
import {
  buildProjectionFieldIdentityMirror,
  deriveProjectionFieldIdentityArtifact,
  type ProjectionFieldIdentityEntry,
  type ProjectionFieldIdentityMirror,
} from "./field-identity";
import { compareUtf8 } from "./fields";
import type {
  CanonicalField,
  CanonicalFieldShape,
  ResolvedProjectionContract,
  WarmFieldEntry,
} from "./manifest";

export interface EmitTypeScriptProjectionConsumerBindingSourceOptions {
  readonly resolved: ResolvedProjectionContract;
  readonly symbolStem?: string;
}

export function emitTypeScriptProjectionConsumerBindingSource(
  options: EmitTypeScriptProjectionConsumerBindingSourceOptions,
): string {
  const resolved = options.resolved;
  const symbolStem = options.symbolStem ?? symbolStemFromContractKey(resolved.manifest.key);
  assertTypeScriptIdentifier(symbolStem, "symbolStem");

  const constStem = lowerFirst(symbolStem);
  const names = {
    fieldsConstName: `${constStem}Fields`,
    fieldPathTypeName: `${symbolStem}FieldPath`,
    fieldIdConstName: `${constStem}FieldIds`,
    metadataConstName: `${constStem}ConsumerBindingMetadata`,
    runtimeAvailabilityConstName: `${constStem}ConsumerBindingRuntimeAvailability`,
    projectionSnapshotTypeName: `${symbolStem}ProjectionSnapshot`,
    hotSnapshotTypeName: `${symbolStem}HotSnapshot`,
    hotReadSurfaceTypeName: `${symbolStem}HotReadSurface`,
    warmSnapshotTypeName: `${symbolStem}WarmSnapshot`,
    warmSnapshotSurfaceTypeName: `${symbolStem}WarmSnapshotSurface`,
    consumerBindingTypeName: `${symbolStem}ConsumerBinding`,
  };

  for (const [optionName, value] of Object.entries(names)) {
    assertTypeScriptIdentifier(value, optionName);
  }

  const fieldIdentity = deriveProjectionFieldIdentityArtifact(resolved);
  const mirror = buildProjectionFieldIdentityMirror(fieldIdentity.fields);
  const hotManifest = resolved.laneManifests?.hot;
  const warmManifest = resolved.laneManifests?.warm;
  const parts: string[] = [];

  if (hotManifest !== undefined) {
    parts.push(
      'import type { HotReadAttemptResult, HotReadOptions } from "@exclave/hot-consumer";',
      "",
    );
  }

  parts.push(
    emitConstObject(names.fieldsConstName, formatMirrorObject(mirror, 0)),
    "",
    emitFieldPathUnion(names.fieldPathTypeName, fieldIdentity.fields),
    "",
    emitConstObject(names.fieldIdConstName, formatFieldIdMap(fieldIdentity.fields)),
    "",
    emitConstObject(names.metadataConstName, formatConsumerBindingMetadata(resolved)),
    "",
    emitConstObject(names.runtimeAvailabilityConstName, formatRuntimeAvailability(resolved)),
    "",
    emitSnapshotType(names.projectionSnapshotTypeName, resolved.manifest.fields),
  );

  if (hotManifest !== undefined) {
    parts.push(
      "",
      emitSnapshotType(names.hotSnapshotTypeName, hotManifest.fields),
      "",
      emitHotReadSurfaceType(names),
    );
  }

  if (warmManifest !== undefined) {
    parts.push(
      "",
      emitWarmSnapshotType(names.warmSnapshotTypeName, warmManifest.fields),
      "",
      emitWarmSnapshotSurfaceType(names),
    );
  }

  parts.push("", emitConsumerBindingType(names, resolved), "");

  return parts.join("\n");
}

function emitConstObject(name: string, objectSource: string): string {
  return `export const ${name} = ${objectSource} as const;`;
}

function emitFieldPathUnion(
  typeName: string,
  fields: readonly ProjectionFieldIdentityEntry[],
): string {
  if (fields.length === 0) {
    return `export type ${typeName} = never;`;
  }

  const members = fields.map((field) => `  | ${JSON.stringify(field.dotPath)}`).join("\n");
  return `export type ${typeName} =\n${members};`;
}

function emitSnapshotType(
  typeName: string,
  fields: readonly Pick<CanonicalField, "dotPath" | "shape">[],
): string {
  if (fields.length === 0) {
    return `export type ${typeName} = Record<never, never>;`;
  }

  const lines = [`export type ${typeName} = {`];
  for (const field of sortedFieldShapes(fields)) {
    lines.push(
      `  readonly ${formatPropertyKey(field.dotPath)}: ${typeScriptTypeForShape(field.shape)};`,
    );
  }
  lines.push("};");
  return lines.join("\n");
}

function emitWarmSnapshotType(typeName: string, fields: readonly WarmFieldEntry[]): string {
  return emitSnapshotType(typeName, fields);
}

function emitHotReadSurfaceType(names: {
  readonly metadataConstName: string;
  readonly hotSnapshotTypeName: string;
  readonly hotReadSurfaceTypeName: string;
}): string {
  return [
    `export type ${names.hotReadSurfaceTypeName} = {`,
    '  readonly lane: "hot";',
    `  readonly hotLayoutVersion: typeof ${names.metadataConstName}.hotLayoutVersion;`,
    "  readonly tryReadLatest: (",
    "    options?: HotReadOptions,",
    `  ) => HotReadAttemptResult<${names.hotSnapshotTypeName}>;`,
    "};",
  ].join("\n");
}

function emitWarmSnapshotSurfaceType(names: {
  readonly metadataConstName: string;
  readonly warmSnapshotTypeName: string;
  readonly warmSnapshotSurfaceTypeName: string;
}): string {
  return [
    `export type ${names.warmSnapshotSurfaceTypeName} = {`,
    '  readonly lane: "warm";',
    `  readonly warmCodecVersion: typeof ${names.metadataConstName}.warmCodecVersion;`,
    `  readonly snapshot: ${names.warmSnapshotTypeName};`,
    "};",
  ].join("\n");
}

function emitConsumerBindingType(
  names: {
    readonly consumerBindingTypeName: string;
    readonly fieldsConstName: string;
    readonly fieldIdConstName: string;
    readonly metadataConstName: string;
    readonly runtimeAvailabilityConstName: string;
    readonly hotReadSurfaceTypeName: string;
    readonly warmSnapshotSurfaceTypeName: string;
  },
  resolved: ResolvedProjectionContract,
): string {
  const lines = [
    `export type ${names.consumerBindingTypeName} = {`,
    `  readonly fields: typeof ${names.fieldsConstName};`,
    `  readonly fieldIds: typeof ${names.fieldIdConstName};`,
    `  readonly metadata: typeof ${names.metadataConstName};`,
    `  readonly runtimeAvailability: typeof ${names.runtimeAvailabilityConstName};`,
  ];

  if (resolved.laneManifests?.hot !== undefined) {
    lines.push(`  readonly hot: ${names.hotReadSurfaceTypeName};`);
  }

  if (resolved.laneManifests?.warm !== undefined) {
    lines.push(`  readonly warm: ${names.warmSnapshotSurfaceTypeName};`);
  }

  lines.push("};");
  return lines.join("\n");
}

function formatMirrorObject(node: ProjectionFieldIdentityMirror, depth: number): string {
  const indent = "  ".repeat(depth);
  const childIndent = "  ".repeat(depth + 1);
  const lines = ["{"];

  for (const key of Object.keys(node).sort(compareUtf8)) {
    const value = node[key];
    if (value === undefined) {
      panic(`missing generated consumer binding mirror value for segment: ${key}`);
    }

    if (typeof value === "string") {
      lines.push(`${childIndent}${formatPropertyKey(key)}: ${JSON.stringify(value)},`);
      continue;
    }

    lines.push(`${childIndent}${formatPropertyKey(key)}: ${formatMirrorObject(value, depth + 1)},`);
  }

  lines.push(`${indent}}`);
  return lines.join("\n");
}

function formatFieldIdMap(fields: readonly ProjectionFieldIdentityEntry[]): string {
  const lines = ["{"];

  for (const field of fields) {
    lines.push(`  ${JSON.stringify(field.dotPath)}: ${field.fieldId},`);
  }

  lines.push("}");
  return lines.join("\n");
}

function formatConsumerBindingMetadata(resolved: ResolvedProjectionContract): string {
  const lines = [
    "{",
    `  contractKey: ${JSON.stringify(resolved.manifest.key)},`,
    `  semanticVersion: ${formatU64Literal(resolved.semanticVersion)},`,
  ];

  if (resolved.hotLayoutVersion !== undefined) {
    lines.push(`  hotLayoutVersion: ${formatU64Literal(resolved.hotLayoutVersion)},`);
  }

  if (resolved.warmCodecVersion !== undefined) {
    lines.push(`  warmCodecVersion: ${formatU64Literal(resolved.warmCodecVersion)},`);
  }

  lines.push("}");
  return lines.join("\n");
}

function formatRuntimeAvailability(resolved: ResolvedProjectionContract): string {
  const lines = ["{"];

  if (resolved.laneManifests?.hot !== undefined) {
    lines.push('  hot: "source-shape-only",');
  }

  if (resolved.laneManifests?.warm !== undefined) {
    lines.push('  warm: "source-shape-only",');
  }

  if (lines.length === 1) {
    lines.push('  lanes: "none",');
  }

  lines.push("}");
  return lines.join("\n");
}

function sortedFieldShapes<T extends Pick<CanonicalField, "dotPath" | "shape">>(
  fields: readonly T[],
): readonly T[] {
  return [...fields].sort((left, right) => compareUtf8(left.dotPath, right.dotPath));
}

function typeScriptTypeForShape(shape: CanonicalFieldShape): string {
  switch (shape.kind) {
    case "FixedScalar":
      return typeScriptTypeForScalar(shape.type);
    case "FixedEnum":
      return shape.variants.map((variant) => JSON.stringify(variant)).join(" | ");
    case "FixedVector":
      return readonlyTupleType(typeScriptTypeForScalar(shape.elementType), shape.length);
    case "FixedStringEncoded":
    case "VariableString":
      return "string";
    case "BoundedArray":
      return `readonly ${arrayElementType(typeScriptTypeForScalar(shape.elementType))}[]`;
    case "BoundedMap":
      return `Readonly<Record<string, ${typeScriptTypeForShape(shape.valueShape)}>>`;
    case "VariableMap":
      return `Readonly<Record<string, ${typeScriptTypeForShape(shape.valueShape)}>>`;
    default:
      return assertNever(shape, "unsupported consumer binding field shape");
  }
}

function typeScriptTypeForScalar(type: ScalarType): string {
  switch (type) {
    case "bool":
      return "boolean";
    case "u64":
    case "i64":
      return "bigint";
    case "u8":
    case "u16":
    case "u32":
    case "i8":
    case "i16":
    case "i32":
    case "f32":
    case "f64":
      return "number";
    default:
      return assertNever(type, "unsupported consumer binding scalar type");
  }
}

function readonlyTupleType(elementType: string, length: number): string {
  if (!Number.isSafeInteger(length) || length < 0) {
    panic(`fixed vector length is out of range for generated consumer binding source: ${length}`);
  }

  return `readonly [${Array.from({ length }, () => elementType).join(", ")}]`;
}

function arrayElementType(elementType: string): string {
  if (elementType.includes(" | ")) {
    return `(${elementType})`;
  }

  return elementType;
}

function formatPropertyKey(key: string): string {
  if (/^[A-Za-z_$][A-Za-z0-9_$]*$/.test(key)) {
    return key;
  }

  return JSON.stringify(key);
}

function formatU64Literal(value: bigint): string {
  if (value < 0n || value > 0xffff_ffff_ffff_ffffn) {
    panic(`u64 identity is out of range for generated consumer binding source: ${value}`);
  }

  return `0x${value.toString(16).padStart(16, "0")}n`;
}

function symbolStemFromContractKey(contractKey: string): string {
  const stem = contractKey
    .split(/[^A-Za-z0-9]+/)
    .filter((segment) => segment.length > 0)
    .map(capitalizeIdentifierSegment)
    .join("");

  if (stem.length > 0 && /^[A-Za-z_$]/.test(stem)) {
    return stem;
  }

  return `Projection${stem}`;
}

function capitalizeIdentifierSegment(segment: string): string {
  const sanitized = segment.replace(/[^A-Za-z0-9_$]/g, "");
  if (sanitized.length === 0) {
    return "";
  }

  return `${sanitized[0]?.toUpperCase()}${sanitized.slice(1)}`;
}

function lowerFirst(value: string): string {
  const first = value[0];
  if (first === undefined) {
    panic("symbolStem must not be empty");
  }

  return `${first.toLowerCase()}${value.slice(1)}`;
}

function assertTypeScriptIdentifier(value: string, optionName: string): void {
  if (/^[A-Za-z_$][A-Za-z0-9_$]*$/.test(value)) {
    return;
  }

  panic(`${optionName} must be a TypeScript identifier`);
}

function assertNever(value: never, message: string): never {
  panic(`${message}: ${JSON.stringify(value)}`);
}
