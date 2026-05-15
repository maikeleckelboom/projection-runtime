# Exclave Hot Lane Codec and Layout Spec

Companion to:

- Exclave Projection Spine: Canonical Architecture Spec
- Hot Lane Consumer Runtime
- Hot SAB Lifecycle
- Compiler and Conformance Layout

Status: Draft for ratification as part of the hot-lane implementation bundle. This document, Hot Lane Consumer Runtime,
and Hot SAB Lifecycle are jointly ratified or jointly not ratified. All three must reach sign-off together before the
status of any one is promoted to ratified. The bytes defined here are not meaningfully ratified until the consumer-side
read algorithm (Hot Lane Consumer Runtime) and the mapping lifecycle (Hot SAB Lifecycle) are also ratified.

This document is the operational companion for the hot lane. It specifies the planner, the hot layout manifest, the
fixed mapped layout rules, bind-time validation, generated binding expectations, and the cross-language conformance
corpus for the hot lane. It does not redefine doctrine.

**Binary layout authority**: this document and the spine are co-authoritative on Block A and Block B binary layout. The
spine section 8.6 table owns the architectural declaration of hot-region structure; this document section 2 is the
implementation-authoritative expansion with exact offsets, field widths, and planner constants. If a disagreement ever
appears between the two Block A tables, it is a **specification bug** and both documents must be reconciled before
implementation proceeds. The companion is not silently subordinate to a stale spine table; a stale spine table is wrong
and must be corrected. If you observe any discrepancy, stop and flag it before writing implementation code.

---

## Contents

1. Scope and Relationship to Spine
2. Fixed Layout Constants
3. hotLayoutVersion Hash Specification
4. Planner Inputs and Preconditions
5. Alignment and Byte-Span Formulas
6. Planner Algorithm
7. HotLayoutManifest: Planner Output Type
8. Reservation Encoding Details
9. Bind-Time Validation Sequence
10. Generated Binding Expectations
11. Cross-Language Conformance Test Corpus

---

## 1. Scope and Relationship to Spine

The spine defines:

- The hot-lane region layout (section 8.6): Block A (72 bytes immutable) + Block B (seqlock at 72, publication header from 80,
  field data from 96)
- The ABI rules per shape (sections 8.3-8.5)
- The seqlock SWMR protocol (section 8.8)
- Bind-time identity checks (section 8.6, section 9.2)
- Version fields as `u64` (section 3.3, section 9.1)
- Reservation ownership in `lanes.hot.reservations`, not in field shape (section 7.3)

This document specifies:

- The exact canonical byte format used to derive `hotLayoutVersion`
- The planner algorithm that assigns field offsets
- The `HotLayoutManifest` type emitted by the planner
- Per-shape byte-span and alignment formulas
- Reservation encoding for `BoundedArray` and `BoundedMap`
- The complete bind-time validation algorithm
- What generated TS consumer and Rust authority code must do per field shape
- The conformance test corpus

The companion adds no new design decisions. If a section here appears to make one, it is an error.

---

## 2. Fixed Layout Constants

All constants below are defined by the spine. They are collected here for codegen and planner reference. Do not derive
them independently.

```
HOT_ABI_VERSION          = 0x00000001   // u32; current hot lane ABI generation

BLOCK_A_SIZE             = 72           // bytes; immutable header block
BLOCK_B_OFFSET           = 72           // Block B starts immediately after Block A

SEQLOCK_OFFSET           = 72           // u64; seqlock version counter
BASELINE_EPOCH_OFFSET    = 80           // u32; baselineEpoch
CONTINUITY_GEN_OFFSET    = 84           // u32; continuityGeneration
PUBLICATION_SEQ_OFFSET   = 88           // u64; publicationSequence

FIELD_DATA_ORIGIN        = 96           // first byte planner may assign a field
```

`mutableRegionByteLength = totalRegionByteLength - BLOCK_A_SIZE`  (i.e. `- 72`)

Block A layout:

```
Offset  Size  Field
0       4     regionMagic         (4-byte sequence [0x53, 0x51, 0x4C, 0x4B]; the byte sequence is the normative truth)
4       4     hotAbiVersion       (u32 LE, value 0x00000001 = 1)
8       16    contractKeyHash     (bytes 0–15 of SHA-256(contractKey UTF-8))
24      16    instanceKeyHash     (bytes 0–15 of SHA-256(instanceKey UTF-8))
40      8     semanticVersion     (u64 LE)
48      8     hotLayoutVersion    (u64 LE)
56      4     fieldCount          (u32 LE; count of hot-admissible fields in layout)
60      4     mutableRegionByteLength (u32 LE; = totalRegionByteLength - 72)
64      8     reserved            (must be 0x00 × 8 on write)
```

Block B header (mutable; rewritten each publication):

```
Offset  Size  Field
72      8     seqlockCounter      (u64 LE; even = valid, odd = write in progress)
80      4     baselineEpoch       (u32 LE)
84      4     continuityGeneration(u32 LE)
88      8     publicationSequence (u64 LE)
96      ...   field data region
```

---

## 3. hotLayoutVersion Hash Specification

### 3.1 What hotLayoutVersion Covers

`hotLayoutVersion` covers the layout-specific content that a hot consumer or Rust authority writer is compiled against.
It does not cover semantic content (that is `semanticVersion`).

Changes that must produce a new `hotLayoutVersion`:

- Adding, removing, or renaming any hot-admissible field
- Changing any field's shape (type, length, maxLength/maxEntries, keyByteLength)
- Any change that shifts field offsets
- Adding or removing a dotPath from `lanes.hot.reservations` (changes which BoundedArray/BoundedMap fields appear in the
  hot layout)
- Changing `maxLength` or `maxEntries` on any reserved field

Changes that do not affect `hotLayoutVersion`:

- Adding, removing, or modifying warm or cold lane declarations
- Changing `revisionNote`
- Adding a field that is not hot-admissible (VariableMap, VariableString, or unreserved BoundedArray/BoundedMap)

### 3.2 Canonical Byte Format

