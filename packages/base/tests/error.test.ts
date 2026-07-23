import { describe, expect, expectTypeOf, it } from "vitest";

import {
  createErrorFactory,
  defineErrorDomain,
  type ErrorCodeOf,
  type ErrorDetails,
  type ErrorKeyOf,
  type ErrorMeta,
  ExclaveError,
  invariant,
  isExclaveError,
} from "../src/index";

const meta = {
  severity: "error",
  recoverable: true,
  boundarySafe: true,
} as const satisfies ErrorMeta;

describe("ExclaveError", () => {
  it("serializes to a portable envelope", () => {
    const error = new ExclaveError(
      "demo.failed",
      "Demo failed",
      { where: "tests", reason: "example" },
      meta,
    );

    expect(error).toBeInstanceOf(Error);
    expect(error).toBeInstanceOf(ExclaveError);
    expect(error.toJSON()).toEqual({
      code: "demo.failed",
      message: "Demo failed",
      details: { where: "tests", reason: "example" },
      meta,
    });
  });

  it("recognizes structural ExclaveError values", () => {
    expect(isExclaveError(new ExclaveError("demo.failed", "Demo failed", {}, meta))).toBe(true);
    expect(isExclaveError({ name: "ExclaveError", code: "demo.failed", message: "Demo" })).toBe(
      true,
    );
    expect(isExclaveError({ name: "ExclaveError", code: 1, message: "Demo" })).toBe(false);
    expect(isExclaveError(new Error("plain"))).toBe(false);
  });
});

describe("createErrorFactory", () => {
  const createDemoError = createErrorFactory({
    failed: {
      code: "demo.failed",
      message: "Demo failed",
      meta,
    },
  } as const);

  it("creates typed package errors from local keys", () => {
    const error = createDemoError("failed", { where: "tests" });

    expect(error.code).toBe("demo.failed");
    expect(error.message).toBe("Demo failed");
    expect(error.details).toEqual({ where: "tests" });
    expect(error.meta).toBe(meta);
    expectTypeOf(error).toEqualTypeOf<ExclaveError<"demo.failed">>();
  });

  it("rejects unknown keys at runtime", () => {
    expect(() => createDemoError("missing" as "failed", { where: "tests" })).toThrow(
      "unknown error key: missing",
    );
  });
});

describe("defineErrorDomain", () => {
  const domain = defineErrorDomain("demo", {
    failed: {
      message: "Demo failed",
      meta,
    },
    exhausted: {
      message: "Demo exhausted",
      meta: {
        severity: "fatal",
        recoverable: false,
        boundarySafe: false,
      },
    },
  } as const);

  it("derives qualified codes without owning the domain", () => {
    expect(domain.prefix).toBe("demo");
    expect(domain.registry.failed.code).toBe("demo.failed");
    expect(domain.registry.exhausted.code).toBe("demo.exhausted");

    const error = domain.createError("exhausted", { where: "tests" });
    expect(error.code).toBe("demo.exhausted");
  });

  it("preserves useful public domain types", () => {
    type DemoCode = ErrorCodeOf<typeof domain>;
    type DemoKey = ErrorKeyOf<typeof domain>;

    expectTypeOf<DemoCode>().toEqualTypeOf<"demo.failed" | "demo.exhausted">();
    expectTypeOf<DemoKey>().toEqualTypeOf<"failed" | "exhausted">();
  });
});

describe("invariant", () => {
  it("does nothing when the condition holds", () => {
    let allocated = false;

    invariant(true, () => {
      allocated = true;
      return new ExclaveError("demo.failed", "Demo failed", {}, meta);
    });

    expect(allocated).toBe(false);
  });

  it("throws the lazy ExclaveError when the condition fails", () => {
    const details = { where: "tests", detail: "expected true" } satisfies ErrorDetails;

    expect(() =>
      invariant(false, () => new ExclaveError("demo.failed", "Demo failed", details, meta)),
    ).toThrow(ExclaveError);
  });
});
