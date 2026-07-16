import {
  applyWarmFrameToPublicationConsumer,
  createPublicationFrameAttachmentFromAck,
  createPublicationWarmFrameDelivery,
  type PublicationConsumerState,
  type SubscribePublicationAck,
} from "@exclave/publication";
import { decodeWarmLaneFrame } from "@exclave/warm";
import type { DeckRuntimePublication } from "./bridgeTypes.js";
import {
  type DeckRuntimeWarmSnapshot,
  decodeDeckRuntimeWarmPayload,
  WARM_STREAM_KEY,
} from "./contract.js";
import type { HostToPreloadMessage } from "./portProtocol.js";
import { encodeU64Hex } from "./wireValues.js";

type PublicationMessage = Extract<HostToPreloadMessage, { readonly kind: "publication" }>;

export type AppliedDeckRuntimePublication = {
  readonly consumer: PublicationConsumerState<DeckRuntimeWarmSnapshot>;
  readonly publication: DeckRuntimePublication;
  readonly publicationSequence: string;
  readonly previousPublicationSequence: bigint;
  readonly skippedPublicationCount: number;
};

export function applyDeckRuntimePublication(input: {
  readonly consumer: PublicationConsumerState<DeckRuntimeWarmSnapshot>;
  readonly ack: SubscribePublicationAck;
  readonly message: PublicationMessage;
  readonly previousPublicationSequence: bigint | null;
  readonly skippedPublicationCount: number;
}): AppliedDeckRuntimePublication {
  const attachment = validateAttachmentForAck(input.ack, input.message);
  const delivery = createPublicationWarmFrameDelivery(attachment);
  const applied = applyWarmFrameToPublicationConsumer(
    input.consumer,
    delivery,
    decodeDeckRuntimeWarmPayload,
  );
  if (!applied.ok) {
    throw new Error(`warm publication rejected: ${JSON.stringify(applied.failure)}`);
  }
  if (applied.state.kind !== "live") {
    throw new Error("applied warm publication did not produce live consumer state");
  }

  const frame = applied.state.latestFrame;
  const sequence = frame.publicationSequence;
  let skippedPublicationCount = input.skippedPublicationCount;
  if (
    input.previousPublicationSequence !== null &&
    sequence > input.previousPublicationSequence + 1n
  ) {
    const skipped = sequence - input.previousPublicationSequence - 1n;
    skippedPublicationCount += Number(
      skipped > BigInt(Number.MAX_SAFE_INTEGER) ? BigInt(Number.MAX_SAFE_INTEGER) : skipped,
    );
  }
  const publicationSequence = encodeU64Hex(sequence);

  return {
    consumer: applied.state,
    publicationSequence,
    previousPublicationSequence: sequence,
    skippedPublicationCount,
    publication: {
      authorityEpoch: input.message.attachment.authorityEpoch,
      subscriptionId: input.message.attachment.subscriptionId,
      contractKey: frame.contractKey,
      projectionInstanceKey: frame.projectionInstanceKey,
      baselineEpoch: frame.baselineEpoch,
      continuityGeneration: frame.continuityGeneration,
      publicationSequence,
      skippedPublicationCount,
      snapshot: applied.state.latestProjectionState,
    },
  };
}

export function validateRetiredDeckRuntimePublication(
  ack: SubscribePublicationAck,
  message: PublicationMessage,
): void {
  const attachment = validateAttachmentForAck(ack, message);
  const decoded = decodeWarmLaneFrame(attachment.frameBytes);
  if (!decoded.ok) throw new Error(`retired warm frame rejected: ${decoded.failure.detail}`);
  decodeDeckRuntimeWarmPayload(decoded.frame.payload);
}

export function acknowledgeThenNotify<T>(input: {
  readonly acknowledge: () => void;
  readonly listeners: Iterable<(value: T) => void>;
  readonly notify: (listener: (value: T) => void, value: T) => void;
  readonly value: T;
}): void {
  performBeforeNotification(input.acknowledge, () => {
    for (const listener of input.listeners) input.notify(listener, input.value);
  });
}

export function performBeforeNotification(action: () => void, notify: () => void): void {
  action();
  notify();
}

function validateAttachmentForAck(ack: SubscribePublicationAck, message: PublicationMessage) {
  const attachment = createPublicationFrameAttachmentFromAck({
    streamKey: WARM_STREAM_KEY,
    ack,
    frameBytes: message.frameBytes,
  });
  if (
    message.attachment.kind !== attachment.kind ||
    message.attachment.attachmentVersion !== attachment.attachmentVersion ||
    message.attachment.streamKey !== attachment.streamKey ||
    message.attachment.subscriptionId !== attachment.subscriptionId ||
    message.attachment.authorityEpoch !== attachment.authorityEpoch.toString(10) ||
    message.attachment.contractKey !== attachment.contractKey ||
    message.attachment.projectionInstanceKey !== attachment.projectionInstanceKey ||
    message.attachment.lane !== attachment.lane
  ) {
    throw new Error("publication attachment does not match its subscribe acknowledgement");
  }
  return attachment;
}