```
[codec_name]          "mapped-fixed" as UTF-8 bytes, no null terminator
[0x00]                null separator
[field_count]         u32 LE; count of hot-admissible fields in layout
for each field in lexicographic dotPath order:
  [dotPath]           UTF-8 bytes, no null terminator
  [0x00]              null separator
  [fieldId]           u32 LE
  [shape_encoding]    per section 4.4 of the spine (canonical shape encoding)
  [absoluteOffset]    u32 LE; absolute offset from region byte 0
[reservation_count]   u32 LE; count of reservation entries
for each reservation field in lexicographic dotPath order:
  [dotPath]           UTF-8 bytes, no null terminator
  [0x00]              null separator
  [countFieldOffset]  u32 LE; absolute offset of the u32 live-count field
  [elementsOffset]    u32 LE; absolute offset of first element or entry
  [maxCount]          u32 LE; maxLength (BoundedArray) or maxEntries (BoundedMap)
  [unitByteLength]    u32 LE; byteWidth per element (BoundedArray) or entrySize (BoundedMap)
```

No `reservationType` byte. The type of each reservation field (BoundedArray vs BoundedMap) is already encoded in the
field list via the shape encoding (shape kind byte 0x04 or 0x05 per spine section 4.4). A separate type byte in the reservation
list would be redundant and constitutes an invented field with no declared semantic owner. It is explicitly excluded.

### 3.3 Hash Function

```
hotLayoutVersion = first_8_bytes_big_endian(SHA-256(canonical_byte_format))
interpreted as u64
```

The `hotLayoutVersion` is a `u64`. It is stored as u64 LE in Block A at offset 48. It is represented as `bigint` in
TypeScript at runtime and serialized as a 16-character lowercase hex string in JSON manifests.

### 3.4 Non-Reservation Fields in the Hash

Only hot-admissible fields appear in the field list. A field is hot-admissible if:

- Its shape is FixedScalar, FixedEnum, FixedVector, or FixedStringEncoded; or
- Its shape is BoundedArray or BoundedMap AND its dotPath appears in `lanes.hot.reservations`

VariableMap and VariableString never appear.

### 3.5 Reservation Fields in the Hash

The reservation section covers all BoundedArray and BoundedMap fields that appear in the hot layout. These fields also
appear in the main field list above. They appear in both sections because the main field list records the shape and
start offset, while the reservation section records the count-field and elements-start offsets separately (which the
codegen needs to distinguish).

---

## 4. Planner Inputs and Preconditions

### 4.1 Inputs

- A `CanonicalProjectionManifest` that has already passed hot-admissibility validation (spine section 7.4).
- The `HotLaneSpec` including the `reservations` set: the set of dotPaths declared as reserved in `lanes.hot`.

### 4.2 Preconditions

The resolver enforces all of these before invoking the planner. The planner does not re-validate.

1. All fields in `manifest.fields` are hot-admissible per section 3.4.
2. `manifest.fields` is sorted lexicographically by `dotPath`.
3. All `fieldId` values are unique within the contract.
4. Every BoundedArray and BoundedMap field in `manifest.fields` has its dotPath in the `reservations` set. (The resolver
   rejects any BoundedArray/BoundedMap field not in `reservations` as non-hot-admissible.)
5. Every dotPath in `reservations` corresponds to an existing BoundedArray or BoundedMap field. (The resolver rejects
   reservations on nonexistent or wrong-shape fields.)

### 4.3 Lane Declaration Model

```ts
interface HotLaneSpec {
    readonly codec: "mapped-fixed"
    readonly reservations: ReadonlyArray<string>  // sorted dotPaths of BoundedArray/BoundedMap fields
    // Empty array if the contract has no BoundedArray or BoundedMap fields.
}
```

Authoring:

```ts
lanes: {
  hot: {
    codec: "mapped-fixed",
    reservations: ["peaks", "engine.samples"],
  },
}
```

A contract with no BoundedArray or BoundedMap fields declares `reservations: []`. The `reservations` array must not
contain dotPaths for FixedScalar, FixedEnum, FixedVector, or FixedStringEncoded fields. Declaring a reservation for a
non-bounded field is a hard resolver error.

---

## 5. Alignment and Byte-Span Formulas

### 5.1 Scalar Natural Alignment

```
naturalAlignment(scalarType):
  bool | u8 | i8           → 1
  u16  | i16               → 2
  u32  | i32 | f32         → 4
  u64  | i64 | f64         → 8
```

### 5.2 Shape Natural Alignment

```
naturalAlignment(shape):
  FixedScalar(t)                       → naturalAlignment(t)
  FixedEnum(storage)                   → naturalAlignment(storage)
  FixedVector(elementType, length)     → naturalAlignment(elementType)
  FixedStringEncoded(byteLength)       → 1
  BoundedArray(elementType, max)       → max(4, naturalAlignment(elementType))
  BoundedMap(keyByteLen, vs, max)      → max(4, valueAlignment(vs))
```

The `max(4, ...)` rule for BoundedArray and BoundedMap reflects that the count field is u32 (alignment 4) and is always
placed first.

### 5.3 Byte Widths

```
byteWidth(scalarType):
  bool | u8 | i8           → 1
  u16  | i16               → 2
  u32  | i32 | f32         → 4
  u64  | i64 | f64         → 8

byteWidth(FixedEnum(storage)):
  "u8"  → 1
  "u16" → 2
  "u32" → 4
```

### 5.4 Value Shape Helpers (for BoundedMap)

The value shape of a BoundedMap must be FixedScalar, FixedEnum, or FixedVector.

```
valueAlignment(vs):
  FixedScalar(t)         → naturalAlignment(t)
  FixedEnum(storage)     → naturalAlignment(storage)
  FixedVector(et, len)   → naturalAlignment(et)

valueByteWidth(vs):
  FixedScalar(t)         → byteWidth(t)
  FixedEnum(storage)     → byteWidth(storage)
  FixedVector(et, len)   → byteWidth(et) × len
```

### 5.5 roundUpPad

