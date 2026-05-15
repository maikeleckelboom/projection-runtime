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

`hot-block-a-fixture.json` adds deterministic Block A header bytes for this layout. It encodes the 72-byte immutable
Block A header using the contract key, instance key, semantic version, layout version, field count, and mutable region
size from the compiler output. It verifies that decoding those bytes returns the expected header fields and that
validation against the expected input succeeds. It does not encode Block B, manage seqlock lifecycle, or create a valid
full runtime region.

`hot-block-b-fixture.json` adds deterministic Block B publication-header bytes. It encodes the standalone 24-byte slice
for `seqlockCounter`, `baselineEpoch`, `continuityGeneration`, and `publicationSequence`, verifies lowercase
little-endian bytes, verifies decoding, and validates the decoded header metadata through public `@seqlok/hot-codec`
APIs. It does not perform publication lifecycle, seqlock retry, Atomics operations, SAB lifecycle management, runtime
handle creation, live mapping binding, reader creation, or writer creation. It does not create a valid coherent runtime
read by itself.

`hot-complete-fixture-region.json` adds deterministic complete fixture-region bytes for this same static fixture. It
combines the existing Block A header bytes, Block B header bytes, and hot field data bytes into one 136-byte array with
field data starting at byte 96. The decoded section records the Block A header, Block B header, and field values that
the assembled slices decode to through public `@seqlok/hot-codec` APIs.

The complete fixture region is still not a live runtime region. It does not prove runtime coherence, perform seqlock
retry, use Atomics, manage SAB lifecycle, bind mappings, create handles, or create runtime readers or writers.
`hot-byte-fixture.json` remains the zero-filled fixture-region byte artifact for pure field byte semantics, and
`encodeHotFixtureRegion` remains the zero-filled fixture helper.

Regenerate derived artifacts from the repo root:

```sh
node scripts/write-projection-runtime-fixture.mts
```
