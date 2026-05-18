# Exclave Projection Spine: Canonical Architecture Spec

Status: Canonical. Implementation-authoritative for projection identity, lane admissibility, publication metadata,
lifecycle rules, and hot-lane ABI foundations.

This document is the canonical architecture specification for the Exclave projection spine. It defines the ownership
model, canonical manifest, version identity model, lane admissibility rules, hot-lane ABI foundations, publication
metadata model, instance lifecycle rules, and the first projection family.

It is written in present tense as the current system model. It is not a changelog, migration log, or design diary.
Historical comparison and redesign guidance belong in separate migration notes, not in this canon document.

---

## Contents

1. Core Nouns and Laws
2. Identifier Grammar
3. Canonical Projection Manifest and Resolved Contract
4. Canonical Hashing and Ordering Rules
5. Version Identity Model
6. Field-Shape Taxonomy
7. Lane Admissibility Rules
8. Hot-Lane Physical ABI
9. Publication Metadata: Conceptual Model and Lane-Specific Placement
10. Instance Lifecycle
11. First Projection Family: Replaceable Snapshot Projections
12. Applied Dekzer Examples
13. Rejected Alternatives

---

## 1. Core Nouns and Laws

### 1.1 The Center

Authority publishes typed projections to consumers over explicit delivery lanes.

---

### 1.2 Core Nouns

#### Authority

The single runtime owner permitted to publish a given projection instance. At most one authority per projection
instance, never per contract family. Authority is structural: it is encoded in the binding that holds write access, not
asserted at runtime.

#### Projection Contract

The canonical, versioned, language-neutral definition of a published surface. Defines what is published. Silent on how
the authority produces values. The TS DSL is the authoring surface. The `CanonicalProjectionManifest` (section 3) is the
language-neutral form.

#### Projection Instance

A specific live published subject satisfying a projection contract. One `deck.runtime` contract may have instances
`"deck.a"` and `"deck.b"`. Instance identity is carried in every publication via `projectionInstanceKey`. Contract =
what shape. Instance = which subject.

#### Publication

A concrete emitted instance satisfying a projection contract for a specific projection instance. Carries publication
metadata (section 9) and a lane-encoded payload.

#### Lane

The delivery mechanism and associated freshness, ordering, and loss characteristics. Three named classes. See section 7.

#### Consumer Binding

The typed access surface through which a consumer reads a projection. Lane-aware. Contract-typed. Never write-capable.

#### Baseline

The current compatible structural and semantic foundation for a specific published projection instance. Belongs to an
instance, not to a contract family abstractly.

#### Continuity

Whether a consumer may treat the current publication as continuous with previously observed publications for the same
projection instance. First-class. Not inferrable from sequence numbers alone.

#### Intent

A consumer-originated message directed toward the authority layer. Never a write into the projection substrate. Travels
through command transport. The authority is the sole boundary between intent-in and projection-out.

#### Canonical Projection Manifest

The normative language-neutral form of a projection contract. Generated from authoring. Consumed by the planner,
codegen, and lane validators. See section 3.

---

### 1.3 Ownership Laws

**Law 1: One projection instance has one authority.**
System-level MWMR emerges from routing intent producers through a governor. It never emerges from distributing write
access to the projection substrate.

**Law 2: Renderer is a consumer.**
Renderer may hold presentation-local and interaction-local ephemeral state. It does not own live projection authority.
It does not repair missed publications by inventing its own projection-level baseline state.

**Law 3: Durable baseline, runtime authority, and projection identity are three distinct things.**
SQLite durable state ≠ live authority state ≠ published projection state. Do not collapse them.

**Law 4: Lanes deliver. Lanes do not reinterpret.**
The lane changes transport characteristics, not semantic meaning.

**Law 5: Hot, warm, and cold are not interchangeable.**
They share contract identity and continuity model. They do not share latency, ordering, loss, durability, or recovery.
This must never be hidden behind a uniform interface.

**Law 6: Continuity metadata is mandatory in every publication.**
Every publication must carry enough metadata for the consumer to determine whether it is continuous with prior
publications.

**Law 7: SQLite is a durable and queryable substrate, not a hot delivery lane.**

**Law 8: Replay is a producer.**
Replay publishes through the same projection contracts and metadata model as live authority.

**Law 9: Intent flow is structurally separate from publication flow.**

**Law 10: `semanticVersion` is generated from the canonical manifest, never hand-authored.**
See section 5.

**Law 11: Field identity must derive from the canonical projection manifest and be consumed through generated typed APIs.**
Hand-authored raw dot-path string literals in authority, consumer, or runtime code are a defect.
Generated APIs — string literal unions, key mirrors, typed bindings — are permitted implementations.
The canonical manifest is the cross-language source of field identity.

**Law 12: Hot lane is admissible only for contracts whose every field is hot-admissible.**
See section 7.

**Law 13: A contract must be fully publishable on every lane it declares. Per-lane field subsetting is not permitted.**
If one lane cannot carry the full contract, the contract must be split. A subset published under the same contract key
on a narrower lane is not the same projection. It is a different projection or a derived view, and it must carry a
different key.

---

## 2. Identifier Grammar

All identifiers in the system, including contract keys, field path segments, and instance keys, follow one grammar.
Violations are rejected at define-time, not tolerated silently.

### 2.1 Segment

A **segment** is one path component.

Grammar: `[a-z][a-zA-Z0-9]*`

- Must begin with a **lowercase** ASCII letter. Uppercase-initial segments (e.g., `Deck`, `Runtime`) are rejected at
  define-time.
- May contain ASCII letters and digits only after the first character.
- Case-significant: `tempo` ≠ `Tempo`.
- **Law: lower-camel-case**: multi-word segments must begin lowercase and use camelCase thereafter (`phaseOffset`,
  `preFader`). This is not a style convention; it is a grammatical constraint enforced by the resolver. `PhaseOffset`
  and `phase_offset` are both illegal.
- No underscores, hyphens, or other characters.
- Empty segment is not valid.

Rationale: allowing `[A-Z]` in the first position creates unnecessary entropy. `Deck.runtime`, `deck.Runtime`, and
`deck.runtime` would all be distinct, legal identifiers in a system whose whole point is deterministic identity. The
lowercase-initial constraint closes this hole without cost.

### 2.2 Path

A **path** is one or more segments joined by `.`.

Grammar: `segment ('.' segment)*`

- `.` is reserved exclusively as a path separator. It must not appear in segment content.
- Dot at start or end is not valid: `.deck`, `deck.` are rejected.
- Consecutive dots are not valid: `deck..runtime` is rejected.

### 2.3 Contract Key

A contract key is a path. Examples: `deck.runtime`, `engine.health`, `workspace.runtime`.

The prefix `projection.` is reserved for system-level contracts.

### 2.4 Field Path

A field path is a path representing the dot-joined segments from the contract root to a leaf field in the authored tree.
Field paths must be unique within a contract. Two fields at the same dot-path key is a define-time error.

### 2.5 Projection Instance Key

An instance key is a path. Examples: `deck.a`, `deck.b`, `workspace.primary`.

Instance keys are stable for the lifetime of a domain within a deployment. Reuse of an instance key after the previous
instance was torn down requires a `baselineEpoch` increment at minimum (v1 stance: reuse is an error; see section 10).

### 2.6 Normalization

No normalization is performed. Keys are compared byte-for-byte as UTF-8. `deck.Runtime` and `deck.runtime` are different
identifiers, but `deck.Runtime` is also **illegal** under the lower-camel grammar (section 2.1). Authors must not rely on
normalization to fix invalid keys. The resolver rejects invalid keys at define-time.

---

## 3. Canonical Projection Manifest and Resolved Contract

### 3.1 Purpose

The **`CanonicalProjectionManifest`** is the normative language-neutral form of a projection contract. It is what the
system hashes, plans, and generates code from. It is the real owner.

The **`ResolvedProjectionContract`** is the operational envelope: the canonical manifest plus derived values and
non-normative authoring metadata. The resolver generates both.

