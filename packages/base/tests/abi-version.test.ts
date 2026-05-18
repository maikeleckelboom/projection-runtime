import { describe, expect, it } from "vitest";

import {
  type AbiByteWriter,
  AbiCanonicalByteWriter,
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

function encodeShapeCanonical(shape: AbiShape): string {
  const writer = new AbiCanonicalByteWriter();
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

describe("AbiCanonicalByteWriter checked numeric writes", () => {
  it("writes valid u8 values", () => {
    const writer = new AbiCanonicalByteWriter();
    writer.writeU8(0);
    writer.writeU8(127);
    writer.writeU8(255);
    expect(writer.toUint8Array()).toEqual(Uint8Array.from([0, 127, 255]));
  });

  it("writes valid u16LE values", () => {
    const writer = new AbiCanonicalByteWriter();
    writer.writeU16Le(0);
    writer.writeU16Le(1);
    writer.writeU16Le(0x0100);
    writer.writeU16Le(0xffff);
    expect(writer.toUint8Array()).toEqual(Uint8Array.from([0, 0, 1, 0, 0, 1, 0xff, 0xff]));
  });

  it("writes valid u32LE values", () => {
    const writer = new AbiCanonicalByteWriter();
    writer.writeU32Le(0);
    writer.writeU32Le(1);
    writer.writeU32Le(0x01020304);
    writer.writeU32Le(0xffffffff);
    expect(writer.toUint8Array()).toEqual(
      Uint8Array.from([0, 0, 0, 0, 1, 0, 0, 0, 4, 3, 2, 1, 0xff, 0xff, 0xff, 0xff]),
    );
  });

  it("writes UTF-8 strings", () => {
    const writer = new AbiCanonicalByteWriter();
    writer.writeUtf8("ok");
    expect(writer.toUint8Array()).toEqual(Uint8Array.from([0x6f, 0x6b]));
  });

  it("rejects writeU8 with -1", () => {
    const writer = new AbiCanonicalByteWriter();
    expect(() => writer.writeU8(-1)).toThrow(/canonical byte writer.*u8/);
  });

  it("rejects writeU8 with 256", () => {
    const writer = new AbiCanonicalByteWriter();
    expect(() => writer.writeU8(256)).toThrow(/canonical byte writer.*u8/);
  });

  it("rejects writeU8 with 1.5", () => {
    const writer = new AbiCanonicalByteWriter();
    expect(() => writer.writeU8(1.5)).toThrow(/canonical byte writer.*u8/);
  });

  it("rejects writeU8 with NaN", () => {
    const writer = new AbiCanonicalByteWriter();
    expect(() => writer.writeU8(NaN)).toThrow(/canonical byte writer.*u8/);
  });

  it("rejects writeU8 with Infinity", () => {
    const writer = new AbiCanonicalByteWriter();
    expect(() => writer.writeU8(Infinity)).toThrow(/canonical byte writer.*u8/);
  });

  it("rejects writeU16Le with 65536", () => {
    const writer = new AbiCanonicalByteWriter();
    expect(() => writer.writeU16Le(65536)).toThrow(/canonical byte writer.*u16/);
  });

  it("rejects writeU16Le with -1", () => {
    const writer = new AbiCanonicalByteWriter();
    expect(() => writer.writeU16Le(-1)).toThrow(/canonical byte writer.*u16/);
  });

  it("rejects writeU32Le with 4294967296", () => {
    const writer = new AbiCanonicalByteWriter();
    expect(() => writer.writeU32Le(4294967296)).toThrow(/canonical byte writer.*u32/);
  });

  it("rejects writeU32Le with -1", () => {
    const writer = new AbiCanonicalByteWriter();
    expect(() => writer.writeU32Le(-1)).toThrow(/canonical byte writer.*u32/);
  });

  it("produces the same shape bytes as TestByteWriter for valid inputs", () => {
    const shapes: AbiShape[] = [
      { kind: "FixedScalar", type: "f64", nanSentinel: true },
      { kind: "FixedEnum", storage: "u16", variants: ["ok", "warn"] },
      { kind: "FixedVector", elementType: "u32", length: 513 },
      { kind: "BoundedArray", elementType: "i16", maxLength: 4 },
      { kind: "VariableString" },
      { kind: "FixedStringEncoded", byteLength: 9, encoding: "utf8" },
    ];

    for (const shape of shapes) {
      expect(encodeShapeCanonical(shape)).toBe(encodeShape(shape));
    }
  });
});
