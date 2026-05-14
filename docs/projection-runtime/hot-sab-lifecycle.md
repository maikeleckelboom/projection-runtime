# Hot SAB Lifecycle

Companion to:

- Hot Lane Consumer Runtime
- Control Plane Session Rules
- Cold Reopen Sequence
- Resource Plane v1

Status: Draft for ratification as part of the hot-lane implementation bundle. This document, the Hot Lane Codec and
Layout Spec, and Hot Lane Consumer Runtime are jointly ratified or jointly not ratified. All three must reach sign-off
together.

This document defines the lifecycle of hot-lane mapped regions as authority-owned publication backing exposed to
consumers through revocable handles.

It does not redefine the hot-lane binary ABI, seqlock read algorithm, publication semantics, resource-plane mapping
protocol, or authority session rules. Those concerns belong to their companion documents.

If this document and Hot Lane Consumer Runtime disagree on binding state, read behavior, or stale binding behavior, Hot
Lane Consumer Runtime is authoritative and this document is wrong.
If this document and Control Plane Session Rules disagree on `authorityEpoch`, session events, or invalidation, Control
Plane Session Rules is authoritative and this document is wrong.
If this document and Resource Plane v1 disagree on resource mappings, Resource Plane v1 is authoritative for resource
mappings and this document is authoritative only for hot publication mappings.

---

## 1. Purpose

The hot lane uses mapped shared memory for latest-state publication surfaces.

This document defines:

- who allocates a hot mapped region
- when a region may be exposed to a consumer
- how a consumer obtains a hot handle
- what metadata binds a handle to an authority session
- when bind-time validation occurs
- when a mapping becomes stale
- how replacement and authority restart invalidate old mappings
- who may release mapping resources
- why a physically reachable `SharedArrayBuffer` may still be logically dead

---

## 2. Scope and non-scope

### 2.1 In scope

This document defines:

- authority ownership of hot mapped regions
- hot handle opening
- hot mapping descriptors
- consumer binding lifecycle relationship
- region initialization requirements
- invalidation and replacement rules
- close and release rules
- authority restart behavior
- stale mapping behavior when physical bytes remain reachable
- host/adapter responsibilities

### 2.2 Out of scope

This document does not define:

- field layout planning
- hot ABI byte offsets
- seqlock read algorithm details
- warm codec framing
- resource-plane mapped windows
- cold materialization selection
- product-specific projection contracts
- platform-specific memory APIs
- Electron security configuration

---

## 3. Protocol rules

### 3.1 Hot mappings are publication backing, not resources

A hot mapped region is the backing store for a hot publication surface.

It is not a resource-plane mapped window.
It is not chunked payload access.
It is not a generic shared-memory blob.

Resource mappings and hot mappings may both use shared memory physically, but they obey different contracts.

### 3.2 Authority owns the hot region

The authority owns hot-region allocation, initialization, mutation, publication, replacement, and retirement.

The consumer never owns the region.

### 3.3 Consumer access is read-only by contract

A hot consumer reads through a generated binding.

Application code must not receive public mutable access to the raw mapped region.

Even if the physical platform exposes writable bytes to JavaScript, mutation by the consumer is illegal and outside the
contract.

### 3.4 Hot handles are authority-epoch-bound

A hot handle is issued for one live authority session.

It is valid only under the `authorityEpoch` that issued it.

When that authority epoch is replaced or becomes unavailable, the handle becomes stale.

### 3.5 Header validity is not liveness

A mapped region with a valid header is not necessarily live.

Liveness comes from the handle and session lifecycle.

A consumer must not keep reading an old mapping merely because its Block A header still validates.

### 3.6 Stale invalidation is logical and immediate

A mapping may remain physically reachable after invalidation.

That does not make it live.

Once the runtime control layer marks a binding stale, live reads from that mapping are illegal, even if the old
`SharedArrayBuffer`, `DataView`, or typed-array views still exist.

### 3.7 Replacement requires a new handle

A replaced hot region must not silently retarget an existing handle.

Replacement requires invalidating the old handle and issuing a new handle with its own mapping descriptor.

Old bindings do not self-heal.

### 3.8 Bind-time validation is necessary but not sufficient

Bind-time validation proves structural compatibility with the mapped region.

It does not prove:

- current session validity
- authority readiness
- handle liveness after invalidation
- future replacement safety

