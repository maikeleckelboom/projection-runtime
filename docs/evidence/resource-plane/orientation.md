# Resource plane orientation

4 November 2026. Mission A from Projection Runtime Devkit v3; Mission B remains
separate. Both checkouts were clean before work. Upstream `dev`, `main`,
`origin/dev` and `origin/main` pointed to
`92c328818148bb4fe2c98cc90c5b4ec01f23310c`; work starts on
`feat/bounded-resource-plane` from `origin/main`. Dekzer remains read-only at
`440c7e7` on `main`. No evidence, branches or worktrees are removed.

## Actual owners

- `@exclave/resource` owns handles, immutable versions, capabilities, range
  validation and resource failures; it previously had no physical runtime.
- `@exclave/session` owns authority epoch/binding and invalidation vocabulary.
- `@exclave/control-plane` owns bounded metadata envelopes. Publication credit
  is replaceable state and cannot be reused to discard resource reads.
- The private warm integration owns an executable Rust process supervisor and
  sender-validated Electron port attachment. Its authority is simulated. Its
  blocking stdout writer can hold the authority mutex; its decoder repeatedly
  copies incomplete frames. Neither is a performance-qualified bulk adapter.
- Dekzer owns grants, source revisions, CUE identity, analysis, playback and
  exact presentation history. Native waveform work has separate A/B intents,
  shared immutable caches and bounded reply/page budgets. Numeric bodies cross
  JSON/Base64 in `waveform-model.ts`; worker raster results have their own
  resident budget. A read completion is not an audible output transition.
- Dekzer's `docs/decisions/projection-runtime-integration.md` deferred an extra
  warm stream after real measurements. This mission does not reverse it.

## Measured route decision

There is no upstream resource runtime to benchmark. The recorded baseline is
explicitly a resource-shaped, pre-serialized fixture over the existing
JSON/Base64/stdio pattern, not a Dekzer application benchmark. An optimized
real Rust process returns 262,144 identical bytes in 349,543 wire bytes. The
120 reads had a 1.824 ms median and 20.0352 ms maximum. Pausing the reader for
150 ms delayed control observation to 154.7951 ms. Raw samples and the small
probe are retained in `.cache/resource-plane-evidence/`.

The candidate therefore uses separate inherited pipes for control and bulk.
The private resource profile dedicates stdout to small control and stderr to
binary resource frames; stderr is **not** a diagnostic text stream in this
profile. No listener, filesystem capability, extra authority, native addon or
mapped-memory dependency is needed. The application can compose this adapter
with its existing native authority; the example launches a fixture authority.

`baseline-acceptance.json` freezes caps and control limits before candidate
implementation. Its hash is recorded with the evidence. No product transport
cutover or performance benefit is inferred from the fixture.

## Package disposition

All existing packages/crates remain. `base`, `session`, `control-plane`,
`resource` and host capability metadata retain their owners. The new resource
path must not import warm/hot codecs, compiler or conformance at runtime.
Schema/compiler/conformance and warm/publication retain their existing callers.
Hot binding/consumer/publisher/codec and Rust hot conformance remain isolated
research with compiler/fixture reverse dependencies. Cold remains deferred.
Removal has no demonstrated benefit for this slice and would increase recovery
cost. The evidence inventory records direct/transitive package dependents and
source size; build timing is measured by the final gate, not guessed per package.

## Qualification boundary

Windows x64, Node 24.15.0, pinned pnpm 11.1.2, installed Electron 43.1.1,
Rust 1.96.1. Baseline focused resource and existing integration unit checks:
14 files / 183 tests passed. Kit payload inventory: 99/99 hashes and sizes.
Actual Electron delivery, failure races and final gate are recorded separately.
GPU, Stems, acoustic latency and other platforms remain outside Mission A.