The TS authoring DSL compiles to `ResolvedProjectionContract`. Only the canonical manifest portion is normative.

---

### 3.2 CanonicalProjectionManifest

```ts
interface CanonicalProjectionManifest {
    // Identity
    readonly key: string                  // valid contract key per section 2.3

    // Family and policy
    readonly family: ProjectionFamily     // "replaceable-snapshot"
    readonly continuityPolicy: ContinuityPolicy  // derived from family; "replaceable-latest"

    // Field model
    // Ordered: sorted lexicographically by dotPath (UTF-8 byte order). See section 4.
    readonly fields: ReadonlyArray<CanonicalField>
}

interface CanonicalField {
    readonly dotPath: string              // full dot-path field key; valid path per section 2.4
    readonly fieldId: u32                 // stable numeric id; see section 3.4
    readonly shape: FieldShape            // see section 6
}
```

`CanonicalProjectionManifest` does **not** contain:

- Lane declarations (those are operational, hashed separately per section 5)
- `revisionNote` or authoring metadata
- `authoredTree`
- Any version numbers (those are derived from hashing the manifest)

---

### 3.3 ResolvedProjectionContract

```ts
interface ResolvedProjectionContract {
    // Normative section
    readonly manifest: CanonicalProjectionManifest

    // Derived version numbers (see section 5)
    readonly semanticVersion: u64         // hash of canonical manifest (first 8 bytes of SHA-256)
    readonly hotLayoutVersion?: u64       // hash of hot layout spec; present iff hot lane declared (ratified)
    readonly warmCodecVersion?: u64       // hash of warm codec spec; present iff warm lane declared (ratified by Warm Codec v1)
    readonly coldCodecVersion?: u64       // reserved version slot; pending cold codec spec (not yet ratified)

    // Operational
    readonly lanes: ResolvedLaneDeclarations  // see section 7

    // Tooling and codegen (non-normative; excluded from any canonical hash)
    readonly authoredTree?: AuthoredFieldTree
    readonly revisionNote?: string
}
```

Fields are normative or non-normative:

| Field              | Normative?             |
|--------------------|------------------------|
| `manifest.*`       | Yes                    |
| `semanticVersion`  | Yes (derived)          |
| `hotLayoutVersion` | Yes (derived)          |
| `warmCodecVersion` | Yes (derived)          |
| `coldCodecVersion` | Yes (derived)          |
| `lanes`            | Yes                    |
| `authoredTree`     | No, tooling only       |
| `revisionNote`     | No, documentation only |

Consuming code must never treat `authoredTree` or `revisionNote` as part of the compatibility identity.

---

### 3.4 Stable Numeric Field IDs

Every canonical field carries a stable numeric `fieldId` for use by Rust authority codegen, hot-lane layout plans, and
any path where string key lookup on the hot path is unacceptable.

Derivation:

```
fieldId = first_4_bytes_big_endian(SHA-256(manifest.key + ":" + field.dotPath))
```

Properties:

- Deterministic from contract key and field path.
- No central registry required.
- Stable across refactors that do not change the contract key or field path.
- The resolver must verify that no two fields within one contract share the same `fieldId`. Collision is a hard
  define-time error. (Birthday bound at 32 bits over a realistic field count makes this statistically negligible but
  must be checked.)

---

### 3.5 Generated Field Identity

Field identity is authored once in the projection contract and derived into every consumer surface from the canonical
projection manifest. No hand-authored raw dot-path string literal may serve as the normal access path for a published
field in authority, consumer, or runtime code.

The compiler owns generation of field identity artifacts. Possible generated surfaces include:

- **TypeScript string literal unions** generated from `manifest.fields[].dotPath`, giving the consumer a compile-time
  field-path type without exposing a nesting hierarchy.
- **Generated key mirrors** — typed nested property-access trees produced from the manifest. A key mirror is a
  convenience helper, not a mandatory public API.
- **Generated typed bindings** — per-contract reader and writer surfaces that embed field offsets, field IDs, and typed
  value access. Generated bindings are the preferred end-state consumer and authority access model.

Generated code must consume manifests, not authoring input directly. Every generated access surface must be traceable
to the canonical manifest. The canonical manifest is the cross-language source of field identity for Rust, TypeScript,
and any future language target.

---

### 3.6 VariableMap and BoundedMap Field Cardinality Rule

`VariableMap` and `BoundedMap` fields contribute **exactly one entry** to `manifest.fields`. The runtime contents of
these fields, their dynamic keys and values, are payload data. They are not canonical field keys. They do not
participate in hashing, layout planning, or codegen.

> Dynamic map entries are payload contents of one field. They do not create new canonical field keys.

This rule has no exceptions.

---

### 3.7 Authoring DSL

The TS DSL compiles authored input into a `ResolvedProjectionContract`. One canonical example; full Dekzer examples are
in section 12.

```ts
const deckRuntimeContract = defineProjectionContract({
    key: "deck.runtime",
    revisionNote: "v1",            // optional; excluded from all hashes
    family: "replaceable-snapshot",

    fields: {
        transport: {
            tempo: f64(),
            phase: f64(),
            playing: bool(),
            sync: {
                enabled: bool(),
                source: enumU8(["internal", "midi", "link"]),
                phaseOffset: f64(),
            },
        },
        peaks: {
            preFader: {left: f32(), right: f32()},
            postFader: {left: f32(), right: f32()},
        },
    },

    lanes: {
        hot: {codec: "mapped-fixed"},
        warm: {codec: "framed-snapshot"},
    },
})
```

Note: top-level authoring key is `fields`. No `params`/`meters` split. All fields in a projection contract are published
consumer surface. The cold lane is not declared in this example because `coldCodecVersion` is reserved and unratified.
Cold materialization remains a future capability blocked on a cold materialization codec spec.

---

## 4. Canonical Hashing and Ordering Rules

### 4.1 Purpose

The canonical hash of a projection manifest must be identical across all independent implementations. This requires a
completely specified byte format and ordering rule. "Deterministic" is not enough. The ordering must be named.

---

### 4.2 Field Ordering Rule

Fields in `manifest.fields` are sorted **lexicographically by `dotPath`** using UTF-8 byte order (i.e., standard
`strcmp` / `Ord` on bytes, not Unicode collation).

Examples:

- `"eq.high"` < `"eq.low"` < `"eq.mid"` < `"peaks.postFader.left"` < `"peaks.preFader.left"` < `"transport.phase"` <
  `"transport.sync.enabled"` < `"transport.tempo"`

The authored namespace hierarchy is not used for ordering. Only the flat dot-path string governs sort order.

---

### 4.3 Canonical Byte Format for Semantic Hash

The semantic manifest is serialized in this exact format before hashing:

```
[ContractKey bytes as UTF-8]
[0x00]                            ← null separator
[FamilyByte]                      ← one byte: 0x01 for "replaceable-snapshot"
[FieldCount as u32 little-endian]
for each field in lexicographic dotPath order:
  [dotPath bytes as UTF-8]
  [0x00]                          ← null separator
  [FieldShape encoding]           ← see section 4.4
```

No length prefixes on strings other than the inline null terminator. No trailing padding.

---

### 4.4 Field Shape Encoding

Each shape is encoded as a single type byte followed by type-specific payload:

| Shape Kind         | Type Byte | Payload                                                                           |
|--------------------|-----------|-----------------------------------------------------------------------------------|
| FixedScalar        | `0x01`    | ScalarTypeId (1 byte; see section 4.5)                                                   |
| FixedEnum          | `0x02`    | StorageId (1 byte) + VariantCount (u16 LE) + variant strings each null-terminated |
| FixedVector        | `0x03`    | ScalarTypeId (1 byte) + Length (u32 LE)                                           |
| BoundedArray       | `0x04`    | ScalarTypeId (1 byte) + MaxLength (u32 LE)                                        |
| BoundedMap         | `0x05`    | KeyByteLength (u16 LE) + MaxEntries (u32 LE) + ValueShape encoding (recursive)    |
| VariableMap        | `0x06`    | ValueShape encoding (recursive)                                                   |
| FixedStringEncoded | `0x07`    | ByteLength (u16 LE) + EncodingId (1 byte; 0x01=utf8, 0x02=ascii)                  |
| VariableString     | `0x08`    | (no payload)                                                                      |

