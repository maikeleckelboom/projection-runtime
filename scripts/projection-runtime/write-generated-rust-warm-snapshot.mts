import { mkdir, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import { toConstantStem, toPascalCase } from "./generated-hot/identifiers.mts";
import { joinBlocks, withFinalNewline } from "./generated-hot/source.mts";

type WriteGeneratedRustWarmSnapshotInput = {
  readonly fixtureName: string;
  readonly symbolStem: string;
  readonly resolved: unknown;
  readonly outputPath: string;
  readonly generatedFromPath: string;
};

type WarmField = {
  readonly dotPath: string;
  readonly fieldId: number;
  readonly shape: Record<string, unknown>;
};

type NormalizedWarmContract = {
  readonly contractKey: string;
  readonly semanticVersionHex: string;
  readonly warmCodecVersionHex: string;
  readonly fields: readonly WarmField[];
};

export async function writeGeneratedRustWarmSnapshot(
  input: WriteGeneratedRustWarmSnapshotInput,
): Promise<void> {
  const source = renderGeneratedRustWarmSnapshotSource(input);
  await mkdir(dirname(input.outputPath), { recursive: true });
  await writeFile(input.outputPath, source);
}

export function renderGeneratedRustWarmSnapshotSource(
  input: Omit<WriteGeneratedRustWarmSnapshotInput, "outputPath">,
): string {
  requireFixtureName(input.fixtureName);
  requireSymbolStem(input.symbolStem);
  const contract = normalizeWarmContract(input.resolved);
  const snapshotTypeName = `${input.symbolStem}WarmSnapshot`;
  const fieldIdentityTypeName = `${input.symbolStem}WarmFieldIdentity`;
  const fieldIdentitiesName = `${toConstantStem(input.symbolStem)}_WARM_FIELDS`;
  const generatedHeader = `// Generated from ${input.generatedFromPath}. Do not edit by hand.`;
  const enums = contract.fields
    .filter((field) => field.shape.kind === "FixedEnum")
    .map((field) => renderEnum(input.symbolStem, field));

  return withFinalNewline(
    joinBlocks([
      [generatedHeader],
      [
        `pub const CONTRACT_KEY: &str = ${rustStringLiteral(contract.contractKey)};`,
        `pub const SEMANTIC_VERSION_HEX: &str = ${rustStringLiteral(contract.semanticVersionHex)};`,
        `pub const WARM_CODEC_VERSION_HEX: &str = ${rustStringLiteral(contract.warmCodecVersionHex)};`,
      ],
      [
        "#[derive(Clone, Copy, Debug, Eq, PartialEq)]",
        `pub struct ${fieldIdentityTypeName} {`,
        "    pub dot_path: &'static str,",
        "    pub field_id: u32,",
        "}",
      ],
      [
        `pub const ${fieldIdentitiesName}: [${fieldIdentityTypeName}; ${contract.fields.length}] = [`,
        ...contract.fields.flatMap((field) => [
          `    ${fieldIdentityTypeName} {`,
          `        dot_path: ${rustStringLiteral(field.dotPath)},`,
          `        field_id: ${field.fieldId},`,
          "    },",
        ]),
        "];",
      ],
      ...enums,
      [
        "#[derive(Debug, serde::Serialize)]",
        `pub struct ${snapshotTypeName}<'a> {`,
        ...contract.fields.flatMap((field) => renderSnapshotField(input.symbolStem, field)),
        "}",
      ],
      ...contract.fields
        .filter((field) => field.shape.kind === "BoundedArray")
        .map((field) => [
          `pub const ${toConstantStem(field.dotPath)}_MAX_LENGTH: usize = ${requirePositiveInteger(
            field.shape.maxLength,
            `${field.dotPath}.shape.maxLength`,
          )};`,
        ]),
    ]),
  );
}

function normalizeWarmContract(value: unknown): NormalizedWarmContract {
  const resolved = requireRecord(value, "resolved contract");
  const manifest = requireRecord(resolved.manifest, "resolved contract manifest");
  const laneManifests = requireRecord(resolved.laneManifests, "resolved laneManifests");
  const warm = requireRecord(laneManifests.warm, "resolved warm manifest");
  const contractKey = requireString(manifest.key, "manifest.key");
  const warmContractKey = requireString(warm.contractKey, "laneManifests.warm.contractKey");

  if (warm.codec !== "framed-snapshot") {
    throw new Error("laneManifests.warm.codec must be framed-snapshot");
  }
  if (warmContractKey !== contractKey) {
    throw new Error("warm contract key must match manifest.key");
  }

  const semanticVersionHex = requireHexU64(resolved.semanticVersion, "semanticVersion");
  const warmCodecVersionHex = requireHexU64(resolved.warmCodecVersion, "warmCodecVersion");
  if (requireHexU64(warm.semanticVersion, "warm.semanticVersion") !== semanticVersionHex) {
    throw new Error("warm semanticVersion must match resolved semanticVersion");
  }
  if (requireHexU64(warm.warmCodecVersion, "warm.warmCodecVersion") !== warmCodecVersionHex) {
    throw new Error("warm warmCodecVersion must match resolved warmCodecVersion");
  }

  if (!Array.isArray(warm.fields) || warm.fields.length === 0) {
    throw new Error("laneManifests.warm.fields must be non-empty");
  }
  const fields = warm.fields.map((field, index): WarmField => {
    const record = requireRecord(field, `warm.fields[${index}]`);
    const dotPath = requireString(record.dotPath, `warm.fields[${index}].dotPath`);
    requireRustFieldName(dotPath);
    return {
      dotPath,
      fieldId: requireU32(record.fieldId, `warm.fields[${index}].fieldId`),
      shape: requireRecord(record.shape, `warm.fields[${index}].shape`),
    };
  });

  const dotPaths = new Set<string>();
  const fieldIds = new Set<number>();
  for (const field of fields) {
    if (dotPaths.has(field.dotPath)) throw new Error(`duplicate warm dotPath ${field.dotPath}`);
    if (fieldIds.has(field.fieldId)) throw new Error(`duplicate warm fieldId ${field.fieldId}`);
    dotPaths.add(field.dotPath);
    fieldIds.add(field.fieldId);
    validateShape(field);
  }

  return { contractKey, semanticVersionHex, warmCodecVersionHex, fields };
}

function renderSnapshotField(symbolStem: string, field: WarmField): readonly string[] {
  return [
    `    #[serde(rename = ${rustStringLiteral(field.dotPath)})]`,
    `    pub ${toRustSnakeIdentifier(field.dotPath)}: ${rustFieldType(symbolStem, field)},`,
  ];
}

function rustFieldType(symbolStem: string, field: WarmField): string {
  switch (field.shape.kind) {
    case "FixedScalar":
      return rustScalarType(requireString(field.shape.type, `${field.dotPath}.shape.type`), true);
    case "FixedEnum":
      return `${symbolStem}${toPascalCase(field.dotPath)}`;
    case "BoundedArray":
      return `&'a [${rustScalarType(
        requireString(field.shape.elementType, `${field.dotPath}.shape.elementType`),
        false,
      )}]`;
    default:
      throw new Error(`unsupported generated Rust warm shape ${String(field.shape.kind)}`);
  }
}

function renderEnum(symbolStem: string, field: WarmField): readonly string[] {
  const variants = requireStringArray(field.shape.variants, `${field.dotPath}.shape.variants`);
  const typeName = `${symbolStem}${toPascalCase(field.dotPath)}`;
  return [
    "#[derive(Clone, Copy, Debug, Eq, PartialEq, serde::Serialize)]",
    `pub enum ${typeName} {`,
    ...variants.flatMap((variant) => [
      `    #[serde(rename = ${rustStringLiteral(variant)})]`,
      `    ${toRustPascalIdentifier(variant)},`,
    ]),
    "}",
  ];
}

function validateShape(field: WarmField): void {
  switch (field.shape.kind) {
    case "FixedScalar":
      rustScalarType(requireString(field.shape.type, `${field.dotPath}.shape.type`), true);
      return;
    case "FixedEnum": {
      if (field.shape.storage !== "u8") {
        throw new Error(`${field.dotPath}.shape.storage must be u8`);
      }
      const variants = requireStringArray(field.shape.variants, `${field.dotPath}.shape.variants`);
      if (variants.length === 0 || new Set(variants).size !== variants.length) {
        throw new Error(`${field.dotPath}.shape.variants must be non-empty and unique`);
      }
      for (const variant of variants) toRustPascalIdentifier(variant);
      return;
    }
    case "BoundedArray":
      rustScalarType(
        requireString(field.shape.elementType, `${field.dotPath}.shape.elementType`),
        false,
      );
      requirePositiveInteger(field.shape.maxLength, `${field.dotPath}.shape.maxLength`);
      return;
    default:
      throw new Error(`unsupported generated Rust warm shape ${String(field.shape.kind)}`);
  }
}

function rustScalarType(value: string, allowWireU64: boolean): string {
  switch (value) {
    case "bool":
    case "f32":
    case "f64":
    case "u8":
    case "u16":
    case "u32":
    case "i8":
    case "i16":
    case "i32":
      return value;
    case "u64":
      if (allowWireU64) return "&'a str";
      break;
  }
  throw new Error(`unsupported generated Rust warm scalar ${value}`);
}

function requireRecord(value: unknown, label: string): Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new TypeError(`${label} must be an object`);
  }
  return value as Record<string, unknown>;
}

