import { ExclaveError } from "@exclave/base";
import { describe, expect, expectTypeOf, it } from "vitest";
import type { ControlFailureCode, ControlRequestEnvelope } from "../src/index";
import * as controlPlane from "../src/index";
import {
  createControlFailureEnvelope,
  createControlRequestEnvelope,
  createControlSuccessEnvelope,
  validateControlRequestEnvelope,
  validateControlResponseEnvelope,
  validateControlResponseForRequest,
} from "../src/index";
import { checkJsonObjectRoot } from "../src/json-safety";

function makeRevokedProxy<T extends object>(target: T): T {
  const { proxy, revoke } = Proxy.revocable(target, {});
  revoke();
  return proxy;
}

describe("@exclave/control-plane JSON safety", () => {
  it("rejects NaN", () => {
    const result = checkJsonObjectRoot({ value: NaN });
    expect(result.ok).toBe(false);
  });

  it("rejects Infinity", () => {
    const result = checkJsonObjectRoot({ value: Infinity });
    expect(result.ok).toBe(false);
  });

  it("rejects -Infinity", () => {
    const result = checkJsonObjectRoot({ value: -Infinity });
    expect(result.ok).toBe(false);
  });

  it("allows shared non-cyclic object references", () => {
    const shared = { x: 1 };
    const root = { a: shared, b: shared };
    const result = checkJsonObjectRoot(root);
    expect(result.ok).toBe(true);
  });

  it("rejects direct cycle", () => {
    const cyclic: Record<string, unknown> = { x: 1 };
    cyclic.self = cyclic;
    const result = checkJsonObjectRoot(cyclic);
    expect(result.ok).toBe(false);
  });

  it("rejects nested cycle", () => {
    const inner: Record<string, unknown> = {};
    const outer = { inner };
    inner.parent = outer;
    const result = checkJsonObjectRoot(outer);
    expect(result.ok).toBe(false);
  });

  it("rejects symbol keys", () => {
    const obj = { [Symbol("secret")]: "value" };
    const result = checkJsonObjectRoot(obj as unknown as Record<string, unknown>);
    expect(result.ok).toBe(false);
  });

  it("rejects non-enumerable properties", () => {
    const obj = { visible: 1 };
    Object.defineProperty(obj, "hidden", {
      value: 2,
      enumerable: false,
      writable: true,
      configurable: true,
    });
    const result = checkJsonObjectRoot(obj);
    expect(result.ok).toBe(false);
  });

  it("rejects getter properties without invoking the getter", () => {
    let getterCalled = false;
    const obj = { regular: 1 };
    Object.defineProperty(obj, "computed", {
      get() {
        getterCalled = true;
        return 42;
      },
      enumerable: true,
      configurable: true,
    });
    const result = checkJsonObjectRoot(obj);
    expect(result.ok).toBe(false);
    expect(getterCalled).toBe(false);
  });

  it("rejects setter/accessor properties", () => {
    const obj = { regular: 1 };
    Object.defineProperty(obj, "writeOnly", {
      set(_v: number) {
        /* noop */
      },
      enumerable: true,
      configurable: true,
    });
    const result = checkJsonObjectRoot(obj);
    expect(result.ok).toBe(false);
  });

  it("rejects nested class instances", () => {
    class MyClass {}
    const result = checkJsonObjectRoot({ nested: new MyClass() });
    expect(result.ok).toBe(false);
  });

  it("still accepts plain object with nested arrays and null", () => {
    const result = checkJsonObjectRoot({ items: [1, 2, null], flag: true });
    expect(result.ok).toBe(true);
  });

  it("checkJsonObjectRoot rejects Proxy that throws from getPrototypeOf without throwing", () => {
    const target = {
      kind: "control.request",
      envelopeVersion: 1,
      requestKey: "req-1",
      operationKey: "op.test",
      payload: { x: 1 },
    };
    const proxy = new Proxy(target, {
      getPrototypeOf() {
        throw new Error("trap explosion");
      },
    });
    let threw = false;
    try {
      const result = checkJsonObjectRoot(proxy);
      expect(result.ok).toBe(false);
    } catch {
      threw = true;
    }
    expect(threw).toBe(false);
  });

  it("checkJsonObjectRoot rejects Proxy that throws from ownKeys without throwing", () => {
    const target = { x: 1 };
    const proxy = new Proxy(target, {
      ownKeys() {
        throw new Error("trap explosion");
      },
    });
    let threw = false;
    try {
      const result = checkJsonObjectRoot(proxy);
      expect(result.ok).toBe(false);
    } catch {
      threw = true;
    }
    expect(threw).toBe(false);
  });

  it("checkJsonObjectRoot rejects Proxy that throws from getOwnPropertyDescriptor without throwing", () => {
    const target = {
      kind: "control.request",
      envelopeVersion: 1,
      requestKey: "req-1",
      operationKey: "op.test",
      payload: { x: 1 },
    };
    const proxy = new Proxy(target, {
      getOwnPropertyDescriptor() {
        throw new Error("trap explosion");
      },
    });
    let threw = false;
    try {
      const result = checkJsonObjectRoot(proxy);
      expect(result.ok).toBe(false);
    } catch {
      threw = true;
    }
    expect(threw).toBe(false);
  });

  it("checkJsonObjectRoot rejects revoked Proxy without throwing", () => {
    const target = { x: 1 };
    const proxy = makeRevokedProxy(target);
    let threw = false;
    try {
      const result = checkJsonObjectRoot(proxy);
      expect(result.ok).toBe(false);
    } catch {
      threw = true;
    }
    expect(threw).toBe(false);
  });

  it("accepts nested dense array", () => {
    const result = checkJsonObjectRoot({ items: [1, 2, 3] });
    expect(result.ok).toBe(true);
  });

  it("rejects sparse nested array", () => {
    const arr: unknown[] = [1];
    arr[2] = 3;
    const result = checkJsonObjectRoot({ items: arr });
    expect(result.ok).toBe(false);
  });

  it("rejects nested array with symbol key", () => {
    const arr: unknown[] = [1, 2, 3];
    (arr as Record<symbol, unknown>)[Symbol("s")] = "x";
    const result = checkJsonObjectRoot({ items: arr });
    expect(result.ok).toBe(false);
  });

  it("rejects nested array with extra string property", () => {
    const arr: unknown[] = [1, 2, 3];
    (arr as Record<string, unknown>).foo = "bar";
    const result = checkJsonObjectRoot({ items: arr });
    expect(result.ok).toBe(false);
  });

  it("rejects nested array with getter index without invoking getter", () => {
    let getterCalled = false;
    const arr = [1, 2, 3];
    Object.defineProperty(arr, "1", {
      get() {
        getterCalled = true;
        return 99;
      },
      enumerable: true,
      configurable: true,
    });
    const result = checkJsonObjectRoot({ items: arr });
    expect(result.ok).toBe(false);
    expect(getterCalled).toBe(false);
  });

  it("rejects nested array with non-enumerable extra property", () => {
    const arr = [1, 2, 3];
    Object.defineProperty(arr, "extra", {
      value: "hidden",
      enumerable: false,
      writable: true,
      configurable: true,
    });
    const result = checkJsonObjectRoot({ items: arr });
    expect(result.ok).toBe(false);
  });

  it("still accepts shared nested array references when not cyclic", () => {
    const shared = [1, 2, 3];
    const root = { a: shared, b: shared };
    const result = checkJsonObjectRoot(root);
    expect(result.ok).toBe(true);
  });

  it("still rejects cyclic arrays", () => {
    const arr: unknown[] = [1, 2];
    arr.push(arr);
    const result = checkJsonObjectRoot({ items: arr });
    expect(result.ok).toBe(false);
  });
});