The binding must remain tied to session and lifecycle invalidation.

### 3.9 Opened hot regions must be initialized

The authority must not expose a hot handle for a region containing uninitialized mutable payload bytes.

Before a handle can be opened, the region must have:

- valid immutable header data
- valid mutable region size
- initialized publication metadata
- a valid initial payload state for the declared projection family

A consumer must never be able to bind successfully and then read uninitialized field bytes.

---

## 4. Core nouns

```ts
type HotHandleId = string
type HotMappingId = string
type ContractKey = string
type ProjectionInstanceKey = string
type AuthorityEpoch = bigint
type SemanticVersion = bigint
type HotLayoutVersion = bigint
```

### 4.1 Hot region

A **hot region** is the authority-owned shared-memory backing allocation for one hot projection instance.

It contains:

- immutable bind-time header data
- mutable publication metadata
- mutable projection field bytes
- seqlock state required by the hot-lane ABI

### 4.2 Hot handle

A **hot handle** is a live authority-session claim that permits a consumer to bind to one hot region.

```ts
interface HotProjectionHandle {
    readonly handleId: HotHandleId
    readonly authorityEpoch: AuthorityEpoch
    readonly contractKey: ContractKey
    readonly projectionInstanceKey: ProjectionInstanceKey
    readonly semanticVersion: SemanticVersion
    readonly hotLayoutVersion: HotLayoutVersion
    readonly regionByteLength: number
    readonly mapping: HotMappingDescriptor
}
```

### 4.3 Hot mapping descriptor

A **hot mapping descriptor** is the adapter-delivered description of how the generated binding can access the hot
region.

It has a shape equivalent to:

```ts
type HotMappingDescriptor =
    | {
    readonly kind: "sharedArrayBuffer"
    readonly mappingId: HotMappingId
    readonly byteLength: number
}
    | {
    readonly kind: "hostMappedRegion"
    readonly mappingId: HotMappingId
    readonly token: string
    readonly byteLength: number
}
```

The physical transfer details belong to the adapter.
The normal application-facing API must not expose this descriptor as a mutable memory escape hatch.

### 4.4 Handle and mapping length invariant

For a successful open:

- `handle.regionByteLength` must equal `handle.mapping.byteLength`
- both must match the compiled hot layout manifest's expected region byte length for the declared `contractKey`,
  `semanticVersion`, and `hotLayoutVersion`

A consumer binding must reject a mapping whose reported or actual byte length does not match the compiled manifest
expectation.

This invariant is an explicit lifecycle requirement. It must not be left as an indirect side effect of later bind-time
validation.

### 4.5 Consumer binding

A **consumer binding** is the generated read-only API over a hot handle and mapping descriptor.

Its state machine and read behavior are defined by Hot Lane Consumer Runtime.

### 4.6 Host/adapter

The **host/adapter** brokers mapping descriptors, handle identity, lifecycle events, and invalidation delivery.

It does not own projection semantics and must not synthesize publications.

---

## 5. Hot open protocol

Opening a hot projection handle is an epoch-establishing operation by default.

A caller may request a hot handle before it knows the current `authorityEpoch`. A successful reply binds the returned
handle to the authority epoch that owns the mapping.

```ts
interface OpenHotProjectionRequest {
    readonly contractKey: ContractKey
    readonly projectionInstanceKey: ProjectionInstanceKey
}

type OpenHotProjectionResult =
    | { readonly ok: true; readonly reply: OpenHotProjectionReply }
    | { readonly ok: false; readonly failure: HotMappingFailure }

interface OpenHotProjectionReply {
    readonly handle: HotProjectionHandle
}
```

### 5.1 Open semantics

On successful open:

- the session/handle registry issues a new `handleId` for the authority-owned region
- the handle is bound to the current `authorityEpoch`
- the handle is bound to one `contractKey`
- the handle is bound to one `projectionInstanceKey`
- the handle is bound to one `semanticVersion`
- the handle is bound to one `hotLayoutVersion`
- the handle declares the expected `regionByteLength`
- the reply includes a mapping descriptor for the consumer binding
- all later operations against the handle are epoch-bound

The host/adapter may perform platform allocation or descriptor delivery, but handle identity represents lifecycle
registration for an authority-owned hot publication surface.

The host does not become the publication owner by issuing, carrying, or delivering a handle id.

