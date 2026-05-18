# Compiler and Conformance Layout

Companion to:

- Exclave Projection Spine: Canonical Architecture Spec
- Hot Lane Codec and Layout Spec
- Hot Lane Consumer Runtime
- Warm Codec v1
- Resource Plane v1
- Hot SAB Lifecycle

Status: Draft for ratification. Intended to become implementation-authoritative for build-time compiler ownership,
generated artifacts, fixture layout, and cross-language conformance.

This document defines the build-time compiler and conformance contract for Exclave projection and lane artifacts.

It does not redefine authored projection semantics, hot ABI layout, warm frame encoding, resource protocol behavior, or
runtime session lifecycle. Those concerns belong to their companion documents.

If this document and a lane codec document disagree on binary layout or encoding rules, the lane codec document is
authoritative and this document is wrong.
If this document and the projection spine disagree on canonical projection semantics, the spine is authoritative and
this document is wrong.

---

## 1. Purpose

The compiler is the build-time authority that turns authored contracts into canonical manifests, lane manifests,
generated bindings, and conformance fixtures.

This document defines:

- where the planner/compiler belongs
- what inputs it accepts
- what artifacts it emits
- which artifacts are canonical versus generated convenience
- how Rust authority code and TS consumer code consume the same artifacts
- how cross-language conformance is structured
- what CI must prove before runtime integration is allowed

---

## 2. Protocol rules

### 2.1 The compiler is build-time, not runtime

The compiler must not be part of the runtime hot path.

Runtime packages consume emitted artifacts.
They do not plan layouts, derive codec versions, or reinterpret authored contracts during live operation.

### 2.2 One authored contract produces one canonical manifest

An authored projection contract must normalize into one canonical manifest.

Downstream lane manifests, generated bindings, **runtime descriptor types**, and conformance fixtures derive from that
canonical manifest where applicable.

There must not be parallel canonical forms for Rust, TS, host adapters, or tests.

> **Descriptor types versus descriptor instances**: the compiler emits descriptor type expectations and manifest-backed
> validation inputs. It does not issue live hot handles, resource handles, mapping descriptors, or subscription
> acknowledgements. Those are **runtime descriptor instances** issued at runtime by authorities, session registries, or
> handle registries. Runtime descriptor instances may reference emitted manifests (e.g. for bind-time validation), but
> they are not compiler-emitted live objects. A design that pre-generates descriptor instances from compiler output has
> collapsed the build-time/runtime boundary. Compiler output is a type contract; runtime issuance is a lifecycle event.

### 2.3 Lane artifacts are derived, not hand-authored

Hot layout manifests, warm codec manifests, cold materialization manifests, generated Rust writers, generated TS
readers, and conformance fixtures are derived artifacts.

They must not be edited by hand.

Manual artifact edits are contract corruption unless the artifact is explicitly marked as a human-authored fixture
input.

### 2.4 Rust and TS must not independently plan layout

Rust authority code and TS consumer code consume the same emitted manifests.

They must not re-run independent planners that can diverge.

Language-specific code may generate helpers from the manifest, but the manifest is the shared input.

### 2.5 Conformance is required before exchange

No Rust authority may exchange hot or warm publications with a TS consumer unless the relevant conformance tests pass
for that contract and lane.

A passing typecheck is not enough.
A passing unit test in one language is not enough.
The byte-level and version-level agreement must be proven.

### 2.6 Runtime adapters do not own contract meaning

Electron, host adapters, IPC routers, and transport layers may carry artifacts or descriptors.

They do not own:

- field layout
- codec rules
- resource semantics
- continuity semantics
- lane admissibility
- version identity

### 2.7 Versions are derived identities

`semanticVersion`, `hotLayoutVersion`, `warmCodecVersion`, and future `coldCodecVersion` are derived identities.

They must not be manually bumped by humans.

### 2.8 Conformance fixtures are product assets

Cross-language fixtures are not package-local convention.

They are product-level compatibility evidence and must live where Rust, TS, and CI can all consume them.

---

## 3. Compiler home

The compiler belongs in a build-time package or tool, not in runtime core.

The recommended package boundary is:

- `@exclave/schema`: authored contract types, syntactic legality checks, structural validation that does not require
  canonicalization, and JSON Schema artifact
- `@exclave/compiler`: authored-to-canonical normalization, semantic and cross-cutting legality checks, canonical
  manifest emission, lane planning, codegen orchestration, fixture emission
- `@exclave/hot-codec`: hot ABI rules and generated reader/writer helpers
- `@exclave/warm-codec`: warm framed-snapshot codec rules and helpers
- `@exclave/conformance`: shared fixture runner and cross-language assertions

