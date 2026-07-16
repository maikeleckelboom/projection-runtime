import { describe, expect, it } from "vitest";
import {
  decodeAuthorityEpoch,
  decodeU64Hex,
  encodeAuthorityEpoch,
  encodeU64Hex,
} from "../src/wireValues.js";

describe("canonical private wire values", () => {
  it("round trips canonical authority epochs and u64 identities", () => {
    expect(decodeAuthorityEpoch(encodeAuthorityEpoch(42n))).toBe(42n);
    expect(decodeU64Hex(encodeU64Hex(42n), "value")).toBe(42n);
  });

  it.each([
    "",
    "00",
    "01",
    "+1",
    "-1",
    " 1",
    "1 ",
    "1.0",
  ])("rejects non-canonical authority epoch %j", (value) => {
    expect(() => decodeAuthorityEpoch(value)).toThrow();
  });

  it.each([
    "0",
    "000000000000000A",
    "00000000000000000",
    "gggggggggggggggg",
  ])("rejects non-canonical u64 hex %j", (value) => {
    expect(() => decodeU64Hex(value, "value")).toThrow();
  });
});
