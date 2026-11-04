# Native opaque resource owner

`ResourceAuthority` adopts immutable `Arc<[u8]>` allocations after explicit
resource/byte admission. Product code owns source authorization and serialization.
Call `connect`, `open` and `read` only from the authorized adapter. Existing
authority epochs are supplied by the same native session; the registry does not
create another timing or process authority.

A `Transfer` is the writer's exclusive backing owner. `wire::write_transfer`
borrows it for bounded header/slice writes. On successful physical completion,
pass the transfer by value to `ResourceAuthority::written`. A host receipt may
race that operation; capacity returns only after both. `reject_unsubmitted`
consumes a transfer that was never submitted. Failed/partial physical writes
require connection/authority teardown, not a fabricated success receipt.

The registry rejects completion from another registry, even if epochs and
numeric transfer IDs coincide. Transfer metadata is private and cannot be
changed after range validation. Normal close does not release accepted transfers.
Revocation retains unavailable backing until the last transfer completes; A/B
handles share the registered backing with independent interests.

The current implementation owns in-memory immutable resources. It does not
implement borrowed mappings, file IO, a media cache, a decoder or an audio
callback. `Limits` separates total resident capacity from individual chunk and
in-flight limits. External aliases retained by the producer remain the
producer's ownership obligation.

See the [Electron profile](../../integration/electron-rust-resource/README.md)
for wire details, consumption and qualification evidence.
