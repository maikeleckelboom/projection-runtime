# Projection Runtime Duplicate Family Audit

## 1. Executive Summary

- Total files inspected: 269 tracked files in the requested scope (`packages/**/src`, `packages/**/tests`, `scripts`, `crates`, `fixtures`, selected docs, and root policy/config files).
- Duplicate families found: 18 material families. This count groups concept families, not every repeated helper occurrence.
- Families fixed in this run: 2 safe local validation-helper families.
- Families intentionally left alone: 16 families, including the higher-risk compiler/hot-codec ABI serializer family.
- Limitations of the scan: this was a source-guided literal and normalized audit using `git ls-files`, `rg`, dependency inspection, and manual review of high-risk files. It was not a complete AST clone-index across every expression, and generated fixture output was reviewed as conformance surface rather than rewritten.

Important ranking note: the host-contract/resource cleanup below is safe and useful local duplication cleanup. It is not the highest-risk remaining family. The next serious slice remains compiler/hot-codec ABI serializer drift.

## 2. Changes Made

### Host-contract local validation helpers

- Files changed: `packages/host-contract/src/validation.ts`, `host-control.ts`, `host-failure.ts`, `host-hot.ts`, `host-owner.ts`, `host-resource.ts`, `host-surface.ts`, `host-warm.ts`.
- Duplicate family removed: repeated package-local `assertPlainObject`, `assertExactRootKeys`, `assertNonEmptyString`, validation result wrapping, error-message extraction, canonical decimal string checks, and safe integer checks.
- Canonical owner chosen: `packages/host-contract/src/validation.ts`.
- Why this owner is correct: all callers are inside `@exclave/host-contract`; the helper keeps the host-contract error domain and descriptor policy local.
- Behavior-preservation argument: helper bodies preserve the previous message text and still throw through `throwInputRejected`; validation result functions keep the same failure codes.
- Validation coverage: `pnpm --filter @exclave/host-contract typecheck` and `pnpm --filter @exclave/host-contract test` passed.

### Resource legacy validation helpers

- Files changed: `packages/resource/src/validation.ts`, `resource-descriptor.ts`, `resource-range.ts`, `resource-failure.ts`.
- Duplicate family removed: repeated package-local `assertPlainObject`, `assertExactRootKeys`, `assertNonEmptyString`, JSON-object checks, canonical authority epoch string checks, and safe non-negative integer checks.
- Canonical owner chosen: `packages/resource/src/validation.ts`.
- Why this owner is correct: the affected helpers are legacy resource descriptor/range/failure validation mechanics inside one package and one error domain.
- Behavior-preservation argument: the resource helper preserves the existing resource-specific numeric wording (`must not be Infinity or NaN`, `must not be negative`, `exceeds Number.MAX_SAFE_INTEGER`) instead of switching to host-contract wording.
- Validation coverage: `pnpm --filter @exclave/resource typecheck` and `pnpm --filter @exclave/resource test` passed.

## 3. Highest Priority Findings

### Compiler/hot-codec canonical shape serialization

- Kind: ABI.
- Confidence: high.
- Affected files and line ranges: `packages/compiler/src/version.ts:15-174`; `packages/hot-codec/src/version.ts:10-188`.
- Shared concept: shape kind IDs, scalar IDs, string encoding IDs, recursive field-shape byte serialization, `ByteWriter`, and SHA-256 u64 prefix decoding.
- Current owners: `@exclave/compiler` owns semantic version bytes; `@exclave/hot-codec` owns hot layout version bytes.
- Likely correct owner: `@exclave/hot-codec` for hot ABI shape byte primitives, but not necessarily for compiler semantic-version policy.
- Why it matters: a scalar ID or shape writer drift can produce byte-incompatible semantic and hot-layout versions while tests still pass locally by comparing only package-owned outputs.
- Recommended action: fix later, ranked above further validation cleanup.
- Suggested cleanup slice: first add conformance tests that pin shape/scalar/string encoding IDs and recursive shape bytes across semantic and hot-layout version derivation. Then decide the smallest production move.
- Precise blocker: the duplicated pieces that would need to move are `SHAPE_IDS`, `SCALAR_IDS`, `STRING_ENCODING_IDS`, `writeShape`, `ByteWriter`, and `readU64PrefixBigEndian`. Exposing a public hot-codec API for `writeShape` is not the right shape yet because it would leak low-level ABI serialization as consumer API, while compiler semantic-version bytes also include compiler-owned family and field-list policy. Constants-only sharing is safer if exported as named ABI constants, but it only reduces table drift and does not solve recursive writer drift. Conformance tests should be the next move before production extraction. Narrow next prompt: "Add compiler/hot-codec ABI serializer conformance tests that pin scalar IDs, shape IDs, string encoding IDs, recursive shape bytes, and u64 digest-prefix behavior without changing public APIs."

