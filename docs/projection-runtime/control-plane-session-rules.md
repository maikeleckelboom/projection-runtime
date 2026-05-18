# Control Plane Session Rules

Companion to:

- Boundary Model
- Exclave Projection Spine: Canonical Architecture Spec

Status: Draft for ratification. Intended to become implementation-authoritative for runtime session validity and
authority epoch rules.

This document defines control-plane session validity, authority epoch issuance, epoch-bound versus bootstrap traffic,
and mismatch handling across control, publication, hot binding, and resource-handle surfaces.

It does not define cold reopen sequencing in full.
It defines the session rules that cold reopen depends on.

---

## 1. Purpose

The system already distinguishes:

- control-plane requests and replies
- publication-plane state synchronization
- resource-plane large or mapped data access

What is still needed is a runtime/session validity model that lets the system answer:

- which live authority session a request or handle belongs to
- how stale commands and handles are rejected
- how authority restart invalidates hot bindings and resource handles
- which messages are legal before a session is established
- how epoch mismatch is surfaced

This document defines that model.

---

## 2. Core noun

### Authority epoch

`authorityEpoch` is the runtime/session validity identifier for one live authority session.

It is:

- session-scoped
- authority-issued
- opaque: consumers must not derive ordering or meaning from its internal structure
- non-reused: no two live authority sessions may share the same `authorityEpoch`
- equality-comparable: the only required operations are equality and inequality checks
- distinct from `semanticVersion`
- distinct from lane-specific version identities
- distinct from `baselineEpoch`
- distinct from `continuityGeneration`
- distinct from `publicationSequence`

`authorityEpoch` is not projection semantics.
It is runtime/session validity.

Unless a separate document explicitly requires numeric ordering of authority epochs, `authorityEpoch` must be treated as
an opaque session identifier.

`authorityEpoch` may be represented as `bigint` in TypeScript for transport and validation convenience, but consumers
must not use numeric ordering comparisons on `authorityEpoch` values. Equality and inequality are the only legal consumer
operations. Unless a separate document explicitly requires numeric ordering of authority epochs, `authorityEpoch` must be
treated as an opaque session identifier.

---

## 3. What authorityEpoch is not

`authorityEpoch` is not:

- the contract version
- the projection baseline epoch
- the continuity generation
- the publication sequence
- a durable SQLite identifier
- a renderer-generated token

Those identifiers answer different questions and must not be collapsed.

---

## 4. Issuance rules

### 4.1 Session creation

A live authority session is created when an authority instance becomes active for runtime work.

### 4.2 Epoch assignment

Each live authority session is assigned exactly one `authorityEpoch`.

### 4.3 Replacement

When an authority instance is restarted, replaced, or otherwise superseded, the new session must use a new
`authorityEpoch`.

### 4.4 Non-reuse

An `authorityEpoch` must not be reused for a later authority session.

---

## 5. Traffic classes relative to session validity

Messages fall into two classes:

### 5.1 Bootstrap / epochless traffic

These are legal before the caller knows a current `authorityEpoch`.

Examples:

- discover capabilities
- open a new subscription session
- request a hot binding handle
- open a resource
- ask for the current authority session descriptor

These messages do not mutate or act against existing session-owned state.
They establish access to it.

Some epochless requests are epoch-establishing: their replies bind the returned handle or subscription to one
`authorityEpoch`, and all subsequent operations against that handle or subscription become epoch-bound. This transition
must be made explicit in the reply contract.

### 5.2 Epoch-bound traffic

These require a known current `authorityEpoch`.

Examples:

- stateful control commands against a live authority
- reads tied to a live session
- resource reads against an open handle
- resource closes against an open handle
- session-bound publication resubscription updates
- hot-handle or resource-handle operations after open

Epoch-bound traffic must include `authorityEpoch`.

---

## 6. Required surfaces that carry authorityEpoch

At minimum, the following surfaces must carry `authorityEpoch`:

- authority session descriptor replies
- hot binding open replies (epoch-establishing)
- warm/publication subscription acknowledgements (epoch-establishing)
- resource open replies (epoch-establishing)
- all epoch-bound control requests
- all resource read/close/map requests
- authority-driven invalidation messages

Publication payload carriage of `authorityEpoch` is out of scope for this document.
Hot-lane invalidation may be driven by control/session-side signals without embedding `authorityEpoch` into mapped
publication regions.
But the system must have one clear way to determine that a hot mapping belongs to a stale authority session.

---

## 7. Minimal session descriptor shape

A minimal authority session descriptor must expose a shape equivalent to:

```ts
type AuthoritySessionDescriptor =
    | { state: "starting"; authorityEpoch: bigint }
    | { state: "ready"; authorityEpoch: bigint }
    | { state: "stopping"; authorityEpoch: bigint }
    | { state: "stopped" }
```

