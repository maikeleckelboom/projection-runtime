export function isFieldName(value: unknown): value is string {
  return typeof value === "string" && /^[a-z][a-zA-Z0-9]*$/.test(value);
}

export function isSafeGeneratedPropertyName(value: string): boolean {
  return (
    isFieldName(value) &&
    !typescriptReservedWords.has(value) &&
    !unsafeGeneratedPropertyNames.has(value)
  );
}

export function isSafeFixtureName(value: string): boolean {
  return /^[a-z][a-z0-9]*(?:-[a-z0-9]+)*$/.test(value);
}

export function isSafeSymbolStem(value: string): boolean {
  return /^[A-Z][a-zA-Z0-9]*$/.test(value) && !typescriptReservedWords.has(value);
}

export function toPascalCase(value: string): string {
  return `${value.charAt(0).toUpperCase()}${value.slice(1)}`;
}

export function toConstantStem(value: string): string {
  return value.replace(/([a-z0-9])([A-Z])/g, "$1_$2").toUpperCase();
}

export const unsafeGeneratedPropertyNames = new Set([
  "__proto__",
  "constructor",
  "hasOwnProperty",
  "prototype",
  "toString",
  "valueOf",
]);

export const typescriptReservedWords = new Set([
  "any",
  "as",
  "async",
  "await",
  "bigint",
  "boolean",
  "break",
  "case",
  "catch",
  "class",
  "const",
  "constructor",
  "continue",
  "debugger",
  "declare",
  "default",
  "delete",
  "do",
  "else",
  "enum",
  "export",
  "extends",
  "false",
  "finally",
  "for",
  "from",
  "function",
  "get",
  "if",
  "implements",
  "import",
  "in",
  "infer",
  "instanceof",
  "interface",
  "keyof",
  "let",
  "module",
  "namespace",
  "never",
  "new",
  "null",
  "number",
  "object",
  "of",
  "package",
  "private",
  "protected",
  "public",
  "readonly",
  "require",
  "return",
  "set",
  "static",
  "string",
  "super",
  "switch",
  "symbol",
  "this",
  "throw",
  "true",
  "try",
  "type",
  "typeof",
  "undefined",
  "unique",
  "unknown",
  "var",
  "void",
  "while",
  "with",
  "yield",
]);
