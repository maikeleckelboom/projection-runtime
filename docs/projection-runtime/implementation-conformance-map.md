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
| `@exclave/compiler` | partially implemented | Emits canonical manifests, sorted fields, field ids, `semanticVersion`, canonical lane declarations, and hot layout manifests through `@exclave/hot-codec`. It retains warm and cold declarations but does not derive `warmCodecVersion` or `coldCodecVersion`. |
| `@exclave/hot-codec` | partially implemented | Implements hot constants, layout planning, `hotLayoutVersion`, Block A and Block B helpers, deterministic hot field byte helpers, complete fixture-region encode/decode, and tests. It does not allocate SABs, run seqlock runtime loops, open handles, or manage lifecycle. |
| `@exclave/hot-binding` | partially implemented | Validates already-opened SAB-backed regions and returns `BigUint64Array` counter views. It checks Block A expectations and counter offsets but does not own open, close, stale state, generated binding state, or handle lifecycle. |
| `@exclave/hot-consumer` | partially implemented | Implements the bounded read kernel with atomic sequence loads, separate writer-active and torn-read budgets, last-good fallback, and tests. It is not the generated `HotProjectionBinding<T>` state machine. |
| `@exclave/hot-publisher` | partially implemented | Implements a narrow writer-side publication kernel over already-opened Block B counter views. It is not an authority, handle registry, SAB allocator, or generated writer surface. |
| `@exclave/session` | partially implemented | Provides a product-neutral binding validity fence with `authorityEpoch`, ready/opening/invalidated/closed states, and guard helpers. It does not implement authority session descriptors, session state events, or full session failure shapes from the draft session rules. |
| `@exclave/control-plane` | partially implemented | Provides JSON-safe request/success/failure envelopes and projects binding validity failures. It does not implement operation dispatch, session issuance, resource opens, publication subscribe, or authority lifecycle. |
| `@exclave/resource` | partially implemented | Provides resource descriptors, owner validation, read-range payloads, receipts that reject byte-like payload fields, resource failures, and control envelope helpers. It does not implement the resource-plane v1 open/read/map/close handle protocol. |
| `@exclave/warm` | partially implemented | Provides JSON-safe warm frame envelopes, owner validation, invalidation payloads, and stale-binding failure projection. It is not the `framed-snapshot` binary warm codec from Warm Codec v1. |
| `@exclave/host-contract` | partially implemented | Provides host surface descriptors, hot/control/warm/resource lane descriptors, grants, and guarded hot-read tests. It does not implement transport, subscriptions, byte transfer, hot handle open/close, or resource lifecycle. |
| `@exclave/conformance` | partially implemented | Runs TypeScript-side fixture conformance and includes generated TS/Rust fixture proofs for hot exchange. It is not yet a full shared runtime conformance harness across all drafted planes. |

## 2. Boundary Model Conformance

Classification: partially implemented.

The repository follows the boundary model at the package boundary level. Control envelopes, warm envelopes, resource
descriptors, hot codec/binding/consumer/publisher kernels, session guards, and host-contract descriptors are separate
packages. Tests prove JSON-safe control and warm payload boundaries, resource receipts that do not carry byte bodies,
and guarded hot reads that fail before reading when session validity fails.

This is not full boundary model conformance. There is no service/authority runtime, no transport layer, no product
authority ownership model, no publication subscription implementation, and no resource-plane v1 handle lifecycle. The
current code proves separation of selected envelope and kernel responsibilities, not an end-to-end boundary runtime.

## 3. Projection Spine Conformance

Classification: partially implemented.

Implemented in source and tests:

- authored path grammar and field-shape syntax in `@exclave/schema`
- canonical manifest emission in `@exclave/compiler`
- lexicographic field ordering by dot path
- deterministic `fieldId` derivation
- `semanticVersion` derivation from canonical manifest bytes
- hot lane admissibility checks
- hot layout manifest emission when a hot lane is declared
- warm and cold lane declarations retained as canonical declarations
- hot Block A and Block B metadata represented in hot fixture helpers

Gaps:

- No generated field identity or binding surface exists. Normal field access must not be hand-authored raw dot-path strings. The compiler must emit generated field identity artifacts (string literal unions, key mirrors, or typed bindings) before any generated authority writer or consumer reader work that accesses published fields.
- No runtime projection instance registry or fixed-instance runtime layer exists.
- No generated public consumer binding surface exists in package source.
- No full publication metadata model exists across hot, warm, and cold lanes.
- `warmCodecVersion` is not derived.
- `coldCodecVersion` remains reserved and is not derived.
- Cold materialization semantics are not implemented.

The spine is canonical, but current code covers the schema/compiler/hot-layout portion more than the runtime publication
and lifecycle portions.

## 4. Hot Lane Codec/Layout Conformance

Classification: partially implemented.

Implemented in source and tests:

- hot ABI constants: 72-byte Block A, Block B at 72, seqlock at 72, publication header at 80/84/88, field data at 96
- deterministic planner, alignment, byte-span, reservation, and region-size logic
- `hotLayoutVersion` derivation
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

Gaps:

- No `AuthoritySessionDescriptor` union exists.
- No session manager issues non-reused authority epochs.
- No `authorityReady` or `authorityStarting` event surface exists.
- No `authorityEpochReplaced` or `authorityUnavailable` event surface exists.
- Existing invalidation reason names differ from the draft event vocabulary.
- Full `SessionBoundFailure` shapes are not implemented.
- Epoch-establishing open/subscribe/resource replies are not implemented.

The session/control packages implement a useful validity fence and envelope layer. The draft session protocol is ahead
of implementation.

## 8. Resource Plane Conformance

Classification: partially implemented; Resource Plane v1 is ahead of implementation.

