/**
 * Defensive normalization of arbitrary thrown values into `GError` instances.
 *
 * Owns safe property inspection, primitive/object classification, and bounded
 * cycle-safe traversal for `GError.from()`. Never infers canonical RPC codes
 * from Node error codes or arbitrary `.code` fields, and never executes remote
 * constructors or `toJSON` hooks. Preserves original diagnostics and aggregate
 * members in private metadata.
 */

import { Code } from './code.ts'
import type { ErrorDiagnostics, GErrorOptions } from './data.ts'
import { DEFAULT_MAX_ERRORS } from './limits.ts'
import { type GErrorMetadata, setGErrorMetadata } from './metadata.ts'

const MAX_FALLBACK_MESSAGE_CHARS = 512

/**
 * Factory signature used by `normalizeToGError` to construct `GError` without
 * creating a circular runtime import between `gerror.ts` and `normalize.ts`.
 */
export type GErrorConstructorFn<T extends Error> = (
  message: string,
  options?: GErrorOptions,
) => T

/**
 * Reads an own or prototype property defensively without crashing on throwing
 * getters or hostile Proxy traps.
 */
function safeReadProperty (
  target: object,
  key: PropertyKey,
): { readonly present: boolean; readonly value: unknown } {
  try {
    const ownDesc = Object.getOwnPropertyDescriptor(target, key)
    if (ownDesc !== undefined) {
      if ('value' in ownDesc) {
        return { present: true, value: ownDesc.value }
      }
      if (ownDesc.get !== undefined) {
        return { present: true, value: ownDesc.get.call(target) }
      }
      return { present: false, value: undefined }
    }
    if (!(key in target)) {
      return { present: false, value: undefined }
    }
    return {
      present: true,
      value: (target as Record<PropertyKey, unknown>)[key],
    }
  } catch {
    return { present: false, value: undefined }
  }
}

/**
 * Truncates a string to a safe bounded character length for fallback messages.
 */
function boundFallbackText (text: string): string {
  if (text.length <= MAX_FALLBACK_MESSAGE_CHARS) {
    return text
  }
  return `${text.slice(0, MAX_FALLBACK_MESSAGE_CHARS)}...`
}

/**
 * Converts an arbitrary non-object primitive (or function) into a bounded
 * human-readable message string.
 */
function primitiveToMessage (value: unknown): string {
  if (value === null) {
    return 'Unknown error (null)'
  }
  if (value === undefined) {
    return 'Unknown error (undefined)'
  }
  if (typeof value === 'string') {
    return value
  }
  if (typeof value === 'number' || typeof value === 'boolean') {
    return String(value)
  }
  if (typeof value === 'bigint') {
    return boundFallbackText(`Unknown error (bigint: ${value.toString()})`)
  }
  if (typeof value === 'symbol') {
    return boundFallbackText(`Unknown error (${value.toString()})`)
  }
  if (typeof value === 'function') {
    const fnName = value.name ? `: ${value.name}` : ''
    return boundFallbackText(`Unknown error (function${fnName})`)
  }
  return 'Unknown error'
}

function extractDiagnostics (target: object): ErrorDiagnostics | undefined {
  const nameProp = safeReadProperty(target, 'name')
  const stackProp = safeReadProperty(target, 'stack')
  const codeProp = safeReadProperty(target, 'code')

  const name =
    nameProp.present && typeof nameProp.value === 'string' && nameProp.value.length > 0
      ? nameProp.value
      : undefined
  const stack =
    stackProp.present && typeof stackProp.value === 'string' && stackProp.value.length > 0
      ? stackProp.value
      : undefined
  const originalCode =
    codeProp.present &&
    (typeof codeProp.value === 'string' ||
      (typeof codeProp.value === 'number' && Number.isFinite(codeProp.value)))
      ? codeProp.value
      : undefined

  if (name === undefined && stack === undefined && originalCode === undefined) {
    return undefined
  }
  return {
    ...(name !== undefined ? { name } : {}),
    ...(stack !== undefined ? { stack } : {}),
    ...(originalCode !== undefined ? { originalCode } : {}),
  }
}

/**
 * Normalizes any `unknown` thrown value into a `GError` instance.
 *
 * - Existing `GError` instances are returned as-is (idempotent).
 * - `Error` instances, `AggregateError`s, and plain objects extract `message`,
 *   `cause`, aggregate members, and original diagnostics defensively without
 *   inferring `Code` from arbitrary `.code` values.
 * - Primitives, `null`, `undefined`, `symbol`, `bigint`, and `function`
 *   produce bounded `Unknown` `GError` instances.
 * - Cyclic references in `cause` chains are bounded with `activePath` tracking.
 */
export function normalizeToGError<T extends Error> (
  value: unknown,
  isGError: (candidate: unknown) => candidate is T,
  createGError: GErrorConstructorFn<T>,
  activePath: WeakSet<object> = new WeakSet(),
): T {
  if (isGError(value)) {
    return value
  }

  if (typeof value !== 'object' || value === null) {
    return createGError(primitiveToMessage(value), { code: Code.Unknown })
  }

  if (activePath.has(value)) {
    return createGError('Unknown error (cyclic cause)', { code: Code.Unknown })
  }

  activePath.add(value)
  try {
    const msgProp = safeReadProperty(value, 'message')
    let message: string
    if (msgProp.present && typeof msgProp.value === 'string') {
      message = msgProp.value
    } else if (msgProp.present && msgProp.value !== undefined) {
      message = primitiveToMessage(msgProp.value)
    } else if (value instanceof Error) {
      message = value.name || 'Error'
    } else {
      message = 'Unknown error (object)'
    }

    const diagnostics = extractDiagnostics(value)

    let hasCause = false
    let normalizedCause: unknown
    let omittedCause: GErrorMetadata['omittedCause']

    const causeProp = safeReadProperty(value, 'cause')
    if (causeProp.present) {
      hasCause = true
      if (
        typeof causeProp.value === 'object' &&
        causeProp.value !== null &&
        activePath.has(causeProp.value)
      ) {
        normalizedCause = createGError('Unknown error (cyclic cause)', { code: Code.Unknown })
        omittedCause = { kind: 'omitted', reason: 'cycle' }
      } else {
        normalizedCause = causeProp.value
      }
    }

    let aggregateErrors: T[] | undefined
    if (value instanceof AggregateError) {
      const errorsProp = safeReadProperty(value, 'errors')
      if (errorsProp.present && Array.isArray(errorsProp.value) && errorsProp.value.length > 0) {
        aggregateErrors = []
        const limit = Math.min(errorsProp.value.length, DEFAULT_MAX_ERRORS + 1)
        for (let i = 0; i < limit; i += 1) {
          const member = errorsProp.value[i]
          if (typeof member === 'object' && member !== null && activePath.has(member)) {
            aggregateErrors.push(createGError('Unknown error (cyclic cause)', { code: Code.Unknown }))
          } else {
            aggregateErrors.push(normalizeToGError(member, isGError, createGError, activePath))
          }
        }
      }
    }

    const gerror = createGError(
      message,
      hasCause ? { code: Code.Unknown, cause: normalizedCause } : { code: Code.Unknown },
    )

    if (
      diagnostics !== undefined ||
      aggregateErrors !== undefined ||
      omittedCause !== undefined
    ) {
      setGErrorMetadata(gerror, {
        ...(diagnostics !== undefined ? { diagnostics } : {}),
        ...(aggregateErrors !== undefined ? { errors: aggregateErrors } : {}),
        ...(omittedCause !== undefined ? { omittedCause } : {}),
      })
    }

    return gerror
  } finally {
    activePath.delete(value)
  }
}
