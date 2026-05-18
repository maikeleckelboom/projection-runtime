# Cold Reopen Sequence

Companion to:

- Control Plane Session Rules
- Exclave Projection Spine: Canonical Architecture Spec

Status: Draft for ratification. Intended to become implementation-authoritative for cold-backed reopen of restartable
publication surfaces.

This document defines the authority-driven reopen sequence after authority session replacement. It specifies
restartable-surface eligibility, preconditions, readiness gating, cold materialization selection, metadata reset rules,
republish behavior, and consumer rebind expectations for restartable replaceable-snapshot surfaces.

It does not redefine publication continuity semantics, session issuance, warm codec framing, resource protocol
internals, or hot SAB allocation mechanics. Those concerns belong to their companion documents.

If this document and the spine disagree on publication semantics, reset rules, or replaceable-snapshot family rules, the
spine is authoritative and this document is wrong.
If this document and control-plane session rules disagree on `authorityEpoch`, session states, invalidation events, or
readiness semantics, the session rules document is authoritative and this document is wrong.

---

## 1. Purpose

Cold reopen is an authority-driven rebase sequence that restores restartable publication surfaces from cold
materialization into a new live authority session, then republishes them as fresh baseline-compatible publications after
readiness is reached.

This document defines the operational rules that remain after the spine and session rules are already accepted:

- what counts as a restartable surface
- who may perform reopen work
- what must be invalidated before reopen proceeds
- when a new authority session is merely `starting` versus actually `ready`
- how a reopen candidate is selected from cold materialization
- what metadata changes on reopen
- how same-domain restart differs from baseline replacement
- what consumers must wait for before treating reopened state as live
- what happens when no usable cold materialization exists
- what triggers consumer rebind

---

## 2. Invariant: cold rows are authority recovery input, not consumer state

Cold rows belong to the authority as recovery input. They are not renderer truth. They are not consumer-facing state.

Consumers do not read cold rows to recover. They recover by consuming fresh rebasing publications emitted by the
replacement authority after readiness is reached.

No implementation may route cold row access to the renderer or treat cold materialization as a consumer publication
surface.

This invariant applies regardless of what is convenient at implementation time.

---

## 3. Scope and non-scope

### 3.1 In scope

This document covers:

- authority replacement for restartable publication surfaces
- invalidation of old-session live handles before reopen
- cold-row selection for restartable replaceable-snapshot surfaces
- readiness gating for reopened publication surfaces
- republish and rebind expectations after reopen
- explicit behavior when no usable cold row exists

### 3.2 Out of scope

This document does not define:

- authority session issuance mechanics in full
- hot SAB allocation, replacement, or remap mechanics in full
- warm codec framing or payload bytes
- resource chunk protocol internals
- SQLite query implementation details
- product-specific restartability decisions for every future surface family

Those belong to other documents.

---

## 4. Core nouns for this document

### 4.1 Restartable surface

A **restartable surface** is a publication surface that product policy explicitly permits to be reopened into a
replacement authority session from cold materialization or fresh initialization.

Restartability is not implied merely because a surface exists on the cold lane.
Restartability must be declared by product policy.

### 4.2 Required-at-startup set

The **required-at-startup set** is the set of restartable surfaces that product policy declares must complete reopen
work before the authority session may transition to `ready`.

This set is declared by product policy, not inferred by the authority at runtime.

The required-at-startup set may be a proper subset of all restartable surfaces. Surfaces outside the required set may
complete reopen work after session readiness without blocking the session transition.

### 4.3 Reopen candidate

A **reopen candidate** is the cold materialization selected as the source input for authority-side reopen of one
restartable surface in one replacement session.

### 4.4 Recovery authority session

A **recovery authority session** is the replacement authority session that performs reopen work for restartable surfaces
after the previous live authority session has died, been stopped, or been superseded.

### 4.5 Readiness

**Readiness** means the authority session has completed reopen work for all surfaces in the required-at-startup set and
is able to accept subscriptions for surfaces that are publication-ready.

