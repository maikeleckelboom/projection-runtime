# Electron ↔ Rust Warm Authority Profile v0

Status: Implementation-authoritative for the private, non-public integration profile under
`integration/electron-rust-warm-authority`. This profile composes existing
Projection Runtime projection, session, control,
publication, and warm-codec semantics. It does not redefine them or add a public Electron transport package.

## Purpose

This profile is the first production-shaped proof that a standalone Rust authority can remain authoritative while
Electron renderer clients stop consuming, reload, disappear, and return. It uses the generated `deck-runtime-v0`
contract, the `deck.setTempoRatio` control operation, a real compiled Rust executable, and a real Electron process.

The proof establishes one concrete application boundary. It is not a generic authority framework, a product audio
engine, or a promise that every drafted Projection Runtime plane has a
production runtime.

## Process topology and ownership

```text
standalone Rust executable
  ↕ private EXCL v0 framed stdio
Electron main host
  ↕ one MessagePort per renderer client
isolated bundled preload
  ↕ narrow contextBridge API
sandboxed renderer main world
```

| Boundary | Implemented ownership |
| --- | --- |
| Rust authority | Owns the authority epoch, simulated deck timeline, tempo mutation, complete projection state, subscription state, warm publication assembly, publication sequence, and upstream credit/coalescing state. |
| Electron main | Spawns and supervises Rust, rejects epoch reuse, supplies the monotonic same-domain restart generation for each authority process in its lifetime, translates process death into authority unavailability, correlates protocol traffic, brokers per-client ports, and applies independent downstream bounds. It does not mutate or synthesize deck state. |
| Isolated preload | Owns the raw renderer port, validates host messages and publication attachment identity, decodes through the generated deck contract, applies subscription lifecycle rules, and acknowledges only applied publications. |
| Renderer | Sends typed intent, observes immutable decoded snapshots and lifecycle state, and owns presentation-local proof state only. It receives no raw IPC capability, process handle, writer, shared memory, or warm-frame bytes. |

Rust is standalone so an authority failure does not share Electron main's crash boundary or require Electron's native
module ABI. Electron main is deliberately a broker and supervisor: it may establish lifecycle facts from observed
process state, but it never becomes product authority.

## Why warm is the renderer default

The renderer consumes complete `framed-snapshot` warm publications. Deck transport, position, tempo, levels, health,
availability, and continuity are current display state; they do not require every simulated engine tick. Complete
snapshots also allow obsolete intermediate states to be replaced safely under pressure.

The hot lane remains valid for native or same-process latency-critical consumers. Direct native mapping into an
Electron renderer remains measurement-gated: it may be introduced only when measurements show that warm delivery
cannot meet a concrete latency, throughput, or copy-cost requirement. This profile uses no native mapping,
`SharedArrayBuffer`, renderer native addon, or shared-memory handle.

## Private EXCL v0 sidecar stream

Standard input and standard output carry the duplex binary protocol. Standard error carries diagnostics only. Electron
launches an application-owned executable path with `shell: false`; renderer input cannot select the path, arguments, or
environment.

Each outer frame is:

```text
u32 little-endian declared frame byte length
4 bytes ASCII "EXCL"
u16 little-endian protocol version (0)
u16 little-endian packet kind
packet payload bytes
```

The maximum total frame size is 1 MiB, including the length prefix. Both implementations decode incrementally across
arbitrary stream chunks, accept concatenated frames, reject unknown versions and packet kinds, and treat malformed,
oversized, or truncated input as an explicit protocol failure. An attacker-declared oversized length is rejected before
allocating that declared size. EOF is a clean stop only when no partial frame remains.

Packet kinds carry authority lifecycle events, existing Projection Runtime
subscribe and control envelopes, warm publication
attachments, credits, diagnostics requests, unsubscribe, and shutdown. The warm publication packet carries routing
metadata plus the canonical warm frame bytes; the outer profile does not create a second projection identity or codec.
EXCL v0 is application-private and replaceable, not canonical Projection
Runtime transport doctrine.

## Renderer channel and security boundary

Electron main creates one `MessageChannelMain` for each loaded renderer client and transfers one endpoint to preload.
The raw port never crosses `contextBridge`. The preload is bundled for Electron's sandboxed preload environment and
exposes only deck-specific lifecycle observation, subscription, `setTempoRatio`, and narrowly named proof actions.

The BrowserWindow enables sandboxing and context isolation, disables Node integration, keeps `webSecurity` enabled,
uses a restrictive Content Security Policy, denies permissions and new windows, blocks webviews and unexpected
navigation, and exposes no generic `send`, `invoke`, `on`, `postMessage`, operation-name dispatch, or Electron event
objects to the main world.

All incoming values are validated at the stdio, Electron-main, preload-port, attachment, warm-frame, generated-contract,
and proof-summary boundaries before product values are exposed.

## Bounded delivery

Both publication hops independently enforce this invariant per subscription:

```text
at most one in-flight complete publication
+ at most one replaceable pending-latest complete publication
```

Rust advances its simulated engine loop independently of publication delivery. When upstream credit is unavailable,
publication assembly retains only the newest pending complete snapshot and increments its coalescing diagnostic.
Electron main applies the same rule toward each renderer client. Preload returns downstream acknowledgement only after
attachment validation, decoding with the generated deck manifest and existing warm codec, and typed state application
bound to generated field identities. It acknowledges the applied state before invoking renderer callbacks, so a
callback that immediately disposes the subscription cannot overtake the publication acknowledgement.

