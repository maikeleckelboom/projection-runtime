import { throwInputRejected } from "./errors";
import { createOpenResourceReply, type OpenResourceReply } from "./resource-protocol";

export type OpaqueResourceDescriptor = {
  readonly byteLength: string;
  readonly payloadVersion: number;
};
export type OpaqueResourceHandle = OpenResourceReply<OpaqueResourceDescriptor>;

export function resourceRecord(value: unknown): Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value))
    throwInputRejected("expected resource object");
  return value as Record<string, unknown>;
}
export function resourceU64(value: unknown): bigint {
  if (typeof value !== "string" || !/^(0|[1-9][0-9]{0,19})$/.test(value))
    throwInputRejected("expected canonical resource u64");
  const result = BigInt(value);
  if (result > 0xffff_ffff_ffff_ffffn) throwInputRejected("resource integer exceeds u64");
  return result;
}
export function resourceString(value: unknown): string {
  if (typeof value !== "string" || value.length === 0 || value.length > 128)
    throwInputRejected("invalid resource identifier");
  return value;
}
export function decodeOpaqueResourceHandle(value: unknown): OpaqueResourceHandle {
  const v = resourceRecord(value);
  const payloadVersion = v.payloadVersion;
  if (
    !Number.isSafeInteger(payloadVersion) ||
    (payloadVersion as number) < 1 ||
    (payloadVersion as number) > 0xffff_ffff
  )
    throwInputRejected("invalid payload version");
  const byteLength = resourceU64(v.byteLength);
  const epoch = resourceU64(v.authorityEpoch);
  const version = resourceU64(v.resourceVersion);
  const max = v.maxChunkBytes;
  if (
    epoch === 0n ||
    version === 0n ||
    !Number.isSafeInteger(max) ||
    (max as number) < 1 ||
    (max as number) > 262144
  )
    throwInputRejected("invalid resource capabilities");
  return createOpenResourceReply({
    handleId: resourceString(v.handleId),
    authorityEpoch: epoch,
    resourceKind: resourceString(v.resourceKind),
    resourceKey: resourceString(v.resourceKey),
    resourceVersion: version,
    descriptor: { byteLength: byteLength.toString(), payloadVersion: payloadVersion as number },
    capabilities: {
      canReadChunks: true,
      canMapWindows: false,
      totalByteLength: byteLength,
      maxChunkBytes: max as number,
    },
  });
}
