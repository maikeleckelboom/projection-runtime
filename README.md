# Projection Runtime

**Electron–Rust Runtime Architecture**

Projection Runtime is production-shaped architecture research into generated
cross-language contracts, bounded publication, resource access, and lifecycle
recovery between an Electron application and a native Rust authority.

**Executable proof:** a real Electron process launches a compiled standalone
Rust authority and exercises generated contracts, typed control, bounded
publication, renderer reload, authority replacement, explicit resubscription,
continuity rebase, and deterministic teardown.

The repository contains that executable integration and a set of
product-neutral contract packages. It is not a shipped application runtime.

[Architecture index](docs/projection-runtime/README.md) ·
[Executable Electron–Rust proof](integration/electron-rust-warm-authority/README.md) ·
[Implementation conformance map](docs/projection-runtime/implementation-conformance-map.md) ·
[Current limitations](#current-limitations) ·
[Verification](#verification)

## The problem

An Electron renderer should not become the authority for native process state,
shared-memory layout, resource lifetime, or recovery. A useful boundary needs
more than request and response IPC. It needs explicit ownership, generated
agreement across languages, bounded delivery, invalidation, resubscription, and
continuity rules after reload or process replacement.

Projection Runtime separates control intent, published state, resource access,
and session lifecycle so each path can have its own authority, payload, and
failure semantics.

## Executable architecture

The implemented
[Electron–Rust proof](integration/electron-rust-warm-authority/README.md)
crosses both semantic directions:

```text
                       typed control intent
Sandboxed renderer -> isolated preload -> Electron main supervisor -> native Rust authority

                       published snapshots
Sandboxed renderer <- isolated preload <- Electron main supervisor <- native Rust authority
```

These lanes share supervised process boundaries, but they do not collapse into
one message type. The renderer sends narrowly typed control intent. Rust
publishes complete generated-manifest-backed warm snapshots through distinct
subscription, credit, invalidation, and continuity rules.

Electron main brokers a private framed-stdio stream and owns process
supervision. The isolated preload owns a dedicated `MessagePort` for each
renderer client. The sandboxed renderer receives validated state through a
narrow API. Rust remains the sole authority for deck state, timeline, epoch,
control mutation, subscription state, and publication assembly.

## Authority and capability boundaries

- Rust owns authoritative state and issues the authority epoch.
- Electron main starts, supervises, replaces, and terminates the Rust process.
- The preload validates attachments and exposes only deck-specific operations.
- The renderer sends typed intent and consumes validated published state.
- Generated Rust and TypeScript artifacts agree on contract and byte identity.
- Public `@exclave/*` packages define product-neutral contracts and codecs.

The `@exclave` scope is the npm publishing namespace. It is not the public name
of this architecture.

## Lifecycle and recovery

Renderer reload preserves authority while replacing the client:

```text
old renderer client + subscription -> closed
Rust authority + authority epoch    -> remain alive and continue advancing
replacement renderer                -> new client + explicit subscription
new subscription                    -> complete current baseline
```

Authority replacement invalidates the old session before recovery:

```text
Rust process death       -> old authority, epoch, session, and subscription invalid
replacement Rust process -> new non-reused authority epoch
renderer                  -> no automatic resubscription
renderer                  -> explicit subscription + new complete baseline
continuity                -> rebase before later publications are consumed
```

The proof does not claim transparent recovery. A renderer reload and an
authority replacement have intentionally different lifecycle rules.

## Implemented evidence

- Real Electron main, isolated preload, sandboxed renderer, and compiled Rust
  process boundaries
- Rust-owned state, epoch issuance, and typed tempo mutation
- Generated Rust and TypeScript contract and byte agreement
- Private bounded binary framing over stdio
- One in-flight plus one replaceable pending-latest publication at each hop
- Positive upstream and downstream coalescing evidence
- Renderer reload without authority restart
- Authority crash invalidation and non-reused replacement epoch
- Explicit resubscription, new baseline, and continuity rebase
- TypeScript, Rust, generator, fixture, integration, and teardown checks

The
[implementation conformance map](docs/projection-runtime/implementation-conformance-map.md)
separates landed behavior from contract-only surfaces and future work.

## Current limitations

- The deck engine and meter evolution are simulated.
- No real audio device or native audio engine is connected.
- No real resource-plane implementation or waveform surface is present.
- The private `EXCL` v0 stdio profile is proof-specific and replaceable.
- Native renderer mapping and shared-memory transport are not implemented.
- Several public packages define contracts and validation rather than complete
  runtimes.
- The integration is production-shaped research, not a shipped product runtime.
- The repository is not built into Dekzer and does not power it.

## Architecture and package map

- [`docs/projection-runtime`](docs/projection-runtime/README.md) contains the
  architecture, lifecycle, codec, protocol, and conformance documents.
- [`integration/electron-rust-warm-authority`](integration/electron-rust-warm-authority/README.md)
  contains the real Electron and Rust warm-path proof.
- `fixtures/projection-runtime` contains authored contracts, canonical
  manifests, generated artifacts, and cross-language fixtures.
- `crates` contains Rust publication and conformance code.
- `packages` contains product-neutral `@exclave/*` contract, codec, compiler,
  binding, publication, resource, session, host, and conformance packages.
- `scripts` contains deterministic generators and repository verification.

## Research boundary

Projection Runtime and SeqWire are separate research projects with no runtime
dependency in either direction. Dekzer historically motivated this class of
desktop systems problem, but neither repository is a Dekzer integration target.
See [Research lineage](docs/projection-runtime/research-lineage.md) for the
precise boundary.

## Verification

Use Node.js 24 and the repository-pinned pnpm version:

```sh
pnpm install --frozen-lockfile
pnpm verify
```

The canonical gate covers formatting, lint, TypeScript build and typechecking,
TypeScript tests, Rust checks and tests, generated artifact stability,
cross-language conformance, and the real Electron–Rust integration proof.