Implemented in source and tests:

- resource owner and descriptor validation
- canonical decimal string authority epoch projection for JSON-safe resource descriptors
- read-range request payload and receipt payload validation
- descriptor-bound range checks
- receipt validation that rejects byte-like payload fields
- resource failure envelope helpers
- control-plane helper for a `resource.readRange` operation key

Major gaps against Resource Plane v1:

- no typed resource open contract
- no epoch-establishing open reply carrying `handleId`, `authorityEpoch`, `resourceKind`, `resourceKey`,
  `resourceVersion`, descriptor, and capabilities
- no 4-case `ResourceCapabilities` discriminated union
- no `maxChunkBytes` or `maxMappedWindowBytes` contract
- no chunk-read result carrying bytes
- no mapped-window protocol
- no explicit mapping close
- no resource handle close
- no `ResourceBackpressure`
- no pushed `resourceHandleInvalidated` event
- no authority restart behavior for handles

The package name matches the plane, but current source is a descriptor/read-range skeleton, not the draft v1 resource
handle protocol.

## 9. Warm Codec Conformance

Classification: not implemented.

Current `@exclave/warm` is a JSON-safe warm frame envelope package. It does not implement Warm Codec v1's binary
`framed-snapshot` codec.

Implemented adjacent pieces:

- warm owner shape with authority epoch as canonical decimal string
- warm frame envelope with stream key, frame key, sequence, frame kind, owner, and JSON-safe payload
- payload and owner validation
- stale binding failure projection

Missing from Warm Codec v1:

- canonical binary outer frame with `frameByteLength`
- little-endian metadata fields
- binary payload encoding for canonical field shapes
- deterministic map ordering checks
- optional `laneSequence` semantics
- `warmCodecVersion` derivation
- recoverable malformed-frame rejection
- fatal stream mismatch handling
- maximum warm frame byte-size enforcement

Compiler tests explicitly prove warm declarations are retained without producing `warmCodecVersion`.

## 10. Publication Subscription Lifecycle Conformance

Classification: not implemented.

Current source has warm stream descriptors and warm frame envelopes, but no publication subscription protocol.

Missing from the draft lifecycle:

- `PublicationSurfaceReadyEvent`
- `SubscribePublicationRequest`
- `SubscribePublicationAck`
- `PublicationSubscribeFailure`
- `subscriptionId`
- ack commitment to an initial complete snapshot
- `coldLaneNotRatified` rejection path
- `WarmFrameRejectedEvent`
- `WarmStreamFatalEvent`
- unsubscribe request/result
- per-subscription invalidation
- rebind after `authorityReady`
- explicit separation between hot handle open and warm/cold subscription in runtime protocol

Host-contract tests show descriptor-driven warm frame consumption, but that is not subscription lifecycle conformance.

## 11. Cold Reopen Conformance

Classification: intentionally out of scope for public v1.

The repo intentionally does not implement cold reopen today. Compiler source retains cold lane declarations but does not
derive `coldCodecVersion`, and no cold materialization codec exists. No package implements cold row selection,
restartable-surface policy, required-at-startup sets, reopen terminal outcomes, `authorityReady` gating, rebasing
publication emission, or consumer rebind from reopened state.

This absence is consistent with the current public extraction boundaries. Cold reopen should stay behind stronger
session, resource, warm codec, and publication subscription foundations.

## 12. Recommended Next Implementation Slices

1. `feat(compiler): emit generated field identity artifacts`

   Emit generated field identity artifacts derived from the canonical manifest: TypeScript string literal unions for
   field dot-paths, and/or typed key mirrors, and/or typed bindings. The compiler must not allow hand-authored raw
   dot-path string literals as the normal access path for published fields. The canonical manifest is the
   cross-language source of field identity. This slice must not add compatibility aliases or migration paths.

2. `feat(session): add authority session descriptor types`

   Add the discriminated `AuthoritySessionDescriptor` and the typed session event/failure shapes from the draft without
   building a session manager yet.

3. `feat(resource): add resource byte grant contract`

   Add a small read-range byte-transfer metadata slice with `ResourceByteGrant` and byte range descriptors only. This
   slice must not implement resource open, read, map, or close lifecycle.

4. `test(host-contract): prove resource byte grant endpoint crossing`

   Extend host-contract tests to prove a resource grant crosses the host boundary as a descriptor and does not carry
   bytes in a control reply.

5. `feat(resource): add resource handle capability types and open reply contract`

   Add the v1 resource handle/open reply and 4-case `ResourceCapabilities` discriminated union, including
   `maxMappedWindowBytes` whenever `canMapWindows: true`. This builds on the byte grant slice but does not yet
   implement full resource open/read/map/close lifecycle.

6. `test(hot-binding): prove hot handle lifecycle invalidation`

   Add a focused test showing an invalidated hot handle stops guarded reads even when Block A still validates and the
   SAB remains reachable.

7. `feat(warm): add framed snapshot byte codec skeleton`

   Add a bounded binary frame parser/encoder shell for Warm Codec v1 metadata only, with `frameByteLength`, contract key,
   instance key, versions, publication metadata, optional `laneSequence`, and payload bytes.

8. `test(warm): reject malformed framed snapshot bytes`

   Prove malformed frame length, payload length, and invalid `laneSequencePresent` are recoverable per-frame rejections.

9. `feat(publication): add warm subscribe ack and failure types`

   Add only type-level request/ack/failure shapes for warm subscription, including `subscriptionId`,
   `surfaceDeferredNotReady`, `surfaceUnavailable`, `streamIncompatible`, and `coldLaneNotRatified`.

10. `test(publication): reject cold subscription as not ratified`

    Prove `lane: "cold"` subscription attempts return `coldLaneNotRatified` in the v1 surface.
