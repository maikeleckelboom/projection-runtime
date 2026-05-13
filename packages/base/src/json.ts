/**
 * JSON-safe values used by Seqlok error details and envelopes.
 */
export type JsonPrimitive = string | number | boolean | null;

export type JsonArray = readonly JsonValue[];

export interface JsonObject {
  readonly [key: string]: JsonValue;
}

export type JsonValue = JsonPrimitive | JsonArray | JsonObject;
