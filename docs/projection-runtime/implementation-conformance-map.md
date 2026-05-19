# Projection Runtime Implementation Conformance Map

This map audits the current repository against the projection runtime doctrine. It maps source and tests that exist
today; it does not define new runtime behavior.

## Source Set Reviewed

- `README.md`
- `docs/projection-runtime/README.md`
- `docs/projection-runtime/boundary-model.md`
- `docs/projection-runtime/projection-spine-canonical-architecture.md`
- `docs/projection-runtime/control-plane-session-rules.md`
- `docs/projection-runtime/resource-plane-v1.md`
- `docs/projection-runtime/warm-codec-v1.md`
- `docs/projection-runtime/hot-lane-codec-and-layout-spec.md`
- `docs/projection-runtime/hot-lane-consumer-runtime.md`
- `docs/projection-runtime/hot-sab-lifecycle.md`
- `docs/projection-runtime/publication-subscription-lifecycle.md`
- `docs/projection-runtime/cold-reopen-sequence.md`
- `packages/*/README.md`
- `packages/*/src/**/*.ts`
- `packages/*/tests/**/*.ts`
- `crates/*/src/**/*.rs`

## Document Authority Notes

`boundary-model.md` and `projection-spine-canonical-architecture.md` are canonical. The spine is
implementation-authoritative for projection identity, lane admissibility, publication metadata, lifecycle rules, and
hot-lane ABI foundations.

`hot-lane-codec-and-layout-spec.md`, `hot-lane-consumer-runtime.md`, and `hot-sab-lifecycle.md` are a joint draft
implementation bundle. They are not independently ratified.

`control-plane-session-rules.md`, `resource-plane-v1.md`, `warm-codec-v1.md`,
`publication-subscription-lifecycle.md`, and `cold-reopen-sequence.md` are draft for ratification. They describe the
intended protocol surface, but current implementation conformance must not be inferred from package names alone.

## 1. Package Inventory

| Package | Current state | Evidence and limits |
| --- | --- | --- |
| `@exclave/base` | implemented | Owns JSON-safety checks, `ExclaveError`, error domains, and invariants. It is foundational, not projection runtime behavior. |
| `@exclave/schema` | implemented | Owns authored contract types, path grammar validation, field-shape syntax, and lane declaration syntax. It does not normalize contracts, derive versions, plan lanes, or generate runtime bindings. |
| `@exclave/compiler` | partially implemented | Emits canonical manifests, sorted fields, field ids, `semanticVersion`, canonical lane declarations, hot layout manifests through `@exclave/hot-codec`, manifest-backed warm lane manifests with `warmCodecVersion` for framed-snapshot warm declarations, field identity modules, and generated TypeScript public consumer binding source/API shape. The generated consumer binding source is now represented in projection-runtime fixture/conformance evidence (hot-basic-v0, deck-runtime-v0, hot-exchange-v0). It retains cold declarations but does not derive `coldCodecVersion` or generate live runtime binding implementations. |
| `@exclave/hot-codec` | partially implemented | Implements hot constants, layout planning, `hotLayoutVersion`, Block A and Block B helpers, deterministic hot field byte helpers, complete fixture-region encode/decode, and tests. It does not allocate SABs, run seqlock runtime loops, open handles, or manage lifecycle. |
| `@exclave/hot-binding` | partially implemented | Validates already-opened SAB-backed regions and returns `BigUint64Array` counter views. It checks Block A expectations and counter offsets but does not own open, close, stale state, generated binding state, or handle lifecycle. |
| `@exclave/hot-consumer` | partially implemented | Implements the bounded read kernel with atomic sequence loads, separate writer-active and torn-read budgets, last-good fallback, and tests. It is not the generated `HotProjectionBinding<T>` state machine. |
| `@exclave/hot-publisher` | partially implemented | Implements a narrow writer-side publication kernel over already-opened Block B counter views. It is not an authority, handle registry, SAB allocator, or generated writer surface. |
| `@exclave/session` | partially implemented | Owns type-level authority session descriptor, session state events, authority invalidation events, and session-bound failure vocabulary. It also provides a product-neutral binding validity fence with `authorityEpoch`, ready/opening/invalidated/closed states, and guard helpers. It does not implement a session manager, epoch issuer, non-reuse enforcement, authority lifecycle runtime, or transport. It does not own resource-handle or hot-handle invalidation events. |
| `@exclave/control-plane` | partially implemented | Provides JSON-safe request/success/failure envelopes and projects binding validity failures. It does not implement operation dispatch, session issuance, resource opens, publication subscribe, or authority lifecycle. |
| `@exclave/resource` | partially implemented | Owns Resource Plane v1 protocol types and validation helpers: typed resource contracts, open/chunk-read/mapped-window/close request and reply types, capabilities discriminated union, resource failure union, resource backpressure, resource-handle invalidation event, and descriptor no-body validation. It does not implement a resource authority registry, transport, IO, cache, media decoding, product ownership, or physical mapped-window backing. |
| `@exclave/warm` | partially implemented | Provides the Warm Codec v1 binary framed-snapshot outer frame subset with deterministic encode/decode, length validation, invalid UTF-8 rejection, optional `laneSequence`, maximum frame-size enforcement, and manifest-derived field-value snapshot payload encode/decode. It does not implement JSON event envelopes, warm frame envelope validation, warm owner shapes, stale binding failure projection, transport, or publication runtime. |
| `@exclave/publication` | partially implemented | Owns publication subscribe request/ack/failure/event types and a modeled warm subscription lifecycle proving ack, initial snapshot application, invalidation, and rebind. It rejects cold subscriptions with `coldLaneNotRatified`. It does not implement real transport, an authority runtime, hot handle open, resource payload access, or cold reopen runtime. |
| `@exclave/host-contract` | partially implemented | Provides host surface descriptors, hot/control/warm/resource lane descriptors (using `descriptorVersion` for warm stream descriptors), grants, and guarded hot-read tests. It does not implement transport, subscriptions, byte transfer, hot handle open/close, or resource lifecycle. |
| `@exclave/conformance` | partially implemented | Runs TypeScript-side fixture conformance, includes generated TS/Rust fixture proofs for hot exchange, includes the first modeled live warm projection path proof, and includes a warm-only payload codec fixture profile with Rust/TypeScript payload and full warm frame byte agreement for warm-payload-v0. It is not yet a full shared runtime conformance harness across all drafted planes. |

