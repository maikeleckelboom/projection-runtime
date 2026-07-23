# Warm Codec v1

Companion to:

- Projection Spine: Canonical Architecture Spec
- Control Plane Session Rules
- Cold Reopen Sequence

Status: Draft for ratification. Intended to become implementation-authoritative for warm-lane framed snapshot encoding.

This document defines the warm-lane codec for `framed-snapshot` publications. It specifies frame delimiting, field
payload encoding, endianness, `laneSequence` semantics, malformed-frame handling, and the canonical byte format used to
derive `warmCodecVersion`.

It does not redefine projection semantics, session validity, cold reopen sequencing, or resource-plane transport. Those
concerns belong to their companion documents.

If this document and the spine disagree on publication semantics, the spine is authoritative and this document is wrong.
If this document and the session or cold-reopen documents disagree on `authorityEpoch`, readiness, or rebind behavior,
those documents are authoritative and this document is wrong.

---

## 1. Purpose

The warm lane is the framed IPC delivery lane for publication surfaces that are observed over time but do not require
direct mapped-memory access.

This document defines the operational codec rules that the spine intentionally leaves open:

- how one warm frame is delimited on the wire
- what exact metadata is carried in every frame
- how payload field values are encoded
- how field ordering is fixed
- how variable-length shapes are encoded without delta reconstruction
- what `laneSequence` means and does not mean
- what malformed-frame behavior is legal
- how `warmCodecVersion` is derived

---

## 2. Scope and non-scope

### 2.1 In scope

This document defines:

- the canonical binary byte format of one warm frame
- outer frame delimiting
- little-endian multi-byte encoding
- payload encoding for all current field shapes
- deterministic ordering rules for fields and map entries
- `laneSequence` semantics
- `warmCodecVersion` hash coverage
- producer and consumer correctness obligations

### 2.2 Out of scope

This document does not define:

- session issuance or `authorityEpoch`
- hot SAB lifecycle
- cold reopen sequence
- resource-plane handle protocols
- transport library choice
- SQLite materialization
- future delta families or future warm codec extensions

This document applies to the current `framed-snapshot` warm codec only.

---

## 3. Protocol rules

### 3.1 Warm frames are publications, not replies

A warm frame is a publication-plane delivery unit.
It is not a control-plane reply and must not be used to smuggle request completion semantics.

### 3.2 Warm frames are not resource payload dumping grounds

If a surface wants to carry large, paged, streamed, or mapped payloads, that data belongs on the resource plane.
Warm payloads must not become a resource channel.

### 3.3 Replaceable-snapshot warm frames are complete snapshots

For the `replaceable-snapshot` family, every warm frame is a complete snapshot frame.
A consumer must never be required to hold prior warm-frame state in order to reconstruct the current publication.

Delta framing is not permitted under this family and this codec.

### 3.4 Warm codec does not carry `authorityEpoch`

`authorityEpoch` belongs to session validity, not publication payload encoding.
Warm frames do not embed `authorityEpoch` in v1.

Session replacement, invalidation, and rebind are handled by the session/control layer and companion documents.
This codec carries publication metadata, not session identity.

### 3.5 Deterministic encoding is mandatory

Given:

- the same contract
- the same projection instance
- the same publication metadata
- the same logical field values
- the same stream-level `laneSequence` configuration and value

two conforming encoders must produce byte-identical warm frames.

Implementation-defined ordering is not allowed.

`laneSequence`, when present, is stream-local transport metadata. It is only byte-deterministic relative to the same
stream state. The same logical publication may legitimately produce different `laneSequence` bytes across different
streams, on a fresh stream after reset, or when `laneSequence` is absent. That variation is not a determinism violation.
All other frame bytes are still subject to this rule.

### 3.6 Warm frames are bounded in size

Warm frames must not carry large payloads. Implementations must define and enforce a maximum legal warm frame byte size.
Frames exceeding that limit must be rejected before allocation or decode.

Large payload transport belongs on the resource plane. The maximum warm frame size is a deployment policy value, not a
codec constant, but it must be finite, documented, and enforced.

---

## 4. Logical frame model

The warm lane logically carries this frame model:

```ts
interface WarmLaneFrame {
    readonly contractKey: string
    readonly projectionInstanceKey: string
    readonly semanticVersion: u64
    readonly warmCodecVersion: u64
    readonly baselineEpoch: u32
    readonly continuityGeneration: u32
    readonly publicationSequence: u64
    readonly laneSequence?: u32
    readonly payload: Uint8Array
}
```