### 5.2 Open does not bind

Open returns a handle and mapping descriptor.

It does not perform generated bind-time validation.

The consumer binding still must call `bind()` and pass the validation contract defined by Hot Lane Consumer Runtime.

### 5.3 Open requires publication readiness

The authority must not successfully open a hot handle for a projection surface that is not publication-ready.

If the authority exists but is not ready, open must fail with a typed not-ready failure.
If the surface is deferred-not-ready or unavailable, open must fail with a typed surface failure.

The consumer must not receive a live mapping for a surface that cannot produce a baseline-valid hot publication.

---

## 6. Region allocation and initialization

### 6.1 Allocation owner

The authority owns hot-region allocation.

The host/adapter may perform platform allocation mechanics on behalf of the authority, but it does not become the
publication owner.

### 6.2 Initialization order

A hot region becomes openable only after the authority has completed all of the following:

1. allocate or obtain the backing region
2. write immutable Block A header fields
3. initialize mutable publication metadata
4. initialize projection payload bytes to a valid full snapshot state
5. set the seqlock counter to an even value
6. register the region with the session/handle registry

No consumer handle may be issued before these steps complete.

### 6.3 No uninitialized reads

A consumer that passes bind-time validation must never read uninitialized payload bytes.

If an authority cannot produce an initialized payload, it must not open a hot handle.

### 6.4 Initial publication sequence

The first initialized state exposed through the hot region must use a publication metadata state legal for the
projection family.

For reopen, this metadata must match Cold Reopen Sequence rules.
For normal startup, the authority/domain rules decide the initial baseline metadata.

---

## 7. Binding relationship

Hot Lane Consumer Runtime owns the binding state machine.

This document only defines how lifecycle events feed that state machine.

A generated binding is created from:

- the open reply metadata
- the mapping descriptor
- the compiled hot layout manifest
- the runtime control channel used for invalidation

The binding starts `unbound`.
The binding may transition to `ready` only through `bind()`.
The binding transitions to `stale` when the runtime control layer delivers invalidation.
The binding transitions to `closed` when the consumer closes it.

---

## 8. Runtime-private physical view

`HotMappingDescriptor` is the public lifecycle descriptor. It identifies the mapping and its declared byte length.

The adapter/runtime resolves the descriptor into a runtime-private physical view used by the generated binding, such as
a `SharedArrayBuffer`, `DataView`, typed-array views, or platform-specific mapped region access.

That physical view must not become normal application-facing API.

The binding must validate the resolved physical view's actual byte length against:

- `handle.regionByteLength`
- `handle.mapping.byteLength`
- the compiled hot layout manifest's expected region byte length for the declared `contractKey`, `semanticVersion`, and
  `hotLayoutVersion`

All three must agree. Mismatch is a bind-time validation failure, not a runtime precondition that can be assumed
correct.

---

## 9. Handle and binding state relationship

The handle lifecycle and binding lifecycle are related but not identical.

### 9.1 Handle live, binding unbound

The handle exists and mapping descriptor is available, but bind-time validation has not completed.

### 9.2 Handle live, binding ready

The handle exists, bind-time validation passed, and live reads are legal.

### 9.3 Handle invalidated, binding stale

The authority/session lifecycle has invalidated the handle, with the host/adapter delivering the event.

The binding must transition to `stale`.

Live reads are illegal.

### 9.4 Handle closed, binding closed

The consumer has closed the handle or binding.

No further live reads are legal.

---

## 10. Live-read termination sources

A hot binding must stop live reads when any of these occurs.

These conditions do not all have the same owner.
They must not be collapsed into one generic invalidation path.

### 10.1 Runtime invalidation

The runtime control layer invalidates the binding and transitions it to `stale` when:

- authority epoch is replaced
- authority becomes unavailable
- session emits `hotHandleInvalidated`
- projection instance is replaced
- hot region is reallocated or superseded
- handle is revoked
- host declares the mapping stale, expressed through `hotHandleInvalidated` using the nearest legal reason per the
  section 11.2 reason mapping table

This is runtime/session/lifecycle invalidation. A host-declared stale mapping is not a separate invalidation category;
it is an instance of `hotHandleInvalidated` with a reason resolved by the adapter from the section 11.2 table. Adapters
must not invent a `hostDeclaredStale` reason or any equivalent that bypasses the `hotHandleInvalidated` event family.

