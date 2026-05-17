import { ExclaveError } from "@exclave/base";
import { describe, expect, expectTypeOf, it } from "vitest";
import {
  createHostContractError,
  hostContractErrorDomain,
  throwInputRejected,
} from "../src/errors";

describe("hostContractErrorDomain", () => {
  it("has prefix host-contract", () => {
    expect(hostContractErrorDomain.prefix).toBe("host-contract");
  });

  it("derives code host-contract.inputRejected from inputRejected", () => {
    expect(hostContractErrorDomain.registry.inputRejected.code).toBe("host-contract.inputRejected");
  });

  it("preserves message Host contract input rejected", () => {
    expect(hostContractErrorDomain.registry.inputRejected.message).toBe(
      "Host contract input rejected",
    );
  });

  it("preserves meta severity error", () => {
    expect(hostContractErrorDomain.registry.inputRejected.meta.severity).toBe("error");
  });

  it("preserves meta recoverable false", () => {
    expect(hostContractErrorDomain.registry.inputRejected.meta.recoverable).toBe(false);
  });

  it("preserves meta boundarySafe true", () => {
    expect(hostContractErrorDomain.registry.inputRejected.meta.boundarySafe).toBe(true);
  });
});

describe("createHostContractError", () => {
  it("creates an ExclaveError with the correct code", () => {
    const error = createHostContractError("inputRejected", { detail: "test" });
    expect(error).toBeInstanceOf(ExclaveError);
    expect(error.code).toBe("host-contract.inputRejected");
  });

  it("includes details in the error", () => {
    const error = createHostContractError("inputRejected", {
      detail: "specific rejection",
    });
    expect(error.details).toEqual({ detail: "specific rejection" });
  });

  it("has correct meta", () => {
    const error = createHostContractError("inputRejected", { detail: "test" });
    expect(error.meta.severity).toBe("error");
    expect(error.meta.recoverable).toBe(false);
    expect(error.meta.boundarySafe).toBe(true);
  });

  it("preserves the Host contract input rejected message", () => {
    const error = createHostContractError("inputRejected", { detail: "test" });
    expect(error.message).toBe("Host contract input rejected");
  });

  it("has typed details matching inputRejected", () => {
    const error = createHostContractError("inputRejected", { detail: "test" });
    expectTypeOf(error).toEqualTypeOf<ExclaveError<"host-contract.inputRejected">>();
  });

  it("rejects invalid details shape at compile time", () => {
    // @ts-expect-error — { wrong } does not satisfy { readonly detail: string }
    createHostContractError("inputRejected", { wrong: "x" });
  });
});

describe("throwInputRejected", () => {
  it("throws an ExclaveError", () => {
    expect(() => throwInputRejected("test detail")).toThrow(ExclaveError);
  });

  it("preserves error code host-contract.inputRejected", () => {
    try {
      throwInputRejected("bad input");
    } catch (e) {
      expect(e).toBeInstanceOf(ExclaveError);
      if (e instanceof ExclaveError) {
        expect(e.code).toBe("host-contract.inputRejected");
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