## 2. Boundary Model Conformance

Classification: partially implemented.

The repository follows the boundary model at the package boundary level. Control envelopes, publication subscriptions,
warm frames, resource descriptors, hot codec/binding/consumer/publisher kernels, session guards, and host-contract
descriptors are separate packages. Tests prove JSON-safe control and warm payload boundaries, resource receipts that do
not carry byte bodies, publication acks that do not carry snapshot bodies, and guarded hot reads that fail before
reading when session validity fails.

This is not full boundary model conformance. There is no service/authority runtime, no transport layer, no product
authority ownership model, and no production publication transport. Resource-plane v1 protocol and modeled lifecycle
helpers exist, but no runtime resource authority/registry/transport/lifecycle manager exists. The current code proves
separation of selected envelope, subscription, and kernel responsibilities, not an end-to-end boundary runtime.

## 3. Projection Spine Conformance

Classification: partially implemented.

Implemented in source and tests:

- authored path grammar and field-shape syntax in `@exclave/schema`
- canonical manifest emission in `@exclave/compiler`
- lexicographic field ordering by dot path
- deterministic `fieldId` derivation
- `semanticVersion` derivation from canonical manifest bytes
- checked canonical byte writers in `@exclave/base` (`AbiCanonicalByteWriter`) reject out-of-range numeric values instead of silently truncating; `semanticVersion` and `warmCodecVersion` derivation use checked writers
- hot lane admissibility checks
- hot layout manifest emission when a hot lane is declared
- warm lane manifest emission and `warmCodecVersion` derivation for framed-snapshot warm declarations
- warm and cold lane declarations retained as canonical declarations
- hot Block A and Block B metadata represented in hot fixture helpers

Gaps:

- The compiler emits field identity artifacts, deterministic TypeScript field identity modules, and deterministic
  TypeScript public consumer binding source/API shape derived from the canonical manifest and lane manifests. The
  generated consumer binding source is now represented in projection-runtime fixture/conformance evidence.
  Live bind/read/subscribe/decode behavior remains future runtime work.