---

### 4.5 Scalar Type IDs

| Type | ID   |
|------|------|
| bool | 0x01 |
| u8   | 0x02 |
| u16  | 0x03 |
| u32  | 0x04 |
| u64  | 0x05 |
| i8   | 0x06 |
| i16  | 0x07 |
| i32  | 0x08 |
| i64  | 0x09 |
| f32  | 0x0A |
| f64  | 0x0B |

---

### 4.6 Hash Algorithm

```
semanticVersion = first_8_bytes_big_endian(SHA-256(canonical_byte_format))
```

SHA-256 over the canonical byte representation defined in section 4.3. The first 8 bytes of the SHA-256 digest are
interpreted as a big-endian u64 to produce the numeric value. Once derived, the value is encoded on the lane as u64
little-endian (see section 8.6).

---

### 4.7 Per-Lane Version Hashes

Lane version hashes follow the same algorithm but over lane-specific byte formats. All lane version hashes produce **u64
** values using the same derivation: the first 8 bytes of the SHA-256 digest are interpreted as a big-endian u64 to
produce the numeric value. Once derived, the value is encoded on the lane as u64 little-endian.

**Structural minimum inputs** (defined here):

**hotLayoutVersion** hashes: hot codec name (`"mapped-fixed"`) + the sorted reservation list (each entry:
`[dotPath][0x00]`, sorted lexicographically by dotPath) + the ordered list of hot-admissible field entries, each
encoding `[dotPath][0x00][fieldId as u32 LE][shape encoding][offset as u32 LE]`. The reservation list is included
because which fields are hot-reserved determines which fields appear in the layout and at which offsets; a change to the
reservation set produces a new layout and must produce a new `hotLayoutVersion`.

**warmCodecVersion** hashes: warm codec name (`"framed-snapshot"`) + the ordered field list without offsets. **Status:
ratified. Defined by Warm Codec v1.** The spine owns the version identity slot; Warm Codec v1 owns the exact byte-format
and hash coverage. `warmCodecVersion` values are authoritative once Warm Codec v1 is adopted.

**coldCodecVersion** hashes: cold codec name (`"sqlite-materialized-snapshot"`) + the ordered field list. **Status:
reserved version slot only; not yet ratified.** The cold materialization codec document must specify the full hash input
set before `coldCodecVersion` values can be treated as authoritative.

The inputs listed above for `hotLayoutVersion` are the structural minimum and are **ratified here** for v1.
`warmCodecVersion` is ratified by Warm Codec v1. `coldCodecVersion` is **not yet ratified** and remains blocked on a
cold materialization codec spec.

> **Implementation blocker for cold**: `coldCodecVersion` is a placeholder until a cold materialization codec document
> defines the full byte-format and hash coverage. It must not be treated as authoritative before that.
`warmCodecVersion`
> is no longer blocked; see Warm Codec v1.

---

## 5. Version Identity Model

### 5.1 The Problem with One Version Number

If `contractVersion` covers semantic content + lane declarations in one hash, then:

- Adding cold-lane support to an existing contract changes the version.
- A hot consumer that was compiled for that contract with only `hot` + `warm` declared would reject publications from
  the new contract as "incompatible."
- The consumer did not change. The hot layout did not change. The fields did not change. The failure is spurious.

This coupling forces unnecessary consumer rebuilds and makes lane capability evolution a breaking event for consumers
that are not affected by it.

### 5.2 The Split

Version identity is split into four independent u64 values:

| Version Field      | Covers                                            | Consumer who checks it             |
|--------------------|---------------------------------------------------|------------------------------------|
| `semanticVersion`  | Contract key + family + field keys + field shapes | Every consumer on any lane         |
| `hotLayoutVersion` | Hot codec + hot field offsets and layout          | Hot-lane consumers only            |
| `warmCodecVersion` | Warm codec name and wire framing                  | Warm-lane consumers only           |
| `coldCodecVersion` | Cold codec name and materialization strategy      | Cold-lane / tooling consumers only |

### 5.3 Failure Modes by Version Field

| Mismatch                           | Failure mode                       | Required action                                                        |
|------------------------------------|------------------------------------|------------------------------------------------------------------------|
| `semanticVersion`                  | Field semantics or keys changed    | All consumers must rebuild                                             |
| `hotLayoutVersion`                 | Hot memory layout changed          | Hot consumers must rebuild; warm/cold consumers are unaffected         |
| `warmCodecVersion`                 | Warm framing changed               | Warm consumers must rebuild; hot/cold consumers are unaffected         |
| `coldCodecVersion`                 | Cold materialization changed       | Cold/tooling consumers must rebuild; hot/warm consumers are unaffected |
| New lane added (no others changed) | Only the new lane's version is new | Existing consumers on other lanes are unaffected                       |

### 5.4 Publication Metadata Carries Which Versions

Hot-lane publication metadata carries `semanticVersion` + `hotLayoutVersion`.
Warm-lane frames carry `semanticVersion` + `warmCodecVersion`.
Cold-lane rows carry `semanticVersion` + `coldCodecVersion`.

No lane publication carries version information for lanes it is not on. See section 9 for physical placement.

---

## 6. Field-Shape Taxonomy

### 6.1 Status of This Taxonomy

This taxonomy is **semantic with codec implications**. The shape kind and its parameters describe what the data means
and how it is bounded. The hot-lane ABI (section 8) derives physical encoding from the shape. The warm and cold lane codecs
likewise derive their representations from the shape.

Some shape fields carry encoding details that are properly codec-bearing (e.g., `FixedStringEncoded.encoding`,
`BoundedMap.keyEncoding`). These are included in the shape taxonomy because they affect what valid values look like,
making them semantic as well as codec-bearing. This is a known intentional simplification. A future revision may move
encoding details to lane codec descriptors. Until then, encoding is part of shape.

---

### 6.2 Taxonomy

```ts
type FieldShape =
    | FixedScalar
    | FixedEnum
    | FixedVector
    | BoundedArray
    | BoundedMap
    | VariableMap
    | FixedStringEncoded
    | VariableString
```

---

#### FixedScalar

A single value of a fixed-width numeric or boolean type.

```ts
interface FixedScalar {
    kind: "fixed-scalar"
    type: ScalarType  // "f32" | "f64" | "u8" | "u16" | "u32" | "u64" | "i8" | "i16" | "i32" | "i64" | "bool"
    nanSentinel?: true  // if present: NaN is permitted and means "no value". See section 8.5.
}
```

DSL: `f32()`, `f64()`, `u8()`, `u16()`, `u32()`, `u64()`, `i8()`, `i16()`, `i32()`, `i64()`, `bool()`

Hot admissible: **yes**.

---

#### FixedEnum

A discriminant from a bounded variant set, stored in a fixed-width unsigned integer.

```ts
interface FixedEnum {
    kind: "fixed-enum"
    variants: readonly string[]  // in declared order; order is stable and part of canonical encoding
    storage: "u8" | "u16" | "u32"
}
```

DSL: `enumU8(["a", "b"])`, `enumU16(["a", "b"])`, `enumU32(["a", "b"])`

Hot admissible: **yes**.

---

#### FixedVector

A fixed-length contiguous array of a single scalar type. Length is invariant. It is not a maximum and not a count. Every
element is always meaningful.

```ts
interface FixedVector {
    kind: "fixed-vector"
    elementType: ScalarType
    length: number
}
```

DSL: `vecF32(n)`, `vecF64(n)`, `vecU32(n)`, etc.

Hot admissible: **yes**.

---

