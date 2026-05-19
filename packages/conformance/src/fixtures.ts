import { readdir, readFile } from "node:fs/promises";
import { basename, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { type ConformanceError, createConformanceError } from "./error";

export type ProjectionRuntimeFixtureName = string;
export type ProjectionRuntimeFixtureProfile = "hot-codec" | "warm-payload-codec";

export interface ProjectionRuntimeFixtureRootOptions {
  readonly fixtureRoot?: string | URL;
}

export interface ProjectionRuntimeFixtureArtifacts {
  readonly readme: string;
  readonly fixtureProfile?: unknown;
  readonly authoredContract: unknown;
  readonly canonicalManifest: unknown;
  readonly hotByteFixture?: unknown;
  readonly hotBlockAFixture?: unknown;
  readonly hotBlockBFixture?: unknown;
  readonly hotCompleteFixtureRegion?: unknown;
  readonly hotLayoutManifest?: unknown;
  readonly resolvedContract: unknown;
  readonly rustWarmOutput?: unknown;
  readonly warmPayloadFixture?: unknown;
}

export interface ProjectionRuntimeFixture {
  readonly fixtureName: ProjectionRuntimeFixtureName;
  readonly fixturePath: string;
  readonly fixtureProfile: ProjectionRuntimeFixtureProfile;
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

const fixtureProfileFile = {
  fileName: "fixture-profile.json",
  artifactName: "fixture-profile",
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

const hotBlockAFixtureFile = {
  fileName: "hot-block-a-fixture.json",
  artifactName: "hot-block-a-fixture",
} satisfies RequiredFixtureFile;

const hotBlockBFixtureFile = {
  fileName: "hot-block-b-fixture.json",
  artifactName: "hot-block-b-fixture",
} satisfies RequiredFixtureFile;

const hotCompleteFixtureRegionFile = {
  fileName: "hot-complete-fixture-region.json",
  artifactName: "hot-complete-fixture-region",
} satisfies RequiredFixtureFile;

const resolvedContractFile = {
  fileName: "resolved-contract.json",
  artifactName: "resolved-contract",
} satisfies RequiredFixtureFile;

const warmPayloadFixtureFile = {
  fileName: "warm-payload-fixture.json",
  artifactName: "warm-payload-fixture",
} satisfies RequiredFixtureFile;

const rustWarmOutputFile = {
  fileName: "rust-warm-output.json",
  artifactName: "rust-warm-output",
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
  const fixtureProfileArtifact = await readOptionalJson(
    fixturePath,
    relativeFixturePath,
    fixtureName,
    fixtureProfileFile,
  );
  const fixtureProfile = decodeFixtureProfile(
    fixtureProfileArtifact,
    relativeFixturePath,
    fixtureName,
  );
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
  const resolvedContract = await readRequiredJson(
    fixturePath,
    relativeFixturePath,
    fixtureName,
    resolvedContractFile,
  );

  const profileArtifacts =
    fixtureProfile === "hot-codec"
      ? await readHotFixtureArtifacts(fixturePath, relativeFixturePath, fixtureName)
      : await readWarmPayloadFixtureArtifacts(fixturePath, relativeFixturePath, fixtureName);

  return {
    fixtureName,
    fixturePath: relativeFixturePath,
    fixtureProfile,
    artifacts: {
      readme,
      ...(fixtureProfileArtifact === undefined ? {} : { fixtureProfile: fixtureProfileArtifact }),
      authoredContract,
      canonicalManifest,
      resolvedContract,
      ...profileArtifacts,
    },
  };
}

async function readHotFixtureArtifacts(
  fixturePath: string,
  relativeFixturePath: string,
  fixtureName: ProjectionRuntimeFixtureName,
): Promise<
  Pick<
    ProjectionRuntimeFixtureArtifacts,
    | "hotLayoutManifest"
    | "hotByteFixture"
    | "hotBlockAFixture"
    | "hotBlockBFixture"
    | "hotCompleteFixtureRegion"
  >
> {
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
  const hotBlockAFixture = await readRequiredJson(
    fixturePath,
    relativeFixturePath,
    fixtureName,
    hotBlockAFixtureFile,
  );
  const hotBlockBFixture = await readRequiredJson(
    fixturePath,
    relativeFixturePath,
    fixtureName,
    hotBlockBFixtureFile,
  );
  const hotCompleteFixtureRegion = await readRequiredJson(
    fixturePath,
    relativeFixturePath,
    fixtureName,
    hotCompleteFixtureRegionFile,
  );

  return {
    hotLayoutManifest,
    hotByteFixture,
    hotBlockAFixture,
    hotBlockBFixture,
    hotCompleteFixtureRegion,
  };
}

async function readWarmPayloadFixtureArtifacts(
  fixturePath: string,
  relativeFixturePath: string,
  fixtureName: ProjectionRuntimeFixtureName,
): Promise<Pick<ProjectionRuntimeFixtureArtifacts, "rustWarmOutput" | "warmPayloadFixture">> {
  return {
    warmPayloadFixture: await readRequiredJson(
      fixturePath,
      relativeFixturePath,
      fixtureName,
      warmPayloadFixtureFile,
    ),
    rustWarmOutput: await readRequiredJson(
      fixturePath,
      relativeFixturePath,
      fixtureName,
      rustWarmOutputFile,
    ),
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
    throw createConformanceError("fixtureFileRejected", {
      detail: `invalid projection-runtime fixture name: ${fixtureName}`,
      failureCode: "invalidFixtureName",
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
    throw fileError(
      "missing required fixture file",
      "missingRequiredFixtureFile",
      relativeFixturePath,
      fixtureName,
      file,
      error,
    );
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
    throw fileError(
      "invalid fixture JSON",
      "invalidFixtureJson",
      relativeFixturePath,
      fixtureName,
      file,
      error,
    );
  }
}

async function readOptionalJson(
  fixturePath: string,
  relativeFixturePath: string,
  fixtureName: ProjectionRuntimeFixtureName,
  file: RequiredFixtureFile,
): Promise<unknown | undefined> {
  const path = resolve(fixturePath, file.fileName);
  let source: string;

  try {
    source = await readFile(path, "utf8");
  } catch (error) {
    if (isMissingFileError(error)) {
      return undefined;
    }

    throw fileError(
      "failed to load fixture file",
      "fixtureFileLoadFailed",
      relativeFixturePath,
      fixtureName,
      file,
      error,
    );
  }

  try {
    return JSON.parse(source);
  } catch (error) {
    throw fileError(
      "invalid fixture JSON",
      "invalidFixtureJson",
      relativeFixturePath,
      fixtureName,
      file,
      error,
    );
  }
}

function decodeFixtureProfile(
  value: unknown | undefined,
  relativeFixturePath: string,
  fixtureName: ProjectionRuntimeFixtureName,
): ProjectionRuntimeFixtureProfile {
  if (value === undefined) {
    return "hot-codec";
  }

  if (typeof value === "object" && value !== null && !Array.isArray(value)) {
    const profile = (value as Record<string, unknown>).fixtureProfile;
    if (profile === "hot-codec" || profile === "warm-payload-codec") {
      return profile;
    }
  }

  throw createConformanceError("fixtureShapeRejected", {
    detail: "fixture-profile.json must declare fixtureProfile as hot-codec or warm-payload-codec",
    failureCode: "invalidFixtureProfile",
    fixtureName,
    fixturePath: relativeFixturePath,
    fixtureFile: fixtureProfileFile.fileName,
    relativePath: `${relativeFixturePath}/${fixtureProfileFile.fileName}`,
  });
}

function fileError(
  reason: string,
  failureCode: "fixtureFileLoadFailed" | "invalidFixtureJson" | "missingRequiredFixtureFile",
  relativeFixturePath: string,
  fixtureName: ProjectionRuntimeFixtureName,
  file: RequiredFixtureFile,
  cause: unknown,
): ConformanceError {
  const relativePath = `${relativeFixturePath}/${file.fileName}`;

  return createConformanceError(
    "fixtureFileRejected",
    {
      detail: `${reason}: ${file.artifactName} at ${relativePath}`,
      failureCode,
      fixtureName,
      fixturePath: relativeFixturePath,
      fixtureFile: file.fileName,
      relativePath,
    },
    cause,
  );
}

function isMissingFileError(error: unknown): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    (error as { readonly code?: unknown }).code === "ENOENT"
  );
}

function relativeRepoPath(path: string): string {
  const relativePath = relative(repoRoot, path);
  return relativePath.length === 0 ? "." : relativePath.replaceAll("\\", "/");
}
