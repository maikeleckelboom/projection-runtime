export function stringLiteral(value: string): string {
  return JSON.stringify(value);
}

export function joinLines(lines: readonly string[]): string {
  return lines.join("\n");
}

export function withFinalNewline(lines: readonly string[]): string {
  return `${joinLines(lines)}\n`;
}

export function joinBlocks(blocks: readonly (readonly string[])[]): readonly string[] {
  const lines: string[] = [];

  for (const [index, block] of blocks.entries()) {
    if (index > 0) {
      lines.push("");
    }
    lines.push(...block);
  }

  return lines;
}

export function assertNever(value: never, message: string): never {
  throw new Error(`${message}: ${JSON.stringify(value)}`);
}
