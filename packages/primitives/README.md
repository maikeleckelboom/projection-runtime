# @seqlok/primitives

`@seqlok/primitives` is the schema-free shared-memory mechanism layer for
Seqlok packages.

It owns mechanisms, not semantics. Higher layers can use these pieces to store,
coordinate, or move shared data, but this package does not describe what that
data means.

## What Belongs Here

- Seqlock mechanics.
- Single-writer single-reader ring mechanics.
- Plane vocabulary and packing/alignment helpers.
- Small atomics helpers.
- The `primitives.*` error domain.

## What Does Not Belong Here

- Schema or authored spec structure.
- Semantic compilation.
- Layout planning policy.
- Handoff envelopes.
- Bindings.
- Command semantics.
- Telemetry schema sidecars.
- Analysis, tooling, demos, or product concepts.
- Any type that describes what data means rather than how it is stored,
  coordinated, or moved.

## Public Surface

### Primitive Errors

- `PRIMITIVES_ERRORS`
- `PRIMITIVES_DOMAIN`
- `createPrimitivesError(...)`
- Types for primitives error codes, keys, details, and domain mapping.

### Seqlock

- `createSeqPair(...)`
- `tryRead(...)`
- `publish(...)`
- `beginWrite(...)`
- `endWrite(...)`
- `SeqPair`, `ReadStatus`, `TryReadOptions`, `TryReadResult`

The writer marks a write window, mutates payload memory, commits the sequence,
and unlocks. Readers retry until they see a stable even sequence, or return a
mechanism-level failed result or timeout according to their budgets.

### Planes

- `ALL_PLANES`
- `PLANE_PACK_ORDER`
- `BYTES_PER_ELEM`
- `isPlaneKey(...)`
- `assertPlaneKey(...)`
- `roundUpTo(...)`
- `PlaneKey`, `PlaneRecord`

Planes are ABI-level storage buckets, not UI or product vocabulary.

### Atomics Helpers

- `addU32(...)`
- `loadU32(...)`
- `spinUntilEven(...)`

These helpers keep repeated low-level atomic operations small and consistently
reported through the primitives error domain.

### SWSR Ring

- `allocateSwsrRing(...)`
- `bindSwsrRingProducer(...)`
- `bindSwsrRingConsumer(...)`
- `SWSR_HEADER_WORDS`
- `SWSR_HEADER_WRITE_INDEX`
- `SWSR_HEADER_READ_INDEX`
- `SWSR_HEADER_WRITE_SEQ`
- `SWSR_HEADER_DROPPED`
- `SwsrRingBacking`, `SwsrRingLayout`, `SwsrRingProducer`,
  `SwsrRingConsumer`, `SwsrRingEncode`, `SwsrRingDecode`, `SwsrRingStats`

The ring is a fixed-width slot transport over `SharedArrayBuffer`. Typed command
contracts and bus composition belong above this layer. A ring layout must use
`capacity >= 2`; one-slot rings are rejected because the full check would leave
no slot available for transport.

## Examples

```ts
import { createSeqPair, publish, tryRead } from "@seqlok/primitives";

const u32 = new Uint32Array(new SharedArrayBuffer(16));
const pair = createSeqPair(u32, 0, 1);

publish(pair, () => {
  u32[2] = 42;
});

const result = tryRead(pair, () => u32[2]);
```

```ts
import {
  allocateSwsrRing,
  bindSwsrRingConsumer,
  bindSwsrRingProducer,
} from "@seqlok/primitives";

const backing = allocateSwsrRing({ capacity: 8, wordsPerSlot: 1 });
const producer = bindSwsrRingProducer(backing, {
  encode(value: number, dst, offset) {
    dst[offset] = value;
  },
});
const consumer = bindSwsrRingConsumer(backing, {
  decode(src, offset) {
    return src[offset] ?? 0;
  },
});

producer.enqueue(7);
consumer.drain((value) => {
  console.log(value);
});
```
