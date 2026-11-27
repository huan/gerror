/**
 * Canonical Google RPC status codes for GError.
 *
 * Owns the `Code` value-and-type pair and runtime validation helpers for
 * canonical error classification. Excludes `OK` (0) because `GError` represents
 * failures only. Zero runtime dependencies; universal ECMAScript/WinterTC.
 */

/**
 * Canonical Google RPC error codes (1–16).
 *
 * Excludes `OK` (`0`), which represents success and is rejected by `GError`.
 * Numeric values match `google.rpc.Code` in `google/rpc/code.proto`.
 */
export const Code = {
  Cancelled: 1,
  Unknown: 2,
  InvalidArgument: 3,
  DeadlineExceeded: 4,
  NotFound: 5,
  AlreadyExists: 6,
  PermissionDenied: 7,
  ResourceExhausted: 8,
  FailedPrecondition: 9,
  Aborted: 10,
  OutOfRange: 11,
  Unimplemented: 12,
  Internal: 13,
  Unavailable: 14,
  DataLoss: 15,
  Unauthenticated: 16,
} as const

/**
 * Union of canonical Google RPC failure code numbers (1–16).
 */
export type Code = typeof Code[keyof typeof Code]

const VALID_CODES: ReadonlySet<number> = new Set(Object.values(Code))

/**
 * Returns `true` when `value` is one of the 16 canonical `Code` numbers.
 *
 * Rejects `0` (`OK`), non-integers, non-numbers, and out-of-range integers.
 */
export function isCode (value: unknown): value is Code {
  return typeof value === 'number' && VALID_CODES.has(value)
}

/**
 * Validates that `value` is a canonical `Code` (1–16) and returns it.
 *
 * @throws {TypeError} When `value` is `0` (`OK`) or not a valid canonical code.
 */
export function assertCode (value: unknown): Code {
  if (!isCode(value)) {
    throw new TypeError(`Invalid GError code: ${String(value)}`)
  }
  return value
}
