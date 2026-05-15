import type { HotLayoutManifest } from "../manifest";
import { throwByteIssue } from "./issue";
import type { HotFieldScalarValue, HotFieldValue, HotFieldValues } from "./types";

export function assertValueRecord(values: HotFieldValues): void {
  if (values === null || typeof values !== "object" || Array.isArray(values)) {
    throwByteIssue("byte.valuesInvalid", "values", "hot field values must be an object");
  }
}

export function assertNoUnknownValues(manifest: HotLayoutManifest, values: HotFieldValues): void {
  const fieldPaths = new Set(manifest.fields.map((field) => field.dotPath));

  for (const key of Object.keys(values)) {
    if (!fieldPaths.has(key)) {
      throwByteIssue("byte.valueUnknown", `values.${key}`, `unknown hot field value ${key}`);
    }
  }
}

export function requireBoolean(value: HotFieldValue, path: string): boolean {
  if (typeof value === "boolean") {
    return value;
  }

  throwByteIssue("byte.valueInvalid", path, "bool value must be a boolean");
}

export function requireFiniteNumber(value: HotFieldValue, path: string): number {
  if (typeof value === "number" && Number.isFinite(value)) {
    return value;
  }

  throwByteIssue("byte.valueInvalid", path, "floating scalar value must be a finite number");
}

export function requireInteger(
  value: HotFieldValue,
  path: string,
  min: number,
  max: number,
): number {
  if (typeof value === "number" && Number.isSafeInteger(value) && value >= min && value <= max) {
    return value;
  }

  throwByteIssue("byte.valueOutOfRange", path, `integer value must be in range [${min}, ${max}]`);
}

export function requireBigInt(
  value: HotFieldValue,
  path: string,
  min: bigint,
  max: bigint,
): bigint {
  if (typeof value === "bigint" && value >= min && value <= max) {
    return value;
  }

  throwByteIssue("byte.valueOutOfRange", path, `bigint value must be in range [${min}, ${max}]`);
}

export function requireArray(value: HotFieldValue, path: string): readonly HotFieldScalarValue[] {
  if (Array.isArray(value)) {
    return value;
  }

  throwByteIssue("byte.valueInvalid", path, "field value must be an array");
}
