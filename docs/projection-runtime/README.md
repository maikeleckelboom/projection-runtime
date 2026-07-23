# Electron–Rust Runtime Architecture

This is the documentation index for Projection Runtime. The architecture keeps
four concerns distinct: typed control intent, published state, resource access,
and authority-bound lifecycle. Generated contracts connect the lanes without
giving any one transport or package ownership of the whole system.

The executable center is a real Electron process supervising a compiled Rust
authority. The proof demonstrates one bounded warm-publication profile. It does
not turn every specification or public package into a complete runtime.

## Choose a reading path

### Architecture overview

For the core model and ownership boundaries:

1. [Boundary Model](boundary-model.md)
2. [Projection Spine: Canonical Architecture Spec](projection-spine-canonical-architecture.md)
3. [Hot Lane Codec and Layout Spec](hot-lane-codec-and-layout-spec.md)

### Executable evidence

For what actually runs, fails, recovers, and is tested:

1. [Executable Electron–Rust proof](../../integration/electron-rust-warm-authority/README.md)
2. [Electron–Rust Warm Authority Profile v0](electron-rust-warm-authority-profile-v0.md)
3. [Implementation Conformance Map](implementation-conformance-map.md)

The conformance map is the quickest way to distinguish implemented behavior,
contract-only surfaces, deliberate omissions, and possible next work.

### Protocol details

For the individual lanes and lifecycle contracts:

- [Control Plane Session Rules](control-plane-session-rules.md)
- [Publication Subscription Lifecycle](publication-subscription-lifecycle.md)
- [Warm Codec v1](warm-codec-v1.md)
- [Hot Lane Consumer Runtime](hot-lane-consumer-runtime.md)
- [Hot SAB Lifecycle](hot-sab-lifecycle.md)
- [Resource Plane v1](resource-plane-v1.md)
- [Cold Reopen Sequence](cold-reopen-sequence.md)
- [Compiler and Conformance Layout](compiler-and-conformance-layout.md)

## Full document index

### Architecture

- [Boundary Model](boundary-model.md)
- [Projection Spine: Canonical Architecture Spec](projection-spine-canonical-architecture.md)
- [Hot Lane Codec and Layout Spec](hot-lane-codec-and-layout-spec.md)
- [Compiler and Conformance Layout](compiler-and-conformance-layout.md)

### Runtime and protocol

- [Control Plane Session Rules](control-plane-session-rules.md)
- [Publication Subscription Lifecycle](publication-subscription-lifecycle.md)
- [Warm Codec v1](warm-codec-v1.md)
- [Hot Lane Consumer Runtime](hot-lane-consumer-runtime.md)
- [Hot SAB Lifecycle](hot-sab-lifecycle.md)
- [Resource Plane v1](resource-plane-v1.md)
- [Cold Reopen Sequence](cold-reopen-sequence.md)

### Evidence

- [Executable Electron–Rust proof](../../integration/electron-rust-warm-authority/README.md)
- [Electron–Rust Warm Authority Profile v0](electron-rust-warm-authority-profile-v0.md)
- [Implementation Conformance Map](implementation-conformance-map.md)

### Research history

- [Research Lineage: Projection Runtime and SeqWire](research-lineage.md)
- [Redesign Migration Note](redesign-migration-note.md), historical and
  non-authoritative

## Current posture

The private Electron and Rust integration proves supervision, typed control,
bounded warm publication, renderer reload, crash invalidation, epoch
replacement, explicit resubscription, continuity rebase, and deterministic
teardown.

The deck engine and meters are simulated. No real audio device,
resource-plane implementation, waveform surface, or native renderer mapping is
present. The private `EXCL` v0 stdio profile is proof-specific and replaceable.
Projection Runtime is production-shaped research, not a shipped application
runtime or a Dekzer runtime.

`@exclave` is the npm publishing namespace for workspace packages. It is not the
name of this architecture.

## Notation

Type snippets use TypeScript-like syntax with spec scalar aliases such as `u32`
and `u64`. Generated TypeScript bindings map these to concrete runtime types
such as `number` or `bigint` according to the relevant codec.

## Alignment notes

- Projection Spine section 8.6 and Hot Lane Codec and Layout Spec section 2
  agree on the 72-byte Block A layout, Block B at offset 72, field data at
  offset 96, and the expanded bind-validation sequence.
- Hot-lane seqlock reads require atomic acquire loads on a `BigUint64Array`
  view. `DataView` remains valid for ordinary field reads where the codec
  permits it.
- The spine and hot codec are co-authoritative for Block A and Block B.
- Schema owns authored types and syntactic legality. Compiler owns canonical
  normalization, cross-cutting legality, lane planning, generated artifacts,
  and fixtures.
- Resource Plane v1 defines `ResourceCapabilities` as a four-case
  discriminated union and requires `maxMappedWindowBytes` whenever
  `canMapWindows: true`.
- Hot Lane Codec and Layout Spec, Hot Lane Consumer Runtime, and Hot SAB
  Lifecycle have a shared ratification status.
- Publication Subscription Lifecycle requires an initial complete snapshot
  after acknowledgement and separates rejected-frame from fatal-stream paths.