```
roundUpPad(currentEnd, alignment):
  if alignment == 1: return 0
  r = currentEnd mod alignment
  if r == 0: return 0
  return alignment - r

roundUp(value, alignment):
  return value + roundUpPad(value, alignment)
```

### 5.6 BoundedArray Byte Span

For `BoundedArray(elementType, maxLength)` (reserved):

```
elemAlign     = naturalAlignment(elementType)
elemPad       = roundUpPad(4, elemAlign)      // padding after count field to align first element

countOffset   = 0            // relative to field absoluteOffset
elementsOffset= 4 + elemPad  // relative to field absoluteOffset

totalSpan     = 4 + elemPad + (maxLength × byteWidth(elementType))
```

### 5.7 BoundedMap Entry Size and Byte Span

For `BoundedMap(keyByteLength, valueShape, maxEntries)` (reserved):

```
vAlign        = valueAlignment(valueShape)
vSize         = valueByteWidth(valueShape)

intraPad      = roundUpPad(keyByteLength, vAlign)   // within each entry, between key end and value
entrySize     = keyByteLength + intraPad + vSize
// entrySize is always a multiple of vAlign. See section 8.3 for the invariant proof.

entryAreaPad  = roundUpPad(4, max(1, vAlign))       // padding after count field to align first entry

countOffset   = 0                    // relative to field absoluteOffset
elementsOffset = 4 + entryAreaPad    // relative to field absoluteOffset

totalSpan     = 4 + entryAreaPad + (maxEntries × entrySize)
```

### 5.8 Total Field Byte Span

```
fieldByteSpan(shape):
  FixedScalar(t)                 → byteWidth(t)
  FixedEnum(storage)             → byteWidth(storage)
  FixedVector(et, len)           → byteWidth(et) × len
  FixedStringEncoded(byteLen)    → byteLen
  BoundedArray(...)              → totalSpan per section 5.6
  BoundedMap(...)                → totalSpan per section 5.7
```

---

## 6. Planner Algorithm

### 6.1 Overview

The planner processes fields in lexicographic dotPath order. It maintains a cursor `currentOffset` starting at
`FIELD_DATA_ORIGIN` (96). For each field it pads to natural alignment, assigns the absolute offset, and advances the
cursor by the field's byte span. After all fields it pads the total region size to a multiple of 8.

### 6.2 Step-by-Step

```
INPUT:  manifest: CanonicalProjectionManifest
        hotSpec:  HotLaneSpec  (codec + reservations set)
OUTPUT: HotLayoutManifest

currentOffset ← FIELD_DATA_ORIGIN   // 96
fieldEntries  ← []
reservations  ← []

for each field in manifest.fields (in order; lexicographic by dotPath):
  align  ← naturalAlignment(field.shape)
  pad    ← roundUpPad(currentOffset, align)
  currentOffset ← currentOffset + pad

  absoluteOffset ← currentOffset
  span ← fieldByteSpan(field.shape)

  fieldEntries.push({
    dotPath:        field.dotPath,
    fieldId:        field.fieldId,
    shape:          field.shape,
    absoluteOffset: absoluteOffset,
    byteSpan:       span,
  })

  if field.shape.kind is "bounded-array" or "bounded-map":
    [countOff, elemsOff, maxCount, unitSize] ← reservationDetails(field.shape, absoluteOffset)
    reservations.push({
      dotPath:          field.dotPath,
      countFieldOffset: countOff,
      elementsOffset:   elemsOff,
      maxCount:         maxCount,
      unitByteLength:   unitSize,
    })

  currentOffset ← currentOffset + span

// Pad region to multiple of 8
regionPad ← roundUpPad(currentOffset, 8)
totalRegionByteLength ← currentOffset + regionPad
mutableRegionByteLength ← totalRegionByteLength - BLOCK_A_SIZE   // - 72

hotLayoutVersion ← computeHotLayoutVersion(fieldEntries, reservations)  // sections 3.2-3.3

EMIT HotLayoutManifest {
  contractKey:               manifest.key,
  hotLayoutVersion:          hotLayoutVersion,          // u64 as bigint
  hotAbiVersion:             HOT_ABI_VERSION,           // 1
  blockASize:                BLOCK_A_SIZE,              // 72
  blockBStartOffset:         BLOCK_B_OFFSET,            // 72
  seqlockOffset:             SEQLOCK_OFFSET,            // 72
  baselineEpochOffset:       BASELINE_EPOCH_OFFSET,     // 80
  continuityGenOffset:       CONTINUITY_GEN_OFFSET,     // 84
  publicationSeqOffset:      PUBLICATION_SEQ_OFFSET,    // 88
  fieldDataOrigin:           FIELD_DATA_ORIGIN,         // 96
  totalRegionByteLength:     totalRegionByteLength,
  mutableRegionByteLength:   mutableRegionByteLength,
  fields:                    fieldEntries,
  reservations:              reservations,
}
```

### 6.3 reservationDetails Helper

```
reservationDetails(shape, absoluteOffset):
  if shape.kind == "bounded-array":
    elemPad  ← roundUpPad(4, naturalAlignment(shape.elementType))
    countOff ← absoluteOffset
    elemsOff ← absoluteOffset + 4 + elemPad
    return (countOff, elemsOff, shape.maxLength, byteWidth(shape.elementType))

  if shape.kind == "bounded-map":
    vAlign       ← valueAlignment(shape.valueShape)
    entryAreaPad ← roundUpPad(4, max(1, vAlign))
    intraPad     ← roundUpPad(shape.keyByteLength, vAlign)
    entrySize    ← shape.keyByteLength + intraPad + valueByteWidth(shape.valueShape)
    countOff     ← absoluteOffset
    elemsOff     ← absoluteOffset + 4 + entryAreaPad
    return (countOff, elemsOff, shape.maxEntries, entrySize)
```

### 6.4 Determinism Requirement

Two independent planner implementations given the same `CanonicalProjectionManifest` and `HotLaneSpec` must produce
byte-identical `HotLayoutManifest` values and an identical `hotLayoutVersion`. This is a hard conformance requirement
enforced by section 11.9.

---

