import type { JsonValue } from "@exclave/base";

export type JsonSafetyResult =
  | { readonly ok: true; readonly value: JsonValue }
  | { readonly ok: false; readonly reason: string };

export function safeIsArray(
  value: unknown,
): { ok: true; isArray: boolean } | { ok: false; reason: string } {
  try {
    return { ok: true, isArray: Array.isArray(value) };
  } catch {
    return { ok: false, reason: "Object inspection threw (isArray)" };
  }
}

function safeGetPrototypeOf(
  value: object,
): { ok: true; proto: object | null } | { ok: false; reason: string } {
  try {
    return { ok: true, proto: Object.getPrototypeOf(value) };
  } catch {
    return { ok: false, reason: "Object inspection threw (getPrototypeOf)" };
  }
}

function safeOwnKeys(
  value: object,
): { ok: true; keys: (string | symbol)[] } | { ok: false; reason: string } {
  try {
    return { ok: true, keys: Reflect.ownKeys(value) };
  } catch {
    return { ok: false, reason: "Object inspection threw (ownKeys)" };
  }
}

function safeGetOwnPropertyDescriptor(
  value: object,
  key: string | symbol,
): { ok: true; desc: PropertyDescriptor | undefined } | { ok: false; reason: string } {
  try {
    return { ok: true, desc: Object.getOwnPropertyDescriptor(value, key) };
  } catch {
    return { ok: false, reason: "Object inspection threw (getOwnPropertyDescriptor)" };
  }
}

function checkJsonArraySafe(arr: unknown[], stack: object[]): JsonSafetyResult {
  if (stack.includes(arr)) {
    return { ok: false, reason: "Cyclic structures are not JSON-safe" };
  }
  stack.push(arr);

  const keysResult = safeOwnKeys(arr);
  if (!keysResult.ok) {
    stack.pop();
    return keysResult;
  }

  const lengthDescResult = safeGetOwnPropertyDescriptor(arr, "length");
  if (!lengthDescResult.ok) {
    stack.pop();
    return lengthDescResult;
  }

  const lengthDesc = lengthDescResult.desc;
  if (lengthDesc === undefined || lengthDesc.get !== undefined || lengthDesc.set !== undefined) {
    stack.pop();
    return { ok: false, reason: "Array length descriptor is invalid" };
  }

  const length = lengthDesc.value;
  if (typeof length !== "number" || !Number.isInteger(length) || length < 0) {
    stack.pop();
    return { ok: false, reason: "Array length is invalid" };
  }

  const seenIndices = new Set<string>();

  for (const key of keysResult.keys) {
    if (typeof key === "symbol") {
      stack.pop();
      return { ok: false, reason: "Symbol keys are not allowed on arrays" };
    }

    if (key === "length") continue;

    const index = Number(key);
    if (!Number.isInteger(index) || index < 0 || String(index) !== key) {
      stack.pop();
      return { ok: false, reason: "Arrays must not have non-index properties" };
    }

    if (index >= length) {
      stack.pop();
      return { ok: false, reason: "Arrays must not have indices beyond length" };
    }

    const descResult = safeGetOwnPropertyDescriptor(arr, key);
    if (!descResult.ok) {
      stack.pop();
      return descResult;
    }

    const desc = descResult.desc;
    if (desc === undefined) {
      stack.pop();
      return { ok: false, reason: "Sparse arrays are not allowed (missing index descriptor)" };
    }

    if (!desc.enumerable) {
      stack.pop();
      return { ok: false, reason: "Non-enumerable array indices are not allowed" };
    }

    if (desc.get !== undefined || desc.set !== undefined) {
      stack.pop();
      return { ok: false, reason: "Accessor properties are not allowed on arrays" };
    }

    const valResult = checkJsonSafe(desc.value, stack);
    if (!valResult.ok) {
      stack.pop();
      return valResult;
    }

    seenIndices.add(key);
  }

  for (let i = 0; i < length; i++) {
    if (!seenIndices.has(String(i))) {
      stack.pop();
      return { ok: false, reason: "Sparse arrays are not allowed (missing index)" };
    }
  }

  stack.pop();
  return { ok: true, value: arr as JsonValue };
}

