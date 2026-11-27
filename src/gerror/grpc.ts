/**
 * gRPC Status and Code Definitions according to Google API Design Guide:
 *  - https://cloud.google.com/apis/design/errors
 *  - https://github.com/googleapis/googleapis/blob/master/google/rpc/code.proto
 */

/**
 * Standard gRPC status codes (matching google.rpc.Code protobuf enum).
 */
enum Code {
  OK = 0,
  CANCELLED = 1,
  UNKNOWN = 2,
  INVALID_ARGUMENT = 3,
  DEADLINE_EXCEEDED = 4,
  NOT_FOUND = 5,
  ALREADY_EXISTS = 6,
  PERMISSION_DENIED = 7,
  RESOURCE_EXHAUSTED = 8,
  FAILED_PRECONDITION = 9,
  ABORTED = 10,
  OUT_OF_RANGE = 11,
  UNIMPLEMENTED = 12,
  INTERNAL = 13,
  UNAVAILABLE = 14,
  DATA_LOSS = 15,
  UNAUTHENTICATED = 16,
}

/**
 * Pure numeric gRPC status representation for RPC adapter boundaries.
 */
interface GrpcStatus {
  code: Code | number
  message?: string
  details?: string
}

/**
 * Strict type guard ensuring payload conforms to numeric GrpcStatus.
 */
const isGrpcStatus = (payload: unknown): payload is GrpcStatus =>
  typeof payload === 'object' &&
  payload !== null &&
  !Array.isArray(payload) &&
  'code' in payload &&
  typeof (payload as Record<string, unknown>)['code'] === 'number' &&
  Number.isFinite((payload as Record<string, unknown>)['code']) &&
  (!('details' in (payload as Record<string, unknown>)) ||
    (payload as Record<string, unknown>)['details'] === undefined ||
    typeof (payload as Record<string, unknown>)['details'] === 'string') &&
  (!('message' in (payload as Record<string, unknown>)) ||
    (payload as Record<string, unknown>)['message'] === undefined ||
    typeof (payload as Record<string, unknown>)['message'] === 'string')

/**
 * Converts a domain code (string or numeric) into a strictly numeric gRPC status code.
 *
 * @param code Domain error code (numeric or string)
 * @param customMapping Optional mapping function for application-specific string codes
 * @returns Numeric Code enum or number
 */
function toNumericGrpcCode (
  code: number | string | undefined,
  customMapping?: (domainCode: string) => number | undefined,
): Code | number {
  if (typeof code === 'number' && Number.isFinite(code)) {
    return code
  }
  if (typeof code === 'string') {
    if (customMapping) {
      const mapped = customMapping(code)
      if (mapped !== undefined && Number.isFinite(mapped)) {
        return mapped
      }
    }
    const parsed = Number(code)
    if (!Number.isNaN(parsed) && Number.isFinite(parsed)) {
      return parsed
    }
  }
  return Code.UNKNOWN
}

export type { GrpcStatus }
export {
  Code,
  isGrpcStatus,
  toNumericGrpcCode,
}
