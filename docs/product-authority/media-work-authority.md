# Media Work Authority

Status: Product-authority companion. This document is not Seqlok substrate canon. It shows how a product authority can use Seqlok control, publication, resource, and session contracts.

This document defines the product-level authority contract for media work: waveform LOD generation, stem waveform
generation, stem analysis generation, artwork materialization, analysis output, and other produced media resources.

It does not define worker-pool topology, Rayon/Tokio scheduling internals, process placement, GPU execution, media
codecs, cache eviction policy, or concrete resource byte formats. Those concerns sit below this authority contract or in
resource-specific product contracts.

The center is media work ownership, not workers.

---

## 1. Purpose

A realtime media application needs to produce, track, expose, invalidate, and reopen media-derived data without blocking
consumers or hiding work inside resource opens.

This document defines:

- media work requests
- media work tickets
- work attempt state
- media input identity
- materialization targets
- materialization availability
- produced resource versions
- produced resource descriptors
- media-specific resource-open behavior
- invalidation and supersession behavior
- the boundary between control, publication, resource, and hot runtime state

Consumers must never depend on an unbounded wait, hidden worker state, or blocking resource open to discover progress.

Concrete waveform, artwork, stem, and analysis descriptor examples in this document are illustrative first-profile
shapes unless a later resource-specific product contract promotes them to canonical product contracts.

---

## 2. Requirements

### 2.1 Media work ownership is the contract

Workers are implementation topology. The product contract is media work ownership, work state, materialization
availability, and produced resources.

The media authority may use threads, worker pools, processes, GPU jobs, local cache reads, or external services.
Consumers observe only declared boundary state.

### 2.2 WorkTicket is not ResourceHandle

A `WorkTicket` represents accepted or tracked production work.

A `ResourceHandle` represents already-opened access to stable produced bytes.

They are different concepts and must not be collapsed.

### 2.3 Resource open is not work scheduling

A resource open is access to existing stable bytes.

If the requested materialization does not exist yet, open must fail with a typed availability result such as
`productionPending`, `notAvailable`, or `resourceUnavailable`.

It must not schedule hidden work and must not block until generation finishes.

### 2.4 Accepted work must become observable

Every accepted media work item must become visible through publication state.

A successful work request must not disappear into hidden worker state.

### 2.5 Work liveness is scoped to an authority epoch

Within a live authority epoch, every accepted media work item must remain observable until it reaches a terminal or
superseded state.

If the authority epoch ends before the work item terminates, the work ticket is invalidated by session replacement. A
replacement authority may recover, restart, discard, or supersede the work according to product policy, but it must not
silently treat the old ticket as live.

Authority epoch replacement is a session-layer invalidation fact, not a normal work-attempt state emitted by the dead
authority.

### 2.6 Media work is keyed to stable input identity

Media work is keyed to a stable media input version, not merely to a logical track id.

A waveform, stem, artwork, or analysis result must identify which media input revision produced it. Late completion from
an old input revision must not publish as current output for a newer media input revision.

### 2.7 Materialization policy is part of the work identity

A materialization target must identify the output policy/profile it is asking for.

Changes to waveform algorithms, stem models, analysis profiles, byte formats, or target policy that can change the
produced bytes or descriptor meaning must produce a distinct materialization target identity.

### 2.8 Produced resources are versioned and stable

A completed media work item produces or references a stable `resourceVersion`.

When bytes, bounds, descriptor meaning, or mapping identity change, a new `resourceVersion` is produced and old resource
handles are invalidated by the resource-plane protocol.

A resource handle must not silently drift to a newer produced payload.

### 2.9 Duplicate requests must not create unbounded duplicate work

Requests for the same `MediaWorkKey` must be idempotent within an authority epoch unless the request explicitly asks to
replace or reprioritize existing work.

The default policy is `joinExisting`.

A duplicate request must return `alreadyQueued`, `alreadyRunning`, or `alreadyAvailable`. It must not create unbounded
duplicate work for the same key.

