# Bounded Rust / Electron resource path

This is the executable Mission A adapter and qualification fixture. It uses the
real `resource-runtime` registry, `@exclave/resource` consumer and Node process
adapter. It does not contain an audio engine, waveform codec or GPU renderer.

The [delivery evidence](../../docs/evidence/resource-plane/delivery.md) records
the measured candidate, canonical gates, independent review and qualification limits.

```powershell
pnpm build:electron-rust-resource
pnpm test:electron-rust-resource
pnpm measure:resource
```

The build uses optimized Rust and bundled/minified Electron scripts, colocates
the native binary, and records a new build directory without deleting old
evidence. Tests launch pinned Electron 43.1.1 with sandboxing, context isolation,
Node disabled in renderer/workers, restrictive CSP and no development server.
This is an application bundle executed with the pinned Electron distribution,
not an installer or signed release. Non-Windows platforms remain unqualified.

## Physical protocol

The child has three inherited pipes: stdin carries bounded control envelopes,
stdout carries bounded replies/invalidation, and **stderr carries only binary
resource frames**. The dedicated stderr role is private to this profile; native
logging/panic text must not share it. Unexpected text fails closed. Products
must route diagnostics to a separate bounded sink. No listening socket or
renderer filesystem grant is introduced.

Control reuses `@exclave/control-plane` envelope version 1 and canonical decimal
u64 identities. Negotiation requires resource profile version 1; mapping is
explicitly unsupported. Metadata lines are at most 4096 bytes. Host admission
allows 24 ordinary and 32 total outstanding operations, preserving eight urgent
slots. Bytes already written cannot be reordered. Bulk never occupies that pipe.
Up to eight transfer receipts and two connection cleanups may wait in a separate
bounded metadata admission queue. They wake before caller continuations refill
the shared control slots and retain native credit until acknowledgement. Closing
one consumer under transient control saturation does not kill the shared authority.

Each bulk frame is a 48-byte little-endian header followed by 1–262144 bytes:

| Offset | Meaning |
| --- | --- |
| 0 | `EXRB` magic, four bytes |
| 4, 6 | u16 profile version 1, u16 packet kind 1 |
| 8, 12 | u32 body length, u32 EOF flag (0 or 1) |
| 16, 24 | u64 transfer ID, authority epoch |
| 32, 40 | u64 resource offset, immutable resource version |

The host validates the header against its admitted request **before** allocating
one owned body. It copies each incoming byte once into that allocation; arbitrary
fragmentation adds no repeated-prefix copying. Rust writes the header and an
immutable backing slice with `write_all`; it does not repack the body. Exact
range semantics match the existing resource contract: a request beyond the end
fails; an exact final range sets EOF. Empty resources open but admit no read.

## Ownership and caps

The frozen [acceptance record](../../docs/evidence/resource-plane/baseline-acceptance.json)
defines this profile's limits. Two connections each have 16 handles and four
transfers / 1 MiB, with eight transfers / 2 MiB globally. Background work can
occupy at most two transfers per client / four globally, preserving visible
admission capacity. The native writer serves at most three visible queued chunks
before a waiting background chunk. A frame already being written is indivisible.
`replaceKey` and `AbortSignal` obsolete one consumer's intent; accepted bytes are
still accounted until their result is discarded. No result is silently coalesced.

Native immutable backing has an 8 MiB / 32-resource admission cap. A and B share
one registered allocation while retaining separate handles and reservations.
Revocation fences adoption but keeps backing resident until all pinned transfers
retire. `written(transfer)` consumes the writer's owner; an unrelated authority's
transfer cannot complete a reservation. Native transfer credits retire only
after writer completion **and** host receipt. Duplicate receipts return no capacity.

The broker separately reserves its main-to-consumer queue before reading and
retains that credit until consumer adoption/discard or port teardown. Each
`ResourceClient` admits at most 2 MiB / 16 owned allocations before requesting
bytes: transfer credit return cannot expand its cache. With two clients this is
4 MiB globally. `release()` ends the caller's resident ownership obligation;
the caller must drop all aliases. JavaScript cannot prevent a caller retaining
an alias after release. `ResourceProcess` is a lower-level trusted adapter;
direct callers must provide their own resident owner, as the broker/client do.

Normal handle close forbids new reads but does not invalidate accepted reads or
already-owned results. Revocation/authority loss makes their `valid()` false,
without erasing bytes. Cancellation is not source revocation. A renderer reload
closes only its connection; a native failure invalidates the whole old session.
No automatic resubscription or claim of uninterrupted audio is made.

## Copies and consumer API

```ts
import { ResourceClient } from "@exclave/resource";

const resources = new ResourceClient(message => privatePort.postMessage(message));
privatePort.onmessage = event => resources.receive(event.data);
privatePort.start();
const handle = await resources.open(authorizedOpaqueKey);
const chunk = await resources.read(handle, offset, boundedLength, {
  signal: intentAbort.signal,
  priority: "visible",
  replaceKey: "view-a",
});
await resources.close(handle);
try {
  if (chunk.valid()) consumeProductBytes(chunk.payload);
} finally {
  chunk.release();
}
```

For exclusive worker transfer, send `chunk.payload.buffer` in a DOM transfer
list and release only when the receiving owner has adopted its own budget.
The example proves sender detachment and worker SHA-256 equality. Native backing
is never detached. `MessagePortMain` accepts port transfers, not ArrayBuffer
transfers, so main-to-renderer delivery is a structured clone. The preload
transfers only the private port across worlds; payloads do not cross contextBridge.
These are measured ownership boundaries, **not an end-to-end zero-copy claim**.
Kernel/Chromium internal copies are not counted as precisely known application
copies. See Electron's [MessagePortMain API](https://www.electronjs.org/docs/latest/api/message-port-main)
and [message-port guide](https://www.electronjs.org/docs/latest/tutorial/message-ports).

`@exclave/resource/node` exports `ResourceProcess`; like the existing packages,
its ESM output targets an application bundler. The checked build demonstrates
esbuild consumption. Product native code can compose `ResourceAuthority` and
`wire::write_transfer` with its existing service rather than launching another
audio authority. Its adapter must supply authorized immutable bytes, translate
typed failures, emit revocation and retain the same session epoch. The extracted
`authority-session` crate is the existing epoch implementation, not a new issuer.

The fixture's `fixture.control`, `fixture.revoke`, `resourceProof` checkpoints,
deterministic content and measurement-only baseline process are test adapters.
They are not product capabilities or public consumer operations. Port attachment
is main-owned and sender/frame-validated; renderer-supplied connection IDs are
never used. Do not copy the fixture control bridge into a production preload.

## What the checks prove

Rust tests cover shared backing, independent cancellation, normal close,
revocation, quotas, foreign completion, exact bytes and partial writer failure.
TypeScript tests cover incremental framing, malformed/truncated input, exact
ledger settlement, failed admission, invalid replies and cancellation races.
Real process tests cover native bytes, separate control under stalled bulk,
quotas, stale authority, death and retryable lifecycle operations.

The Electron proof verifies actual sandboxed delivery, worker SHA-256/detachment,
A/B cancellation, abrupt reload with two paused in-flight reads, native death
while a consumer retains bytes, explicit new-epoch recovery and source revocation.
It reports both authority PIDs and verifies neither survives teardown.

The paired measurement uses identical pre-serialized fixture bytes with
alternating order. It records admission, native fixture application and reply
observation separately with an explicit clock-calibration interval. Eight
retention rounds exercise completion/cancellation and report exact owner counts
plus observed host/native process memory. These are upstream transport results;
product read-to-paint latency, audio deadlines, WebGPU and Stems remain unqualified.
