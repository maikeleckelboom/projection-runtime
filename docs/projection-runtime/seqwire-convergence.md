# SeqWire Convergence and Production Ownership

Status: Authoritative for the production ownership boundary between Exclave and SeqWire.

This document does not redefine the Boundary Model, Projection Spine, hot ABI, or lane protocols. Those specifications
remain authoritative for their respective subjects. This document decides which repository owns the production
Electron renderer-to-native Rust boundary and constrains how SeqWire material may be reused.

## Decision

Exclave is the sole production architecture for the Electron renderer-to-native Rust audio-engine boundary.

Exclave owns:

- authored projection contracts and schema validation
- canonical manifests, field identity, compilation, lane planning, and ABI/version identity
- hot, warm, cold, control, resource, publication, host, and session semantics
- authority epoch issuance and binding validity rules
- generated Rust authority writers and generated read-only TypeScript consumers
- publication continuity, rebasing, and cross-language conformance
- production mapping, handle, revocation, remap, and transport contracts

SeqWire is not a production runtime for this boundary. It must not become an alternative compiler, planner, ABI,
compatibility identity, handoff protocol, lifecycle, or Electron topology.

SeqWire may remain useful only as:

- a donor of test scenarios, benchmark methods, fault-injection techniques, and implementation lessons
- a future protocol or conformance laboratory that consumes Exclave-generated artifacts
- historical evidence retained until its useful donor material has been classified and migrated

If a focused Exclave-artifact laboratory does not justify continued maintenance after donor extraction, SeqWire should
be archived. It should not be kept active merely to preserve an existing API family.

## Current implementation reality

Repository and package names are not evidence of completed runtime behavior. The current boundary must be described in
three categories.

### Implemented

The Exclave repository currently implements and tests:

- authored contract validation, canonical compilation, stable field identity, and deterministic lane manifests
- the canonical hot Block A and Block B layout and generated hot layout artifacts
- generated TypeScript hot readers and writers plus generated Rust hot writers for conformance fixtures
- fixed hot-field encoding and decoding for the currently supported shapes
- a bounded TypeScript hot-read kernel with separate writer-active and torn-read budgets
- zero-budget reads, suppression of torn candidates, and retained last-good fallback
- snapshot-wide publication through one seqlock transition in both the TypeScript and Rust publication kernels
- Rust-to-TypeScript and TypeScript-to-Rust hot byte conformance fixtures
- Rust-to-TypeScript warm payload and framed-snapshot byte agreement for the current warm fixture
- session binding validity checks for authority identity, grant identity, and authority epoch
- publication, resource, control-plane, and host-contract protocol types and validation helpers

These are real implementation assets, but they are substrate and conformance slices rather than a completed production
Electron/native runtime.

### Modeled or test-only

The repository currently models or proves in tests:

- authority binding readiness, invalidation, and epoch mismatch before a generated read is invoked
- host grant descriptors and guarded access to an already available shared region
- warm subscription acknowledgement, initial snapshot application, invalidation, replacement, and rebind
- resource handle invalidation and bounded request validation
- repeated generated Rust publication into in-process byte buffers
- generated TypeScript consumption of Rust-authored fixture bytes

These proofs establish contracts and failure precedence. They do not create a native mapping, transfer an operating
system mapping descriptor, enforce renderer read-only access, revoke a production handle, or cross a real Electron
process boundary.

### Missing production runtime

The following production capabilities do not yet exist:

- an authority-owned native shared-memory mapping with the required alignment and atomic memory-ordering guarantees
- a native authority registry that allocates, initializes, publishes, revokes, and retires hot regions
- an Electron main-process host adapter that brokers opaque mapping descriptors and hot handles
- a renderer-side read-only mapping path that never exposes mutable shared memory to application code
- a production hot-handle open, close, invalidation, replacement, and remap lifecycle
- production authority epoch issuance and non-reuse enforcement
- a restart flow that invalidates the old handle, opens a new mapping, and explicitly rebases continuity
- cross-thread and cross-process native publication tests over the real mapping implementation
- a product audio authority and a concrete Electron transport profile

The Rust publication proof currently operates on caller-provided byte slices. It proves layout and generated writer
agreement, not atomic publication into a live native mapping shared with a renderer.

## First executable convergence slice

The first executable convergence slice is implemented in
`packages/conformance/tests/conformance.test.ts` and recorded in the implementation conformance map.

The existing generated Rust deck-runtime writer produces a complete hot region. The generated TypeScript reader first
accepts those Rust-authored bytes and stores that snapshot as last-good. The same reader is then exercised with:

- a forced torn candidate and a zero torn-read budget
- an odd writer-active counter, a zero writer-active budget, and malformed candidate bytes that would fail if decoded

Both failed attempts return only the previously accepted Rust-authored snapshot. The torn candidate is not exposed, and
the malformed writer-active candidate is not decoded.

This slice deliberately ports scenario knowledge rather than SeqWire architecture. It strengthens the composition of
Rust byte agreement, generated TypeScript reads, bounded failure, and last-good retention. It does not claim native
mapped-memory concurrency, Electron transport, handle revocation, or lifecycle completion.

