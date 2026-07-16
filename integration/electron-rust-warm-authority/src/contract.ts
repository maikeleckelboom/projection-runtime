import {
  decodeWarmSnapshotPayload,
  type WarmSnapshotPayloadField,
  type WarmSnapshotPayloadManifest,
} from "@exclave/warm";
import {
  type DeckRuntimeWarmSnapshot,
  deckRuntimeConsumerBindingMetadata,
  deckRuntimeFields,
} from "../../../fixtures/projection-runtime/deck-runtime-v0/generated/consumer-binding.ts";
import resolvedContract from "../../../fixtures/projection-runtime/deck-runtime-v0/resolved-contract.json" with {
  type: "json",
};
import { decodeU64Hex } from "./wireValues.js";

export const AUTHORITY_KEY = "fixture.deckRuntime.authority";
export const PROJECTION_INSTANCE_KEY = "deck-runtime-v0.instance";
export const WARM_STREAM_KEY = "deck-runtime-v0.warm";
export const CONTROL_ENDPOINT_KEY = "deck-runtime-v0.control";
export const SET_TEMPO_RATIO_OPERATION_KEY = "deck.setTempoRatio";

const resolvedWarmManifest = resolvedContract.laneManifests.warm;
const resolvedSemanticVersion = decodeU64Hex(
  resolvedContract.semanticVersion,
  "resolved semanticVersion",
);
const resolvedWarmCodecVersion = decodeU64Hex(
  resolvedContract.warmCodecVersion,
  "resolved warmCodecVersion",
);

if (resolvedContract.manifest.key !== deckRuntimeConsumerBindingMetadata.contractKey) {
  throw new Error("generated deck runtime contract keys disagree");
}
if (resolvedSemanticVersion !== deckRuntimeConsumerBindingMetadata.semanticVersion) {
  throw new Error("generated deck runtime semantic versions disagree");
}
if (resolvedWarmCodecVersion !== deckRuntimeConsumerBindingMetadata.warmCodecVersion) {
  throw new Error("generated deck runtime warm codec versions disagree");
}

const manifestFields =
  resolvedWarmManifest.fields as unknown as readonly WarmSnapshotPayloadField[];

export const deckRuntimeWarmManifest: WarmSnapshotPayloadManifest = Object.freeze({
  warmCodecVersion: resolvedWarmCodecVersion,
  fields: manifestFields,
});

export const DECK_RUNTIME_CONTRACT_KEY = deckRuntimeConsumerBindingMetadata.contractKey;
export const DECK_RUNTIME_SEMANTIC_VERSION = deckRuntimeConsumerBindingMetadata.semanticVersion;
export const DECK_RUNTIME_WARM_CODEC_VERSION = deckRuntimeConsumerBindingMetadata.warmCodecVersion;

const generatedFieldPaths = Object.values(deckRuntimeFields).toSorted();
const manifestFieldPaths = deckRuntimeWarmManifest.fields.map((field) => field.dotPath).toSorted();

if (JSON.stringify(generatedFieldPaths) !== JSON.stringify(manifestFieldPaths)) {
  throw new Error("generated deck runtime field identities and warm manifest disagree");
}

export function decodeDeckRuntimeWarmPayload(payload: Uint8Array): DeckRuntimeWarmSnapshot {
  const decoded = decodeWarmSnapshotPayload(deckRuntimeWarmManifest, payload);
  if (!decoded.ok) {
    throw new Error(
      `deck runtime warm payload rejected at ${decoded.failure.path ?? "payload"}: ${decoded.failure.detail}`,
    );
  }

  const decodedFieldPaths = Object.keys(decoded.snapshot).toSorted();
  if (JSON.stringify(decodedFieldPaths) !== JSON.stringify(generatedFieldPaths)) {
    throw new Error("decoded deck runtime field identities do not match generated identities");
  }

  return decoded.snapshot as unknown as DeckRuntimeWarmSnapshot;
}

export type { DeckRuntimeWarmSnapshot };
