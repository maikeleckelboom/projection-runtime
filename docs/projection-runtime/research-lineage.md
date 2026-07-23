# Research Lineage: Projection Runtime and SeqWire

Status: Active relationship record.

Projection Runtime and SeqWire are separate research projects. They share a
history of investigating explicit contracts and timing-sensitive state, but
they have different scopes, implementations, and public identities.

## Projection Runtime

Projection Runtime investigates the Electron-to-native-Rust boundary around:

- native authority and process ownership
- generated cross-language contracts
- hot, warm, cold, control, and resource paths
- bounded publication
- session and epoch identity
- renderer reload
- authority crash and replacement
- explicit resubscription and continuity recovery
- cross-language conformance

The repository contains a production-shaped executable proof. It is not a
shipped application runtime.

## SeqWire

SeqWire explores typed, coherent shared-memory state across workers,
AudioWorklets, and WebAssembly-oriented runtimes. Its TypeScript implementation
owns its authored contracts, deterministic layout, handoff, bindings, bounded
reads, grouped publication, tests, benchmarks, and Signalsmith proof.

SeqWire is an independent experimental project. It is not donor material owned
by Projection Runtime, and its future is not assigned to this repository.

## Dependency boundary

- Projection Runtime does not depend on SeqWire.
- SeqWire does not depend on Projection Runtime.
- SeqWire does not generate canonical Projection Runtime artifacts.
- No SeqWire package sits between generated Rust authority code and TypeScript
  consumers in Projection Runtime.
- Similar tests or implementation lessons may have historical overlap.
- No public API, layout, ABI, or lifecycle compatibility is promised.

The two projects may reach different designs because they investigate different
layers. SeqWire focuses on coherent state inside shared memory. Projection
Runtime covers the wider cross-process problem around authority, publication,
resource access, supervision, and recovery.

## Package namespace

Both workspaces use `@exclave/*` package identities. `@exclave` is the npm
publishing namespace. It does not make SeqWire subordinate to Projection Runtime
and it is not the public name of this architecture.

## Dekzer context

Dekzer motivated some of the systems questions as an example of a future
desktop audio application. Neither Projection Runtime nor SeqWire is a shipped
Dekzer dependency. Neither repository should claim to power Dekzer or describe a
completed integration.

## Technical comparison

SeqWire's handoff, layout, role bindings, and shared-memory counters are SeqWire
contracts. Projection Runtime's authored projection contracts, canonical
manifests, generated artifacts, authority epochs, publication continuity, and
resource contracts are Projection Runtime contracts.

Concepts can be compared and lessons can be reimplemented without creating a
repository dependency or transferring ownership of either project's identity.