## 7. HotLayoutManifest: Planner Output Type

### 7.1 TypeScript Definition

```ts
interface HotLayoutManifest {
    // Contract identity
    readonly contractKey: string

    // Version (u64 carried as bigint; hex-serialized in JSON)
    readonly hotLayoutVersion: bigint

    // Fixed constants (typed as literals to catch mutation)
    readonly hotAbiVersion: 1
    readonly blockASize: 72
    readonly blockBStartOffset: 72
    readonly seqlockOffset: 72
    readonly baselineEpochOffset: 80
    readonly continuityGenOffset: 84
    readonly publicationSeqOffset: 88
    readonly fieldDataOrigin: 96

    // Region sizing
    readonly totalRegionByteLength: number   // multiple of 8
    readonly mutableRegionByteLength: number // = totalRegionByteLength - 72

    // Field layout
    readonly fields: ReadonlyArray<HotFieldEntry>
    readonly reservations: ReadonlyArray<HotReservationEntry>
}

interface HotFieldEntry {
    readonly dotPath: string
    readonly fieldId: u32
    readonly shape: FieldShape
    readonly absoluteOffset: number   // absolute from region byte 0
    readonly byteSpan: number
}

interface HotReservationEntry {
    readonly dotPath: string
    readonly countFieldOffset: number  // absolute offset of the u32 live-count field
    readonly elementsOffset: number    // absolute offset of first element or entry
    readonly maxCount: number
    readonly unitByteLength: number    // byteWidth per element, or entrySize per map entry
}
```

### 7.2 JSON Serialization

`hotLayoutVersion` serializes as a 16-character lowercase hex string (e.g. `"0a3f7c2b91d48e60"`). All other numeric
fields serialize as JSON numbers. No special ordering of JSON object keys is required; ordering is irrelevant to
correctness.

### 7.3 Codegen Relationship

Both TS consumer codegen and Rust authority codegen consume the `HotLayoutManifest` as their sole layout input. They do
not re-run the planner. The manifest is the single source of layout truth for all generated code.

---

## 8. Reservation Encoding Details

### 8.1 BoundedArray Layout

```
[absoluteOffset + 0]                  count: u32 LE          (live element count; 0 ≤ count ≤ maxLength)
[absoluteOffset + 4]                  [elemPad padding bytes]
[absoluteOffset + 4 + elemPad]        element[0]
[absoluteOffset + 4 + elemPad + 1×elementSize]  element[1]
...
[absoluteOffset + 4 + elemPad + (maxLength-1)×elementSize]  element[maxLength-1]
```

Consumer: reads `count`, then reads elements `[0, count)`. Elements `[count, maxLength)` are unspecified.

Authority: writes `count` (the live count) and elements `[0, count)`. Does not write beyond the live prefix.

**Worked example: BoundedArray of f64, maxLength = 4:**

```
elementSize = 8,  elemAlign = 8
elemPad     = roundUpPad(4, 8) = 4
totalSpan   = 4 + 4 + (4 × 8) = 40 bytes

Suppose absoluteOffset = 104  (must be 8-aligned; max(4,8)=8)

104: u32 LE  count          (e.g. 0x02000000 for count=2)
108: [4 bytes padding]
112: f64 LE  element[0]
120: f64 LE  element[1]
128: f64 LE  element[2]     ← unspecified if count == 2
136: f64 LE  element[3]     ← unspecified if count == 2
```

`countFieldOffset = 104`, `elementsOffset = 112`, `maxCount = 4`, `unitByteLength = 8`.

**Worked example: BoundedArray of u8, maxLength = 16:**

```
elementSize = 1, elemAlign = 1
elemPad     = roundUpPad(4, 1) = 0
totalSpan   = 4 + 0 + (16 × 1) = 20 bytes

Suppose absoluteOffset = 96

96:  u32 LE  count
100: u8      element[0]
101: u8      element[1]
...
115: u8      element[15]    ← unspecified if count < 16
```

`countFieldOffset = 96`, `elementsOffset = 100`, `maxCount = 16`, `unitByteLength = 1`.

---

### 8.2 BoundedMap Layout

```
[absoluteOffset + 0]                       count: u32 LE         (live entry count; 0 ≤ count ≤ maxEntries)
[absoluteOffset + 4]                       [entryAreaPad padding bytes]
[absoluteOffset + 4 + entryAreaPad]        entry[0].key          (keyByteLength bytes, zero-padded)
  + keyByteLength                          [intraPad padding bytes]
  + keyByteLength + intraPad               entry[0].value
  + keyByteLength + intraPad + vSize       entry[1].key          (start of next entry; stride = entrySize)
...
```

**Live-entry ordering invariant** (from spine section 8.4): the live entries at indices `[0, count)` must be sorted lexicographically
by encoded key bytes (`memcmp` order). The authority is responsible. Two publications of the same logical map must
produce bit-identical entry sequences in the live prefix.

Authority writes:

1. `count`
2. Entries `[0, count)` sorted by key bytes
3. Does not write indices `[count, maxEntries)` unless stale from prior

Consumer reads `count`, then reads `[0, count)` in order. May binary search within live prefix.

**Worked example: BoundedMap, keyByteLength=4, value=f32, maxEntries=4:**

```
vAlign = 4, vSize = 4
intraPad     = roundUpPad(4, 4) = 0
entrySize    = 4 + 0 + 4 = 8
entryAreaPad = roundUpPad(4, max(1,4)) = 0
totalSpan    = 4 + 0 + (4 × 8) = 36 bytes
naturalAlign = max(4, 4) = 4

Suppose absoluteOffset = 96

96:  u32 LE  count               (e.g. 2)
100: [4 bytes] entry[0].key      (zero-padded; e.g. "ch_a" = 0x63 0x68 0x5F 0x61)
104: f32 LE  entry[0].value
108: [4 bytes] entry[1].key      (e.g. "ch_b")
112: f32 LE  entry[1].value
116–131: entries[2–3]            ← unspecified if count == 2
```

`countFieldOffset = 96`, `elementsOffset = 100`, `maxCount = 4`, `unitByteLength = 8`.

