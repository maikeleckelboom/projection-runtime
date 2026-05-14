# Resource Plane v1

Companion to:

- Boundary Model
- Control Plane Session Rules
- Warm Codec v1
- Cold Reopen Sequence

Status: Draft for ratification. Intended to become implementation-authoritative for resource-plane handle lifecycle,
chunk reads, mapped windows, invalidation, and bounded transfer.

This document defines the authority-owned handle protocol for large, paged, streamed, or mapped payloads that must not
be carried by control replies, warm publication frames, or hot publication regions.

It does not define media formats, waveform semantics, cache policy, remote transport, or product-specific decoding.
Those concerns belong to resource-specific contracts or product documents.

If this document and the boundary model disagree on the difference between control, publication, and resource planes,
the boundary model is authoritative and this document is wrong.
If this document and control-plane session rules disagree on `authorityEpoch`, session validity, or invalidation events,
the session rules document is authoritative and this document is wrong.
If this document and warm codec v1 disagree on warm frame boundedness, warm codec v1 is authoritative for warm frames
and this document is authoritative for resource bodies.

---

## 1. Purpose

The resource plane is the authority-owned handle protocol for large, paged, streamed, or mapped payloads that must not
be carried by control replies or publication frames.

This document defines:

- what a resource is
- who owns a resource handle
- how a handle is opened
- how a handle is read
- how a mapped window is opened and released
- how handle lifetime works
- how backpressure is surfaced
- how handles are invalidated
- what happens on authority restart
- what is typed per resource contract versus generic protocol
- what must never be stuffed into replies, warm frames, or hot publications

---

## 2. Scope and non-scope

### 2.1 In scope

This document defines:

- resource identity
- resource contracts and typed open inputs
- authority-owned handle issuance
- chunk read protocol
- mapped window protocol
- mapped window release protocol
- handle lifetime
- authority-pushed invalidation
- resource backpressure
- boundedness requirements
- resource failure shapes
- relationships to control, publication, warm, hot, and cold

### 2.2 Out of scope

This document does not define:

- streaming subscriptions
- cache eviction policy
- persistence schema
- media decoding policy
- waveform binary format
- artwork image format
- remote/network transfer
- resource migration between authority sessions
- product-specific resource kinds beyond examples

V1 covers open, descriptor, chunk read, mapped window, mapped window close, resource handle close, invalidation,
backpressure, and failure shapes.

---

## 3. Protocol rules

### 3.1 Resources are not replies

A resource payload must not be returned as an oversized control-plane reply merely because the caller asked for it.

Control may open, close, query, or operate on a resource handle. The large body itself belongs to the resource plane.

### 3.2 Resources are not publications

A resource payload is not publication state over time.

Publication surfaces may reference resource identity, availability, version, progress, or summary state. They must not
carry waveform bodies, stem data, artwork blobs, paged browse bodies, or large analysis blobs.

Those bodies belong on the resource plane.

### 3.3 Resource handles are authority-owned and revocable

A resource handle is issued by an authority session. It is valid only under the `authorityEpoch` that issued it.

The authority may invalidate a handle at any time.

### 3.4 Open requests are typed by resource contract

Resource open requests must not use `Record<string, unknown>` option bags.

Each resource kind declares its own typed open input, descriptor shape, capabilities, and legal read or mapping
behavior.

### 3.5 Resource reads are bounded

Chunk reads and mapped windows must be bounded by explicit size limits.

A resource request must not permit unbounded allocation, unbounded transfer, or unbounded mapping.

### 3.6 Mapping is not publication

A mapped resource window may use shared memory or platform mapping, but it is not a hot publication lane.

It does not carry seqlock publication metadata unless a separate publication surface explicitly does so.

Mapped resource access is a resource-plane method. Hot publication is a separate publication-plane lane with its own
ABI, manifest, seqlock, and continuity metadata.

### 3.7 Resource version is not authority epoch

`authorityEpoch` identifies the live authority session that issued the handle.

`resourceVersion` identifies the version of the payload the handle refers to.

They must not be collapsed.

A resource may be replaced under the same authority session. In that case, the `authorityEpoch` remains the same while
`resourceVersion` changes, and old handles to the prior resource version must be invalidated.

