# @exclave/host-contract

Product-neutral host boundary contract. Tells a client which authority-owned surface is available and which lane
descriptors belong to it.

## Ownership

`@exclave/host-contract` owns product-neutral boundary descriptors connecting session, hot, control, warm, and resource
lanes.

Warm stream descriptors advertise the publication attachment version a host transport must carry. They do not carry the
publication frames themselves.

It does not implement Electron, Tauri, Node, native bridge, IPC, transport, dispatcher, subscriptions, replay, polling,
backpressure, byte transfer, resource lifecycle, hot binding, command execution, or product semantics.

Actual adapters resolve descriptor keys into transport-specific handles later.