`authorityEpoch` is mandatory when a live session exists. It is absent when no live session exists.
A flat interface with a mandatory epoch field is wrong: `"stopped"` has no live session and therefore no current
`authorityEpoch`.

This document defines session validity, not full recovery flow.
The cold reopen document defines when `"ready"` becomes sufficient for publication rebind.

---

## 8. Mismatch handling

If a request or handle carries an `authorityEpoch` that does not match the current live authority session, the operation
must fail with an explicit epoch mismatch result.

The system must not silently redirect a stale request or handle onto the new session.

Mismatch is not an implementation detail.
It is a first-class boundary fact.

---

## 9. Required mismatch outcomes

### 9.1 Control requests

Epoch-bound control requests with stale `authorityEpoch` must fail with an explicit session-mismatch reply.

### 9.2 Resource handle operations

Resource read/map requests with stale `authorityEpoch` must fail with an explicit session-mismatch or handle-invalid
result.

Resource close requests against a stale or revoked handle may be treated as idempotent cleanup. This does not restore
handle validity and does not imply success of any other operation. Whether stale-close is accepted or rejected must be
specified explicitly; implementations must not diverge silently on this point.

### 9.3 Hot bindings

Hot bindings do not self-heal across session replacement.
They must be invalidated and treated as stale.

### 9.4 Warm/publication subscriptions

The subscription layer must not pretend continuity across authority replacement.
The cold reopen and publication documents define the rebasing flow.
This document only requires explicit session replacement handling.

---

## 10. Failure result shapes

Control-plane session-validity failures must be surfaced as boundary facts, not as generic transport errors.

At minimum, callers must be able to distinguish:

```ts
type SessionBoundFailure =
    | { kind: "sessionMismatch"; expectedAuthorityEpoch: bigint; providedAuthorityEpoch: bigint }
    | { kind: "handleInvalid"; handleId: string; reason: "revoked" | "expired" | "staleEpoch" }
    | { kind: "authorityUnavailable" }
    | { kind: "authorityNotReady"; state: "starting" | "stopping" }
    | { kind: "requestIllegalByContract"; detail: string }
    | { kind: "requestIllegalInCurrentProductState"; detail: string }
```

`authorityNotReady` is distinct from `authorityUnavailable`. An authority in `"starting"` or `"stopping"` state exists
and has a known epoch but is not yet publication-ready. Callers must be able to observe this: it has different retry
semantics than a crashed or absent authority.

These failure kinds are different and must not be collapsed into one generic transport error.

---

## 11. Push invalidation

Pull-time mismatch failures are not enough.

When an authority session is replaced, the system must be able to push invalidation to consumers that hold session-owned
live handles.

At minimum, the following invalidation event kinds must exist:

```ts
type SessionInvalidationEvent =
    | {
    kind: "authorityEpochReplaced"
    replacedAuthorityEpoch: bigint
    replacingAuthorityEpoch: bigint
}
    | {
    kind: "authorityUnavailable"
    replacedAuthorityEpoch: bigint
    state: "stopping" | "stopped"
}
    | {
    kind: "resourceHandleInvalidated"
    authorityEpoch: bigint
    handleId: string
    reason: "authorityRestart" | "resourceReplaced" | "revoked" | "expired"
}
    | {
    kind: "hotHandleInvalidated"
    authorityEpoch: bigint
    handleId: string
    projectionInstanceKey: string
    reason: "authorityRestart" | "projectionReplaced" | "revoked"
}
```

`authorityEpochReplaced` covers restart-with-immediate-successor.
`authorityUnavailable` covers authority crash, shutdown, or stopping where no successor epoch exists yet. Handles must
die in this case without waiting for a replacement epoch to appear.

Hot handle invalidation targets the actual opened handle identifier, not just the projection instance key.
If multiple consumers hold different hot handles for the same projection instance, each handle must be addressed
independently.

This event model may be refined by later docs, but authority-driven invalidation is mandatory.
Request-time failure alone is insufficient for live runtime correctness.

---

## 12. Session state transition events

Push invalidation events cover handle death. They do not cover affirmative session state transitions that consumers need
to observe.

The following session state transition events must also exist and be deliverable to consumers:

```ts
type SessionStateEvent =
    | {
    kind: "authorityReady"
    authorityEpoch: bigint
}
    | {
    kind: "authorityStarting"
    authorityEpoch: bigint
}
```

### 12.1 `authorityReady`

`authorityReady` is the signal that the replacement authority session has completed required-at-startup reopen work and
is now able to accept subscriptions for publication-ready surfaces.

This is the consumer rebind trigger.

Consumers must not poll for readiness. They must wait for this event.

`authorityReady` must not be emitted before the authority session transitions to `state: "ready"`.
`authorityReady` is not a guarantee that every restartable surface is publication-ready. It is a guarantee that the
required-at-startup set has reached terminal reopen outcomes.

