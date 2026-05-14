# @seqlok/compiler

`@seqlok/compiler` is the build-time compiler for Seqlok authored projection contracts.

It accepts `AuthoredProjectionContract` values from `@seqlok/schema` and emits deterministic canonical projection
manifests plus resolved contract metadata. Schema owns authored syntax and syntactic validation only; this package owns
authored-to-canonical normalization, semantic and cross-cutting legality, field id derivation, lane admissibility, and
`semanticVersion` derivation.

## Scope

The compiler v0 emits:

- one `CanonicalProjectionManifest` per authored projection contract
- lexicographically sorted canonical fields
- canonical field shapes
- deterministic `fieldId` values
- canonical lane declarations
- a `ResolvedProjectionContract` shell with derived `semanticVersion`

The compiler does not own runtime behavior. Runtime packages consume emitted artifacts; they do not plan layout,
derive versions, or reinterpret authored contracts during live operation.

## Boundaries

Compiler v0 does not:

- generate runtime bindings
- implement hot layout planning
- implement warm frame encoding
- ratify or implement a cold codec
- create runtime descriptor instances, live handles, mappings, subscriptions, or adapters

Hot layout, warm codec, cold materialization, generated bindings, conformance fixture emission, and Electron adapter
behavior belong to later packages or later compiler slices.

## Determinism

Fields are flattened from the authored field tree into dot paths, then sorted lexicographically by UTF-8 byte order.
Authored object insertion order does not affect the manifest.

`fieldId` follows the projection spine rule:

```text
fieldId = first_4_bytes_big_endian(SHA-256(contractKey + ":" + dotPath))
```

The compiler checks `fieldId` collisions across all fields in one contract and rejects collisions as compiler errors.

`semanticVersion` is derived from the projection spine semantic byte format: contract key bytes, family byte, field
count, then each sorted field dot path and canonical field-shape encoding. Lane declarations and `revisionNote` are
excluded from `semanticVersion`; `revisionNote` is non-semantic authoring metadata.

## Lanes

Hot lane declarations are canonicalized to `{ codec: "mapped-fixed", reservations }`. The compiler validates hot
admissibility for every field. `BoundedArray` and `BoundedMap` fields are hot-admissible only when their dot path is in
the canonical reservation set. The canonical reservation set is the sorted, deduplicated union of preferred
`lanes.hot.reservations` entries and legacy field-local `hotReservation: true` markers.

Warm declarations are retained as `{ codec: "framed-snapshot" }`, but compiler v0 does not emit warm codec manifests or
derive `warmCodecVersion`.

Cold declarations are retained as reserved materialization declarations, but compiler v0 does not derive
`coldCodecVersion` and does not claim that a cold materialization codec is ratified.

## Usage

```ts
import { compileAuthoredProjectionContract } from "@seqlok/compiler";

const result = compileAuthoredProjectionContract({
  key: "deck.runtime",
  family: "replaceable-snapshot",
  fields: {
    tempo: { kind: "fixed-scalar", type: "f64" },
  },
  lanes: {
    warm: { codec: "framed-snapshot" },
  },
});

if (result.ok) {
  console.log(result.value.manifest);
  console.log(result.value.semanticVersion);
} else {
  console.error(result.error.issues);
}
```
