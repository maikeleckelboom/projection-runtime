# Seqlok

Seqlok is a deterministic shared-memory contract system for timing-sensitive,
multithreaded TypeScript engines.

This repository is the new clean public extraction of Seqlok. It is library-only,
with code landing incrementally into a lean public v1 target.

Currently landed:

- `@seqlok/base`
- `@seqlok/schema`
- `@seqlok/primitives`

Planned later:

- `@seqlok/core`

Packages such as commands, stream buffers, diagnostics, worklet mounting,
introspection, and all app/demo/lab surfaces are intentionally excluded for now.

Root build, typecheck, and test scripts only reference packages that have
actually landed. This repo is not a bulk copy of the old
research-and-development workspace.