function requireString(value: unknown, label: string): string {
  if (typeof value !== "string" || value.length === 0) {
    throw new TypeError(`${label} must be non-empty text`);
  }
  return value;
}

function requireStringArray(value: unknown, label: string): readonly string[] {
  if (!Array.isArray(value) || !value.every((entry) => typeof entry === "string")) {
    throw new TypeError(`${label} must be an array of strings`);
  }
  return value;
}

function requireHexU64(value: unknown, label: string): string {
  if (typeof value === "bigint") {
    if (value < 0n || value > 0xffff_ffff_ffff_ffffn) {
      throw new RangeError(`${label} is outside u64`);
    }
    return value.toString(16).padStart(16, "0");
  }
  if (typeof value !== "string") throw new TypeError(`${label} must be a hex u64`);
  const normalized = value.startsWith("0x") ? value.slice(2) : value;
  if (!/^[0-9a-fA-F]{1,16}$/u.test(normalized)) {
    throw new TypeError(`${label} must be a hex u64`);
  }
  return normalized.toLowerCase().padStart(16, "0");
}

function requireU32(value: unknown, label: string): number {
  if (
    typeof value !== "number" ||
    !Number.isSafeInteger(value) ||
    value < 0 ||
    value > 0xffff_ffff
  ) {
    throw new TypeError(`${label} must be a u32`);
  }
  return value;
}

