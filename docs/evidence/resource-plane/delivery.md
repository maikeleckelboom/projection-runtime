# Mission A: bounded owned resources

This candidate implements one bounded, domain-neutral Rust → Electron main →
sandboxed renderer/worker resource path. Dekzer is unchanged. It is ready for
upstream review; it does not authorize product cutover or merge.

The resource crate and `@exclave/resource` retain immutable versions, checked
ranges, finite handles and explicit owned-result lifetimes. Control envelopes,
errors and session identity reuse their existing owners. The former integration
epoch implementation now lives in `authority-session`, without changed semantics.
No new third-party production dependency, audio authority, warm/hot stream,
waveform codec, GPU transport structure or mapping backend was introduced.

See the [consumption and physical-profile guide](../../../integration/electron-rust-resource/README.md),
[orientation](orientation.md), [package disposition](package-disposition.json),
[frozen acceptance](baseline-acceptance.json), [raw measurement samples](measurement.json)
and [Electron report](electron-proof.json). The final executable source candidate is
`f20b390bde7da2cd1733cfd1d22723c4ebfa0686`; later evidence-only commits do not
alter the runtime. The process measurement and broad gate used
`421f3305fa6fe72ea262a24fc7faa6dde6ba51e6`. Their production code is identical;
the intervening change only presents final Electron proof results before capture.

## Canonical handoff gates

These results apply to the owned-byte profile on the measured Windows target.
The source handoff's original gate inventory remains untouched.

| Gate | Result and evidence |
| --- | --- |
| G-ORIENT | Passed: actual clean branches, owners, dependencies, route and baseline recorded in orientation and package inventory. |
| G-UPSTREAM-API | Passed for owned bytes: open/read/close, revocation and session fencing, immutable versions, shared A/B backing, cancellation and exactly-once receipts. Borrowed/mapped delivery is explicitly unsupported. |
| G-UPSTREAM-BYTES | Passed on Windows x64: optimized Rust process, validated EXRB framing, trusted broker and sandboxed Electron renderer/worker deliver SHA-256-identical bytes. Main-to-renderer cloning and worker detachment are observed. |
| G-CONTROL | Passed within frozen fixture limits: 20 controls during ten 150 ms bulk stalls; separate admission/application/reply observations, plus full control-queue lifecycle regression. |
| G-BUDGETS | Passed for application-owned accounting in the tested workloads: quota rejection, independent cancellation, late result/duplicate receipt safety, bounded visible/background scheduling, eight retention rounds and actual reload/death/recovery. No long-duration process-memory guarantee is inferred. |
| G-GPU-FEASIBILITY, G-PRODUCT-PARITY, G-PRODUCT-PERF, G-RENDERER, G-STEMS-PRESENT | Unrun; separate product work. |
| G-PRODUCT-CONTRACT, G-CUTOVER, G-STEMS-SEMANTICS | Open; no product decision promoted here. |
| G-RESEARCH | Out of scope; no research artifact or branch cleanup. |

## Measured transport result

Host: Windows 10.0.26300 x64, Ryzen 7 8845HS, Node 24.15.0, pnpm 11.1.2,
Rust 1.96.1 release build. Electron proof: Electron 43.1.1, Chromium
150.0.7871.114, embedded Node 24.18.0. These are local samples, not tail-latency
guarantees. Acceptance was frozen before candidate implementation; its SHA-256 is
`fc207f681291663d501abd7e0b2730cf6166d12053ec8d3b2b60841d1fbe70fa`.

There was no existing upstream resource runtime. The baseline is a real optimized
Rust process returning identical pre-serialized fixture bytes through the existing
JSON/Base64/stdio pattern. It is not a measurement of Dekzer. The reproducible
paired probe alternates baseline/candidate order for 200 reads each, with a 256 KiB
body and matching SHA-256.

| Rust-process request to Node-owned buffer | JSON/Base64 fixture | Binary candidate |
| --- | ---: | ---: |
| Upper sample median | 1.2197 ms | 0.5390 ms |
| Sample q95 | 3.0192 ms | 1.1281 ms |
| Maximum observed | 4.2148 ms | 2.5594 ms |
| Bulk response bytes per read | 349,543 | 262,192 |

The paired probe uses sorted samples at zero-based `floor(n × p)` for quantiles:
with 200 samples, these are the 101st and 191st observations. The reported upper
sample median is not the mean of the two central observations.

Bulk response size fell **24.9901%**, exceeding the predeclared 24% threshold.
This comparison excludes small control/receipt envelopes. The candidate's paired
window also recorded 85,795 host→native and 41,903 native→host control bytes across
200 reads; the raw report includes both directions' counters at the host. No latency speedup was
required by acceptance, and these samples do not establish a product benefit.

The separate bundled Electron run observed 120 renderer `read()`-to-owned-buffer
samples: median 1.30 ms, sample p95 1.90 ms, maximum 2.80 ms. That boundary includes
the renderer/broker round trip and main-to-renderer clone. It excludes painting,
GPU upload and audio output; it has no paired Electron baseline. The final window
is shown without focus only after measurements/recovery checks, to capture a fresh
compositor frame. The [verified screenshot](electron-proof.png) is evidence of
completion, not a presentation-latency measurement.

## Control and memory

During ten 150 ms bulk-reader stalls, two urgent fixture commands per stall had:

