# @exclave/resource

Owns product-neutral resource handle descriptors, read-range contracts, read-range receipts, and resource failures.

It does not transport bytes, stream data, allocate buffers, read files, decode media, publish hot state, manage sessions, dispatch operations, or own product semantics.

Resource handles are for large, stable, paged, or separately transported payloads that do not belong in hot regions, warm frames, or control payloads.

Control-plane envelopes carry resource operation requests and responses, but `@exclave/control-plane` does not own resource semantics.

`RESOURCE_READ_RANGE_OPERATION_KEY` identifies the envelope operation shape, not a product operation schema.