**Worked example: BoundedMap, keyByteLength=3, value=f64, maxEntries=4:**

```
vAlign = 8, vSize = 8
intraPad     = roundUpPad(3, 8) = 5
entrySize    = 3 + 5 + 8 = 16
entryAreaPad = roundUpPad(4, max(1,8)) = 4
totalSpan    = 4 + 4 + (4 × 16) = 72 bytes
naturalAlign = max(4, 8) = 8

Suppose absoluteOffset = 96  (must be 8-aligned)

96:  u32 LE  count
100: [4 bytes padding]
104: [3 bytes] entry[0].key
107: [5 bytes padding]
112: f64 LE  entry[0].value
120: [3 bytes] entry[1].key
123: [5 bytes padding]
128: f64 LE  entry[1].value
136–167: entries[2–3]           ← unspecified if count ≤ 2
```

`countFieldOffset = 96`, `elementsOffset = 104`, `maxCount = 4`, `unitByteLength = 16`.

### 8.3 Entry Size Divisibility Invariant

For every BoundedMap field: `entrySize mod vAlign == 0`.

Proof: `entrySize = keyByteLength + intraPad + vSize`. By definition, `intraPad = roundUpPad(keyByteLength, vAlign)`, so
`keyByteLength + intraPad = roundUp(keyByteLength, vAlign)`, which is a multiple of `vAlign`. `vSize` is also a multiple
of `vAlign` (since `vSize = byteWidth(valueShape)` and values are naturally sized). Therefore `entrySize` is a multiple
of `vAlign`.

The planner must assert this invariant as a postcondition. It holds by formula construction, but the assertion catches
implementation bugs.

Consequence: the i-th entry's value is correctly aligned if `elementsOffset` is `vAlign`-aligned, since the offset of
entry i's value is `elementsOffset + i × entrySize + keyByteLength + intraPad`, and all terms are multiples of `vAlign`.

---

## 9. Bind-Time Validation Sequence

When a consumer binding attaches to a hot-lane mapped region, it must execute all checks below before treating any Block
B data as valid. Failure on any check is a hard bind error. The region must not be used until corrected. Checks are
ordered: earlier failures indicate more severe problems.

### 9.1 Block A Validation

Read bytes 0–71 from the mapped region (non-atomic; Block A is written once at init):

```
CHECK 1: region[0..4] == [0x53, 0x51, 0x4C, 0x4B]
         Magic bytes. Failure: wrong region, uninitialized region, or OS mapping error.

CHECK 2: region[4..8] as u32 LE == 1
         hotAbiVersion. Failure: incompatible hot lane ABI generation.
         If region carries hotAbiVersion=2 and consumer expects 1, consumer must be rebuilt
         against the new ABI; retry is not possible without a rebuild.

CHECK 3: region[8..24] == first_16_bytes(SHA-256(expected contractKey as UTF-8))
         128-bit contract identity. Failure: wrong contract mapped to this region.

CHECK 4: region[24..40] == first_16_bytes(SHA-256(expected instanceKey as UTF-8))
         128-bit instance identity. Failure: wrong instance key.

CHECK 5: region[40..48] as u64 LE == expected semanticVersion
         Semantic compatibility. Failure: field schema mismatch; consumer must rebuild.

CHECK 6: region[48..56] as u64 LE == expected hotLayoutVersion
         Layout compatibility. Failure: field offset mismatch; consumer must rebuild.

CHECK 7: region[56..60] as u32 LE == manifest.fields.length  (hot-admissible field count)
         Field count sanity. Failure: layout manifest inconsistency.

CHECK 8: region[60..64] as u32 LE == expected mutableRegionByteLength
         Region size value in header. Failure: mapped region header is inconsistent with compiled expectation.

CHECK 9: actual mapped region byte length == 72 + mutableRegionByteLength
         Actual mapping length. Failure: truncated or oversized mapping.

CHECK 10: region[64..72] == [0x00 × 8]
          Reserved bytes. Failure: region written by a different ABI version or corrupt.
```

All ten checks must pass before any Block B read is attempted.

Logging must distinguish the failure classes: magic failure (region error), hotAbiVersion mismatch (ABI generation
mismatch), hash failure (identity wiring error), version failure (build/deploy mismatch).

### 9.2 First Block B Read

After Block A checks pass, the consumer executes the seqlock read protocol (spine section 8.8):

```
seqlockCounter ← load_u64_atomic_acquire(region + 72)
if seqlockCounter is odd: spin until even
v1 ← seqlockCounter

baselineEpoch       ← load_u32(region + 80)
continuityGen       ← load_u32(region + 84)
publicationSeq      ← load_u64(region + 88)
// ... field reads at layout-plan offsets ...

v2 ← load_u64_atomic_acquire(region + 72)
if v2 != v1: retry from top
```

After the first successful read, the consumer records `baselineEpoch`, `continuityGen`, and `publicationSeq` as its
baseline continuity state.

---

## 10. Generated Binding Expectations

### 10.1 Authority Region Initialization

Before any publication, the authority writes Block A once:

```
Write bytes 0–71 (Block A, one-time init):
  [0..4]   ← [0x53, 0x51, 0x4C, 0x4B] (magic byte sequence)
  [4..8]   ← 0x00000001 (u32 LE, hotAbiVersion = 1)
  [8..24]  ← first_16_bytes(SHA-256(contractKey as UTF-8))
  [24..40] ← first_16_bytes(SHA-256(instanceKey as UTF-8))
  [40..48] ← semanticVersion (u64 LE)
  [48..56] ← hotLayoutVersion (u64 LE)
  [56..60] ← hot-admissible field count (u32 LE)
  [60..64] ← mutableRegionByteLength (u32 LE)
  [64..72] ← 0x00 × 8 (reserved; must be zero)

Write bytes 72–95 (Block B header, initial state):
  [72..80] ← 0x00 × 8  (seqlockCounter = 0, even = valid)
  [80..84] ← 0x00 × 4  (baselineEpoch = 0)
  [84..88] ← 0x00 × 4  (continuityGeneration = 0)
  [88..96] ← 0x00 × 8  (publicationSequence = 0)
```

