# @exclave/resource

Owns product-neutral resource handle descriptors, Resource Plane v1 protocol types, and resource failures.

It does not transport bytes, stream data, allocate buffers, read files, decode media, publish hot state, manage sessions, dispatch operations, or own product semantics.

Resource handles are for large, stable, paged, or separately transported payloads that do not belong in hot regions, warm frames, or control payloads.

Control-plane envelopes carry resource operation requests and responses, but `@exclave/control-plane` does not own resource semantics.

The `resource.readRange` operation key and its control-envelope helpers (`createResourceReadRangeControlRequest`, `createResourceReadRangeControlSuccess`, etc.) remain as internal legacy/test helpers. They are not part of the public `@exclave/resource` package surface, not part of Resource Plane v1, and not advertised by host grants.