### 3.8 Resource handles observe one stable payload version

A successful resource open binds the handle to one `resourceVersion`.

For the lifetime of that handle, reads and mapped windows must observe the payload version identified by that
`resourceVersion`.

If the underlying resource body changes in a way that would change bytes, bounds, descriptor meaning, or mapping
identity, the authority must issue a new `resourceVersion` and invalidate existing handles that refer to the old
version.

A handle must not silently drift from one payload version to another.

### 3.9 Request-time invalidation is not sufficient

If an authority knows that a resource handle is no longer valid, it must push invalidation to handle holders.

A consumer must not discover all invalidation only by attempting another read.

---

## 4. Core nouns

```ts
type ResourceKind = string
type ResourceKey = string
type ResourceHandleId = string
type AuthorityEpoch = bigint
type ResourceVersion = bigint
type ResourceMappingId = string
```

### 4.1 Resource

A **resource** is a large, paged, streamed, or mapped payload owned by an authority and accessed through a resource
handle.

Examples:

* waveform bytes
* stem analysis bodies
* artwork blobs
* paged browse bodies
* large analysis outputs
* host-mapped binary regions

### 4.2 Resource identity

```ts
interface ResourceIdentity {
    readonly resourceKind: ResourceKind
    readonly resourceKey: ResourceKey
}
```

`resourceKind` identifies the contract family of the resource.

`resourceKey` identifies the specific resource instance under that kind.

### 4.3 Resource handle

```ts
interface ResourceHandle {
    readonly handleId: ResourceHandleId
    readonly authorityEpoch: AuthorityEpoch
    readonly resourceKind: ResourceKind
    readonly resourceKey: ResourceKey
    readonly resourceVersion: ResourceVersion
    readonly capabilities: ResourceCapabilities
}
```

A resource handle is not durable truth.
It is a live authority-session handle.

### 4.4 Resource version

`resourceVersion` identifies the payload version observed by the handle.

It changes when the underlying resource body changes in a way that invalidates existing reads or mappings.

Examples:

* waveform analysis is regenerated
* artwork blob is replaced
* browse page materialization changes
* analysis output is rebuilt
* authority replaces a mapped region with a new backing allocation

A `resourceVersion` change does not require an authority restart.

`resourceVersion` is opaque and equality-comparable by default. Consumers must not derive ordering, freshness, or
semantic meaning from its numeric value unless a resource contract explicitly defines such ordering. A different
`resourceVersion` means a different payload version. A greater numeric value is not, by itself, a contract-level
freshness rule.

### 4.5 Resource descriptor

A **resource descriptor** is the typed metadata returned when a resource is opened.

It describes the opened resource enough for the consumer to choose legal read or mapping behavior.

The descriptor is typed by the resource contract, not by the generic protocol.

A resource descriptor must not carry the resource body or a large body fragment. Descriptors are metadata for choosing
legal access behavior, not a payload transfer channel.

---

## 5. Resource contracts and typed open inputs

The resource plane has a generic envelope, but resource-specific inputs and descriptors are typed by contract.

A resource contract has a shape equivalent to:

```ts
interface ResourceContract<TOpen, TDescriptor> {
    readonly resourceKind: ResourceKind
    readonly openShape: TOpen
    readonly descriptorShape: TDescriptor
}
```

The generic protocol owns:

* session validity
* handle id
* resource identity
* resource version
* capabilities
* common failures
* bounded read and mapping mechanics

The resource contract owns:

* typed open input
* descriptor shape
* resource-specific legality
* product-domain interpretation

### 5.1 Rejected open shape

This is not allowed:

```ts
interface BadOpenResourceRequest {
    readonly resourceKind: string
    readonly resourceKey: string
    readonly options?: Record<string, unknown>
}
```

A generic option bag recreates stringly service plumbing.

### 5.2 Example typed open inputs

```ts
type OpenWaveformResource = {
    readonly trackId: string
    readonly resolution: "overview" | "detail"
    readonly channelMode: "mono" | "stereo" | "stacked"
}

type OpenStemResource = {
    readonly trackId: string
    readonly stem: "drums" | "bass" | "melody" | "vocals"
    readonly resolution: "overview" | "detail"
}

type OpenBrowsePageResource = {
    readonly browseSessionKey: string
    readonly pageStart: bigint
    readonly pageSize: number
}
```

