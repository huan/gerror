/**
 * Deserialization of canonical `GErrorData` into local `GError` instances.
 *
 * Validates untrusted input via `validateGErrorData()`, reconstructs `GError`
 * without executing remote constructors or overwriting local `stack`, and
 * preserves remote diagnostics, aggregate members, and omitted-cause markers
 * in private metadata.
 */

import type { GErrorData, GErrorOptions, JsonValue } from './data.ts'
import { type GErrorMetadata, setGErrorMetadata } from './metadata.ts'
import { validateGErrorData } from './validate.ts'

export type DeserializedGErrorFactory<T extends Error> = (
  message: string,
  options?: GErrorOptions,
) => T

function cloneJsonValue (value: JsonValue): JsonValue {
  if (value === null || typeof value !== 'object') {
    return value
  }
  if (Array.isArray(value)) {
    return value.map((item) => cloneJsonValue(item))
  }
  const copy: Record<string, JsonValue> = {}
  for (const key of Object.keys(value)) {
    copy[key] = cloneJsonValue((value as Record<string, JsonValue>)[key]!)
  }
  return copy
}

function reconstructNode<T extends Error> (
  data: GErrorData,
  createGError: DeserializedGErrorFactory<T>,
): T {
  let hasCause = false
  let causeValue: unknown
  let omittedCause: GErrorMetadata['omittedCause']

  if (data.cause !== undefined) {
    if (data.cause.kind === 'error') {
      hasCause = true
      causeValue = reconstructNode(data.cause.error, createGError)
    } else if (data.cause.kind === 'value') {
      hasCause = true
      causeValue = cloneJsonValue(data.cause.value)
    } else {
      omittedCause = { kind: 'omitted', reason: data.cause.reason }
    }
  }

  const options: GErrorOptions = {
    code: data.code,
    details: data.details,
    ...(hasCause ? { cause: causeValue } : {}),
  }

  const instance = createGError(data.message, options)

  const reconstructedErrors =
    data.errors !== undefined && data.errors.length > 0
      ? data.errors.map((member) => reconstructNode(member, createGError))
      : undefined

  setGErrorMetadata(instance, {
    diagnostics: data.diagnostics !== undefined ? { ...data.diagnostics } : {},
    ...(reconstructedErrors !== undefined ? { errors: reconstructedErrors } : {}),
    ...(omittedCause !== undefined ? { omittedCause } : {}),
  })

  return instance
}

/**
 * Validates `raw` as canonical `GErrorData` and reconstructs a `GError`.
 */
export function deserializeGError<T extends Error> (
  raw: unknown,
  createGError: DeserializedGErrorFactory<T>,
): T {
  const validated = validateGErrorData(raw)
  return reconstructNode(validated, createGError)
}
