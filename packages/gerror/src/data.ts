/**
 * Canonical public data and options types for GError.
 *
 * Owns the plain JSON-safe `GErrorData` schema (`version: 1`) and the
 * `GErrorOptions` / `SerializationOptions` contracts shared across runtime,
 * JSON/Redux/CQRS, and wire adapters. Pure type definitions only.
 */

import type { Code } from './code.ts'

/**
 * Any JSON-compatible value allowed inside `ErrorCause` (`kind: 'value'`).
 */
export type JsonValue =
  | null
  | boolean
  | number
  | string
  | readonly JsonValue[]
  | { readonly [key: string]: JsonValue }

/**
 * Opaque typed error detail matching `google.protobuf.Any` in JSON form.
 *
 * `value` is encoded as RFC 4648 standard Base64 so unknown Protobuf detail
 * bytes survive round trips without a schema registry.
 */
export interface ErrorDetail {
  readonly typeUrl: string
  readonly value: string
}

/**
 * Optional diagnostic metadata excluded by default for privacy.
 */
export interface ErrorDiagnostics {
  readonly name?: string
  readonly stack?: string
  readonly originalCode?: string | number
}

/**
 * Bounded, loss-aware representation of an error cause.
 */
export type ErrorCause =
  | { readonly kind: 'error'; readonly error: GErrorData }
  | { readonly kind: 'value'; readonly value: JsonValue }
  | {
      readonly kind: 'omitted'
      readonly reason:
        | 'cycle'
        | 'depth-limit'
        | 'size-limit'
        | 'unsupported-value'
        | 'redacted'
    }

/**
 * Canonical plain-object representation of a `GError` (`version: 1`).
 *
 * Safe for `JSON.stringify`, Redux state/actions, CQRS messages, and event
 * sourcing replay without runtime class prototypes or non-JSON values.
 */
export interface GErrorData {
  readonly version: 1
  readonly code: Code
  readonly message: string
  readonly details: readonly ErrorDetail[]
  readonly diagnostics?: ErrorDiagnostics
  readonly cause?: ErrorCause
  readonly errors?: readonly GErrorData[]
}

/**
 * Options accepted by `new GError(message, options)`.
 */
export interface GErrorOptions extends ErrorOptions {
  readonly code?: Code
  readonly details?: readonly ErrorDetail[]
}

/**
 * Policy options controlling diagnostic disclosure, resource budgets, and
 * detail filtering during serialization.
 */
export interface SerializationOptions {
  readonly diagnostics?: 'omit' | 'include'
  readonly maxDepth?: number
  readonly maxNodes?: number
  readonly maxBytes?: number
  readonly detailPolicy?: (detail: ErrorDetail) => ErrorDetail | undefined
}
