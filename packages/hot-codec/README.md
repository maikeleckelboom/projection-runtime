# @seqlok/hot-codec

`@seqlok/hot-codec` plans deterministic hot-lane layout manifests for Seqlok.

It is build-time planning code. It owns hot ABI constants, hot field layout planning, reservation metadata, region
sizing, `hotLayoutVersion` derivation, and pure deterministic hot field byte codec helpers.

The field byte helpers encode and decode values against an already-planned `HotLayoutManifest`. They can produce
field-data bytes, full zero-filled fixture region bytes, and lowercase hex strings for golden fixtures. These fixture
region bytes are not valid runtime hot regions: Block A and Block B are zero-filled because runtime publication backing
is owned elsewhere.

Hot-codec throws and returns `SeqlokError` values with package-domain codes. Planning failures expose code
`hotCodec.layoutRejected` and a sorted `details.issues` list of `HotCodecIssue` objects with stable typed issue codes
such as `field.orderInvalid` or `shape.variableStringUnsupported`. Byte codec failures expose code
`hotCodec.byteRejected` with stable codes such as `header.magicInvalid` or `byte.valueOutOfRange`.

Package-specific names such as `HotCodecError` and `HotByteCodecError` are TypeScript aliases and helper factories, not
runtime subclasses. Callers should inspect `error.code`, `error.details.issueCount`, and `error.details.issues`.

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

## Block B header helpers

`encodeHotBlockBHeader`, `decodeHotBlockBHeader`, and `validateHotBlockBHeader` encode static publication-header bytes
for fixture and conformance use. Block B contains `seqlockCounter`, `baselineEpoch`, `continuityGeneration`, and
`publicationSequence` as a standalone 24-byte little-endian slice. These helpers do not encode Block A or field data.

The Block B helpers do not perform publication lifecycle, seqlock retry, Atomics operations, SharedArrayBuffer lifecycle
management, runtime handle creation, live mapping binding, reader creation, or writer creation. They do not interpret
odd/even seqlock state as runtime validity and do not create valid coherent runtime reads by themselves.