### Hot ABI constants mirrored across TS, Rust, docs, and generated templates

- Kind: ABI / generated-template.
- Confidence: high.
- Affected files and line ranges: `packages/hot-codec/src/constants.ts:1-11`; `packages/hot-codec/src/plan.ts:4-61`; `crates/hot-abi-conformance/src/main.rs:23`; `docs/projection-runtime/hot-lane-codec-and-layout-spec.md:77-85`; `scripts/projection-runtime/write-generated-hot-writer.mts:68-75`; `scripts/projection-runtime/write-generated-rust-hot-writer.mts:89-109`.
- Shared concept: hot ABI version, Block A/B offsets, seqlock/publication offsets, and field data origin.
- Current owners: hot-codec, Rust conformance crate, docs, and generator templates.
- Likely correct owner: generated from a single ABI manifest or kept duplicated with stronger conformance checks.
- Why it matters: offset drift corrupts protocol boundary reads and generated writers.
- Recommended action: fix later.
- Suggested cleanup slice: add a generated ABI constants manifest consumed by TS/Rust tests, or add a conformance test that asserts every mirror against hot-codec constants.

### Publication/resource strict root validation grammar

- Kind: validation.
- Confidence: high.
- Affected files and line ranges: `packages/publication/src/protocol.ts:262-333`; `packages/resource/src/resource-protocol.ts:255-337` and `502-509`.
- Shared concept: plain object checks, symbol-key rejection, exact root keys, non-empty strings, non-negative bigint, u32, lane/scope enums.
- Current owners: publication and resource.
- Likely correct owner: still ambiguous across packages; could be a small package-local helper in each package before any shared base helper.
- Why it matters: boundary rejection grammar can drift across protocol surfaces.
- Recommended action: fix later after ABI serializer conformance.
- Suggested cleanup slice: resource-protocol-only local helper extraction, keeping resource body metadata checks local.

### Control-plane envelope object inspection

- Kind: validation / protocol-boundary.
- Confidence: medium.
- Affected files and line ranges: `packages/control-plane/src/control-envelope.ts:85-153`.
- Shared concept: safe object inspection, symbol-key rejection, descriptor checks, exact root key checks.
- Current owners: control-plane, publication, resource.
- Likely correct owner: control-plane local helper first; cross-package sharing only if message grammar can stay package-specific.
- Why it matters: control-plane is a boundary format and has richer descriptor safety than simpler packages.
- Recommended action: fix later.
- Suggested cleanup slice: extract `control-envelope` local root-key/object-inspection helpers inside `@exclave/control-plane`.

### Warm framed snapshot input validation

- Kind: validation / serialization.
- Confidence: medium.
- Affected files and line ranges: `packages/warm/src/framed-snapshot.ts:91-134`, `214-226`, `294-333`.
- Shared concept: plain input validation, u32/u64 checks, length-prefixed UTF-8 field framing.
- Current owners: warm only, with similar concepts in publication/resource/control-plane.
- Likely correct owner: warm local codec; leave most repetition local because it is serialization policy.
- Why it matters: framed snapshot bytes are protocol payloads; genericizing too much would hide byte-level policy.
- Recommended action: leave alone for now.
- Suggested cleanup slice: none until ABI serializer drift is handled.

### Error-domain issue mechanics