Package names may be adjusted during implementation, but the ownership split is fixed:

**Compiler ownership is build-time ownership, not runtime core ownership.**

`@exclave/core`, if it exists, must not become a dumping ground for compiler, codec, adapter, and conformance ownership.

---

## 4. Compiler inputs

The compiler accepts:

- authored projection contracts
- authored lane declarations
- canonical type taxonomy
- declared projection family
- declared resource references if the contract carries resource identity
- target generation configuration
- generation profile for language outputs

The compiler must reject:

- structurally invalid authored contracts
- lane declarations whose field shapes are not admissible for that lane
- warm declarations whose payload would require resource-plane bodies
- hot declarations whose field shapes cannot be represented in the hot layout
- duplicate field paths
- unstable or implementation-defined ordering
- ambiguous resource references
- contracts whose derived artifacts cannot be generated deterministically

The compiler must not accept hidden runtime state as an input to manifest generation.

---

## 5. Emitted artifacts

For each compiled projection contract, the compiler emits the artifacts required by the declared lanes.

Possible artifacts include:

- `canonicalManifest.json`
- `hotLayoutManifest.json` when hot lane is declared
- `warmCodecManifest.json` when warm lane is declared
- `coldMaterializationManifest.json` when cold lane is declared
- generated TS consumer bindings
- generated Rust authority bindings
- generated conformance fixtures
- optional human-readable manifest report

### 5.1 Canonical artifacts

Canonical artifacts are inputs to runtime generation and conformance:

- canonical manifest
- lane manifests
- conformance fixture manifests
- invalid-case fixture definitions

These artifacts are derived and must not be hand-edited.

### 5.2 Generated convenience artifacts

Generated bindings are derived from canonical artifacts.

They may be regenerated at any time and must not be edited by hand.

Generated convenience artifacts include:

- TS consumer bindings
- Rust authority writer helpers
- decoder helpers
- fixture-specific test harness glue
- optional report files

### 5.3 Human-authored fixture inputs

A fixture may include human-authored logical sample input, such as:

- a sample authored contract
- logical sample publication values
- expected resource-open input shapes
- intentional invalid-case descriptions

Those fixture inputs are not generated artifacts.
They are part of the conformance corpus.

The generated expected bytes, offsets, hashes, and decoded snapshots are derived from those inputs.

---

## 6. Artifact identity and versioning

The compiler must derive:

- `semanticVersion` from canonical projection semantics
- `hotLayoutVersion` from hot layout manifest hash coverage
- `warmCodecVersion` from warm codec hash coverage
- `coldCodecVersion` from cold materialization hash coverage once defined

These identities must be derived, not manually bumped.

### 6.1 Semantic version identity

`semanticVersion` covers the canonical projection semantics.

It must change when the logical projection contract changes in a way that affects consumer interpretation.

### 6.2 Hot layout identity

`hotLayoutVersion` covers the hot ABI layout:

- region byte length
- header compatibility inputs
- seqlock location
- field offsets
- field widths
- alignment and padding consequences
- hot-admissible field representation

### 6.3 Warm codec identity

`warmCodecVersion` covers the warm frame format and payload encoding rules.

It must use the hash coverage defined by Warm Codec v1.

### 6.4 Cold codec identity

`coldCodecVersion` is reserved until the cold materialization codec is specified.

It must not become a hand-maintained placeholder.

### 6.5 Lane independence

A lane version change must not force unrelated lane consumers to reject a contract they still understand.

Examples:

- a hot layout change does not automatically change `warmCodecVersion`
- a warm codec framing change does not automatically change `hotLayoutVersion`
- a resource contract change does not automatically change publication lane versions unless the projection contract
  carries that resource identity in its semantics

---

## 7. Artifact locations and status

The implementation must distinguish artifact status explicitly.

### 7.1 Source artifacts

Source artifacts are human-authored inputs.

Examples:

- authored contract files
- human-authored conformance sample values
- invalid-case fixture specs

### 7.2 Derived committed artifacts

Derived committed artifacts are generated but checked in because runtime packages or cross-language tests consume them
directly.

Examples:

- canonical manifests for fixture contracts
- lane manifests for fixture contracts
- expected byte fixtures
- generated bindings when committed for package distribution

### 7.3 Derived transient artifacts

Derived transient artifacts are generated during build or test and not committed.

Examples:

- local temporary codegen outputs
- generated fixture runner glue
- comparison reports

### 7.4 Artifact status must be declared

Every generated artifact family must declare whether it is:

- source
- derived committed
- derived transient

A generated artifact family must not float between statuses depending on developer convenience.

---

