import type {
  AuthorityEpoch,
  AuthorityNotReadyFailure,
  AuthorityUnavailableFailure,
  SessionMismatchFailure,
} from "@exclave/session";
import { throwInputRejected } from "./errors";

export type ResourceKind = string;
export type ResourceKey = string;
export type ResourceHandleId = string;
export type ResourceVersion = bigint;
export type ResourceMappingId = string;

declare const RESOURCE_OPEN_INPUT_TYPE: unique symbol;
declare const RESOURCE_DESCRIPTOR_TYPE: unique symbol;

export type ResourceContract<TOpen, TDescriptor> = {
  readonly resourceKind: ResourceKind;
  readonly [RESOURCE_OPEN_INPUT_TYPE]?: TOpen;
  readonly [RESOURCE_DESCRIPTOR_TYPE]?: TDescriptor;
};

export function defineResourceContract<TOpen, TDescriptor>(input: {
  readonly resourceKind: ResourceKind;
}): ResourceContract<TOpen, TDescriptor> {
  const obj = assertPlainObject(input, "resource contract");
  assertExactRootKeys(obj, new Set(["resourceKind"]), "resource contract");
  return {
    resourceKind: assertNonEmptyString(obj.resourceKind, "contract.resourceKind"),
  } as ResourceContract<TOpen, TDescriptor>;
}

export type ResourceCapabilities =
  | {
      readonly canReadChunks: true;
      readonly canMapWindows: true;
      readonly totalByteLength?: bigint;
      readonly maxChunkBytes: number;
      readonly maxMappedWindowBytes: number;
    }
  | {
      readonly canReadChunks: true;
      readonly canMapWindows: false;
      readonly totalByteLength?: bigint;
      readonly maxChunkBytes: number;
    }
  | {
      readonly canReadChunks: false;
      readonly canMapWindows: true;
      readonly totalByteLength?: bigint;
      readonly maxMappedWindowBytes: number;
    }
  | {
      readonly canReadChunks: false;
      readonly canMapWindows: false;
      readonly totalByteLength?: bigint;
    };

export type ResourceHandle = {
  readonly handleId: ResourceHandleId;
  readonly authorityEpoch: AuthorityEpoch;
  readonly resourceKind: ResourceKind;
  readonly resourceKey: ResourceKey;
  readonly resourceVersion: ResourceVersion;
  readonly capabilities: ResourceCapabilities;
};

export type OpenResourceRequest<TOpen> = {
  readonly resourceKind: ResourceKind;
  readonly input: TOpen;
};

export type OpenResourceReply<TDescriptor> = ResourceHandle & {
  readonly descriptor: TDescriptor;
};

export type ResourceBackpressure = {
  readonly kind: "resourceBackpressure";
  readonly scope: "handle" | "consumer" | "authority";
  readonly retryAfterMs?: number;
};

export type OpenResourceResult<TDescriptor> =
  | { readonly ok: true; readonly reply: OpenResourceReply<TDescriptor> }
  | { readonly ok: false; readonly failure: ResourceFailure | ResourceBackpressure };

export type ReadResourceChunkRequest = {
  readonly handleId: ResourceHandleId;
  readonly authorityEpoch: AuthorityEpoch;
  readonly offsetBytes: bigint;
  readonly lengthBytes: number;
};

export type ReadResourceChunkReply = {
  readonly handleId: ResourceHandleId;
  readonly authorityEpoch: AuthorityEpoch;
  readonly resourceVersion: ResourceVersion;
  readonly offsetBytes: bigint;
  readonly payload: Uint8Array;
  readonly eof: boolean;
};

export type ReadResourceChunkResult =
  | { readonly ok: true; readonly reply: ReadResourceChunkReply }
  | { readonly ok: false; readonly failure: ResourceFailure | ResourceBackpressure };

export type ResourceMappingDescriptor =
  | {
      readonly kind: "sharedArrayBuffer";
      readonly byteLength: number;
    }
  | {
      readonly kind: "hostMappedRegion";
      readonly token: string;
      readonly byteLength: number;
    };

export type MapResourceWindowRequest = {
  readonly handleId: ResourceHandleId;
  readonly authorityEpoch: AuthorityEpoch;
  readonly offsetBytes: bigint;
  readonly lengthBytes: number;
};

