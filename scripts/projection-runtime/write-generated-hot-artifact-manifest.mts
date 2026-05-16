import { mkdir, writeFile } from "node:fs/promises";
import { dirname, normalize, relative } from "node:path";
import { isSafeFixtureName, isSafeSymbolStem } from "./generated-hot/identifiers.mts";
import { readHotLayoutManifest } from "./generated-hot/layout-manifest.mts";

type GeneratedHotArtifactManifest = {
  readonly artifactManifestVersion: 1;
  readonly fixtureName: string;
  readonly contractKey: string;
  readonly symbolStem: string;
  readonly hotAbiVersion: number;
  readonly hotLayoutVersion: string;
  readonly source: {
    readonly hotLayoutManifest: "../hot-layout-manifest.json";
    readonly hotBlockAFixture: "../hot-block-a-fixture.json";
    readonly hotCompleteFixtureRegion: "../hot-complete-fixture-region.json";
    readonly resolvedContract: "../resolved-contract.json";
  };
  readonly artifacts: {
    readonly reader: "hot-reader.ts";
    readonly rustWriter: "hot_writer.rs";
    readonly writer: "hot-writer.ts";
  };
};

type WriteGeneratedHotArtifactManifestInput = {
  readonly fixtureName: string;
  readonly symbolStem: string;
  readonly manifestPath: string;
  readonly outputPath: string;
  readonly generatedFromPath: string;
};

export async function writeGeneratedHotArtifactManifest({
  fixtureName,
  symbolStem,
  manifestPath,
  outputPath,
  generatedFromPath,
}: WriteGeneratedHotArtifactManifestInput): Promise<void> {
  validateGeneratedHotArtifactManifestInput({
    fixtureName,
    symbolStem,
    manifestPath,
    outputPath,
    generatedFromPath,
  });

  const hotLayoutManifest = await readHotLayoutManifest(manifestPath);

  const manifest: GeneratedHotArtifactManifest = {
    artifactManifestVersion: 1,
    fixtureName,
    contractKey: hotLayoutManifest.contractKey,
    symbolStem,
    hotAbiVersion: hotLayoutManifest.hotAbiVersion,
    hotLayoutVersion: hotLayoutManifest.hotLayoutVersion,
    source: {
      hotLayoutManifest: "../hot-layout-manifest.json",
      hotBlockAFixture: "../hot-block-a-fixture.json",
      hotCompleteFixtureRegion: "../hot-complete-fixture-region.json",
      resolvedContract: "../resolved-contract.json",
    },
    artifacts: {
      reader: "hot-reader.ts",
      rustWriter: "hot_writer.rs",
      writer: "hot-writer.ts",
    },
  };

  await mkdir(dirname(outputPath), { recursive: true });
  await writeFile(outputPath, `${JSON.stringify(manifest, null, 2)}\n`);
}

function validateGeneratedHotArtifactManifestInput({
  fixtureName,
  symbolStem,
  manifestPath,
  outputPath,
  generatedFromPath,
}: WriteGeneratedHotArtifactManifestInput): void {
  if (!isSafeFixtureName(fixtureName)) {
    throw new Error(`${fixtureName} is not a safe generated hot artifact fixture name`);
  }

  if (!isSafeSymbolStem(symbolStem)) {
    throw new Error(`${fixtureName} symbolStem is not a safe generated TS symbol stem`);
  }

  if (generatedFromPath.includes("\n") || generatedFromPath.includes("\r")) {
    throw new Error(`${fixtureName} generatedFromPath must fit on one generated comment line`);
  }

  const relativeOutputPath = normalize(relative(dirname(manifestPath), outputPath)).replaceAll(
    "\\",
    "/",
  );

  if (relativeOutputPath !== "generated/artifacts.json") {
    throw new Error(`${fixtureName} artifact manifest output must be generated/artifacts.json`);
  }
}
