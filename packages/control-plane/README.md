# @exclave/control-plane

`@exclave/control-plane` owns JSON-safe request/response envelope shapes for
boundary control messages.

`CONTROL_ENVELOPE_VERSION` is the envelope version, not the version of product
operation schemas carried inside payloads.

## What It Does

- Defines deterministic request, success, and failure envelope shapes.
- Validates envelope structural integrity (kind, version, keys, payload safety).
- Projects `@exclave/session` binding validity failures into JSON-safe control
  failures.
- Rejects BigInt, function, symbol, undefined, Date, Map, Set, class instances,
  cyclic structures, and host objects in payloads.

## What It Does Not Do

- Transport messages.
- Dispatch operations.
- Open resources.
- Publish hot bytes.
- Manage sessions.
- Own product authority semantics.

Control plane is not the hot lane and must not carry high-frequency publication
state.