export type MapResourceWindowReply = {
  readonly handleId: ResourceHandleId;
  readonly authorityEpoch: AuthorityEpoch;
  readonly resourceVersion: ResourceVersion;
  readonly mappingId: ResourceMappingId;
  readonly offsetBytes: bigint;
  readonly lengthBytes: number;
  readonly readonly: true;
  readonly mappingDescriptor: ResourceMappingDescriptor;
};

export type MapResourceWindowResult =
  | { readonly ok: true; readonly reply: MapResourceWindowReply }
  | { readonly ok: false; readonly failure: ResourceFailure | ResourceBackpressure };

export type CloseResourceMappingRequest = {
  readonly handleId: ResourceHandleId;
  readonly mappingId: ResourceMappingId;
  readonly authorityEpoch: AuthorityEpoch;
};

export type CloseResourceMappingResult =
  | { readonly ok: true }
  | { readonly ok: false; readonly failure: ResourceFailure };

export type CloseResourceHandleRequest = {
  readonly handleId: ResourceHandleId;
  readonly authorityEpoch: AuthorityEpoch;
};

export type CloseResourceHandleResult =
  | { readonly ok: true }
  | { readonly ok: false; readonly failure: ResourceFailure };

export type ResourceHandleInvalidatedEvent = {
  readonly kind: "resourceHandleInvalidated";
  readonly authorityEpoch: AuthorityEpoch;
  readonly handleId: ResourceHandleId;
  readonly reason:
    | "authorityRestart"
    | "resourceReplaced"
    | "revoked"
    | "expired"
    | "resourceUnavailable";
};

export type ResourceFailure =
  | SessionMismatchFailure
  | {
      readonly kind: "handleInvalid";
      readonly handleId: ResourceHandleId;
      readonly reason:
        | "revoked"
        | "expired"
        | "staleEpoch"
        | "resourceReplaced"
        | "resourceUnavailable"
        | "closed";
    }
  | {
      readonly kind: "resourceUnavailable";
      readonly resourceKind: ResourceKind;
      readonly resourceKey?: ResourceKey;
    }
  | AuthorityUnavailableFailure
  | AuthorityNotReadyFailure
  | {
      readonly kind: "rangeInvalid";
      readonly offsetBytes: bigint;
      readonly lengthBytes: number;
    }
  | {
      readonly kind: "chunkTooLarge";
      readonly requestedBytes: number;
      readonly maxChunkBytes: number;
    }
  | {
      readonly kind: "mappingInvalid";
      readonly handleId: ResourceHandleId;
      readonly mappingId: ResourceMappingId;
      readonly reason: "unknown" | "closed" | "revoked" | "parentHandleInvalid";
    }
  | {
      readonly kind: "mappingUnsupported";
      readonly resourceKind: ResourceKind;
    }
  | {
      readonly kind: "mappingTooLarge";
      readonly requestedBytes: number;
      readonly maxMappedWindowBytes: number;
    }
  | {
      readonly kind: "resourceContractViolation";
      readonly detail: string;
    };

export type ResourceHandleLifecycleState =
  | { readonly kind: "valid"; readonly handle: ResourceHandle }
  | {
      readonly kind: "invalidated";
      readonly handle: ResourceHandle;
      readonly event: ResourceHandleInvalidatedEvent;
    }
  | { readonly kind: "closed"; readonly handle: ResourceHandle };

const U32_MAX = 0xffffffff;

const FORBIDDEN_BODY_KEY_NORMALIZED = new Set([
  "arraybuffer",
  "blob",
  "body",
  "buffer",
  "bytearray",
  "bytes",
  "payload",
  "raw",
  "sharedarraybuffer",
  "uint8array",
]);

function normalizeDescriptorKey(key: string): string {
  return key.replace(/[^a-zA-Z0-9]/g, "").toLowerCase();
}

function isForbiddenBodyKey(key: string): boolean {
  const normalized = normalizeDescriptorKey(key);
  return FORBIDDEN_BODY_KEY_NORMALIZED.has(normalized) || normalized.endsWith("base64");
}