Field data (bytes 96 onward) may be uninitialized before the authority's first publication and before any consumer
handle is opened. A hot handle must not be opened until Hot SAB Lifecycle initialization requirements are satisfied (
header, metadata, and payload bytes initialized to a valid full snapshot state). Consumers must not read field data
before bind-time validation passes and at least one seqlock-valid read has completed.

### 10.2 TS Consumer: Per-Shape Read

Reads use a `DataView` over the mapped `SharedArrayBuffer`. All reads specify `littleEndian=true`.

**FixedScalar(t)**:

```ts
const offset = entry.absoluteOffset
// Dispatch by t:
//   bool   → view.getUint8(offset) → 0=false, 1=true, other=violation
//   u8     → view.getUint8(offset)
//   u16    → view.getUint16(offset, true)
//   u32    → view.getUint32(offset, true)
//   u64    → view.getBigUint64(offset, true)  // returns bigint
//   i8     → view.getInt8(offset)
//   i16    → view.getInt16(offset, true)
//   i32    → view.getInt32(offset, true)
//   i64    → view.getBigInt64(offset, true)   // returns bigint
//   f32    → view.getFloat32(offset, true)
//   f64    → view.getFloat64(offset, true)
```

Note: `u64` and `i64` return `bigint`. Consumer code receiving these values must expect `bigint`, not `number`.

**FixedEnum(variants, storage)**:

```ts
const idx = view.get<storage>(entry.absoluteOffset, true)
// assert 0 ≤ idx < variants.length
return variants[idx]
```

**FixedVector(elementType, length)**:

```ts
const result = new Array(length)
for (let i = 0; i < length; i++) {
    result[i] = view.get<elementType>(entry.absoluteOffset + i * byteWidth(elementType), true)
}
return result
```

**FixedStringEncoded(byteLength, encoding)**:

```ts
const bytes = new Uint8Array(view.buffer, entry.absoluteOffset, byteLength)
// Trim trailing zero bytes (spine section 8.4 consumer read semantics):
let len = byteLength
while (len > 0 && bytes[len - 1] === 0) len--
return new TextDecoder(encoding).decode(bytes.subarray(0, len))
```

**BoundedArray** (uses `HotReservationEntry res`):

```ts
const count = view.getUint32(res.countFieldOffset, true)
// assert 0 ≤ count ≤ res.maxCount
const result = new Array(count)
for (let i = 0; i < count; i++) {
    result[i] = view.get<elementType>(res.elementsOffset + i * res.unitByteLength, true)
}
return result
```

**BoundedMap** (uses `HotReservationEntry res`):

```ts
const count = view.getUint32(res.countFieldOffset, true)
// assert 0 ≤ count ≤ res.maxCount
const result = new Map<string, valueType>()
for (let i = 0; i < count; i++) {
    const base = res.elementsOffset + i * res.unitByteLength
    const keyBytes = new Uint8Array(view.buffer, base, keyByteLength)
    let kLen = keyByteLength
    while (kLen > 0 && keyBytes[kLen - 1] === 0) kLen--
    const key = new TextDecoder("ascii").decode(keyBytes.subarray(0, kLen))
    const value = view.get<valueType>(base + keyByteLength + intraPad, true)
    result.set(key, value)
}
return result
// Entries arrive in lex-sorted key order (ABI guarantee). Consumer may rely on this.
```

### 10.3 TS Consumer: Seqlock Wrapper

The seqlock counter must not be read through `DataView`. Sequence-counter reads require atomic acquire semantics. In
TypeScript that means `Atomics.load()` on a `BigUint64Array` view over the counter location.
Non-atomic DataView u64 reads are explicitly rejected for this purpose. See Hot Lane Consumer Runtime sections 17 and
8.1.

```ts
function readProjection(
    view: DataView,
    sequenceView: BigUint64Array,   // BigUint64Array over the SAB, element 0 == seqlockCounter
    layout: HotLayoutManifest,
): ProjectionSnapshot {
    while (true) {
        const v1 = Atomics.load(sequenceView, 0)   // atomic acquire; counterOffset is element 0
        if (v1 & 1n) continue                       // odd = write in progress; spin

        const snapshot: Partial<ProjectionSnapshot> = {
            baselineEpoch: view.getUint32(layout.baselineEpochOffset, true),
            continuityGen: view.getUint32(layout.continuityGenOffset, true),
            publicationSeq: view.getBigUint64(layout.publicationSeqOffset, true),
            // ... generated field reads in layout order (DataView is legal for field reads) ...
        }

        const v2 = Atomics.load(sequenceView, 0)   // atomic acquire; second load for torn-read check
        if (v2 === v1) return snapshot as ProjectionSnapshot
        // v2 ≠ v1: writer modified region during read; retry
    }
}
```

The `sequenceView` must be a `BigUint64Array` constructed from the same `SharedArrayBuffer` as `view`, with its byte
offset set to `layout.seqlockOffset`. Element index 0 of the array then corresponds exactly to the 8-byte seqlock
counter. The generated binding must create this view at bind time, not per read call.

> The bounded retry policy (writer-active poll budget, torn-read budget, last-good fallback) belongs to Hot Lane
> Consumer Runtime. This wrapper shows the structural pattern; the normative algorithm with budget enforcement is in Hot
> Lane Consumer Runtime section 7.

```

### 10.4 Rust Authority: Seqlock Publish Pattern

```rust
// Generated constants per field (example):
const FIELD_TRANSPORT_TEMPO_OFFSET: usize = /* absoluteOffset from manifest */;
const SEQLOCK_OFFSET: usize = 72;
const BASELINE_EPOCH_OFFSET: usize = 80;
const CONTINUITY_GEN_OFFSET: usize = 84;
const PUBLICATION_SEQ_OFFSET: usize = 88;

