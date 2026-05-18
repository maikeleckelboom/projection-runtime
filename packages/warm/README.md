# @exclave/warm

`@exclave/warm` owns product-neutral warm frame envelope shapes for observable non-audio-critical state and the first
Warm Codec v1 binary framed-snapshot outer codec subset.

Warm is for progress, invalidation, availability, and projection-change notifications. It is not the hot lane, not control request/reply, and not resource byte transport.

## What It Owns

### Legacy JSON Envelope Support

- Warm stream keys and warm frame keys.
- Warm frame sequence shape.
- Warm frame envelope shape.
- Warm frame payload JSON-safety.
- Warm invalidation/change frame conventions.
- Deterministic validation for warm envelopes.
- Session/authority owner wire projection for warm streams.

These JSON-safe helpers are legacy envelope support. They are not Warm Codec v1 framed-snapshot bytes.

### Warm Codec v1 Binary Subset

- `WarmLaneFrame` logical model for complete framed-snapshot publications.
- Deterministic little-endian binary outer frame encode/decode.
- `frameByteLength`, UTF-8 identity fields, semantic and warm codec versions, baseline/continuity metadata,
  `publicationSequence`, optional `laneSequence`, and payload length.
- Typed decode and encode failures for malformed lengths, invalid `laneSequencePresent`, invalid UTF-8, oversized
  frames, and invalid payload input.
- Maximum frame byte-size enforcement before decode.
- Payload bytes as already-encoded snapshot payload for this slice.

## What It Does Not Own

- Transport, subscriptions runtime, dispatcher, persistence, polling, backpressure.
- Resource handles, resource lifecycle, byte payloads.
- Hot publication, control request/reply, product semantics.
- Electron, Tauri, Node, or native bridge.
- Publication subscribe/ack/rebind lifecycle.
- Full manifest-derived field-value warm payload encoding.
