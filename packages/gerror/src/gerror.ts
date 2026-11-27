/**
 * Core `GError` runtime class extending native ECMAScript `Error`.
 *
 * Owns native `Error` inheritance, canonical `Code` enforcement, immutable
 * `details` snapshots, unforgeable instance branding (`isGError`), and
 * delegation to normalization, serialization, and deserialization helpers.
 * Zero runtime dependencies.
 */

import { assertCode, Code } from './code.ts'
import type {
  ErrorDetail,
  GErrorData,
  GErrorOptions,
  SerializationOptions,
} from './data.ts'
import { deserializeGError } from './deserialize.ts'
import { normalizeToGError } from './normalize.ts'
import { serializeGError } from './serialize.ts'

/**
 * Validates and deep-copies an input `details` array into a frozen snapshot
 * so caller mutations cannot alter `GError.details`.
 *
 * @throws {TypeError} When `details` is not an array or contains invalid items.
 */
function copyDetails (details: readonly ErrorDetail[] | undefined): readonly ErrorDetail[] {
  if (details === undefined) {
    return Object.freeze([])
  }
  if (!Array.isArray(details)) {
    throw new TypeError('GError options.details must be an array')
  }
  const copied: ErrorDetail[] = []
  for (const item of details) {
    if (
      typeof item !== 'object' ||
      item === null ||
      typeof item.typeUrl !== 'string' ||
      typeof item.value !== 'string'
    ) {
      throw new TypeError('Each GError detail must have string typeUrl and value')
    }
    copied.push(Object.freeze({
      typeUrl: item.typeUrl,
      value: item.value,
    }))
  }
  return Object.freeze(copied)
}

/**
 * Universal error bridging native ECMAScript `Error`, Google RPC `Code`
 * semantics, and plain JSON-serializable `GErrorData`.
 */
export class GError extends Error {
  /**
   * Private brand field used by `GError.isGError()` to prevent name spoofing.
   */
  readonly #isGError = true

  /**
   * Canonical Google RPC failure code (1–16). Defaults to `Code.Unknown`.
   */
  readonly code: Code

  /**
   * Opaque typed error details (`typeUrl` + RFC 4648 Base64 `value`).
   */
  readonly details: readonly ErrorDetail[]

  /**
   * Creates a new `GError` with native `Error` behavior and optional RPC code,
   * `details`, and `cause`.
   *
   * @throws {TypeError} When `options.code` is `0` (`OK`) or invalid, or when
   *   `options.details` is malformed.
   */
  constructor (message: string, options?: GErrorOptions) {
    const hasCause =
      typeof options === 'object' &&
      options !== null &&
      'cause' in options

    super(
      message,
      hasCause ? { cause: options.cause } : undefined,
    )

    this.name = 'GError'
    this.code =
      options?.code === undefined
        ? Code.Unknown
        : assertCode(options.code)
    this.details = copyDetails(options?.details)
  }

  /**
   * Returns `true` only for actual `GError` instances (rejects plain objects
   * or other `Error` subclasses spoofing `name: 'GError'`).
   */
  static isGError (value: unknown): value is GError {
    return typeof value === 'object' && value !== null && #isGError in value
  }

  /**
   * Normalizes any thrown value into a `GError`.
   *
   * Existing `GError` instances are returned unchanged. Native `Error`s,
   * `AggregateError`s, primitives, `null`, `undefined`, and plain objects are
   * safely wrapped as `Code.Unknown` without inferring RPC codes from
   * arbitrary `.code` properties.
   */
  static from (value: unknown): GError {
    return normalizeToGError(
      value,
      GError.isGError,
      (message, options) => new GError(message, options),
    )
  }

  /**
   * Validates untrusted canonical `GErrorData` and reconstructs a `GError`.
   *
   * Never executes remote constructors or overwrites the locally generated
   * `stack`. Remote diagnostics are preserved separately when present.
   *
   * @throws {TypeError} On invalid schema, version, `Code`, or Base64.
   * @throws {RangeError} When depth, node, detail, or byte limits are exceeded.
   */
  static fromData (data: unknown): GError {
    return deserializeGError(
      data,
      (message, options) => new GError(message, options),
    )
  }

  /**
   * Alias for `GError.fromData()`.
   */
  static fromJSON (data: unknown): GError {
    return GError.fromData(data)
  }

  /**
   * Parses a JSON string and validates it as canonical `GErrorData`.
   *
   * @throws {TypeError} When `json` is not a string or fails schema validation.
   * @throws {SyntaxError} When `json` is not valid JSON.
   * @throws {RangeError} When resource budgets are exceeded.
   */
  static parse (json: string): GError {
    if (typeof json !== 'string') {
      throw new TypeError('GError.parse() requires a JSON string')
    }
    return GError.fromData(JSON.parse(json))
  }

  /**
   * Normalizes `value` to a `GError` and serializes it with the default
   * safe disclosure policy (`diagnostics: 'omit'`).
   */
  static stringify (value: unknown): string {
    return JSON.stringify(GError.from(value).toData())
  }

  /**
   * Returns a detached, plain JSON-safe `GErrorData` snapshot (`version: 1`).
   *
   * Diagnostics (`name`, `stack`, `originalCode`) are omitted by default
   * unless `options.diagnostics === 'include'`.
   */
  toData (options?: SerializationOptions): GErrorData {
    return serializeGError(this, options)
  }

  /**
   * Returns `this.toData()` with the default safe disclosure policy.
   */
  toJSON (): GErrorData {
    return this.toData()
  }
}