- Kind: error-domain.
- Confidence: medium.
- Affected files and line ranges: `packages/compiler/src/error.ts:118-152`; `packages/hot-codec/src/error.ts:128-239`; `packages/hot-binding/src/error.ts:66-133`; `packages/hot-consumer/src/error.ts:57-123`; `packages/hot-publisher/src/error.ts:63-129`; shared helpers in `packages/base/src/issue-helpers.ts:18-26`.
- Shared concept: sorted issue lists, `issueCount`, formatted detail strings, input-rejected factories.
- Current owners: each package error domain plus base issue helpers.
- Likely correct owner: base owns mechanics already; package domains should stay explicit.
- Why it matters: drift is mostly metadata consistency, not ABI.
- Recommended action: leave alone unless a future package is missing the base helper.
- Suggested cleanup slice: no production extraction now.

### Test fixture readers and byte helpers

- Kind: test-helper.
- Confidence: medium.
- Affected files and line ranges: `packages/hot-codec/tests/hot-codec.test.ts:102-119`, `438-455`; `packages/conformance/src/fixtures.ts:87-179`; `scripts/write-projection-runtime-fixture.mts:269-281`, `397-431`; host-contract fixture layout readers in `packages/host-contract/tests/host-contract-fixture-host-client.test.ts:202-227`, `host-contract-integration.test.ts:171-204`, `host-contract-guarded-hot-read.test.ts:156-186`.
- Shared concept: fixture root loading, hex/u64 conversion, JSON fixture normalization, layout offset reads.
- Current owners: package tests and fixture writer.
- Likely correct owner: conformance package for fixture readers; host-contract tests can keep local helpers if readability wins.
- Why it matters: moderate test maintenance cost; low production drift risk.
- Recommended action: fix later.
- Suggested cleanup slice: host-contract tests-only layout-manifest reader extraction.

## 4. Full Duplicate Family Inventory

### ABI / serialization

- Compiler/hot-codec shape serialization: `compiler/src/version.ts:15-174`, `hot-codec/src/version.ts:10-188`.
- Hot ABI constants in TS/Rust/docs/generator templates: `hot-codec/src/constants.ts:1-11`, `crates/hot-abi-conformance/src/main.rs:23`, docs spec offsets, generated writer scripts.
- Block A/Block B byte writes and version checks across `hot-codec/src/header.ts:66-108`, `crates/hot-abi-conformance/src/main.rs:1254-1312`, and conformance mutation tests.
- Warm frame length-prefixed u64/u32 serialization in `warm/src/framed-snapshot.ts:214-333`; kept local.
- Resource descriptor/body metadata filtering in `resource/src/resource-protocol.ts:453-509`; kept local.

### Validation grammar

- Fixed now: host-contract local helper family.
- Fixed now: resource descriptor/range/failure local helper family.
- Remaining: publication/resource strict protocol root validation.
- Remaining: control-plane exact root/safe descriptor grammar.
- Remaining: warm framed-snapshot input object grammar.

### Error-domain mechanics

- Package-specific `defineErrorDomain` plus `throwInputRejected` wrappers remain explicit.
- Issue sorting/detail formatting already has a base owner; package factories remain readable and local.

### Protocol/boundary mechanics

- Strict root-key filtering across publication, resource, control-plane, warm.
- Host surface/lane descriptor checks now share local host-contract mechanics.
- Resource legacy descriptors now share local resource mechanics; resource v1 protocol remains local.

### Test helpers

- Fixture root readers and fixture JSON transforms in conformance and fixture writer.
- Host-contract repeated layout manifest readers.
- Resource tests repeated `validOwner`/`validDescriptor` builders.
- Error metadata assertions across error-domain tests.

### Generated/template duplication

- Generated TS/Rust hot writers mirror publication offsets and scalar writer templates.
- Fixture generated artifacts intentionally repeat output bytes for conformance independence.

### Docs/examples/config duplication

- Hot ABI constants and offsets appear in docs as canonical examples and must remain checked against source.
- Root TypeScript/Vitest workspace aliases are repeated policy but not a cleanup target.

### Literal leftovers

- `bytesToHex` and `hexToBytes` calls are intentionally imported from hot-codec in many places; local warm test `bytesToHex` remains a tiny test helper.
- Repeated `throwInputRejected` tests remain package ownership checks.

## 5. One-Owner-Missing List

