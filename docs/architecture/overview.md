# Architecture Overview

Seqlok is a typed boundary substrate for local realtime systems. It separates control-plane requests, publication-plane
state, resource-plane payload access, and session lifecycle. Its hot lane uses fixed-layout shared memory for
low-latency publication surfaces, but shared memory is not the whole system.

## Current landed package graph

- `base`
- `schema`
- `primitives` -> `base`
- `hot-codec` -> `base`
- `hot-consumer` -> `base`
- `compiler` -> `base`, `schema`, `hot-codec`
- `conformance` -> `base`, `compiler`, `hot-codec`

## Package ownership

| Package                | Ownership                                                                  |
|------------------------|----------------------------------------------------------------------------|
| `@seqlok/base`         | shared error, invariant, and JSON foundations only                         |
| `@seqlok/schema`       | authored projection contract types and syntactic validation                |
| `@seqlok/primitives`   | low-level atomic and layout helpers used by substrate packages             |
| `@seqlok/hot-codec`    | hot-lane layout planning, ABI constants, fixture encoding/decoding helpers |
| `@seqlok/hot-consumer` | bounded read-attempt kernel for already-opened hot sequence views          |
| `@seqlok/compiler`     | canonicalization, semantic legality, lane planning, artifact derivation    |
| `@seqlok/conformance`  | fixture verification and cross-implementation compatibility evidence       |

## Out of scope

Seqlok does not define:

- product-specific authorities as substrate packages
- Electron application architecture
- worker-pool topology
- cold materialization as a renderer subscription lane
- hidden work scheduling inside resource open operations
- product semantics inside `@seqlok/core`

## `@seqlok/core` warning

No `@seqlok/core` package is required for public v1. If it exists later, it must be either a tiny convenience aggregator
or a narrow shared runtime contract layer. It must not own compiler, codecs, session lifecycle, resources, conformance,
product authorities, or app integration.