unsafe fn publish(&self, region: *mut u8) {
    let seqlock = &*(region.add(SEQLOCK_OFFSET) as *const AtomicU64);

    // Begin write: increment to odd
    seqlock.fetch_add(1, Ordering::Release);

    // Write publication header
    (region.add(BASELINE_EPOCH_OFFSET) as *mut u32)
        .write_unaligned(self.baseline_epoch.to_le());
    (region.add(CONTINUITY_GEN_OFFSET) as *mut u32)
        .write_unaligned(self.continuity_generation.to_le());
    (region.add(PUBLICATION_SEQ_OFFSET) as *mut u64)
        .write_unaligned(self.publication_sequence.to_le());

    // Write all fields (generated per field from manifest offsets)
    self.write_all_fields(region);

    // End write: increment to even
    seqlock.fetch_add(1, Ordering::Release);
}
```

Field writers use `write_unaligned` defensively. Where alignment is guaranteed by the planner (which it always is for
compliant regions), `write` is equivalent. The planner guarantees all offsets satisfy natural alignment from region byte
0.

### 10.5 BoundedMap Authority Sort Obligation

Before writing a BoundedMap field, entries must be sorted by encoded key bytes. The authority is responsible for
providing entries in sorted order. Generated code must not silently accept unsorted input. Options:

- Generated writer asserts sorted input in debug builds and panics on violation
- Generated writer sorts on behalf of the caller (adds a sort call before writing)

The choice is implementation-defined. The requirement is that the live prefix in the region is always in lex-sorted key
order after every publication.

---

## 11. Cross-Language Conformance Test Corpus

### 11.1 Purpose

These tests enforce that independent planner and codegen implementations agree on all layout decisions. They must pass
before any cross-language hot-lane exchange is attempted.

Tests verify:

1. Same contract → same field offsets
2. Same contract → same `hotLayoutVersion` (u64) in TS and Rust
3. Same field data → same decoded logical value in TS and Rust
4. Bind-time validation: each Block A failure mode individually caught
5. Fixed-string trim semantics
6. BoundedMap entry ordering

### 11.2 Test Case: Minimal (all fixed scalars)

```ts
defineProjectionContract({
  key: "test.minimal",
  family: "replaceable-snapshot",
  fields: {a: bool(), b: u32(), c: f64()},
  lanes: {
    hot: {
      codec: "mapped-fixed",
      reservations: [],
    },
  },
})
```

Canonical field order: `a`, `b`, `c`.

**Expected layout** (field data starts at 96):

```
Field "a" (bool, align=1):
  pad = roundUpPad(96, 1) = 0
  absoluteOffset = 96
  currentOffset → 97

Field "b" (u32, align=4):
  pad = roundUpPad(97, 4) = 3
  absoluteOffset = 100
  currentOffset → 104

Field "c" (f64, align=8):
  pad = roundUpPad(104, 8) = 0
  absoluteOffset = 104
  currentOffset → 112

regionPad = roundUpPad(112, 8) = 0
totalRegionByteLength = 112
mutableRegionByteLength = 112 - 72 = 40
```

**Golden assertions**:

- `"a"` absoluteOffset = 96
- `"b"` absoluteOffset = 100
- `"c"` absoluteOffset = 104
- `totalRegionByteLength = 112`
- `mutableRegionByteLength = 40`

**Encoded field data payload** (bytes 96–111):

```
96:  0x01                  (a = true)
97:  0x00 0x00 0x00        (alignment padding)
100: 0xAD 0xDE 0x00 0x00  (b = 57005, u32 LE)
104: 0x00 0x00 0x00 0x00 0x00 0x40 0x59 0x40  (c = 100.0, f64 LE)
```

Both TS and Rust must decode: `a=true`, `b=57005`, `c=100.0`.

### 11.3 Test Case: FixedVector and FixedEnum

```ts
fields: {
  gains: vecF32(4),                         // dotPath "gains"
  mode: enumU8(["off", "on", "standby"]),  // dotPath "mode"
}
```

Lexicographic order: `"gains"` < `"mode"`.

**Expected layout**:

```
Field "gains" (FixedVector f32×4, align=4):
  pad = roundUpPad(96, 4) = 0
  absoluteOffset = 96,  byteSpan = 16
  currentOffset → 112

Field "mode" (FixedEnum u8, align=1):
  pad = roundUpPad(112, 1) = 0
  absoluteOffset = 112, byteSpan = 1
  currentOffset → 113

regionPad = roundUpPad(113, 8) = 7
totalRegionByteLength = 120
```

**Golden assertions**:

- `"gains"` absoluteOffset = 96
- `"mode"` absoluteOffset = 112
- `totalRegionByteLength = 120`

**Encoding**: `gains=[1.0, 2.0, 3.0, 4.0]` as four f32 LE at 96, 100, 104, 108. `mode="standby"` (index 2) as `0x02` at
112.

### 11.4 Test Case: BoundedArray hot-reservation

```ts
fields: {
  count: u32(),
  peaks: boundedArrayF32(8),  // BoundedArray; in lanes.hot.reservations
},
lanes: {
  hot: {
    codec: "mapped-fixed",
    reservations: ["peaks"],
  },
}
```

Lexicographic order: `"count"` < `"peaks"`.

**Expected layout**:

```
Field "count" (u32, align=4):
  absoluteOffset = 96, byteSpan = 4
  currentOffset → 100

Field "peaks" (BoundedArray f32×8, naturalAlign=max(4,4)=4):
  pad = roundUpPad(100, 4) = 0
  absoluteOffset = 100
  elemPad = roundUpPad(4, 4) = 0
  byteSpan = 4 + 0 + (8×4) = 36
  countFieldOffset = 100, elementsOffset = 104
  currentOffset → 136

