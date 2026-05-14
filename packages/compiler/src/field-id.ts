import { createHash } from "node:crypto";

export type FieldIdDeriver = (contractKey: string, dotPath: string) => number;

export function deriveFieldId(contractKey: string, dotPath: string): number {
  const digest = createHash("sha256").update(`${contractKey}:${dotPath}`, "utf8").digest();
  return digest.readUInt32BE(0);
}
