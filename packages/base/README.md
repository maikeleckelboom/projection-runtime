# @seqlok/base

`@seqlok/base` is the small shared foundation used by Seqlok packages.

It owns the portable pieces that every layer can agree on without pulling in
schema, primitives, runtime composition, diagnostics, or application concerns.

## What Belongs Here

- JSON-safe payload types.
- The `SeqlokError` runtime class and portable error envelope shape.
- Error metadata and domain registry types.
- Generic helpers for turning local error registries into typed constructors.
- A lazy `invariant` helper for throwing package-owned `SeqlokError` values.
- Tiny type-level assertion helpers used by package API tests.

## What Does Not Belong Here

- Concrete error domains such as `schema.*`, `primitives.*`, `backing.*`, or
  `internal.*`.
- Numeric domain allocation tables or registry aggregation.
- Schema AST ownership.
- Shared-memory primitives.
- Core runtime planning, binding, handoff, or composition logic.
- Compatibility wrappers or aliases for older private package paths.

## Error Model

Seqlok packages should throw `SeqlokError<Code>` for known library failures.
Every `SeqlokError` can be serialized with `toJSON()` into an `ErrorEnvelope`
that is safe to log or send across a worker boundary.

Domain packages define their own registries on top of base:

```ts
import { defineErrorDomain } from "@seqlok/base";

const DEMO_ERRORS = {
  failed: {
    message: "Demo operation failed",
    meta: {
      severity: "error",
      recoverable: true,
      boundarySafe: true,
    },
  },
} as const;

const DEMO = defineErrorDomain("demo", DEMO_ERRORS);

throw DEMO.createError("failed", {
  where: "demo.run",
  reason: "input was invalid",
});
```

Base does not reserve or publish concrete Seqlok error codes. It only provides
the small vocabulary used by packages that own those codes.