### 2.10 Media work must not block audio-critical paths

Media work must not execute on an audio callback path, must not hold locks required by audio-critical publication, and
must not make hot publication progress depend on background materialization.

Background analysis, waveform generation, artwork extraction, and stem production must not block live playback-critical
state.

---

## 3. Boundary-plane split

Media work uses the Seqlok planes as follows:

```text
control:
  requestWaveformLodGeneration
  requestStemWaveformGeneration
  requestStemAnalysisGeneration
  requestArtworkMaterialization
  cancelMediaWork
  openWaveformLodResource
  openStemWaveformResource
  openStemAnalysisResource
  openArtworkResource

warm publication:
  mediaWork.attemptStatus
  materialization.availability
  waveform.availability
  stem.availability
  artwork.availability

resource:
  waveform.lod
  stem.waveform
  stem.analysis
  artwork.image

hot:
  deck.runtime cursor
  deck.runtime phase
  deck.runtime active stem gains
  mixer.meters
```

The planes must not be collapsed:

- scheduling work is control
- observing work attempts and availability is publication
- reading produced bytes is resource-plane access
- live playback cursor and engine-critical state are hot publications

---

## 4. Core distinction: WorkTicket is not ResourceHandle

```ts
type WorkTicketId = string;
type ResourceHandleId = string;
type ResourceVersion = bigint;
type AuthorityEpoch = bigint;
```

A media work request may return:

- a new `WorkTicket`
- an existing `WorkTicket`
- an already available `ProducedResource`
- a typed rejection or backpressure result

A resource open may return:

- a Resource Plane v1 open reply only when a stable `resourceVersion` is available
- a typed not-available or production-pending result when bytes are not ready
- a typed backpressure or session/resource failure result

`WorkTicket` tracks work. `ResourceHandle` gives byte access. One must never pretend to be the other.

---

## 5. Media identity model

### 5.1 Media subject

A `MediaSubject` identifies the stable input version for media work.

```ts
type TrackId = string;
type AttachmentId = string;
type SourceFileId = string;
type MediaInputRevision = bigint;

// MediaInputRevision is opaque and equality-comparable unless a product contract defines stronger ordering.
type MediaSubject =
  | {
      readonly kind: "track";
      readonly trackId: TrackId;
      readonly mediaInputRevision: MediaInputRevision;
    }
  | {
      readonly kind: "attachment";
      readonly attachmentId: AttachmentId;
      readonly mediaInputRevision: MediaInputRevision;
    }
  | {
      readonly kind: "sourceFile";
      readonly sourceFileId: SourceFileId;
      readonly mediaInputRevision: MediaInputRevision;
    };
```

`mediaInputRevision` identifies the media input bytes/provenance used for production. Track metadata edits that do not
alter the media input must not automatically create a new media input revision.

The exact subject families may evolve, but the rule does not: media work must be tied to stable input identity and
version.

### 5.2 Materialization profile identity

A materialization profile identifies the output policy used to produce bytes.

```ts
type MaterializationProfileKey = string;
type MaterializationProfileVersion = bigint;
```

`profileKey` names the profile family, such as a waveform peak format, stem model, analysis policy, or artwork sizing
policy.

`profileVersion` identifies the profile version. It is opaque and equality-comparable unless a product contract defines
stronger ordering.

### 5.3 Materialization target

A `MaterializationTarget` describes the produced form. Its `kind` owns the work kind.

