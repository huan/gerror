/**
 * Bidirectional `GError` / `GErrorData` <-> `google.rpc.Status` conversions.
 *
 * Owns `toStatus`, `fromStatus`, `dataToStatus`, and `statusToData` using
 * generated Protobuf-ES v2 schemas (`google.rpc.Status`, `gerror.v1.ErrorContext`,
 * `google.rpc.DebugInfo`) while preserving unknown `Any` detail bytes and
 * third-party `DebugInfo` entries.
 */

import { create } from '@bufbuild/protobuf'
import { anyPack, anyUnpack } from '@bufbuild/protobuf/wkt'
import {
  Code,
  type ErrorCause,
  type ErrorDetail,
  type ErrorDiagnostics,
  GError,
  type GErrorData,
  type SerializationOptions,
} from 'gerror'

import {
  anyToDetail,
  DEBUG_INFO_TYPE_URL,
  detailToAny,
  ERROR_CONTEXT_TYPE_URL,
  GERROR_STACK_DETAIL_TAG,
  jsonToProtoValue,
  protoValueToJson,
} from './details.ts'
import {
  type ErrorContext,
  ErrorContextSchema,
  OmittedCause_Reason,
  OmittedCauseSchema,
} from './generated/gerror/v1/error_context_pb.ts'
import { DebugInfoSchema } from './generated/google/rpc/error_details_pb.ts'
import { type Status, StatusSchema } from './generated/google/rpc/status_pb.ts'

const MAX_DEPTH = 8
const MAX_NODES = 128

const REASON_TO_PROTO: Record<
  Extract<ErrorCause, { readonly kind: 'omitted' }>['reason'],
  OmittedCause_Reason
> = {
  cycle: OmittedCause_Reason.CYCLE,
  'depth-limit': OmittedCause_Reason.DEPTH_LIMIT,
  'size-limit': OmittedCause_Reason.SIZE_LIMIT,
  'unsupported-value': OmittedCause_Reason.UNSUPPORTED_VALUE,
  redacted: OmittedCause_Reason.REDACTED,
}

const PROTO_TO_REASON: Partial<
  Record<OmittedCause_Reason, Extract<ErrorCause, { readonly kind: 'omitted' }>['reason']>
> = {
  [OmittedCause_Reason.CYCLE]: 'cycle',
  [OmittedCause_Reason.DEPTH_LIMIT]: 'depth-limit',
  [OmittedCause_Reason.SIZE_LIMIT]: 'size-limit',
  [OmittedCause_Reason.UNSUPPORTED_VALUE]: 'unsupported-value',
  [OmittedCause_Reason.REDACTED]: 'redacted',
}

function isCanonicalCode (value: number): value is Code {
  return Number.isInteger(value) && value >= 1 && value <= 16
}

function encodeStatusNode (data: GErrorData, depth: number): Status {
  if (depth > MAX_DEPTH) {
    throw new RangeError(`Status encoding exceeds maximum depth (${MAX_DEPTH})`)
  }
  if (data.version !== 1) {
    throw new TypeError(`Unsupported GErrorData version: ${String(data.version)}`)
  }
  if (!isCanonicalCode(data.code)) {
    throw new TypeError(`Invalid GErrorData code: ${String(data.code)}`)
  }

  const details = data.details.map((detail) => {
    if (detail.typeUrl === ERROR_CONTEXT_TYPE_URL) {
      throw new TypeError('GErrorData.details must not manually include gerror.v1.ErrorContext')
    }
    return detailToAny(detail)
  })

  if (data.diagnostics?.stack !== undefined) {
    const debugInfo = create(DebugInfoSchema, {
      detail: GERROR_STACK_DETAIL_TAG,
      stackEntries: data.diagnostics.stack.split('\n'),
    })
    details.push(anyPack(DebugInfoSchema, debugInfo))
  }

  const ctx = create(ErrorContextSchema)
  let hasContext = false

  if (data.diagnostics?.name !== undefined) {
    ctx.name = data.diagnostics.name
    hasContext = true
  }
  if (data.diagnostics?.originalCode !== undefined) {
    if (typeof data.diagnostics.originalCode === 'number') {
      ctx.originalRpcCode = data.diagnostics.originalCode
    } else {
      ctx.originalErrorCode = data.diagnostics.originalCode
    }
    hasContext = true
  }

  if (data.cause !== undefined) {
    hasContext = true
    if (data.cause.kind === 'error') {
      ctx.cause = {
        case: 'errorCause',
        value: encodeStatusNode(data.cause.error, depth + 1),
      }
    } else if (data.cause.kind === 'value') {
      ctx.cause = {
        case: 'valueCause',
        value: jsonToProtoValue(data.cause.value, depth + 1, MAX_DEPTH),
      }
    } else {
      ctx.cause = {
        case: 'omittedCause',
        value: create(OmittedCauseSchema, {
          reason: REASON_TO_PROTO[data.cause.reason],
        }),
      }
    }
  }

  if (data.errors !== undefined && data.errors.length > 0) {
    hasContext = true
    ctx.errors = data.errors.map((member) => encodeStatusNode(member, depth + 1))
  }

  if (hasContext) {
    details.push(anyPack(ErrorContextSchema, ctx))
  }

  return create(StatusSchema, {
    code: data.code,
    message: data.message,
    details,
  })
}

