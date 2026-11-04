import { describe, expect, it } from "vitest";
import { ResourceBudget, ResourceFrameDecoder } from "../src/index";

function frame(length = 16): Uint8Array {
  const bytes = new Uint8Array(48 + length);
  bytes.set([69, 88, 82, 66, 1, 0, 1, 0]);
  const view = new DataView(bytes.buffer);
  view.setUint32(8, length, true);
  view.setUint32(12, 1, true);
  view.setBigUint64(16, 1n, true);
  view.setBigUint64(24, 7n, true);
  view.setBigUint64(32, 9007199254740993n, true);
  view.setBigUint64(40, 2n, true);
  bytes.fill(9, 48);
  return bytes;
}
describe("resource runtime boundaries", () => {
  it("copies one-byte fragments linearly with one owned body allocation", () => {
    const bytes = frame(262144);
    const received: Uint8Array[] = [];
    const decoder = new ResourceFrameDecoder(
      (h) => expect(h.offsetBytes).toBe(9007199254740993n),
      (f) => received.push(f.payload),
    );
    for (let i = 0; i < bytes.length; i++) decoder.push(bytes.subarray(i, i + 1));
    decoder.finish();
    expect(received[0]).toEqual(bytes.subarray(48));
    expect(decoder.diagnostics()).toEqual({ copiedBytes: bytes.length, bodyAllocations: 1 });
  });
  it("rejects headers and denied reservations before allocating", () => {
    for (const [offset, value] of [
      [0, 0],
      [4, 2],
      [6, 2],
      [12, 2],
    ] as const) {
      const bytes = frame();
      bytes[offset] = value;
      const decoder = new ResourceFrameDecoder(
        () => {},
        () => {},
      );
      expect(() => decoder.push(bytes)).toThrow();
      expect(decoder.diagnostics().bodyAllocations).toBe(0);
    }
    const bytes = frame();
    new DataView(bytes.buffer).setUint32(8, 262145, true);
    const decoder = new ResourceFrameDecoder(
      () => {},
      () => {},
    );
    expect(() => decoder.push(bytes)).toThrow();
    expect(decoder.diagnostics().bodyAllocations).toBe(0);
    const denied = new ResourceFrameDecoder(
      () => {
        throw new Error("not admitted");
      },
      () => {},
    );
    expect(() => denied.push(frame())).toThrow("not admitted");
    expect(denied.diagnostics().bodyAllocations).toBe(0);
  });
  it("fails terminally on truncated EOF and callback failure", () => {
    for (const length of [1, 47, 48, 63]) {
      const decoder = new ResourceFrameDecoder(
        () => {},
        () => {},
      );
      decoder.push(frame().subarray(0, length));
      expect(() => decoder.finish()).toThrow();
      expect(() => decoder.push(frame())).toThrow();
    }
    const decoder = new ResourceFrameDecoder(
      () => {},
      () => {
        throw new Error("consumer failed");
      },
    );
    expect(() => decoder.push(frame())).toThrow();
    expect(() => decoder.push(frame())).toThrow();
  });
  it("settles exactly once, separates clients and resident/transfer ledgers", () => {
    const limits = { bytes: 16, items: 4, clientBytes: 8, clientItems: 2 };
    const transfer = new ResourceBudget(limits);
    const resident = new ResourceBudget(limits);
    expect(transfer.reserve("A", "a", 8)).toBe(true);
    expect(transfer.reserve("B", "b", 8)).toBe(true);
    expect(transfer.reserve("A2", "a", 1)).toBe(false);
    expect(resident.reserve("B", "b", 8)).toBe(true);
    expect(transfer.settle("B")).toBe(true);
    expect(transfer.settle("B")).toBe(false);
    expect(resident.snapshot().bytes).toBe(8);
    expect(transfer.snapshot().bytes).toBe(8);
    transfer.settle("A");
    expect(transfer.snapshot().bytes).toBe(0);
    expect(resident.snapshot().bytes).toBe(8);
  });
});