describe("@exclave/control-plane creation helpers", () => {
  it("creates envelopeVersion 1 request envelopes", () => {
    const envelope = createControlRequestEnvelope({
      requestKey: "req-1",
      operationKey: "op.test",
      payload: { value: 42 },
    });

    expect(envelope.kind).toBe("control.request");
    expect(envelope.envelopeVersion).toBe(1);
    expect(envelope.requestKey).toBe("req-1");
    expect(envelope.operationKey).toBe("op.test");
    expect(envelope.payload).toEqual({ value: 42 });
  });

  it("correlates success envelopes to requestKey", () => {
    const envelope = createControlSuccessEnvelope({
      requestKey: "req-1",
      payload: { result: "ok" },
    });

    expect(envelope.kind).toBe("control.response");
    expect(envelope.envelopeVersion).toBe(1);
    expect(envelope.requestKey).toBe("req-1");
    expect(envelope.ok).toBe(true);
    expect(envelope.payload).toEqual({ result: "ok" });
  });

  it("correlates failure envelopes to requestKey", () => {
    const envelope = createControlFailureEnvelope({
      requestKey: "req-1",
      failure: { code: "control.rejected", message: "Operation rejected" },
    });

    expect(envelope.kind).toBe("control.response");
    expect(envelope.envelopeVersion).toBe(1);
    expect(envelope.requestKey).toBe("req-1");
    expect(envelope.ok).toBe(false);
    expect(envelope.failure.code).toBe("control.rejected");
  });

  it("rejects empty requestKey on request", () => {
    expect(() =>
      createControlRequestEnvelope({
        requestKey: "",
        operationKey: "op.test",
        payload: { value: 1 },
      }),
    ).toThrow(ExclaveError);
  });

  it("rejects empty operationKey", () => {
    expect(() =>
      createControlRequestEnvelope({
        requestKey: "req-1",
        operationKey: "",
        payload: { value: 1 },
      }),
    ).toThrow(ExclaveError);
  });

  it("rejects non-JSON-safe request payload", () => {
    const unsafePayload = { value: 1n };
    expect(() =>
      createControlRequestEnvelope({
        requestKey: "req-1",
        operationKey: "op.test",
        payload: unsafePayload as never,
      }),
    ).toThrow(ExclaveError);
  });

  it("rejects array root payload", () => {
    expect(() =>
      createControlRequestEnvelope({
        requestKey: "req-1",
        operationKey: "op.test",
        payload: [] as never,
      }),
    ).toThrow(ExclaveError);
  });

  it("rejects empty requestKey on success", () => {
    expect(() =>
      createControlSuccessEnvelope({
        requestKey: "",
        payload: { result: 1 },
      }),
    ).toThrow(ExclaveError);
  });

  it("rejects non-JSON-safe success payload", () => {
    const unsafePayload = { data: new Date() };
    expect(() =>
      createControlSuccessEnvelope({
        requestKey: "req-1",
        payload: unsafePayload as never,
      }),
    ).toThrow(ExclaveError);
  });

  it("rejects empty requestKey on failure", () => {
    expect(() =>
      createControlFailureEnvelope({
        requestKey: "",
        failure: { code: "control.rejected", message: "no" },
      }),
    ).toThrow(ExclaveError);
  });

  it("rejects invalid failure code", () => {
    expect(() =>
      createControlFailureEnvelope({
        requestKey: "req-1",
        failure: { code: "control.invalid" as ControlFailureCode, message: "bad" },
      }),
    ).toThrow(ExclaveError);
  });

  it("rejects empty failure message", () => {
    expect(() =>
      createControlFailureEnvelope({
        requestKey: "req-1",
        failure: { code: "control.rejected", message: "" },
      }),
    ).toThrow(ExclaveError);
  });

  it("rejects non-JSON-safe failure details", () => {
    expect(() =>
      createControlFailureEnvelope({
        requestKey: "req-1",
        failure: {
          code: "control.rejected",
          message: "fail",
          details: { epoch: 1n } as never,
        },
      }),
    ).toThrow(ExclaveError);
  });

  it("rejects non-string requestKey on request", () => {
    expect(() =>
      createControlRequestEnvelope({
        requestKey: 123 as never,
        operationKey: "op.test",
        payload: { value: 1 },
      }),
    ).toThrow(ExclaveError);
  });

  it("rejects non-string operationKey on request", () => {
    expect(() =>
      createControlRequestEnvelope({
        requestKey: "req-1",
        operationKey: 456 as never,
        payload: { value: 1 },
      }),
    ).toThrow(ExclaveError);
  });

  it("rejects non-string requestKey on success", () => {
    expect(() =>
      createControlSuccessEnvelope({
        requestKey: null as never,
        payload: { result: 1 },
      }),
    ).toThrow(ExclaveError);
  });

  it("rejects missing failure on failure envelope", () => {
    expect(() =>
      createControlFailureEnvelope({
        requestKey: "req-1",
        failure: undefined as never,
      }),
    ).toThrow(ExclaveError);
  });

  it("rejects null failure on failure envelope", () => {
    expect(() =>
      createControlFailureEnvelope({
        requestKey: "req-1",
        failure: null as never,
      }),
    ).toThrow(ExclaveError);
  });

  it("rejects non-object failure on failure envelope", () => {
    expect(() =>
      createControlFailureEnvelope({
        requestKey: "req-1",
        failure: "not-an-object" as never,
      }),
    ).toThrow(ExclaveError);
  });

  it("rejects non-string failure message", () => {
    expect(() =>
      createControlFailureEnvelope({
        requestKey: "req-1",
        failure: { code: "control.rejected", message: 999 as never },
      }),
    ).toThrow(ExclaveError);
  });

  it("rejects array root failure details", () => {
    expect(() =>
      createControlFailureEnvelope({
        requestKey: "req-1",
        failure: {
          code: "control.rejected",
          message: "fail",
          details: [] as never,
        },
      }),
    ).toThrow(ExclaveError);
  });

  it("createControlRequestEnvelope(null as never) throws ExclaveError with code control-plane.inputRejected", () => {
    try {
      createControlRequestEnvelope(null as never);
      expect.fail("expected throw");
    } catch (e) {
      expect(e).toBeInstanceOf(ExclaveError);
      if (e instanceof ExclaveError) {
        expect(e.code).toBe("control-plane.inputRejected");
      }
    }
  });

  it("createControlRequestEnvelope(class instance as never) throws ExclaveError", () => {
    class FakeInput {
      requestKey = "req-1";
      operationKey = "op.test";
      payload = { x: 1 };
    }
    expect(() => createControlRequestEnvelope(new FakeInput() as never)).toThrow(ExclaveError);
  });

  it("createControlRequestEnvelope(input with getter requestKey) throws ExclaveError without invoking getter", () => {
    let getterCalled = false;
    const input: Record<string, unknown> = {
      operationKey: "op.test",
      payload: { x: 1 },
    };
    Object.defineProperty(input, "requestKey", {
      get() {
        getterCalled = true;
        return "req-1";
      },
      enumerable: true,
      configurable: true,
    });
    expect(() => createControlRequestEnvelope(input as never)).toThrow(ExclaveError);
    expect(getterCalled).toBe(false);
  });

  it("createControlSuccessEnvelope(null as never) throws ExclaveError", () => {
    expect(() => createControlSuccessEnvelope(null as never)).toThrow(ExclaveError);
  });

  it("createControlFailureEnvelope(null as never) throws ExclaveError", () => {
    expect(() => createControlFailureEnvelope(null as never)).toThrow(ExclaveError);
  });

  it("createControlFailureEnvelope(input with getter failure) throws ExclaveError without invoking getter", () => {
    let getterCalled = false;
    const input: Record<string, unknown> = {
      requestKey: "req-1",
    };
    Object.defineProperty(input, "failure", {
      get() {
        getterCalled = true;
        return { code: "control.rejected", message: "bad" };
      },
      enumerable: true,
      configurable: true,
    });
    expect(() => createControlFailureEnvelope(input as never)).toThrow(ExclaveError);
    expect(getterCalled).toBe(false);
  });

  it("createControlRequestEnvelope(revokedProxy as never) throws ExclaveError with code control-plane.inputRejected", () => {
    const proxy = makeRevokedProxy({ requestKey: "req-1", operationKey: "op.test", payload: {} });
    try {
      createControlRequestEnvelope(proxy as never);
      expect.fail("expected throw");
    } catch (e) {
      expect(e).toBeInstanceOf(ExclaveError);
      if (e instanceof ExclaveError) {
        expect(e.code).toBe("control-plane.inputRejected");
      }
    }
  });

  it("createControlSuccessEnvelope(revokedProxy as never) throws ExclaveError with code control-plane.inputRejected", () => {
    const proxy = makeRevokedProxy({ requestKey: "req-1", payload: {} });
    try {
      createControlSuccessEnvelope(proxy as never);
      expect.fail("expected throw");
    } catch (e) {
      expect(e).toBeInstanceOf(ExclaveError);
      if (e instanceof ExclaveError) {
        expect(e.code).toBe("control-plane.inputRejected");
      }
    }
  });

  it("createControlFailureEnvelope(revokedProxy as never) throws ExclaveError with code control-plane.inputRejected", () => {
    const proxy = makeRevokedProxy({
      requestKey: "req-1",
      failure: { code: "control.rejected", message: "bad" },
    });
    try {
      createControlFailureEnvelope(proxy as never);
      expect.fail("expected throw");
    } catch (e) {
      expect(e).toBeInstanceOf(ExclaveError);
      if (e instanceof ExclaveError) {
        expect(e.code).toBe("control-plane.inputRejected");
      }
    }
  });

  it("createControlFailureEnvelope rejects failure.code getter without invoking getter", () => {
    let getterCalled = false;
    const failure: Record<string, unknown> = { message: "bad" };
    Object.defineProperty(failure, "code", {
      get() {
        getterCalled = true;
        return "control.rejected";
      },
      enumerable: true,
      configurable: true,
    });
    expect(() =>
      createControlFailureEnvelope({
        requestKey: "req-1",
        failure: failure as never,
      }),
    ).toThrow(ExclaveError);
    expect(getterCalled).toBe(false);
  });

  it("createControlFailureEnvelope rejects failure.message getter without invoking getter", () => {
    let getterCalled = false;
    const failure: Record<string, unknown> = { code: "control.rejected" };
    Object.defineProperty(failure, "message", {
      get() {
        getterCalled = true;
        return "bad";
      },
      enumerable: true,
      configurable: true,
    });
    expect(() =>
      createControlFailureEnvelope({
        requestKey: "req-1",
        failure: failure as never,
      }),
    ).toThrow(ExclaveError);
    expect(getterCalled).toBe(false);
  });

  it("createControlFailureEnvelope rejects failure.details getter without invoking getter", () => {
    let getterCalled = false;
    const failure: Record<string, unknown> = {
      code: "control.rejected",
      message: "bad",
    };
    Object.defineProperty(failure, "details", {
      get() {
        getterCalled = true;
        return { x: 1 };
      },
      enumerable: true,
      configurable: true,
    });
    expect(() =>
      createControlFailureEnvelope({
        requestKey: "req-1",
        failure: failure as never,
      }),
    ).toThrow(ExclaveError);
    expect(getterCalled).toBe(false);
  });

  it("createControlFailureEnvelope rejects symbol key on failure", () => {
    const failure: Record<string, unknown> = {
      code: "control.rejected",
      message: "bad",
    };
    (failure as Record<symbol, unknown>)[Symbol("s")] = "x";
    expect(() =>
      createControlFailureEnvelope({
        requestKey: "req-1",
        failure: failure as never,
      }),
    ).toThrow(ExclaveError);
  });

  it("createControlFailureEnvelope rejects non-enumerable property on failure", () => {
    const failure: Record<string, unknown> = {
      code: "control.rejected",
      message: "bad",
    };
    Object.defineProperty(failure, "hidden", {
      value: "secret",
      enumerable: false,
      writable: true,
      configurable: true,
    });
    expect(() =>
      createControlFailureEnvelope({
        requestKey: "req-1",
        failure: failure as never,
      }),
    ).toThrow(ExclaveError);
  });

  it("createControlFailureEnvelope rejects hostile Proxy failure with ExclaveError, not raw TypeError", () => {
    const failureProxy = makeRevokedProxy({ code: "control.rejected", message: "bad" });
    try {
      createControlFailureEnvelope({
        requestKey: "req-1",
        failure: failureProxy as never,
      });
      expect.fail("expected throw");
    } catch (e) {
      expect(e).toBeInstanceOf(ExclaveError);
      if (e instanceof ExclaveError) {
        expect(e.code).toBe("control-plane.inputRejected");
      }
    }
  });

  it("createControlRequestEnvelope rejects extra factory input field", () => {
    expect(() =>
      createControlRequestEnvelope({
        requestKey: "req-1",
        operationKey: "op.test",
        payload: {},
        extraField: "should-not-exist",
      } as never),
    ).toThrow(ExclaveError);
  });

  it("createControlRequestEnvelope returns exact owned keys", () => {
    const envelope = createControlRequestEnvelope({
      requestKey: "req-1",
      operationKey: "op.test",
      payload: { x: 1 },
    });
    expect(Object.keys(envelope).sort()).toEqual([
      "envelopeVersion",
      "kind",
      "operationKey",
      "payload",
      "requestKey",
    ]);
  });

  it("createControlSuccessEnvelope rejects extra factory input field", () => {
    expect(() =>
      createControlSuccessEnvelope({
        requestKey: "req-1",
        payload: {},
        extraField: "should-not-exist",
      } as never),
    ).toThrow(ExclaveError);
  });

  it("createControlSuccessEnvelope returns exact owned keys", () => {
    const envelope = createControlSuccessEnvelope({
      requestKey: "req-1",
      payload: { x: 1 },
    });
    expect(Object.keys(envelope).sort()).toEqual([
      "envelopeVersion",
      "kind",
      "ok",
      "payload",
      "requestKey",
    ]);
  });

  it("createControlFailureEnvelope rejects extra failure field", () => {
    expect(() =>
      createControlFailureEnvelope({
        requestKey: "req-1",
        failure: {
          code: "control.rejected",
          message: "bad",
          hiddenProtocolState: "should-not-exist",
        } as never,
      }),
    ).toThrow(ExclaveError);
  });

  it("createControlFailureEnvelope returns normalized failure object and does not preserve extra fields", () => {
    const inputFailure = {
      code: "control.rejected" as const,
      message: "bad",
      details: { x: 1 },
    };
    const envelope = createControlFailureEnvelope({
      requestKey: "req-1",
      failure: inputFailure,
    });
    expect(envelope.failure).not.toBe(inputFailure);
    if (!envelope.ok) {
      expect(envelope.failure).toEqual({
        code: "control.rejected",
        message: "bad",
        details: { x: 1 },
      });
      expect(Object.keys(envelope.failure).sort()).toEqual(["code", "details", "message"]);
    }
  });

  it("createControlFailureEnvelope rejects extra top-level factory input field", () => {
    expect(() =>
      createControlFailureEnvelope({
        requestKey: "req-1",
        failure: { code: "control.rejected", message: "bad" },
        extraTopLevel: "should-not-exist",
      } as never),
    ).toThrow(ExclaveError);
  });
});

