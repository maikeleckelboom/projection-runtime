# deck-runtime-v0

This projection-runtime fixture covers a product-shaped but product-neutral deck hot surface.

It exercises the current schema -> compiler -> hot-codec path for a latest-state mapped-fixed hot lane with transport,
timeline, loop, level, tempo, and bounded stem gain fields. It intentionally uses only currently supported fixed scalar,
fixed enum, and bounded array shapes.

The human-authored files are `README.md` and `authored-contract.json`. All other JSON artifacts are generated from the
repo root:

```sh
node scripts/write-projection-runtime-fixture.mts
```

Version-like u64 values are encoded as 16-character lowercase hexadecimal strings without a `0x` prefix. This fixture is
validated by `@exclave/conformance`; it does not prove live runtime publication, SAB lifecycle behavior, generated
bindings, or product-specific contracts.
