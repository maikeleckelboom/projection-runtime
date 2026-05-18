import { describe, expect, it } from "vitest";

import {
  type AbiByteWriter,
  type AbiShape,
  readU64PrefixBigEndian,
  writeAbiShapeBytes,
} from "../src/index";

class TestByteWriter implements AbiByteWriter {
  private readonly chunks: number[] = [];

  writeU8(value: number): void {
    this.chunks.push(value & 0xff);
  }

  writeU16Le(value: number): void {
    this.writeU8(value);
    this.writeU8(value >> 8);
  }

  writeU32Le(value: number): void {
    this.writeU8(value);
    this.writeU8(value >> 8);
    this.writeU8(value >> 16);
    this.writeU8(value >> 24);
  }

  writeUtf8(value: string): void {
    this.chunks.push(...Buffer.from(value, "utf8"));
  }

  toUint8Array(): Uint8Array {
    return Uint8Array.from(this.chunks);
  }
}

function encodeShape(shape: AbiShape): string {
  const writer = new TestByteWriter();
  writeAbiShapeBytes(shape, writer);
  return Buffer.from(writer.toUint8Array()).toString("hex");
}

describe("ABI version shape serialization", () => {
  it("serializes FixedScalar shapes", () => {
    expect(encodeShape({ kind: "FixedScalar", type: "f64", nanSentinel: true })).toBe("010b01");
  });

  it("serializes FixedEnum shapes", () => {
    expect(encodeShape({ kind: "FixedEnum", storage: "u16", variants: ["ok", "warn"] })).toBe(
      "020302006f6b007761726e00",
    );
  });

  it("serializes FixedVector shapes", () => {
    expect(encodeShape({ kind: "FixedVector", elementType: "u32", length: 513 })).toBe(
      "030401020000",
    );
  });

  it("serializes BoundedArray shapes", () => {
    expect(encodeShape({ kind: "BoundedArray", elementType: "i16", maxLength: 4 })).toBe(
      "040704000000",
    );
  });

  it("serializes BoundedMap shapes with nested valueShape", () => {
    expect(
      encodeShape({
        kind: "BoundedMap",
        keyByteLength: 7,
        maxEntries: 2,
        valueShape: { kind: "FixedScalar", type: "bool" },
      }),
    ).toBe("05070002000000010100");
  });

  it("serializes VariableMap shapes", () => {
    expect(
      encodeShape({
        kind: "VariableMap",
        valueShape: { kind: "FixedStringEncoded", byteLength: 5, encoding: "ascii" },
      }),
    ).toBe("0607050002");
  });

  it("serializes FixedStringEncoded shapes", () => {
    expect(encodeShape({ kind: "FixedStringEncoded", byteLength: 9, encoding: "utf8" })).toBe(
      "07090001",
    );
  });

  it("serializes VariableString shapes", () => {
    expect(encodeShape({ kind: "VariableString" })).toBe("08");
  });

  it("reads u64 prefixes in big-endian order", () => {
    expect(
      readU64PrefixBigEndian(Uint8Array.from([0x12, 0x34, 0x56, 0x78, 0x9a, 0xbc, 0xde, 0xf0])),
    ).toBe(0x1234_5678_9abc_def0n);
  });
});
