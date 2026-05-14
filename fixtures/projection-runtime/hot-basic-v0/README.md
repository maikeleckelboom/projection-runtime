# hot-basic-v0

This is the first shared golden projection-runtime fixture.

It covers the current schema -> compiler -> hot-codec layout emission path for one small, generic hot lane contract.
The fixture proves compiler and hot-codec agreement for a boring mapped-fixed hot layout, including the relationship
between the canonical manifest, `semanticVersion`, `laneManifests.hot`, and the top-level `hotLayoutVersion`.

`hotLayoutVersion` appears in two places by design:

- `resolved-contract.json` has top-level `hotLayoutVersion` as an index/header convenience field.
- `resolved-contract.json` also has `laneManifests.hot.hotLayoutVersion`, which is the detailed owning manifest value.

Those values must match. Version-like u64 values in this fixture are encoded as 16-character lowercase hexadecimal
strings without a `0x` prefix.

This fixture is validated by `@seqlok/conformance`. It does not prove runtime reads or writes, Rust compatibility,
generated bindings, Electron/SAB lifecycle behavior, product contracts, or warm/cold/resource lanes.

`hot-byte-fixture.json` adds the first deterministic TypeScript hot field byte golden for this layout. It uses the
checked-in `hot-layout-manifest.json` offsets to encode a small logical sample, records field-data bytes from byte 96
through the end of the region, records the full zero-initialized 136-byte fixture region, and verifies that decoding
those bytes returns the same sample values.

For this byte fixture, Block A and the Block B header/prefix bytes are intentionally zero-filled. This proves pure
field byte semantics only. It does not claim to initialize an authority-owned mapped region, prove Rust writer
compatibility, prove runtime seqlock read/write behavior, or cover Electron/SAB lifecycle behavior.

Regenerate derived artifacts from the repo root:

```sh
node scripts/write-projection-runtime-fixture.mjs
```
