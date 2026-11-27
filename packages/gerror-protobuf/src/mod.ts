/**
 * Public entry point for `gerror-protobuf`.
 *
 * Exports `toStatus`, `fromStatus`, `dataToStatus`, `statusToData`,
 * `createGErrorRegistry`, and the generated Protobuf-ES v2 schemas and types
 * for `google.rpc.Status`, `gerror.v1.ErrorContext`, and standard Google RPC
 * error details.
 */

export {
  ErrorContextSchema,
  type ErrorContext,
  OmittedCauseSchema,
  type OmittedCause,
  OmittedCause_Reason,
} from './generated/gerror/v1/error_context_pb.ts'
export {
  BadRequestSchema,
  type BadRequest,
  DebugInfoSchema,
  type DebugInfo,
  ErrorInfoSchema,
  type ErrorInfo,
  HelpSchema,
  type Help,
  LocalizedMessageSchema,
  type LocalizedMessage,
  PreconditionFailureSchema,
  type PreconditionFailure,
  QuotaFailureSchema,
  type QuotaFailure,
  RequestInfoSchema,
  type RequestInfo,
  ResourceInfoSchema,
  type ResourceInfo,
  RetryInfoSchema,
  type RetryInfo,
} from './generated/google/rpc/error_details_pb.ts'
export { StatusSchema, type Status } from './generated/google/rpc/status_pb.ts'
export { createGErrorRegistry } from './registry.ts'
export {
  dataToStatus,
  fromStatus,
  statusToData,
  toStatus,
} from './status.ts'