Session `ready` is a session-level gate. It is not a blanket publication guarantee for every restartable surface.

Session `ready` does not mean every surface is publication-ready.
Session `ready` means all required-at-startup surfaces have reached a terminal reopen outcome, whether reopened,
fresh-initialized, or surface-unavailable.

Readiness is not the same thing as:

- having a newly assigned `authorityEpoch`
- having process liveness
- having opened storage
- having accepted control-plane bootstrap traffic

### 4.6 Terminal reopen outcome

Every restartable surface must reach exactly one terminal reopen outcome during startup. The legal terminal outcomes are
defined in section 15.

For surfaces outside the required-at-startup set, that terminal startup outcome may be a deferred-not-ready state that
completes later through the deferred surface readiness path defined in section 14.

### 4.7 Rebasing publication

A **rebasing publication** is the first live publication emitted by the replacement authority session for a reopened
surface after readiness is reached.

For replaceable-snapshot surfaces, the rebasing publication is itself a complete valid snapshot.

---

## 5. Preconditions

The reopen sequence begins when the old authority session ceases to be live.

The following conditions must be true before replacement-session reopen work is treated as live:

1. The old authority session is no longer live for the affected surface.
2. The replacement authority session has a new `authorityEpoch`.
3. Old-session publication ownership has ended for the affected surface.
4. The target surface is declared restartable by product policy.
5. The target surface belongs to a projection family whose cold materialization semantics are already defined.
6. Any selected cold materialization is compatible with the surface's current reopen compatibility policy.

Conditions 1 and 3 are true at sequence start.
Old-session live handle invalidation (step 3 of the sequence) is the mechanism by which those conditions are enforced
for consumers. That invalidation must complete before replacement-session publications are treated as live.

Cold state restoration work (steps 5–8) may begin after old-session ownership ends, in parallel with or before
consumer-facing invalidation delivery completes, because it is internal authority work. It must not be surfaced to
consumers until invalidation has been delivered.

---

## 6. Applicability in v1

This document applies only to **restartable replaceable-snapshot surfaces**.

This restriction exists because the spine already defines, for that family:

- every publication is a complete, self-contained snapshot
- missed intermediate publications are not errors
- latest-snapshot cold rows are complete snapshots
- checkpointed cold rows are also complete snapshots with no delta relationship between adjacent rows

No other projection family is covered by this reopen document in v1.

---

## 7. Reopen compatibility policy

A cold row is usable for reopen only if it satisfies the reopen compatibility policy for that surface.

At minimum, a reopen compatibility policy must answer:

- which `semanticVersion` values are acceptable
- which `coldCodecVersion` values are acceptable
- whether reopen requires exact current contract compatibility or allows an explicitly defined migration path

The default v1 rule is strict:

- same `contractKey`
- same `projectionInstanceKey`
- same `semanticVersion`
- same `coldCodecVersion`

If a future document allows a compatible migration path, that exception must be defined explicitly. It must not be
inferred ad hoc at runtime.

---

## 8. Cold materialization selection rules

Selection is per projection instance.

### 8.1 Latest-snapshot materialization

If the surface uses latest-snapshot materialization, the reopen candidate is:

- the latest stored row for that `(contractKey, projectionInstanceKey)` pair
- that also satisfies the reopen compatibility policy

There is at most one usable latest row after compatibility filtering.

### 8.2 Checkpointed snapshot series

If the surface uses checkpointed snapshot series, the reopen candidate is:

- the lexicographically latest compatible row for the projection instance
- under the composite ordering:

```text
(projectionInstanceKey, baselineEpoch, continuityGeneration, publicationSequence)
```

Selection must not ignore `continuityGeneration`.
Selection must not reconstruct state across multiple rows.
The selected row alone is the reopen candidate.

### 8.3 No cross-row reconstruction

For replaceable-snapshot reopen, the authority must not combine multiple cold rows to reconstruct one reopen state.

The selected row must already be a complete snapshot.

---

## 9. Two reopen policy branches when no usable candidate exists

Each restartable surface class must declare one of these policies:

### 9.1 Fresh initialize

If no usable cold candidate exists, the authority constructs a fresh valid internal state for that surface by domain
rules, then later publishes it through the appropriate publication path.

### 9.2 Surface unavailable

If no usable cold candidate exists and the surface cannot be meaningfully reopened without explicit domain
initialization, the authority keeps that surface unavailable until the later initialization path completes.

Surface unavailable is a terminal reopen outcome. It does not block session readiness.

A surface class must pick one of these policies explicitly.
Implementations must not diverge silently.

---

## 10. Two reopen cases: same-domain restart versus baseline replacement

This document distinguishes two cases.

### 10.1 Same-domain authority restart

This is the normal reopen case where the replacement authority session resumes the same authoritative domain for the
same projection instance.

Metadata consequences:

- `baselineEpoch` remains unchanged
- `continuityGeneration` increments by 1
- `publicationSequence` resets to 0

### 10.2 Baseline replacement during reopen

If the authority explicitly establishes a new authoritative baseline for the same projection instance, the reopen is a
baseline replacement.

Baseline replacement is an explicit authority/domain decision with a declared intent.

It must not be inferred from:

- absence of a usable cold candidate
- cold candidate version incompatibility
- any implicit storage or compatibility condition

A version-incompatible cold candidate is a no-candidate outcome governed by section 9. It is not a trigger for baseline
replacement.

Metadata consequences of baseline replacement:

- `baselineEpoch` increments
- `continuityGeneration` resets to 0
- `publicationSequence` resets to 0

This branch must be chosen by an explicit authority/domain decision.
No implementation may trigger baseline replacement silently from a storage condition.

---

## 11. Authority readiness rule

This is a hard rule:

**A replacement authority session must not accept a subscription for a restartable publication surface until it is able
to produce a baseline-valid publication for that surface.**

This means:

- a new `authorityEpoch` alone is insufficient
- `state: "starting"` is insufficient
- cold checkpoint lookup alone is insufficient
- partial reopen work is insufficient

Subscription acceptance for a restartable surface is legal only after the authority can actually publish that surface.

Surfaces that have reached the surface-unavailable terminal outcome must reject subscription requests with an explicit
`surfaceUnavailable` typed failure. They must not silently queue or silently drop them.

Surfaces that are deferred-not-ready (outside the required-at-startup set and still completing reopen work) must reject
subscription requests with a distinct `surfaceDeferredNotReady` typed failure.

These two failures must not share the same typed discriminant. The exact wire shapes belong to the surface contract or
later publication documents, but the behavioral distinction is established here.

---

## 12. Reopen sequence

The reopen sequence is defined as follows.

### Step 1. Old authority session ceases to be live

The old authority session dies, stops, or is superseded.
At this point, old-session publication ownership is over.

### Step 2a. Planned replacement: replacement session is created first

For planned authority replacement where a successor is standing up before the predecessor dies:

1. The replacement authority session is created with a new `authorityEpoch` and enters `state: "starting"`.
2. The session/control layer emits `authorityEpochReplaced` carrying both `replacedAuthorityEpoch` and
   `replacingAuthorityEpoch`.

`authorityEpochReplaced` requires both epochs to be known at emission time. The replacement session must exist before
this event can be emitted.

### Step 2b. Crash or shutdown without immediate successor

For authority crash or unplanned shutdown where no successor yet exists:

1. The session/control layer emits `authorityUnavailable` carrying `replacedAuthorityEpoch`.
2. The replacement authority session is created later, with a new `authorityEpoch`.

In this case, invalidation events precede replacement session creation.

Both orderings are legal. Implementations must handle both.

### Step 3. Old-session live handles are invalidated

In both cases, before reopen work from the replacement session is treated as live, the session/control layer must
deliver the appropriate events from the `SessionInvalidationEvent` family (defined in the control-plane session rules
document) to all consumers holding old-session live surfaces:

- `hotHandleInvalidated` for each live hot handle
- `resourceHandleInvalidated` for each live resource handle
- `authorityEpochReplaced` or `authorityUnavailable` (already emitted in step 2a or 2b) for publication/subscription
  consumers watching the session

