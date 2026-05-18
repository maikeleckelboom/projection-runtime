import { panic } from "@exclave/base";

import { compareUtf8 } from "./fields";
import type {
  CanonicalProjectionManifest,
  ResolvedProjectionContract,
  SemanticVersion,
} from "./manifest";
import { deriveSemanticVersion } from "./version";

export interface ProjectionFieldIdentityArtifact {
  readonly contractKey: string;
  readonly semanticVersion: SemanticVersion;
  readonly fields: readonly ProjectionFieldIdentityEntry[];
}

export interface ProjectionFieldIdentityEntry {
  readonly dotPath: string;
  readonly fieldId: number;
}

export interface ProjectionFieldIdentityMirror {
  readonly [segment: string]: string | ProjectionFieldIdentityMirror;
}

export interface EmitTypeScriptFieldIdentityModuleOptions {
  readonly resolved: ResolvedProjectionContract;
  readonly fieldsConstName: string;
  readonly fieldPathTypeName: string;
  readonly fieldIdConstName: string;
  readonly metadataConstName?: string;
}

type MutableProjectionFieldIdentityMirror = {
  [segment: string]: string | MutableProjectionFieldIdentityMirror;
};

export function deriveProjectionFieldIdentityArtifact(
  resolved: ResolvedProjectionContract,
): ProjectionFieldIdentityArtifact {
  return {
    contractKey: resolved.manifest.key,
    semanticVersion: resolved.semanticVersion,
    fields: fieldIdentityEntries(resolved.manifest),
  };
}

export function deriveProjectionFieldIdentityArtifactFromManifest(
  manifest: CanonicalProjectionManifest,
): ProjectionFieldIdentityArtifact {
  return {
    contractKey: manifest.key,
    semanticVersion: deriveSemanticVersion(manifest),
    fields: fieldIdentityEntries(manifest),
  };
}

export function buildProjectionFieldIdentityMirror(
  fields: readonly ProjectionFieldIdentityEntry[],
): ProjectionFieldIdentityMirror {
  const root: MutableProjectionFieldIdentityMirror = {};

  for (const field of sortedFieldIdentityEntries(fields)) {
    insertMirrorLeaf(root, field.dotPath);
  }

  return root;
}

export function emitTypeScriptFieldIdentityModule(
  options: EmitTypeScriptFieldIdentityModuleOptions,
): string {
  assertTypeScriptIdentifier(options.fieldsConstName, "fieldsConstName");
  assertTypeScriptIdentifier(options.fieldPathTypeName, "fieldPathTypeName");
  assertTypeScriptIdentifier(options.fieldIdConstName, "fieldIdConstName");
  if (options.metadataConstName !== undefined) {
    assertTypeScriptIdentifier(options.metadataConstName, "metadataConstName");
  }

  const artifact = deriveProjectionFieldIdentityArtifact(options.resolved);
  const mirror = buildProjectionFieldIdentityMirror(artifact.fields);
  const parts = [
    emitConstObject(options.fieldsConstName, formatMirrorObject(mirror, 0)),
    emitFieldPathUnion(options.fieldPathTypeName, artifact.fields),
    emitConstObject(options.fieldIdConstName, formatFieldIdMap(artifact.fields)),
  ];

  if (options.metadataConstName !== undefined) {
    parts.push(emitConstObject(options.metadataConstName, formatMetadataObject(artifact)));
  }

  return `${parts.join("\n\n")}\n`;
}

function fieldIdentityEntries(
  manifest: CanonicalProjectionManifest,
): readonly ProjectionFieldIdentityEntry[] {
  return manifest.fields
    .map((field) => ({
      dotPath: field.dotPath,
      fieldId: field.fieldId,
    }))
    .sort((left, right) => compareUtf8(left.dotPath, right.dotPath));
}

function sortedFieldIdentityEntries(
  fields: readonly ProjectionFieldIdentityEntry[],
): readonly ProjectionFieldIdentityEntry[] {
  return [...fields].sort((left, right) => compareUtf8(left.dotPath, right.dotPath));
}

function insertMirrorLeaf(root: MutableProjectionFieldIdentityMirror, dotPath: string): void {
  const segments = dotPath.split(".");
  if (segments.length === 0 || segments.some((segment) => segment.length === 0)) {
    panic(`invalid canonical field dotPath: ${dotPath}`);
  }

  let node = root;
  for (let index = 0; index < segments.length; index += 1) {
    const segment = segments[index];
    if (segment === undefined) {
      panic(`invalid canonical field dotPath: ${dotPath}`);
    }

    const isLeaf = index === segments.length - 1;
    const existing = node[segment];

    if (isLeaf) {
      if (existing !== undefined) {
        panic(`duplicate or prefix-conflicting canonical field dotPath: ${dotPath}`);
      }

      node[segment] = dotPath;
      return;
    }

    if (typeof existing === "string") {
      panic(`prefix-conflicting canonical field dotPath: ${dotPath}`);
    }

    if (existing === undefined) {
      const child: MutableProjectionFieldIdentityMirror = {};
      node[segment] = child;
      node = child;
      continue;
    }

    node = existing;
  }
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

function formatMirrorObject(node: ProjectionFieldIdentityMirror, depth: number): string {
  const indent = "  ".repeat(depth);
  const childIndent = "  ".repeat(depth + 1);
  const lines = ["{"];

  for (const key of Object.keys(node).sort(compareUtf8)) {
    const value = node[key];
    if (value === undefined) {
      panic(`missing generated mirror value for segment: ${key}`);
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

function formatMetadataObject(artifact: ProjectionFieldIdentityArtifact): string {
  return [
    "{",
    `  contractKey: ${JSON.stringify(artifact.contractKey)},`,
    `  semanticVersion: ${artifact.semanticVersion}n,`,
    "}",
  ].join("\n");
}

function formatPropertyKey(key: string): string {
  if (/^[A-Za-z_$][A-Za-z0-9_$]*$/.test(key)) {
    return key;
  }

  return JSON.stringify(key);
}

function assertTypeScriptIdentifier(value: string, optionName: string): void {
  if (/^[A-Za-z_$][A-Za-z0-9_$]*$/.test(value)) {
    return;
  }

  panic(`${optionName} must be a TypeScript identifier`);
}
