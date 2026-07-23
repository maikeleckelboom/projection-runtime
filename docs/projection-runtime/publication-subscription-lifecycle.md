# Publication Subscription Lifecycle

Companion to:

- Boundary Model
- Projection Spine: Canonical Architecture Spec
- Control Plane Session Rules
- Cold Reopen Sequence
- Hot Lane Consumer Runtime
- Hot SAB Lifecycle
- Warm Codec v1

Status: Draft for ratification. Intended to become implementation-authoritative for publication subscription request/ack
shapes, typed subscribe failures, deferred surface ready signals, warm stream lifecycle, subscription invalidation,
rebind protocol, and the relationship between hot handle open and publication subscription.

This document defines the publication-plane lifecycle contract: how a consumer subscribes to a projection surface, what
typed responses it receives, when a surface becomes ready, and how subscription state evolves across session events and
warm stream lifecycle. It does not redefine publication continuity semantics, seqlock ABI, warm codec frame encoding,
resource-plane handle protocol, or authority session identity rules. Those concerns belong to their companion documents.

If this document and Control Plane Session Rules disagree on `authorityEpoch`, session state events, or
`authorityReady`, Control Plane Session Rules is authoritative and this document is wrong.
If this document and Cold Reopen Sequence disagree on `surfaceUnavailable`, `surfaceDeferredNotReady`, or deferred
surface readiness rules, Cold Reopen Sequence is authoritative on surface availability semantics and this document
operationalizes the wire shapes.
If this document and Warm Codec v1 disagree on warm frame encoding or snapshot framing rules, Warm Codec v1 is
authoritative and this document is wrong.
If this document and Hot Lane Consumer Runtime disagree on binding state, invalidation reasons, or read behavior, Hot
Lane Consumer Runtime is authoritative and this document is wrong.

---

## Contents

1. Purpose and scope
2. Protocol rules
3. Core nouns
4. Deferred surface ready signal
5. Subscribe request and subscribe ack
6. Typed subscribe failures
7. Warm stream lifecycle
8. Subscription invalidation
9. Rebind after `authorityReady`
10. Stream-fatal warm incompatibility recovery
11. Relationship between hot handle open and publication subscription
12. Acceptance criteria
13. Rejected alternatives

---

## 1. Purpose and scope

### 1.1 Purpose

This document defines the publication-subscription rules left unspecified by the spine and session rules:

- what is the wire shape of a subscribe request?
- what ack does the consumer receive on success?
- what typed failures does the consumer receive on rejection?
- what is the deferred surface ready signal shape required by Cold Reopen section 14?
- how does a warm stream lifecycle begin, progress, and end?
- what subscription invalidation events reach consumers?
- how does a consumer rebind after `authorityReady`?
- how is stream-fatal warm incompatibility recovered?
- how does hot handle open relate to publication subscription, and are they the same or different operations?
- what typed attachment shape may a host transport carry for warm publication frames?

### 1.2 Scope

This document defines:

- `PublicationSurfaceReadyEvent` shape
- `SubscribePublicationRequest` and `SubscribePublicationAck` shapes
- `PublicationSubscribeFailure` discriminated union
- warm stream state lifecycle
- subscription invalidation event shapes
- rebind protocol obligations
- stream-fatal warm incompatibility recovery path
- hot handle open vs publication subscription distinction
- publication frame attachment boundary shape for warm frame carriage

### 1.3 Non-scope

This document does not define:

- warm frame encoding (Warm Codec v1 owns this)
- hot ABI layout (Hot Lane Codec and Layout Spec owns this)
- cold materialization selection (Cold Reopen Sequence owns this)
- publication continuity semantics (Projection Spine owns this)
- session epoch issuance (Control Plane Session Rules owns this)
- resource-plane chunked or mapped reads (Resource Plane v1 owns this)
- WebSocket, Electron, Node, native bridge, or other concrete transport mechanics

---

## 2. Protocol rules

### Rule 1: Subscribe replies are typed

A subscribe request must not reply with a generic error string or an opaque transport error code.

Every failure must be a typed discriminant from `PublicationSubscribeFailure`. Every success must be a typed ack from
`SubscribePublicationAck`.

### Rule 2: Deferred-not-ready and surface-unavailable are distinct discriminants

A consumer that receives `surfaceDeferredNotReady` must wait for a push signal.
A consumer that receives `surfaceUnavailable` must treat the surface as terminal absent a separate authority-driven
initialization.

These require different consumer behavior. They must not share a discriminant, must not share a wire code, and must not
be collapsed into a generic "surface not ready" failure.

### Rule 3: The deferred ready signal is push-based

A surface that completes deferred reopen after session `ready` must push a `PublicationSurfaceReadyEvent` to waiting
consumers.

Consumers must not poll subscription acceptance as a proxy for surface readiness. The `PublicationSurfaceReadyEvent` is
the only defined mechanism for signaling deferred surface availability.

