# Projection Runtime redesign migration note

## What this redesign is solving, what it is not solving, and how to use the first attempt without repeating its mistakes

Status: Historical, non-authoritative migration note. This document explains the redesign rationale and the rejected
center of gravity.
Implementation authority lives in the projection spine and companion specs. It is not authoritative for any
implementation detail.

This note exists to prevent a bad rewrite.

The first attempt was not worthless. It discovered several real constraints early:

- contract sanity matters
- not all outbound traffic is equal
- projections need continuity handling
- resources are different from projections
- scheduler pressure changes delivery behavior
- tests need to encode invariants, not just happy paths

What it got wrong was the center of gravity. It organized those discoveries around a `ServiceHost`-centric IPC worldview
instead of an authority-first boundary model.

This note tells future humans and agents exactly what the redesign is solving, what it is not solving, what from the
first attempt should survive, and what must be rejected.

---

## 1. The real problem we are solving

We are **not** solving “how to make Electron call Rust nicely.”
We are solving a deeper product and architecture problem:

> How do we define one explicit boundary model between renderer and backend so that commands, live state, and large
> payloads cross that boundary without ownership ambiguity, semantic drift, or accidental framework-centered design?

That boundary model must let us do all of the following cleanly:

- renderer sends intent without becoming a backend
- backend executes through real owners
- replies return boundary facts without leaking substrate internals
- live state reaches the UI over time without being confused with replies
- large or paged payloads cross the boundary without being stuffed into the wrong channel
- continuity and invalidation are first-class where they matter
- tests can prove the behavioral rules instead of only smoke-testing a host shell

That is the redesign target.

---

## 2. The actual shape we are solving for

### In one clear paragraph

This redesign defines the boundary model for a serious desktop product where a renderer coordinates with real backend
owners without becoming one. User intent, evolving backend state, and large or mapped payloads all cross the same
application boundary, but they obey different contracts. The contract and ownership model lets those things move between
Electron renderer, backend services, runtime authorities, durable state, and high-volume data surfaces without
collapsing into host-centric IPC.

### The domains this touches and solves for

This work is directly solving for a group of connected domains:

- **Desktop app boundary design**: Electron renderer ↔ backend boundary with explicit ownership.
- **Control-plane application actions**: commands, reads, replies, and legal request surfaces.
- **Realtime publication surfaces**: state that changes over time and must stay synchronized with continuity semantics.
- **Resource transport**: paged, chunked, streamed, binary, or mapped data that should not be stuffed into replies.
- **Durable local product state**: SQLite, filesystem, and other backend-owned local state that must not leak upward as
  UI-owned truth.
- **Authority orchestration**: services executing through real owners instead of accumulating ownership they do not
  hold.
- **Runtime invalidation and recovery**: continuity breaks, invalidations, and reset behavior when state delivery is
  interrupted.
- **Delivery-pressure and lane behavior**: different reliability, freshness, and cost classes across different surfaces.
- **Cross-language/runtime integration**: renderer, TypeScript, Rust, and local durable substrate cooperating without
  naming lies.
- **Implementation conformance**: tests that prove the boundary laws, not just transport smoke tests.

The important scoping line is this:

> We are not designing “IPC.” We are designing the product boundary model for commands, ongoing state, and resources in
> a local-first desktop system.

### The real outcome we want

When this redesign is finished, a future implementer should know exactly:

- what kind of thing they are moving,
- which plane it belongs to,
- who owns it,
- what guarantees it carries,
- and which layer is allowed to name it.

If the redesign does not make those five answers obvious, it is incomplete.

## 3. The three-plane shape we are solving for

The boundary model is **three planes**.

### Control plane

Purpose:

- commands
- reads
- replies

This is for things like:

- `RegisterLocalRoot`
- `RunRootScan`
- `ReadLiteralHierarchyChildren`
- `...Reply`

Control plane is about:

- what the app wants
- what is legally requestable
- what completed
- what boundary facts came back

Control plane is **not** for long-lived synchronized state.

### Publication plane

Purpose:

- invalidations
- progress
- session/runtime surfaces
- continuity-aware state delivery

This is for things like:

- scan progress
- runtime projections
- continuity breaks
- state invalidation

Publication plane is about:

- keeping the UI synchronized over time
- continuity, baseline, generation, sequence
- observation, not request completion

Publication plane is **not** a reply mechanism.

### Resource plane

Purpose:

- large payloads
- paged data
- chunked data
- mapped data
- handle/lifetime-managed reads

