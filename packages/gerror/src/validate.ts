/**
 * Strict schema and resource-budget validator for untrusted `GErrorData`.
 *
 * Owns structural validation of `GErrorData` (`version: 1`), canonical `Code`,
 * strict own-key checks, RFC 4648 Base64 detail verification, prototype-pollution
 * guards, and bounded depth/node/UTF-8 byte budgets.
 */

import { assertCode } from './code.ts'
import type {
  ErrorCause,
  ErrorDetail,
  ErrorDiagnostics,
  GErrorData,
  JsonValue,
} from './data.ts'
import {
  DEFAULT_MAX_BYTES,
  DEFAULT_MAX_DEPTH,
  DEFAULT_MAX_DETAIL_BYTES,
  DEFAULT_MAX_DETAILS,
  DEFAULT_MAX_ERRORS,
  DEFAULT_MAX_MESSAGE_BYTES,
  DEFAULT_MAX_NODES,
  DEFAULT_MAX_STACK_BYTES,
  DEFAULT_MAX_TYPE_URL_BYTES,
  utf8ByteLength,
  validateStandardBase64,
} from './limits.ts'

const ALLOWED_ROOT_KEYS = new Set([
  'version',
  'code',
  'message',
  'details',
  'diagnostics',
  'cause',
  'errors',
])
const ALLOWED_DETAIL_KEYS = new Set(['typeUrl', 'value'])
const ALLOWED_DIAGNOSTICS_KEYS = new Set(['name', 'stack', 'originalCode'])
const ALLOWED_CAUSE_ERROR_KEYS = new Set(['kind', 'error'])
const ALLOWED_CAUSE_VALUE_KEYS = new Set(['kind', 'value'])
const ALLOWED_CAUSE_OMITTED_KEYS = new Set(['kind', 'reason'])
const OMITTED_REASONS = new Set([
  'cycle',
  'depth-limit',
  'size-limit',
  'unsupported-value',
  'redacted',
])

interface ValidationBudget {
  remainingNodes: number
}

function isPlainRecord (value: unknown): value is Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    return false
  }
  const proto = Object.getPrototypeOf(value)
  return proto === Object.prototype || proto === null
}

function assertAllowedKeys (
  obj: Record<string, unknown>,
  allowed: ReadonlySet<string>,
  label: string,
): void {
  for (const key of Object.keys(obj)) {
    if (!allowed.has(key)) {
      throw new TypeError(`Unexpected property "${key}" on ${label}`)
    }
  }
}

function consumeNode (budget: ValidationBudget): void {
  budget.remainingNodes -= 1
  if (budget.remainingNodes < 0) {
    throw new RangeError(`GErrorData exceeds maximum node budget (${DEFAULT_MAX_NODES})`)
  }
}

function validateDetail (raw: unknown): ErrorDetail {
  if (!isPlainRecord(raw)) {
    throw new TypeError('ErrorDetail must be a plain object')
  }
  assertAllowedKeys(raw, ALLOWED_DETAIL_KEYS, 'ErrorDetail')

  const typeUrl = raw['typeUrl']
  const value = raw['value']
  if (typeof typeUrl !== 'string' || typeof value !== 'string') {
    throw new TypeError('ErrorDetail requires string typeUrl and value')
  }
  if (utf8ByteLength(typeUrl) > DEFAULT_MAX_TYPE_URL_BYTES) {
    throw new RangeError(`ErrorDetail.typeUrl exceeds ${DEFAULT_MAX_TYPE_URL_BYTES} UTF-8 bytes`)
  }
  const decodedBytes = validateStandardBase64(value)
  if (decodedBytes > DEFAULT_MAX_DETAIL_BYTES) {
    throw new RangeError(`ErrorDetail decoded value exceeds ${DEFAULT_MAX_DETAIL_BYTES} bytes`)
  }
  return { typeUrl, value }
}

