# @exclave/warm

`@exclave/warm` owns product-neutral warm frame envelope shapes for observable non-audio-critical state.

Warm is for progress, invalidation, availability, and projection-change notifications. It is not the hot lane, not control request/reply, and not resource byte transport.

## What It Owns

- Warm stream keys and warm frame keys.
- Warm frame sequence shape.
- Warm frame envelope shape.
- Warm frame payload JSON-safety.
- Warm invalidation/change frame conventions.
- Deterministic validation for warm envelopes.
- Session/authority owner wire projection for warm streams.

## What It Does Not Own

- Transport, subscriptions runtime, dispatcher, persistence, polling, backpressure.
- Resource handles, resource lifecycle, byte payloads.
- Hot publication, control request/reply, product semantics.
- Electron, Tauri, Node, or native bridge.