| Boundary | Maximum observed | Frozen limit |
| --- | ---: | ---: |
| Host admission | 0.0419 ms | 20 ms |
| Native fixture application, calibrated upper bound | 1.2544 ms | 75 ms |
| Host reply observation | 0.4130 ms | 75 ms |

Thirty clock pings select the minimum-RTT offset interval, widened by 1 ms for this
short same-host experiment. Negative lower bounds reflect calibration uncertainty;
they do not imply negative physical latency. This is not an audio clock or an
output-frame applied boundary. A separate real-process regression pauses control
stdout, fills all 32 command slots, releases four chunks and disconnects another
client; the remaining client and native authority survive. Internal receipts and
disconnects wait in a bounded ten-item metadata queue and retain native credit
until acknowledged.

Admission caps are explicit: 256 KiB chunks; four transfers/1 MiB per client and
eight/2 MiB globally; 16 handles per client and 32 globally; 8 MiB native backing;
2 MiB owned consumer allocations per client and 4 MiB across two clients. Ordinary
controls have 24 slots and all controls share 32, preserving eight urgent slots.
Background admission leaves visible capacity, and a waiting background chunk is
served after at most three visible queued chunks. Already-written bytes cannot be
reordered.

Each of eight retention rounds performed 112 completed and 16 cancelled reads.
After every round, native handles, clients, transfers and in-flight bytes were
zero; the intentional 2 MiB fixture backing remained constant. The host's transfer
ledger and pending-control count returned to zero with no duplicate settlement.
Thus tracked retained ownership did not accumulate. Explicit GC was used only
between rounds to make memory observations comparable, not to enforce admission.

Observed host RSS ranged 71,651,328–73,195,520 bytes and ArrayBuffer accounting
2,230,184–2,230,187 bytes. Native working set ranged 6,500,352–6,504,448 bytes and
private memory 2,953,216–2,957,312 bytes. RSS grew somewhat and is not a unique-byte
ledger; these finite samples do not prove a zero long-run RSS slope. No GPU/driver
memory was measured. The Electron proof separately interrupted two real reads at
reload, invalidated retained bytes on native death, recovered with a new epoch,
revoked after handle close, ended with zero retained consumer/resource bytes and
confirmed both native PIDs had exited.

## Ownership and copies

Native A/B handles share an `Arc<[u8]>`; the writer uses its immutable slice without
body repacking. The decoder validates the admitted frame header before one owned
body allocation, then copies incoming body bytes once, even under byte-sized
fragmentation. Metadata/header copies and kernel/runtime internals remain separate.

Electron `MessagePortMain` clones the owned body to the renderer. In the real
proof, the sender retains its buffer and a fixture-only mutation after posting
does not affect the renderer/worker hash. The renderer transfers its exclusive
ArrayBuffer to a DOM worker and observes sender detachment. Payloads never cross
contextBridge. This is **not** end-to-end zero-copy.

Normal close forbids new reads while owned bytes remain valid. Revocation/session
loss fences adoption without erasing allocations. Consumer cancellation does not
revoke A/B backing. Writer completion plus receiver receipt retires native transfer
credit; consumer release retires its resident budget. Callers must drop aliases
after release, and direct trusted `ResourceProcess` users must supply resident
ownership accounting. Mapping leases and GPU retirement are not implemented.

## Validation and independent review

The canonical `pnpm verify` run on the frozen production candidate passed full
typechecking/build, **46 TypeScript files / 973 tests**, **100 Rust tests**, and
both real Electron/Rust proofs. It then exited nonzero on formatting of the copied
baseline-samples JSON. The [aggregate log](canonical-verify.log) preserves its
content with trailing whitespace/line endings normalized for Git; the byte-original
remains in the local evidence cache. It is **not reported as an aggregate pass**.

Only that JSON was reformatted. Repository-wide Biome then passed; file-name and
remaining canonical source guards passed separately. The later screenshot-only
fixture fix passed its typecheck, Biome, rebuilt Electron proof and visual review.
Final evidence-only additions receive formatting/file-name/diff checks. The
aggregate was not rerun solely to replace its nonzero result.

Affected crates passed Clippy with `-D warnings`. An additional whole-workspace
Clippy attempt hit the existing `manual_is_multiple_of` lint in
`crates/hot-abi-conformance/src/main.rs:1489` under Rust 1.96.1; that unrelated
source is unchanged. No hosted CI was enabled.

Two independent agents reviewed architecture/ownership and implementation risks.
All actionable findings were fixed; the final implementation reviewer independently
passed 11 real Rust-process tests and 14 framing/consumer tests, then reviewed the
small capture correction with no remaining actionable finding. Evidence provenance
and exact commands are recorded in [validation](validation.json).

## Consumption and remaining qualification

The branch is a candidate for the separate product mission, which must explicitly
pin the reviewed upstream commit. Use the documented `ResourceClient` API and
bundled `@exclave/resource/node` entry, or compose the Rust registry/writer into the
existing native service. Source grants, source revision/CUE semantics, payload
meaning and playback authority remain product-owned.

The profile uses dedicated stderr binary output and cannot mix diagnostic text
there. Applications must provide a separate bounded diagnostic sink. The proof is
a colocated release native binary plus bundled/minified scripts launched with the
pinned Electron distribution; installer/signing, non-Windows hosts, long DJ
sessions, product contention, acoustic/native audio deadlines, WebGPU residency
and Stems remain unqualified. Product GPU feasibility precedes product payload
freeze and cutover. Mission A stops at an unmerged upstream PR.