Old-epoch, old-subscription, and old-sequence credits cannot release capacity for a replacement session. Control
responses use correlated messages outside publication coalescing. Closing a renderer port drops that client's in-flight
and pending state and unsubscribes it upstream.

Test-only flow control pauses preload consumption and then upstream credit long enough to prove coalescing on both hops.
The automated report requires maximum in-flight and pending counts of exactly one at both boundaries, positive upstream
and downstream coalescing counts, an observed publication gap, and a latest delivered sequence.

## Lifecycle behavior

### Startup and control

The operational-client order is:

```text
spawn Rust
→ authorityStarting(epoch A)
→ initialize the embedded generated contract and complete deck state
→ authorityReady(epoch A)
→ attach renderer client
→ subscribe request
→ epoch-establishing acknowledgement
→ initial complete warm snapshot
→ later complete snapshots
```

A separate test-only probe renderer connects during the injected readiness delay, receives the typed
`authorityNotReady` subscribe outcome from Rust, waits for readiness, and then reloads. Only after that probe closes does
the operational renderer follow the order above. The renderer's typed tempo operation crosses preload and Electron
main, is validated against epoch A and mutated only in Rust, returns a correlated typed success, and appears in a later
complete authority publication. Renderer input is never treated as authoritative state.

### Renderer reload

Reload closes the old port and subscription and creates a new renderer client, port, and explicit subscription. The
Rust process ID and authority epoch remain unchanged, while the Rust-owned sample position and publication sequence
continue advancing. The replacement renderer receives a complete current baseline; the old subscription cannot invoke
a callback in the replacement renderer.

### Authority crash, restart, and rebase

Unexpected Rust exit immediately marks the active epoch unavailable and the old subscription stale. Old-epoch
publications, controls, acknowledgements, and credits remain invalid. The proof-only restart action starts a new process
with a new, host-checked non-reused epoch. Electron's supervisor increments the same-domain continuity generation for
the replacement process; Rust commits that generation into its subscription acknowledgement and every warm frame and
resets its projection-scoped publication sequence. No subscription is resumed or retargeted automatically: the renderer
observes the replacement ready state, waits through a verified no-auto-resubscribe window, explicitly subscribes, and
accepts a new complete baseline with rebased continuity. A renderer reload within the replacement process preserves
that continuity generation and continues the Rust-owned publication sequence.

Clean shutdown closes renderer clients, requests the private shutdown command, and waits within a bound for Rust to
exit. If the graceful request cannot be delivered or does not complete, Electron escalates through bounded process
termination. The proof verifies that every observed authority process is gone after Electron exits, and failure cleanup
terminates the Electron process tree.

## Evidence boundary

Implemented and exercised through focused Rust/TypeScript tests and, for the end-to-end lifecycle, the real process
boundaries:

- Rust-owned deck timeline and `tempoRatio` mutation
- deterministic test epochs plus production nonzero epoch generation and host-lifetime non-reuse checks
- EXCL v0 incremental, bounded, binary-safe framing in Rust and TypeScript
- generated `deck-runtime-v0` Rust snapshot/identity surface and live Rust-to-TypeScript warm decoding
- bidirectional Rust/TypeScript payload and frame byte agreement through the existing `warm-payload-v0` fixture
- canonical subscribe, attachment, control, invalidation, and explicit rebase behavior
- independent upstream and downstream one-in-flight plus one-pending-latest delivery
- sandboxed Electron main → preload → renderer delivery over a real `MessagePort`
- startup, early subscribe rejection, control mutation, slow-consumer coalescing, renderer reload, authority crash,
  replacement, explicit resubscription, and clean teardown

Deliberately simulated or proof-only:

- the deck engine clock and meter values; there is no audio device or decoder
- deterministic epochs, injected readiness delay, flow pause, authority termination, reload checkpoint, and proof report
- the private Electron fixture UI and host assembly

Deliberately out of scope:

- a public Electron adapter, generic transport framework, or generic authority DSL
- a real audio authority or resource-plane surface
- hot renderer mapping, native addons, shared memory, resource transport, networking, replay, persistence, and cold reopen
- any SeqWire schema, planner, ABI, handoff, binding, runtime, or dependency

## Run and validation

From the repository root:

```powershell
pnpm typecheck:electron-rust-warm-authority
cargo test --package electron-rust-warm-authority
pnpm exec vitest run --project electron-rust-warm-authority
pnpm build:electron-rust-warm-authority
pnpm test:electron-rust-warm-authority
```

The build compiles the Rust executable and bundles Electron main, preload, and renderer into
`.cache/electron-rust-warm-authority`. The test launches the installed Electron executable in hidden integration mode,
runs the complete automated scenario, validates its single bounded result report, and checks that the Rust child
processes no longer exist.

The repository-wide gate includes the build and real Electron test:

```powershell
pnpm verify
```

Documentation-only checks are:

```powershell
node scripts/check-file-names.mts
git diff --check
```

## Next research milestone

Replace the simulated deck authority with a real audio authority behind the
proven process, control, warm-publication, and restart profile. Then add one
real resource-plane surface such as waveform access. Dekzer motivated this class
of problem, but this profile is not a Dekzer integration.

Native renderer mapping remains measurement-gated.
