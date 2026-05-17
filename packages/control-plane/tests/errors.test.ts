import { ExclaveError } from "@exclave/base";
import { describe, expect, expectTypeOf, it } from "vitest";
import {
  controlPlaneErrorDomain,
  createControlPlaneError,
  throwInputRejected,
} from "../src/errors";

describe("controlPlaneErrorDomain", () => {
  it("has prefix control-plane", () => {
    expect(controlPlaneErrorDomain.prefix).toBe("control-plane");
  });

  it("derives code control-plane.inputRejected from inputRejected", () => {
    expect(controlPlaneErrorDomain.registry.inputRejected.code).toBe("control-plane.inputRejected");
  });

  it("preserves message Control-plane input rejected", () => {
    expect(controlPlaneErrorDomain.registry.inputRejected.message).toBe(
      "Control-plane input rejected",
    );
  });

  it("preserves meta severity error", () => {
    expect(controlPlaneErrorDomain.registry.inputRejected.meta.severity).toBe("error");
  });

  it("preserves meta recoverable false", () => {
    expect(controlPlaneErrorDomain.registry.inputRejected.meta.recoverable).toBe(false);
  });

  it("preserves meta boundarySafe true", () => {
    expect(controlPlaneErrorDomain.registry.inputRejected.meta.boundarySafe).toBe(true);
  });
});

describe("createControlPlaneError", () => {
  it("creates an ExclaveError with the correct code", () => {
    const error = createControlPlaneError("inputRejected", { detail: "test" });
    expect(error).toBeInstanceOf(ExclaveError);
    expect(error.code).toBe("control-plane.inputRejected");
  });

  it("includes details in the error", () => {
    const error = createControlPlaneError("inputRejected", { detail: "specific rejection" });
    expect(error.details).toEqual({ detail: "specific rejection" });
  });

  it("has correct meta", () => {
    const error = createControlPlaneError("inputRejected", { detail: "test" });
    expect(error.meta.severity).toBe("error");
    expect(error.meta.recoverable).toBe(false);
    expect(error.meta.boundarySafe).toBe(true);
  });

  it("preserves the Control-plane input rejected message", () => {
    const error = createControlPlaneError("inputRejected", { detail: "test" });
    expect(error.message).toBe("Control-plane input rejected");
  });

  it("has typed details matching inputRejected", () => {
    const error = createControlPlaneError("inputRejected", { detail: "test" });
    expectTypeOf(error).toEqualTypeOf<ExclaveError<"control-plane.inputRejected">>();
  });

  it("rejects invalid details shape at compile time", () => {
    // @ts-expect-error — { wrong } does not satisfy { readonly detail: string }
    createControlPlaneError("inputRejected", { wrong: "x" });
  });
});

describe("throwInputRejected", () => {
  it("throws an ExclaveError", () => {
    expect(() => throwInputRejected("test detail")).toThrow(ExclaveError);
  });

  it("preserves error code control-plane.inputRejected", () => {
    try {
      throwInputRejected("bad input");
    } catch (e) {
      expect(e).toBeInstanceOf(ExclaveError);
      if (e instanceof ExclaveError) {
        expect(e.code).toBe("control-plane.inputRejected");
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