function requirePositiveInteger(value: unknown, label: string): number {
  if (typeof value !== "number" || !Number.isSafeInteger(value) || value < 1) {
    throw new TypeError(`${label} must be a positive safe integer`);
  }
  return value;
}

function requireFixtureName(value: string): void {
  if (!/^[a-z][a-z0-9]*(?:-[a-z0-9]+)*$/u.test(value)) {
    throw new Error(`fixtureName ${value} is not safe`);
  }
}

function requireSymbolStem(value: string): void {
  if (!/^[A-Z][a-zA-Z0-9]*$/u.test(value)) {
    throw new Error(`symbolStem ${value} is not safe`);
  }
}

function requireRustFieldName(value: string): void {
  if (!/^[a-z][a-zA-Z0-9]*$/u.test(value)) {
    throw new Error(`warm field ${value} is not a supported flat Rust field`);
  }
  toRustSnakeIdentifier(value);
}

function toRustSnakeIdentifier(value: string): string {
  const identifier = value.replace(/([a-z0-9])([A-Z])/gu, "$1_$2").toLowerCase();
  if (!/^[a-z][a-z0-9_]*$/u.test(identifier) || rustKeywords.has(identifier)) {
    throw new Error(`warm field ${value} is not a safe Rust identifier`);
  }
  return identifier;
}

function toRustPascalIdentifier(value: string): string {
  if (!/^[a-z][a-zA-Z0-9]*$/u.test(value)) {
    throw new Error(`warm enum variant ${value} is not supported`);
  }
  const identifier = toPascalCase(value);
  if (!/^[A-Z][a-zA-Z0-9]*$/u.test(identifier) || rustKeywords.has(identifier.toLowerCase())) {
    throw new Error(`warm enum variant ${value} is not a safe Rust identifier`);
  }
  return identifier;
}

function rustStringLiteral(value: string): string {
  return JSON.stringify(value);
}

const rustKeywords = new Set([
  "as",
  "async",
  "await",
  "break",
  "const",
  "continue",
  "crate",
  "dyn",
  "else",
  "enum",
  "extern",
  "false",
  "fn",
  "for",
  "if",
  "impl",
  "in",
  "let",
  "loop",
  "match",
  "mod",
  "move",
  "mut",
  "pub",
  "ref",
  "return",
  "self",
  "static",
  "struct",
  "super",
  "trait",
  "true",
  "type",
  "unsafe",
  "use",
  "where",
  "while",
]);
