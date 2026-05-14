import { readdir, readFile } from "node:fs/promises";
import { basename, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { ConformanceError } from "./error";

export type ProjectionRuntimeFixtureName = string;

export interface ProjectionRuntimeFixtureRootOptions {
  readonly fixtureRoot?: string | URL;
}

export interface ProjectionRuntimeFixtureArtifacts {
  readonly readme: string;
  readonly authoredContract: unknown;
  readonly canonicalManifest: unknown;
  readonly hotByteFixture: unknown;
  readonly hotLayoutManifest: unknown;
  readonly resolvedContract: unknown;
}

export interface ProjectionRuntimeFixture {
  readonly fixtureName: ProjectionRuntimeFixtureName;
  readonly fixturePath: string;
  readonly artifacts: ProjectionRuntimeFixtureArtifacts;
}

type RequiredFixtureFile = {
  readonly fileName: string;
  readonly artifactName: string;
};

const repoRoot = resolve(fileURLToPath(new URL("../../..", import.meta.url)));
const defaultProjectionRuntimeFixtureRoot = resolve(repoRoot, "fixtures/projection-runtime");

const readmeFile = {
  fileName: "README.md",
  artifactName: "readme",
} satisfies RequiredFixtureFile;

const authoredContractFile = {
  fileName: "authored-contract.json",
  artifactName: "authored-contract",
} satisfies RequiredFixtureFile;

const canonicalManifestFile = {
  fileName: "canonical-manifest.json",
  artifactName: "canonical-manifest",
} satisfies RequiredFixtureFile;

const hotLayoutManifestFile = {
  fileName: "hot-layout-manifest.json",
  artifactName: "hot-layout-manifest",
} satisfies RequiredFixtureFile;

const hotByteFixtureFile = {
  fileName: "hot-byte-fixture.json",
  artifactName: "hot-byte-fixture",
} satisfies RequiredFixtureFile;

const resolvedContractFile = {
  fileName: "resolved-contract.json",
  artifactName: "resolved-contract",
} satisfies RequiredFixtureFile;

export async function listProjectionRuntimeFixtures(
  options: ProjectionRuntimeFixtureRootOptions = {},
): Promise<readonly ProjectionRuntimeFixtureName[]> {
  const fixtureRoot = resolveFixtureRoot(options.fixtureRoot);
  const entries = await readdir(fixtureRoot, { withFileTypes: true });

  return entries
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name)
    .sort(compareFixtureNames);
}

export async function loadProjectionRuntimeFixture(
  fixtureName: ProjectionRuntimeFixtureName,
  options: ProjectionRuntimeFixtureRootOptions = {},
): Promise<ProjectionRuntimeFixture> {
  assertDirectFixtureName(fixtureName);

  const fixtureRoot = resolveFixtureRoot(options.fixtureRoot);
  const fixturePath = resolve(fixtureRoot, fixtureName);
  const relativeFixturePath = relativeRepoPath(fixturePath);

  const readme = await readRequiredText(fixturePath, relativeFixturePath, fixtureName, readmeFile);
  const authoredContract = await readRequiredJson(
    fixturePath,
    relativeFixturePath,
    fixtureName,
    authoredContractFile,
  );
  const canonicalManifest = await readRequiredJson(
    fixturePath,
    relativeFixturePath,
    fixtureName,
    canonicalManifestFile,
  );
  const hotLayoutManifest = await readRequiredJson(
    fixturePath,
    relativeFixturePath,
    fixtureName,
    hotLayoutManifestFile,
  );
  const hotByteFixture = await readRequiredJson(
    fixturePath,
    relativeFixturePath,
    fixtureName,
    hotByteFixtureFile,
  );
  const resolvedContract = await readRequiredJson(
    fixturePath,
    relativeFixturePath,
    fixtureName,
    resolvedContractFile,
  );

  return {
    fixtureName,
    fixturePath: relativeFixturePath,
    artifacts: {
      readme,
      authoredContract,
      canonicalManifest,
      hotByteFixture,
      hotLayoutManifest,
      resolvedContract,
    },
  };
}

function resolveFixtureRoot(fixtureRoot: string | URL | undefined): string {
  if (fixtureRoot instanceof URL) {
    return resolve(fileURLToPath(fixtureRoot));
  }

  if (fixtureRoot !== undefined) {
    return resolve(fixtureRoot);
  }

  return defaultProjectionRuntimeFixtureRoot;
}

function compareFixtureNames(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}

function assertDirectFixtureName(fixtureName: ProjectionRuntimeFixtureName): void {
  if (
    fixtureName.length === 0 ||
    fixtureName !== basename(fixtureName) ||
    fixtureName.includes("/") ||
    fixtureName.includes("\\")
  ) {
    throw new ConformanceError(`invalid projection-runtime fixture name: ${fixtureName}`, {
      fixtureName,
    });
  }
}

async function readRequiredText(
  fixturePath: string,
  relativeFixturePath: string,
  fixtureName: ProjectionRuntimeFixtureName,
  file: RequiredFixtureFile,
): Promise<string> {
  const path = resolve(fixturePath, file.fileName);

  try {
    return await readFile(path, "utf8");
  } catch (error) {
    throw fileError("missing required fixture file", relativeFixturePath, fixtureName, file, error);
  }
}

async function readRequiredJson(
  fixturePath: string,
  relativeFixturePath: string,
  fixtureName: ProjectionRuntimeFixtureName,
  file: RequiredFixtureFile,
): Promise<unknown> {
  const source = await readRequiredText(fixturePath, relativeFixturePath, fixtureName, file);

  try {
    return JSON.parse(source);
  } catch (error) {
    throw fileError("invalid fixture JSON", relativeFixturePath, fixtureName, file, error);
  }
}

function fileError(
  reason: string,
  relativeFixturePath: string,
  fixtureName: ProjectionRuntimeFixtureName,
  file: RequiredFixtureFile,
  cause: unknown,
): ConformanceError {
  const relativePath = `${relativeFixturePath}/${file.fileName}`;

  return new ConformanceError(
    `${reason}: ${file.artifactName} at ${relativePath}`,
    {
      fixtureName,
      fixturePath: relativeFixturePath,
      fixtureFile: file.fileName,
      relativePath,
    },
    { cause },
  );
}

function relativeRepoPath(path: string): string {
  const relativePath = relative(repoRoot, path);
  return relativePath.length === 0 ? "." : relativePath.replaceAll("\\", "/");
}
