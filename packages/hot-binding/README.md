# @exclave/hot-binding

`@exclave/hot-binding` v0 owns only validation and binding for already-opened hot region bytes.

It accepts `Uint8Array` regions backed by `SharedArrayBuffer`, validates the caller-provided ABI counter offsets,
and returns `BigUint64Array` views for the hot seqlock and publication sequence counters.

This package does not allocate shared memory, open mappings, own lifecycle or session state, run read attempts, publish
write transitions, inspect generated field shapes, validate snapshot values, or check contract/layout/ABI versions.
