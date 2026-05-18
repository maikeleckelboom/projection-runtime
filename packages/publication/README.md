# @exclave/publication

`@exclave/publication` owns the product-neutral publication subscription protocol and a minimal modeled warm
subscription lifecycle for tests.

It defines epochless subscribe requests, epoch-establishing subscribe acknowledgements, typed subscribe failures,
surface-ready and subscription-invalidation events, and consumer states for applying warm framed-snapshot publications.

## What It Owns

- `SubscribePublicationRequest` and `SubscribePublicationAck`.
- `PublicationSubscribeFailure` discriminants, including `coldLaneNotRatified`,
  `surfaceDeferredNotReady`, and `surfaceUnavailable`.
- `PublicationSurfaceReadyEvent` and `PublicationSubscriptionInvalidatedEvent`.
- `SubscriptionId` and the v1 publication lane vocabulary: `warm | cold`.
- A small modeled subscription lifecycle that can prove ack, initial warm snapshot, invalidation, and rebind behavior.

## What It Does Not Own

- Binary warm frame encoding or decoding.
- Resource payloads or resource-handle reads.
- Hot handle open or hot binding lifecycle.
- Authority session issuance, epoch non-reuse, or transport.
- Product authority logic, worker pools, Electron, Tauri, or IPC.

Cold subscriptions are represented in the protocol vocabulary but rejected with `coldLaneNotRatified` in v1.