### Rule 4: A subscription ack is epoch-establishing

A successful `SubscribePublicationAck` binds the subscription to one `authorityEpoch`. All subsequent events and
invalidations against that subscription are epoch-bound.

### Rule 5: Subscription and hot handle open are separate operations

A publication subscription and a hot handle open are two different operations, even when they ultimately provide access
to the same projection instance. They travel on different protocol paths, have different lifecycles, and must not be
conflated. See section 11.

### Rule 6: Subscription does not survive authority replacement

A warm subscription does not survive `authorityEpochReplaced` or `authorityUnavailable`. The consumer must receive
explicit subscription invalidation and must rebind after `authorityReady`.

### Rule 7: Stream-fatal incompatibility must not produce silent divergence

A warm stream that reaches a `warmCodecVersion` mismatch must surface a typed stream-fatal failure and terminate the
stream. The consumer must not silently continue reading frames that it cannot correctly decode.

### Rule 8: Ack commits the authority to an initial complete snapshot

A successful `SubscribePublicationAck` commits the authority to deliver an initial complete snapshot for this
subscription. The authority must not ack a warm subscription unless it can enqueue or emit that initial complete
snapshot under the acknowledged `baselineEpoch` and `continuityGeneration`.

### Rule 9: `PublicationSurfaceReadyEvent` is lane-scoped

`PublicationSurfaceReadyEvent` is scoped to one lane. A warm-lane ready event and a cold-lane ready event for the same
surface are separate signals. An authority must not emit `publicationSurfaceReady` for a lane that is not yet ready to
accept subscriptions and emit well-formed frames.

### Rule 10: Cold subscriptions are reserved in v1

V1 implementation support is ratified for `lane: "warm"` only. `lane: "cold"` is reserved in type shapes for future cold
subscription and tooling flows. A conforming v1 authority must reject cold subscription attempts with a typed failure.
See sections 5.1 and 6.

### Rule 11: Recoverable warm frame errors are not stream-fatal

Warm frame encoding errors that Warm Codec v1 classifies as recoverable per-frame errors must not cause stream teardown.
Stream-fatal events are reserved for identity- and version-level stream incompatibilities. See section 10.

### Rule 12: Publication frames attach to transport through a typed boundary

A host transport that carries warm publication frames to consumers must carry a typed publication frame attachment. It
must not hide frames in control replies, resource bodies, descriptor metadata, or arbitrary transport-specific option
bags.

The attachment names the stream, subscription, epoch, lane, surface identity, attachment version, and warm frame bytes.
The concrete transport chooses how to move the attachment; this document defines what the two sides agree is being
moved.

---

## 3. Core nouns

### 3.1 Publication subscription

A **publication subscription** is a registered consumer interest in receiving warm-lane or cold-lane events for one
projection instance.

A subscription is:

- surface-scoped: one subscription covers one `(contractKey, projectionInstanceKey)` pair
- lane-scoped: a subscription to a warm surface is a warm subscription; a subscription to a cold surface is a cold
  subscription
- epoch-bound: once acknowledged, the subscription is bound to one `authorityEpoch`

A subscription is not:

- a hot handle (hot access is a separate handle open on a separate protocol path)
- a resource handle
- an infallible channel

### 3.2 Subscription session

A **subscription session** is the live runtime state of one active publication subscription.

It begins at ack reception.
It ends at invalidation, stream-fatal failure, or consumer unsubscribe.

### 3.3 Surface availability states

A projection surface may be in one of these availability states for subscription purposes:

- **publication-ready**: the authority can accept subscriptions and will emit well-formed publications
- **surface-unavailable**: the surface has no valid state and is not expected to become publication-ready without
  explicit domain initialization
- **deferred-not-ready**: the surface is completing reopen work after session `ready`; it is expected to become
  publication-ready and will emit a `PublicationSurfaceReadyEvent` when it does

These states are authority-side. The consumer observes them through typed ack/failure responses and push events.

---

## 4. Deferred surface ready signal

This is the highest-priority section in this document.

Cold Reopen Sequence section 14 requires a push-based ready signal, and Control Plane Session Rules section 12 defines
`authorityReady` without defining per-surface readiness. This section specifies the shared signal shape.

### 4.1 Shape

```ts
type PublicationSurfaceReadyEvent = {
    readonly kind: "publicationSurfaceReady"
    readonly authorityEpoch: AuthorityEpoch
    readonly contractKey: ContractKey
    readonly projectionInstanceKey: ProjectionInstanceKey
    readonly lane: "warm" | "cold"
}
```

The `lane` field is required. A `publicationSurfaceReady` event signals that one lane of one surface has completed
deferred reopen work and is ready to accept subscriptions. A surface that declares multiple lanes may emit separate
events per lane.

### 4.2 Semantics

`publicationSurfaceReady` is emitted by the authority when a previously `surfaceDeferredNotReady` surface transitions to
publication-ready status for the indicated `lane`.