describe("@exclave/control-plane request validation", () => {
  const validRequest = {
    kind: "control.request",
    envelopeVersion: 1,
    requestKey: "req-1",
    operationKey: "op.test",
    payload: { x: 1 },
  };

  it("accepts valid request", () => {
    const result = validateControlRequestEnvelope(validRequest);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.requestKey).toBe("req-1");
    expect(result.value.operationKey).toBe("op.test");
    expect(result.value.payload).toEqual({ x: 1 });
  });

  it("rejects wrong kind", () => {
    const result = validateControlRequestEnvelope({ ...validRequest, kind: "control.response" });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.failure.code).toBe("control.invalidEnvelope");
  });

  it("rejects wrong envelopeVersion", () => {
    const result = validateControlRequestEnvelope({ ...validRequest, envelopeVersion: 99 });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.failure.code).toBe("control.invalidEnvelope");
  });

  it("rejects empty requestKey", () => {
    const result = validateControlRequestEnvelope({ ...validRequest, requestKey: "" });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.failure.code).toBe("control.invalidEnvelope");
  });

  it("rejects empty operationKey", () => {
    const result = validateControlRequestEnvelope({ ...validRequest, operationKey: "" });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.failure.code).toBe("control.invalidEnvelope");
  });

  it("rejects BigInt payload values", () => {
    const result = validateControlRequestEnvelope({
      ...validRequest,
      payload: { x: 1n },
    });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.failure.code).toBe("control.invalidEnvelope");
  });

  it("rejects Date, Map, Set, class instances, functions, symbols, undefined, and cycles", () => {
    const cases: [string, unknown][] = [
      ["Date", { value: new Date() }],
      ["Map", { value: new Map() }],
      ["Set", { value: new Set() }],
      ["class instance", { value: new (class {})() }],
      ["function", { value: () => 1 }],
      ["symbol", { value: Symbol("a") }],
      ["undefined", { val: undefined }],
    ];

    for (const [_label, payload] of cases) {
      const result = validateControlRequestEnvelope({
        ...validRequest,
        payload,
      });
      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.failure.code).toBe("control.invalidEnvelope");
      }
    }
  });

  it("rejects cyclic payload", () => {
    const cyclic: Record<string, unknown> = { x: 1 };
    cyclic.self = cyclic;
    const result = validateControlRequestEnvelope({
      ...validRequest,
      payload: cyclic,
    });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.failure.code).toBe("control.invalidEnvelope");
  });

  it("rejects non-plain object envelope root (class instance) without throwing", () => {
    class RequestEnvelope {
      kind = "control.request";
      envelopeVersion = 1;
      requestKey = "req-1";
      operationKey = "op.test";
      payload = { x: 1 };
    }
    expect(() => {
      const result = validateControlRequestEnvelope(new RequestEnvelope());
      expect(result.ok).toBe(false);
    }).not.toThrow();
  });

  it("rejects array as envelope root without throwing", () => {
    expect(() => {
      const result = validateControlRequestEnvelope([]);
      expect(result.ok).toBe(false);
    }).not.toThrow();
  });

  it("validateControlRequestEnvelope rejects hostile Proxy root without throwing", () => {
    const target = {
      kind: "control.request",
      envelopeVersion: 1,
      requestKey: "req-1",
      operationKey: "op.test",
      payload: { x: 1 },
    };
    const proxy = new Proxy(target, {
      getPrototypeOf() {
        throw new Error("trap explosion");
      },
    });
    expect(() => {
      const result = validateControlRequestEnvelope(proxy);
      expect(result.ok).toBe(false);
    }).not.toThrow();
  });

  it("validateControlRequestEnvelope rejects revoked Proxy root without throwing", () => {
    const target = {
      kind: "control.request",
      envelopeVersion: 1,
      requestKey: "req-1",
      operationKey: "op.test",
      payload: { x: 1 },
    };
    const proxy = makeRevokedProxy(target);
    let threw = false;
    try {
      const result = validateControlRequestEnvelope(proxy);
      expect(result.ok).toBe(false);
    } catch {
      threw = true;
    }
    expect(threw).toBe(false);
  });

  it("request envelope root with getter kind rejects without invoking getter", () => {
    let getterCalled = false;
    const obj: Record<string, unknown> = {
      envelopeVersion: 1,
      requestKey: "req-1",
      operationKey: "op.test",
      payload: { x: 1 },
    };
    Object.defineProperty(obj, "kind", {
      get() {
        getterCalled = true;
        return "control.request";
      },
      enumerable: true,
      configurable: true,
    });
    const result = validateControlRequestEnvelope(obj);
    expect(result.ok).toBe(false);
    expect(getterCalled).toBe(false);
  });

  it("request envelope root with symbol key rejects", () => {
    const obj: Record<string, unknown> = {
      kind: "control.request",
      envelopeVersion: 1,
      requestKey: "req-1",
      operationKey: "op.test",
      payload: { x: 1 },
    };
    (obj as Record<symbol, unknown>)[Symbol("s")] = "x";
    const result = validateControlRequestEnvelope(obj as never);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.failure.code).toBe("control.invalidEnvelope");
    }
  });

  it("validateControlRequestEnvelope rejects extra root field", () => {
    const result = validateControlRequestEnvelope({
      ...validRequest,
      extraEnvelopeState: "not-owned",
    });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.failure.code).toBe("control.invalidEnvelope");
      expect(result.failure.message).toContain("Unexpected field");
    }
  });
});

