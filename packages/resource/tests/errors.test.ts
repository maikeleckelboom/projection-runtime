import { ExclaveError } from "@exclave/base";
import { describe, expect, expectTypeOf, it } from "vitest";
import { createResourceError, resourceErrorDomain, throwInputRejected } from "../src/errors";

describe("resourceErrorDomain", () => {
  it("has prefix resource", () => {
    expect(resourceErrorDomain.prefix).toBe("resource");
  });

  it("derives code resource.inputRejected from inputRejected", () => {
    expect(resourceErrorDomain.registry.inputRejected.code).toBe("resource.inputRejected");
  });

  it("preserves message Resource input rejected", () => {
    expect(resourceErrorDomain.registry.inputRejected.message).toBe("Resource input rejected");
  });

  it("preserves meta severity error", () => {
    expect(resourceErrorDomain.registry.inputRejected.meta.severity).toBe("error");
  });

  it("preserves meta recoverable false", () => {
    expect(resourceErrorDomain.registry.inputRejected.meta.recoverable).toBe(false);
  });

  it("preserves meta boundarySafe true", () => {
    expect(resourceErrorDomain.registry.inputRejected.meta.boundarySafe).toBe(true);
  });
});

describe("createResourceError", () => {
  it("creates an ExclaveError with the correct code", () => {
    const error = createResourceError("inputRejected", { detail: "test" });
    expect(error).toBeInstanceOf(ExclaveError);
    expect(error.code).toBe("resource.inputRejected");
  });

  it("includes details in the error", () => {
    const error = createResourceError("inputRejected", { detail: "specific rejection" });
    expect(error.details).toEqual({ detail: "specific rejection" });
  });

  it("has correct meta", () => {
    const error = createResourceError("inputRejected", { detail: "test" });
    expect(error.meta.severity).toBe("error");
    expect(error.meta.recoverable).toBe(false);
    expect(error.meta.boundarySafe).toBe(true);
  });

  it("preserves the Resource input rejected message", () => {
    const error = createResourceError("inputRejected", { detail: "test" });
    expect(error.message).toBe("Resource input rejected");
  });

  it("has typed details matching inputRejected", () => {
    const error = createResourceError("inputRejected", { detail: "test" });
    expectTypeOf(error).toEqualTypeOf<ExclaveError<"resource.inputRejected">>();
  });

  it("rejects invalid details shape at compile time", () => {
    // @ts-expect-error — { wrong } does not satisfy { readonly detail: string }
    createResourceError("inputRejected", { wrong: "x" });
  });
});

describe("throwInputRejected", () => {
  it("throws an ExclaveError", () => {
    expect(() => throwInputRejected("test detail")).toThrow(ExclaveError);
  });

  it("preserves error code resource.inputRejected", () => {
    try {
      throwInputRejected("bad input");
    } catch (e) {
      expect(e).toBeInstanceOf(ExclaveError);
      if (e instanceof ExclaveError) {
        expect(e.code).toBe("resource.inputRejected");
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
