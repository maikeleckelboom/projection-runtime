# Exclave Projection/Runtime Boundary Specs

This folder contains the current Exclave projection/runtime boundary specs.

## Conceptual center

- Boundary Model
- Exclave Projection Spine: Canonical Architecture Spec
- Exclave Hot Lane Codec and Layout Spec

## Production ownership

- [SeqWire Convergence and Production Ownership](seqwire-convergence.md)

## Runtime companions

- Control Plane Session Rules
- Cold Reopen Sequence
- Warm Codec v1
- Resource Plane v1
- Hot Lane Consumer Runtime
- Hot SAB Lifecycle
- Compiler and Conformance Layout
- Publication Subscription Lifecycle

## Recommended reading order

1. Boundary Model
2. Exclave Projection Spine: Canonical Architecture Spec
3. SeqWire Convergence and Production Ownership
4. Exclave Hot Lane Codec and Layout Spec
5. Control Plane Session Rules
6. Cold Reopen Sequence
7. Warm Codec v1
8. Resource Plane v1
9. Hot Lane Consumer Runtime
10. Hot SAB Lifecycle
11. Compiler and Conformance Layout
12. Publication Subscription Lifecycle
13. Redesign Migration Note, for historical context only

## Historical context

Redesign Migration Note is historical and non-authoritative. It records the prior center of gravity and migration
rationale, but it is not part of the conceptual center and must not be used to override the canonical specs.

## Notation

Type snippets use TypeScript-like syntax with spec scalar aliases such as `u32` and `u64`. Generated TypeScript bindings
map these to concrete runtime types such as `number` or `bigint` according to the relevant codec.

## Alignment notes

The current document set incorporates the pre-ratification alignment work needed before implementation:

- Projection Spine section 8.6 and Hot Lane Codec and Layout Spec section 2 agree on the 72-byte Block A layout, Block B
  at offset 72, field data at offset 96, and the expanded bind-validation sequence.
- Hot-lane seqlock reads require atomic acquire loads on a `BigUint64Array` view; non-atomic DataView u64 reads are not
  valid for sequence counters. `DataView` remains valid for ordinary field reads where the codec permits it.
- The spine and hot codec are co-authoritative for Block A and Block B. Any disagreement between those tables is a spec
  bug requiring reconciliation before implementation.
- Compiler and Conformance Layout sections 2.2, 3, 19.1, and 19.2 preserve the schema/compiler split: schema owns
  authored types and syntactic legality; compiler owns canonical normalization, semantic and cross-cutting legality,
  lane planning, generated artifacts, and fixtures.
- Resource Plane v1 section 7 defines `ResourceCapabilities` as a 4-case discriminated union and requires
  `maxMappedWindowBytes` whenever `canMapWindows: true`.
- Hot SAB Lifecycle section 10.1 routes host-declared stale conditions through `hotHandleInvalidated` using the Hot SAB
  Lifecycle section 11.2 reason table; independent stale discriminants are rejected.
- Hot Lane Codec and Layout Spec, Hot Lane Consumer Runtime, and Hot SAB Lifecycle have a shared bundle status. They are
  ratified together or not ratified together.
- Publication Subscription Lifecycle requires an initial complete snapshot after ack, a lane-scoped
  `PublicationSurfaceReadyEvent`, `coldLaneNotRatified` for cold subscription attempts in v1, a typed warm-frame
  `PublicationFrameAttachment`, and separate `WarmFrameRejectedEvent` and `WarmStreamFatalEvent` paths.