#### BoundedArray

A variable-length array with a declared maximum count. Live count may vary per publication from 0 to maxLength.

```ts
interface BoundedArray {
    kind: "bounded-array"
    elementType: ScalarType
    maxLength: number
    hotReservation?: true  // see section 7.3
}
```

DSL: `boundedArrayF32(max)`, `boundedArrayU32(max)`, etc.

Hot admissible: **conditionally**, only when `hotReservation: true` is declared.

---

#### BoundedMap

A key-value map with fixed-encoding keys and a declared maximum entry count.

```ts
interface BoundedMap {
    kind: "bounded-map"
    keyEncoding: "fixed-ascii"  // codec-bearing; see section 6.1
    keyByteLength: number
    valueShape: FixedScalar | FixedEnum | FixedVector  // value shape must itself be fixed
    maxEntries: number
    hotReservation?: true  // see section 7.3
}
```

DSL: `boundedMap({ keyByteLength, valueShape, maxEntries })`

Hot admissible: **conditionally**, only when `hotReservation: true` is declared.

---

#### VariableMap

A key-value map with no declared maximum. Cannot be admitted on the hot lane under any declaration.

```ts
interface VariableMap {
    kind: "variable-map"
    valueShape: FieldShape
}
```

DSL: `recordOf(valueShape)`

Hot admissible: **never**.

---

#### FixedStringEncoded

A string in a fixed-width byte buffer.

```ts
interface FixedStringEncoded {
    kind: "fixed-string-encoded"
    byteLength: number
    encoding: "utf8" | "ascii"  // codec-bearing; see section 6.1
}
```

DSL: `fixedString(byteLength)`, `fixedAscii(byteLength)`

Hot admissible: **yes**.

---

#### VariableString

An unbounded string. Cannot be admitted on the hot lane.

```ts
interface VariableString {
    kind: "variable-string"
}
```

DSL: `varString()`

Hot admissible: **never**.

---

## 7. Lane Admissibility Rules

### 7.1 Lane Classes

**Hot lane**: SAB / mmap / seqlock-backed mapped regions. Fixed-layout mandatory. Latest-state oriented.

**Warm lane**: framed IPC snapshots or deltas across process boundaries. Variable shapes admissible.

**Cold lane**: SQLite materialized tables or checkpoint blobs. All shapes admissible under declared materialization
strategy.

---

### 7.2 Per-Shape Admissibility Matrix

| Field Shape                         | Hot | Warm | Cold |
|-------------------------------------|-----|------|------|
| FixedScalar                         | ✓   | ✓    | ✓    |
| FixedEnum                           | ✓   | ✓    | ✓    |
| FixedVector                         | ✓   | ✓    | ✓    |
| BoundedArray (hotReservation: true) | ✓   | ✓    | ✓    |
| BoundedArray (default)              | ✗   | ✓    | ✓    |
| BoundedMap (hotReservation: true)   | ✓   | ✓    | ✓    |
| BoundedMap (default)                | ✗   | ✓    | ✓    |
| VariableMap                         | ✗   | ✓    | ✓    |
| FixedStringEncoded                  | ✓   | ✓    | ✓    |
| VariableString                      | ✗   | ✓    | ✓    |

---

### 7.3 Fixed-Reservation Semantics for BoundedArray and BoundedMap

Fixed-reservation enables hot-lane admission of bounded fields by guaranteeing a fixed allocated byte footprint in the
mapped region.

Rules:

- The layout planner allocates `maxLength × elementSize` bytes (plus a count field) unconditionally in the hot-lane
  region.
- The authority publishes a correct live count on every publication.
- The consumer reads only the live prefix (0 to count elements).
- The unused tail has no defined content. The authority is not required to zero or sentinel-pad the tail on every
  publication.
- The `hotLayoutVersion` changes if `maxLength` changes, because the region layout changes.

Fixed-reservation is a space-for-lane-admissibility trade. The authority need not overwrite the full tail to maintain
correctness. The seqlock and the count field together provide correct access to the live portion.

---

### 7.4 Contract-Level Hot Admissibility Validation

The resolver checks hot admissibility at `defineProjectionContract` call time:

1. If `hot` lane is declared, iterate all `manifest.fields`.
2. Any field that is not hot-admissible per section 7.2 causes a hard resolve error.
3. The error names the field path, the shape kind, and the admissibility rule violated.
4. This is a hard error, not a warning. The contract is not produced.

---

### 7.5 Cold Lane is Not "Anything Goes"

The cold lane accepts all current field shapes in the sense that no field shape causes a hard reject at resolve time.
However, cold is not semantically trivial. The cold codec layer must specify a materialization strategy for each
cold-lane contract:

- Row/column flattened table
- Blob payload (encoded snapshot)
- JSON payload
- Hybrid (fixed fields as columns, variable fields as blob or JSON)

The cold codec spec for each contract is part of `coldCodecVersion`. "We'll figure out SQLite later" is not an
admissible stance. The cold codec declaration must be concrete before cold-lane publication is implemented.

---

## 8. Hot-Lane Physical ABI

### 8.1 Purpose

The hot lane maps a shared memory region between Rust authority and TS consumer. They must agree on every byte. This
section is the complete binary ABI specification for that region. It is not advisory.

---

### 8.2 Global Rules

**Endianness**: little-endian for all multi-byte values. This matches WebAssembly, x86, ARM little-endian, and JS
TypedArrays. No exceptions.

**Natural alignment**: every field is placed at an offset that is a multiple of its byte width. u16 at 2-byte boundary.
u32 at 4-byte boundary. u64 at 8-byte boundary. f32 at 4-byte. f64 at 8-byte. u8/bool/i8 at any byte boundary.

**Padding**: the layout planner inserts explicit unnamed padding bytes to satisfy alignment. Padding bytes have no
defined value and must not be read by consumers. They are not written by the authority on publications (only on initial
region setup, where they may be zeroed).

**Region total size**: must be a multiple of 8 bytes.

**Single-writer multiple-reader (SWMR) invariant**: the seqlock protocol defined in section 8.8 is correct only under SWMR. At
most one writer thread may ever hold write access to a given hot-lane mapped region at any time. The atomic fetch-add
operations in the write protocol do not provide protection against concurrent writers; two simultaneous writers would
interleave their counter increments and field writes, producing an unrecoverable semantic corruption that the consumer's
read-side retry loop cannot detect or recover from. SWMR must be enforced by the binding layer, not assumed. See also
section 8.8.

---

### 8.3 Scalar Encodings

| Type | Width   | Encoding                                                            |
|------|---------|---------------------------------------------------------------------|
| bool | 1 byte  | 0x00 = false, 0x01 = true. Any other value is a contract violation. |
| u8   | 1 byte  | Unsigned, no endian concern.                                        |
| u16  | 2 bytes | Unsigned, little-endian.                                            |
| u32  | 4 bytes | Unsigned, little-endian.                                            |
| u64  | 8 bytes | Unsigned, little-endian.                                            |
| i8   | 1 byte  | Signed two's complement.                                            |
| i16  | 2 bytes | Signed two's complement, little-endian.                             |
| i32  | 4 bytes | Signed two's complement, little-endian.                             |
| i64  | 8 bytes | Signed two's complement, little-endian.                             |
| f32  | 4 bytes | IEEE 754 single precision, little-endian. See section 8.5 for NaN.         |
| f64  | 8 bytes | IEEE 754 double precision, little-endian. See section 8.5 for NaN.         |

---

### 8.4 Compound Shape Encodings

**FixedEnum**: encoded as its declared storage type (u8/u16/u32). Value is the 0-based variant index in declared order.
A value ≥ variantCount is a contract violation.

**FixedVector**: elements packed contiguously. No padding between elements (same-type, aligned within themselves).
Vector start aligned to element alignment. Total size = `elementSize × length`. Stride between elements = elementSize.