These are examples, not canonical Dekzer resource contracts.

---

## 6. Open resource protocol

Opening a resource is an epoch-establishing operation by default.

The request may be sent before the caller holds a current `authorityEpoch`. A successful open reply binds the returned
handle to one `authorityEpoch`, and all subsequent read, map, and close operations against that handle are epoch-bound.

Resource contracts that intentionally require an already-established authority session may define an epoch-bound open
variant explicitly, but that is not the default v1 shape.

```ts
interface OpenResourceRequest<TOpen> {
    readonly resourceKind: ResourceKind
    readonly input: TOpen
}

type OpenResourceResult<TDescriptor> =
    | { readonly ok: true; readonly reply: OpenResourceReply<TDescriptor> }
    | { readonly ok: false; readonly failure: ResourceFailure | ResourceBackpressure }
```

```ts
interface OpenResourceReply<TDescriptor> {
    readonly handleId: ResourceHandleId
    readonly authorityEpoch: AuthorityEpoch
    readonly resourceKind: ResourceKind
    readonly resourceKey: ResourceKey
    readonly resourceVersion: ResourceVersion
    readonly descriptor: TDescriptor
    readonly capabilities: ResourceCapabilities
}
```

Resource contracts that require an epoch-bound open may use this explicit variant:

```ts
interface EpochBoundOpenResourceRequest<TOpen> {
    readonly resourceKind: ResourceKind
    readonly authorityEpoch: AuthorityEpoch
    readonly input: TOpen
}
```

### 6.1 Open semantics

On successful open:

* the authority issues a new handle id
* the handle is bound to the current `authorityEpoch`
* the handle is bound to one `resourceVersion`
* the returned `authorityEpoch` in the reply is the epoch that owns the handle
* all subsequent read, map, and close operations are epoch-bound to that value
* the reply declares capabilities and limits

The returned `resourceKey` is the authority-assigned canonical identity for the opened resource. It is derived from the
typed open input by the resource contract. Consumers must not supply a generic `resourceKey` through the open envelope
unless a resource-specific contract explicitly says so.

### 6.2 Open does not transfer the body

Opening a resource returns a descriptor and handle.

It does not return the resource body. The descriptor must not carry the resource body or any large body fragment.

The body is accessed through chunk reads, mapped windows, or future streaming extensions.

---

## 7. Resource descriptor and capabilities

`ResourceCapabilities` is a **4-case discriminated union** on the pair `(canReadChunks, canMapWindows)`. This eliminates
meaningless optional fields: `maxChunkBytes` only appears when chunk reads are supported, `maxMappedWindowBytes` only
appears when window mapping is supported, and no field can be absent when its capability flag is true.

```ts
type ResourceCapabilities =
    | {
        readonly canReadChunks: true
        readonly canMapWindows: true
        readonly totalByteLength?: bigint
        readonly maxChunkBytes: number          // mandatory: canReadChunks is true
        readonly maxMappedWindowBytes: number   // mandatory: canMapWindows is true
      }
    | {
        readonly canReadChunks: true
        readonly canMapWindows: false
        readonly totalByteLength?: bigint
        readonly maxChunkBytes: number          // mandatory: canReadChunks is true
        // maxMappedWindowBytes absent: canMapWindows is false
      }
    | {
        readonly canReadChunks: false
        readonly canMapWindows: true
        readonly totalByteLength?: bigint
        // maxChunkBytes absent: canReadChunks is false
        readonly maxMappedWindowBytes: number   // mandatory: canMapWindows is true
      }
    | {
        readonly canReadChunks: false
        readonly canMapWindows: false
        readonly totalByteLength?: bigint
        // maxChunkBytes absent, maxMappedWindowBytes absent
      }
```

The type enforces what the prose requires. A TypeScript implementation of a resource authority must not construct a
`ResourceCapabilities` value that has `canMapWindows: true` without `maxMappedWindowBytes` present; the type prohibits
it. Prose requirements without type enforcement are a conformance failure waiting to happen.

