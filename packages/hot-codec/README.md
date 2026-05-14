# @seqlok/hot-codec

`@seqlok/hot-codec` plans deterministic hot-lane layout manifests for Seqlok.

It is build-time planning code. It owns hot ABI constants, hot field layout planning, reservation metadata, region
sizing, `hotLayoutVersion` derivation, and pure deterministic hot field byte codec helpers.

The byte helpers encode and decode values against an already-planned `HotLayoutManifest`. They can produce field-data
bytes, full zero-filled fixture region bytes, and lowercase hex strings for golden fixtures. These fixture bytes are not
valid runtime hot regions: Block A and Block B are zero-filled because real header/seqlock values are a runtime concern.

They are not runtime readers or writers. They do not perform seqlock retry, use Atomics, manage SharedArrayBuffer
lifecycle, bind live mappings, create handles, subscribe to publications, or generate bindings.

This package intentionally does not import `@seqlok/compiler`. The compiler is expected to consume hot-codec in the
next slice to emit hot lane manifests, so hot-codec defines a local structural planning input compatible with canonical
compiler manifests instead of depending on compiler types.

## Block A header helpers

`encodeHotBlockAHeader`, `decodeHotBlockAHeader`, and `validateHotBlockAHeader` encode static immutable Block A header
bytes for fixture generation and bind-time validation. Block A contains the region magic, ABI version, identity hashes,
semantic version, layout version, field count, and mutable region size. These helpers encode exactly 72 bytes and do not
encode Block B, the seqlock counter, baseline epoch, continuity generation, or publication sequence. They do not manage
seqlock lifecycle, allocate SharedArrayBuffer, or create valid full runtime regions by themselves. `encodeHotFixtureRegion`
remains a zero-filled fixture-region helper and is not a valid runtime hot region.