This is for things like:

- waveform bytes
- paged browse bodies
- binary assets
- mapped read surfaces

Resource plane is about:

- size
- paging
- mapping
- ownership and lifetime

Resource plane is **not** a projection and **not** a reply payload dumping ground.

---

## 3. The one-sentence model

Use this sentence in reviews:

> The renderer sends control-plane intent, services execute through real owners, replies return boundary facts, ongoing
> state arrives through publication surfaces, and large or paged payloads travel on the resource plane.

If a design cannot be explained by that sentence, it is probably wrong.

---

## 4. What we are explicitly solving

We are solving these things:

### A. Honest ownership at the boundary

The renderer is not a second backend.
The service is not the durable owner.
The contract is not the product authority.
The backend authority owns the real operation.

### B. Honest separation of interaction types

A request/reply is not the same thing as live state.
A live state surface is not the same thing as a large resource.
A large resource is not the same thing as a method response.

### C. Continuity where it actually matters

Some state needs more than “latest value.”
It needs explicit reset and continuity semantics.
The redesign must keep that concern first-class on the publication plane.

### D. Fail-fast contract discipline

Bad names, bad shapes, bad ownership, and illegal combinations should fail early.
We are solving for strong define-time or bind-time rejection, not runtime guesswork.

### E. A substrate that survives growth

The design must scale from first-slice Electron work to richer backend/UI realtime surfaces without collapsing into
service-host-centered design.

---

## 5. What we are explicitly **not** solving

This is the critical part. Future implementers need these non-goals in writing.

### Not solving: a generic IPC framework

We are not trying to build a reusable “do everything” Electron RPC framework.
If that becomes the goal, the architecture will center itself around host plumbing instead of product truth.

### Not solving: direct renderer access to backend owners

The renderer must not call substrate owners directly, even if it feels convenient.
That path gives the renderer ownership it cannot safely hold.

### Not solving: one universal surface contract for everything

We are not trying to flatten commands, live state, and resources into one generalized contract abstraction.
Shared plumbing is fine. Shared conceptual ownership is not.

### Not solving: service-first product architecture

We are not building “services with methods/events/projections/resources” as the main noun model.
That was the old center, and it is too weak.

### Not solving: reply-based state synchronization

A reply completes a request. It does not become a shadow publication channel.
If the UI must stay synchronized after the reply, that is publication-plane state.

### Not solving: resource transport via projection contracts

Large, paged, chunked, or mapped data should not be forced into projection contracts just because the UI needs it.
That is resource-plane work.

### Not solving: host recovery protocol as the canonical continuity model

Recovery flows may still exist, but they are downstream operational patterns.
They do not own continuity semantics. The publication model does.

### Not solving: accidental framework-centered architecture

We are not redesigning around `ServiceHost 2.0`, “better IPC,” or “cleaner request handlers.”
Those are implementation shells, not the system center.

---

## 6. Why these things are out of scope

Future implementers need the “why not,” not just the “no.”

### Why not a generic IPC framework?

Because product authority and transport utility are different concerns. The moment framework reuse becomes the center,
boundary ownership loses precision.

### Why not a universal surface contract?

Because the laws differ:

- control plane is about legality and completion
- publication plane is about continuity and observation over time
- resource plane is about size, paging, mapping, and handle lifecycle

One abstraction over three different laws produces blurry naming and weak guarantees.

### Why not reply-based sync?

Because replies describe completion of a request, while synchronized state has to survive time, invalidation, pressure,
and continuity breaks. Those are different semantics.

### Why not service-first modeling?

Because it subordinates the important thing, published surfaces, under a generic container noun. That makes the system
easier to start and harder to keep ownership precise.

### Why not direct renderer/backend coupling?

Because the renderer will start owning backend concepts it cannot safely own: durable state, lifecycle, continuity
repair, and store-shape knowledge.

---

## 7. What from the first attempt should survive

### Keep 1: contract sanity discipline

The first attempt already knew bad contracts should fail early.
Keep that instinct.

### Keep 2: differentiated delivery behavior

The first attempt already knew reliability, telemetry pressure, and projection continuity differ.
Keep that insight.

### Keep 3: projection continuity as a real problem

The first attempt already found snapshot, delta, invalidation, and recovery ordering pain.
Keep the problem, but relocate its ownership into the publication model.

### Keep 4: resources as a separate class

Paged and mapped resource handling was a real discovery, not noise.
Keep it separate.

