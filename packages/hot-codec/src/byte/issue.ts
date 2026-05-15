import { createHotByteRejectedError, createHotCodecIssue, type HotCodecIssueCode } from "../error";

export function throwByteIssue(code: HotCodecIssueCode, path: string, message?: string): never {
  throw createHotByteRejectedError([createHotCodecIssue(code, path, message)]);
}
