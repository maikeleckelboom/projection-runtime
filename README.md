# Seqlok

Seqlok is a deterministic shared-memory contract system for timing-sensitive,
multithreaded TypeScript engines.

This repository is the new clean public extraction of Seqlok. It is library-only,
with a lean public v1 target:

- `@seqlok/base`
- `@seqlok/schema`
- `@seqlok/primitives`
- `@seqlok/core`

Packages such as commands, stream buffers, diagnostics, worklet mounting,
introspection, and all app/demo/lab surfaces are intentionally excluded for now.

Code will land incrementally into this scaffold. This repo is not a bulk copy of
the old research-and-development workspace.