function assertPlainObject(value: unknown, label: string): Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throwInputRejected(`${label} must be a plain object`);
  }

  let proto: object | null;
  try {
    proto = Object.getPrototypeOf(value);
  } catch {
    throwInputRejected(`${label} object inspection failed`);
  }

  if (proto !== null && proto !== Object.prototype) {
    throwInputRejected(`${label} must be a plain object, not a class instance`);
  }

  return value as Record<string, unknown>;
}

function assertExactRootKeys(
  value: Record<string, unknown>,
  allowedKeys: ReadonlySet<string>,
  label: string,
): void {
  for (const key of Reflect.ownKeys(value)) {
    if (typeof key === "symbol") {
      throwInputRejected(`${label} must not have symbol keys`);
    }
    if (!allowedKeys.has(key)) {
      throwInputRejected(`${label} must not have extra field: ${key}`);
    }
  }
}

function assertNonEmptyString(value: unknown, label: string): string {
  if (typeof value !== "string" || value.length === 0) {
    throwInputRejected(`${label} must be a non-empty string`);
  }
  return value;
}

function assertBigInt(value: unknown, label: string): bigint {
  if (typeof value !== "bigint") {
    throwInputRejected(`${label} must be a bigint`);
  }
  return value;
}

function assertNonNegativeBigInt(value: unknown, label: string): bigint {
  const bigint = assertBigInt(value, label);
  if (bigint < 0n) {
    throwInputRejected(`${label} must not be negative`);
  }
  return bigint;
}

function assertBoolean(value: unknown, label: string): boolean {
  if (typeof value !== "boolean") {
    throwInputRejected(`${label} must be a boolean`);
  }
  return value;
}

function assertPositiveU32(value: unknown, label: string): number {
  const integer = assertNonNegativeSafeU32(value, label);
  if (integer === 0) {
    throwInputRejected(`${label} must be positive`);
  }
  return integer;
}

export function assertNonNegativeSafeU32(value: unknown, label: string): number {
  if (typeof value !== "number") {
    throwInputRejected(`${label} must be a number`);
  }
  if (!Number.isSafeInteger(value)) {
    throwInputRejected(`${label} must be a safe integer`);
  }
  if (value < 0) {
    throwInputRejected(`${label} must not be negative`);
  }
  if (value > U32_MAX) {
    throwInputRejected(`${label} must fit in u32`);
  }
  return value;
}

export function assertResourceAccessLengthBytes(value: unknown, label = "lengthBytes"): number {
  const lengthBytes = assertNonNegativeSafeU32(value, label);
  if (lengthBytes === 0) {
    throwInputRejected(`${label} must be positive`);
  }
  return lengthBytes;
}

export function createResourceCapabilities(input: ResourceCapabilities): ResourceCapabilities {
  const obj = assertPlainObject(input, "resource capabilities");
  const canReadChunks = assertBoolean(obj.canReadChunks, "capabilities.canReadChunks");
  const canMapWindows = assertBoolean(obj.canMapWindows, "capabilities.canMapWindows");

  if (canReadChunks && canMapWindows) {
    assertExactRootKeys(
      obj,
      new Set([
        "canReadChunks",
        "canMapWindows",
        "totalByteLength",
        "maxChunkBytes",
        "maxMappedWindowBytes",
      ]),
      "resource capabilities",
    );
    return {
      canReadChunks: true,
      canMapWindows: true,
      ...(obj.totalByteLength !== undefined
        ? {
            totalByteLength: assertNonNegativeBigInt(
              obj.totalByteLength,
              "capabilities.totalByteLength",
            ),
          }
        : {}),
      maxChunkBytes: assertPositiveU32(obj.maxChunkBytes, "capabilities.maxChunkBytes"),
      maxMappedWindowBytes: assertPositiveU32(
        obj.maxMappedWindowBytes,
        "capabilities.maxMappedWindowBytes",
      ),
    };
  }

  if (canReadChunks) {
    assertExactRootKeys(
      obj,
      new Set(["canReadChunks", "canMapWindows", "totalByteLength", "maxChunkBytes"]),
      "resource capabilities",
    );
    return {
      canReadChunks: true,
      canMapWindows: false,
      ...(obj.totalByteLength !== undefined
        ? {
            totalByteLength: assertNonNegativeBigInt(
              obj.totalByteLength,
              "capabilities.totalByteLength",
            ),
          }
        : {}),
      maxChunkBytes: assertPositiveU32(obj.maxChunkBytes, "capabilities.maxChunkBytes"),
    };
  }

  if (canMapWindows) {
    assertExactRootKeys(
      obj,
      new Set(["canReadChunks", "canMapWindows", "totalByteLength", "maxMappedWindowBytes"]),
      "resource capabilities",
    );
    return {
      canReadChunks: false,
      canMapWindows: true,
      ...(obj.totalByteLength !== undefined
        ? {
            totalByteLength: assertNonNegativeBigInt(
              obj.totalByteLength,
              "capabilities.totalByteLength",
            ),
          }
        : {}),
      maxMappedWindowBytes: assertPositiveU32(
        obj.maxMappedWindowBytes,
        "capabilities.maxMappedWindowBytes",
      ),
    };
  }

  assertExactRootKeys(
    obj,
    new Set(["canReadChunks", "canMapWindows", "totalByteLength"]),
    "resource capabilities",
  );
  return {
    canReadChunks: false,
    canMapWindows: false,
    ...(obj.totalByteLength !== undefined
      ? {
          totalByteLength: assertNonNegativeBigInt(
            obj.totalByteLength,
            "capabilities.totalByteLength",
          ),
        }
      : {}),
  };
}