```ts
type StemPartKey = string;
type WaveformLod = "overview" | "medium" | "detail";

type MaterializationTarget =
  | {
      readonly kind: "waveformLod";
      readonly lod: WaveformLod;
      readonly channelMode: "mono" | "stereo" | "stacked";
      readonly profileKey: MaterializationProfileKey;
      readonly profileVersion: MaterializationProfileVersion;
    }
  | {
      readonly kind: "stemWaveform";
      readonly stem: StemPartKey;
      readonly lod: "overview" | "detail";
      readonly profileKey: MaterializationProfileKey;
      readonly profileVersion: MaterializationProfileVersion;
    }
  | {
      readonly kind: "stemAnalysis";
      readonly stem: StemPartKey;
      readonly analysisKind: "energy" | "peaks" | "spectral";
      readonly profileKey: MaterializationProfileKey;
      readonly profileVersion: MaterializationProfileVersion;
    }
  | {
      readonly kind: "artworkImage";
      readonly size: "thumbnail" | "preview" | "full";
      readonly profileKey: MaterializationProfileKey;
      readonly profileVersion: MaterializationProfileVersion;
    }
  | {
      readonly kind: "trackAnalysis";
      readonly analysisKind: "bpm" | "beatgrid" | "key" | "structure";
      readonly profileKey: MaterializationProfileKey;
      readonly profileVersion: MaterializationProfileVersion;
    };
```

This target identifies what work produces, not how workers execute it.

The `StemPartKey` type is profile-defined. Four-stem names such as `drums`, `bass`, `melody`, and `vocals` are
first-profile examples, not the universal stem identity model.

### 5.4 Media work key

A `MediaWorkKey` combines a stable media subject with one materialization target.

```ts
type MediaWorkKey = {
  readonly subject: MediaSubject;
  readonly target: MaterializationTarget;
};
```

There is no separate `MediaWorkKind` field on `MediaWorkKey`. `target.kind` is the single owner of the work kind.

---

## 6. Work attempts

### 6.1 Work ticket

A `WorkTicket` is an authority-issued identity for one tracked attempt to produce a `MediaWorkKey`.

```ts
type WorkGeneration = bigint;

type WorkTicket = {
  readonly ticketId: WorkTicketId;
  readonly authorityEpoch: AuthorityEpoch;
  readonly workKey: MediaWorkKey;
  readonly workGeneration: WorkGeneration;
};
```

`workGeneration` is authority-issued and monotonically increasing per `(authorityEpoch, MediaWorkKey)`.

Consumers may compare `workGeneration` only within the same `authorityEpoch` and `MediaWorkKey`.

A greater `workGeneration` supersedes a lower generation for that same key. No ordering meaning exists across different
keys or authority epochs.

A `WorkTicket` is not a resource handle and does not provide byte access.

### 6.2 Work request policy

```ts
type MediaWorkRequestPolicy =
  | "joinExisting"
  | "raisePriority"
  | "replaceExisting";
```

Default: `joinExisting`.

- `joinExisting` returns an existing queued/running/available result when possible.
- `raisePriority` may raise priority of an existing attempt if the authority permits it.
- `replaceExisting` creates a newer generation and supersedes older active attempts for the same key.

### 6.3 Work attempt state

Work attempt state describes a ticket, not the target's current usable bytes.

```ts
type MediaWorkAttemptState =
  | {
      readonly kind: "queued";
      readonly ticketId: WorkTicketId;
      readonly priority: MediaWorkPriority;
    }
  | {
      readonly kind: "running";
      readonly ticketId: WorkTicketId;
      readonly progress: MediaWorkProgress;
    }
  | {
      readonly kind: "failed";
      readonly ticketId: WorkTicketId;
      readonly reason: MediaWorkFailure;
    }
  | {
      readonly kind: "cancelled";
      readonly ticketId: WorkTicketId;
    }
  | {
      readonly kind: "superseded";
      readonly ticketId: WorkTicketId;
      readonly byResourceVersion?: ResourceVersion;
    };
```

```ts
type MediaWorkPriority = "interactive" | "playbackAdjacent" | "background";

type MediaWorkProgress = {
  readonly completedUnits: number;
  readonly totalUnits?: number;
  readonly phase?: string;
};
```

Attempt-state publications should be keyed by `ticketId` or by `(MediaWorkKey, workGeneration)`.

They must not pretend to be the materialization availability state.

Authority epoch replacement invalidates live work tickets through the session layer. The replacement authority may later
publish recovered, restarted, failed, or superseded work state as new work under its own epoch.

