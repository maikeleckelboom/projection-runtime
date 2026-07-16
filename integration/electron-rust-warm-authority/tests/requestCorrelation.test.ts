import { describe, expect, it } from "vitest";
import { takeCorrelatedRequest } from "../src/requestCorrelation.js";

describe("private client request correlation", () => {
  it("takes a known reply exactly once", () => {
    const pending = new Map([["request-1", { value: 7 }]]);

    expect(takeCorrelatedRequest(pending, "request-1", "control response")).toEqual({ value: 7 });
    expect(pending.size).toBe(0);
    expect(() => takeCorrelatedRequest(pending, "request-1", "control response")).toThrow(
      "uncorrelated control response request-1",
    );
  });

  it("rejects an unknown proof reply without mutating other requests", () => {
    const pending = new Map([["proof-1", { value: 9 }]]);

    expect(() => takeCorrelatedRequest(pending, "proof-unknown", "proof result")).toThrow(
      "uncorrelated proof result proof-unknown",
    );
    expect(pending.has("proof-1")).toBe(true);
  });
});