export function validateResourceCapabilities(value: unknown): ResourceCapabilities {
  return createResourceCapabilities(value as ResourceCapabilities);
}

export function assertResourceDescriptorHasNoBody(value: unknown): void {
  scanDescriptorValue(value, "descriptor", []);
}

function scanDescriptorValue(value: unknown, path: string, stack: object[]): void {
  if (value === null || value === undefined) {
    return;
  }

  if (typeof value === "string") {
    if (value.length > 4096) {
      throwInputRejected(`${path} must not carry a large string body fragment`);
    }
    return;
  }

  if (typeof value === "number" || typeof value === "boolean" || typeof value === "bigint") {
    return;
  }

  if (typeof value !== "object") {
    throwInputRejected(`${path} must be metadata, not ${typeof value}`);
  }

  if (
    value instanceof ArrayBuffer ||
    (typeof SharedArrayBuffer !== "undefined" && value instanceof SharedArrayBuffer) ||
    ArrayBuffer.isView(value)
  ) {
    throwInputRejected(`${path} must not carry byte-like object data`);
  }

  if (stack.includes(value)) {
    throwInputRejected(`${path} must not be cyclic`);
  }
  stack.push(value);

  if (Array.isArray(value)) {
    if (value.length > 64) {
      throwInputRejected(`${path} must not carry a large array body fragment`);
    }
    for (let i = 0; i < value.length; i++) {
      scanDescriptorValue(value[i], `${path}[${i}]`, stack);
    }
    stack.pop();
    return;
  }

  const obj = assertPlainObject(value, path);
  for (const key of Reflect.ownKeys(obj)) {
    if (typeof key === "symbol") {
      throwInputRejected(`${path} must not have symbol keys`);
    }
    const lowerKey = String(key);
    if (isForbiddenBodyKey(lowerKey)) {
      throwInputRejected(`${path} must not carry byte-like field: ${String(key)}`);
    }
    scanDescriptorValue(obj[key], `${path}.${key}`, stack);
  }

  stack.pop();
}

export function createOpenResourceRequest<TOpen>(
  input: OpenResourceRequest<TOpen>,
): OpenResourceRequest<TOpen> {
  const obj = assertPlainObject(input, "open resource request");
  assertExactRootKeys(obj, new Set(["resourceKind", "input"]), "open resource request");
  return {
    resourceKind: assertNonEmptyString(obj.resourceKind, "request.resourceKind"),
    input: obj.input as TOpen,
  };
}