Publication and subscription consumers that are watching session state must treat receipt of `authorityEpochReplaced` or
`authorityUnavailable` as the signal to tear down old-session subscriptions. The exact subscription-invalidation
mechanics belong to the publication layer document; this step requires only that the session event is delivered and that
old-session subscriptions do not survive session replacement.

Old-session handles must fail closed. They must not remain open waiting for replacement-session publications to arrive.

### Step 4. Restartable surfaces and required-at-startup set are loaded from product policy

The replacement authority loads and applies the product-declared restartability policy and required-at-startup set.

This is product policy. The authority does not determine it at runtime. The authority loads it and is bound by it.

### Step 5. Reopen candidate selection is performed per restartable surface

For each restartable surface, the replacement authority:

- determines the surface's reopen compatibility policy
- selects a compatible cold candidate if one exists
- otherwise applies the surface's no-candidate policy: fresh initialize or surface unavailable

The renderer does not perform candidate selection.
Cold rows are authority input at this step, nothing else.

### Step 6. Authority restores or initializes internal state

For each restartable surface:

- if a usable reopen candidate exists, the authority restores authority-owned internal state from that candidate
- if no usable candidate exists and policy is fresh initialize, the authority constructs a fresh valid state
- if policy is surface unavailable, the authority marks the surface unavailable for publication until later domain
  initialization

Cold rows are authority recovery input at this step. They do not become publication output and they are not surfaced to
consumers.

### Step 7. Metadata reset rules are applied

For each restored or freshly initialized restartable surface, the authority assigns reopen metadata according to the
correct branch:

Same-domain restart:

- `baselineEpoch` unchanged
- `continuityGeneration += 1`
- `publicationSequence = 0`

Baseline replacement:

- `baselineEpoch += 1`
- `continuityGeneration = 0`
- `publicationSequence = 0`

No other metadata reset pattern is legal for this document.

### Step 8. Per-surface terminal reopen outcome is determined

The authority determines the terminal reopen outcome for each restartable surface:

- reopened and publication-ready, or
- fresh-initialized and publication-ready, or
- surface unavailable pending later initialization, or
- deferred-not-ready pending later completion

Every restartable surface must reach a terminal outcome. No surface may remain in an unspecified limbo state.

### Step 9. Session transitions to `ready` after required-at-startup set completes

The authority session must remain in `state: "starting"` until every surface in the required-at-startup set has reached
a terminal reopen outcome.

Session `ready` does not require all surfaces to be publication-ready.
Session `ready` requires all required-at-startup surfaces to have finished reopen work, whether they ended up
publication-ready or unavailable.

Surfaces outside the required-at-startup set may complete reopen work after session readiness without blocking the
transition.

Once all required-at-startup surfaces have reached a terminal outcome, the authority transitions to `state: "ready"`.

### Step 10. Session readiness is signaled to consumers

When the authority session transitions to `state: "ready"`, that transition is the signal for consumers to rebind.

Consumers must not poll for readiness. The `authorityReady` event is the trigger.

Consumers rebind in response to receiving `authorityReady`. They do not independently watch for new publications and
infer that reopen has completed.

### Step 11. Subscriptions may be accepted only for publication-ready surfaces

After readiness is reached, the authority accepts subscriptions only for surfaces that are publication-ready.

Subscription requests for surface-unavailable surfaces must fail with an explicit typed failure. See section 11 (
authority readiness rule) for the behavioral requirement.

### Step 12. Authority emits rebasing publications

For each publication-ready restartable surface, the authority emits fresh rebasing publications through the publication
path appropriate to each lane, as specified by the respective lane documents.

For hot surfaces, the authority writes to the mapped SAB region.
For warm surfaces, the authority emits codec-framed publication messages.

The framing details belong to the lane specifications. This document only requires that rebasing publications are
emitted for publication-ready surfaces after readiness.

For replaceable-snapshot surfaces, each rebasing publication is already a full valid snapshot.

