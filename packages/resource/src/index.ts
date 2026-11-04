export type { ResourceBudgetLimits, ResourceBudgetSnapshot } from "./resource-budget";
export { ResourceBudget } from "./resource-budget";
export type { OwnedResourceChunk, ResourceReadOptions } from "./resource-client";
export { ResourceClient } from "./resource-client";
export type { ResourcePlaneV1OperationKey } from "./resource-control";
export {
  createResourceControlFailure,
  RESOURCE_CLOSE_HANDLE_OPERATION_KEY,
  RESOURCE_CLOSE_MAPPING_OPERATION_KEY,
  RESOURCE_MAP_WINDOW_OPERATION_KEY,
  RESOURCE_OPEN_OPERATION_KEY,
  RESOURCE_PLANE_V1_OPERATION_KEYS,
  RESOURCE_READ_CHUNK_OPERATION_KEY,
} from "./resource-control";
export type {
  ResourceDescriptor,
  ResourceOwner,
} from "./resource-descriptor";
export {
  createResourceDescriptor,
  validateResourceDescriptor,
  validateResourceOwner,
} from "./resource-descriptor";
export type { ResourceReceiptFailure, ResourceReceiptFailureCode } from "./resource-failure";
export {
  createInvalidRangeResourceFailure,
  createResourceReceiptFailure,
  createStaleBindingResourceFailure,
  validateResourceReceiptFailure,
} from "./resource-failure";
export type {
  CloseResourceHandleRequest,
  CloseResourceHandleResult,
  CloseResourceMappingRequest,
  CloseResourceMappingResult,
  MapResourceWindowReply,
  MapResourceWindowRequest,
  MapResourceWindowResult,
  OpenResourceReply,
  OpenResourceRequest,
  OpenResourceResult,
  ReadResourceChunkReply,
  ReadResourceChunkRequest,
  ReadResourceChunkResult,
  ResourceBackpressure,
  ResourceCapabilities,
  ResourceContract,
  ResourceFailure,
  ResourceHandle,
  ResourceHandleId,
  ResourceHandleInvalidatedEvent,
  ResourceHandleLifecycleState,
  ResourceKey,
  ResourceKind,
  ResourceMappingDescriptor,
  ResourceMappingId,
  ResourceVersion,
} from "./resource-protocol";
export {
  assertNonNegativeSafeU32,
  assertResourceAccessLengthBytes,
  assertResourceDescriptorHasNoBody,
  createCloseResourceHandleRequest,
  createCloseResourceMappingRequest,
  createMapResourceWindowRequest,
  createOpenResourceReply,
  createOpenResourceRequest,
  createReadResourceChunkRequest,
  createResourceBackpressure,
  createResourceCapabilities,
  createResourceHandleInvalidatedEvent,
  defineResourceContract,
  invalidateResourceHandle,
  validateCloseResourceHandleForState,
  validateCloseResourceMappingForState,
  validateMapResourceWindowRequest,
  validateReadResourceChunkRequest,
  validateResourceCapabilities,
  validateResourceHandleAccess,
} from "./resource-protocol";
export type { ResourceFrame, ResourceFrameHeader } from "./resource-wire";
export {
  decodeResourceHeader,
  RESOURCE_HEADER_BYTES,
  RESOURCE_MAX_CHUNK_BYTES,
  RESOURCE_WIRE_VERSION,
  ResourceFrameDecoder,
} from "./resource-wire";
export type { OpaqueResourceDescriptor, OpaqueResourceHandle } from "./resource-wire-values";
export { decodeOpaqueResourceHandle } from "./resource-wire-values";