export function createOpenResourceReply<TDescriptor>(
  input: OpenResourceReply<TDescriptor>,
): OpenResourceReply<TDescriptor> {
  const obj = assertPlainObject(input, "open resource reply");
  assertExactRootKeys(
    obj,
    new Set([
      "handleId",
      "authorityEpoch",
      "resourceKind",
      "resourceKey",
      "resourceVersion",
      "descriptor",
      "capabilities",
    ]),
    "open resource reply",
  );
  assertResourceDescriptorHasNoBody(obj.descriptor);
  return {
    handleId: assertNonEmptyString(obj.handleId, "reply.handleId"),
    authorityEpoch: assertNonNegativeBigInt(obj.authorityEpoch, "reply.authorityEpoch"),
    resourceKind: assertNonEmptyString(obj.resourceKind, "reply.resourceKind"),
    resourceKey: assertNonEmptyString(obj.resourceKey, "reply.resourceKey"),
    resourceVersion: assertNonNegativeBigInt(obj.resourceVersion, "reply.resourceVersion"),
    descriptor: obj.descriptor as TDescriptor,
    capabilities: createResourceCapabilities(obj.capabilities as ResourceCapabilities),
  };
}

export function createReadResourceChunkRequest(
  input: ReadResourceChunkRequest,
): ReadResourceChunkRequest {
  const obj = assertPlainObject(input, "read resource chunk request");
  assertExactRootKeys(
    obj,
    new Set(["handleId", "authorityEpoch", "offsetBytes", "lengthBytes"]),
    "read resource chunk request",
  );
  const offsetBytes = assertNonNegativeBigInt(obj.offsetBytes, "request.offsetBytes");
  const lengthBytes = assertResourceAccessLengthBytes(obj.lengthBytes);
  return {
    handleId: assertNonEmptyString(obj.handleId, "request.handleId"),
    authorityEpoch: assertNonNegativeBigInt(obj.authorityEpoch, "request.authorityEpoch"),
    offsetBytes,
    lengthBytes,
  };
}

export function createMapResourceWindowRequest(
  input: MapResourceWindowRequest,
): MapResourceWindowRequest {
  const obj = assertPlainObject(input, "map resource window request");
  assertExactRootKeys(
    obj,
    new Set(["handleId", "authorityEpoch", "offsetBytes", "lengthBytes"]),
    "map resource window request",
  );
  const offsetBytes = assertNonNegativeBigInt(obj.offsetBytes, "request.offsetBytes");
  const lengthBytes = assertResourceAccessLengthBytes(obj.lengthBytes);
  return {
    handleId: assertNonEmptyString(obj.handleId, "request.handleId"),
    authorityEpoch: assertNonNegativeBigInt(obj.authorityEpoch, "request.authorityEpoch"),
    offsetBytes,
    lengthBytes,
  };
}

export function validateReadResourceChunkRequest(
  request: ReadResourceChunkRequest,
  handle: ResourceHandle,
): ResourceFailure | null {
  const normalizedRequest = createReadResourceChunkRequest(request);
  if (normalizedRequest.handleId !== handle.handleId) {
    return { kind: "handleInvalid", handleId: normalizedRequest.handleId, reason: "revoked" };
  }
  if (normalizedRequest.authorityEpoch !== handle.authorityEpoch) {
    return {
      kind: "sessionMismatch",
      expectedAuthorityEpoch: handle.authorityEpoch,
      providedAuthorityEpoch: normalizedRequest.authorityEpoch,
    };
  }
  if (!handle.capabilities.canReadChunks) {
    return {
      kind: "resourceContractViolation",
      detail: `resource kind ${handle.resourceKind} does not support chunk reads`,
    };
  }
  if (normalizedRequest.lengthBytes > handle.capabilities.maxChunkBytes) {
    return {
      kind: "chunkTooLarge",
      requestedBytes: normalizedRequest.lengthBytes,
      maxChunkBytes: handle.capabilities.maxChunkBytes,
    };
  }
  return validateRangeWithinKnownTotal(normalizedRequest, handle.capabilities);
}

export function validateMapResourceWindowRequest(
  request: MapResourceWindowRequest,
  handle: ResourceHandle,
): ResourceFailure | null {
  const normalizedRequest = createMapResourceWindowRequest(request);
  if (normalizedRequest.handleId !== handle.handleId) {
    return { kind: "handleInvalid", handleId: normalizedRequest.handleId, reason: "revoked" };
  }
  if (normalizedRequest.authorityEpoch !== handle.authorityEpoch) {
    return {
      kind: "sessionMismatch",
      expectedAuthorityEpoch: handle.authorityEpoch,
      providedAuthorityEpoch: normalizedRequest.authorityEpoch,
    };
  }
  if (!handle.capabilities.canMapWindows) {
    return { kind: "mappingUnsupported", resourceKind: handle.resourceKind };
  }
  if (normalizedRequest.lengthBytes > handle.capabilities.maxMappedWindowBytes) {
    return {
      kind: "mappingTooLarge",
      requestedBytes: normalizedRequest.lengthBytes,
      maxMappedWindowBytes: handle.capabilities.maxMappedWindowBytes,
    };
  }
  return validateRangeWithinKnownTotal(normalizedRequest, handle.capabilities);
}

