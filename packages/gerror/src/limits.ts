/**
 * Resource budgets, hard caps, UTF-8 byte accounting, and RFC 4648 Base64 helpers.
 *
 * Owns default security limits, option validation/clamping, portable
 * `TextEncoder` UTF-8 byte counting, and strict RFC 4648 standard Base64
 * validation. Zero runtime dependencies; universal WinterTC.
 */

import type { ErrorDetail, SerializationOptions } from './data.ts'

export const DEFAULT_MAX_DEPTH = 8
export const DEFAULT_MAX_NODES = 128
export const DEFAULT_MAX_BYTES = 65_536
export const DEFAULT_MAX_MESSAGE_BYTES = 8192
export const DEFAULT_MAX_STACK_BYTES = 16_384
export const DEFAULT_MAX_DETAILS = 32
export const DEFAULT_MAX_DETAIL_BYTES = 16_384
export const DEFAULT_MAX_TYPE_URL_BYTES = 512
export const DEFAULT_MAX_ERRORS = 32

export const HARD_CAP_MAX_DEPTH = 32
export const HARD_CAP_MAX_NODES = 1024
export const HARD_CAP_MAX_BYTES = 1_048_576

const BASE64_RE = /^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/
const textEncoder = new TextEncoder()
const textDecoder = new TextDecoder('utf-8', { fatal: false })

/**
 * Resolved, validated serialization policy with clamped budgets.
 */
export interface ResolvedSerializationPolicy {
  readonly diagnostics: 'omit' | 'include'
  readonly maxDepth: number
  readonly maxNodes: number
  readonly maxBytes: number
  readonly detailPolicy?: (detail: ErrorDetail) => ErrorDetail | undefined
}

/**
 * Returns the UTF-8 encoded byte length of `value`.
 */
export function utf8ByteLength (value: string): number {
  return textEncoder.encode(value).byteLength
}

/**
 * Truncates `value` so its UTF-8 byte length does not exceed `maxBytes`
 * without splitting multi-byte UTF-8 sequences.
 */
export function truncateUtf8 (value: string, maxBytes: number): string {
  const bytes = textEncoder.encode(value)
  if (bytes.byteLength <= maxBytes) {
    return value
  }
  let end = maxBytes
  if (end > 0 && (bytes[end - 1]! & 0x80) !== 0) {
    let lead = end - 1
    while (lead > 0 && (bytes[lead]! & 0xc0) === 0x80) {
      lead -= 1
    }
    const leadByte = bytes[lead]!
    const seqLen =
      (leadByte & 0xe0) === 0xc0 ? 2 :
      (leadByte & 0xf0) === 0xe0 ? 3 :
      (leadByte & 0xf8) === 0xf0 ? 4 : 1
    if (lead + seqLen > maxBytes) {
      end = lead
    }
  }
  return textDecoder.decode(bytes.subarray(0, end))
}

/**
 * Validates strict RFC 4648 standard Base64 and returns its decoded byte length.
 *
 * @throws {TypeError} When `value` is not valid RFC 4648 standard Base64.
 */
export function validateStandardBase64 (value: string): number {
  if (value.length % 4 !== 0 || !BASE64_RE.test(value)) {
    throw new TypeError('ErrorDetail.value must be valid RFC 4648 standard Base64')
  }
  if (value.length === 0) {
    return 0
  }
  const padding = value.endsWith('==') ? 2 : value.endsWith('=') ? 1 : 0
  return (value.length / 4) * 3 - padding
}

/**
 * Validates a caller-supplied positive integer limit and clamps it to `hardCap`.
 */
function resolveLimit (
  value: number | undefined,
  defaultValue: number,
  hardCap: number,
  name: string,
): number {
  if (value === undefined) {
    return defaultValue
  }
  if (typeof value !== 'number' || !Number.isFinite(value) || !Number.isInteger(value)) {
    throw new TypeError(`SerializationOptions.${name} must be a finite integer`)
  }
  if (value <= 0) {
    throw new RangeError(`SerializationOptions.${name} must be a positive integer`)
  }
  return Math.min(value, hardCap)
}

/**
 * Resolves and validates `SerializationOptions` into a bounded policy.
 */
export function resolveSerializationPolicy (
  options?: SerializationOptions,
): ResolvedSerializationPolicy {
  if (options === undefined) {
    return {
      diagnostics: 'omit',
      maxDepth: DEFAULT_MAX_DEPTH,
      maxNodes: DEFAULT_MAX_NODES,
      maxBytes: DEFAULT_MAX_BYTES,
    }
  }
  if (typeof options !== 'object' || options === null) {
    throw new TypeError('SerializationOptions must be an object')
  }

  const diagnostics = options.diagnostics ?? 'omit'
  if (diagnostics !== 'omit' && diagnostics !== 'include') {
    throw new TypeError("SerializationOptions.diagnostics must be 'omit' or 'include'")
  }

  if (options.detailPolicy !== undefined && typeof options.detailPolicy !== 'function') {
    throw new TypeError('SerializationOptions.detailPolicy must be a function')
  }

  return {
    diagnostics,
    maxDepth: resolveLimit(options.maxDepth, DEFAULT_MAX_DEPTH, HARD_CAP_MAX_DEPTH, 'maxDepth'),
    maxNodes: resolveLimit(options.maxNodes, DEFAULT_MAX_NODES, HARD_CAP_MAX_NODES, 'maxNodes'),
    maxBytes: resolveLimit(options.maxBytes, DEFAULT_MAX_BYTES, HARD_CAP_MAX_BYTES, 'maxBytes'),
    detailPolicy: options.detailPolicy,
  }
}