### 10.2 Binding-local stale transition

If bind-time validation fails, Hot Lane Consumer Runtime transitions the binding according to its `bind()` result rules.

This is not a session invalidation event.
This is not a host invalidation event.
This is a binding-local failure path.

### 10.3 Consumer close

If the consumer closes the binding or handle, the binding transitions to `closed`.

This is not invalidation.
It is consumer-side retirement.

Runtime invalidation, bind validation failure, and close all end live reads, but they have different owners and must not
be collapsed.

---

## 11. Hot handle invalidation event

Hot handle invalidation uses the session invalidation event family already defined by Control Plane Session Rules.

```ts
type HotHandleInvalidated = {
    readonly kind: "hotHandleInvalidated"
    readonly authorityEpoch: AuthorityEpoch
    readonly handleId: HotHandleId
    readonly projectionInstanceKey: ProjectionInstanceKey
    readonly reason: "authorityRestart" | "projectionReplaced" | "revoked"
}
```

### 11.1 Event targeting

Invalidation targets the handle id.

It must not target only the projection instance key.

Multiple consumers may hold different handles for the same projection instance.
Each handle must be invalidated explicitly or covered by an authority/session-wide invalidation event.

### 11.2 Reason mapping

For `hotHandleInvalidated`:

- authority restart maps to `authorityRestart`
- region replacement, remap, resize, or projection-instance replacement maps to `projectionReplaced`
- host or policy revocation maps to `revoked`

Adapters must not invent parallel reason names such as `regionReallocated`, `remapped`, `hostStale`, or
`mappingReplaced` for these same cases.

A host-declared stale mapping must be expressed through `hotHandleInvalidated` using the nearest legal reason. It must
not introduce a separate public event reason. If the stale condition is caused by replacement, remap, resize, or
projection replacement, it maps to `projectionReplaced`. If it is caused by host policy, security, or lifecycle
revocation, it maps to `revoked`.

### 11.3 Relationship to binding invalidation reason

The adapter translates session invalidation events into the invalidation reason type used by Hot Lane Consumer Runtime.

No adapter should invent new intermediate lifecycle nouns for the same event.

---

## 12. Replacement and remap rules

### 12.1 Replacement requires invalidation

If a hot region is replaced, reallocated, resized, or remapped, the old handle must be invalidated before the new
mapping is treated as live.

### 12.2 No silent retargeting

A handle must never silently start pointing at a new region.

A consumer that wants the replacement must open a new handle and create a new binding.

### 12.3 Same physical memory reuse

An authority or adapter may reuse physical memory only after old handles have been invalidated according to this
document.

Physical reuse does not preserve logical handle identity.

A reused region must still be represented to consumers as a new handle and mapping lifecycle.

### 12.4 Same projection instance replacement

Replacing the hot region for the same `projectionInstanceKey` still requires:

- invalidating old handles
- issuing new handles
- creating new bindings
- running bind-time validation again

Same instance key is not same handle.

---

## 13. Authority restart behavior

On authority restart or replacement:

1. old-session hot handles become stale
2. the session layer emits `authorityEpochReplaced` or `authorityUnavailable`
3. hot handle holders receive invalidation directly or through session-wide invalidation
4. old bindings must stop live reads immediately
5. replacement authority reaches readiness according to Cold Reopen Sequence
6. consumers wait for `authorityReady`
7. consumers open new hot handles for the replacement session
8. consumers bind and read from the new mappings

Old hot bindings do not survive restart.
Old mappings do not become valid again.

---

## 14. Close protocol

A consumer may close its hot handle.

```ts
interface CloseHotProjectionRequest {
    readonly handleId: HotHandleId
    readonly authorityEpoch: AuthorityEpoch
}

type CloseHotProjectionResult =
    | { readonly ok: true }
    | { readonly ok: false; readonly failure: HotMappingFailure }
```

### 14.1 Close semantics

After close:

- the binding transitions to `closed`
- live reads are illegal
- the host/adapter may release consumer-side mapping resources
- the authority may release per-consumer handle registry state
- the authority may keep the underlying region alive if other handles or the publisher still need it

### 14.2 Stale close

Close against an already stale or revoked handle may be treated as idempotent cleanup.

If so:

- it must not imply the handle was valid
- it must not restore validity
- it must not imply any live read would succeed