- No runtime projection instance registry or fixed-instance runtime layer exists.
- No generated public consumer binding runtime exists in package source.
- Publication metadata exists for the modeled warm subscription path, but not as a full runtime model across hot, warm,
  and cold lanes.
- `coldCodecVersion` remains reserved and is not derived.
- Cold materialization semantics are not implemented.

The spine is canonical, but current code covers the schema/compiler/hot-layout portion more than the runtime publication
and lifecycle portions.

## 4. Hot Lane Codec/Layout Conformance

Classification: partially implemented.

Implemented in source and tests:

- hot ABI constants: 72-byte Block A, Block B at 72, seqlock at 72, publication header at 80/84/88, field data at 96
- deterministic planner, alignment, byte-span, reservation, and region-size logic
- `hotLayoutVersion` derivation with domain-specific numeric rejection preserving `hotCodec.layoutRejected` error identity
- Block A identity hashes, version fields, field count, mutable-region byte length, and reserved-byte validation
- Block B header encode/decode/validation for fixture bytes
- field byte helpers for fixed scalars, enums, vectors, fixed strings, bounded arrays, and bounded maps
- complete fixture-region encode/decode
- conformance fixtures for hot layout, hot bytes, complete regions, and generated TS/Rust exchange proofs

Limits:

- The package is build-time and fixture-oriented.
- Runtime handle opening, SAB allocation, session invalidation, generated binding lifecycle, and live authority writer
  ownership are outside current package source.
- Cross-language hot exchange exists as generated fixture/test proof, not as a general runtime implementation.

The hot codec/layout draft is ahead of source where it describes generated TS and Rust binding expectations as a normal
product runtime.

## 5. Hot Consumer Runtime Conformance

Classification: partially implemented.

Implemented in source and tests:

- `Atomics.load(sequence, 0)` over a `BigUint64Array` sequence view
- separate writer-active and torn-read budgets
- zero-budget behavior
- last-good fallback
- rejection of non-shared sequence buffers
- no exposure of torn candidates
- tests using hot-codec complete fixture regions as caller-provided candidate readers

Gaps:

- No `HotProjectionBinding<TProjection>` public generated binding exists.
- No binding state machine with `unbound`, `binding`, `ready`, `stale`, and `closed` exists.
- No `bind()` result surface exists in `@exclave/hot-consumer`.
- No runtime-private invalidation control interface exists.
- Stale and closed states are not enforced by the consumer package; callers gate reads through session/host-contract
  helpers in tests.

The read kernel conforms to an important slice of the draft consumer runtime. The full binding runtime remains ahead of
implementation.

## 6. Hot SAB Lifecycle Conformance

Classification: test-only proof.

Current source contains pieces that can participate in a lifecycle:

- `@exclave/host-contract` describes hot regions and grants.
- `@exclave/hot-binding` validates already-opened SAB-backed bytes and counter offsets.
- `@exclave/session` guards reads by `authorityEpoch` and binding state.
- Host-contract tests prove that invalidation and stale epoch checks prevent guarded hot reads before the reader runs.

Missing lifecycle protocol:

- no `OpenHotProjectionRequest` or `OpenHotProjectionReply`
- no `HotProjectionHandle`
- no `HotMappingDescriptor`
- no handle registry
- no hot close protocol
- no authority-owned allocation or initialization gate
- no pushed `hotHandleInvalidated` event family
- no replacement/remap flow
- no implementation profile for stale close or physical release

The current repo proves selected lifecycle invariants in tests but does not implement the Hot SAB Lifecycle draft.

## 7. Control/Session Conformance

Classification: partially implemented.

Implemented in source and tests:

- `@exclave/session` models `authorityEpoch` as `bigint` and validates already-opened bindings against expected
  authority, surface, and epoch.
- Binding states distinguish opening, ready, invalidated, and closed.
- Control-plane envelopes are JSON-safe and correlate responses to requests.
- Control-plane stale binding failure projection exists.
- `AuthoritySessionDescriptor` discriminated union exists.
- `SessionStateEvent` includes `authorityReady` and `authorityStarting`.
- `SessionInvalidationEvent` includes `authorityEpochReplaced` and `authorityUnavailable`.
- `SessionBoundFailure` includes `sessionMismatch`, `authorityUnavailable`, `authorityNotReady`,
  `requestIllegalByContract`, and `requestIllegalInCurrentProductState`.