### Keep 5: behavior-first tests

The first attempt already encoded actual invariants in tests.
Keep that posture and make it stronger.

---

## 8. What from the first attempt must die

### Kill 1: `ServiceHost` as the architecture center

It may survive as an integration shell.
It must not survive as the conceptual owner.

### Kill 2: service contracts as the main system noun

Projection contracts, control-plane contracts, and resource surfaces must become clearer and more specific.

### Kill 3: recovery protocol as a substitute for continuity semantics

Recovery is an operational response.
It is not the foundational model.

### Kill 4: one contract model for methods, events, projections, and resources

That is too blunt and too easy to lie with.

---

## 9. Translation table: old model to new model

| Old attempt noun          |              Keep? | New interpretation                                                                                                    |
|---------------------------|-------------------:|-----------------------------------------------------------------------------------------------------------------------|
| `defineContract`          |             partly | keep fail-fast contract discipline, but separate control-plane contracts, projection contracts, and resource surfaces |
| `ServiceHost`             |          no center | integration/runtime shell only                                                                                        |
| methods                   |                yes | control-plane commands/reads                                                                                          |
| events                    |             partly | publication-plane updates or control-plane notifications depending on semantics                                       |
| projections               |      yes, strongly | publication-plane state surfaces                                                                                      |
| `projectionSnapshot`      |                yes | replaceable snapshot publication semantics                                                                            |
| `projectionDelta`         |        maybe later | future publication family or codec, not the default center                                                            |
| `projectionInvalidated`   | yes, reinterpreted | publication-plane continuity/baseline break signal                                                                    |
| `streamId` / `generation` | yes, reinterpreted | publication identity and continuity semantics                                                                         |
| resources                 |                yes | resource-plane handles, paging, mapping                                                                               |
| spool/lane stats          |                yes | runtime telemetry and conformance instrumentation, not contract surface                                               |

The rule is simple:

> Port the old invariants. Do not port the old center.

---

## 10. Hard rules for redesign work

Use these in every PR, issue, and agent task.

### Rule 1

If it completes a request, it belongs to the control plane.

### Rule 2

If it keeps the UI synchronized over time, it belongs to the publication plane.

### Rule 3

If it is large, paged, streamed, or mapped, it belongs to the resource plane.

### Rule 4

If it writes to real product state, it belongs to an authority, not a renderer helper and not a service façade.

### Rule 5

If a service starts owning durable operations, UI policy, transport scheduling, recovery policy, and contract definition
all at once, stop. That is the old trap returning.

### Rule 6

If a reply starts carrying long-lived state that the UI depends on after completion, stop. That state belongs on the
publication plane.

### Rule 7

If a projection starts carrying large paged or mapped payloads, stop. That belongs on the resource plane.

### Rule 8

If a name tries to answer all layer questions at once, including intent, legal contract, handler operation, and
authority operation, reject it.

---

## 11. What this means for implementation work right now

### For control-plane work

Design request/reply surfaces around legal boundary operations and boundary facts.
Do not leak store internals or authority implementation names upward.

### For publication work

Design around continuity, invalidation, baseline, and observation over time.
Do not make publications look like replies.

### For resource work

Design around chunking, paging, mapping, lifetime, and ownership.
Do not stuff resources into replies or projections.

### For integration shells

Hosts, IPC routers, and transport wrappers may exist, but they are not the system center.
Treat them as replaceable infrastructure.

### For testing

Port old behavioral test ideas, but target the new nouns and laws:

- continuity failure
- invalidation
- recovery ordering where applicable
- lane pressure isolation
- wrong-owner/wrong-handle rejection
- resource lifetime and ownership

---

## 12. Review checklist

Reject a redesign decision if any of these are true:

- it makes the renderer act like backend authority
- it treats replies and ongoing publications as the same thing
- it pushes large or paged payloads into replies or projections
- it lets service-layer code silently become the durable owner
- it re-centers the architecture on a host/router/framework noun
- it preserves old structure instead of preserving old invariants
- it cannot be explained in terms of the three planes

---

## 13. Bottom line

The first attempt was useful because it already found the real pain:

- contract validity
- differentiated delivery
- continuity break handling
- resource separation
- scheduler pressure
- behavior-first testing

What it got wrong was ownership and center of gravity.

So the migration law is:

> Keep the constraints. Reject the old center. Use the three-plane boundary model so commands, ongoing state, and
> resources each have one explicit home.

That is what future humans and agents should optimize for during the redesign.