### 7.1 `canReadChunks`

If `canReadChunks` is `true`, the handle supports `ReadResourceChunkRequest` and `maxChunkBytes` is present and
mandatory.

If `canReadChunks` is `false`, chunk reads must fail with an explicit failure. `maxChunkBytes` is absent; a handle that
cannot read chunks carries no chunk-read limit.

### 7.2 `canMapWindows`

If `canMapWindows` is `true`, the handle supports `MapResourceWindowRequest`. `maxMappedWindowBytes` is mandatory and
present in the type. The `ResourceCapabilities` discriminated union enforces this structurally, not merely by prose
requirement.

If `canMapWindows` is `false`, mapping must fail with `mappingUnsupported`. `maxMappedWindowBytes` is absent from the
type.

### 7.3 `totalByteLength`

If present, `totalByteLength` is the known total resource body length.

If absent, total length is unknown or not cheaply knowable. Chunk reads must still be bounded.

### 7.4 `maxChunkBytes`

`maxChunkBytes` is present and mandatory when `canReadChunks` is `true`.

Every chunk read length must be `<= maxChunkBytes`.

### 7.5 `maxMappedWindowBytes`

`maxMappedWindowBytes` is mandatory when `canMapWindows` is `true`.

Every mapped window length must be `<= maxMappedWindowBytes`.

---

## 8. Chunk read protocol

```ts
interface ReadResourceChunkRequest {
    readonly handleId: ResourceHandleId
    readonly authorityEpoch: AuthorityEpoch
    readonly offsetBytes: bigint
    readonly lengthBytes: number
}
```

```ts
type ReadResourceChunkResult =
    | { readonly ok: true; readonly reply: ReadResourceChunkReply }
    | { readonly ok: false; readonly failure: ResourceFailure | ResourceBackpressure }
```

```ts
interface ReadResourceChunkReply {
    readonly handleId: ResourceHandleId
    readonly authorityEpoch: AuthorityEpoch
    readonly resourceVersion: ResourceVersion
    readonly offsetBytes: bigint
    readonly payload: Uint8Array
    readonly eof: boolean
}
```

### 8.1 Offset and length invariant

`offsetBytes` is a `u64`/`bigint` because resource bodies may exceed JavaScript's safe integer range.

`lengthBytes` is a bounded field. It must be a non-negative safe integer, must fit in `u32`, and must be less than or
equal to the handle's declared `maxChunkBytes`.

This split is intentional.

### 8.2 Chunk read validation

A chunk read must reject:

* stale or mismatched `authorityEpoch`
* invalid or revoked `handleId`
* handles that do not support chunk reads
* negative offsets
* `lengthBytes` that is not a non-negative safe integer fitting in `u32`
* zero length, unless a resource contract explicitly permits zero-length probes
* `lengthBytes > maxChunkBytes`
* ranges outside known resource bounds when `totalByteLength` is known

### 8.3 EOF semantics

`eof` means the returned chunk reaches or passes the current known end of the resource body.

If `totalByteLength` is known:

* `eof = true` when `offsetBytes + payload.byteLength >= totalByteLength`

If `totalByteLength` is unknown:

* `eof` is authority-defined and must be conservative
* `eof = false` must not be treated as proof that infinite data exists

### 8.4 Partial chunks

The authority may return fewer bytes than requested.

A short read is legal when:

* end of resource is reached
* the resource contract explicitly allows partial chunks
* adapter-level limits require a smaller transfer and that behavior is declared by the resource contract or
  implementation profile

Backpressure must not be silently encoded as a short read. If the authority cannot satisfy the requested read because of
pressure limits, it must return `ResourceBackpressure`, not a short payload.

A short read must not exceed the requested length.

---

## 9. Mapped window protocol

Mapped resource windows provide read-only access to a bounded byte region.

They are resource-plane handles, not hot publications.

```ts
interface MapResourceWindowRequest {
    readonly handleId: ResourceHandleId
    readonly authorityEpoch: AuthorityEpoch
    readonly offsetBytes: bigint
    readonly lengthBytes: number
}
```

