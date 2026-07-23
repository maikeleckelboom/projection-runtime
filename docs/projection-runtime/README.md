# Electron–Rust Runtime Architecture

This folder contains the active Projection Runtime architecture, protocol, and
conformance documents.

## Conceptual center

- [Boundary Model](boundary-model.md)
- [Projection Spine: Canonical Architecture Spec](projection-spine-canonical-architecture.md)
- [Hot Lane Codec and Layout Spec](hot-lane-codec-and-layout-spec.md)
- [Electron–Rust Warm Authority Profile v0](electron-rust-warm-authority-profile-v0.md)

## Relationship record

- [Research Lineage: Projection Runtime and SeqWire](research-lineage.md)

## Runtime companions

- [Control Plane Session Rules](control-plane-session-rules.md)
- [Cold Reopen Sequence](cold-reopen-sequence.md)
- [Warm Codec v1](warm-codec-v1.md)
- [Resource Plane v1](resource-plane-v1.md)
- [Hot Lane Consumer Runtime](hot-lane-consumer-runtime.md)
- [Hot SAB Lifecycle](hot-sab-lifecycle.md)
- [Compiler and Conformance Layout](compiler-and-conformance-layout.md)
- [Publication Subscription Lifecycle](publication-subscription-lifecycle.md)

## Evidence

- [Implementation Conformance Map](implementation-conformance-map.md)
- [Electron–Rust Warm Authority Profile v0](electron-rust-warm-authority-profile-v0.md)

## Recommended reading order

1. Boundary Model
2. Projection Spine: Canonical Architecture Spec
3. Hot Lane Codec and Layout Spec
4. Control Plane Session Rules
5. Cold Reopen Sequence
6. Warm Codec v1
7. Resource Plane v1
8. Hot Lane Consumer Runtime
9. Hot SAB Lifecycle
10. Compiler and Conformance Layout
11. Publication Subscription Lifecycle
12. Electron–Rust Warm Authority Profile v0
13. Implementation Conformance Map
14. Research Lineage
15. Redesign Migration Note, for historical context only

## Current posture

The document set defines a production-shaped research architecture. The private
Electron and Rust integration proves one warm-path process profile, including
supervision, reload, crash invalidation, epoch replacement, explicit
resubscription, continuity rebase, and deterministic teardown.

The deck engine and meters are simulated. No real audio device or resource-plane
implementation is present. The repository is not a shipped application runtime.

`@exclave` is the npm publishing namespace for workspace packages. It is not the
name of this architecture.

## Historical context

[Redesign Migration Note](redesign-migration-note.md) records the prior center
of gravity and migration rationale. It is historical and non-authoritative.

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