### Step 13. Consumers rebind and rebase from fresh live publications

Consumers do not recover by reading cold rows directly.

They recover by:

- receiving `authorityReady`
- obtaining new live handles/subscriptions for the replacement session
- consuming fresh rebasing publications

Authority republishes. Consumers do not self-reopen from cold materialization.

---

## 13. Hot, warm, and resource relationship during reopen

### 13.1 Hot bindings

Old-session hot bindings must already be stale before replacement-session publications are treated as live.

A replacement-session hot binding is a new live handle.
It is not a repaired old handle.

### 13.2 Warm/publication subscriptions

Warm/publication subscriptions must not pretend continuity across authority replacement.

They re-enter through the replacement authority session and consume fresh rebasing publications.
The rebind trigger is `authorityReady`.

### 13.3 Resource handles

Old-session resource handles must already be invalidated before replacement-session reopen is treated as live.

Resource reopen details belong to the resource-plane document.
This document only requires that resource handles participate in session invalidation and replacement.

---

## 14. Deferred surface readiness for non-required surfaces

For restartable surfaces outside the required-at-startup set, reopen work may complete after the session transitions to
`ready`.

When such a surface reaches publication-ready status after session `ready`, the authority must push an explicit surface
publication-ready signal to consumers. Consumers may not infer deferred surface readiness from any polling mechanism.

The exact event shape is reserved by the session or surface contract document. This document requires that such a signal
exist and be push-based.

Until that signal arrives for a given surface, subscription requests for that surface must fail with an explicit typed
failure. This failure must be **distinguishable** from the failure returned for surface-unavailable surfaces. They are
different consumer obligations:

- `surfaceUnavailable`: the surface has no valid state and may not become publishable without explicit domain
  initialization. It is terminal or long-lived.
- `surfaceDeferredNotReady`: the surface is in the process of completing reopen work after session `ready`. It is
  transient and expected to become publishable.

A consumer that cannot distinguish these two will treat a transient deferred surface as effectively dead, which is
wrong.

The exact type names and wire shapes belong to the surface contract or session layer document. This document requires
only that the two conditions be distinguishable in typed failure space. They must not share the same failure
discriminant.

---

## 15. Terminal outcomes of reopen

For each restartable surface, cold reopen must end in exactly one of these terminal outcomes:

**1. Reopened and publication-ready**

- authority restored from a compatible cold candidate
- metadata reset rules applied (same-domain restart branch)
- surface may publish through the replacement session

**2. Fresh-initialized and publication-ready**

- no usable cold candidate
- fresh initialization policy selected
- metadata assigned by the correct branch (same-domain restart or baseline replacement, explicit decision)
- surface may publish through the replacement session

**3. Surface-unavailable pending later initialization**

- no usable cold candidate
- surface unavailable policy selected
- surface is not yet publication-ready
- subscription requests for this surface fail with an explicit typed failure

**4. Deferred-not-ready pending later completion**

- the surface is outside the required-at-startup set
- startup reopen work for the session may complete before this surface becomes publication-ready
- subscription requests for this surface fail with `surfaceDeferredNotReady`
- later transition to publication-ready must be announced by the explicit push signal defined in section 14

There is no fifth terminal outcome called "renderer recovers it locally."

---

## 16. Consumer expectations

Consumers of restartable replaceable-snapshot surfaces must assume:

- old-session live handles may be invalidated at any time by session replacement
- `authorityReady` (from the session state event defined in doc 2) is the rebind trigger; consumers do not poll
- fresh publications from the replacement authority are the recovery path
- `continuityGeneration` increment means reset derived local state
- `baselineEpoch` increment means rebase
- no direct cold-row access is required for normal reopen correctness
- session `ready` is not a guarantee that every restartable surface is publication-ready; deferred surfaces signal their
  own availability later

Consumers must not:

- self-reconstruct from checkpoint history
- treat old-session hot mappings as still live after invalidation
- assume subscription acceptance before surface publication readiness
- infer reopen completion from authority liveness alone
- poll for deferred surface availability; they must wait for the explicit push signal

