export type ProjectionFamily = "replaceable-snapshot";

export type ContractKey = string;

export type ScalarType =
  | "bool"
  | "u8"
  | "u16"
  | "u32"
  | "u64"
  | "i8"
  | "i16"
  | "i32"
  | "i64"
  | "f32"
  | "f64";

export type EnumStorageType = "u8" | "u16" | "u32";

export type StringEncoding = "utf8" | "ascii";

export interface AuthoredProjectionContract {
  readonly $schema?: string;
  readonly key: ContractKey;
  readonly family: ProjectionFamily;
  readonly fields: AuthoredFieldTree;
  readonly lanes?: AuthoredLaneDeclarations;
  readonly revisionNote?: string;
}

export interface AuthoredFieldTree {
  readonly [segment: string]: AuthoredFieldDef | AuthoredFieldTree;
}

export type AuthoredFieldDef = AuthoredFieldShape;

export type AuthoredFieldShape =
  | AuthoredFixedScalarField
  | AuthoredFixedEnumField
  | AuthoredFixedVectorField
  | AuthoredBoundedArrayField
  | AuthoredBoundedMapField
  | AuthoredVariableMapField
  | AuthoredFixedStringEncodedField
  | AuthoredVariableStringField;

export interface AuthoredFixedScalarField {
  readonly kind: "fixed-scalar";
  readonly type: ScalarType;
  readonly nanSentinel?: true;
}

export interface AuthoredFixedEnumField {
  readonly kind: "fixed-enum";
  readonly variants: readonly [string, ...string[]];
  readonly storage: EnumStorageType;
}

export interface AuthoredFixedVectorField {
  readonly kind: "fixed-vector";
  readonly elementType: ScalarType;
  readonly length: number;
}

export interface AuthoredBoundedArrayField {
  readonly kind: "bounded-array";
  readonly elementType: ScalarType;
  readonly maxLength: number;
  readonly hotReservation?: true;
}

export interface AuthoredBoundedMapField {
  readonly kind: "bounded-map";
  readonly keyEncoding: "fixed-ascii";
  readonly keyByteLength: number;
  readonly valueShape: AuthoredFixedScalarField | AuthoredFixedEnumField | AuthoredFixedVectorField;
  readonly maxEntries: number;
  readonly hotReservation?: true;
}

export interface AuthoredVariableMapField {
  readonly kind: "variable-map";
  readonly valueShape: AuthoredFieldShape;
}

export interface AuthoredFixedStringEncodedField {
  readonly kind: "fixed-string-encoded";
  readonly byteLength: number;
  readonly encoding: StringEncoding;
}

export interface AuthoredVariableStringField {
  readonly kind: "variable-string";
}

export interface AuthoredLaneDeclarations {
  readonly hot?: AuthoredHotLaneDeclaration;
  readonly warm?: AuthoredWarmLaneDeclaration;
  readonly cold?: AuthoredColdLaneDeclaration;
}

export interface AuthoredHotLaneDeclaration {
  readonly reservations?: readonly string[];
}

export interface AuthoredWarmLaneDeclaration {
  readonly codec?: "framed-snapshot";
}

export interface AuthoredColdLaneDeclaration {
  readonly materialization?: "latest-snapshot" | "checkpointed-snapshot";
}