---

## 7. Materialization availability

Materialization availability describes whether a target currently has usable produced bytes.

It is distinct from any one work attempt.

```ts
type MaterializationAvailability<TDescriptor> =
  | { readonly kind: "unknown" }
  | { readonly kind: "notRequested" }
  | { readonly kind: "notAvailable" }
  | {
      readonly kind: "productionPending";
      readonly ticketId: WorkTicketId;
    }
  | {
      readonly kind: "available";
      readonly resource: ProducedResource<TDescriptor>;
    }
  | {
      readonly kind: "failed";
      readonly reason: MediaWorkFailure;
    };
```

A target can be available even if the latest work ticket failed or was cancelled. A target can be unavailable even if a
previous ticket existed.

Supersession is represented by work-attempt state, materialization availability changes, and resource handle
invalidation. It is not a steady-state availability kind.

### 7.1 Produced resource

A produced resource identifies stable resource-plane bytes and describes their product meaning.

```ts
type ProducedResource<TDescriptor> = {
  readonly resourceKind: string;
  readonly resourceKey: string;
  readonly resourceVersion: ResourceVersion;
  readonly descriptor: TDescriptor;
};
```

The resource authority derives `resourceKey`. Callers must not smuggle `resourceKey` through untyped open envelopes.

Concrete media resource contracts must supply a descriptor type. A produced resource without a typed descriptor is not
implementation-complete.

Produced resource descriptors are metadata only. They must not carry produced bytes or large body fragments.

### 7.2 Example descriptors

```ts
type WaveformLodDescriptor = {
  readonly format: "f32MinMax" | "i16MinMax";
  readonly lod: WaveformLod;
  readonly channelMode: "mono" | "stereo" | "stacked";
  readonly framesPerPoint: number;
  readonly pointCount: number;
  readonly byteLength: number;
};

type StemWaveformDescriptor = WaveformLodDescriptor & {
  readonly stem: StemPartKey;
};

type ArtworkDescriptor = {
  readonly mimeType: "image/jpeg" | "image/png" | "image/webp";
  readonly width?: number;
  readonly height?: number;
  readonly byteLength: number;
};
```

These examples are illustrative. Concrete descriptors belong to resource-specific product contracts.

---

## 8. Control operations

Media work request operations are stateful control-plane commands. They are epoch-bound and must carry `authorityEpoch`.

### 8.1 Request waveform LOD generation

```ts
type RequestWaveformLodGeneration = {
  readonly authorityEpoch: AuthorityEpoch;
  readonly subject: MediaSubject;
  readonly lod: WaveformLod;
  readonly channelMode: "mono" | "stereo" | "stacked";
  readonly profileKey: MaterializationProfileKey;
  readonly profileVersion: MaterializationProfileVersion;
  readonly priority: MediaWorkPriority;
  readonly policy?: MediaWorkRequestPolicy;
};
```

### 8.2 Request stem waveform generation

```ts
type RequestStemWaveformGeneration = {
  readonly authorityEpoch: AuthorityEpoch;
  readonly subject: MediaSubject;
  readonly stem: StemPartKey;
  readonly lod: "overview" | "detail";
  readonly profileKey: MaterializationProfileKey;
  readonly profileVersion: MaterializationProfileVersion;
  readonly priority: MediaWorkPriority;
  readonly policy?: MediaWorkRequestPolicy;
};
```

### 8.3 Request stem analysis generation

```ts
type RequestStemAnalysisGeneration = {
  readonly authorityEpoch: AuthorityEpoch;
  readonly subject: MediaSubject;
  readonly stem: StemPartKey;
  readonly analysisKind: "energy" | "peaks" | "spectral";
  readonly profileKey: MaterializationProfileKey;
  readonly profileVersion: MaterializationProfileVersion;
  readonly priority: MediaWorkPriority;
  readonly policy?: MediaWorkRequestPolicy;
};
```

### 8.4 Request artwork materialization