### 12.2 `authorityStarting`

`authorityStarting` is emitted when a replacement authority session is created and enters `state: "starting"`.

It is informational. It tells consumers that a replacement session exists and has an epoch, but is not yet accepting
subscriptions.

Consumers must not attempt to rebind on `authorityStarting` alone. They must wait for `authorityReady`.

### 12.3 Relationship to `SessionInvalidationEvent`

`SessionStateEvent` and `SessionInvalidationEvent` are separate event families.
Invalidation events cover handle death and session loss.
State events cover affirmative session lifecycle transitions.
They may be delivered on the same channel or different channels; delivery mechanics belong to the session layer. This
document defines only the event shapes and their behavioral obligations.

---

## 13. Hot binding relationship

Hot consumer runtime depends on this document.

A hot binding must be treated as belonging to one authority epoch.
When that epoch is replaced, the binding becomes stale.

This document does not define hot SAB allocation or remap mechanics.
The hot SAB lifecycle document owns those details.
This document only defines the session-validity rule that stale mappings depend on.

---

## 14. Cold reopen relationship

Cold reopen sequencing depends on these session rules.

This document therefore establishes these prerequisite rules for the reopen flow:

An authority session must not be treated as publication-ready merely because it has a new `authorityEpoch`.
Readiness is a separate session state transition.

The `authorityReady` event defined in section 12 is the consumer rebind trigger after reopen. Cold reopen is the
sequence that leads to `authorityReady` being emittable.

The cold reopen document defines:

* when readiness is reached
* when subscriptions may be accepted
* when rebasing publications are emitted

---

## 15. Generated contract discipline

Control-plane requests must not use untyped option bags for session-sensitive operations.

If a request is session-bound, the request contract must declare the `authorityEpoch` field explicitly.
It must not hide session validity inside a generic metadata map or transport wrapper.

This system is typed by contract, not by stringly convention.

---

## 16. Rejected alternatives

### Rejected: consumers polling for session readiness

Session readiness is an affirmative push signal (`authorityReady`). Consumers must not poll the session
descriptor or any other surface to infer readiness. A system that requires polling for readiness will diverge across
implementations.

### Rejected: treating `authorityStarting` as a rebind trigger

`authorityStarting` is informational. The rebind trigger is `authorityReady`. Rebinding on `authorityStarting`
alone races ahead of required-at-startup reopen completion.

### Rejected: merging `SessionStateEvent` and `SessionInvalidationEvent` into one type

Invalidation events signal handle death and session loss. State events signal affirmative lifecycle transitions.
These have different consumers, different response semantics, and different delivery urgency. Merging them into one
undifferentiated event stream makes it impossible to act on them correctly without re-discriminating them internally.

### Rejected: using baselineEpoch as session identity

Baseline identity and session identity answer different questions.

### Rejected: flat `AuthoritySessionDescriptor` interface with mandatory `authorityEpoch`

`"stopped"` has no live session and therefore no current `authorityEpoch`. A flat interface that requires an
epoch in all states forces either a lie (fabricated epoch) or a nullable field on a supposedly mandatory identifier. Use
the discriminated union.

### Rejected: collapsing `authorityNotReady` into `authorityUnavailable`

An authority in `"starting"` or `"stopping"` is not the same as an absent or crashed authority. The former is a
transient in-progress state with a known epoch; the latter is a hard absence. Callers need to distinguish them because
the correct response differs.

### Rejected: only one invalidation event for all authority-loss conditions

`authorityEpochReplaced` is only correct when a successor exists immediately. Authority crash or shutdown without
an immediate successor requires a separate `authorityUnavailable` event so handle holders know to fail closed without
waiting.

### Rejected: treating `authorityEpoch` as a monotonically ordered counter without explicit specification

Ordering implies more than equality. Consumers must not rely on numeric ordering of `authorityEpoch` values
unless a document explicitly specifies that ordering is guaranteed and meaningful. The default is opaque, non-reused,
equality-comparable.

### Rejected: silently forwarding stale requests to the new session

That hides authority replacement and destroys correctness.

### Rejected: epochless stateful resource reads

Session-bound handle operations must carry session validity.

### Rejected: request-time mismatch only, no push invalidation

Live runtime surfaces require authority-driven invalidation.

### Rejected: hiding authorityEpoch in generic metadata

Session validity is part of the contract surface, not a transport detail.

### Rejected: handle-invalidation events that target only instance keys

If multiple consumers hold different handles for the same projection instance, instance-key targeting does not
correctly address individual handles. Invalidation must target handle identifiers.

### Rejected: collapsing session-bound failures into one generic transport error

The system must allow callers to distinguish session mismatch from contract violations, handle revocation,
authority unavailability, and authority-not-ready. These have different correct responses and must not be made
indistinguishable.