```ts
type MapResourceWindowResult =
    | { readonly ok: true; readonly reply: MapResourceWindowReply }
    | { readonly ok: false; readonly failure: ResourceFailure | ResourceBackpressure }
```

```ts
interface MapResourceWindowReply {
    readonly handleId: ResourceHandleId
    readonly authorityEpoch: AuthorityEpoch
    readonly resourceVersion: ResourceVersion
    readonly mappingId: ResourceMappingId
    readonly offsetBytes: bigint
    readonly lengthBytes: number
    readonly readonly: true
    readonly mappingDescriptor: ResourceMappingDescriptor
}
```

### 9.1 Mapping descriptor

The descriptor is host/platform abstract.

It has a shape equivalent to:

```ts
type ResourceMappingDescriptor =
    | {
    readonly kind: "sharedArrayBuffer"
    readonly byteLength: number
}
    | {
    readonly kind: "hostMappedRegion"
    readonly token: string
    readonly byteLength: number
}
```

A public core contract should not require one physical mapping mechanism.
Adapters own physical delivery details.

### 9.2 Mapping validation

A mapped window request must reject:

* stale or mismatched `authorityEpoch`
* invalid or revoked `handleId`
* handles that do not support mapped windows
* negative offsets
* `lengthBytes` that is not a non-negative safe integer fitting in `u32`
* zero length, unless explicitly permitted
* `lengthBytes > maxMappedWindowBytes`
* ranges outside known resource bounds when `totalByteLength` is known

### 9.3 Mapping lifetime

A mapped window is valid only while:

* the resource handle remains valid
* the resource version remains current
* the authority epoch remains current
* the mapping has not been explicitly closed or invalidated
* the host mapping remains available

Invalidating the resource handle invalidates all mapped windows opened from that handle.

### 9.4 Mapping is read-only in v1

Resource mappings are read-only in v1.

Writable resource mappings require a separate protocol and are not implied by this document.

---

## 10. Close mapped window protocol

Mapped windows may hold host or adapter resources. They must have an explicit release path.

The default v1 protocol defines explicit mapped-window close. An implementation profile may declare that mapped windows
are automatically released only when the parent resource handle closes, but this must be stated explicitly;
implicit-only release is not the default.

```ts
interface CloseResourceMappingRequest {
    readonly handleId: ResourceHandleId
    readonly mappingId: ResourceMappingId
    readonly authorityEpoch: AuthorityEpoch
}

type CloseResourceMappingResult =
    | { readonly ok: true }
    | { readonly ok: false; readonly failure: ResourceFailure }
```

### 10.1 Close mapped window semantics

After a mapped window is closed:

* the consumer must stop using the mapping
* the authority or host may release associated mapping resources
* closing the mapped window does not close the parent resource handle

Closing the parent resource handle invalidates all mapped windows opened from it, whether or not they have been
explicitly closed.

---

## 11. Close resource protocol

```ts
interface CloseResourceRequest {
    readonly handleId: ResourceHandleId
    readonly authorityEpoch: AuthorityEpoch
}

type CloseResourceResult =
    | { readonly ok: true }
    | { readonly ok: false; readonly failure: ResourceFailure }
```

### 11.1 Close semantics

`close` releases the consumer's claim on the handle.

After successful close:

* reads are illegal
* mapping requests are illegal
* existing mapped windows from that handle must be invalidated or released
* the authority may release associated resources

### 11.2 Idempotent stale close

Close against an already stale or revoked handle may be treated as idempotent cleanup.

If so:

* it must not imply that the handle was valid
* it must not restore validity
* it must not imply any read or mapping operation would succeed

Whether stale close is accepted or rejected must be specified explicitly by the implementation profile or resource
contract. Implementations must not diverge silently.

---

## 12. Handle lifetime

A resource handle becomes invalid when any of these occurs:

* the consumer closes it
* the authority epoch is replaced
* the authority becomes unavailable
* the authority sends `resourceHandleInvalidated`
* the underlying `resourceVersion` is replaced
* the handle expires by declared lifetime policy
* the authority revokes it for product, security, or resource-pressure reasons
* the underlying resource becomes unavailable

A resource handle must not survive authority restart by default.

