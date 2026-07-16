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
- a private, non-public Electron/Rust integration in which a standalone Rust process owns the simulated deck timeline,
  epoch, typed tempo mutation, subscription state, and complete warm publication assembly
- real Electron main supervision and brokering over private framed stdio and a per-renderer `MessagePort`, with a bundled
  isolated preload and a sandboxed renderer
- bounded upstream and downstream delivery, renderer reload without authority restart, authority crash and replacement,
  explicit resubscription and continuity rebase, and deterministic child-process cleanup

The public packages remain product-neutral substrate and conformance slices. The private integration profile composes
them into one production-shaped executable application path without turning Electron hosting into a public package.

### Modeled or test-only

The repository currently models or proves in tests:

- authority binding readiness, invalidation, and epoch mismatch before a generated read is invoked
- host grant descriptors and guarded access to an already available shared region
- warm subscription acknowledgement, initial snapshot application, invalidation, replacement, and rebind
- resource handle invalidation and bounded request validation
- repeated generated Rust publication into in-process byte buffers
- generated TypeScript consumption of Rust-authored fixture bytes

In isolation, these modeled proofs establish contracts and failure precedence rather than a process topology. The
private integration below supplies the real process-boundary evidence for the warm path; it deliberately does not
create a native mapping or transfer an operating-system mapping descriptor.

### Implemented private integration profile

The [Electron ↔ Rust Warm Authority Profile v0](electron-rust-warm-authority-profile-v0.md) now implements:

- a standalone Rust authority as sole owner of epoch, simulated deck timeline, tempo mutation, subscription state, and
  complete warm snapshot assembly
- private EXCL v0 length-prefixed stdio with incremental binary-safe decoding, a 1 MiB hard limit, explicit packet
  kinds, malformed-frame failures, and protocol-only standard output
- Electron main supervision, host-lifetime epoch non-reuse enforcement, opaque control/publication routing, process-death
  invalidation, per-client cleanup, and deterministic replacement
- one dedicated main-to-preload `MessagePort` per renderer client, retained in bundled isolated preload and represented
  to the sandboxed main world only through a narrow typed API
- generated-manifest-backed `deck-runtime-v0` warm decoding and attachment validation before snapshot application and
  acknowledgement
- one in-flight plus one replaceable pending-latest publication at both transport hops, with stale credit rejection and
  positive coalescing evidence under a paused consumer
- typed `deck.setTempoRatio` intent that mutates only Rust state and is observed in a later authority publication
- renderer reload that replaces the client and subscription while preserving Rust PID, epoch, and advancing timeline
- authority crash and replacement with immediate stale state, a non-reused epoch, no automatic resubscribe, and an
  explicit new baseline and continuity rebase
- a real hidden Electron test that launches the compiled Rust binary and proves clean shutdown with no surviving child

This is one non-public production-shaped profile, not a generic Exclave runtime. The deck engine and meter evolution are
simulated, proof actions are fixture-only, and no real audio device or resource-plane surface is present.

## Earlier generated hot convergence slice

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

That earlier hot proof remains valid. The implemented Electron/Rust profile adds the real warm process topology without
changing hot layout identity or importing SeqWire architecture.

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

Integrate a real Dekzer deck/audio authority behind the proven process, control, warm-publication and restart profile,
then add one real resource-plane surface such as waveform access.

The private EXCL v0 stdio profile remains replaceable, and the Electron assembly remains non-public. Warm framed
snapshots remain the default renderer lane. Hot remains available for native consumers, while direct native renderer
mapping remains deferred until measurements show that warm delivery cannot meet a concrete requirement.

No part of that next milestone requires or permits a SeqWire schema, planner, ABI, handoff, binding, runtime, or
compatibility layer.
