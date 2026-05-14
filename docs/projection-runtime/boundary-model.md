# Boundary Model

Status: Canonical. Conceptual center for boundary plane separation and ownership vocabulary.

This document defines the boundary model for a local-first desktop system where an Electron renderer coordinates with
backend owners without becoming one.

The goal is not “better IPC.” The goal is a clean product boundary model for three different kinds of cross-boundary
interaction:

- control-plane requests and replies
- publication-plane state synchronization over time
- resource-plane movement of large, paged, streamed, or mapped payloads

If a design cannot clearly say which one of those three it is, the design is incomplete.

---

## 1. The center

The renderer sends intent across a declared boundary. Services execute through real owners. Replies return boundary
facts. Ongoing state arrives through publication surfaces. Large or paged payloads travel on resource surfaces.

That is the whole model.

---

## 2. The three planes

### 2.1 Control plane

The control plane is for:

- commands
- reads
- replies

Examples:

- `RegisterLocalRoot`
- `RunRootScan`
- `ReadLiteralHierarchyChildren`
- `...Reply`

Control plane answers:

- what does the app want?
- what is legally requestable?
- what completed?
- what boundary facts came back?

Control plane is not for long-lived synchronized state.

### 2.2 Publication plane

The publication plane is for:

- invalidations
- progress
- session/runtime surfaces
- continuity-aware state delivery

Examples:

- scan progress
- invalidation
- runtime projections
- continuity break signals

Publication plane answers:

- what state is being observed over time?
- is it continuous with what came before?
- must the consumer reset, rebase, or continue?

Publication plane is not a reply channel.

### 2.3 Resource plane

The resource plane is for:

- large payloads
- paged data
- chunked data
- streamed data
- mapped data
- handle/lifetime-managed reads

Examples:

- waveform bytes
- paged browse bodies
- binary assets
- mapped read surfaces

Resource plane answers:

- how does the UI access large data without lying that it is a reply or a projection?
- who owns the handle?
- what is the paging or mapping rule?
- what is the lifetime rule?

Resource plane is not a projection and not a reply dumping ground.

---

## 3. Ownership model

### Renderer

The renderer owns:

- user intent
- view projection
- presentation-local state
- interaction-local ephemeral state

The renderer does not own:

- durable product state
- backend authority
- continuity repair
- direct substrate access

### Contract

A contract owns:

- what is legally requestable on the control plane
- what is legally publishable on the publication plane
- what is legally open/read/close on the resource plane

A contract does not own:

- durable business authority
- renderer composition policy
- transport implementation

### Service

A service owns:

- request execution
- orchestration across real owners
- boundary handling

A service does not own:

- durable substrate truth
- renderer policy
- authority by accumulation

### Authority

An authority owns:

- durable or runtime product operations
- mutation rules
- publication assembly
- actual substrate reads/writes

Authorities do not own:

- UI composition
- renderer-local policy

---

## 4. What this model is solving

This model solves for:

- explicit renderer/backend ownership
- clean request/reply naming
- clear separation between commands and ongoing state
- continuity-aware publication delivery
- resource handling for large or paged payloads
- durable local state staying backend-owned
- implementation conformance instead of host-shell smoke tests

---

## 5. What this model is not solving

This model is not:

- a generic IPC guide
- a generic RPC framework
- a universal abstraction over all cross-boundary traffic
- a SQLite schema guide
- a UI component guide

It is specifically the product boundary model for commands, ongoing state, and resources.

---

## 6. Core rules

### Rule 1

If it completes a request, it belongs to the control plane.

### Rule 2

If it keeps the UI synchronized over time, it belongs to the publication plane.

### Rule 3

If it is large, paged, streamed, or mapped, it belongs to the resource plane.

### Rule 4

If it writes real product state, it belongs to an authority, not a renderer helper and not a service façade.

### Rule 5

If a reply starts carrying long-lived synchronized state, stop. That state belongs on the publication plane.

### Rule 6

If a projection starts carrying large paged or mapped payloads, stop. That belongs on the resource plane.

### Rule 7

If a service starts owning durable operations, UI policy, transport scheduling, recovery policy, and contract definition
all at once, stop. That is architecture drift.

### Rule 8

If a noun tries to answer all layer questions at once, including intent, legal contract, handler operation, and
authority operation, reject it.

---

## 7. Naming laws

Use names that answer exactly one question.

- renderer names what the app wants
- contracts name what is legally requestable or publishable
- services name what is handled here
- authorities name what the real owner does

If one name is trying to do all four jobs, it is wrong.

---

## 8. Review checklist

Reject a decision if any of these are true:

- it makes the renderer act like backend authority
- it treats replies and ongoing publications as the same thing
- it pushes large or paged payloads into replies or projections
- it lets service-layer code silently become the durable owner
- it re-centers the architecture on a host/router/framework noun
- it cannot be explained in terms of the three planes

---

## 9. One-sentence review check

The renderer sends control-plane intent, services execute through real owners, replies return boundary facts, ongoing
state arrives through publication surfaces, and large or paged payloads travel on the resource plane.