describe("@exclave/control-plane response validation", () => {
  it("accepts success response", () => {
    const result = validateControlResponseEnvelope({
      kind: "control.response",
      envelopeVersion: 1,
      requestKey: "req-1",
      ok: true,
      payload: { result: "done" },
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.kind).toBe("control.response");
    expect(result.value.ok).toBe(true);
    if (result.value.ok) {
      expect(result.value.payload).toEqual({ result: "done" });
    }
  });

  it("accepts failure response", () => {
    const result = validateControlResponseEnvelope({
      kind: "control.response",
      envelopeVersion: 1,
      requestKey: "req-1",
      ok: false,
      failure: { code: "control.rejected", message: "nope" },
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.kind).toBe("control.response");
    expect(result.value.ok).toBe(false);
    if (!result.value.ok) {
      expect(result.value.failure.code).toBe("control.rejected");
    }
  });

  it("rejects invalid failure details", () => {
    const result = validateControlResponseEnvelope({
      kind: "control.response",
      envelopeVersion: 1,
      requestKey: "req-1",
      ok: false,
      failure: { code: "control.rejected", message: "nope", details: { x: 1n } },
    });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.failure.code).toBe("control.invalidEnvelope");
  });

  it("ok false with missing failure does not throw", () => {
    expect(() => {
      const result = validateControlResponseEnvelope({
        kind: "control.response",
        envelopeVersion: 1,
        requestKey: "req-1",
        ok: false,
      });
      expect(result.ok).toBe(false);
    }).not.toThrow();
  });

  it("ok false with null failure does not throw", () => {
    expect(() => {
      const result = validateControlResponseEnvelope({
        kind: "control.response",
        envelopeVersion: 1,
        requestKey: "req-1",
        ok: false,
        failure: null,
      });
      expect(result.ok).toBe(false);
    }).not.toThrow();
  });

  it("ok false with primitive failure does not throw", () => {
    expect(() => {
      const result = validateControlResponseEnvelope({
        kind: "control.response",
        envelopeVersion: 1,
        requestKey: "req-1",
        ok: false,
        failure: "just a string",
      });
      expect(result.ok).toBe(false);
    }).not.toThrow();
  });

  it("ok false with array failure does not throw", () => {
    expect(() => {
      const result = validateControlResponseEnvelope({
        kind: "control.response",
        envelopeVersion: 1,
        requestKey: "req-1",
        ok: false,
        failure: ["not", "an", "object"],
      });
      expect(result.ok).toBe(false);
    }).not.toThrow();
  });

  it("ok false with failure.message missing does not throw", () => {
    expect(() => {
      const result = validateControlResponseEnvelope({
        kind: "control.response",
        envelopeVersion: 1,
        requestKey: "req-1",
        ok: false,
        failure: { code: "control.rejected" },
      });
      expect(result.ok).toBe(false);
    }).not.toThrow();
  });

  it("ok false with failure.message non-string does not throw", () => {
    expect(() => {
      const result = validateControlResponseEnvelope({
        kind: "control.response",
        envelopeVersion: 1,
        requestKey: "req-1",
        ok: false,
        failure: { code: "control.rejected", message: 42 },
      });
      expect(result.ok).toBe(false);
    }).not.toThrow();
  });

  it("invalid failure details does not throw", () => {
    expect(() => {
      const result = validateControlResponseEnvelope({
        kind: "control.response",
        envelopeVersion: 1,
        requestKey: "req-1",
        ok: false,
        failure: { code: "control.rejected", message: "nope", details: "not-an-object" },
      });
      expect(result.ok).toBe(false);
    }).not.toThrow();
  });

  it("rejects non-plain object envelope root (class instance) without throwing", () => {
    class ResponseEnvelope {
      kind = "control.response";
      envelopeVersion = 1;
      requestKey = "req-1";
      ok = true;
      payload = { x: 1 };
    }
    expect(() => {
      const result = validateControlResponseEnvelope(new ResponseEnvelope());
      expect(result.ok).toBe(false);
    }).not.toThrow();
  });

  it("validateControlResponseEnvelope rejects hostile Proxy root without throwing", () => {
    const target = {
      kind: "control.response",
      envelopeVersion: 1,
      requestKey: "req-1",
      ok: true,
      payload: { x: 1 },
    };
    const proxy = new Proxy(target, {
      getPrototypeOf() {
        throw new Error("trap explosion");
      },
    });
    expect(() => {
      const result = validateControlResponseEnvelope(proxy);
      expect(result.ok).toBe(false);
    }).not.toThrow();
  });

  it("validateControlResponseEnvelope rejects revoked Proxy root without throwing", () => {
    const target = {
      kind: "control.response",
      envelopeVersion: 1,
      requestKey: "req-1",
      ok: true,
      payload: { x: 1 },
    };
    const proxy = makeRevokedProxy(target);
    let threw = false;
    try {
      const result = validateControlResponseEnvelope(proxy);
      expect(result.ok).toBe(false);
    } catch {
      threw = true;
    }
    expect(threw).toBe(false);
  });

  it("response envelope root with getter ok rejects without invoking getter", () => {
    let getterCalled = false;
    const obj: Record<string, unknown> = {
      kind: "control.response",
      envelopeVersion: 1,
      requestKey: "req-1",
      payload: { x: 1 },
    };
    Object.defineProperty(obj, "ok", {
      get() {
        getterCalled = true;
        return true;
      },
      enumerable: true,
      configurable: true,
    });
    const result = validateControlResponseEnvelope(obj);
    expect(result.ok).toBe(false);
    expect(getterCalled).toBe(false);
  });

  it("response envelope root with non-enumerable property rejects", () => {
    const obj: Record<string, unknown> = {
      kind: "control.response",
      envelopeVersion: 1,
      requestKey: "req-1",
      ok: true,
      payload: { x: 1 },
    };
    Object.defineProperty(obj, "hidden", {
      value: "secret",
      enumerable: false,
      writable: true,
      configurable: true,
    });
    const result = validateControlResponseEnvelope(obj);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.failure.code).toBe("control.invalidEnvelope");
    }
  });

  it("ok false with class instance failure rejects", () => {
    class FakeFailure {
      code = "control.rejected";
      message = "bad";
    }
    const result = validateControlResponseEnvelope({
      kind: "control.response",
      envelopeVersion: 1,
      requestKey: "req-1",
      ok: false,
      failure: new FakeFailure(),
    });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.failure.code).toBe("control.invalidEnvelope");
    }
  });

  it("ok false with failure.code getter rejects without invoking getter", () => {
    let getterCalled = false;
    const failure: Record<string, unknown> = { message: "bad" };
    Object.defineProperty(failure, "code", {
      get() {
        getterCalled = true;
        return "control.rejected";
      },
      enumerable: true,
      configurable: true,
    });
    const result = validateControlResponseEnvelope({
      kind: "control.response",
      envelopeVersion: 1,
      requestKey: "req-1",
      ok: false,
      failure,
    });
    expect(result.ok).toBe(false);
    expect(getterCalled).toBe(false);
  });

  it("ok false with symbol key on failure rejects", () => {
    const failure: Record<string, unknown> = {
      code: "control.rejected",
      message: "bad",
    };
    (failure as Record<symbol, unknown>)[Symbol("s")] = "x";
    const result = validateControlResponseEnvelope({
      kind: "control.response",
      envelopeVersion: 1,
      requestKey: "req-1",
      ok: false,
      failure,
    });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.failure.code).toBe("control.invalidEnvelope");
    }
  });

  it("ok false with non-enumerable property on failure rejects", () => {
    const failure: Record<string, unknown> = {
      code: "control.rejected",
      message: "bad",
    };
    Object.defineProperty(failure, "hidden", {
      value: "secret",
      enumerable: false,
      writable: true,
      configurable: true,
    });
    const result = validateControlResponseEnvelope({
      kind: "control.response",
      envelopeVersion: 1,
      requestKey: "req-1",
      ok: false,
      failure,
    });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.failure.code).toBe("control.invalidEnvelope");
    }
  });

  it("validateControlResponseEnvelope rejects extra success response root field", () => {
    const result = validateControlResponseEnvelope({
      kind: "control.response",
      envelopeVersion: 1,
      requestKey: "req-1",
      ok: true,
      payload: { x: 1 },
      extraEnvelopeState: "not-owned",
    });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.failure.code).toBe("control.invalidEnvelope");
      expect(result.failure.message).toContain("Unexpected field");
    }
  });

  it("validateControlResponseEnvelope rejects symbol success response root field", () => {
    const obj: Record<string, unknown> = {
      kind: "control.response",
      envelopeVersion: 1,
      requestKey: "req-1",
      ok: true,
      payload: { x: 1 },
    };
    (obj as Record<symbol, unknown>)[Symbol("s")] = "x";
    const result = validateControlResponseEnvelope(obj as never);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.failure.code).toBe("control.invalidEnvelope");
    }
  });

  it("validateControlResponseEnvelope rejects extra failure response root field", () => {
    const result = validateControlResponseEnvelope({
      kind: "control.response",
      envelopeVersion: 1,
      requestKey: "req-1",
      ok: false,
      failure: { code: "control.rejected", message: "no" },
      extraEnvelopeState: "not-owned",
    });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.failure.code).toBe("control.invalidEnvelope");
      expect(result.failure.message).toContain("Unexpected field");
    }
  });

  it("validateControlResponseEnvelope rejects symbol failure response root field", () => {
    const obj: Record<string, unknown> = {
      kind: "control.response",
      envelopeVersion: 1,
      requestKey: "req-1",
      ok: false,
      failure: { code: "control.rejected", message: "no" },
    };
    (obj as Record<symbol, unknown>)[Symbol("s")] = "x";
    const result = validateControlResponseEnvelope(obj as never);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.failure.code).toBe("control.invalidEnvelope");
    }
  });

  it("validateControlResponseEnvelope rejects extra failure field", () => {
    const result = validateControlResponseEnvelope({
      kind: "control.response",
      envelopeVersion: 1,
      requestKey: "req-1",
      ok: false,
      failure: {
        code: "control.rejected",
        message: "no",
        extraFailureState: "not-owned",
      },
    });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.failure.code).toBe("control.invalidEnvelope");
      expect(result.failure.message).toContain("Unexpected field");
    }
  });

  it("validateControlResponseEnvelope accepts failure with code, message, and optional details only", () => {
    const result = validateControlResponseEnvelope({
      kind: "control.response",
      envelopeVersion: 1,
      requestKey: "req-1",
      ok: false,
      failure: { code: "control.rejected", message: "no", details: { x: 1 } },
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    if (!result.value.ok) {
      expect(result.value.failure.code).toBe("control.rejected");
      expect(result.value.failure.message).toBe("no");
      expect((result.value.failure as Record<string, unknown>).details).toEqual({ x: 1 });
      expect(Object.keys(result.value.failure as Record<string, unknown>).sort()).toEqual([
        "code",
        "details",
        "message",
      ]);
    }
  });

  it("request payload may contain arbitrary JSON-safe keys", () => {
    const result = validateControlRequestEnvelope({
      kind: "control.request",
      envelopeVersion: 1,
      requestKey: "req-1",
      operationKey: "op.test",
      payload: { a: 1, b: "hello", c: true, d: null, e: { nested: [1, 2] } },
    });
    expect(result.ok).toBe(true);
  });

  it("success payload may contain arbitrary JSON-safe keys", () => {
    const result = validateControlResponseEnvelope({
      kind: "control.response",
      envelopeVersion: 1,
      requestKey: "req-1",
      ok: true,
      payload: { a: 1, b: "hello", c: true, d: null, e: { nested: [1, 2] } },
    });
    expect(result.ok).toBe(true);
  });

  it("failure details may contain arbitrary JSON-safe keys", () => {
    const result = validateControlResponseEnvelope({
      kind: "control.response",
      envelopeVersion: 1,
      requestKey: "req-1",
      ok: false,
      failure: {
        code: "control.rejected",
        message: "no",
        details: { a: 1, b: "hello", c: true, d: null, e: { extra: "ok" } },
      },
    });
    expect(result.ok).toBe(true);
  });
});

