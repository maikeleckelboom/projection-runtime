# Seqlok

Seqlok is a typed boundary substrate for local realtime systems.

It separates control-plane requests, publication-plane state, resource-plane payload access, and session lifecycle. Its hot lane uses fixed-layout shared memory for low-latency publication surfaces, but shared memory is not the whole system.

This repository is a clean public extraction and not a bulk copy of the old research-and-development workspace.

Currently landed:

- `@seqlok/base`
- `@seqlok/schema`
- `@seqlok/primitives`
- `@seqlok/hot-codec`
- `@seqlok/hot-consumer`
- `@seqlok/compiler`
- `@seqlok/conformance`

No `@seqlok/core` package is required for public v1. If it exists later, it must be either a tiny convenience aggregator or a narrow shared runtime contract layer. It must not own compiler, codecs, session lifecycle, resources, conformance, product authorities, or app integration.

Packages such as commands, stream buffers, diagnostics, worklet mounting, introspection, and all app/demo/lab surfaces are intentionally excluded for now.

Root build, typecheck, and test scripts only reference packages that have actually landed. This repo is not a bulk copy of the old research-and-development workspace.