## Forbidden migrations from SeqWire

The following SeqWire concepts must not migrate into Exclave production architecture:

- `defineSpec` as a competing authored contract system
- params/meters role doctrine as the projection ownership model
- `planLayout` or any SeqWire-derived layout authority
- packed, partitioned, or WASM backing selection as a second production mapping model
- handoff and accepted-handoff types as production binding identity
- controller, processor, or observer bindings as an alternative generated consumer/runtime API
- SeqWire's two-word lock/sequence shared-memory ABI or its compatibility/version identity
- `setGroup` or `publishGroup` as a second publication contract; Exclave publishes a canonical snapshot in one commit
- best-effort reads that return a candidate observed while a writer is active
- fallback readers that sample mutable bytes instead of returning retained last-good state
- SWSR command-ring doctrine inside published projection state
- MWMR, hub, compose, or per-process Electron topology proposals as production direction
- SeqWire diagnostics, structured errors, package families, or generic core abstractions when they duplicate Exclave
  ownership
- compatibility adapters whose only purpose is to preserve a SeqWire public contract

An SWSR primitive, worker stress test, benchmark, or diagnostic technique may be reconsidered for a separate Exclave
control or laboratory need. That requires a new Exclave-owned contract and must not import the SeqWire ABI or doctrine.

## Allowed donor material

Useful SeqWire material should be translated into Exclave terms and tested against Exclave artifacts. Strong donor
candidates include:

- writer-active, torn-read, zero-budget, and bounded-progress test scenarios
- worker-thread stress and fault-injection methods, after removing SeqWire-specific counter layouts
- grouped-publication assertions expressed as one canonical Exclave snapshot commit
- property-test generators for alignment, bounds, malformed values, and deterministic encoding
- benchmark methodology for read, publish, snapshot, allocation, and contention costs
- Signalsmith and AudioWorklet lessons that test product-neutral Exclave bindings

Code should move only when it can retain its behavior without bringing a conflicting ABI or ownership model. Otherwise
the capability must be rebuilt against Exclave-generated manifests and bindings or kept in a laboratory.

## Dependency direction

The dependency direction is one-way:

1. Exclave authored contracts compile into canonical manifests and generated artifacts.
2. Exclave production packages and conformance tests consume those artifacts.
3. A future SeqWire laboratory may consume released Exclave packages, generated artifacts, and conformance fixtures.

Exclave production packages must never depend on SeqWire. SeqWire must not generate artifacts that Exclave treats as
canonical, and no SeqWire package may sit between an Exclave-generated Rust authority writer and TypeScript consumer.

Test techniques may be reimplemented inside Exclave without a repository dependency. If fixtures are shared with a
laboratory, Exclave remains their author and source of truth.

## Next production milestone

The next milestone is an authority-owned native hot mapping with a revocable Electron handle.

The milestone must implement this concrete flow:

1. Compile an Exclave authored projection contract into its canonical manifest, hot layout, generated Rust writer, and
   generated TypeScript reader.
2. Let the native Rust authority allocate and initialize an aligned shared mapping from that generated layout.
3. Publish complete snapshots through the Rust authority using the canonical Block A/Block B ABI and correct atomic
   ordering.
4. Let an Electron main-process host adapter register the mapping and return an opaque, epoch-bound hot handle and
   mapping descriptor.
5. Open the renderer mapping as read-only and construct only the generated TypeScript consumer behind a guarded host
   API.
6. Invalidate the handle on authority replacement or explicit revocation even if the old bytes remain physically
   reachable.
7. After replacement readiness, issue a new authority epoch and handle, remap, validate, and explicitly establish a new
   baseline and continuity generation.

### Acceptance criteria

The milestone is complete only when all of the following are executable:

- The native authority, not the renderer, owns allocation and mutation of the hot mapping.
- The layout and identity bytes come exclusively from Exclave's canonical compiler and generated artifacts.
- The renderer receives no writable mapping or raw mutable shared-memory object through the application API.
- Rust publication uses the required atomic acquire/release contract on a correctly aligned live mapping.
- A generated TypeScript consumer validates Block A identity before its first read.
- Writer-active and torn reads are bounded independently, accept zero budgets, never expose candidate bytes, and retain
  last-good.
- One Rust publication commits every field and its Block B metadata as one coherent snapshot.
- Rust-written bytes are read by TypeScript and TypeScript fixtures are decoded by Rust with byte-exact agreement.
- Revocation prevents guarded reads before candidate decoding while demonstrating that the old bytes may still be
  physically reachable.
- Authority restart invalidates the old epoch and handle; neither can become valid again.
- A replacement mapping requires a new handle and explicit continuity rebase rather than implicit resume.
- Open, close, revoke, replacement, and stale-operation failures are typed and covered by integration tests.
- A real Electron main/renderer integration test proves descriptor brokering and read-only consumer access.
- No Exclave production package or generated artifact depends on SeqWire.

Until these criteria pass against the native mapping and Electron host path, the production hot runtime remains an
implementation milestone rather than a completed capability.
