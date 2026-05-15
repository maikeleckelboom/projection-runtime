# @exclave/compiler

`@exclave/compiler` is the build-time compiler for Exclave authored projection contracts.

It accepts `AuthoredProjectionContract` values from `@exclave/schema` and emits deterministic canonical projection
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
- a hot lane layout manifest when a hot lane is declared

The compiler does not own runtime behavior. Runtime packages consume emitted artifacts; they do not plan layout,
derive versions, or reinterpret authored contracts during live operation.

## Boundaries

Compiler v0 does not:

- generate runtime bindings
- implement warm frame encoding
- ratify or implement a cold codec
- create runtime descriptor instances, live handles, mappings, subscriptions, or adapters
- implement runtime hot readers or writers
- integrate Electron, SAB lifecycle management, or host adapters

Hot layout planning is delegated to `@exclave/hot-codec`. Warm codec manifests, cold materialization manifests,
resource lane manifests, generated bindings, conformance fixture emission, runtime readers/writers, and Electron
adapter behavior belong to later packages or later compiler slices.

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

When a hot lane is declared, the compiler calls `@exclave/hot-codec` to plan the deterministic `HotLayoutManifest`.
Successful compiler output includes:

```ts
type ResolvedProjectionContract = {
  readonly manifest: CanonicalProjectionManifest;
  readonly semanticVersion: SemanticVersion;
  readonly hotLayoutVersion?: HotLayoutVersion;
  readonly warmCodecVersion?: WarmCodecVersion;
  readonly coldCodecVersion?: ColdCodecVersion;
  readonly laneManifests?: {
    readonly hot?: HotLayoutManifest;
  };
};
```

`hotLayoutVersion` is copied from `laneManifests.hot.hotLayoutVersion`; it remains owned and derived by
`@exclave/hot-codec`. If no hot lane is declared, the compiler omits `laneManifests.hot` and omits `hotLayoutVersion`.
If hot layout planning rejects the input, compilation returns `ok: false` with compiler issues that preserve the
`hot-codec` issue source and cause code.

## Error model

Compiler failures are domain-coded `ExclaveError` values with code `compiler.compilationRejected`. The `CompilerError`
name is a TypeScript alias plus helper factory, not a runtime subclass. Each compiler error carries a sorted
`details.issues` list of `CompilerIssue` objects with typed issue codes such as `schema.invalid`,
`lane.hotFieldNotAdmissible`, or `hot-codec.planningFailed`. Issue codes are drawn from a predeclared registry; callers
can assert specific codes without parsing free-form strings.

Warm declarations are retained as `{ codec: "framed-snapshot" }`, but compiler v0 does not emit warm codec manifests or
derive `warmCodecVersion`.

Cold declarations are retained as reserved materialization declarations, but compiler v0 does not derive
`coldCodecVersion` and does not claim that a cold materialization codec is ratified.

## Usage

```ts
import { compileAuthoredProjectionContract } from "@exclave/compiler";

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
  console.error(result.error.details.issues);
}
```