export function checkJsonSafe(value: unknown, stack?: object[]): JsonSafetyResult {
  if (value === null || typeof value === "string" || typeof value === "boolean") {
    return { ok: true, value: value as JsonValue };
  }

  if (typeof value === "number") {
    if (!Number.isFinite(value)) {
      return { ok: false, reason: "NaN, Infinity, and -Infinity are not JSON-safe" };
    }
    return { ok: true, value: value as JsonValue };
  }

  if (typeof value === "bigint") {
    return { ok: false, reason: "BigInt values are not JSON-safe" };
  }

  if (typeof value === "function") {
    return { ok: false, reason: "Function values are not JSON-safe" };
  }

  if (typeof value === "symbol") {
    return { ok: false, reason: "Symbol values are not JSON-safe" };
  }

  if (value === undefined) {
    return { ok: false, reason: "Undefined values are not JSON-safe" };
  }

  const obj = value as object;
  const _stack = stack ?? [];

  const isArrayResult = safeIsArray(obj);
  if (!isArrayResult.ok) {
    return isArrayResult;
  }
  if (isArrayResult.isArray) {
    return checkJsonArraySafe(obj as unknown[], _stack);
  }

  const protoResult = safeGetPrototypeOf(obj);
  if (!protoResult.ok) {
    return protoResult;
  }

  if (protoResult.proto !== null && protoResult.proto !== Object.prototype) {
    return {
      ok: false,
      reason: "Non-plain objects (e.g. Date, Map, Set, class instances) are not JSON-safe",
    };
  }

  if (_stack.includes(obj)) {
    return { ok: false, reason: "Cyclic structures are not JSON-safe" };
  }

  _stack.push(obj);

  const keysResult = safeOwnKeys(obj);
  if (!keysResult.ok) {
    _stack.pop();
    return keysResult;
  }

  for (const key of keysResult.keys) {
    if (typeof key === "symbol") {
      _stack.pop();
      return { ok: false, reason: "Symbol keys are not allowed on objects" };
    }

    const descResult = safeGetOwnPropertyDescriptor(obj, key);
    if (!descResult.ok) {
      _stack.pop();
      return descResult;
    }

    if (descResult.desc === undefined) {
      _stack.pop();
      return { ok: false, reason: "Property descriptor is missing" };
    }

    if (!descResult.desc.enumerable) {
      _stack.pop();
      return { ok: false, reason: "Non-enumerable properties are not JSON-safe" };
    }

    if (descResult.desc.get !== undefined || descResult.desc.set !== undefined) {
      _stack.pop();
      return { ok: false, reason: "Accessor properties are not JSON-safe" };
    }

    const valResult = checkJsonSafe(descResult.desc.value, _stack);
    if (!valResult.ok) {
      _stack.pop();
      return valResult;
    }
  }

  _stack.pop();
  return { ok: true, value: obj as JsonValue };
}

export function checkJsonObjectRoot(value: unknown): JsonSafetyResult {
  if (typeof value !== "object" || value === null) {
    return { ok: false, reason: "Root payload must be a plain object, not a primitive or null" };
  }

  const isArrayResult = safeIsArray(value);
  if (!isArrayResult.ok) {
    return isArrayResult;
  }
  if (isArrayResult.isArray) {
    return { ok: false, reason: "Root payload must be a plain object, not an array" };
  }

  const protoResult = safeGetPrototypeOf(value);
  if (!protoResult.ok) {
    return protoResult;
  }

  if (protoResult.proto !== null && protoResult.proto !== Object.prototype) {
    return {
      ok: false,
      reason: "Root payload must be a plain object, not a class instance or exotic object",
    };
  }

  return checkJsonSafe(value);
}
