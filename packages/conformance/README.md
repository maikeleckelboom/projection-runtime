# @seqlok/conformance

`@seqlok/conformance` validates shared projection-runtime golden fixtures.

This first slice runs TypeScript-side projection-runtime fixture conformance. It loads fixtures from
`fixtures/projection-runtime`, compiles each authored contract through `@seqlok/compiler`, and checks the resulting
schema -> compiler -> hot-codec golden outputs against the checked-in artifacts.

The package is intended to grow into TS/Rust cross-runtime conformance, but it does not currently prove Rust
compatibility. It also does not run runtime hot read/write tests, generate bindings, or manage fixture generation.

Fixture regeneration remains owned by:

```sh
node scripts/write-projection-runtime-fixture.mjs
```

No CLI is exposed yet. Use the package tests or the programmatic API for this slice.
