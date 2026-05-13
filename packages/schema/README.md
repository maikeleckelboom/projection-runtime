# @seqlok/schema

`@seqlok/schema` publishes the canonical authored spec AST for Seqlok.

It owns authored structure: TypeScript AST types, structural validation,
deterministic authored-layer normalization, the versioned JSON Schema artifact,
and the artifact `$id`.

It does not compile an authored spec into runtime behavior. That boundary belongs
to `@seqlok/core`.

## What Belongs Here

- `SpecAst`, `SpecNamespace`, `ParamDef`, `MeterDef`, and related authored AST
  types.
- `validateSpecAst(...)` for structural validation of authored AST objects.
- `SchemaValidationError` for structural validation failures.
- `normalizeSpecAst(...)` for deterministic authored-layer normalization.
- `SPEC_AST_V1_ID`, the `$id` of the published AST artifact.
- `spec-ast/v1.json`, the versioned JSON Schema artifact for the authored AST.

## What Does Not Belong Here

- Builder DSL sugar.
- `defineSpec(...)`.
- Semantic compilation.
- Runtime namespace flattening.
- Canonical runtime key generation.
- `keysOf(...)`.
- Runtime defaults.
- Runtime identity generation.
- Planning, backing, handoff, or bindings.
- Product semantics or convenience helpers over runtime behavior.

## Structural Validation

`validateSpecAst(...)` checks authored structure only:

- legal top-level keys
- recursive namespace shape
- legal param and meter leaf kinds
- required fields for enum and array leaves
- enum vocabulary shape
- positive integer array lengths
- unknown property rejection

It deliberately does not decide whether `min < max`, whether namespaces collide
after flattening, how runtime defaults are filled, whether a runtime plan is
legal, or whether two compiled contracts are compatible.

## Authored Normalization

`normalizeSpecAst(...)` validates the object, then returns a deterministic copy.
It sorts authored object keys, sorts leaf object keys, preserves enum order,
preserves namespace nesting, and omits empty `params` and `meters` planes.

It does not flatten namespaces, fill runtime defaults, generate runtime
identities, compute runtime keys, hash specs, or interpret product meaning.

## JSON Schema Artifact

Current artifact: `@seqlok/schema/spec-ast/v1.json`

Current `$id`: `https://seqlok.dev/schema/spec-ast/v1.json`

`v1` is the authored AST artifact version. It is not a runtime contract version,
planner version, handoff version, or compatibility policy.

```ts
import schema from "@seqlok/schema/spec-ast/v1.json";
import { SPEC_AST_V1_ID } from "@seqlok/schema";

console.assert(schema.$id === SPEC_AST_V1_ID);
```

## Usage

```ts
import { normalizeSpecAst, validateSpecAst, type SpecAst } from "@seqlok/schema";

const spec: SpecAst = {
  id: "transport",
  params: {
    tempo: { kind: "f32", min: 40, max: 240 },
    mode: { kind: "enum", values: ["vinyl", "cdj", "sync"] },
  },
};

validateSpecAst(spec);
const normalized = normalizeSpecAst(spec);
```
