# Hot Lane Consumer Runtime

Companion to:

- Exclave Projection Spine: Canonical Architecture Spec
- Exclave Hot Lane Codec and Layout Spec
- Hot SAB Lifecycle

Status: Draft for ratification as part of the hot-lane implementation bundle. This document, the Hot Lane Codec and
Layout Spec, and Hot SAB Lifecycle are jointly ratified or jointly not ratified. All three must reach sign-off together.

This document defines the consumer-side runtime contract for the hot lane. It does not redefine the hot ABI, planner,
manifest, or doctrine. It specifies how a hot consumer binding is opened, validated, read, invalidated, and retired.

If this document and the spine disagree, the spine is authoritative and this document is wrong.
If this document and the hot lane codec/layout spec disagree on binary layout, the codec/layout spec is authoritative
and this document is wrong.

---

## 1. Purpose

The hot lane gives a consumer a mapped latest-state region with seqlock protection and fixed layout.

This document defines the consumer-runtime rules that the spine and hot layout spec intentionally leave to the
binding contract:

- what public binding surface exists
- how a binding transitions through lifecycle states
- how the seqlock read path behaves on the consumer side
- how writer-active and torn-read conditions are handled differently
- how bounded fallback to last-good works
- how stale mappings are invalidated
- how authority/session invalidation hooks into hot bindings
- what polling cadence and read discipline are legal on a UI thread

---

## 2. Ownership and non-ownership

### 2.1 What the hot consumer runtime owns

The hot consumer runtime owns:

- bind-time validation after a mapping is opened
- generated read access for hot-admissible fields
- last-good snapshot retention
- bounded read retry behavior
- stale-binding invalidation behavior
- renderer-facing binding API shape

### 2.2 What the hot consumer runtime does not own

The hot consumer runtime does not own:

- projection contract semantics
- field layout planning
- authority publication assembly
- continuity semantics beyond what is already carried in publication metadata
- session issuance
- resource-handle lifetime
- renderer-local interaction policy

Those concerns belong elsewhere.

---

## 3. Binding state model

A hot binding is a revocable consumer handle over one mapped hot projection instance.

```ts
type HotBindingState =
    | "unbound"
    | "binding"
    | "ready"
    | "failed"
    | "stale"
    | "closed"
```

### 3.1 `unbound`

No mapping has been opened.

### 3.2 `binding`

A mapping exists, but bind-time validation is not complete.

### 3.3 `ready`

Bind-time validation passed and at least one legal read may be attempted.

### 3.4 `failed`

Bind-time validation failed. The mapping never became a valid live projection surface. This is a terminal state for
bind-validation failure. A `failed` binding has never been `ready` and has never published valid projection data.

### 3.5 `stale`

The mapping must no longer be used for field reads. A stale binding is revocable and terminal for read purposes.
A stale binding was either `ready` or transitioned through a state where a valid mapping existed before revocation.
A stale binding may still expose identity/debug information for diagnostics.

### 3.6 `closed`

The consumer closed the binding and no further reads are legal.

---

## 4. Public binding surface

The public generated binding surface is lane-aware and read-only.

A hot binding must expose a shape equivalent to:

```ts
interface HotProjectionBinding<TProjection> {
    readonly contractKey: string
    readonly projectionInstanceKey: string
    readonly state: HotBindingState

    bind(): HotBindResult

    tryReadLatest(options?: HotReadOptions): TProjection | null

    readLastGood(): TProjection | null

    close(): void
}
```

Invalidation is not part of the normal application-facing binding surface.
It belongs to the adapter/runtime layer that manages session and lifecycle events.
See section 11 for the runtime control interface.

### 4.1 `bind()`

`bind()` performs bind-time validation and returns a result indicating success or failure.

```ts
type HotBindResult =
    | { ok: true; state: "ready" }
    | {
    ok: false
    state: HotBindingState
    reason:
        | "bindValidationFailed"
        | "alreadyFailed"
        | "alreadyClosed"
        | "alreadyStale"
        | "alreadyBinding"
        | "alreadyReady"
}
```

The `state` field in a failure result reports the **actual current state of the binding at the time of the call**. An
illegal `bind()` call must not cause a state transition. The binding stays in whatever state it was already in.

`bind()` is only legal from `unbound`. Called from any other state, it returns a typed failure immediately without
attempting validation and without changing state:

- `unbound` → performs validation; on success: transitions to `ready`, returns `{ ok: true, state: "ready" }`; on
  failure: transitions to `failed`, returns `{ ok: false, state: "failed", reason: "bindValidationFailed" }`