function validateRangeWithinKnownTotal(
  request: ReadResourceChunkRequest | MapResourceWindowRequest,
  capabilities: ResourceCapabilities,
): ResourceFailure | null {
  if (capabilities.totalByteLength === undefined) {
    return null;
  }
  const endBytes = request.offsetBytes + BigInt(request.lengthBytes);
  if (endBytes > capabilities.totalByteLength) {
    return {
      kind: "rangeInvalid",
      offsetBytes: request.offsetBytes,
      lengthBytes: request.lengthBytes,
    };
  }
  return null;
}

export function createCloseResourceMappingRequest(
  input: CloseResourceMappingRequest,
): CloseResourceMappingRequest {
  const obj = assertPlainObject(input, "close resource mapping request");
  assertExactRootKeys(
    obj,
    new Set(["handleId", "mappingId", "authorityEpoch"]),
    "close resource mapping request",
  );
  return {
    handleId: assertNonEmptyString(obj.handleId, "request.handleId"),
    mappingId: assertNonEmptyString(obj.mappingId, "request.mappingId"),
    authorityEpoch: assertNonNegativeBigInt(obj.authorityEpoch, "request.authorityEpoch"),
  };
}

export function createCloseResourceHandleRequest(
  input: CloseResourceHandleRequest,
): CloseResourceHandleRequest {
  const obj = assertPlainObject(input, "close resource handle request");
  assertExactRootKeys(
    obj,
    new Set(["handleId", "authorityEpoch"]),
    "close resource handle request",
  );
  return {
    handleId: assertNonEmptyString(obj.handleId, "request.handleId"),
    authorityEpoch: assertNonNegativeBigInt(obj.authorityEpoch, "request.authorityEpoch"),
  };
}

export function createResourceHandleInvalidatedEvent(
  input: ResourceHandleInvalidatedEvent,
): ResourceHandleInvalidatedEvent {
  const obj = assertPlainObject(input, "resource handle invalidated event");
  assertExactRootKeys(
    obj,
    new Set(["kind", "authorityEpoch", "handleId", "reason"]),
    "resource handle invalidated event",
  );
  if (obj.kind !== "resourceHandleInvalidated") {
    throwInputRejected('event.kind must be "resourceHandleInvalidated"');
  }
  const reason = obj.reason;
  if (
    reason !== "authorityRestart" &&
    reason !== "resourceReplaced" &&
    reason !== "revoked" &&
    reason !== "expired" &&
    reason !== "resourceUnavailable"
  ) {
    throwInputRejected(`invalid resource invalidation reason: ${String(reason)}`);
  }
  return {
    kind: "resourceHandleInvalidated",
    authorityEpoch: assertNonNegativeBigInt(obj.authorityEpoch, "event.authorityEpoch"),
    handleId: assertNonEmptyString(obj.handleId, "event.handleId"),
    reason,
  };
}

export function createResourceBackpressure(input: ResourceBackpressure): ResourceBackpressure {
  const obj = assertPlainObject(input, "resource backpressure");
  assertExactRootKeys(obj, new Set(["kind", "scope", "retryAfterMs"]), "resource backpressure");
  if (obj.kind !== "resourceBackpressure") {
    throwInputRejected('backpressure.kind must be "resourceBackpressure"');
  }
  const scope = obj.scope;
  if (scope !== "handle" && scope !== "consumer" && scope !== "authority") {
    throwInputRejected(`invalid backpressure scope: ${String(scope)}`);
  }
  let retryAfterMs: number | undefined;
  if (obj.retryAfterMs !== undefined) {
    retryAfterMs = assertNonNegativeSafeU32(obj.retryAfterMs, "backpressure.retryAfterMs");
  }
  return {
    kind: "resourceBackpressure",
    scope,
    ...(retryAfterMs !== undefined ? { retryAfterMs } : {}),
  };
}