regionPad = roundUpPad(136, 8) = 0
totalRegionByteLength = 136
```

**Golden assertions**:

- `"count"` absoluteOffset = 96
- `"peaks"` absoluteOffset = 100
- `reservations[0].countFieldOffset = 100`
- `reservations[0].elementsOffset = 104`
- `reservations[0].maxCount = 8`
- `reservations[0].unitByteLength = 4`
- `totalRegionByteLength = 136`

**Encoding**: live count=3 as `0x03000000` (u32 LE) at 100. Elements at 104, 108, 112. Bytes 116–135 unspecified.

### 11.5 Test Case: BoundedMap hot-reservation

```ts
fields: {
  volumes: boundedMap({keyByteLength: 4, valueShape: f32(), maxEntries: 4}),
},
lanes: {
  hot: {
    codec: "mapped-fixed",
    reservations: ["volumes"],
  },
}
```

**Expected layout**:

```
Field "volumes" (BoundedMap klen=4 f32 max=4, naturalAlign=max(4,4)=4):
  pad = roundUpPad(96, 4) = 0
  absoluteOffset = 96
  vAlign=4, vSize=4, intraPad=0, entrySize=8, entryAreaPad=0
  byteSpan = 4 + 0 + (4×8) = 36
  countFieldOffset = 96, elementsOffset = 100
  currentOffset → 132

regionPad = roundUpPad(132, 8) = 4
totalRegionByteLength = 136
```

**Golden assertions**:

- `"volumes"` absoluteOffset = 96
- `reservations[0].countFieldOffset = 96`
- `reservations[0].elementsOffset = 100`
- `reservations[0].unitByteLength = 8`
- `totalRegionByteLength = 136`

**Encoding**: count=2. Entry[0]: key `"ch_a"` (4 bytes) at 100, value 0.75 f32 at 104. Entry[1]: key `"ch_b"` at 108,
value 0.5 f32 at 112. Bytes 116–135 unspecified. Entry order must be lex by key bytes: `"ch_a" < "ch_b"` ✓.

### 11.6 Test Case: Bind-Time Validation, Each Failure Mode

| Test                        | Block A mutation                                                        | Expected check failure               |
|-----------------------------|-------------------------------------------------------------------------|--------------------------------------|
| Magic wrong                 | `region[0..4] ← [0xDE, 0xAD, 0xBE, 0xEF]`                               | Check 1: magic                       |
| ABI version wrong           | `region[4..8] ← 0x00000002`                                             | Check 2: hotAbiVersion               |
| Contract hash wrong         | `region[8..24] ← wrong bytes`                                           | Check 3: contractKeyHash             |
| Instance hash wrong         | `region[24..40] ← wrong bytes`                                          | Check 4: instanceKeyHash             |
| semanticVersion wrong       | `region[40..48] ← wrong u64 LE`                                         | Check 5: semanticVersion             |
| hotLayoutVersion wrong      | `region[48..56] ← wrong u64 LE`                                         | Check 6: hotLayoutVersion            |
| fieldCount wrong            | `region[56..60] ← wrong u32 LE`                                         | Check 7: fieldCount                  |
| region size field wrong     | `region[60..64] ← wrong u32 LE`                                         | Check 8: mutableRegionByteLength     |
| actual mapping length wrong | truncate mapping or over-map so length ≠ `72 + mutableRegionByteLength` | Check 9: actual mapped region length |
| Reserved nonzero            | `region[64] ← 0xFF`                                                     | Check 10: reserved                   |

Each test must produce a bind error on the correct check. Passing all ten confirms check independence and correct
ordering.

### 11.7 Test Case: FixedStringEncoded Trim Semantics

Contract: `FixedStringEncoded(byteLength=8, encoding="ascii")`.

All of the following 8-byte buffers must decode to `"abc"`:

```
[0x61, 0x62, 0x63, 0x00, 0x00, 0x00, 0x00, 0x00]
```

The empty string decodes from:

```
[0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00]
```

A fully-populated buffer with no trailing zeros:

```
[0x61, 0x62, 0x63, 0x64, 0x65, 0x66, 0x67, 0x68]  → "abcdefgh" (logical length = byteLength)
```

Trim rule: scan from `offset + byteLength - 1` toward `offset`, stop at first non-zero byte. Logical byte length = that
position minus `offset` plus one.

### 11.8 Test Case: BoundedMap Live-Entry Sort Order

Authority writes entries in this insertion order: `key=[0x62,0x00,0x00,0x00]`, `key=[0x61,0x00,0x00,0x00]`,
`key=[0x63,0x00,0x00,0x00]`.

Expected encoded order in region (lex by raw key bytes):

```
entry[0].key = [0x61, 0x00, 0x00, 0x00]   ("a")
entry[1].key = [0x62, 0x00, 0x00, 0x00]   ("b")
entry[2].key = [0x63, 0x00, 0x00, 0x00]   ("c")
```

An implementation that writes in insertion order (b, a, c) must fail this test. The test reads all entries and asserts
the key bytes at index 0 are `0x61...`, index 1 are `0x62...`, index 2 are `0x63...`.

### 11.9 hotLayoutVersion Cross-Language Equality Test

**Contract**: the `test.minimal` contract from section 11.2.

1. TS planner computes `hotLayoutVersion` → `tsVersion: bigint`.
2. Rust planner computes `hotLayoutVersion` → `rustVersion: u64`.
3. Assert `tsVersion == BigInt(rustVersion)`.

This test is a **blocking prerequisite** for any cross-language hot-lane exchange. It must pass before warm codec work
begins.

---

## Implementation Priority

Execute in this order. Do not skip ahead.

1. Implement the planner in TypeScript. Emit `HotLayoutManifest` for `test.minimal`.
2. Verify all golden assertions in section 11.2.
3. Implement `hotLayoutVersion` SHA-256 hash in TypeScript.
4. Implement the planner and hash in Rust.
5. Run section 11.9: assert TS and Rust produce the same `hotLayoutVersion` for `test.minimal`.
6. Extend planner tests to section 11.3, section 11.4, section 11.5. Verify all golden assertions.
7. Implement TS consumer codegen: field readers and seqlock wrapper.
8. Implement Block A initialization and bind-time validation (TS consumer side).
9. Run section 11.6: verify each failure mode.
10. Implement Rust authority codegen: field writers and seqlock publish.
11. End-to-end round-trip: Rust init + publish, TS bind + read, assert decoded values match.
12. Run section 11.7 (string trim) and section 11.8 (map sort order).

Do not begin warm codec work until step 11 passes end-to-end.