## 8. Manifest consumption requirement

Runtime code consumes manifests.

It does not reinvent them.

### 8.1 Rust authority consumption

Rust authority code consumes emitted manifests to:

- allocate hot regions
- write hot headers
- write hot field bytes
- emit warm frames
- validate generated writer expectations
- participate in conformance fixtures

Rust authority code must not independently plan field offsets or warm payload order.

### 8.2 TS consumer consumption

TS consumer code consumes emitted manifests to:

- bind hot mappings
- validate hot header compatibility
- read hot fields
- decode warm frames
- validate codec versions
- participate in conformance fixtures

TS consumer code must not independently plan field offsets or warm payload order.

### 8.3 Host/adapter consumption

Host/adapters may consume manifests to:

- route handles
- validate declared byte lengths
- deliver descriptors
- reject incompatible mappings early

Host/adapters must not become the owner of field layout, codec identity, or projection semantics.

---

## 9. Generated binding requirement

Generated bindings are projection-specific APIs derived from canonical artifacts.

They must not smuggle new semantics.

### 9.1 TS generated consumer bindings

TS generated consumer bindings may expose:

- typed hot projection readers
- typed warm frame decoders
- typed metadata accessors
- typed failure/result wrappers
- fixture helpers for conformance

They must not:

- mutate authority-owned state
- infer continuity semantics locally
- access cold rows as recovery state
- treat resource mappings as hot publications
- use DataView reads for hot seqlock sequence counters

### 9.2 Rust generated authority bindings

Rust generated authority bindings may expose:

- typed hot region writers
- typed warm frame encoders
- typed publication metadata writers
- typed conformance fixture writers

They must not:

- hand-plan offsets outside emitted manifests
- emit warm frames with hand-maintained codec versions
- bypass lane admissibility
- encode resource bodies into warm frames

### 9.3 Binding output is not the contract source

Generated bindings are convenient language surfaces.

The manifest remains the contract artifact that proves cross-language agreement.

---

## 10. Cross-language conformance corpus

Conformance fixtures must be language-neutral.

At minimum, each fixture set includes:

- authored contract input
- canonical manifest
- lane manifests
- logical sample publications
- expected hot field offsets and widths
- expected hot region byte length
- expected warm frame bytes
- expected decoded logical snapshots
- invalid bind/header cases
- invalid warm frame cases
- resource-reference boundary cases where relevant

The conformance corpus must include both valid and invalid cases.

A conformance fixture must not rely on developer memory or package-local setup conventions to explain expected behavior.

---

## 11. Hot conformance

Hot conformance must prove:

- Rust and TS agree on `hotLayoutVersion`
- Rust and TS agree on region byte length
- Rust and TS agree on sequence-counter offset
- Rust and TS agree on all field offsets and widths
- Rust-written sample regions decode to expected TS snapshots
- TS-written fixture expectations match Rust-observed layout
- invalid Block A headers are rejected
- wrong region byte length is rejected
- wrong `semanticVersion` is rejected
- wrong `hotLayoutVersion` is rejected
- stale invalidation stops live reads at runtime level
- old handles do not survive replacement by fixture convention

Hot conformance is not satisfied by checking manifest JSON shape alone.
It must prove byte-level agreement.

### 11.1 Fixture-backed TypeScript hot exchange proof

The `hot-exchange-v0` projection-runtime fixture is the first closed TypeScript proof for the hot lane. It starts from
an authored contract, compiles the canonical manifest, derives the hot layout manifest, writes a complete hot fixture
region, reads it through the bounded `@exclave/hot-consumer` kernel over a `SharedArrayBuffer` sequence view, and
compares the decoded snapshot with the authored logical sample values.

This proof is not runtime binding lifecycle, SAB lifecycle management, Electron or host adapter behavior, or Rust/TS
cross-language exchange. It is the prerequisite evidence before generated bindings or Rust writer work.

---

## 12. Warm conformance

Warm conformance must prove:

- Rust and TS agree on `warmCodecVersion`
- the same logical publication and same stream-level `laneSequence` configuration produce byte-identical frames
- valid complete frames decode without prior-frame state
- recoverable malformed frames are rejected without exposing partial state
- stream-fatal incompatibilities poison the stream
- oversized warm frames are rejected before allocation or decode
- duplicate map keys are rejected
- map ordering is deterministic and strictly increasing
- `authorityEpoch` is not embedded in warm frames

Warm conformance must respect the recoverable versus stream-fatal split from Warm Codec v1.

---

## 13. Resource conformance

Resource conformance must prove:

- open inputs are typed and reject generic option bags
- default open is epoch-establishing
- open replies bind handle to authority epoch and resource version
- returned `resourceKey` is derived by the authority or resource contract
- descriptors do not carry bodies or large body fragments
- chunk and mapping bounds are enforced before allocation
- invalidation kills reads and mapped windows
- resource replacement invalidates old handles
- authority restart invalidates old handles
- `mappingInvalid` is distinct from `handleInvalid`
- resource failures remain distinct from transport errors
- resource bodies do not appear in control replies or publication fixtures

Resource conformance must prove the resource plane remains a handle protocol, not a fetch API.

---

## 14. Cold conformance reservation

Cold materialization conformance is reserved until the cold materialization codec is specified.

When defined, it must prove at least:

- `coldCodecVersion` derivation
- latest-snapshot row compatibility
- checkpointed snapshot row compatibility
- no cross-row reconstruction for replaceable-snapshot reopen
- metadata reset rules for same-domain restart and baseline replacement
- rejection of incompatible cold rows

Until that codec exists, implementations must not pretend `coldCodecVersion` has complete conformance coverage.

---

## 15. Fixture invalid-case families

The conformance corpus must include invalid-case families.

### 15.1 Hot invalid cases

Hot invalid cases include:

- wrong magic
- wrong ABI version
- wrong contract key hash
- wrong instance key hash
- wrong semantic version
- wrong layout version
- wrong region byte length
- non-zero reserved bytes
- stale mapping invalidation before read
- handle replacement requiring new bind

### 15.2 Warm invalid cases

Warm invalid cases include:

- malformed frame length
- malformed payload length
- invalid boolean byte
- invalid enum discriminant
- bounded count overflow
- duplicate map keys
- unsorted map keys
- UTF-8 violation
- contract key mismatch
- projection instance key mismatch
- semantic version mismatch
- warm codec version mismatch
- laneSequence presence toggle

### 15.3 Resource invalid cases

Resource invalid cases include:

- generic option bag open rejected
- stale authority epoch rejected on read/map/close
- invalid handle id rejected
- invalid mapping id rejected distinctly from invalid handle id
- oversized chunk rejected before allocation
- oversized mapping rejected before allocation
- descriptor body smuggling rejected
- resource replacement invalidates prior handle
- authority restart invalidates prior handle

---

## 16. CI gates

A runtime integration slice must not land unless:

- compiler emits stable artifacts for fixture contracts
- generated TS compiles
- generated Rust compiles
- hot conformance passes for touched hot contracts
- warm conformance passes for touched warm contracts
- resource conformance passes for touched resource contracts
- regenerated committed artifacts match checked-in artifacts
- any generated artifact diff is intentionally reviewed
- package-local tests do not replace shared conformance

CI must fail if a developer changes authored contracts or codec rules without regenerating and validating derived
artifacts.

---

## 17. Regeneration workflow

A regeneration workflow must be explicit.

At minimum, it must support:

- compile authored contract inputs
- emit canonical manifests
- emit lane manifests
- emit generated bindings
- emit conformance fixtures
- run Rust conformance
- run TS conformance
- compare committed generated artifacts against regenerated output

The workflow must have one canonical command or documented sequence.

Developers must not regenerate artifacts through ad hoc scripts that bypass the compiler.

---

## 18. Review rules for artifact diffs

Generated artifact diffs are not noise.

Reviewers must check:

- whether the authored input changed
- whether the compiler changed
- whether the lane codec rule changed
- whether derived version identities changed for the right reason
- whether unrelated lane artifacts changed unexpectedly
- whether conformance fixtures were updated with the artifact change
- whether generated bindings reflect the same manifest as Rust and TS conformance

A generated diff with no explaining source change is suspicious.

---

## 19. Package ownership boundaries

### 19.1 `@exclave/schema`

Owns:

- authored contract types
- **syntactic legality** checks for authored AST shape: is this a structurally valid authored input before any
  normalization occurs?
- structural validation that does not require canonicalization or cross-field semantic analysis
- JSON Schema artifact for authored contract interchange

Examples of schema-owned rejection:

- invalid identifier grammar (segment violates `[a-z][a-zA-Z0-9]*`)
- malformed authored tree shape (e.g. missing required keys)
- empty enum variant list
- invalid scalar type name
- malformed lane declaration syntax
- field name collisions at the authored surface (identical dotPath siblings)

Does not own:

- authored-to-canonical normalization
- semantic and cross-cutting legality decisions
- lane admissibility validation (requires canonicalized field shapes)
- fieldId derivation and collision rejection (a canonical concern)
- canonical manifest emission
- `semanticVersion` or any lane version derivation
- lane planning
- generated runtime bindings
- byte layout decisions
- codec version derivation
- conformance runners

