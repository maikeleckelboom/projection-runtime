# @exclave/conformance

`@exclave/conformance` validates shared projection-runtime golden fixtures.

This first slice runs TypeScript-side projection-runtime fixture conformance. It loads fixtures from
`fixtures/projection-runtime`, compiles each authored contract through `@exclave/compiler`, and checks the resulting
schema -> compiler -> hot-codec golden outputs against the checked-in artifacts.

The package is intended to grow into TS/Rust cross-runtime conformance, but it does not currently prove Rust
compatibility. It also does not run runtime hot read/write tests, generate bindings, or manage fixture generation.

Fixture regeneration remains owned by:

```sh
node scripts/write-projection-runtime-fixture.mts
```

Fixture failures are machine-readable and artifact-specific. Load failures throw `ExclaveError` values with
conformance-domain codes such as `conformance.fixtureFileRejected`. `ConformanceError` is a TypeScript alias plus helper
factory, not a runtime subclass. Runtime fixture results expose stable typed `artifact`, `failureCode`, `reason`,
`expected`, and `actual` fields so that CI can report per-artifact mismatches without parsing free-form strings.

No CLI is exposed yet. Use the package tests or the programmatic API for this slice.