```ts
type RequestArtworkMaterialization = {
  readonly authorityEpoch: AuthorityEpoch;
  readonly subject: MediaSubject;
  readonly size: "thumbnail" | "preview" | "full";
  readonly profileKey: MaterializationProfileKey;
  readonly profileVersion: MaterializationProfileVersion;
  readonly priority: MediaWorkPriority;
  readonly policy?: MediaWorkRequestPolicy;
};
```

### 8.5 Request result

```ts
type MediaWorkRequestResult<TDescriptor> =
  | {
      readonly ok: true;
      readonly outcome: MediaWorkRequestOutcome<TDescriptor>;
    }
  | {
      readonly ok: false;
      readonly failure: MediaWorkRequestFailure | MediaWorkBackpressure;
    };
```

```ts
type MediaWorkRequestOutcome<TDescriptor> =
  | { readonly kind: "accepted"; readonly ticket: WorkTicket }
  | { readonly kind: "alreadyQueued"; readonly ticket: WorkTicket }
  | { readonly kind: "alreadyRunning"; readonly ticket: WorkTicket }
  | {
      readonly kind: "alreadyAvailable";
      readonly resource: ProducedResource<TDescriptor>;
    };
```

### 8.6 Cancel media work

```ts
type CancelMediaWork = {
  readonly ticketId: WorkTicketId;
  readonly authorityEpoch: AuthorityEpoch;
};
```

Cancellation is best-effort unless the media authority declares stronger behavior for a work kind.

When cancellation is accepted within a live authority epoch, it must publish a terminal or superseded attempt state.

---

## 9. Resource open operations

Resource open operations provide resource-plane access to existing stable produced bytes.

They do not schedule work and do not wait for work completion.

Media resource open uses the Resource Plane v1 open protocol. This document adds media-specific availability failures;
it does not replace Resource Plane handle, descriptor, capability, backpressure, or failure semantics.

### 9.1 Resource open result

```ts
// From Resource Plane v1
type ResourcePlaneOpenReply<TDescriptor> = OpenResourceReply<TDescriptor>;
type ResourcePlaneFailure = ResourceFailure;
type ResourcePlaneBackpressure = ResourceBackpressure;

type MediaResourceOpenResult<TDescriptor> =
  | {
      readonly ok: true;
      readonly resource: ProducedResource<TDescriptor>;
      readonly open: ResourcePlaneOpenReply<TDescriptor>;
    }
  | {
      readonly ok: false;
      readonly failure:
        | MediaAvailabilityOpenFailure<TDescriptor>
        | ResourcePlaneFailure
        | ResourcePlaneBackpressure;
    };
```

```ts
type MediaAvailabilityOpenFailure<TDescriptor> =
  | { readonly kind: "invalidTarget"; readonly detail: string }
  | { readonly kind: "sourceUnavailable"; readonly subject: MediaSubject }
  | { readonly kind: "notAvailable"; readonly key: MediaWorkKey }
  | {
      readonly kind: "productionPending";
      readonly key: MediaWorkKey;
      readonly ticketId: WorkTicketId;
    }
  | {
      readonly kind: "resourceSuperseded";
      readonly current: ProducedResource<TDescriptor>;
    }
  | { readonly kind: "resourceUnavailable"; readonly key: MediaWorkKey };
```

Opening produced bytes has different failure semantics from scheduling work. It must not reuse vague work-request
failures.

### 9.2 Open waveform LOD resource

```ts
type OpenWaveformLodResource = {
  readonly subject: MediaSubject;
  readonly lod: WaveformLod;
  readonly channelMode: "mono" | "stereo" | "stacked";
  readonly profileKey: MaterializationProfileKey;
  readonly profileVersion: MaterializationProfileVersion;
};
```

Open succeeds only if a stable waveform LOD resource is available for the requested `MediaSubject` revision and target.

If production is pending, open fails with `productionPending`.

### 9.3 Open stem waveform resource