**The line**: schema validates syntactic legality of authored input. It answers "is this authored AST structurally
well-formed?" It does not answer "is this contract semantically coherent or cross-lane legal?" Semantic questions belong
to the compiler.

### 19.2 `@exclave/compiler`

Owns:

- authored-to-canonical normalization (structured transform from authored AST to `CanonicalProjectionManifest`)
- canonical manifest emission
- **semantic and cross-cutting legality** checks: requires a partially or fully normalized form
- fieldId derivation and collision rejection
- lane admissibility validation (hot, warm, cold per section 7 of the spine)
- `semanticVersion` derivation from canonical manifest hash
- lane version derivation (`hotLayoutVersion`, `warmCodecVersion`, `coldCodecVersion`)
- lane planning orchestration
- artifact emission (canonical manifests, lane manifests, conformance fixtures)
- generated binding orchestration (delegates to lane codec packages)
- generated field identity artifact emission (string literal unions, key mirrors, typed bindings — all derived from the canonical manifest)
- determinism enforcement over generated artifacts

Examples of compiler-owned rejection:

- duplicate canonical field paths after normalization
- fieldId collision (two distinct dotPaths resolving to the same fieldId)
- hot lane declared for field shapes not hot-admissible (VariableMap, VariableString, unreserved
  BoundedArray/BoundedMap)
- warm declaration that would carry resource-plane bodies
- unstable or implementation-defined ordering in the normalized form
- canonical hash cannot be derived deterministically from the authored input
- `semanticVersion` or lane version derivation fails

Does not own:

- live runtime session behavior
- transport adapters
- host mapping lifecycle
- product-specific resource body formats

> **Why this line matters**: if schema accumulates semantic validation that belongs in the compiler, such as lane
> admissibility checks that require knowing canonical field shapes, schema becomes a shadow compiler. Two components
> then enforce overlapping rules in independently evolving codepaths, which recreates the split-brain problem through
> the back door. Schema checks syntax. Compiler checks semantics. Both reject authored contracts, but for different
> reasons at different stages.

### 19.3 Lane codec packages

Own:

- lane-specific binary encoding rules
- lane-specific helper generation
- lane-specific validation helpers
- lane-specific conformance assertions

Do not own:

- authored contract semantics
- runtime session lifecycle
- unrelated lane planning

### 19.4 `@exclave/conformance`

Owns:

- shared fixture runner
- cross-language fixture execution
- assertion vocabulary
- CI-facing conformance commands

Does not own:

- compiler decisions
- product runtime state
- host adapters

### 19.5 Runtime packages

Own:

- live runtime operations
- session-bound behavior
- publication application
- handle lifecycle
- adapter integration

Do not own:

- authored contract meaning
- lane artifact derivation
- conformance fixture generation

---

## 20. Acceptance criteria

A compliant implementation satisfies all of the following:

- one authored contract produces one canonical manifest
- lane manifests derive from the canonical manifest
- lane manifests are not hand-edited
- generated bindings are not hand-edited
- Rust and TS consume the same emitted manifests
- Rust and TS do not independently plan layout
- version identities are derived, not manually bumped
- hot conformance proves byte-level layout agreement
- warm conformance proves byte-level frame agreement
- resource conformance proves handle protocol boundaries
- fixture invalid cases cover rejection paths, not only happy paths
- CI blocks runtime integration when relevant conformance fails
- regenerated committed artifacts match checked-in artifacts or are intentionally reviewed

---

## 21. Rejected alternatives

### Rejected: Rust and TS independently planning layout

Independent planners can diverge. Both sides consume the same emitted manifests.

### Rejected: hand-editing generated lane manifests

Lane manifests are derived artifacts. Manual edits destroy the compiler as the generation owner.

### Rejected: putting the compiler inside runtime core

The compiler is build-time authority. Runtime packages consume artifacts.

### Rejected: package-local conformance

Cross-language byte agreement is a product-level invariant and must live in a shared harness.

### Rejected: version numbers manually bumped by humans

Semantic and lane versions are derived identities. Manual bumping invites stale compatibility lies.

### Rejected: host adapter as contract owner

Hosts carry descriptors and mappings. They do not own projection contracts, layout, codec rules, or resource
semantics.

### Rejected: generated artifact diffs as unreviewable noise

Generated diffs are evidence that authored inputs, compiler rules, or codec rules changed. They require review.

### Rejected: conformance only for happy paths

Invalid cases are where cross-language drift becomes dangerous.

### Rejected: runtime integration before conformance

Live Rust/TS exchange depends on byte-level agreement. Integration without conformance is gambling with runtime
state.