function decodeStatusNode (
  status: Status,
  depth: number,
  budget: { remainingNodes: number },
): GErrorData {
  budget.remainingNodes -= 1
  if (budget.remainingNodes < 0) {
    throw new RangeError(`Status decoding exceeds maximum node budget (${MAX_NODES})`)
  }
  if (depth > MAX_DEPTH) {
    throw new RangeError(`Status decoding exceeds maximum depth (${MAX_DEPTH})`)
  }

  if (status.code === 0) {
    throw new TypeError('google.rpc.Status with code 0 (OK) cannot be decoded as GError')
  }

  let code: Code
  let originalRpcCode: number | undefined
  if (isCanonicalCode(status.code)) {
    code = status.code
  } else {
    code = Code.Unknown
    originalRpcCode = status.code
  }

  const details: ErrorDetail[] = []
  let errorContext: ErrorContext | undefined
  let stackFromDebugInfo: string | undefined

  for (const any of status.details) {
    if (any.typeUrl === ERROR_CONTEXT_TYPE_URL) {
      if (errorContext !== undefined) {
        throw new TypeError('google.rpc.Status contains duplicate gerror.v1.ErrorContext details')
      }
      const unpacked = anyUnpack(any, ErrorContextSchema)
      if (unpacked === undefined) {
        throw new TypeError('Failed to unpack gerror.v1.ErrorContext detail')
      }
      errorContext = unpacked
      continue
    }

    if (any.typeUrl === DEBUG_INFO_TYPE_URL) {
      const unpacked = anyUnpack(any, DebugInfoSchema)
      if (unpacked !== undefined && unpacked.detail === GERROR_STACK_DETAIL_TAG) {
        stackFromDebugInfo = unpacked.stackEntries.join('\n')
        continue
      }
    }

    details.push(anyToDetail(any))
  }

  let name: string | undefined
  let originalCode: string | number | undefined = originalRpcCode
  let cause: ErrorCause | undefined
  let errors: GErrorData[] | undefined

  if (errorContext !== undefined) {
    if (errorContext.name !== undefined) {
      name = errorContext.name
    }
    if (originalCode === undefined) {
      if (errorContext.originalRpcCode !== undefined) {
        originalCode = errorContext.originalRpcCode
      } else if (errorContext.originalErrorCode !== undefined) {
        originalCode = errorContext.originalErrorCode
      }
    }

    if (errorContext.cause.case === 'errorCause') {
      cause = {
        kind: 'error',
        error: decodeStatusNode(errorContext.cause.value, depth + 1, budget),
      }
    } else if (errorContext.cause.case === 'valueCause') {
      cause = {
        kind: 'value',
        value: protoValueToJson(errorContext.cause.value, depth + 1, budget, MAX_DEPTH),
      }
    } else if (errorContext.cause.case === 'omittedCause') {
      const mapped = PROTO_TO_REASON[errorContext.cause.value.reason] ?? 'unsupported-value'
      cause = { kind: 'omitted', reason: mapped }
    }

    if (errorContext.errors.length > 0) {
      errors = errorContext.errors.map((member) => decodeStatusNode(member, depth + 1, budget))
    }
  }

  const diagnostics: ErrorDiagnostics | undefined =
    name !== undefined || stackFromDebugInfo !== undefined || originalCode !== undefined
      ? {
          ...(name !== undefined ? { name } : {}),
          ...(stackFromDebugInfo !== undefined ? { stack: stackFromDebugInfo } : {}),
          ...(originalCode !== undefined ? { originalCode } : {}),
        }
      : undefined

  return {
    version: 1,
    code,
    message: status.message,
    details,
    ...(diagnostics !== undefined ? { diagnostics } : {}),
    ...(cause !== undefined ? { cause } : {}),
    ...(errors !== undefined ? { errors } : {}),
  }
}

/**
 * Converts a canonical `GErrorData` snapshot into a `google.rpc.Status` message.
 */
export function dataToStatus (data: GErrorData): Status {
  return encodeStatusNode(data, 0)
}

/**
 * Converts a `google.rpc.Status` message into a canonical `GErrorData` snapshot.
 *
 * @throws {TypeError} When `status.code` is `0` (`OK`) or `ErrorContext` is duplicated.
 * @throws {RangeError} When recursive depth or node budgets are exceeded.
 */
export function statusToData (status: Status): GErrorData {
  return decodeStatusNode(status, 0, { remainingNodes: MAX_NODES })
}

/**
 * Normalizes `error` to a `GError`, serializes it under `options`, and converts
 * it to a `google.rpc.Status` message.
 */
export function toStatus (error: unknown, options?: SerializationOptions): Status {
  return dataToStatus(GError.from(error).toData(options))
}

/**
 * Converts a `google.rpc.Status` message into a local `GError` instance.
 */
export function fromStatus (status: Status): GError {
  return GError.fromData(statusToData(status))
}
