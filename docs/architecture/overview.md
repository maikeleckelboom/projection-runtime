# Architecture Overview

Exclave is a typed boundary substrate for local realtime systems. It separates control-plane requests, publication-plane
state, resource-plane payload access, and session lifecycle. Its hot lane uses fixed-layout shared memory for
low-latency publication surfaces, but shared memory is not the whole system.

## Current landed package graph

- `base`
- `schema`
- `hot-codec` -> `base`
- `hot-binding` -> `base`, `hot-codec`
- `hot-consumer` -> `base`
- `hot-publisher` -> `base`
- `compiler` -> `base`, `schema`, `hot-codec`
- `conformance` -> `base`, `compiler`, `hot-codec`, `hot-binding`, `hot-publisher`
- `session` — (no deps; pure binding validity only)
- `control-plane` -> `base`, `session`
- `resource` -> `base`, `session`, `control-plane`

## Package ownership

| Package                  | Ownership                                                                   |
|--------------------------|-----------------------------------------------------------------------------|
| `@exclave/base`          | shared error, invariant, and JSON foundations only                          |
| `@exclave/schema`        | authored projection contract types and syntactic validation                 |
| `@exclave/hot-codec`     | hot-lane layout planning, ABI constants, fixture encoding/decoding helpers  |
| `@exclave/hot-binding`   | binding already-opened hot region bytes to validated ABI counter views, with optional Block A identity validation delegated to `hot-codec` |
| `@exclave/hot-consumer`  | bounded read-attempt kernel for already-opened hot sequence views           |
| `@exclave/hot-publisher` | writer-side hot publication transition for already-opened hot Block B views |
| `@exclave/compiler`      | canonicalization, semantic legality, lane planning, artifact derivation     |
| `@exclave/conformance`   | fixture verification and cross-implementation compatibility evidence        |
| `@exclave/session`       | minimal product-neutral binding validity fence; answers whether a caller may use an already-opened binding for the expected authorityKey, surfaceKey, and authorityEpoch; does not open bindings, allocate regions, publish bytes, transport messages, or manage app lifecycle |
| `@exclave/control-plane` | JSON-safe request/response envelope shapes for boundary control messages; does not transport messages, dispatch operations, open resources, publish hot bytes, manage sessions, or own product authority semantics |
| `@exclave/resource`      | resource handle descriptors, read-range contracts, read-range receipts, and resource failures; does not transport bytes, stream data, allocate buffers, read files, decode media, publish hot state, manage sessions, dispatch operations, or own product semantics |

## Out of scope

Exclave does not define:

- product-specific authorities as substrate packages
- Electron application architecture
- worker-pool topology
- cold materialization as a renderer subscription lane
- hidden work scheduling inside resource open operations
- product semantics inside `@exclave/core`

## `@exclave/core` warning

No `@exclave/core` package is required for public v1. If it exists later, it must be either a tiny convenience
aggregator
or a narrow shared runtime contract layer. It must not own compiler, codecs, session lifecycle, resources, conformance,
product authorities, or app integration.