function validateDiagnostics (raw: unknown): ErrorDiagnostics {
  if (!isPlainRecord(raw)) {
    throw new TypeError('ErrorDiagnostics must be a plain object')
  }
  assertAllowedKeys(raw, ALLOWED_DIAGNOSTICS_KEYS, 'ErrorDiagnostics')

  const name = raw['name']
  const stack = raw['stack']
  const originalCode = raw['originalCode']

  if (name !== undefined && typeof name !== 'string') {
    throw new TypeError('ErrorDiagnostics.name must be a string')
  }
  if (stack !== undefined) {
    if (typeof stack !== 'string') {
      throw new TypeError('ErrorDiagnostics.stack must be a string')
    }
    if (utf8ByteLength(stack) > DEFAULT_MAX_STACK_BYTES) {
      throw new RangeError(`ErrorDiagnostics.stack exceeds ${DEFAULT_MAX_STACK_BYTES} UTF-8 bytes`)
    }
  }
  if (originalCode !== undefined) {
    if (typeof originalCode === 'number') {
      if (!Number.isFinite(originalCode)) {
        throw new TypeError('ErrorDiagnostics.originalCode must be finite')
      }
    } else if (typeof originalCode !== 'string') {
      throw new TypeError('ErrorDiagnostics.originalCode must be a string or finite number')
    }
  }

  return {
    ...(name !== undefined ? { name } : {}),
    ...(stack !== undefined ? { stack } : {}),
    ...(originalCode !== undefined ? { originalCode } : {}),
  }
}

function validateJsonValue (
  raw: unknown,
  depth: number,
  budget: ValidationBudget,
): JsonValue {
  consumeNode(budget)
  if (depth > DEFAULT_MAX_DEPTH) {
    throw new RangeError(`JsonValue exceeds maximum depth (${DEFAULT_MAX_DEPTH})`)
  }

  if (raw === null || typeof raw === 'boolean' || typeof raw === 'string') {
    return raw
  }
  if (typeof raw === 'number') {
    if (!Number.isFinite(raw)) {
      throw new TypeError('JsonValue numbers must be finite')
    }
    return Object.is(raw, -0) ? 0 : raw
  }
  if (Array.isArray(raw)) {
    const out: JsonValue[] = []
    for (let i = 0; i < raw.length; i += 1) {
      if (!(i in raw)) {
        throw new TypeError('Sparse arrays are not valid in canonical GErrorData')
      }
      out.push(validateJsonValue(raw[i], depth + 1, budget))
    }
    return out
  }
  if (isPlainRecord(raw)) {
    const out: Record<string, JsonValue> = {}
    for (const key of Object.keys(raw)) {
      if (key === '__proto__' || key === 'constructor' || key === 'prototype') {
        throw new TypeError(`Disallowed key "${key}" in JsonValue`)
      }
      out[key] = validateJsonValue(raw[key], depth + 1, budget)
    }
    return out
  }
  throw new TypeError('Unsupported value in GErrorData JsonValue')
}

function validateCause (
  raw: unknown,
  depth: number,
  budget: ValidationBudget,
): ErrorCause {
  if (!isPlainRecord(raw)) {
    throw new TypeError('ErrorCause must be a plain object')
  }
  const kind = raw['kind']
  if (kind === 'error') {
    assertAllowedKeys(raw, ALLOWED_CAUSE_ERROR_KEYS, 'ErrorCause(error)')
    return {
      kind: 'error',
      error: validateNode(raw['error'], depth, budget),
    }
  }
  if (kind === 'value') {
    assertAllowedKeys(raw, ALLOWED_CAUSE_VALUE_KEYS, 'ErrorCause(value)')
    return {
      kind: 'value',
      value: validateJsonValue(raw['value'], depth, budget),
    }
  }
  if (kind === 'omitted') {
    assertAllowedKeys(raw, ALLOWED_CAUSE_OMITTED_KEYS, 'ErrorCause(omitted)')
    const reason = raw['reason']
    if (typeof reason !== 'string' || !OMITTED_REASONS.has(reason)) {
      throw new TypeError(`Invalid omitted cause reason: ${String(reason)}`)
    }
    return {
      kind: 'omitted',
      reason: reason as Extract<ErrorCause, { readonly kind: 'omitted' }>['reason'],
    }
  }
  throw new TypeError(`Invalid ErrorCause.kind: ${String(kind)}`)
}