- `binding` → no transition; returns `{ ok: false, state: "binding", reason: "alreadyBinding" }`
- `ready` → no transition; returns `{ ok: false, state: "ready", reason: "alreadyReady" }`
- `failed` → no transition; returns `{ ok: false, state: "failed", reason: "alreadyFailed" }`
- `stale` → no transition; returns `{ ok: false, state: "stale", reason: "alreadyStale" }`
- `closed` → no transition; returns `{ ok: false, state: "closed", reason: "alreadyClosed" }`

`bindValidationFailed` is a bind-outcome reason, not an invalidation reason. A binding that fails validation transitions to
`failed`, a terminal state indicating the mapping never became a valid live projection surface. The `stale` state is
reserved exclusively for lifecycle revocation of a previously valid or ready binding — for example, authority session
replacement, hot handle invalidation, or host-declared mapping revocation. A `failed` binding has never been `ready`.

`bind()` does not promise that a semantically good publication has already been observed.
It only establishes that the mapped region is structurally legal to read from under the hot-lane ABI.

### 4.2 `tryReadLatest(...)`

Attempts one bounded read pass against the mapped region.
Returns:

* the newest successfully validated snapshot from this call, or
* the retained last-good snapshot if this call cannot produce one, or
* `null` if no valid snapshot has ever been read

`tryReadLatest(...)` must never expose a torn snapshot.

After `close()`, after the binding becomes `stale`, or after the binding becomes `failed`, `tryReadLatest(...)` must
return `readLastGood()` or `null`. A `failed` binding has never been `ready` and has no last-good snapshot, so it always
returns `null`. It must never attempt a live read against the mapped region in any of these states.

### 4.3 `readLastGood()`

Returns the currently retained last-good snapshot or `null`.

### 4.4 `close()`

Releases the binding from consumer use.
A closed binding must not be rebound.
After `close()`, `tryReadLatest(...)` returns `readLastGood()` or `null`. No live reads are attempted.

---

## 5. Hot read options

The public read surface must be bounded.
It must not expose an unbounded `while (true)` default on the UI thread.

A generated binding should support options equivalent to:

```ts
interface HotReadOptions {
    readonly maxWriterActivePolls?: number
    readonly maxTornReads?: number
}
```

Defaults must be small and UI-safe.
The specific values are non-normative guidance for the renderer profile.
They are not part of wire compatibility or semantic correctness.

Generated bindings may define a renderer profile with recommended defaults.
Those defaults must not be treated as part of the seqlock protocol specification.

---

## 6. Two distinct retry conditions

The consumer runtime must distinguish two different conditions:

### 6.1 Writer-active-at-start

The initial sequence counter read is odd.
This means a writer is currently mid-publication.

This condition:

* does not consume torn-read retry budget
* may consume writer-active poll budget
* must not produce a snapshot
* may lead to last-good fallback if bounded polling is exhausted

### 6.2 Torn-read-after-even-start

The initial sequence counter read is even, field reads occur, and the final sequence counter read differs from the
initial read.

This means a write completed during the read window.

This condition:

* does consume torn-read retry budget
* must discard the candidate snapshot
* may retry from the top
* falls back to last-good once torn-read budget is exhausted

These two conditions are not interchangeable and must not share one undifferentiated retry counter.

---

## 7. Normative consumer read algorithm

The sequence counter must be read with atomic acquire semantics.
In TypeScript bindings that means `Atomics.load()` on a `BigUint64Array` view over the sequence counter location.

Plain non-atomic DataView u64 reads are not legal for seqlock counter reads.

`maxWriterActivePolls = 0` is legal and means: if the counter is odd on first read, immediately return last-good without
polling.
`maxTornReads = 0` is legal and means: if a torn read occurs, immediately return last-good without retrying.
Both values of 0 are degenerate-but-correct configurations, not error conditions.

Budget exhaustion must return `readLastGood()` or `null`. It must never throw.

A consumer read pass is defined as follows. Let `writerActivePolls = 0` and `tornReads = 0` at the start of each call to
`tryReadLatest(...)`.

```
function tryReadLatest(options):
  if binding.state != "ready":
    return readLastGood()

  loop:
    seq1 = Atomics.load(sequenceView, counterOffset)

    if seq1 is odd:                          // writer active
      writerActivePolls += 1
      if writerActivePolls > maxWriterActivePolls:
        return readLastGood()
      continue loop                          // retry without consuming torn budget

    // seq1 is even: read fields
    snapshot = readAllFields()               // non-atomic, via generated field readers

    seq2 = Atomics.load(sequenceView, counterOffset)

    if seq2 == seq1:                         // clean read
      binding.lastGood = snapshot
      return snapshot

    // torn read: a write completed during the field-read window
    tornReads += 1
    if tornReads > maxTornReads:
      return readLastGood()
    continue loop                            // retry; does not consume writerActive budget
```