describe("@exclave/control-plane error code shape", () => {
  it("thrown factory errors have name ExclaveError", () => {
    try {
      createControlRequestEnvelope({
        requestKey: 123 as never,
        operationKey: "op.test",
        payload: {},
      });
    } catch (e) {
      expect(e).toBeInstanceOf(ExclaveError);
      if (e instanceof ExclaveError) {
        expect(e.name).toBe("ExclaveError");
      }
    }
  });

  it("thrown factory errors have code control-plane.inputRejected", () => {
    try {
      createControlRequestEnvelope({
        requestKey: "",
        operationKey: "op.test",
        payload: { value: 1 },
      });
    } catch (e) {
      expect(e).toBeInstanceOf(ExclaveError);
      if (e instanceof ExclaveError) {
        expect(e.code).toBe("control-plane.inputRejected");
      }
    }
  });

  it("thrown factory errors have boundarySafe true", () => {
    try {
      createControlRequestEnvelope({
        requestKey: "",
        operationKey: "op.test",
        payload: { value: 1 },
      });
    } catch (e) {
      expect(e).toBeInstanceOf(ExclaveError);
      if (e instanceof ExclaveError) {
        expect(e.meta.boundarySafe).toBe(true);
      }
    }
  });
});

describe("@exclave/control-plane request-response correlation", () => {
  const request: ControlRequestEnvelope = {
    kind: "control.request",
    envelopeVersion: 1,
    requestKey: "req-1",
    operationKey: "op.test",
    payload: {},
  };

  it("accepts matching requestKey", () => {
    const response = createControlSuccessEnvelope({
      requestKey: "req-1",
      payload: {},
    });
    const result = validateControlResponseForRequest(request, response);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.requestKey).toBe("req-1");
  });

  it("rejects mismatched requestKey with code control.invalidEnvelope and does not throw", () => {
    const response = createControlSuccessEnvelope({
      requestKey: "req-other",
      payload: {},
    });
    expect(() => {
      const result = validateControlResponseForRequest(request, response);
      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.failure.code).toBe("control.invalidEnvelope");
      }
    }).not.toThrow();
  });
});