function validateNode (
  raw: unknown,
  depth: number,
  budget: ValidationBudget,
): GErrorData {
  consumeNode(budget)
  if (depth > DEFAULT_MAX_DEPTH) {
    throw new RangeError(`GErrorData exceeds maximum depth (${DEFAULT_MAX_DEPTH})`)
  }
  if (!isPlainRecord(raw)) {
    throw new TypeError('GErrorData must be a plain object')
  }
  assertAllowedKeys(raw, ALLOWED_ROOT_KEYS, 'GErrorData')

  if (raw['version'] !== 1) {
    throw new TypeError(`Unsupported GErrorData version: ${String(raw['version'])}`)
  }
  const code = assertCode(raw['code'])

  const message = raw['message']
  if (typeof message !== 'string') {
    throw new TypeError('GErrorData.message must be a string')
  }
  if (utf8ByteLength(message) > DEFAULT_MAX_MESSAGE_BYTES) {
    throw new RangeError(`GErrorData.message exceeds ${DEFAULT_MAX_MESSAGE_BYTES} UTF-8 bytes`)
  }

  const rawDetails = raw['details']
  if (!Array.isArray(rawDetails)) {
    throw new TypeError('GErrorData.details must be an array')
  }
  if (rawDetails.length > DEFAULT_MAX_DETAILS) {
    throw new RangeError(`GErrorData.details exceeds maximum count (${DEFAULT_MAX_DETAILS})`)
  }
  const details: ErrorDetail[] = []
  for (let i = 0; i < rawDetails.length; i += 1) {
    if (!(i in rawDetails)) {
      throw new TypeError('GErrorData.details must not be sparse')
    }
    details.push(validateDetail(rawDetails[i]))
  }

  const diagnostics =
    raw['diagnostics'] !== undefined
      ? validateDiagnostics(raw['diagnostics'])
      : undefined

  const cause =
    raw['cause'] !== undefined
      ? validateCause(raw['cause'], depth + 1, budget)
      : undefined

  let errors: GErrorData[] | undefined
  if (raw['errors'] !== undefined) {
    const rawErrors = raw['errors']
    if (!Array.isArray(rawErrors)) {
      throw new TypeError('GErrorData.errors must be an array')
    }
    if (rawErrors.length > DEFAULT_MAX_ERRORS) {
      throw new RangeError(`GErrorData.errors exceeds maximum count (${DEFAULT_MAX_ERRORS})`)
    }
    if (rawErrors.length > 0) {
      errors = []
      for (let i = 0; i < rawErrors.length; i += 1) {
        if (!(i in rawErrors)) {
          throw new TypeError('GErrorData.errors must not be sparse')
        }
        errors.push(validateNode(rawErrors[i], depth + 1, budget))
      }
    }
  }

  return {
    version: 1,
    code,
    message,
    details,
    ...(diagnostics !== undefined ? { diagnostics } : {}),
    ...(cause !== undefined ? { cause } : {}),
    ...(errors !== undefined ? { errors } : {}),
  }
}

/**
 * Validates untrusted `unknown` input against the canonical `GErrorData`
 * schema and security budgets, returning a sanitized, detached snapshot.
 *
 * @throws {TypeError} On structural, type, version, `Code`, or Base64 errors.
 * @throws {RangeError} When depth, node, detail, or UTF-8 byte budgets are exceeded.
 */
export function validateGErrorData (raw: unknown): GErrorData {
  const budget: ValidationBudget = { remainingNodes: DEFAULT_MAX_NODES }
  const validated = validateNode(raw, 0, budget)
  const totalBytes = utf8ByteLength(JSON.stringify(validated))
  if (totalBytes > DEFAULT_MAX_BYTES) {
    throw new RangeError(`GErrorData exceeds maximum serialized size (${DEFAULT_MAX_BYTES} bytes)`)
  }
  return validated
}
