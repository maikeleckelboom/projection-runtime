import type { AuthorityEpoch } from "@exclave/session";
import { decodeWarmLaneFrame, type WarmFrameCodecOptions, type WarmLaneFrame } from "@exclave/warm";
import { throwInputRejected } from "./errors";
import {
  type ContractKey,
  createSubscribePublicationAck,
  type ProjectionInstanceKey,
  type PublicationLane,
  type SubscribePublicationAck,
  type SubscriptionId,
} from "./protocol";
import {
  assertExactRootKeys,
  assertNonEmptyString,
  assertNonNegativeBigInt,
  assertPlainObject,
} from "./validation";

export const PUBLICATION_TRANSPORT_ATTACHMENT_VERSION = 1 as const;

export type PublicationTransportAttachmentVersion = typeof PUBLICATION_TRANSPORT_ATTACHMENT_VERSION;

export type PublicationStreamKey = string;

export type PublicationFrameAttachment = {
  readonly kind: "publication.warmFrame";
  readonly attachmentVersion: PublicationTransportAttachmentVersion;
  readonly streamKey: PublicationStreamKey;
  readonly subscriptionId: SubscriptionId;
  readonly authorityEpoch: AuthorityEpoch;
  readonly contractKey: ContractKey;
  readonly projectionInstanceKey: ProjectionInstanceKey;
  readonly lane: Extract<PublicationLane, "warm">;
  readonly frameBytes: Uint8Array;
};

export type PublicationWarmFrameDelivery = {
  readonly subscriptionId: SubscriptionId;
  readonly authorityEpoch: AuthorityEpoch;
  readonly bytes: Uint8Array;
};

const ATTACHMENT_KEYS: ReadonlySet<string> = new Set([
  "kind",
  "attachmentVersion",
  "streamKey",
  "subscriptionId",
  "authorityEpoch",
  "contractKey",
  "projectionInstanceKey",
  "lane",
  "frameBytes",
]);

export function createPublicationFrameAttachment(
  input: PublicationFrameAttachment,
  options: WarmFrameCodecOptions = {},
): PublicationFrameAttachment {
  const obj = assertPlainObject(input, "publication frame attachment");
  assertExactRootKeys(obj, ATTACHMENT_KEYS, "publication frame attachment");

  if (obj.kind !== "publication.warmFrame") {
    throwInputRejected(
      `publication frame attachment kind must be "publication.warmFrame", got ${JSON.stringify(obj.kind)}`,
    );
  }

  if (obj.attachmentVersion !== PUBLICATION_TRANSPORT_ATTACHMENT_VERSION) {
    throwInputRejected(
      `publication frame attachment attachmentVersion must be ${PUBLICATION_TRANSPORT_ATTACHMENT_VERSION}, got ${JSON.stringify(obj.attachmentVersion)}`,
    );
  }

  const streamKey = assertNonEmptyString(obj.streamKey, "attachment.streamKey");
  const subscriptionId = assertNonEmptyString(obj.subscriptionId, "attachment.subscriptionId");
  const authorityEpoch = assertNonNegativeBigInt(obj.authorityEpoch, "attachment.authorityEpoch");
  const contractKey = assertNonEmptyString(obj.contractKey, "attachment.contractKey");
  const projectionInstanceKey = assertNonEmptyString(
    obj.projectionInstanceKey,
    "attachment.projectionInstanceKey",
  );
  if (obj.lane !== "warm") {
    throwInputRejected('attachment.lane must be "warm"');
  }
  if (!(obj.frameBytes instanceof Uint8Array)) {
    throwInputRejected("attachment.frameBytes must be warm frame bytes");
  }

  const frameBytes = new Uint8Array(obj.frameBytes);
  const frame = decodeWarmFrameForAttachment(frameBytes, options);
  assertFrameMatchesAttachment(frame, contractKey, projectionInstanceKey);

  return {
    kind: "publication.warmFrame",
    attachmentVersion: PUBLICATION_TRANSPORT_ATTACHMENT_VERSION,
    streamKey,
    subscriptionId,
    authorityEpoch,
    contractKey,
    projectionInstanceKey,
    lane: "warm",
    frameBytes,
  };
}

export function createPublicationFrameAttachmentFromAck(
  input: {
    readonly streamKey: PublicationStreamKey;
    readonly ack: SubscribePublicationAck;
    readonly frameBytes: Uint8Array;
  },
  options: WarmFrameCodecOptions = {},
): PublicationFrameAttachment {
  const obj = assertPlainObject(input, "publication frame attachment input");
  assertExactRootKeys(
    obj,
    new Set(["streamKey", "ack", "frameBytes"]),
    "publication frame attachment input",
  );
  const ack = createSubscribePublicationAck(obj.ack as SubscribePublicationAck);

  if (ack.lane !== "warm") {
    throwInputRejected('publication frame attachments are only defined for lane "warm" in v1');
  }

  const attachment = createPublicationFrameAttachment(
    {
      kind: "publication.warmFrame",
      attachmentVersion: PUBLICATION_TRANSPORT_ATTACHMENT_VERSION,
      streamKey: assertNonEmptyString(obj.streamKey, "attachment.streamKey"),
      subscriptionId: ack.subscriptionId,
      authorityEpoch: ack.authorityEpoch,
      contractKey: ack.contractKey,
      projectionInstanceKey: ack.projectionInstanceKey,
      lane: "warm",
      frameBytes: obj.frameBytes as Uint8Array,
    },
    options,
  );

  const frame = decodeWarmFrameForAttachment(attachment.frameBytes, options);
  if (frame.semanticVersion !== ack.semanticVersion) {
    throwInputRejected("attachment frame semanticVersion must match subscribe ack");
  }
  if (frame.warmCodecVersion !== ack.laneVersion) {
    throwInputRejected("attachment frame warmCodecVersion must match subscribe ack laneVersion");
  }
  if (frame.baselineEpoch !== ack.baselineEpoch) {
    throwInputRejected("attachment frame baselineEpoch must match subscribe ack");
  }
  if (frame.continuityGeneration !== ack.continuityGeneration) {
    throwInputRejected("attachment frame continuityGeneration must match subscribe ack");
  }

  return attachment;
}

export function createPublicationWarmFrameDelivery(
  input: PublicationFrameAttachment,
  options: WarmFrameCodecOptions = {},
): PublicationWarmFrameDelivery {
  const attachment = createPublicationFrameAttachment(input, options);
  return {
    subscriptionId: attachment.subscriptionId,
    authorityEpoch: attachment.authorityEpoch,
    bytes: attachment.frameBytes,
  };
}

function decodeWarmFrameForAttachment(
  frameBytes: Uint8Array,
  options: WarmFrameCodecOptions,
): WarmLaneFrame {
  const decoded = decodeWarmLaneFrame(frameBytes, options);
  if (!decoded.ok) {
    throwInputRejected(
      `attachment.frameBytes must decode as a warm publication frame: ${decoded.failure.detail}`,
    );
  }
  return decoded.frame;
}

function assertFrameMatchesAttachment(
  frame: WarmLaneFrame,
  contractKey: ContractKey,
  projectionInstanceKey: ProjectionInstanceKey,
): void {
  if (frame.contractKey !== contractKey) {
    throwInputRejected("attachment frame contractKey must match attachment.contractKey");
  }
  if (frame.projectionInstanceKey !== projectionInstanceKey) {
    throwInputRejected(
      "attachment frame projectionInstanceKey must match attachment.projectionInstanceKey",
    );
  }
}