**FixedStringEncoded**: `byteLength` bytes, 1-byte aligned. No null terminator. If the string is shorter than
`byteLength`, zero-padded at the end. UTF-8 validity (for `encoding: "utf8"`) is not enforced by the ABI layer; the
authority is responsible for writing valid encoded content.

**Consumer read semantics for FixedStringEncoded**: the logical string length is recovered by trimming trailing zero
bytes from the right. The consumer scans from `offset + byteLength - 1` toward `offset` and stops at the first non-zero
byte; the logical byte length is that position minus `offset` plus one. A buffer containing all zero bytes encodes the
empty string. This rule applies regardless of encoding (`utf8` or `ascii`). Consumers must not interpret any trailing
zero byte as part of the string content, and must not assume a null terminator is present. Two implementations reading
the same buffer under this rule must recover the same logical string.

**BoundedArray** (hot-reservation mode only):

```
[count: u32]          ← 4-byte aligned; live element count, 0 ≤ count ≤ maxLength
[padding: 0–N bytes]  ← to align first element to elementAlignment
[elements: maxLength × elementSize]  ← full reservation allocated; only [0, count) are live
```

Total size = 4 + padding + (maxLength × elementSize). Authority writes `count` on every publication. Authority is not
required to write the unused tail.

**BoundedMap** (hot-reservation mode only):

```
[count: u32]          ← 4-byte aligned; live entry count, 0 ≤ count ≤ maxEntries
[padding: 0–N bytes]  ← to align first entry
[entries: maxEntries × entrySize]  ← full reservation; only [0, count) entries are live
  each entry:
    [key: keyByteLength bytes]       ← 1-byte aligned; zero-padded if shorter
    [padding: 0–N bytes]             ← to align value to valueAlignment
    [value: valueShape encoding]
```

Authority writes `count` on every publication. Unused entry slots are unspecified.

**Live-entry ordering invariant**: the `count` live entries (indices 0 through count−1) must be in strictly increasing
order by their encoded key bytes (raw byte-order comparison, equivalent to `memcmp`). Duplicate keys are malformed and
constitute a contract violation. The authority is responsible for maintaining this order on every publication. Consumers
may rely on this ordering for binary search, deterministic comparison, checkpoint diffing, and cross-lane consistency
checks. An authority that writes entries in arbitrary order, or that writes duplicate keys, is in violation of the ABI.
The ordering applies to the live prefix only; unused tail slots are unspecified and their content is irrelevant to
ordering.

---

### 8.5 NaN Semantics

f32 and f64 fields may contain NaN only when the field's shape declares `nanSentinel: true`.

A field without `nanSentinel: true` that contains NaN is a contract violation. The authority must not write NaN there.
The consumer may not treat NaN as a number or a valid value.

When `nanSentinel: true` is declared, the canonical sentinel NaN bit pattern is:

- f32: `0x7FC00000` (quiet NaN, positive)
- f64: `0x7FF8000000000000` (quiet NaN, positive)

Consumers receiving the canonical NaN sentinel must interpret it as "no value present" for that field. Consumers must
not interpret any other NaN bit pattern as the sentinel unless it matches the canonical pattern exactly, even if IEEE
754 calls it a valid quiet NaN.

---

### 8.6 Region Layout

The hot lane region is divided into two contiguous blocks.

**Block A: Immutable Header** (72 bytes, starting at region byte 0)

Written once at binding time. Never rewritten during publication.

```
Offset  Size  Field
0       4     regionMagic              (4-byte sequence [0x53, 0x51, 0x4C, 0x4B]; byte sequence is normative truth)
4       4     hotAbiVersion            (u32 LE, value 0x00000001 = 1; current hot lane ABI generation)
8       16    contractKeyHash          (bytes 0–15 of SHA-256(contractKey UTF-8); 128-bit bind-time identity)
24      16    instanceKeyHash          (bytes 0–15 of SHA-256(instanceKey UTF-8); 128-bit bind-time identity)
40      8     semanticVersion          (u64 LE)
48      8     hotLayoutVersion         (u64 LE)
56      4     fieldCount               (u32 LE; count of hot-admissible fields in layout)
60      4     mutableRegionByteLength  (u32 LE; = totalRegionByteLength − 72)
64      8     reserved                 (must be 0x00 × 8 on write; all 8 bytes must be zero)
```

Version fields `semanticVersion` and `hotLayoutVersion` are **u64**, consistent with section 5.2. They are stored little-endian
and may be compared against the u64 values emitted by the compiler. Their numeric values are derived from SHA-256 digests
(see sections 4.6 and 4.7): the first 8 bytes of the digest are interpreted as a big-endian u64 to produce the numeric
value, and that numeric value is then encoded on the lane as u64 little-endian. The 8-byte reserved block enforces 8-byte
alignment of Block B from region byte 0.

**Bind-time identity validation**: a consumer binding to this region must perform all of the following checks before
treating any Block B data as valid:

1. `regionMagic == [0x53, 0x51, 0x4C, 0x4B]` (4-byte sequence match)
2. `hotAbiVersion == 0x00000001`
3. `contractKeyHash == first_16_bytes(SHA-256(expected contractKey UTF-8))`
4. `instanceKeyHash == first_16_bytes(SHA-256(expected instanceKey UTF-8))`
5. `semanticVersion == expected semanticVersion` (u64 comparison)
6. `hotLayoutVersion == expected hotLayoutVersion` (u64 comparison)
7. `fieldCount == expected fieldCount from hot layout manifest`
8. `mutableRegionByteLength == total_mapped_region_size − 72`
9. `reserved[0..8] == 0x00 × 8` (all reserved bytes must be zero)
10. `total_mapped_region_size == expected total region byte length from hot layout manifest`

All ten checks must pass. Failure on any check is a bind error; the region must not be used. The 128-bit identity hash
provides 2^128 resistance against accidental false-positive binding. No truncation scheme at ≤ 64 bits is acceptable
here, because a false-positive bind is catastrophic, not mildly inconvenient.

> **Authority of this table**: the Hot Lane Codec and Layout Spec is the implementation-authoritative expansion of this
> region layout. This section owns the architectural placement of hot metadata; the companion owns planner constants,
> hash
> coverage, per-field validation sequence, and conformance cases. If a disagreement ever appears between this table and
> the companion's Block A table, it is a specification bug and both documents must be reconciled before implementation
> proceeds; the companion is not silently subordinate.

**Block B: Mutable Publication Region** (starts at byte 72, 8-byte aligned from region start)

Rewritten on every publication. Governed by the seqlock counter at its start.

```
Offset  Size  Field
72      8     seqlockCounter        (u64 LE; even = valid, odd = write in progress)
80      4     baselineEpoch         (u32 LE)
84      4     continuityGeneration  (u32 LE)
88      8     publicationSequence   (u64 LE)
96      ...   field data region (field offsets per layout plan; see section 8.7)
```

Field offsets in the layout plan are **absolute from region byte 0**.

---

### 8.7 Field Data Layout

The layout planner assigns each hot-admissible field an absolute byte offset within the region. Rules:

- Fields are assigned in increasing offset order, beginning after the fixed Block B header fields (i.e., after byte 95;
  first field starts at byte 96 or the next naturally-aligned boundary thereafter). `FIELD_DATA_ORIGIN = 96`. Do not
  derive field offsets from Block B header fields without accounting for the full 72-byte Block A and the 24-byte Block
  B fixed header (seqlockCounter 8 + baselineEpoch 4 + continuityGeneration 4 + publicationSequence 8 = 24).
- Each field's offset satisfies natural alignment relative to byte 0 of the region.
- Padding bytes between fields to satisfy alignment are inserted by the planner and not accessible to authority or
  consumer code.
- The `hotLayoutVersion` hash covers the ordered list of `(fieldId, shape, offset)` tuples.
- If field shapes or ordering changes such that offsets change, `hotLayoutVersion` changes.

The layout plan is deterministic for a given `CanonicalProjectionManifest` with hot lane declared. Two independent
planners given the same manifest must produce the same offsets.

