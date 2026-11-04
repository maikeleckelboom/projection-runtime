# @exclave/resource

Owns product-neutral resource handle descriptors, Resource Plane v1 protocol types, and resource failures.

The owned-resource runtime transports bounded opaque bytes and manages their
queue, handle and consumer lifetime. It does not read product files, decode media,
publish hot state or own source permissions and musical semantics.

Resource handles are for large, stable, paged, or separately transported payloads that do not belong in hot regions, warm frames, or control payloads.

Control-plane envelopes carry resource operation requests and responses, but `@exclave/control-plane` does not own resource semantics.

The `resource.readRange` operation key and its control-envelope helpers (`createResourceReadRangeControlRequest`, `createResourceReadRangeControlSuccess`, etc.) remain as internal legacy/test helpers. They are not part of the public `@exclave/resource` package surface, not part of Resource Plane v1, and not advertised by host grants.

## Owned resource runtime

The package now includes `ResourceClient`, separate queue/resident `ResourceBudget`
ledgers and the incremental `ResourceFrameDecoder`. The `./node` subpath exports
the trusted `ResourceProcess` adapter for application bundlers. Existing handle,
session, failure and capability contracts remain authoritative. Mapping is not
implemented; the runtime advertises owned chunks and `canMapWindows: false`.

See the [executable profile and consumption guide](../../integration/electron-rust-resource/README.md)
for finite caps, cancellation, revocation, explicit release obligations, wire
format, security boundaries, copy accounting and measured platform limits.
