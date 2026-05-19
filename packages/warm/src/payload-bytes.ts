import type { AbiEnumStorageType } from "@exclave/base";
import { U16_MAX, U32_MAX } from "./payload-constants";
import { WarmDecodeProblem } from "./payload-failure";
import type { FieldContext } from "./payload-types";

export class PayloadWriter {
  private readonly bytes: number[] = [];

  writeU8(value: number): void {
    this.bytes.push(value & 0xff);
  }

  writeI8(value: number): void {
    this.bytes.push(value & 0xff);
  }

  writeU16(value: number): void {
    this.writeDataView(2, (view) => view.setUint16(0, value, true));
  }

  writeI16(value: number): void {
    this.writeDataView(2, (view) => view.setInt16(0, value, true));
  }

  writeU32(value: number): void {
    this.writeDataView(4, (view) => view.setUint32(0, value, true));
  }

  writeI32(value: number): void {
    this.writeDataView(4, (view) => view.setInt32(0, value, true));
  }

  writeU64(value: bigint): void {
    this.writeDataView(8, (view) => view.setBigUint64(0, value, true));
  }

  writeI64(value: bigint): void {
    this.writeDataView(8, (view) => view.setBigInt64(0, value, true));
  }

  writeF32(value: number): void {
    this.writeDataView(4, (view) => view.setFloat32(0, value, true));
  }

  writeF64(value: number): void {
    this.writeDataView(8, (view) => view.setFloat64(0, value, true));
  }

  writeBytes(value: Uint8Array): void {
    for (const byte of value) {
      this.bytes.push(byte);
    }
  }

  toUint8Array(): Uint8Array {
    return Uint8Array.from(this.bytes);
  }

  private writeDataView(byteLength: number, write: (view: DataView) => void): void {
    const bytes = new Uint8Array(byteLength);
    write(new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength));
    this.writeBytes(bytes);
  }
}

export class PayloadReader {
  readonly view: DataView;
  offset = 0;

  constructor(readonly bytes: Uint8Array) {
    this.view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  }

  readU8(path: string, field: FieldContext): number {
    this.requireRemaining(1, path, field);
    const value = this.view.getUint8(this.offset);
    this.offset += 1;
    return value;
  }

  readI8(path: string, field: FieldContext): number {
    this.requireRemaining(1, path, field);
    const value = this.view.getInt8(this.offset);
    this.offset += 1;
    return value;
  }

  readU16(path: string, field: FieldContext): number {
    this.requireRemaining(2, path, field);
    const value = this.view.getUint16(this.offset, true);
    this.offset += 2;
    return value;
  }

  readI16(path: string, field: FieldContext): number {
    this.requireRemaining(2, path, field);
    const value = this.view.getInt16(this.offset, true);
    this.offset += 2;
    return value;
  }

  readU32(path: string, field: FieldContext): number {
    this.requireRemaining(4, path, field);
    const value = this.view.getUint32(this.offset, true);
    this.offset += 4;
    return value;
  }

  readI32(path: string, field: FieldContext): number {
    this.requireRemaining(4, path, field);
    const value = this.view.getInt32(this.offset, true);
    this.offset += 4;
    return value;
  }

  readU64(path: string, field: FieldContext): bigint {
    this.requireRemaining(8, path, field);
    const value = this.view.getBigUint64(this.offset, true);
    this.offset += 8;
    return value;
  }

  readI64(path: string, field: FieldContext): bigint {
    this.requireRemaining(8, path, field);
    const value = this.view.getBigInt64(this.offset, true);
    this.offset += 8;
    return value;
  }

  readF32(path: string, field: FieldContext): number {
    this.requireRemaining(4, path, field);
    const value = this.view.getFloat32(this.offset, true);
    this.offset += 4;
    return value;
  }

  readF64(path: string, field: FieldContext): number {
    this.requireRemaining(8, path, field);
    const value = this.view.getFloat64(this.offset, true);
    this.offset += 8;
    return value;
  }

  readBytes(byteLength: number, path: string, field: FieldContext): Uint8Array {
    this.requireRemaining(byteLength, path, field);
    const value = this.bytes.slice(this.offset, this.offset + byteLength);
    this.offset += byteLength;
    return value;
  }

  private requireRemaining(byteLength: number, path: string, field: FieldContext): void {
    if (byteLength < 0 || this.offset > this.bytes.byteLength - byteLength) {
      throw new WarmDecodeProblem(
        "malformedPayload",
        `payload ended before ${byteLength} byte(s) could be read`,
        path,
        field,
        this.offset,
      );
    }
  }
}

export function writeUnsignedStorage(
  writer: PayloadWriter,
  storage: AbiEnumStorageType,
  value: number,
): void {
  switch (storage) {
    case "u8":
      writer.writeU8(value);
      return;
    case "u16":
      writer.writeU16(value);
      return;
    case "u32":
      writer.writeU32(value);
      return;
  }
}

export function readUnsignedStorage(
  reader: PayloadReader,
  storage: AbiEnumStorageType,
  path: string,
  field: FieldContext,
): number {
  switch (storage) {
    case "u8":
      return reader.readU8(path, field);
    case "u16":
      return reader.readU16(path, field);
    case "u32":
      return reader.readU32(path, field);
  }
}

export function unsignedMaxForStorage(storage: AbiEnumStorageType): number {
  switch (storage) {
    case "u8":
      return 0xff;
    case "u16":
      return U16_MAX;
    case "u32":
      return U32_MAX;
  }
}

export function compareBytes(left: Uint8Array, right: Uint8Array): number {
  const length = Math.min(left.byteLength, right.byteLength);
  for (let index = 0; index < length; index += 1) {
    const leftByte = left[index];
    const rightByte = right[index];
    if (leftByte === undefined || rightByte === undefined) {
      break;
    }
    if (leftByte !== rightByte) {
      return leftByte - rightByte;
    }
  }
  return left.byteLength - right.byteLength;
}

export function compareUtf8(left: string, right: string, encoder: TextEncoder): number {
  return compareBytes(encoder.encode(left), encoder.encode(right));
}
