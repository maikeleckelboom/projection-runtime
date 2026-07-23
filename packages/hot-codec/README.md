# @exclave/hot-codec

`@exclave/hot-codec` plans deterministic hot-lane layout manifests.

It is build-time planning code. It owns hot ABI constants, hot field layout planning, reservation metadata, region
sizing, `hotLayoutVersion` derivation, and pure deterministic hot field byte codec helpers.

The field byte helpers encode and decode values against an already-planned `HotLayoutManifest`. They can produce
field-data bytes, full zero-filled fixture region bytes, complete fixture region bytes, and lowercase hex strings for
golden fixtures. `encodeHotFixtureRegion` remains the zero-filled prefix fixture helper: Block A and Block B are
zero-filled because runtime publication backing is owned elsewhere. `encodeHotCompleteFixtureRegion` deterministically
combines Block A header bytes, Block B header bytes, and hot field data bytes for test and conformance fixtures.
`decodeHotCompleteFixtureRegion` is the matching read-only decoder for deterministic complete fixture/test bytes.

Hot-codec throws and returns `ExclaveError` values with package-domain codes. Planning failures expose code
`hotCodec.layoutRejected` and a sorted `details.issues` list of `HotCodecIssue` objects with stable typed issue codes
such as `field.orderInvalid` or `shape.variableStringUnsupported`. Byte codec failures expose code
`hotCodec.byteRejected` with stable codes such as `header.magicInvalid` or `byte.valueOutOfRange`.

Package-specific names such as `HotCodecError` and `HotByteCodecError` are TypeScript aliases and helper factories, not
runtime subclasses. Callers should inspect `error.code`, `error.details.issueCount`, and `error.details.issues`.

They are not runtime readers or writers. They do not perform seqlock retry, use Atomics, manage SharedArrayBuffer
lifecycle, bind live mappings, create handles, subscribe to publications, or generate bindings.

This package intentionally does not import `@exclave/compiler`. The compiler is expected to consume hot-codec in the
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

## Complete fixture region helper

`encodeHotCompleteFixtureRegion` assembles deterministic fixture bytes as:

- Block A at bytes 0 through 71
- Block B at bytes 72 through 95
- field data starting at byte 96

The returned byte array length is exactly `manifest.totalRegionByteLength`. Before assembly it checks that the Block A
fixture input agrees with the hot layout manifest identity, layout version, field count, mutable region size, field data
origin, and region length.

This complete fixture region is still test/conformance data. It is not a live runtime region, does not prove runtime
coherence, does not perform seqlock retry, does not use Atomics, does not manage SharedArrayBuffer lifecycle, and does
not create runtime readers, writers, mappings, or handles.

`decodeHotCompleteFixtureRegion` decodes deterministic complete fixture/test bytes into Block A, Block B, and field
values. It validates the complete byte length, field-data origin, and static Block A compatibility with the manifest.
Callers may also provide expected contract and instance keys to validate the Block A identity hashes.

The decoder is read-only. It is not the hot runtime consumer, does not perform seqlock retry, does not use Atomics, does
not manage SAB lifecycle, and does not prove runtime coherence.