- Concept: hot ABI shape ID and scalar ID serialization. Files/packages involved: compiler and hot-codec. Risk: high. Proposed owner: hot-codec-owned ABI serialization primitives, with compiler-owned semantic policy layered above. Proposed boundary: conformance test first; production sharing only through an explicitly named ABI primitive, not a vague generic writer. Fixed now: deferred.
- Concept: hot ABI constants across TS/Rust/docs/generators. Files/packages involved: hot-codec, Rust conformance crate, docs, scripts. Risk: high. Proposed owner: hot-codec or a generated ABI manifest. Proposed boundary: conformance or generator ownership. Fixed now: deferred.
- Concept: host-contract descriptor validation mechanics. Files/packages involved: host-contract sources. Risk: medium. Proposed owner: `packages/host-contract/src/validation.ts`. Proposed boundary: internal package helper. Fixed now: yes.
- Concept: resource legacy descriptor/range/failure validation mechanics. Files/packages involved: resource descriptor, range, failure sources. Risk: medium. Proposed owner: `packages/resource/src/validation.ts`. Proposed boundary: internal package helper. Fixed now: yes.
- Concept: publication/resource/control-plane root-key grammar. Files/packages involved: publication, resource, control-plane. Risk: medium. Proposed owner: package-local helpers first; shared base only if grammar is proven identical. Fixed now: deferred.
- Concept: host-contract layout fixture readers. Files/packages involved: host-contract tests. Risk: low. Proposed owner: host-contract tests helper. Proposed boundary: tests only. Fixed now: deferred.

## 6. Intentional Duplication To Keep

- Package-specific error domains should stay explicit; they document ownership and public error codes.
- Generated fixture bytes and generated hot writer outputs should remain independent conformance artifacts.
- Warm frame serialization checks should remain local until byte framing policy is separated from validation mechanics.
- Resource v1 protocol body-filtering should remain local because it encodes resource-plane policy, not generic validation.
- Small test builders such as `validOwner` are acceptable where local readability is better than indirection.

## 7. Remaining Cleanup Queue

1. Title: Add compiler/hot-codec ABI serializer conformance tests.
   Files likely touched: `packages/compiler/tests/compiler.test.ts`, `packages/hot-codec/tests/hot-codec.test.ts`, possibly `packages/conformance/tests/conformance.test.ts`.
   Expected risk: low to medium.
   Expected payoff: high; catches scalar/shape/string ID drift before production refactor.
   Validation to run: `pnpm --filter @exclave/compiler test`, `pnpm --filter @exclave/hot-codec test`, `pnpm test`.
   Suggested commit message: `test: pin compiler and hot-codec ABI serializer parity`

2. Title: Decide ABI constants-only sharing after conformance coverage.
   Files likely touched: `packages/hot-codec/src/constants.ts`, `packages/hot-codec/src/index.ts`, `packages/compiler/src/version.ts` only if constants are imported, tests.
   Expected risk: medium.
   Expected payoff: high for table drift; limited for writer drift.
   Validation to run: compiler/hot-codec/conformance package tests plus full build.
   Suggested commit message: `refactor: share hot ABI id constants after parity coverage`

3. Title: Extract resource-protocol local boundary validators.
   Files likely touched: `packages/resource/src/resource-protocol.ts`, `packages/resource/src/validation.ts`, resource tests.
   Expected risk: low.
   Expected payoff: medium.
   Validation to run: `pnpm --filter @exclave/resource typecheck`, `pnpm --filter @exclave/resource test`.
   Suggested commit message: `refactor: centralize resource protocol validation helpers`

4. Title: Extract control-plane envelope local object-inspection helpers.
   Files likely touched: `packages/control-plane/src/control-envelope.ts`, optional `packages/control-plane/src/validation.ts`, control-plane tests.
   Expected risk: low to medium.
   Expected payoff: medium.
   Validation to run: `pnpm --filter @exclave/control-plane typecheck`, `pnpm --filter @exclave/control-plane test`.
   Suggested commit message: `refactor: centralize control-plane envelope validation helpers`

5. Title: Extract host-contract tests layout-manifest reader.
   Files likely touched: `packages/host-contract/tests/*fixture*`, `host-contract-integration.test.ts`, `host-contract-guarded-hot-read.test.ts`, one tests-only helper.
   Expected risk: low.
   Expected payoff: low to medium.
   Validation to run: `pnpm --filter @exclave/host-contract test`.
   Suggested commit message: `test: share host-contract layout fixture helpers`