Planner ordering: fields in the layout are assigned in lexicographic dotPath order (same as manifest ordering), with one
pass to handle alignment padding. The field arriving earliest lexicographically gets the lowest offset, subject to
alignment.

---

### 8.8 Seqlock Protocol

**SWMR requirement**: this protocol is valid only under **single-writer multiple-reader** access to the mapped region.
At most one writer thread may execute the write protocol against a given region at any time. This is not enforced by the
atomic operations themselves. Two concurrent writers will interleave counter increments and produce silent semantic
corruption that the consumer's retry loop cannot detect. The binding layer must guarantee SWMR before any writer enters
the write protocol. See section 8.2.

**Write protocol** (authority):

1. Atomic fetch-add of `seqlockCounter` by 1, with release memory order. Counter is now odd.
2. Write all mutable publication fields (non-atomic writes; protected by seqlock).
3. Atomic fetch-add of `seqlockCounter` by 1, with release memory order. Counter is now even.

**Read protocol** (consumer):

1. Atomic load of `seqlockCounter` with acquire memory order. Call value `v1`.
2. If `v1` is odd: spin or yield; goto 1.
3. Read all desired fields from the mutable region (non-atomic reads).
4. Atomic load of `seqlockCounter` with acquire memory order. Call value `v2`.
5. If `v2 != v1`: goto 1 (write occurred during read; retry).
6. Read is valid. Proceed with copied field values.

Note: the seqlock counter is separate from `publicationSequence`. The seqlock counter governs read safety.
`publicationSequence` is a semantic ordering marker. They are different things with different owners.

---

### 8.9 Strings on the Hot Lane

The immutable header encodes `contractKey` and `instanceKey` as 128-bit (16-byte) SHA-256 prefix hashes, not as strings.
Strings must never be written into the mutable publication region.

The 128-bit hashes provide strong bind-time identity: the probability of accidental collision is negligible even under
adversarial conditions. If the authority or consumer needs additional verification of the full string identity beyond
what the 128-bit hash check provides, that supplementary check happens at binding time against an out-of-band string
registry before the region is mapped. During the hot publication cycle, all identity checks are integer comparisons
against pre-loaded expected values.

The full string values of `contractKey` and `instanceKey` are never in the hot-lane region. They are resolved at binding
time and must not be recovered by inspecting the region.

---

## 9. Publication Metadata: Conceptual Model and Lane-Specific Placement

### 9.1 Conceptual Publication Identity

Every publication has the following logical identity fields. Their meanings are defined here and are lane-independent.

```ts
interface ConceptualPublicationMetadata {
    readonly contractKey: string
    readonly projectionInstanceKey: string
    readonly semanticVersion: u64         // derived from canonical manifest hash; see sections 4.6 and 4.7 for derivation
    readonly laneVersionKey: u64          // hotLayoutVersion | warmCodecVersion | coldCodecVersion; same derivation method
    readonly baselineEpoch: u32
    readonly continuityGeneration: u32
    readonly publicationSequence: u64
}
```

---

### 9.2 Lane-Specific Physical Placement

The conceptual fields above do not all live in the same physical location on every lane.

**Hot lane**:

- `contractKey` and `projectionInstanceKey`: encoded as **128-bit (16-byte) SHA-256 prefix hashes** in the **immutable
  header** (Block A, bytes 8–23 and 24–39). Written once at binding. Never rewritten on publication.
- `hotAbiVersion`: in the **immutable header** (Block A, bytes 4–7). Written once. Must be checked at bind time.
- `semanticVersion` and `hotLayoutVersion`: also in the **immutable header** (Block A, bytes 40–47 and 48–55). Both *
  *u64 LE**. Written once. A version mismatch is detected at bind time, not per-publication.
- `baselineEpoch`, `continuityGeneration`, `publicationSequence`: in the **mutable publication region** (Block B,
  starting at byte 80, 84, 88 respectively), rewritten on every publication.

On the hot lane, a publication does not re-transmit strings. It writes three integers per publication header. This is
intentional and must never be "fixed" by moving string data into the mutable region.

**Warm lane** (framed IPC):

- All conceptual metadata fields are present in each frame.
- `contractKey` and `projectionInstanceKey` are transmitted as strings.
- `semanticVersion` and `warmCodecVersion` are transmitted as u64 values.
- For the `replaceable-snapshot` projection family, every warm frame is a **complete snapshot frame**. The payload
  contains the full field set for the projection instance. Delta framing, meaning transmitting only changed fields, is
  not permitted under this family. A warm consumer must never be required to hold prior frame state to reconstruct the
  current publication. Delta framing, if ever needed, belongs to a different projection family or a future warm codec
  extension, and must carry a different `warmCodecVersion` and a different family declaration. It must not be introduced
  silently under the existing codec.

```ts
interface WarmLaneFrame {
    readonly contractKey: string
    readonly projectionInstanceKey: string
    readonly semanticVersion: u64
    readonly warmCodecVersion: u64
    readonly baselineEpoch: u32
    readonly continuityGeneration: u32
    readonly publicationSequence: u64
    readonly laneSequence?: u32          // transport-level ordering; optional
    readonly payload: Uint8Array         // framed-snapshot encoding of complete field data
}
```

**Cold lane** (SQLite):

- All conceptual metadata fields are stored as columns.
- `contractKey` and `projectionInstanceKey` as TEXT.
- Version fields as INTEGER.
- Epoch, generation, and sequence fields as INTEGER.
- Field data encoded per the cold codec declaration.

---

### 9.3 The Six Metadata Fields (Conceptual)

These definitions are unchanged from v2, with `semanticVersion` and `laneVersionKey` replacing the single
`contractVersion`. They are restated here for completeness.

**contractKey**: Which contract does this payload satisfy?

**projectionInstanceKey**: Which live instance of this contract? Scopes all fields below.

**semanticVersion**: Is the field semantics compatible with what I was compiled against?

**laneVersionKey**: Is the lane-specific encoding/layout compatible? (hotLayoutVersion for hot consumers,
warmCodecVersion for warm, coldCodecVersion for cold.)

**baselineEpoch**: Has the authoritative baseline for this instance been replaced? Consumer must rebase on increment.

**continuityGeneration**: May I treat this publication as continuous with prior observations? Consumer must reset
derived state on increment. Resets to 0 on baselineEpoch increment. publicationSequence resets to 0 on
continuityGeneration increment.

**publicationSequence**: Is this newer than the last I read? Did I miss any? Monotonic within one continuityGeneration.

---

### 9.4 Cold Checkpoint Composite Key

For cold-lane checkpointed snapshot series, the composite row key is:

```
(projectionInstanceKey, baselineEpoch, continuityGeneration, publicationSequence)
```

All four components are required. `continuityGeneration` is mandatory because `publicationSequence` resets to 0 on each
continuity generation increment while `baselineEpoch` may remain unchanged. Without `continuityGeneration` in the key,
two rows from different continuity generations at the same sequence number within the same baseline epoch would collide.

---

### 9.5 Consumer Reset Matrix

| Condition                         | baselineEpoch              | continuityGeneration | publicationSequence |
|-----------------------------------|----------------------------|----------------------|---------------------|
| Semantic schema change            | n/a, consumer must rebuild | n/a                  | n/a                 |
| Baseline replacement              | Incremented                | Reset to 0           | Reset to 0          |
| Authority restart (same domain)   | Unchanged                  | Incremented          | Reset to 0          |
| Replay seek or jump               | Unchanged                  | Incremented          | Reset to 0          |
| Normal run (any frequency)        | Unchanged                  | Unchanged            | Incrementing        |
| Hot lane latest-value read (skip) | Unchanged                  | Unchanged            | May gap             |

---

## 10. Instance Lifecycle

### 10.1 V1 Stance: Fixed-Instance-Only

In v1, projection instances are **statically enumerated at system initialization time**. Dynamic instance creation,
discovery, and teardown are not supported.