After this event is received for a given `(contractKey, projectionInstanceKey, lane)`:

- the consumer may submit a subscribe request for that surface and lane and expect it to succeed under normal session
  conditions
- subscription requests that previously received `surfaceDeferredNotReady` must now be retried; this event does not
  automatically re-subscribe the consumer

Multiple deferred surfaces, and multiple deferred lanes within the same surface, may become ready independently.

### 4.3 Delivery requirements

- The event must be delivered before the authority begins accepting subscriptions for that surface and lane.
- The authority must not accept subscribe requests for the surface and lane and then emit `publicationSurfaceReady`
  after the fact. That ordering violates the push-first rule.
- The event must be delivered to all consumers that received `surfaceDeferredNotReady` for this surface instance and
  lane.
- Delivery to a consumer that never subscribed to this surface is not required but is not incorrect.
- The event is scoped to one `authorityEpoch`. It must carry the `authorityEpoch` of the authority session that is now
  publication-ready for this lane.

### 4.4 Session boundary

A `publicationSurfaceReady` event from one authority session is not valid across a session replacement.

After `authorityEpochReplaced` or `authorityUnavailable`, any pending deferred surface subscription interest must be
abandoned. The consumer rebinds the whole subscription layer from `authorityReady`, not from remembered deferred surface
signals.

### 4.5 Relationship to `authorityReady`

`authorityReady` (Control Plane Session Rules section 12.1) signals that required-at-startup surfaces have reached terminal
reopen outcomes.

`publicationSurfaceReady` signals that one specific deferred surface lane outside the required-at-startup set has
completed its post-session-ready reopen work.

These are not the same event. `authorityReady` enables bulk subscription rebind for publication-ready surfaces.
`publicationSurfaceReady` enables subscription to one previously deferred surface lane.

---

## 5. Subscribe request and subscribe ack

### 5.1 Request shape

```ts
interface SubscribePublicationRequest {
    readonly contractKey: ContractKey
    readonly projectionInstanceKey: ProjectionInstanceKey
    readonly lane: "warm" | "cold"
    readonly expectedSemanticVersion: SemanticVersion    // u64; consumer's compiled semantic version
    readonly expectedLaneVersion: LaneVersion            // u64; warmCodecVersion or coldCodecVersion
}
```

`expectedSemanticVersion` and `expectedLaneVersion` are declared by the consumer at subscribe time. The authority must
check these against the surface's current versions before acknowledging. A version mismatch at subscribe time is a typed
failure (see section 6 `streamIncompatible`), not a runtime discovery.

The request is **epochless by default**: the consumer may submit it before holding a current `authorityEpoch`. A
successful ack is epoch-establishing. It binds the returned subscription to one `authorityEpoch`.

**V1 restriction**: `lane: "cold"` is reserved in the type shape. A conforming v1 authority must reject cold
subscription attempts with `coldLaneNotRatified` (see section 6). Consumers must not assume cold subscription is
implementation-ready until the cold materialization codec is ratified.

### 5.2 Ack shape

```ts
interface SubscribePublicationAck {
    readonly contractKey: ContractKey
    readonly projectionInstanceKey: ProjectionInstanceKey
    readonly lane: "warm" | "cold"
    readonly subscriptionId: SubscriptionId              // opaque; scopes subsequent invalidation events
    readonly authorityEpoch: AuthorityEpoch              // epoch-establishing
    readonly semanticVersion: SemanticVersion            // u64; surface's current semantic version
    readonly laneVersion: LaneVersion                    // u64; surface's current warmCodecVersion or coldCodecVersion
    readonly baselineEpoch: BaselineEpoch                // initial baseline epoch for this subscription open
    readonly continuityGeneration: ContinuityGeneration  // initial continuity generation
}
```

`subscriptionId` is the opaque subscription-scoped token that binds subsequent events, invalidations, and unsubscribe
requests to this subscription session. It must not be the same as the `projectionInstanceKey`; a consumer may hold
multiple subscriptions for the same surface across session boundaries, and each must be distinguishable.

The ack does not carry the first publication frame. The first warm frame arrives on the publication channel after the
ack is received.

### 5.3 Ack obligations

An authority that returns a `SubscribePublicationAck` is committing to:

- this surface is publication-ready under the declared `authorityEpoch`
- for `replaceable-snapshot` family, the first warm frame after ack will be a complete snapshot representing the current
  publication state for the acknowledged `(contractKey, projectionInstanceKey, lane)`, and it will be delivered under
  the acknowledged `baselineEpoch` and `continuityGeneration`
- `baselineEpoch` and `continuityGeneration` in the ack match what the first frame will carry
- future frames will carry consistent continuity metadata until a continuity break event

The authority must not return an ack for a surface that is deferred-not-ready or surface-unavailable.

The authority must not return an ack unless it can enqueue or emit the required initial complete snapshot before any
frame from a subsequent publication cycle reaches the consumer. An ack that may never be followed by the initial
snapshot is a protocol violation.