The two budgets are independent. A torn-read retry does not consume writer-active budget. A writer-active poll does not
consume torn-read budget. An implementation that shares one counter between these two conditions is wrong.

---

## 8. Required generated implementation shape

Generated TS bindings must follow these rules:

### 8.1 Sequence view

The binding must create a `BigUint64Array` over the sequence-counter location and use `Atomics.load()` for sequence
reads.

### 8.2 Field reads

Field payload reads may use `DataView` and typed-array views according to the generated layout manifest.

### 8.3 Last-good retention

The binding must retain the most recent successfully validated snapshot for fallback use.

### 8.4 No infinite public retry surface

The generated public binding must not default to an infinite loop.
Bounded read attempts are the public contract.

### 8.5 No exposed torn candidates

A candidate snapshot read between two unequal sequence-counter values must be discarded and never surfaced.

---

## 9. Bind-time validation

`bind()` must perform the bind-time validation sequence already required by the hot lane spec.

At minimum, bind-time validation must verify:

* region magic
* hot ABI version
* contract key hash
* instance key hash
* semantic version
* hot layout version
* field count
* mutable region byte length
* reserved bytes in Block A
* manifest-derived field layout agreement

A binding must not transition to `ready` until bind-time validation succeeds.

Bind-time validation is structural.
It does not imply that any particular publication has yet been successfully read.

---

## 10. Publication metadata read expectations

A validated hot snapshot must expose the publication metadata carried in the hot lane:

* `baselineEpoch`
* `continuityGeneration`
* `publicationSequence`

These fields are read from the hot header region as part of the validated snapshot.

Consumers must use these values for continuity decisions and interaction-shadow clearing logic.
They must not invent equivalent metadata locally.

---

## 11. Invalidation and stale mappings

A hot binding is revocable.

Invalidation is not part of the normal application-facing API surface.
It is part of a separate runtime control interface:

```ts
interface HotProjectionBindingRuntimeControl {
    invalidate(reason: HotBindingInvalidationReason): void
}
```

This interface is owned by the host/session/lifecycle infrastructure layer, not by application consumer code.

The following conditions must cause the runtime control layer to call `invalidate(...)` and transition the binding to
`stale`:

* authority session invalidation for the binding's authority epoch
* hot handle invalidation pushed from the session/control layer
* explicit host invalidation caused by authority restart
* replacement mapping superseding the current binding
* any host-level signal declaring the mapped region stale or replaced

Invalidation transitions a binding to `stale`, not to `failed`. The `failed` state is reserved for bind-validation
failure, which is owned by `HotBindResult`. Invalidation is a lifecycle event that revokes a binding that was at some
point valid or ready. A `failed` binding has never been valid.

A stale binding must not continue attempting live reads from the old mapping.

The public fallback behavior for a stale binding is:

* return `lastGood` if present
* otherwise return `null`

A stale binding must never silently keep reading from dead memory as though the region were still current.

---

## 12. Invalidation reason type

Invalidation reason kinds must align with the session invalidation event families defined in the control-plane session
rules document. No adapter author should need to invent new nouns.

```ts
type HotBindingInvalidationReason =
    | { kind: "authorityEpochReplaced"; replacedAuthorityEpoch: bigint; replacingAuthorityEpoch: bigint }
    | { kind: "authorityUnavailable"; replacedAuthorityEpoch: bigint; state: "stopping" | "stopped" }
    | { kind: "hotHandleInvalidated"; authorityEpoch: bigint; detail?: string }
```

`authorityEpochReplaced`, `authorityUnavailable`, and `hotHandleInvalidated` map directly to the
`SessionInvalidationEvent` kinds of the same name. The runtime control adapter translates those session events into
these invalidation reasons without inventing intermediate vocabulary.

Host-declared stale mappings arrive as `hotHandleInvalidated` with the nearest legal public reason already resolved by
the session/lifecycle layer, per Hot SAB Lifecycle section 11.2. The binding runtime receives the translated
invalidation and does not need a separate `hostDeclaredStale` member. The owner split is: session/control events
(`authorityEpochReplaced`, `authorityUnavailable`, `hotHandleInvalidated`) carry the lifecycle reason; the binding
runtime consumes it without reinventing host-specific classification.