---

## 17. Acceptance criteria

A compliant implementation must satisfy all of the following:

- old-session live handles are invalidated before new-session reopen publications are treated as live
- no restartable surface accepts subscription before it is able to publish a baseline-valid snapshot
- surface-unavailable surfaces reject subscriptions with `surfaceUnavailable`; deferred-not-ready surfaces reject with
  `surfaceDeferredNotReady`; these must not share the same typed discriminant
- same-domain restart preserves `baselineEpoch` and increments `continuityGeneration`
- baseline replacement increments `baselineEpoch` and resets `continuityGeneration`; it is an explicit authority
  decision, not inferred from storage
- `publicationSequence` resets to 0 on reopen in both branches
- reopened replaceable-snapshot publications are complete valid snapshots
- consumers do not need cold-row access to recover; authority republishes
- consumers rebind in response to `authorityReady` (from doc 2 session state events), not by polling
- deferred-readiness surfaces outside the required-at-startup set push an explicit publication-ready signal when they
  become available; consumers do not poll for it
- old-session hot bindings do not continue live reads after reopen
- no implementation silently reconstructs reopen state across multiple cold rows for replaceable-snapshot surfaces
- session `ready` transition requires all required-at-startup surfaces to have reached a terminal reopen outcome; it
  does not require all surfaces to be publication-ready
- deferred-not-ready is a valid terminal startup reopen outcome only for surfaces outside the required-at-startup set,
  and it remains distinct from `surfaceUnavailable`

---

## 18. Rejected alternatives

### Rejected: using the same typed failure for surface-unavailable and deferred-not-ready

Surface-unavailable is terminal or long-lived; a consumer may legitimately give up. Deferred-not-ready is
transient; a consumer should wait for the push signal. Sharing one failure discriminant prevents consumers from
responding correctly to either condition.

### Rejected: consumers polling for deferred surface readiness

Surfaces that complete reopen after session `ready` must push an explicit publication-ready signal. Consumers
must not poll subscription acceptance as a proxy for surface readiness.

### Rejected: renderer reloads directly from cold rows

Cold rows are authority recovery input, not renderer-owned source of truth.

### Rejected: host synthesizes rebasing publications

Host/session infrastructure manages invalidation and lifecycle. Authority owns publication assembly.

### Rejected: subscription acceptance before publication readiness

That creates a hanging baseline state and violates the readiness rule in section 11.

### Rejected: treating new authority epoch as sufficient proof of readiness

Session replacement and publication readiness are different state transitions.

### Rejected: reconstructing replaceable-snapshot reopen state across multiple checkpoint rows

Each cold row is already a complete snapshot for this family.

### Rejected: same reopen metadata rules for same-domain restart and baseline replacement

Those branches have different semantic consequences and must be encoded differently.

### Rejected: pretending no-checkpoint behavior can be decided ad hoc per implementation

Every restartable surface class must declare either fresh initialize or surface unavailable.

### Rejected: old-session hot reads continuing until new-session first publish

Old-session handles must fail closed once invalidated.

### Rejected: inferring baseline replacement from storage conditions

A version-incompatible cold candidate is a no-candidate outcome. Baseline replacement requires an explicit
authority/domain decision. The two must never be conflated.

### Rejected: emitting `authorityEpochReplaced` before the replacement session exists

`authorityEpochReplaced` carries `replacingAuthorityEpoch`, which cannot be known before the replacement session
exists. For crash/shutdown without a successor, use `authorityUnavailable` instead.

### Rejected: consumers polling for session readiness

Session readiness is a notification. Consumers rebind in response to receiving it.

### Rejected: session `ready` requiring all surfaces to be publication-ready

Session `ready` requires all required-at-startup surfaces to have reached a terminal reopen outcome.
Surface-unavailable is a valid terminal outcome and does not block session readiness.

### Rejected: silently queueing or dropping subscription requests for unavailable surfaces

Unavailable surfaces must reject subscriptions with explicit typed failures.