A consumer that has not received the first frame after ack is waiting for the required initial snapshot. Implementations
must define a bounded delivery or timeout policy for this condition.

---

## 6. Typed subscribe failures

```ts
type PublicationSubscribeFailure =
    | { kind: "authorityUnavailable" }
    | { kind: "authorityNotReady"; state: "starting" | "stopping" }
    | {
        kind: "sessionMismatch"
        expectedAuthorityEpoch: AuthorityEpoch
        providedAuthorityEpoch: AuthorityEpoch
      }
    | {
        kind: "surfaceUnavailable"
        contractKey: ContractKey
        projectionInstanceKey: ProjectionInstanceKey
      }
    | {
        kind: "surfaceDeferredNotReady"
        contractKey: ContractKey
        projectionInstanceKey: ProjectionInstanceKey
      }
    | {
        kind: "notDeclaredLane"
        contractKey: ContractKey
        lane: "warm" | "cold"
      }
    | {
        kind: "coldLaneNotRatified"
        contractKey: ContractKey
        projectionInstanceKey: ProjectionInstanceKey
      }
    | {
        kind: "streamIncompatible"
        contractKey: ContractKey
        consumerSemanticVersion: SemanticVersion
        surfaceSemanticVersion: SemanticVersion
        consumerLaneVersion: LaneVersion
        surfaceLaneVersion: LaneVersion
        detail: string
      }
    | {
        kind: "unknownSurface"
        contractKey: ContractKey
        projectionInstanceKey: ProjectionInstanceKey
      }
```

### 6.1 Failure semantics

**`authorityUnavailable`**: no live authority session exists. Consumer must wait for a `authorityReady` event before
retrying.

**`authorityNotReady`**: a live authority session exists and has an `authorityEpoch`, but required-at-startup reopen has
not completed. Consumer must wait for `authorityReady`.

**`sessionMismatch`**: the consumer provided an `authorityEpoch` in an epoch-bound subscribe variant and it does not
match the current live session. Only applies to explicit epoch-bound subscribe requests; the default epochless subscribe
path cannot fail with `sessionMismatch`.

**`surfaceUnavailable`**: the surface has no valid state and will not become publication-ready without an explicit
domain-level initialization event. This is terminal in the absence of such an event. Consumer must not retry blindly; it
should surface this as a product-level condition.

**`surfaceDeferredNotReady`**: the surface is in the process of completing deferred reopen work. It is expected to
become publication-ready for the requested lane. Consumer must wait for a `PublicationSurfaceReadyEvent` carrying a
matching `(contractKey, projectionInstanceKey, lane)` before retrying (see section 4).

**`notDeclaredLane`**: the contract does not declare the requested lane (e.g. subscribing warm for a hot-only contract).
This is a contract violation by the consumer and will not become valid without a contract change.

**`coldLaneNotRatified`**: the consumer requested `lane: "cold"` but the cold materialization codec is not yet ratified
in this implementation version. This is not a contract violation; it is a v1 implementation boundary. Consumer must not
retry with `lane: "cold"` until the cold codec is ratified. The type shape is reserved for future use.

**`streamIncompatible`**: the consumer's declared `expectedSemanticVersion` or `expectedLaneVersion` does not match the
surface's current versions. The consumer was compiled against a different version of this contract. This is a hard
incompatibility; the consumer must be rebuilt against the current contract before subscription will succeed. The failure
must carry both consumer-side and surface-side version values so the incompatibility is diagnosable without inspecting
logs.

**`unknownSurface`**: the `projectionInstanceKey` does not correspond to any known surface for this contract. This may
indicate a stale consumer config, a race against instance lifecycle (in future multi-instance systems), or a programming
error. In v1 (fixed-instance-only per spine section 13), this failure is always a programming error.

### 6.2 Retry rules by failure kind

| Failure kind              | Retry rule                                                             |
|---------------------------|------------------------------------------------------------------------|
| `authorityUnavailable`    | Wait for `authorityReady` event, then retry                            |
| `authorityNotReady`       | Wait for `authorityReady` event, then retry                            |
| `sessionMismatch`         | Update held `authorityEpoch` and retry, or wait for `authorityReady`   |
| `surfaceUnavailable`      | Do not retry; surface the condition as a product state                 |
| `surfaceDeferredNotReady` | Wait for `PublicationSurfaceReadyEvent` with matching lane, then retry |
| `notDeclaredLane`         | Do not retry; rebuild consumer against correct lane                    |
| `coldLaneNotRatified`     | Do not retry with cold lane; wait for cold codec ratification          |
| `streamIncompatible`      | Do not retry; rebuild consumer against current contract                |
| `unknownSurface`          | Do not retry; treat as a programming error in v1                       |

---

## 7. Warm stream lifecycle

### 7.1 States

A warm subscription session has the following lifecycle states:

```ts
type WarmSubscriptionState =
    | "subscribing"    // request sent, ack not yet received
    | "active"         // ack received; frames are flowing or expected
    | "invalidated"    // authority-driven invalidation received; stream is dead
    | "streamFatal"    // unrecoverable stream error (see section 10)
    | "unsubscribed"   // consumer called unsubscribe; stream is retired
```

### 7.2 State transitions

```
subscribing  → active         (SubscribePublicationAck received)
subscribing  → [failure]      (PublicationSubscribeFailure received; no state retained)
active       → invalidated    (SessionInvalidationEvent or SubscriptionInvalidatedEvent received)
active       → streamFatal    (stream-fatal warm incompatibility; see section 10)
active       → unsubscribed   (consumer calls unsubscribe)
invalidated  → [terminal]     (consumer rebinds via a new subscribe request)
streamFatal  → [terminal]     (consumer must rebuild before resubscribing)
unsubscribed → [terminal]
```

The `[failure]` path on `subscribing` does not create a subscription state. The consumer retries or abandons based on
the failure kind.

### 7.3 Frame delivery expectations

After the ack:

1. The first warm frame must be a complete snapshot (for `replaceable-snapshot` family), as committed by the ack
   obligations in section 5.3.
2. The `baselineEpoch` and `continuityGeneration` in the first frame must match what the ack declared.
3. Subsequent frames may arrive at any cadence driven by authority publication rate.
4. A consumer that has not received the first frame after ack is waiting for the required initial snapshot. See section
   5.3 for bounded delivery obligations.

### 7.3.1 Transport attachment shape

The public warm-frame transport attachment has the following shape:

```ts
const PUBLICATION_TRANSPORT_ATTACHMENT_VERSION = 1

type PublicationFrameAttachment = {
    readonly kind: "publication.warmFrame"
    readonly attachmentVersion: typeof PUBLICATION_TRANSPORT_ATTACHMENT_VERSION
    readonly streamKey: string
    readonly subscriptionId: SubscriptionId
    readonly authorityEpoch: AuthorityEpoch
    readonly contractKey: ContractKey
    readonly projectionInstanceKey: ProjectionInstanceKey
    readonly lane: "warm"
    readonly frameBytes: Uint8Array
}
```

The attachment is not a control response and not a resource message. `frameBytes` must decode as a warm framed-snapshot
publication for the declared `(contractKey, projectionInstanceKey)`. The attachment does not define queueing,
backpressure, retries, replay, delivery ordering, or any concrete IPC mechanism.

Host warm-stream descriptors may advertise the `attachmentVersion` they expect. That is metadata for agreement; it does
not transfer a publication frame.

### 7.4 Continuity break in a warm stream

If the authority emits a publication whose `continuityGeneration` differs from the previous frame's
`continuityGeneration`, or whose `baselineEpoch` differs from the ack's declared `baselineEpoch`, the consumer must:

1. Discard any derived local state that was computed from prior publications.
2. Treat the new frame as a fresh baseline for subsequent publications.
3. Not attempt to reconstruct continuity from the old publication history.

A continuity break within an active warm subscription is not subscription invalidation. The subscription remains active.
The projection instance has experienced a continuity event that the consumer must handle per spine section 9.3.

### 7.5 Recoverable frame rejection

Per Warm Codec v1, certain frame-level errors are recoverable per-frame errors and must not cause stream teardown. These
errors produce a `WarmFrameRejectedEvent`:

```ts
type WarmFrameRejectedEvent = {
    readonly kind: "warmFrameRejected"
    readonly subscriptionId: SubscriptionId
    readonly authorityEpoch: AuthorityEpoch
    readonly contractKey: ContractKey
    readonly projectionInstanceKey: ProjectionInstanceKey
    readonly reason:
        | "malformedFrameLength"
        | "malformedPayloadLength"
        | "invalidBoolean"
        | "invalidEnum"
        | "countOverflow"
        | "mapOrderingViolation"
        | "duplicateMapKey"
        | "invalidUtf8"
    readonly detail?: string
}
```

A `WarmFrameRejectedEvent` does not end the stream. The subscription remains `active`. The consumer discards the
rejected frame and continues.

Repeated recoverable frame rejection may cause an implementation profile to close and resubscribe the stream, but that
escalation is a higher-layer policy decision, not a codec-level stream teardown. The escalation path is not defined by
this document; it must be specified by the implementation profile.

### 7.6 Unsubscribe

```ts
interface UnsubscribePublicationRequest {
    readonly subscriptionId: SubscriptionId
    readonly authorityEpoch: AuthorityEpoch
}

type UnsubscribePublicationResult =
    | { readonly ok: true }
    | { readonly ok: false; readonly failure: SessionBoundFailure }
```

Unsubscribe is epoch-bound. A consumer calling unsubscribe with a stale epoch must receive a `sessionMismatch` failure.
The consumer should still treat the subscription as locally dead regardless of the unsubscribe result.