export function invalidateResourceHandle(
  state: Extract<ResourceHandleLifecycleState, { readonly kind: "valid" }>,
  reason: ResourceHandleInvalidatedEvent["reason"],
): Extract<ResourceHandleLifecycleState, { readonly kind: "invalidated" }> {
  const event = createResourceHandleInvalidatedEvent({
    kind: "resourceHandleInvalidated",
    authorityEpoch: state.handle.authorityEpoch,
    handleId: state.handle.handleId,
    reason,
  });
  return { kind: "invalidated", handle: state.handle, event };
}

export function validateResourceHandleAccess(
  state: ResourceHandleLifecycleState,
  request: ReadResourceChunkRequest | MapResourceWindowRequest,
): ResourceFailure | null {
  if (request.handleId !== state.handle.handleId) {
    return { kind: "handleInvalid", handleId: request.handleId, reason: "revoked" };
  }
  if (request.authorityEpoch !== state.handle.authorityEpoch) {
    return {
      kind: "sessionMismatch",
      expectedAuthorityEpoch: state.handle.authorityEpoch,
      providedAuthorityEpoch: request.authorityEpoch,
    };
  }
  if (state.kind === "closed") {
    return { kind: "handleInvalid", handleId: state.handle.handleId, reason: "closed" };
  }
  if (state.kind === "invalidated") {
    return {
      kind: "handleInvalid",
      handleId: state.handle.handleId,
      reason: invalidationReasonToHandleInvalidReason(state.event.reason),
    };
  }
  return null;
}

export function validateCloseResourceHandleForState(
  state: ResourceHandleLifecycleState,
  request: CloseResourceHandleRequest,
): CloseResourceHandleResult {
  const normalizedRequest = createCloseResourceHandleRequest(request);
  if (normalizedRequest.handleId !== state.handle.handleId) {
    return {
      ok: false,
      failure: { kind: "handleInvalid", handleId: normalizedRequest.handleId, reason: "revoked" },
    };
  }
  if (normalizedRequest.authorityEpoch !== state.handle.authorityEpoch) {
    return {
      ok: false,
      failure: {
        kind: "sessionMismatch",
        expectedAuthorityEpoch: state.handle.authorityEpoch,
        providedAuthorityEpoch: normalizedRequest.authorityEpoch,
      },
    };
  }
  return { ok: true };
}

export function validateCloseResourceMappingForState(
  state: ResourceHandleLifecycleState,
  request: CloseResourceMappingRequest,
  knownOpenMappingIds: ReadonlySet<ResourceMappingId>,
): CloseResourceMappingResult {
  const normalizedRequest = createCloseResourceMappingRequest(request);
  if (normalizedRequest.handleId !== state.handle.handleId) {
    return {
      ok: false,
      failure: { kind: "handleInvalid", handleId: normalizedRequest.handleId, reason: "revoked" },
    };
  }
  if (normalizedRequest.authorityEpoch !== state.handle.authorityEpoch) {
    return {
      ok: false,
      failure: {
        kind: "sessionMismatch",
        expectedAuthorityEpoch: state.handle.authorityEpoch,
        providedAuthorityEpoch: normalizedRequest.authorityEpoch,
      },
    };
  }
  if (state.kind === "invalidated") {
    return {
      ok: false,
      failure: {
        kind: "mappingInvalid",
        handleId: state.handle.handleId,
        mappingId: normalizedRequest.mappingId,
        reason: "parentHandleInvalid",
      },
    };
  }
  if (!knownOpenMappingIds.has(normalizedRequest.mappingId)) {
    return {
      ok: false,
      failure: {
        kind: "mappingInvalid",
        handleId: state.handle.handleId,
        mappingId: normalizedRequest.mappingId,
        reason: "unknown",
      },
    };
  }
  return { ok: true };
}

function invalidationReasonToHandleInvalidReason(
  reason: ResourceHandleInvalidatedEvent["reason"],
): Extract<ResourceFailure, { readonly kind: "handleInvalid" }>["reason"] {
  if (reason === "authorityRestart") return "staleEpoch";
  if (reason === "resourceReplaced") return "resourceReplaced";
  if (reason === "resourceUnavailable") return "resourceUnavailable";
  return reason;
}
