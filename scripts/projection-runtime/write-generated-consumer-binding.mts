import { mkdir, writeFile } from "node:fs/promises";
import { dirname } from "node:path";

type WriteGeneratedConsumerBindingInput = {
  readonly consumerBindingSource: string;
  readonly outputPath: string;
  readonly generatedFromPath: string;
};

export async function writeGeneratedConsumerBinding({
  consumerBindingSource,
  outputPath,
  generatedFromPath,
}: WriteGeneratedConsumerBindingInput): Promise<void> {
  const content = `// Generated from ${generatedFromPath}. Do not edit by hand.\n${consumerBindingSource}`;

  await mkdir(dirname(outputPath), { recursive: true });
  await writeFile(outputPath, content);
}