describe("@exclave/control-plane mutation safety", () => {
  it("does not mutate input payloads during creation", () => {
    const payload: Record<string, unknown> = { a: 1, b: { c: 2 } };
    const original = { a: 1, b: { c: 2 } };
    createControlRequestEnvelope({
      requestKey: "req-1",
      operationKey: "op.test",
      payload,
    });
    expect(payload).toEqual(original);
  });
});

describe("@exclave/control-plane public exports", () => {
  it("exports the exact intended surface", () => {
    expect(Object.keys(controlPlane).sort()).toEqual([
      "CONTROL_ENVELOPE_VERSION",
      "createBindingInvalidControlFailure",
      "createControlFailureEnvelope",
      "createControlRequestEnvelope",
      "createControlSuccessEnvelope",
      "validateControlRequestEnvelope",
      "validateControlResponseEnvelope",
      "validateControlResponseForRequest",
    ]);
  });

  it("exports the intended type surface", () => {
    expectTypeOf<controlPlane.ControlEnvelopeVersion>().toEqualTypeOf<1>();
    expectTypeOf<controlPlane.ControlRequestKey>().toEqualTypeOf<string>();
    expectTypeOf<controlPlane.ControlOperationKey>().toEqualTypeOf<string>();
    expectTypeOf<controlPlane.ControlFailureCode>().toEqualTypeOf<
      | "control.unsupportedOperation"
      | "control.invalidEnvelope"
      | "control.rejected"
      | "control.bindingInvalid"
    >();
    expectTypeOf<controlPlane.ControlValidationResult<number>>().toEqualTypeOf<
      | { readonly ok: true; readonly value: number }
      | { readonly ok: false; readonly failure: controlPlane.ControlFailure }
    >();
  });
});
