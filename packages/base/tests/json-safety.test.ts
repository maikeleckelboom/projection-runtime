import { describe, expect, it } from "vitest";
import { checkJsonObjectRoot } from "../src/json-safety";

function makeRevokedProxy<T extends object>(target: T): T {
  const { proxy, revoke } = Proxy.revocable(target, {});
  revoke();
  return proxy;
}

describe("@exclave/base JSON safety", () => {
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
    (arr as unknown as Record<symbol, unknown>)[Symbol("s")] = "x";
    const result = checkJsonObjectRoot({ items: arr });
    expect(result.ok).toBe(false);
  });

  it("rejects nested array with extra string property", () => {
    const arr: unknown[] = [1, 2, 3];
    (arr as unknown as Record<string, unknown>).foo = "bar";
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
