# @exclave/conformance

`@exclave/conformance` validates shared projection-runtime golden fixtures.

The package runtime loads fixtures from `fixtures/projection-runtime`, compiles each authored contract through
`@exclave/compiler`, and checks the resulting schema -> compiler -> codec outputs against checked-in artifacts. Its
tests also exercise generated TypeScript readers and writers, generated Rust hot writers and readers, repeated Rust hot
publication, and Rust/TypeScript hot and warm byte agreement.

The hot conformance suite composes generated Rust-written bytes with a generated TypeScript reader's bounded
writer-active and torn-read fallback. It proves that a Rust-authored last-good snapshot is retained and that malformed
writer-active candidates are not decoded or exposed.

This remains fixture and modeled-runtime conformance. It does not implement or prove a native shared mapping, an
Electron adapter, authority-owned allocation, a hot-handle registry, physical revocation, remap/rebase behavior, or a
production authority/session runtime.

Fixture regeneration remains owned by:

```sh
node scripts/write-projection-runtime-fixture.mts
```

Fixture failures are machine-readable and artifact-specific. Load failures throw `ExclaveError` values with
conformance-domain codes such as `conformance.fixtureFileRejected`. `ConformanceError` is a TypeScript alias plus helper
factory, not a runtime subclass. Runtime fixture results expose stable typed `artifact`, `failureCode`, `reason`,
`expected`, and `actual` fields so that CI can report per-artifact mismatches without parsing free-form strings.

No CLI is exposed. Use the package tests or the programmatic fixture API.
