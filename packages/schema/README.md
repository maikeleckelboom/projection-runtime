# @seqlok/schema

`@seqlok/schema` publishes authored projection contract types and syntactic validation for Seqlok.

This package owns the authored projection contract syntax: the pre-canonical contract shape that authors write before
compiler normalization. It validates syntactic legality and structural shape, and it publishes the versioned JSON Schema
artifact for contract interchange.

## What Belongs Here

- `AuthoredProjectionContract`, `AuthoredFieldTree`, `AuthoredFieldDef`, and authored field-shape types.
- `AuthoredLaneDeclarations` and lane declaration syntax types.
- `validateAuthoredProjectionContract(...)` for syntax and structural validation before compiler normalization.
- `SchemaValidationError` for structural validation failures.
- `AUTHORED_PROJECTION_CONTRACT_V1_ID`, the `$id` of the published artifact.
- `authored-projection-contract/v1.json`, the versioned JSON Schema artifact.

## What Does Not Belong Here

- Authored contract normalization.
- Canonical manifest emission.
- Lane planning.
- Lane admissibility decisions.
- `semanticVersion`, `hotLayoutVersion`, `warmCodecVersion`, or `coldCodecVersion` derivation.
- Field id derivation, field offset planning, layout decisions, codec legality, or semantic hashing.
- Generated bindings, runtime bindings, generated fixtures, or conformance runners.

Those responsibilities belong to the compiler and lane/conformance packages defined by the projection-runtime specs.

## Structural Validation

`validateAuthoredProjectionContract(...)` checks authored syntax only:

- legal top-level keys
- contract key and field path grammar
- recursive authored field tree shape
- supported authored field-shape kinds
- required properties for each field-shape kind
- enum vocabulary shape
- positive integer bounds for bounded and fixed-size shapes
- lane declaration object shape and known lane declaration strings
- unknown property rejection

It deliberately does not normalize or sort authored field trees. It also does not decide whether a declared hot lane can
carry every field, whether a reserved field is semantically admissible, whether resource bodies can travel on warm, how
field ids are derived, or whether derived versions and manifests are legal.

## JSON Schema Artifact

Current artifact: `@seqlok/schema/authored-projection-contract/v1.json`

Current `$id`: `https://seqlok.dev/schema/authored-projection-contract/v1.json`

`v1` is the authored contract artifact version. It is not a semantic contract version, lane layout version, codec
version, planner version, or compatibility policy.

```ts
import schema from "@seqlok/schema/authored-projection-contract/v1.json";
import { AUTHORED_PROJECTION_CONTRACT_V1_ID } from "@seqlok/schema";

console.assert(schema.$id === AUTHORED_PROJECTION_CONTRACT_V1_ID);
```

## Usage

```ts
import {
  type AuthoredProjectionContract,
  validateAuthoredProjectionContract,
} from "@seqlok/schema";

const contract: AuthoredProjectionContract = {
  key: "deck.runtime",
  family: "replaceable-snapshot",
  fields: {
    transport: {
      tempo: { kind: "fixed-scalar", type: "f64" },
      playing: { kind: "fixed-scalar", type: "bool" },
    },
  },
  lanes: {
    warm: { codec: "framed-snapshot" },
  },
};

validateAuthoredProjectionContract(contract);
```