`bindValidationFailed` is not an invalidation reason. Bind validation failure is a binding-local outcome surfaced by
`HotBindResult`. It is not a session, host, or lifecycle invalidation event and must not be placed in the invalidation
reason family. The clean owner split is: `HotBindResult` owns bind validation failure; `HotBindingInvalidationReason`
owns session/lifecycle/host revocation.

`authorityEpoch` fields in invalidation reasons are opaque session identifiers (see control-plane session rules). They
may be represented as `bigint` in TypeScript for transport and validation convenience, but consumers must not use numeric
ordering comparisons on `authorityEpoch` values. Equality and inequality are the only legal consumer operations. The
field names `replacedAuthorityEpoch` and `replacingAuthorityEpoch` identify which epoch was superseded and which
supersedes it; they must not be interpreted as implying a numeric ordering relationship between the two values.

`closed` is not an invalidation reason. `close()` is a consumer action on the binding surface. Invalidation is a
runtime/session/lifecycle event with a different owner. These must not be collapsed.

---

## 13. Hook points for session and lifecycle docs

This document is intentionally coupled to:

* control-plane session rules
* hot SAB lifecycle

Those documents define:

* authority epoch issuance
* mapping/open validity
* replacement and revocation rules
* stale-handle invalidation sources

Hot consumer runtime is not complete unless mapping death is part of the contract.

---

## 14. Renderer polling and scheduling rule

Renderer-facing hot reads must respect the JS event loop.

Rules:

* no infinite default polling loop on the UI thread
* use one bounded read pass per visual tick or equivalent scheduler slot
* on bounded failure, reuse last-good and skip this visual tick's fresh update
* do not schedule nested retry storms from inside the binding

The hot lane is a latest-state consumer surface, not a scheduler-control surface for presentation code.

---

## 15. Relationship to interaction shadows

Interaction shadows are renderer-local ephemeral overlays.
They do not mutate hot projection state.

A hot binding must expose authoritative `publicationSequence` so renderer-local shadows can clear on later publication
arrival.

This document does not define the shadow model itself, but the binding must provide the metadata that model depends on.

---

## 16. Conformance requirements

Cross-language conformance is mandatory.

At minimum, conformance tests must prove:

* Rust authority and TS consumer agree on sequence-counter offset
* Rust authority and TS consumer agree on all field offsets and widths
* TS consumer rejects invalid bind headers
* TS consumer uses atomic sequence-counter reads
* TS consumer never surfaces torn snapshots
* TS consumer retains and returns last-good under bounded failure
* stale invalidation stops further live reads from the old mapping

These conformance tests belong to the shared conformance harness, not ad hoc package-local convention.

---

## 17. Rejected alternatives

### Rejected: plain non-atomic DataView u64 reads for sequence reads

Sequence reads must be atomic-acquire reads.

### Rejected: infinite public retry loop

The renderer-facing API must be bounded.

### Rejected: continuing live reads after stale invalidation

Revoked mappings must fail closed.

### Rejected: exposing torn snapshots as "best effort"

Best effort may mean last-good fallback, never torn snapshot exposure.

### Rejected: `invalidate(...)` as a normal application-facing method

Invalidation belongs to the host/session/lifecycle infrastructure layer. Exposing it on the normal public binding
surface makes it look like routine consumer API and invites misuse.

### Rejected: `bind()` legal from any state

`bind()` is only legal from `unbound`. Every other state returns a typed failure immediately without attempting
validation.

### Rejected: illegal `bind()` calls reporting `state: "stale"` regardless of actual state

An illegal `bind()` call must not cause a state transition. The failure result must report the actual current
state of the binding. Reporting `"stale"` from a `binding` or `ready` state is a lie: it poisons a live binding's state
in the caller's view without any stale condition having actually occurred.

### Rejected: sharing one retry budget between writer-active and torn-read conditions

These conditions have different meaning and must be tracked with independent counters.

### Rejected: `closed` as a member of `HotBindingInvalidationReason`

`close()` is a consumer action. Invalidation is a runtime event with a different owner. Conflating them blurs
ownership.

### Rejected: `bindValidationFailed` as a member of `HotBindingInvalidationReason`

Bind validation failure is a binding-local outcome owned by `HotBindResult`. It is not a session invalidation,
host revocation, or lifecycle event. Placing it in the invalidation reason family conflates two distinct ownership paths
and misleads adapter authors about which surface reports bind failure.

### Rejected: throwing on budget exhaustion

Budget exhaustion must return `readLastGood()` or `null`. The renderer-facing read surface is not an exception
surface for normal bounded-retry outcomes.