```ts
type OpenStemWaveformResource = {
  readonly subject: MediaSubject;
  readonly stem: StemPartKey;
  readonly lod: "overview" | "detail";
  readonly profileKey: MaterializationProfileKey;
  readonly profileVersion: MaterializationProfileVersion;
};
```

Open succeeds only if the requested stem waveform resource exists as a stable `resourceVersion`.

### 9.4 Open stem analysis resource

```ts
type OpenStemAnalysisResource = {
  readonly subject: MediaSubject;
  readonly stem: StemPartKey;
  readonly analysisKind: "energy" | "peaks" | "spectral";
  readonly profileKey: MaterializationProfileKey;
  readonly profileVersion: MaterializationProfileVersion;
};
```

Open succeeds only if the requested stem analysis resource exists as a stable `resourceVersion`.

### 9.5 Open artwork resource

```ts
type OpenArtworkResource = {
  readonly subject: MediaSubject;
  readonly size: "thumbnail" | "preview" | "full";
  readonly profileKey: MaterializationProfileKey;
  readonly profileVersion: MaterializationProfileVersion;
};
```

Artwork may be produced, extracted, cached, or loaded from metadata. The open operation does not expose that execution
path.

---

## 10. Warm publication surfaces

Media work state and materialization availability are warm publication state.

Example publication surfaces:

```text
mediaWork.attemptStatus(ticketId)
materialization.availability(mediaWorkKey)
waveform.availability(subject, lod, channelMode, profileKey, profileVersion)
stem.availability(subject, stem, lod, profileKey, profileVersion)
artwork.availability(subject, size, profileKey, profileVersion)
```

Consumers observe availability instead of polling resource opens.

---

## 11. Supersession and invalidation

Media work can be superseded when a newer request, newer media input revision, newer materialization profile, or newer
materialization target replaces the intended output.

When a work attempt is superseded:

- the attempt state must publish `superseded`
- materialization availability must publish the current state
- old resource handles must be invalidated through Resource Plane v1 if their `resourceVersion` is no longer current
- open requests should return handles for the current stable resource version

A resource handle must not silently retarget to a newer produced resource version.

---

## 12. Backpressure and boundedness

Media work queues must be bounded.

```ts
type MediaWorkBackpressure = {
  readonly kind: "mediaWorkBackpressure";
  readonly scope: "subject" | "workKind" | "consumer" | "authority";
  readonly retryAfterMs?: number;
};
```

Rules:

- accepted work must become observable
- rejected work must return typed failure or backpressure
- queue limits must be finite
- duplicate requests must not create unbounded duplicate work
- background work must not block live playback-critical work
- resource open must not block on work completion
- work progress must not be inferred from hidden worker state

---

## 13. Failure shapes

```ts
type MediaWorkRequestFailure =
  | { readonly kind: "authorityUnavailable" }
  | {
      readonly kind: "authorityNotReady";
      readonly state: "starting" | "stopping";
    }
  | {
      readonly kind: "sessionMismatch";
      readonly expectedAuthorityEpoch: AuthorityEpoch;
      readonly providedAuthorityEpoch: AuthorityEpoch;
    }
  | { readonly kind: "invalidTarget"; readonly detail: string }
  | { readonly kind: "sourceUnavailable"; readonly subject: MediaSubject }
  | {
      readonly kind: "unsupportedMaterialization";
      readonly target: MaterializationTarget;
    }
  | { readonly kind: "alreadyCancelled"; readonly ticketId: WorkTicketId };
```

```ts
type MediaWorkFailure =
  | { readonly kind: "decodeFailed"; readonly detail: string }
  | { readonly kind: "unsupportedMedia"; readonly detail: string }
  | { readonly kind: "sourceMissing" }
  | { readonly kind: "cancelled" }
  | { readonly kind: "superseded" }
  | { readonly kind: "internalFailure"; readonly detail: string };
```

---

## 14. Audio-critical isolation

Media work must not compromise live performance paths.

A conforming implementation must ensure:

- media work does not execute on an audio callback path
- media work does not hold locks required by audio-critical publication
- media work does not make hot publication progress depend on background materialization
- resource production cannot block live runtime publication
- background materialization cannot block live performance-critical hot surfaces

Scheduler internals may vary, but these isolation requirements are part of the product authority contract.

---

## 15. Scheduler policy boundary

This document does not define a concrete scheduler.

A later scheduler document may define:

- priority classes
- queue fairness
- CPU/GPU placement
- worker-pool sizing
- cancellation latency
- retry policy
- resource cache interaction
- live-performance priority rules

Any scheduler must preserve this authority contract:

- accepted work is observable
- every work item terminates or is superseded within a live authority epoch
- authority epoch replacement invalidates old-epoch work tickets through the session layer
- resource opens do not block on generation
- live audio-critical work is not blocked by background materialization

---

## 16. Conformance requirements

A conforming implementation must prove at least:

- `MediaWorkKey` cannot carry conflicting work-kind identities
- media work is keyed to stable `MediaSubject` input revision
- materialization targets include profile identity when output policy affects bytes or descriptor meaning
- `workGeneration` ordering is scoped to one `(authorityEpoch, MediaWorkKey)`
- work attempt state and materialization availability are distinct
- materialization availability does not use `superseded` as a steady-state availability kind
- work request success returns `accepted`, `alreadyQueued`, `alreadyRunning`, or `alreadyAvailable`
- duplicate requests for the same key do not create unbounded duplicate work
- accepted work becomes visible in `mediaWork.attemptStatus` or equivalent publication state
- materialization availability is visible separately from ticket attempt state
- resource open composes with Resource Plane v1 open semantics and does not fork the handle protocol
- resource open does not schedule hidden work
- resource open does not block until generation completes
- unavailable resources fail with typed media availability open failure
- produced resources carry stable `resourceVersion` and typed descriptor
- produced resource descriptors do not carry produced bytes or large body fragments
- superseded resource versions invalidate old handles
- cancellation publishes terminal or superseded attempt state when accepted
- authority epoch replacement invalidates live work tickets from the old epoch through the session layer
- backpressure is explicit, not a silent hang
- media work does not block audio-critical hot publication paths
- consumers can observe queued, running, available, failed, cancelled, and superseded states without worker-specific
  knowledge

---

## 17. Rejected alternatives

### Rejected: workers as the product contract

Workers are implementation topology. The product contract is media work ownership, state, availability, and produced
resources.

### Rejected: WorkTicket as ResourceHandle

A work ticket tracks production work. A resource handle provides access to stable produced bytes. Collapsing them
creates handle lies.

### Rejected: `MediaWorkKey.kind` separate from `MaterializationTarget.kind`

The materialization target owns the work kind. Duplicating that identity makes contradictory keys representable.

### Rejected: `subjectKey: string` without media input revision

Media work must bind to a stable input version. A logical track id alone is not sufficient to protect against late
results from stale media inputs.

### Rejected: materialization target without profile identity

Waveform, stem, artwork, and analysis outputs depend on production policy. A work key that omits profile identity cannot
distinguish old and new output policies.

### Rejected: combining work attempt state with materialization availability

A ticket's state and a target's current usable bytes are different facts. A failed or cancelled attempt does not imply
no older resource is available.

### Rejected: `superseded` as steady-state availability

Supersession is a work-attempt and invalidation fact. Current availability should describe the current usable resource
or the current absence of one.

### Rejected: blocking resource open until generation completes

Resource open is access to existing stable bytes. Scheduling and waiting belong to control and publication state, not
hidden blocking behavior.

### Rejected: forking Resource Plane open semantics

Media resource open may add media-specific availability failures, but it must not invent a second handle protocol
separate from Resource Plane v1.

### Rejected: hidden worker state as progress model

Accepted work must become observable through publication state.

### Rejected: silent supersession

If work or resources are superseded, consumers must observe the change through publication and handle invalidation.

### Rejected: background analysis blocking live playback

Background materialization must not block live audio-critical state or hot publication paths.
