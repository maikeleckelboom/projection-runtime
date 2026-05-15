import { createHotByteRejectedError, createHotCodecIssue } from "../error";
import type { HotLayoutPlanningFixedStringEncodedShape } from "../shape";
import type { HotFieldValue } from "./types";
import { throwByteIssue } from "./types";

export function writeFixedString(
  view: DataView,
  offset: number,
  shape: HotLayoutPlanningFixedStringEncodedShape,
  value: HotFieldValue,
  path: string,
): void {
  if (typeof value !== "string") {
    throwByteIssue("byte.valueInvalid", path, "FixedStringEncoded value must be a string");
  }

  const bytes = encodeFixedStringValue(value, shape.encoding, path);
  if (bytes.byteLength > shape.byteLength) {
    throwByteIssue(
      "byte.valueTooLong",
      path,
      `encoded string length must be <= ${shape.byteLength} bytes`,
    );
  }

  for (let index = 0; index < bytes.byteLength; index += 1) {
    const byte = bytes[index];
    if (byte === undefined) {
      throwByteIssue("byte.valueMissing", `${path}.${index}`, "missing encoded string byte");
    }
    view.setUint8(offset + index, byte);
  }
}

export function readFixedString(
  view: DataView,
  offset: number,
  shape: HotLayoutPlanningFixedStringEncodedShape,
  path: string,
): string {
  const bytes = new Uint8Array(view.buffer, view.byteOffset + offset, shape.byteLength);
  let length = bytes.byteLength;
  while (length > 0 && bytes[length - 1] === 0) {
    length -= 1;
  }

  const liveBytes = bytes.subarray(0, length);
  if (shape.encoding === "ascii") {
    return decodeAscii(liveBytes, path);
  }

  try {
    return new TextDecoder("utf-8", { fatal: true }).decode(liveBytes);
  } catch (error) {
    throw createHotByteRejectedError(
      [
        createHotCodecIssue(
          "byte.stringDecodeInvalid",
          path,
          "FixedStringEncoded utf8 bytes are invalid",
        ),
      ],
      error,
    );
  }
}

function encodeFixedStringValue(
  value: string,
  encoding: "ascii" | "utf8",
  path: string,
): Uint8Array {
  if (encoding === "ascii") {
    const bytes = new Uint8Array(value.length);
    for (let index = 0; index < value.length; index += 1) {
      const codeUnit = value.charCodeAt(index);
      if (codeUnit > 0x7f) {
        throwByteIssue(
          "byte.stringEncodingInvalid",
          path,
          "ascii string contains a non-ascii code unit",
        );
      }
      bytes[index] = codeUnit;
    }
    return bytes;
  }

  return new TextEncoder().encode(value);
}

function decodeAscii(bytes: Uint8Array, path: string): string {
  let value = "";
  for (const byte of bytes) {
    if (byte > 0x7f) {
      throwByteIssue("byte.stringDecodeInvalid", path, "ascii string contains a non-ascii byte");
    }
    value += String.fromCharCode(byte);
  }
  return value;
}