Instance keys are known before any publication occurs. They are not discoverable from the publication stream. Consumers
do not subscribe to a registry to learn what instances exist.

This constraint is explicit doctrine, not an oversight. Dynamic instance discovery is deferred to a future
`projection.registry` contract family.

---

### 10.2 Instance Enumeration

In Dekzer's v1 deployment:

| Contract            | Instance Keys       |
|---------------------|---------------------|
| `deck.runtime`      | `deck.a`, `deck.b`  |
| `mixer.runtime`     | `mixer.primary`     |
| `engine.health`     | `engine.primary`    |
| `workspace.runtime` | `workspace.primary` |
| `library.browse`    | `library.primary`   |

These are the exhaustive sets. Adding an instance requires a versioned system configuration change.

---

### 10.3 Instance Silence

An instance that exists in the static enumeration but has not yet published is **silent**. Consumers waiting for a
silent instance may wait indefinitely. Silence is not the same as teardown.

A consumer must be able to tolerate indefinite silence on a valid instance key without treating it as an error. Timeouts
or staleness detection are application-layer concerns, not substrate concerns.

---

### 10.4 Instance Teardown

In v1, instance teardown is implicit. The authority stops publishing. From the consumer's perspective, the most recent
publication is the last valid state. There is no explicit tombstone signal.

Consumers should not interpret publication silence as an error for static instances. Authority restart will eventually
resume with an incremented `continuityGeneration` or, if appropriate, an incremented `baselineEpoch`.

---

### 10.5 Instance Key Reuse

In v1, instance key reuse after teardown is **an error**. An instance key identifies a stable domain. If a domain must
be replaced, the correct action is:

- Increment `baselineEpoch` at minimum.
- If the semantic meaning of the instance has changed in a way that invalidates prior state, increment `baselineEpoch`.
- If the same key is reused for a structurally different domain, the contract key itself should be revisited.

In a future version with dynamic instances, instance key reuse under `baselineEpoch` increment may be explicitly
permitted. Not in v1.

---

### 10.6 Future: projection.registry

The `projection.registry` contract family will be the mechanism for dynamic instance announcement and retraction. It is
reserved for future definition. It is not implemented in v1. Any code that implements implicit dynamic instance
discovery before this family is specified is out of spec.

---

## 11. First Projection Family: Replaceable Snapshot Projections

### 11.1 Definition

A **replaceable snapshot projection** is a projection where every publication is a complete, self-contained snapshot of
the authority's current state for that projection.

- A consumer receiving the latest publication needs no prior state.
- Missed intermediate publications are not errors for this family.
- Continuity generation breaks require derived-state reset. They do not require a resync request; the next publication
  is already complete.
- Baseline epoch breaks require consumer rebasing.

### 11.2 Continuity Policy: `replaceable-latest`

Consumer may skip intermediates safely. Must reset derived state on `continuityGeneration` increment. Must rebase on
`baselineEpoch` increment. Does not need to request a resync snapshot after a continuity break.

### 11.3 Cold Lane Semantics for This Family

The cold lane supports two materialization patterns for this family:

**Latest-snapshot materialization**: one row per instance; upserted on each cold-lane publication. The row always holds
the most recent complete snapshot.

**Checkpointed snapshot series**: one row per
`(projectionInstanceKey, baselineEpoch, continuityGeneration, publicationSequence)`. Each row is a complete snapshot. No
delta relationship between adjacent rows. Consumers must not attempt cross-row reconstruction.

Append-log semantics are explicitly not a property of this family. See section 13.

### 11.4 The Invariant

For any replaceable snapshot projection, on any lane, in any recovery scenario:

> The consumer holding the most recently received publication for a given projection instance is always in a valid,
> self-consistent state for that projection surface, regardless of how many intermediate publications it missed.

This is the acceptance criterion for any lane implementation claiming to support this family.

### 11.5 What Does Not Belong in This Family

- Event logs (cue point hits, beat events, audit trail): continuity-sensitive, accumulative.
- Prepared track analysis records (beatgrid, key detection): durable records, not runtime snapshots.
- Command acknowledgments: intent-flow responses; travel on command transport.
- Append-only history series: a distinct family with different consumer obligations.

---

## 12. Applied Dekzer Examples

Two canonical examples in this document. One hot+warm+cold contract. One warm-only contract. Additional domain contracts
belong in a separate implementation brief.

---

### 12.1 DeckRuntimeProjection

