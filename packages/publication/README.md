# @exclave/publication

`@exclave/publication` owns the product-neutral publication subscription protocol and the in-memory modeled warm
publication runtime that future transports must preserve.

It defines epochless subscribe requests, epoch-establishing subscribe acknowledgements, typed subscribe failures,
surface-ready and subscription-invalidation events, and consumer states for applying warm framed-snapshot publications.
It also defines the versioned warm-frame attachment shape a host transport may carry to a consumer.

## What It Owns

- `SubscribePublicationRequest` and `SubscribePublicationAck`.
- `PublicationSubscribeFailure` discriminants, including `coldLaneNotRatified`,
  `surfaceDeferredNotReady`, and `surfaceUnavailable`.
- `PublicationSurfaceReadyEvent` and `PublicationSubscriptionInvalidatedEvent`.
- `SubscriptionId` and the v1 publication lane vocabulary: `warm | cold`.
- `PUBLICATION_TRANSPORT_ATTACHMENT_VERSION` and `PublicationFrameAttachment` for warm frame carriage.
- Helpers that validate attachment identity and adapt a typed attachment into modeled warm-frame delivery.
- `createWarmPublicationRuntime`, `subscribeWarmPublication`, `publishInitialWarmSnapshot`, and `publishWarmSnapshot`
  for modeling authority-side warm publication without transport.
- `applyPublicationFrameAttachmentToConsumer` for applying typed attachments through the warm frame and warm payload
  codecs.
- Explicit waiting, live, stale, failed, closed, and authority-side invalidated states for initial snapshot,
  invalidation, and rebind behavior.

## What It Does Not Own

- Binary warm frame encoding or decoding.
- Resource payloads or resource-handle reads.
- Hot handle open or hot binding lifecycle.
- Authority session issuance, epoch non-reuse, concrete transport, queues, IPC, or retry policy.
- Product authority logic, worker pools, Electron, Tauri, or IPC.

Cold subscriptions are represented in the protocol vocabulary but rejected with `coldLaneNotRatified` in v1.
