import { assertNever } from "./source.mts";

export type GeneratedHotScalarTypeV0 = "bool" | "f32" | "f64" | "u32" | "u64";

export function isGeneratedHotScalarTypeV0(value: unknown): value is GeneratedHotScalarTypeV0 {
  return (
    value === "bool" || value === "f32" || value === "f64" || value === "u32" || value === "u64"
  );
}

export function scalarByteWidth(type: GeneratedHotScalarTypeV0): number {
  switch (type) {
    case "bool":
      return 1;
    case "f32":
    case "u32":
      return 4;
    case "f64":
    case "u64":
      return 8;
    default:
      return assertNever(type, "generated hot scalar type is not supported");
  }
}

export function scalarTypeSource(type: GeneratedHotScalarTypeV0): string {
  switch (type) {
    case "bool":
      return "boolean";
    case "f32":
    case "f64":
    case "u32":
      return "number";
    case "u64":
      return "bigint";
    default:
      return assertNever(type, "generated hot scalar type is not supported");
  }
}