Unsubscribe against an already-invalidated subscription may be treated as idempotent cleanup; the result may be success
or a well-defined stale-subscription failure. This choice must be specified by the implementation profile and must not
diverge silently.

---

## 8. Subscription invalidation

### 8.1 Session-wide invalidation

Session-wide invalidation events from Control Plane Session Rules section 11 (`authorityEpochReplaced`, `authorityUnavailable`)
implicitly invalidate all active subscriptions under the affected authority epoch.

A consumer that receives one of these events must treat all subscriptions under the previous `authorityEpoch` as dead,
even if no per-subscription invalidation event is delivered.

### 8.2 Per-subscription invalidation event

For finer-grained subscription invalidation, the following event must exist:

```ts
type SubscriptionInvalidatedEvent = {
    readonly kind: "subscriptionInvalidated"
    readonly subscriptionId: SubscriptionId
    readonly authorityEpoch: AuthorityEpoch
    readonly contractKey: ContractKey
    readonly projectionInstanceKey: ProjectionInstanceKey
    readonly reason:
        | "authorityRestart"
        | "projectionReplaced"
        | "sessionExpired"
        | "revoked"
}
```

This event targets one `subscriptionId`. It may be used when the authority needs to invalidate one subscription without
invalidating all subscriptions for the session.

Session-wide invalidation events must not be replaced by per-subscription invalidation events. The two are additive, not
alternatives.

### 8.3 Consumer obligations on invalidation

On receiving session-wide or per-subscription invalidation:

1. Transition all affected subscriptions to `invalidated`.
2. Stop consuming frames from invalidated subscriptions.
3. Retain any `lastGood` state (last successfully received complete snapshot) for renderer-local fallback.
4. Wait for `authorityReady` before resubscribing.

---

## 9. Rebind after `authorityReady`

`authorityReady` is defined in Control Plane Session Rules section 12.1. It is the consumer rebind trigger after authority
replacement.

### 9.1 Consumer obligations on `authorityReady`

On receiving `authorityReady` for a replacement authority session:

1. All subscriptions under the previous epoch are already dead (session-wide invalidation precedes or accompanies this
   event).
2. For each previously active subscription, submit a new `SubscribePublicationRequest` with:
    - the same `contractKey` and `projectionInstanceKey`
    - the same `lane`
    - the consumer's current `expectedSemanticVersion` and `expectedLaneVersion`
    - **no** previous `subscriptionId` (this is a new subscription, not a resume)
3. Handle the ack or failure for each request independently.
4. For surfaces that return `surfaceDeferredNotReady`, wait for the corresponding `PublicationSurfaceReadyEvent` with a
   matching `lane` before retrying.
5. For surfaces that return `surfaceUnavailable`, surface this as a product-level condition.

### 9.2 Rebind is not resume

Rebind is a new subscription, not a continuation of the invalidated subscription.

The new subscription:

- receives a new `subscriptionId`
- receives a new `authorityEpoch` in the ack
- receives a new `baselineEpoch` and `continuityGeneration` that reflect the replacement authority's reopen state
- has no knowledge of or responsibility for the frame history of the invalidated subscription

A consumer that treats rebind as resume, then checks new frames for sequence continuity with old frames, is wrong. The
replacement authority's first frame is a complete fresh snapshot for the `replaceable-snapshot` family.

### 9.3 Race between `authorityReady` and `PublicationSurfaceReadyEvent`

A consumer that receives `authorityReady` and then immediately resubscribes to all previously-active surfaces may
receive `surfaceDeferredNotReady` for some surfaces.

This is expected behavior. Deferred surfaces outside the required-at-startup set may not be publication-ready at the
moment `authorityReady` is emitted. The consumer must buffer these as pending-deferred and wait for the corresponding
`PublicationSurfaceReadyEvent` carrying a matching `lane`.

---

## 10. Stream-fatal warm incompatibility recovery

### 10.1 What makes a warm stream stream-fatal

A warm stream becomes stream-fatal when the consumer receives an incompatibility signal at the stream identity or
version level. Warm Codec v1 classifies those conditions as stream-fatal rather than recoverable per-frame errors.

The primary cases:

- a warm frame arrives whose `warmCodecVersion` differs from the `expectedLaneVersion` the consumer declared at
  subscribe time
- a warm frame arrives with a `contractKey` that does not match the acknowledged surface
- a warm frame arrives with a `projectionInstanceKey` that does not match the acknowledged surface
- a warm frame arrives with a `semanticVersion` that does not match the ack
- the presence of `laneSequence` toggles mid-stream

These stream-fatal conditions are identity- or version-level invariant failures. They are distinct from recoverable
per-frame encoding errors (see section 7.5).

The `codecVersionMismatch` case should be caught at subscribe time as `streamIncompatible`, but may arrive in-stream if
the authority performs a codec migration while a subscription is active.

### 10.2 Stream-fatal event shape