Whether stale close is accepted or rejected must be specified by the implementation profile.

---

## 15. Physical release and garbage collection

### 15.1 Logical validity ends before physical memory necessarily disappears

The logical lifetime of a hot mapping ends when the handle is invalidated or closed.

The physical memory may remain reachable temporarily because of platform references, JavaScript `SharedArrayBuffer`
behavior, host mapping lifetime, or garbage collection.

Logical invalidation is authoritative.

### 15.2 No reliance on physical detach

Implementations must not rely on physical detach as the correctness mechanism.

A stale binding must refuse live reads because its state is stale, not because the underlying buffer became unreadable.

### 15.3 Release policy

An implementation profile must define:

- when consumer-side mapping references are released
- when host mapping tokens are revoked
- when authority-owned region allocations may be retired
- whether region allocations may be pooled or reused
- how reuse avoids handle identity confusion

### 15.4 No application retention contract

Application code must not treat retained raw memory references as valid access.

The generated binding and adapter are responsible for enforcing logical lifecycle.

---

## 16. Failure result shapes

Hot mapping operations must surface typed failures.

```ts
type HotMappingFailure =
    | {
    readonly kind: "sessionMismatch"
    readonly expectedAuthorityEpoch: AuthorityEpoch
    readonly providedAuthorityEpoch: AuthorityEpoch
}
    | {
    readonly kind: "authorityUnavailable"
}
    | {
    readonly kind: "authorityNotReady"
    readonly state: "starting" | "stopping"
}
    | {
    readonly kind: "hotHandleInvalid"
    readonly handleId: HotHandleId
    readonly reason:
        | "unknown"
        | "closed"
        | "revoked"
        | "staleEpoch"
        | "projectionReplaced"
        | "authorityRestart"
}
    | {
    readonly kind: "hotProjectionUnavailable"
    readonly contractKey: ContractKey
    readonly projectionInstanceKey: ProjectionInstanceKey
    readonly reason: "surfaceUnavailable" | "surfaceDeferredNotReady" | "notHotAdmissible"
}
    | {
    readonly kind: "mappingUnavailable"
    readonly reason:
        | "physicalMappingUnsupported"
        | "mappingAllocationFailed"
        | "mappingDeliveryFailed"
        | "mappingSecurityUnavailable"
        | "mappingDescriptorInvalid"
    readonly detail?: string
}
```

`detail` is diagnostic only. Consumers must branch on `reason`, not parse text.

`sessionMismatch` applies only to epoch-bound operations. The default epoch-establishing open request has no
caller-provided `authorityEpoch` and therefore cannot fail because of a provided stale epoch.

Bind-time validation failure is surfaced by `HotBindResult` from Hot Lane Consumer Runtime.
It is not a hot mapping open or close failure.
Open returns a handle and mapping descriptor.
Bind validates the descriptor and mapped region against the generated binding contract.

### 16.1 Transport errors are not hot mapping failures

A transport failure means the open, close, or invalidation message could not be delivered or decoded.

A hot mapping failure means the authority or adapter understood the operation and rejected it by protocol state.

These must remain distinct.

---

## 17. Relationship to resource mappings

Hot mappings and resource mappings are separate even when they use the same physical platform feature.

### 17.1 Hot mapping

A hot mapping:

- represents publication state
- uses the hot-lane ABI
- carries publication metadata
- uses seqlock validation
- is read through generated projection bindings
- is invalidated through hot handle/session lifecycle

### 17.2 Resource mapping

A resource mapping:

- represents a bounded payload window
- uses resource-plane handle protocol
- has `resourceVersion`
- has `mappingId`
- is closed with resource mapping close protocol
- does not carry hot publication metadata by default

These must not be collapsed.

---

## 18. Host/adapter responsibilities

The host/adapter must:

- broker hot open and close operations
- deliver mapping descriptors to generated bindings
- keep handle identity distinct from projection instance identity
- route session invalidation events to binding runtime control
- avoid exposing raw mutable memory as normal application API
- reject or fail closed when physical mapping prerequisites are unavailable
- avoid domain-specific projection nouns in generic broker APIs

The host/adapter must not:

- synthesize hot publications
- infer continuity metadata
- silently repair stale mappings
- let stale handles keep reading because bytes are still reachable
- treat resource mappings as hot mappings

---

## 19. Conformance requirements

A conforming implementation must prove at least:

- open hot projection is epoch-establishing by default
- epoch-establishing open cannot fail with `sessionMismatch`; that failure applies only to epoch-bound operations where
  the caller provides an `authorityEpoch`
- successful open returns `handleId`, `authorityEpoch`, `contractKey`, `projectionInstanceKey`, `semanticVersion`,
  `hotLayoutVersion`, `regionByteLength`, and mapping descriptor
- `handle.regionByteLength`, `handle.mapping.byteLength`, and compiled manifest expected region byte length must all
  match
- the runtime-private physical view's actual byte length matches `handle.regionByteLength`, `handle.mapping.byteLength`,
  and the compiled manifest expected region byte length before bind succeeds
- open does not count as bind-time validation
- bind-time validation is still required before live reads
- bind-time validation failures are surfaced through `HotBindResult`, not `HotMappingFailure`
- no hot handle is opened before the region has initialized header, metadata, and payload bytes
- stale `authorityEpoch` close/open variants fail with typed session failure where applicable
- `authorityUnavailable` and `authorityNotReady` remain distinct
- invalidating a hot handle transitions the binding to stale
- bind failure, runtime invalidation, and consumer close have distinct ownership paths
- stale binding never attempts live reads even if the physical buffer remains reachable
- authority restart invalidates old hot handles
- old hot handles do not survive authority restart by default
- replacement or remap issues a new handle and requires a new bind
- same projection instance replacement does not reuse old handle identity
- close transitions the binding to closed and prevents live reads
- stale close is either explicitly idempotent or explicitly rejected
- raw mutable memory is not exposed as normal application API
- hot mappings and resource mappings are not accepted interchangeably
- `hotHandleInvalidated` reason names use `authorityRestart`, `projectionReplaced`, or `revoked` rather than
  adapter-invented aliases
- consumers branch on `mappingUnavailable.reason`, not diagnostic `detail`

---

## 20. Rejected alternatives

### Rejected: treating hot mappings as resource mappings

Hot mappings are publication backing with seqlock, manifest, and continuity metadata. Resource mappings are
bounded payload windows.

### Rejected: consumer-created hot regions

Authority owns hot-region allocation and publication mutation.

### Rejected: application-facing raw SAB access

The generated binding may hold raw memory internally, but normal application code must not get a mutable memory
escape hatch.

### Rejected: header validation as proof of liveness

A stale old region may still have a valid header. Liveness is determined by handle and session lifecycle.

### Rejected: physical detach as the correctness mechanism

Logical invalidation must stop reads even if physical memory remains reachable.

### Rejected: silent handle retargeting

Replacement requires invalidation, a new handle, and a new bind.

### Rejected: old hot handles surviving authority restart

Hot handles are epoch-bound and die with the authority session unless a later document explicitly defines
migration.

### Rejected: opening a hot handle before initialized payload exists

Successful bind must never allow reads of uninitialized payload bytes.

### Rejected: host synthesizes hot publications

Host brokers lifecycle and mapping descriptors. Authority owns publication assembly.

### Rejected: projection instance key as handle identity

Multiple consumers may hold distinct handles for the same projection instance. Handle identity must remain
explicit.

### Rejected: bind failure as hot mapping failure

Bind failure is surfaced by `HotBindResult` from Hot Lane Consumer Runtime. Open and close failures belong to hot
mapping lifecycle; bind validation belongs to the generated binding.

### Rejected: close as invalidation

Close is consumer-side retirement. Invalidation is runtime/session/lifecycle revocation. Both end live reads, but
they have different owners.

### Rejected: adapter-specific invalidation reason aliases

Region replacement, remap, resize, and projection replacement map to `projectionReplaced`. Authority restart maps
to `authorityRestart`. Revocation maps to `revoked`. Adapters must not invent parallel reason names for the same
lifecycle events.

### Rejected: HotMappingDescriptor as direct physical view

`HotMappingDescriptor` is the public lifecycle descriptor only. The adapter/runtime resolves it into a
runtime-private physical view. The descriptor must not be treated as a byte-access surface by application code.

### Rejected: `mappingUnavailable` with untyped `detail: string`

Generic string failure escapes in this family allow adapter-specific lifecycle excuses to hide behind untyped
text. Consumers and codegen must be able to branch on a typed reason. `detail` is retained only as optional diagnostic
text, not as the primary branch surface.