A later document may define persistent handle migration, but v1 does not.

---

## 13. Push invalidation

Resource invalidation must use the `resourceHandleInvalidated` event family already defined by control-plane session
rules.

The session rules document defines the shared event family and minimum cross-plane invalidation semantics. This document
refines the resource-plane meaning of that event and extends the resource-specific reason set with
`resourceUnavailable`.

```ts
type ResourceHandleInvalidated = {
    readonly kind: "resourceHandleInvalidated"
    readonly authorityEpoch: AuthorityEpoch
    readonly handleId: ResourceHandleId
    readonly reason:
        | "authorityRestart"
        | "resourceReplaced"
        | "revoked"
        | "expired"
        | "resourceUnavailable"
}
```

### 13.1 Invalidation causes

`authorityRestart`
: The issuing authority session is no longer current.

`resourceReplaced`
: The underlying resource body changed version. The existing handle refers to an old `resourceVersion`.

`revoked`
: The authority revoked access by product, security, or policy rule.

`expired`
: The handle lifetime ended by time or lease policy.

`resourceUnavailable`
: The resource can no longer be provided. This reason extends the base set defined by control-plane session rules.

### 13.2 Consumer obligations after invalidation

After resource handle invalidation, the consumer must:

* stop issuing reads for the handle
* stop opening mapped windows for the handle
* release or stop using existing mapped windows from that handle
* treat subsequent read/map failures as expected if any request races with invalidation

### 13.3 Authority obligations after invalidation

After pushing invalidation, the authority must reject future read/map requests for that handle with a typed failure.

The authority may accept close as idempotent cleanup if the implementation profile defines that behavior.

---

## 14. Backpressure and boundedness

A resource authority may reject or delay new read/map/open requests when per-handle, per-consumer, or per-authority
limits are exceeded.

Backpressure must be explicit.
It must not appear as a silent hang.
It must not be silently encoded as a short read.

```ts
type ResourceBackpressure = {
    readonly kind: "resourceBackpressure"
    readonly scope: "handle" | "consumer" | "authority"
    readonly retryAfterMs?: number
}
```

### 14.1 Backpressure scopes

`handle`
: The individual handle has too many outstanding operations.

`consumer`
: The consumer has too many resource operations across handles.

`authority`
: The authority is applying global resource pressure control.

### 14.2 Outstanding request limits

An implementation profile must define finite limits for at least:

* maximum chunk bytes
* maximum mapped window bytes when mapping is supported
* maximum outstanding reads per handle
* maximum outstanding mapped windows per handle
* maximum outstanding resource operations per consumer or authority

### 14.3 No unbounded allocation

A resource operation must validate size limits before allocating buffers, mapping memory, or scheduling large work.

---

## 15. Failure result shapes

Resource operations must surface failures as typed boundary facts.

```ts
type ResourceFailure =
    | {
    readonly kind: "sessionMismatch"
    readonly expectedAuthorityEpoch: AuthorityEpoch
    readonly providedAuthorityEpoch: AuthorityEpoch
}
    | {
    readonly kind: "handleInvalid"
    readonly handleId: ResourceHandleId
    readonly reason:
        | "revoked"
        | "expired"
        | "staleEpoch"
        | "resourceReplaced"
        | "resourceUnavailable"
        | "closed"
}
    | {
    readonly kind: "resourceUnavailable"
    readonly resourceKind: ResourceKind
    readonly resourceKey?: ResourceKey
}
    | {
    readonly kind: "authorityUnavailable"
}
    | {
    readonly kind: "authorityNotReady"
    readonly state: "starting" | "stopping"
}
    | {
    readonly kind: "rangeInvalid"
    readonly offsetBytes: bigint
    readonly lengthBytes: number
}
    | {
    readonly kind: "chunkTooLarge"
    readonly requestedBytes: number
    readonly maxChunkBytes: number
}
    | {
    readonly kind: "mappingInvalid"
    readonly handleId: ResourceHandleId
    readonly mappingId: ResourceMappingId
    readonly reason: "unknown" | "closed" | "revoked" | "parentHandleInvalid"
}
    | {
    readonly kind: "mappingUnsupported"
    readonly resourceKind: ResourceKind
}
    | {
    readonly kind: "mappingTooLarge"
    readonly requestedBytes: number
    readonly maxMappedWindowBytes: number
}
    | {
    readonly kind: "resourceContractViolation"
    readonly detail: string
}
```