```ts
type WarmStreamFatalEvent = {
    readonly kind: "warmStreamFatal"
    readonly subscriptionId: SubscriptionId
    readonly authorityEpoch: AuthorityEpoch
    readonly contractKey: ContractKey
    readonly projectionInstanceKey: ProjectionInstanceKey
    readonly reason:
        | "codecVersionMismatch"
        | "semanticVersionMismatch"
        | "contractKeyMismatch"
        | "projectionInstanceKeyMismatch"
        | "laneSequencePresenceToggled"
    readonly detail: string
}
```

On receiving this event, the consumer must transition the subscription to `streamFatal` and stop consuming frames.

`malformedFrame` is not a valid `WarmStreamFatalEvent` reason. Malformed frame conditions are recoverable per-frame
errors handled by `WarmFrameRejectedEvent` (section 7.5), not stream-fatal incompatibilities.

### 10.3 Recovery path

A `streamFatal` subscription cannot be recovered by resubscribing to the same surface under the same authority epoch.
The stream-fatal condition is session-local for this subscription.

Recovery for all `WarmStreamFatalEvent` reason values requires the consumer to be rebuilt against the current contract
before resubscribing. These are all identity- or version-level mismatches; resubscribing without correcting the version
alignment will fail immediately at subscribe time with `streamIncompatible`.

A consumer that silently discards stream-fatal events and continues reading subsequent frames from the dead stream is in
violation of this document.

---

## 11. Relationship between hot handle open and publication subscription

Hot handle open and publication subscription are **two distinct operations** that happen to provide access to the same
projection instance through different lanes and different protocol paths.

### 11.1 Hot handle open

- Travels through the hot mapping protocol (Hot SAB Lifecycle)
- Returns a `HotMappingDescriptor` and `HotHandleId`
- The consumer then calls `bind()` to validate the mapped region
- Read access is through the generated binding's `tryReadLatest()`
- Invalidation arrives through `HotHandleInvalidated`
- The lifecycle is owned by Hot SAB Lifecycle and Hot Lane Consumer Runtime

### 11.2 Publication subscription

- Travels through the publication subscription protocol defined in this document
- Returns a `SubscribePublicationAck` with a `subscriptionId`
- Ongoing access is through a stream of warm frames delivered on the publication channel
- Invalidation arrives through `SubscriptionInvalidatedEvent` or session-wide invalidation
- The lifecycle is owned by this document

### 11.3 They are complementary, not alternatives

A consumer may simultaneously hold:

- a hot binding for real-time latest-state reads (low-latency, seqlock-protected)
- a warm subscription for reliable frame delivery (continuity-aware, IPC-framed)

These are different transport characteristics for the same logical projection instance. Projection Spine section 1.3
defines hot, warm, and cold as non-interchangeable lanes.

### 11.4 They may succeed or fail independently

A hot handle open may succeed while a warm subscribe fails. A warm subscribe may succeed while a hot handle fails to
bind. Each operation's success or failure is independent.

### 11.5 Invalidation is separate

Hot handle invalidation (`hotHandleInvalidated`) and subscription invalidation (`subscriptionInvalidated`) are delivered
through different events and must not be conflated. A host adapter must not invent a combined invalidation path that
handles both as though they were the same.

---

## 12. Acceptance criteria

A compliant implementation satisfies all of the following:

- subscribe requests return typed acks or typed failures; no generic transport errors
- `surfaceDeferredNotReady` and `surfaceUnavailable` are distinct discriminants in `PublicationSubscribeFailure`
- `PublicationSurfaceReadyEvent` is push-based; consumers do not poll for deferred surface availability
- `PublicationSurfaceReadyEvent` carries a `lane` field; consumers match on `(contractKey, projectionInstanceKey, lane)`
  when deciding whether to retry
- subscribe ack is epoch-establishing; the subscription is bound to `authorityEpoch` after ack
- ack commits the authority to deliver an initial complete snapshot; authority must not ack unless it can enqueue or
  emit that snapshot
- the first warm frame after ack is a complete snapshot for `replaceable-snapshot` surfaces
- `baselineEpoch` and `continuityGeneration` in the ack match the first frame
- `subscriptionId` scopes subsequent events and invalidations for this subscription session
- `subscriptionId` is distinct from `projectionInstanceKey`; multiple subscriptions for the same surface must be
  distinguishable
- session-wide invalidation events from Control Plane Session Rules implicitly kill all subscriptions under the affected
  epoch
- per-subscription invalidation events target `subscriptionId`, not only `projectionInstanceKey`
- `streamIncompatible` carries both consumer-side and surface-side version values
- `warmStreamFatal` transitions the subscription to `streamFatal`; no further frames are consumed
- `warmStreamFatal` reason values are restricted to identity- and version-level stream incompatibilities;
  `malformedFrame` is not a valid reason
- recoverable warm frame errors produce `WarmFrameRejectedEvent` and do not end the stream
- warm frame carriage uses a typed `PublicationFrameAttachment`
- publication frame attachments carry `attachmentVersion`, `streamKey`, `subscriptionId`, `authorityEpoch`,
  `contractKey`, `projectionInstanceKey`, `lane`, and `frameBytes`