Gaps:

- No session manager issues non-reused authority epochs.
- No runtime authority lifecycle state machine exists.
- No transport dispatch binds these events to real process boundaries.
- Existing binding validity helpers remain separate from full authority lifecycle management.
- Epoch-establishing resource open reply and publication subscribe ack are implemented; hot open epoch-establishing
  replies remain future work.

The session/control packages implement a useful validity fence, envelope layer, and session event vocabulary. The draft
session protocol's runtime authority lifecycle and transport remain ahead of implementation.

## 8. Resource Plane Conformance

Classification: partially implemented; Resource Plane v1 protocol surface is implemented at the package/type/
conformance-helper level.

Implemented in source and tests:

- resource owner and descriptor validation
- canonical decimal string authority epoch projection for JSON-safe resource descriptors
- read-range request payload and receipt payload validation
- descriptor-bound range checks
- receipt validation that rejects byte-like payload fields
- resource failure envelope helpers
- resource failure envelope helpers
- control-plane helper for a `resource.readRange` legacy/test operation key (not part of Resource Plane v1; not part of the public `@exclave/resource` surface; not advertised by host grants)
- typed `ResourceContract<TOpen, TDescriptor>` and `OpenResourceRequest<TOpen>` shapes
- epoch-establishing `OpenResourceReply<TDescriptor>` carrying `handleId`, `authorityEpoch`, `resourceKind`,
  `resourceKey`, `resourceVersion`, descriptor, and capabilities
- 4-case `ResourceCapabilities` discriminated union with mandatory `maxChunkBytes` and `maxMappedWindowBytes` when
  supported
- bounded chunk-read and mapped-window request validators
- explicit mapped-window close and resource-handle close request/result types
- resource-specific failure union, including `mappingUnsupported`, `mappingInvalid`, `chunkTooLarge`,
  `mappingTooLarge`, `authorityUnavailable`, and `authorityNotReady`
- explicit `ResourceBackpressure`
- pushed `resourceHandleInvalidated` event shape
- modeled lifecycle helper proving invalidated handles reject later read/map attempts
- host-contract resource-plane grants advertising v1 operation metadata without byte bodies
- shared TypeScript conformance tests for open metadata, boundedness, invalidation, and operation metadata

Remaining gaps:

- no real resource authority, registry, transport, file IO, cache, media decoder, or product resource ownership exists
- no physical mapped-window backing is implemented
- the older JSON-safe read-range receipt skeleton remains as an internal legacy/test control-envelope helper; it is not part of the public `@exclave/resource` package surface, is not part of Resource Plane v1, and is not advertised by host resource-plane grants
- protocol surface and validation/model helpers are implemented; runtime authority registry and physical byte transport
  are not implemented

## 9. Warm Codec Conformance

Classification: partially implemented.

Current `@exclave/warm` provides the Warm Codec v1 binary framed-snapshot outer frame subset. It does not provide
JSON event envelopes, warm owner shapes, or stale binding failure projection.

Implemented in source and tests:

- canonical binary outer frame with `frameByteLength`
- little-endian metadata fields
- deterministic encode/decode for the same logical frame
- manifest-derived field-value payload encoding and decoding through a package-neutral structural warm payload manifest
- compiler-derived `warmCodecVersion` from Warm Codec v1 canonical hash coverage
- compiler-emitted warm lane manifest for framed-snapshot warm declarations
- canonical payload field order by UTF-8 `dotPath`, with no field names or field count in payload bytes
- scalar, enum, vector, bounded array, bounded map, variable map, fixed string, and variable string payload encodings
- deterministic bounded-map and variable-map entry ordering by encoded key bytes
- optional `laneSequence` presence and value encoding
- recoverable decode failures for malformed frame length, malformed payload length, invalid `laneSequencePresent`, and
  invalid UTF-8
