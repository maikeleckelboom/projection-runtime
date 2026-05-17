import { ExclaveError } from "@exclave/base";
import { describe, expect, expectTypeOf, it } from "vitest";
import { createWarmError, throwInputRejected, warmErrorDomain } from "../src/errors";

describe("warmErrorDomain", () => {
  it("has prefix warm", () => {
    expect(warmErrorDomain.prefix).toBe("warm");
  });

  it("derives code warm.inputRejected from inputRejected", () => {
    expect(warmErrorDomain.registry.inputRejected.code).toBe("warm.inputRejected");
  });

  it("preserves message Warm input rejected", () => {
    expect(warmErrorDomain.registry.inputRejected.message).toBe("Warm input rejected");
  });

  it("preserves meta severity error", () => {
    expect(warmErrorDomain.registry.inputRejected.meta.severity).toBe("error");
  });

  it("preserves meta recoverable false", () => {
    expect(warmErrorDomain.registry.inputRejected.meta.recoverable).toBe(false);
  });

  it("preserves meta boundarySafe true", () => {
    expect(warmErrorDomain.registry.inputRejected.meta.boundarySafe).toBe(true);
  });
});

describe("createWarmError", () => {
  it("creates an ExclaveError with the correct code", () => {
    const error = createWarmError("inputRejected", { detail: "test" });
    expect(error).toBeInstanceOf(ExclaveError);
    expect(error.code).toBe("warm.inputRejected");
  });

  it("includes details in the error", () => {
    const error = createWarmError("inputRejected", { detail: "specific rejection" });
    expect(error.details).toEqual({ detail: "specific rejection" });
  });

  it("has correct meta", () => {
    const error = createWarmError("inputRejected", { detail: "test" });
    expect(error.meta.severity).toBe("error");
    expect(error.meta.recoverable).toBe(false);
    expect(error.meta.boundarySafe).toBe(true);
  });

  it("preserves the Warm input rejected message", () => {
    const error = createWarmError("inputRejected", { detail: "test" });
    expect(error.message).toBe("Warm input rejected");
  });

  it("has typed details matching inputRejected", () => {
    const error = createWarmError("inputRejected", { detail: "test" });
    expectTypeOf(error).toEqualTypeOf<ExclaveError<"warm.inputRejected">>();
  });

  it("rejects invalid details shape at compile time", () => {
    // @ts-expect-error — { wrong } does not satisfy { readonly detail: string }
    createWarmError("inputRejected", { wrong: "x" });
  });
});

describe("throwInputRejected", () => {
  it("throws an ExclaveError", () => {
    expect(() => throwInputRejected("test detail")).toThrow(ExclaveError);
  });

  it("preserves error code warm.inputRejected", () => {
    try {
      throwInputRejected("bad input");
    } catch (e) {
      expect(e).toBeInstanceOf(ExclaveError);
      if (e instanceof ExclaveError) {
        expect(e.code).toBe("warm.inputRejected");
      }
    }
  });

  it("includes { detail } in error details", () => {
    try {
      throwInputRejected("field must be a string");
    } catch (e) {
      expect(e).toBeInstanceOf(ExclaveError);
      if (e instanceof ExclaveError) {
        expect(e.details).toEqual({ detail: "field must be a string" });
      }
    }
  });

  it("has meta severity error", () => {
    try {
      throwInputRejected("test");
    } catch (e) {
      expect(e).toBeInstanceOf(ExclaveError);
      if (e instanceof ExclaveError) {
        expect(e.meta.severity).toBe("error");
      }
    }
  });

  it("has meta recoverable false", () => {
    try {
      throwInputRejected("test");
    } catch (e) {
      expect(e).toBeInstanceOf(ExclaveError);
      if (e instanceof ExclaveError) {
        expect(e.meta.recoverable).toBe(false);
      }
    }
  });

  it("has meta boundarySafe true", () => {
    try {
      throwInputRejected("test");
    } catch (e) {
      expect(e).toBeInstanceOf(ExclaveError);
      if (e instanceof ExclaveError) {
        expect(e.meta.boundarySafe).toBe(true);
      }
    }
  });
});