```ts
const deckRuntimeContract = defineProjectionContract({
    key: "deck.runtime",
    revisionNote: "v1: deck transport, position, eq, filter, peaks, engine meters",
    family: "replaceable-snapshot",

    fields: {
        transport: {
            tempo: f64(),
            phase: f64(),
            playing: bool(),
            looping: bool(),
            loop: {
                startBars: f64(),
                lengthBars: f64(),
            },
            sync: {
                enabled: bool(),
                source: enumU8(["internal", "midi", "link"]),
                phaseOffset: f64(),
            },
        },
        position: {
            sample: u64(),
            bars: f64(),
        },
        eq: {
            low: f32(),
            mid: f32(),
            high: f32(),
        },
        filter: {
            enabled: bool(),
            cutoff: f32(),
            resonance: f32(),
        },
        peaks: {
            preFader: {left: f32(), right: f32()},
            postFader: {left: f32(), right: f32()},
        },
        engine: {
            bufferHealth: f32(),
            xruns: u32(),
        },
    },

lanes: {
        hot: {codec: "mapped-fixed"},
        warm: {codec: "framed-snapshot"},
    },
})

**Authority**: Rust audio engine.
**Instances**: `"deck.a"`, `"deck.b"`. Independent publication streams.
**Hot lane**: primary renderer waveform and transport display.
**Warm lane**: auxiliary tool windows, secondary deck surfaces.
**Cold lane**: not declared. `coldCodecVersion` is reserved and unratified. Cold materialization remains a future
capability blocked on a cold materialization codec spec. Until `coldCodecVersion` is ratified, product contracts must
not declare cold publication lanes in v1 implementation examples.

All fields are `FixedScalar` or `FixedEnum`. Hot admissible: yes. Resolver accepts the hot and warm lane declarations.

---

### 12.2 WorkspaceRuntimeProjection

```ts
const workspaceRuntimeContract = defineProjectionContract({
    key: "workspace.runtime",
    revisionNote: "v1: layout realization state, focus, interaction",
    family: "replaceable-snapshot",

    fields: {
        layout: {
            topologyKey: varString(),
            // identifies the authored topology being realized; changes when topology is replaced
            realizationKey: varString(),
            // changes when the full layout is replaced; renderer uses this to conditionally
            // tear down and rebuild DOM realization.
            // IMPORTANT: this is a semantic payload identity field, not a publication metadata
            // epoch. Whether a layout replacement also constitutes a baselineEpoch increment
            // is an independent authority decision. realizationKey answers "what changed";
            // baselineEpoch answers "does the consumer binding need to rebase".
        },
        focus: {
            activeHostId: varString(),
            primaryDeckSlot: enumU8(["a", "b", "none"]),
        },
        interaction: {
            resizeActive: bool(),
            dragActive: bool(),
        },
    },

    lanes: {
        warm: {codec: "framed-snapshot"},
    },
})
```

**Authority**: Electron main (workspace layout engine).
**Instances**: `"workspace.primary"`.
**Hot lane**: not declared. Workspace layout changes at low frequency; warm IPC is correct.
**Cold lane**: not declared. Workspace authored topology is separately persisted in SQLite as a durable configuration
concern. This projection is the live realization surface.

`varString()` fields: hot not declared; resolver does not check hot admissibility.

---

## 13. Rejected Alternatives

These are structural rejections. Each names the failure mode.

---

**Reject: `params` and `meters` as projection contract top-level nouns.**
Leaks authority-internal write-side roles into the consumer-facing contract. From the consumer, all fields are read-only
published surface. The split creates an inconsistent keyspace (why does `transport.tempo` have no prefix but
`peaks.left` would have `meters.`?). Replacement: `fields`.

---

**Reject: manual `version: N` as the compatibility source of truth.**
Humans forget to bump, bump for the wrong reasons, or bump without understanding breakage. The number diverges from
actual contract state. Replacement: `semanticVersion` generated from canonical manifest hash.

---

**Reject: a single `contractVersion` covering semantic fields and lane declarations.**
Adding cold-lane support would force hot consumers to rebuild even though the hot layout did not change. Replacement:
`semanticVersion` (fields only) + per-lane version hashes (`hotLayoutVersion`, `warmCodecVersion`, `coldCodecVersion`).

---

**Reject: `projectionInstanceKey` absent from publication metadata.**
Without instance scoping, baseline epoch, continuity generation, and publication sequence are meaningless across a
multi-instance contract. Cross-instance publications corrupt consumer state silently.

---

**Reject: payload-level fields that duplicate publication metadata semantics.**
The original offense was `layout.realization_epoch` duplicating `baselineEpoch`. Two fields claiming ownership of the
same epoch concept. Different consumers silently read different fields. Replacement: `realizationKey` (semantic payload
identity: what changed) is distinct from `baselineEpoch` (consumer binding signal: does the binding need to rebase).
They may move together or independently. They must never be the same field.

---

**Reject: `laneSupport: [...]` as a lane declaration.**
A membership list does not say how the contract is represented on the lane or whether field shapes are admissible there.
Replacement: structured lane declarations with codec:
`{ hot: { codec: "mapped-fixed" }, warm: { codec: "framed-snapshot" } }`.

---

**Reject: variable-shape fields on the hot lane.**
`VariableMap` and `VariableString` have no fixed byte footprint. The seqlock region cannot accommodate them.
Replacement: these shapes are never hot-admissible. `BoundedArray` and `BoundedMap` are conditionally admissible only
with `hotReservation: true` and a declared maximum.

---

**Reject: fixed-reservation requiring full-tail sentinel writes on every publication.**
Writing the full unused tail on every hot-lane publication adds unnecessary write cost on the hottest path. Correctness
is already guaranteed by the live count field and seqlock. The tail is unspecified. Authority writes count + live
entries. Consumer reads count + live prefix. Nothing else is required.

---

**Reject: cold checkpoint key without `continuityGeneration`.**
`publicationSequence` resets to 0 on each continuity generation increment while `baselineEpoch` may stay unchanged.
Without `continuityGeneration` in the composite key, two rows from different continuity generations at the same sequence
number within the same baseline epoch collide. Correct key:
`(projectionInstanceKey, baselineEpoch, continuityGeneration, publicationSequence)`.

---

**Reject: cold lane characterized as "accepts all shapes without validation."**
Cold is not semantically trivial. It requires a declared materialization strategy per contract. Cold codec version and
materialization details must be specified before cold-lane publication is implemented. "We'll figure it out later" is
not an admissible stance.

---

**Reject: dynamic instance discovery without a `projection.registry` contract family.**
Dynamic instance lifecycle is not defined in v1. Any code implementing implicit discovery before `projection.registry`
is specified is out of spec. V1 is fixed-instance-only. Instance keys are statically enumerated at system initialization
time.

---

**Reject: instance key reuse without `baselineEpoch` increment.**
An instance key identifies a stable domain. Reusing it for a structurally or semantically different domain without
incrementing `baselineEpoch` causes consumers to interpret a new domain's publications as continuous with the previous
domain's state. In v1, reuse is an error.

---

**Reject: consumer or authority code using raw dot-path string literals for field access.**
Typos compile silently. Field renames produce runtime failures. Hand-authored raw dot-path strings must not serve as the
normal field access path. Acceptable replacement patterns include generated TypeScript string literal unions derived from
the manifest, generated key mirrors, and generated typed bindings. Generated bindings are the preferred end-state
consumer and authority access model.

---

**Reject: per-lane field subsetting under the same contract key.**
If a lane cannot carry the full projection contract, the solution is a separate contract or a derived contract with a
different key. Publishing a silently narrowed field set under the same contract key breaks Law 13. The consumer
contracted for the full surface. Receiving a silent subset is a correctness violation.

---

**Reject: NaN in f32/f64 fields without explicit `nanSentinel: true` declaration.**
Consumers may not interpret NaN as anything. An undeclared NaN is a contract violation by the authority. The contract
must declare NaN semantics explicitly for any field that requires a "no value" sentinel.

---

**Reject: strings written into the hot-lane mutable publication region.**
String data in the mutable region would require variable-length encoding or fixed-width blobs, and would be rewritten on
every publication. Contract key and instance key are encoded as 128-bit SHA-256 prefix hashes in the immutable header.
Identity validation happens at bind time, not per-publication.

---

**Reject: 32-bit (or any sub-128-bit) truncated SHA-256 for `contractKeyHash` and `instanceKeyHash` in the immutable
header.**
Binding is not the hot path. There is no performance excuse for weak identity at bind time. A false-positive bind, where
the consumer maps the wrong region and reads it as a valid projection, is catastrophic. Truncating to 32 bits leaves a
birthday-bound collision space that is unacceptably small for an identity that gates which memory region gets written
and read as a typed projection. The immutable header must carry at least 128 bits per identity hash. The spec uses the
first 16 bytes of SHA-256 (128 bits). Strings are not stored in the header, but the hash must be strong enough that no
accidental collision can survive a bind-time validation.

---

**Reject: warm-lane delta framing for `replaceable-snapshot` projections.**
The `replaceable-snapshot` family defines every publication as a complete self-contained snapshot. Allowing the warm
lane to transmit deltas under this family would mean a warm consumer must hold prior frame state to reconstruct the
current publication. That directly contradicts the family invariant (section 11.4). The warm lane for this family must always
transmit complete snapshot frames. Delta framing, if ever needed, belongs to a distinct projection family or a future
warm codec extension with its own `warmCodecVersion` and explicit family declaration. It must not be smuggled in as an
optional optimization under the existing family.

---

**Reject: treating the seqlock write protocol as multi-writer-safe.**
The fetch-add on `seqlockCounter` is atomic, but that does not make the seqlock protocol safe under multiple concurrent
writers. If two writer threads both increment the counter, both enter their respective write phases, and both increment
again, the consumer sees two interlaced writes with a counter that appears valid (even) at the end. The consumer's retry
loop detects writer presence only by observing an odd counter at read-start or a changed counter at read-end; it cannot
detect two interleaved writers who collectively produced an even counter. The result is silent semantic corruption. SWMR
is a precondition of the protocol, not an emergent property of it. The binding layer must enforce SWMR before any writer
accesses the region.

---

**Reject: `BoundedMap` live-entry order left undefined.**
If the same logical map can be serialized in arbitrary entry order across publications, binary equality checks,
deterministic unit tests, checkpoint diffs, and cross-lane comparisons all become noisier and less trustworthy. The ABI
is not fully deterministic if entry order is implementation-defined. Live entries must be sorted lexicographically by
encoded key bytes on every publication. This is the authority's responsibility. Two publications representing the same
logical map state must produce bit-identical entry sequences in the live prefix.

---

**Reject: upper-camel or mixed-case segment initials in identifier grammar.**
Allowing `[A-Z]` as a valid first character of a segment creates unnecessary identifier entropy: `Deck.runtime`,
`deck.Runtime`, and `deck.runtime` would all be legal and distinct. A system whose whole point is deterministic,
collision-free identity cannot afford that entropy in its own keyspace. The grammar mandates lowercase-initial
segments (`[a-z][a-zA-Z0-9]*`). This is a hard resolver constraint, not a style guideline.

---

**Reject: snake_case field names in the TS authoring DSL.**
The TS authoring surface is the canonical language-specific front-end. camelCase is idiomatic. Generated field
identity artifacts produce camelCase property access. Downstream codegen (Rust, SQLite) applies its own convention
translation. That is a codegen concern, not an authoring concern.
