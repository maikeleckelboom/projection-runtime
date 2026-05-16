# @exclave/session

Product-neutral binding validity fence.

Answers whether an already-opened binding may be used for the expected
authorityKey, surfaceKey, and authorityEpoch.

Seqlock proves a publication was not torn.
Session validity proves the binding still belongs to the current authority
epoch.

Invalid, closed, opening, and stale bindings fail before guarded reads run.

@exclave/session does not:
- open bindings
- allocate regions
- publish hot bytes
- read resources
- transport messages
- manage app lifecycle
- own product authority semantics