This logical model is already established by the spine.
This document defines its exact binary wire format.

---

## 5. Endianness and scalar encoding

All multi-byte integers and floating-point values on the warm lane are little-endian.

This includes:

* all length prefixes
* all scalar field values wider than 1 byte
* enum discriminants wider than 1 byte
* `semanticVersion`
* `warmCodecVersion`
* `baselineEpoch`
* `continuityGeneration`
* `publicationSequence`
* optional `laneSequence`

Scalar widths are the same as the canonical type taxonomy:

* `bool`, `u8`, `i8` → 1 byte
* `u16`, `i16` → 2 bytes
* `u32`, `i32`, `f32` → 4 bytes
* `u64`, `i64`, `f64` → 8 bytes

`bool` is encoded as one byte:

* `0x00` = false
* `0x01` = true

Any other boolean byte value is malformed.

Floating-point values use raw IEEE-754 little-endian encoding.
If a shape permits `nanSentinel`, NaN bit patterns are preserved as encoded.
If a shape does not permit `nanSentinel`, producers must not emit NaN for that field.

---

## 6. Canonical outer frame byte format

One warm frame is encoded as exactly:

```text
[u32 frameByteLength]
[u32 contractKeyByteLength]
[contractKey UTF-8 bytes]
[u32 projectionInstanceKeyByteLength]
[projectionInstanceKey UTF-8 bytes]
[u64 semanticVersion]
[u64 warmCodecVersion]
[u32 baselineEpoch]
[u32 continuityGeneration]
[u64 publicationSequence]
[u8  laneSequencePresent]
[if laneSequencePresent == 1: u32 laneSequence]
[u32 payloadByteLength]
[payload bytes]
```

All numeric fields above are little-endian.

### 6.1 `frameByteLength`

`frameByteLength` is the number of bytes following the `frameByteLength` field to the end of the frame.

It does not include the 4 bytes of `frameByteLength` itself.

### 6.2 `contractKeyByteLength`

Length in bytes of the UTF-8 `contractKey`.

### 6.3 `projectionInstanceKeyByteLength`

Length in bytes of the UTF-8 `projectionInstanceKey`.

### 6.4 `laneSequencePresent`

Legal values:

* `0x00` → no `laneSequence` field is present
* `0x01` → `laneSequence` field is present

Any other value is malformed.

### 6.5 `payloadByteLength`

The number of bytes in `payload`.

A consumer must verify:

* `payloadByteLength` matches the actual payload section length
* `frameByteLength` matches the actual total bytes following the prefix

A mismatch is a malformed frame.

---

## 7. Message-boundary and byte-stream rule

The canonical warm codec frame always includes the leading `u32 frameByteLength`.

This is true even if the transport already preserves message boundaries.

If the transport is message-boundary preserving, one message carries exactly one canonical frame blob.
If the transport is a byte stream, the receiver uses `frameByteLength` to delimit frames.

The canonical frame format is not transport-optional.
Message boundaries are infrastructure convenience, not codec identity.

---

## 8. Payload ordering rule

The payload is the concatenation of all field value encodings in canonical manifest order.

That order is:

* lexicographic by `dotPath`
* using UTF-8 byte order
* identical to `manifest.fields`

No field names appear in the payload.
No field count appears in the payload.
The manifest and compiled decoder already know the field list and shapes.

A consumer decodes by walking the manifest field list in order.

---

## 9. Payload encoding by field shape

### 9.1 FixedScalar

Encoded as the raw scalar value bytes for the field type.

Examples:

* `u32` → 4 bytes LE
* `f64` → 8 bytes LE
* `bool` → 1 byte (`0x00` or `0x01`)

No additional prefix.

### 9.2 FixedEnum

Encoded as the discriminant in the declared storage width:

* `u8` → 1 byte
* `u16` → 2 bytes LE
* `u32` → 4 bytes LE

The encoded discriminant is the zero-based index into the declared variant list.

A discriminant outside the declared variant range is malformed.

### 9.3 FixedVector

Encoded as the contiguous sequence of element values in index order.

No length prefix is present because the vector length is fixed by shape.

For `FixedVector(elementType, length)`, payload bytes are:

```text
element[0]
element[1]
...
element[length - 1]
```

### 9.4 BoundedArray

Encoded as:

```text
[u32 liveCount]
[element[0]]
[element[1]]
...
[element[liveCount - 1]]
```

