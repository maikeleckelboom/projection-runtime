# hot-exchange-v0

This fixture is the first fixture-backed TypeScript hot publication exchange proof.

It starts from the authored projection contract in `authored-contract.json`, compiles through the canonical manifest,
derives the hot layout manifest, emits complete hot fixture-region bytes, and is read in tests through the bounded
`@exclave/hot-consumer` kernel over a `SharedArrayBuffer` sequence view. The decoded snapshot is compared with the
authored logical sample values.

The fixture intentionally uses only currently supported hot-codec shapes: f32 scalar, f64 scalar, u32 scalar, fixed
f32 vector, and fixed ASCII string. All JSON files other than `README.md` and `authored-contract.json` are generated
from the repo root:

```sh
node scripts/write-projection-runtime-fixture.mts
```

This fixture now participates in generated Rust-to-TypeScript and TypeScript-to-Rust byte exchange tests. Those tests
prove artifact and byte agreement over fixture buffers; they do not prove runtime binding lifecycle, SAB lifecycle
management, host mapping/open/close behavior, native mapped-memory concurrency, or Electron integration.