- structured payload encode/decode failures for invalid logical values, truncated payloads, invalid bool bytes,
  out-of-range enum discriminants, invalid counts, non-increasing map keys, invalid UTF-8 keys/strings, fixed-string
  length overflow, and trailing bytes
- maximum warm frame byte-size enforcement before decode
- `authorityEpoch` absent from `WarmLaneFrame` bytes and decoded logical frame
- rejection of obvious resource-body descriptor shapes as framed-snapshot payload input
- `fixtures/projection-runtime/warm-payload-v0` proves one warm-only payload byte fixture, decoded snapshot fixture,
  Rust/TypeScript payload byte agreement, and Rust/TypeScript full warm frame byte agreement using the existing
  TypeScript `encodeWarmLaneFrame`/`decodeWarmLaneFrame` path plus the fixture-only Rust `warm-abi-conformance` crate

Remaining gaps:

- fatal stream mismatch handling
- broader Rust/TypeScript warm fixture coverage beyond warm-payload-v0
- production transport and publication runtime integration

The payload codec remains separate from the outer framed-snapshot codec. The Rust proof is fixture/conformance-only and
does not add transport, subscription lifecycle, publication runtime, session/control runtime, hot SAB lifecycle,
resource runtime, or cold reopen behavior.

## 10. Publication Subscription Lifecycle Conformance

Classification: partially implemented.

Current source has a new `@exclave/publication` package with protocol types and a modeled warm subscription lifecycle.

Implemented in source and tests:

- `PublicationSurfaceReadyEvent`
- `SubscribePublicationRequest`
- `SubscribePublicationAck`
- `PublicationSubscribeFailure`
- `subscriptionId`
- `coldLaneNotRatified` rejection path
- `WarmFrameRejectedEvent`
- `WarmStreamFatalEvent`
- per-subscription invalidation
- unsubscribe request/result type shapes
- ack commitment to an initial complete snapshot in the modeled authority helper
- consumer states for no subscription, subscribed waiting for initial snapshot, live, stale, failed, and closed
- applying a complete warm snapshot as latest state
- invalidating subscriptions on `authorityEpochReplaced` and `authorityUnavailable`
- rejecting frames after invalidation
- rebind after replacement readiness with a new `subscriptionId`
- rejection of old authority-epoch traffic against a new subscription
- explicit separation between hot handle open and warm/cold subscription in runtime protocol

Remaining gaps:

- no real transport
- no production authority runtime or session manager
- no product authority
- no hot handle lifecycle
- no cold reopen runtime
- no cold subscription runtime
- no bounded delivery/timeout policy for missing initial snapshots

Host-contract tests still only show descriptor-driven warm stream metadata; subscription lifecycle conformance now lives
in `@exclave/publication` tests and the shared conformance proof.

## 11. Cold Reopen Conformance

Classification: intentionally out of scope for public v1.

The repo intentionally does not implement cold reopen today. Compiler source retains cold lane declarations but does not
derive `coldCodecVersion`, and no cold materialization codec exists. No package implements cold row selection,
restartable-surface policy, required-at-startup sets, reopen terminal outcomes, `authorityReady` gating, rebasing
publication emission, or consumer rebind from reopened state.

This absence is consistent with the current public extraction boundaries. Cold reopen should stay behind stronger
session, resource, warm codec, and publication subscription foundations.

## 12. Recommended Next Implementation Slices

1. `test(conformance): wire generated consumer binding source into projection-runtime fixtures` — **done**.
   The compiler now emits generated consumer binding source/API shape. Generated consumer binding source is now
   represented in projection-runtime fixture/conformance evidence (hot-basic-v0, deck-runtime-v0, hot-exchange-v0).
   Live runtime binding (`bind()`, transport, session, control) remains future work.

2. `test(hot-binding): prove hot handle lifecycle invalidation`

   Add a focused test showing an invalidated hot handle stops guarded reads even when Block A still validates and the
   SAB remains reachable.

3. `test(conformance): broaden warm byte fixture agreement`

   Extend the current warm-payload-v0 Rust/TypeScript payload and full-frame agreement into additional warm fixtures
   as new warm contract shapes are added.

4. `feat(publication): define production transport attachment points`

   Define how the modeled subscription lifecycle attaches to a real transport without making control replies carry
   publication frames or resource bodies.
