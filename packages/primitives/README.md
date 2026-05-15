# @exclave/primitives

Low-level atomic and layout helpers for Exclave runtime and compiler packages.

This package is deliberately small. It does not own projection semantics, hot
consumer read policy, lane planning, or transport contracts. Those boundaries
belong to the projection-runtime specs and the packages that implement them.

## What Belongs Here

- Small typed-array atomic helpers.
- Pure layout/alignment helpers that do not invent runtime policy.
- The `primitives.*` error domain for failures owned by these helpers.

## What Does Not Belong Here

- Projection contract meaning.
- Hot-lane consumer retry or last-good policy.
- Hot layout planning.
- Generated bindings.
- Control, publication, resource, or session plane protocols.
- Prototype transports that are not named by the current projection-runtime
  specs.

## Public Surface

### Primitive Errors

- `PRIMITIVES_ERRORS`
- `PRIMITIVES_DOMAIN`
- `createPrimitivesError(...)`
- Types for primitives error codes, keys, details, and domain mapping.

### Atomics Helpers

- `loadAtomicU32(...)`
- `addAtomicU32(...)`
- `loadAtomicU64(...)`

The hot-lane seqlock counter is a `u64` value. TypeScript code that reads it
must use `Atomics.load()` through a `BigUint64Array` view; `loadAtomicU64(...)`
is the minimal helper for that operation.

### Layout Helpers

- `ALL_PLANES`
- `PLANE_PACK_ORDER`
- `BYTES_PER_ELEM`
- `isPlaneKey(...)`
- `assertPlaneKey(...)`
- `roundUpTo(...)`
- `PlaneKey`, `PlaneRecord`

The plane constants remain low-level packing vocabulary. They are not a
projection field taxonomy and should not be expanded into one here.

## Example

```ts
import { addAtomicU32, loadAtomicU32, loadAtomicU64, roundUpTo } from "@exclave/primitives";

const u32 = new Uint32Array(new SharedArrayBuffer(Uint32Array.BYTES_PER_ELEMENT));
addAtomicU32(u32, 0, 1);
const count = loadAtomicU32(u32, 0);

const seqlock = new BigUint64Array(new SharedArrayBuffer(BigUint64Array.BYTES_PER_ELEMENT));
const counter = loadAtomicU64(seqlock, 0);

const nextOffset = roundUpTo(97, 8);
```