Rules:

* `0 <= liveCount <= maxLength`
* only the live prefix is encoded
* no reserved tail is encoded on the warm lane
* the consumer must reject `liveCount > maxLength`

`BoundedArray` is compact on the warm lane. It is not padded to hot-lane reservation size.

### 9.5 BoundedMap

Encoded as:

```text
[u32 liveCount]
[entry[0]]
[entry[1]]
...
[entry[liveCount - 1]]
```

where each entry is:

```text
[keyByteLength bytes fixed-ascii key, zero-padded on the right]
[value encoding]
```

Rules:

* `0 <= liveCount <= maxEntries`
* keys are encoded as exactly `keyByteLength` bytes
* the logical key must not contain `0x00` bytes; right-padding with `0x00` is padding only, not content
* encoded key bytes in the non-padding portion must be 7-bit ASCII; any byte > `0x7F` is malformed
* keys shorter than `keyByteLength` are right-padded with `0x00`
* keys longer than `keyByteLength` are invalid
* live entries must be in strictly increasing order by full encoded key bytes; duplicate keys are malformed
* no reserved tail entries are encoded on the warm lane
* the consumer must reject `liveCount > maxEntries`
* the consumer must reject entries that are not strictly increasing in key order

`value encoding` is the encoding of the declared fixed value shape:

* `FixedScalar`
* `FixedEnum`
* `FixedVector`

No intra-entry alignment padding exists on the warm lane.

### 9.6 VariableMap

Encoded as:

```text
[u32 liveCount]
[entry[0]]
[entry[1]]
...
[entry[liveCount - 1]]
```

where each entry is:

```text
[u32 keyByteLength]
[key UTF-8 bytes]
[value encoding]
```

Rules:

* `liveCount` is the number of entries present in this complete snapshot
* live entries must be in strictly increasing order by UTF-8 key bytes; duplicate keys are malformed
* the consumer must reject entries that are not strictly increasing in key order
* `value encoding` is recursive by the declared `valueShape`

In v1 warm codec, `VariableMap` keys are UTF-8 strings.
This is a codec rule, not a hot-lane shape rule.

### 9.7 FixedStringEncoded

Encoded as:

```text
[u16 liveByteLength]
[liveByteLength bytes in declared encoding]
```

Rules:

* `0 <= liveByteLength <= byteLength`
* `encoding = "utf8"` → bytes must be valid UTF-8
* `encoding = "ascii"` → bytes must be 7-bit ASCII
* the consumer must reject `liveByteLength > byteLength`

No trailing padding bytes are encoded on the warm lane.

### 9.8 VariableString

Encoded as:

```text
[u32 liveByteLength]
[liveByteLength UTF-8 bytes]
```

Rules:

* bytes must be valid UTF-8
* no null terminator is present
* no maximum length is implied by this codec beyond frame-size bounds

---

## 10. `laneSequence` semantics

`laneSequence` is optional transport-level ordering metadata.

It is not:

* a substitute for `publicationSequence`
* a continuity marker
* a baseline marker
* session identity

### 10.1 Scope

If present, `laneSequence` is scoped to one warm subscription stream.

It is not global across:

* all projection instances
* all consumers
* all authorities
* all sessions

### 10.2 Meaning

If present, `laneSequence` increments by 1 for each warm frame emitted on that subscription stream.

Recommended first value:

* `0`

### 10.3 Reset conditions

If present, `laneSequence` resets when:

* a new subscription stream is established
* a replacement authority session creates a new stream
* any stream-level replacement occurs

### 10.4 Presence consistency

For a given subscription stream, `laneSequence` presence must be consistent:

* either present on every frame in the stream
* or absent on every frame in the stream

It must not toggle mid-stream. A mid-stream presence toggle is a stream-level invariant violation, not a recoverable
per-frame error. See section 15.2.

### 10.5 Consumer meaning

A `laneSequence` gap is transport-local information only.

A consumer:

* may record or report the gap
* may treat it as evidence of transport-local frame loss or suppression
* must not derive continuity reset from it
* must not rebase from it
* must not ignore the authoritative `baselineEpoch`, `continuityGeneration`, and `publicationSequence` in favor of it

For `replaceable-snapshot`, a `laneSequence` gap does not make the latest complete frame invalid.

---

## 11. `warmCodecVersion` derivation

`warmCodecVersion` is derived, not hand-authored.

It is:

```text
first_8_bytes_big_endian(SHA-256(canonical_byte_format))
interpreted as u64
```

This big-endian interpretation applies only to deriving the numeric `warmCodecVersion` from the hash digest. Once
derived, `warmCodecVersion` is encoded on the warm lane as a `u64` in little-endian form per section 5.

`warmCodecVersion` must change whenever the warm frame format or payload encoding rules change in a way that affects
compatibility.

---

## 12. Canonical byte format for `warmCodecVersion`

The canonical byte format is the input to the SHA-256 hash defined in section 11. The tags below describe the hash input
encoding, not the on-wire frame encoding. On-wire encoding is defined in sections 5 and 6.

The canonical byte format for `warmCodecVersion` is:

```text
[codec_name]                       "framed-snapshot" UTF-8 bytes
[0x00]

[endianness_tag]                   "little-endian"
[0x00]

[frame_prefix_tag]                 "frame-length:u32-le"
[0x00]

[contract_key_tag]                 "contract-key:u32-len-utf8"
[0x00]

[instance_key_tag]                 "projection-instance-key:u32-len-utf8"
[0x00]

[semantic_version_tag]             "semantic-version:u64-le"
[0x00]

[warm_codec_version_tag]           "warm-codec-version:u64-le"
[0x00]

[baseline_epoch_tag]               "baseline-epoch:u32-le"
[0x00]

[continuity_generation_tag]        "continuity-generation:u32-le"
[0x00]

[publication_sequence_tag]         "publication-sequence:u64-le"
[0x00]

[lane_sequence_tag]                "lane-sequence:optional-u32-le"
[0x00]

[payload_length_tag]               "payload-length:u32-le"
[0x00]

[variable_string_tag]              "variable-string:u32-len-utf8"
[0x00]

[variable_map_key_tag]             "variable-map-key:u32-len-utf8"
[0x00]

[field_count]                      u32 LE

for each field in lexicographic dotPath order:
  [dotPath UTF-8 bytes]
  [0x00]
  [fieldId]                        u32 LE
  [shapeEncoding]                  canonical shape encoding from the spine
```

Notes:

* field offsets are not part of `warmCodecVersion`
* the full ordered field list is part of `warmCodecVersion`
* shape encodings are part of `warmCodecVersion`
* any normative change to the framing tags or payload rules above changes the derived hash automatically

There is no separately maintained manual warm codec version number.

---

## 13. What `warmCodecVersion` covers

`warmCodecVersion` must change for any change to warm-lane compatibility, including:

* changing outer frame field order
* changing any length-prefix width
* changing endianness
* changing `laneSequence` presence semantics
* changing how any field shape is encoded on the warm lane
* adding, removing, or renaming any field
* changing any field shape

`warmCodecVersion` does not change merely because:

* hot lane layout changes
* cold materialization changes
* a new lane is added elsewhere
* session mechanics change without altering warm frame encoding

---

## 14. Producer obligations

A warm producer must:

* emit every conceptual metadata field required by the spine
* emit complete payload snapshots for `replaceable-snapshot`
* encode fields in canonical manifest order
* sort `BoundedMap` live entries in strictly increasing encoded key order
* sort `VariableMap` live entries in strictly increasing UTF-8 key order
* validate counts against declared bounds before emit
* validate map key uniqueness before emit
* emit one canonical frame blob per publication
* derive `warmCodecVersion` from the canonical hash input, not from a hand-maintained field

A producer must not:

* emit delta frames under this family
* omit metadata fields
* reorder fields arbitrarily
* emit duplicate map keys
* stuff resource-plane bodies into payload fields

---

## 15. Consumer malformed-frame and stream-incompatibility handling

Malformed frame conditions split into two categories. They are not the same and must not be handled the same way.

### 15.1 Recoverable per-frame errors

These are structural errors in a single frame that do not necessarily invalidate the subscription stream itself.

Recoverable per-frame errors include:

* malformed `frameByteLength` or `payloadByteLength` (length mismatch)
* malformed `bool` byte (not `0x00` or `0x01`)
* malformed `FixedEnum` discriminant (out of declared variant range)
* `BoundedArray` or `BoundedMap` `liveCount` exceeding `maxLength` or `maxEntries`
* unsorted or duplicate map entries
* `FixedStringEncoded` `liveByteLength` exceeding `byteLength`
* invalid UTF-8 in a UTF-8-declared field

On a recoverable per-frame error:

* the frame must be rejected as invalid
* the consumer must not expose partially decoded state from that frame
* the consumer may continue waiting for later valid frames on the same stream, according to higher-layer policy
* a recoverable error must not by itself cause stream teardown

### 15.2 Fatal stream-incompatibility conditions

These are conditions that mean the consumer and producer do not agree on what this stream is, or a stream-level
invariant has been violated. Continuing on the same stream is wrong.

Fatal stream-incompatibility conditions include:

* `contractKey` does not match the subscribed contract
* `projectionInstanceKey` does not match the subscribed projection instance
* `semanticVersion` does not match the consumer's compiled manifest version
* `warmCodecVersion` does not match the consumer's compiled codec version
* `laneSequence` presence toggles mid-stream (present on one frame, absent on another, within the same subscription
  stream)

On a fatal stream-incompatibility condition:

* the stream must be poisoned immediately
* the consumer must not continue decoding frames on the poisoned stream
* the consumer must surface the incompatibility to the higher layer
* recovery requires higher-layer resubscription or stream replacement, not frame-level retry

A fatal stream-incompatibility condition is not a bad frame. It is a broken stream. The distinction matters for how the
higher layer responds.

---

## 16. Relationship to session replacement and cold reopen

This codec does not carry `authorityEpoch`.

Warm-session replacement and rebind are handled by the session layer.
Cold reopen republishes fresh warm frames after readiness and rebinding rules are satisfied.

A consumer uses:

* session events for session replacement and rebind timing
* warm frames for publication state

Those concerns must not be collapsed.

---

## 17. Conformance requirements

At minimum, warm conformance tests must prove:

* the same manifest yields the same `warmCodecVersion` in Rust and TS
* the same logical publication, with the same stream-level `laneSequence` configuration and value, yields byte-identical
  warm frames in Rust and TS
* malformed length prefixes are rejected as recoverable per-frame errors
* malformed enum tags are rejected as recoverable per-frame errors
* malformed boolean values are rejected as recoverable per-frame errors
* `BoundedArray` overflows are rejected as recoverable per-frame errors
* `BoundedMap` overflow, unsorted entries, duplicate keys, or non-ASCII key bytes are rejected as recoverable per-frame
  errors
* `VariableMap` unsorted entries or duplicate keys are rejected as recoverable per-frame errors
* `contractKey`, `projectionInstanceKey`, `semanticVersion`, or `warmCodecVersion` mismatches poison the stream as fatal
  incompatibilities
* `laneSequence` presence toggling within one stream is treated as a fatal stream-incompatibility condition
* valid complete frames decode without prior-frame state
* frames exceeding the deployment-defined maximum warm frame size are rejected before allocation or decode

These tests belong to the shared conformance harness, not package-local convention.

---

## 18. Rejected alternatives

### Rejected: delta framing under `replaceable-snapshot`

This family requires every warm frame to be a complete snapshot.

### Rejected: transport-defined framing with no canonical length prefix

The codec must define its own frame boundary, even when the transport already preserves messages.

### Rejected: manual `warmCodecVersion` bumping

`warmCodecVersion` is derived from canonical hash coverage.

### Rejected: treating `laneSequence` as continuity metadata

`laneSequence` is transport-local ordering only.

### Rejected: embedding `authorityEpoch` in warm frames by default

Session validity and publication encoding are separate concerns.

### Rejected: implementation-defined field order in payload

Payload order is canonical manifest order.

### Rejected: implementation-defined map entry order

Map entry order must be deterministic and strictly increasing.

### Rejected: allowing duplicate map keys

Duplicate keys are malformed regardless of sort order. Sorted is necessary but not sufficient.

### Rejected: treating all malformed-frame conditions as stream-fatal

Per-frame structural errors are recoverable. Only contract identity, version, and stream-level invariant
violations are stream-fatal. Conflating these produces unnecessary stream churn on transient decode errors.

### Rejected: treating stream-incompatibility conditions as recoverable per-frame errors

A `warmCodecVersion` mismatch or `contractKey` mismatch means the consumer and producer are not speaking the same
protocol on this stream. Frame-level retry cannot fix that.

### Rejected: stuffing resource-plane bodies into warm payloads

Large, paged, streamed, or mapped payloads belong on the resource plane, not in warm publication frames.

### Rejected: unbounded warm frame size

The resource plane exists precisely to handle large payloads. Warm frames must be bounded in size, and oversized
frames must be rejected before allocation or decode.