### 15.1 Resource failures and session failures

Some resource failures overlap conceptually with session failures.

That is intentional.

Resource operations are epoch-bound, so resource protocol must be able to surface session mismatch, authority
unavailability, and handle invalidity without collapsing them into generic transport errors.

`authorityUnavailable` signals that the authority cannot be reached or has gone away entirely.
`authorityNotReady` signals that the authority exists but is in a transitional state (`starting` or `stopping`) and
cannot yet service resource operations.

These are distinct from `sessionMismatch`, which signals that the authority is reachable but the provided epoch is
wrong.

### 15.2 Transport errors are not resource failures

A transport failure means the message could not be delivered or decoded.

A resource failure means the authority understood the request and rejected it by protocol or product rules.

These must remain distinct.

---

## 16. Relationship to control, publication, warm, hot, and cold

### 16.1 Control plane

Control-plane messages may:

* open a resource handle
* close a resource handle
* close a mapped window
* request chunk reads
* request mapped windows
* receive typed replies or failures

Control-plane replies must not carry large resource bodies as a shortcut.

### 16.2 Publication plane

Publication surfaces may reference:

* resource identity
* resource availability
* resource version
* progress toward resource production
* summary state suitable for observation over time

Publication surfaces must not carry large resource bodies.

### 16.3 Warm lane

Warm frames are bounded publication snapshots.

Warm frames must not carry large bodies that belong on the resource plane.
Oversized warm frames are rejected before allocation or decode under warm codec rules.

### 16.4 Hot lane

Hot publications are fixed-layout latest-state mapped regions with seqlock and publication metadata.

Mapped resource windows are not hot publications.

A resource mapping must not be treated as a hot lane unless it separately satisfies the hot lane ABI and is declared as
a publication surface.

### 16.5 Cold lane

Cold materialization may store resource descriptors, indexes, or restart metadata, but resource bodies are not
automatically cold publications.

Cold reopen does not restore old resource handles.
After authority replacement, old resource handles die and consumers must open new handles.

---

## 17. Dekzer examples

These examples are illustrative. They are not complete product contracts.

### 17.1 Waveform resource

Resource:

* waveform overview/detail bytes

Control:

* open waveform resource
* read waveform chunks
* map waveform window
* close mapped window
* close handle

Publication:

* deck runtime playhead
* waveform availability
* analysis progress

Not allowed:

* returning the entire waveform in `loadTrack`
* carrying waveform bodies in warm frames
* treating mapped waveform bytes as hot deck runtime state

### 17.2 Stem resource

Resource:

* stem waveform or analysis body

Typed open input may include:

* `trackId`
* `stem`
* `resolution`

Publication may announce:

* stem availability
* analysis progress
* current selection state

The stem body itself belongs on the resource plane.

### 17.3 Artwork resource

Resource:

* artwork bytes

Control:

* open artwork resource
* read chunks

Publication:

* artwork availability
* artwork version
* selected artwork identity

The artwork blob does not belong in a warm publication frame.

### 17.4 Browse page resource

Resource:

* paged browse body

Typed open input may include:

* `browseSessionKey`
* `pageStart`
* `pageSize`

Publication:

* browse session state
* invalidation
* page availability summary

The page body belongs on the resource plane.

---

## 18. Conformance requirements

A conforming implementation must prove at least:

* resource open is typed per resource contract and does not accept generic option bags
* default open is epoch-establishing; the reply carries the `authorityEpoch` binding the returned handle
* successful open returns `handleId`, `authorityEpoch`, `resourceKind`, `resourceKey`, `resourceVersion`, descriptor,
  and capabilities
* the returned `resourceKey` is derived by the authority or resource contract from the typed open input, not supplied by
  the caller through a generic envelope
