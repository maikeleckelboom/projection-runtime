# Electron–Rust Runtime Architecture

Projection Runtime is research into generated cross-language contracts, bounded
publication, resource access, and lifecycle recovery between an Electron
application and a native Rust authority.

The repository contains a production-shaped executable integration and a set of
product-neutral contract packages. It is not a shipped application runtime and
does not currently power Dekzer.

## The problem

An Electron renderer should not become the authority for native process state,
shared-memory layout, resource lifetime, or recovery. A useful boundary needs
more than IPC messages. It needs explicit ownership, generated agreement across
languages, bounded delivery, invalidation, resubscription, and continuity after
reload or process replacement.

Projection Runtime investigates that larger boundary. The current work separates
control intent, published state, resource access, and session lifecycle so each
path can have its own authority and failure rules.

## The executable architecture

The implemented integration under
`integration/electron-rust-warm-authority` runs a real Electron process and a
real compiled Rust executable:

```text
Sandboxed renderer
  -> isolated preload
  -> Electron main supervisor
  -> private framed stdio
  -> native Rust authority
```

The renderer uses a narrow typed API exposed by the preload. Electron main owns
process supervision and client brokering. The Rust process owns authority state,
the simulated deck timeline, epoch identity, typed tempo mutation, subscription
state, and complete warm publication assembly.

## Authority and process ownership

- Rust owns the authoritative state and issues the authority epoch.
- Electron main starts, supervises, replaces, and terminates the Rust process.
- The preload retains one dedicated `MessagePort` for each renderer client.
- The sandboxed renderer receives validated state and sends typed control intent.
- Generated Rust and TypeScript artifacts agree on contract and byte identity.

The root workspace and all public packages are private research or package
surfaces. `@exclave` is the npm publishing namespace. It is not the name of this
architecture.

## Control and publication paths

Typed control intent travels from the renderer through preload and Electron main
to the Rust authority. The implemented proof uses `deck.setTempoRatio` and
observes the resulting Rust-owned state in a later publication.

Warm publications use generated manifest-backed decoding and bounded
replaceable-latest delivery at both transport hops. One item may be in flight
while one newer pending item replaces older pending work. This prevents an
unbounded renderer backlog while preserving a complete latest snapshot.

The repository also defines product-neutral contracts for hot shared-memory
publication, warm framed snapshots, cold reopen, resources, sessions, host
surfaces, and conformance.

## Reload and failure behavior

The executable proof verifies:

- renderer reload without restarting the Rust authority
- replacement of the renderer client and subscription
- immediate invalidation after authority process death
- a non-reused epoch for the replacement authority
- no automatic resubscription after replacement
- explicit resubscription with a new baseline
- continuity rebase before new publications are accepted
- deterministic Electron and child-process teardown

These behaviors are part of the research evidence, not a claim of a complete
product runtime.

## Implemented evidence

- Rust-owned authority state
- Electron main-process supervision
- isolated preload and sandboxed renderer boundaries
- typed control intent
- generated Rust and TypeScript artifacts
- deterministic hot and warm byte fixtures
- Rust-to-TypeScript byte agreement
- bounded publication delivery and positive coalescing evidence
- renderer reload without authority restart
- authority crash invalidation and epoch replacement
- explicit resubscription and continuity rebase
- TypeScript, Rust, generator, fixture, and integration tests
- deterministic process teardown

## Current limitations

- The deck engine and meter evolution are simulated.
- No real audio device or native audio engine is connected.
- No real resource-plane implementation or waveform surface is present.
- The private `EXCL` v0 stdio profile is proof-specific and replaceable.
- Native mapped-memory transport is not implemented for the Electron renderer.
- Several public packages define contracts and validation without complete
  production runtimes.
- The architecture is production-shaped research, not a shipped product.

Dekzer motivated parts of this investigation as an example of a future desktop
audio application. This repository is not built into Dekzer and is not the
runtime behind it.

## Architecture and package map

- `docs/projection-runtime`: architecture, lifecycle, codec, and conformance
  specifications
- `integration/electron-rust-warm-authority`: real Electron and Rust warm-path
  proof
- `fixtures/projection-runtime`: authored contracts, canonical manifests,
  generated artifacts, and cross-language fixtures
- `crates`: Rust publication and conformance code
- `packages`: product-neutral `@exclave/*` contract, codec, compiler, binding,
  publication, resource, session, host, and conformance packages
- `scripts`: deterministic generators and repository verification

Start with the
[Projection Runtime documentation index](docs/projection-runtime/README.md) and
the [implementation conformance map](docs/projection-runtime/implementation-conformance-map.md).

## Relationship to SeqWire

Projection Runtime and SeqWire are separate research projects. Projection
Runtime does not use SeqWire, and SeqWire does not generate its canonical
artifacts. Similar systems questions were investigated at different layers, but
no public API compatibility or runtime dependency is promised.

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