- control replies do not carry `PublicationFrameAttachment` or warm frame bytes
- resource bodies and resource descriptors are not publication messages
- host warm-stream descriptors may advertise `attachmentVersion` but do not carry frames
- `lane: "cold"` subscribe requests are rejected with `coldLaneNotRatified` in v1 conforming implementations
- consumer rebind after `authorityReady` submits fresh subscribe requests; it does not resume prior subscriptions
- consumer rebind receives `surfaceDeferredNotReady` for surfaces that have not yet completed post-session-ready reopen;
  it then waits for `PublicationSurfaceReadyEvent` with matching lane
- hot handle open and publication subscription are separate protocol paths; a host adapter must not conflate them
- unsubscribe is epoch-bound; its result (accepted or stale-subscription failure) must be specified by the
  implementation profile

---

## 13. Rejected alternatives

### Rejected: generic "surface not ready" failure for both `surfaceUnavailable` and `surfaceDeferredNotReady`

These are different consumer obligations. Surface-unavailable is terminal absent explicit domain initialization.
Deferred-not-ready is transient and awaiting a push signal. A consumer cannot act correctly without distinguishing them.

### Rejected: consumer polling subscription acceptance to detect deferred surface readiness

Deferred surface readiness is a push event. Polling subscription acceptance as a proxy creates polling loops and
races. `PublicationSurfaceReadyEvent` is the defined mechanism.

### Rejected: ack without a subscriptionId

The `subscriptionId` is required to target per-subscription invalidation events. Without it, per-subscription
invalidation can only target `projectionInstanceKey`, which is insufficient when a consumer holds multiple subscriptions
for the same surface across session transitions.

### Rejected: ack without epoch-establishing behavior

The ack must bind the subscription to an `authorityEpoch` so that all subsequent events and invalidations can be
epoch-verified. A subscription without an established epoch is unverifiable.

### Rejected: consuming warm frames after `warmStreamFatal`

A stream-fatal event ends the stream. Continuing to read subsequent frames from a stream-fatal subscription
silently accepts potentially undecodable or corrupted frame data.

### Rejected: treating rebind as resume

Rebind is a new subscription with new session context. The replacement authority's publication history starts
fresh. A consumer that checks new frames for sequence continuity with old frames imposes a continuity requirement that
neither the spine nor the replacement authority guarantees.

### Rejected: hot handle open as a precondition for warm subscription

They are independent operations. A consumer subscribing to the warm lane of a projection that also supports hot
access does not need a valid hot binding to subscribe. The lanes are independent.

### Rejected: `warmStreamFatal` as an `authorityUnavailable` equivalent

A stream-fatal event is a stream-local failure, not a session-wide authority failure. Session-wide authority
events are `authorityEpochReplaced` and `authorityUnavailable` from Control Plane Session Rules. Conflating them
prevents consumers from distinguishing a version mismatch (fix: rebuild) from an authority crash (fix: wait for
`authorityReady`).

### Rejected: `streamIncompatible` without carrying both consumer and surface version values

An incompatibility that only says "versions disagree" is not diagnosable. The consumer's compiled version and the
surface's current version must both be present so the incompatibility is visible in logs and tooling without additional
context.

### Rejected: `malformedFrame` as a `WarmStreamFatalEvent` reason

Malformed frame conditions (length mismatch, invalid bool, invalid enum, count overflow, map ordering violations,
invalid UTF-8) are recoverable per-frame errors per Warm Codec v1. They must not cause stream teardown. Stream-fatal
events are reserved for identity- and version-level stream incompatibilities. A design that puts `malformedFrame` in
`WarmStreamFatalEvent` collapses the recoverable/fatal split that Warm Codec v1 worked hard to establish.

### Rejected: surface-level `PublicationSurfaceReadyEvent` without a `lane` field

The subscription protocol is lane-scoped. Failures are lane-sensitive. Cold is not ratified in v1. A
surface-level ready signal that does not name the lane forces consumers to guess which lane is ready or to treat
readiness as an all-lanes signal, which is incorrect when cold is not ratified and lanes may become ready independently.

### Rejected: ack without guaranteed initial snapshot delivery

An ack that may never be followed by a first frame leaves the consumer in an indefinite "buffering" state with no
defined resolution. For `replaceable-snapshot` surfaces, the authority already holds the current snapshot at subscribe
time. If it cannot enqueue or emit that snapshot under the acknowledged `baselineEpoch` and `continuityGeneration`, it
must not ack.

### Rejected: cold subscription as implementation-ready in v1

The cold materialization codec is not ratified. Accepting cold subscription requests in v1 implementations
without a defined codec, codec version identity, or conformance path creates protocol surface without conformance
backing. Cold subscriptions are reserved; v1 authorities must reject them with `coldLaneNotRatified`.