* the open reply descriptor does not carry the resource body or any large body fragment
* stale `authorityEpoch` read/map requests fail with `sessionMismatch`
* invalid handles fail with `handleInvalid`
* `authorityUnavailable` and `authorityNotReady` are distinct failures and are not collapsed into `sessionMismatch` or
  transport errors
* resource operations distinguish `authorityUnavailable` from `authorityNotReady`
* chunk reads enforce `maxChunkBytes`
* mapped windows enforce `maxMappedWindowBytes`
* `lengthBytes` on reads and mapped windows is validated as a non-negative safe integer fitting in `u32` before
  allocation
* unsupported mapping fails with `mappingUnsupported`
* oversized reads and mappings are rejected before allocation
* backpressure is returned as `ResourceBackpressure`, not as a silent short read
* resource replacement invalidates old handles via pushed `resourceHandleInvalidated`
* authority restart invalidates old handles
* old handles do not survive authority restart by default
* invalidated handles reject future reads and mappings
* close after invalidation is either explicitly idempotent or explicitly rejected
* mapped windows can be explicitly closed via `CloseResourceMappingRequest`
* unknown `mappingId` on close fails with `mappingInvalid`
* closing an already-closed mapping is either explicitly idempotent or explicitly rejected, and that behavior is
  declared by the implementation profile
* mapped windows are invalidated with their parent handle, and post-invalidation close returns `mappingInvalid` with
  reason `parentHandleInvalid`
* resource failures remain distinct from transport errors
* warm frames and control replies are not used to carry resource bodies in conformance fixtures

---

## 19. Rejected alternatives

### Rejected: returning waveform bytes in a control reply

Control replies complete requests. They are not large payload channels.

### Rejected: carrying waveform or stem bodies in warm frames

Warm frames are bounded publication snapshots. Large bodies belong on the resource plane.

### Rejected: treating mapped resource windows as hot publications

Mapping is a resource access method. Hot publication has separate seqlock, manifest, and continuity semantics.

### Rejected: untyped resource open options

Resource opens are contract-typed. A generic option bag recreates stringly service plumbing.

### Rejected: epoch-bound open as the default v1 shape

The default v1 open is epoch-establishing. The caller does not need a current `authorityEpoch` to open a
resource; the reply binds the returned handle to the epoch the authority assigns. Resource contracts that genuinely
require a pre-established session may declare an explicit epoch-bound variant.

### Rejected: request-time invalidation only

Resource handles are live authority-owned handles. Authority-pushed invalidation is mandatory.

### Rejected: handles surviving authority restart by default

Resource handles are epoch-bound unless a later document explicitly defines persistent handle migration.

### Rejected: collapsing `authorityEpoch` and `resourceVersion`

Authority session identity and payload version identity answer different questions.

### Rejected: treating `resourceVersion` as an ordered freshness counter

`resourceVersion` is opaque and equality-comparable. Consumers must not derive freshness or ordering from its
numeric value unless a resource contract explicitly defines such ordering.

### Rejected: resource body in descriptor

Descriptors are metadata for choosing legal access behavior. Carrying a large body fragment in a descriptor
recreates the oversized control reply problem through a different name.

### Rejected: unbounded chunk reads or mappings

Resource reads and mappings must be bounded before allocation or scheduling.

### Rejected: silent short reads as backpressure

Backpressure must be surfaced as `ResourceBackpressure`. Encoding backpressure as a short payload hides the
pressure signal and violates the explicit-backpressure requirement.

### Rejected: mapped windows without explicit release

Mapped windows may hold host or adapter resources. V1 defines explicit `CloseResourceMappingRequest`.
Implicit-only release on parent handle close must be stated as an explicit implementation profile decision, not assumed.

### Rejected: advertising `canStream` in v1 capabilities

V1 does not define streaming resource operations. Streaming requires a separate protocol and must not be implied
by a boolean capability with no legal operation set. If an adapter needs experimental streaming it belongs in an
adapter-specific descriptor, not the v1 generic protocol.

### Rejected: streaming semantics hidden inside v1 chunk reads

Streaming requires a separate protocol. V1 chunk reads are bounded operations.

### Rejected: generic fetch semantics

The resource plane is an authority-owned handle protocol with typed resource contracts, epoch-bound handles,
invalidation, and bounded transfer.
