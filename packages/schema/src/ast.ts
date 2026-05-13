export type ScalarKind = "f32" | "i32" | "u32" | "bool" | "enum";

export type ArrayKind =
  | "f32.array"
  | "i32.array"
  | "u32.array"
  | "u8.array"
  | "i8.array"
  | "i16.array"
  | "u16.array"
  | "bool.array"
  | "enum.array";

export type ParamKind = ScalarKind | ArrayKind;

export type MeterKind = ScalarKind | "f64" | ArrayKind | "f64.array";

export interface SpecNamespace<Leaf> {
  readonly [key: string]: Leaf | SpecNamespace<Leaf>;
}

export interface NumericRange {
  readonly min?: number;
  readonly max?: number;
}

export type EnumVocabulary = readonly [string, ...string[]];

export type ParamDef =
  | Readonly<{ kind: "f32" } & NumericRange>
  | Readonly<{ kind: "i32" } & NumericRange>
  | Readonly<{ kind: "u32" } & NumericRange>
  | Readonly<{ kind: "bool" }>
  | Readonly<{ kind: "enum"; values: EnumVocabulary }>
  | Readonly<{ kind: Exclude<ArrayKind, "enum.array">; length: number }>
  | Readonly<{ kind: "enum.array"; values: EnumVocabulary; length: number }>;

export type MeterDef =
  | Readonly<{ kind: Exclude<MeterKind, ArrayKind | "enum"> }>
  | Readonly<{ kind: "enum"; values: EnumVocabulary }>
  | Readonly<{
      kind: Exclude<MeterKind, ScalarKind | "f64" | "enum" | "enum.array">;
      length: number;
    }>
  | Readonly<{ kind: "enum.array"; values: EnumVocabulary; length: number }>;

export interface SpecAst {
  readonly $schema?: string;
  readonly id?: string;
  readonly params?: SpecNamespace<ParamDef>;
  readonly meters?: SpecNamespace<MeterDef>;
}
