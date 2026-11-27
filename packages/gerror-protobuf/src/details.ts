/**
 * Portable Protobuf detail, Base64, and `google.protobuf.Value` helpers.
 *
 * Owns RFC 4648 Base64 byte conversion using `Uint8Array` (no Node `Buffer`),
 * `ErrorDetail` <-> `google.protobuf.Any` conversion preserving unknown bytes,
 * and bounded `JsonValue` <-> `google.protobuf.Value` conversion.
 */

import { create } from '@bufbuild/protobuf'
import {
  type Any,
  AnySchema,
  type ListValue,
  ListValueSchema,
  NullValue,
  type Struct,
  StructSchema,
  type Value,
  ValueSchema,
} from '@bufbuild/protobuf/wkt'
import type { ErrorDetail, JsonValue } from 'gerror'

export const ERROR_CONTEXT_TYPE_URL = 'type.googleapis.com/gerror.v1.ErrorContext'
export const DEBUG_INFO_TYPE_URL = 'type.googleapis.com/google.rpc.DebugInfo'
export const GERROR_STACK_DETAIL_TAG = 'gerror.v1.stack'

const BASE64_CHARS = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/'
const BASE64_RE = /^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/

const BASE64_LOOKUP = new Int16Array(128).fill(-1)
for (let i = 0; i < BASE64_CHARS.length; i += 1) {
  BASE64_LOOKUP[BASE64_CHARS.charCodeAt(i)] = i
}

/**
 * Encodes a `Uint8Array` into RFC 4648 standard Base64 without Node `Buffer`.
 */
export function bytesToBase64 (bytes: Uint8Array): string {
  if (bytes.length === 0) {
    return ''
  }
  const out: string[] = []
  for (let i = 0; i < bytes.length; i += 3) {
    const b0 = bytes[i]!
    const hasB1 = i + 1 < bytes.length
    const hasB2 = i + 2 < bytes.length
    const b1 = hasB1 ? bytes[i + 1]! : 0
    const b2 = hasB2 ? bytes[i + 2]! : 0
    const triple = (b0 << 16) | (b1 << 8) | b2

    out.push(
      BASE64_CHARS[(triple >> 18) & 0x3f]!,
      BASE64_CHARS[(triple >> 12) & 0x3f]!,
      hasB1 ? BASE64_CHARS[(triple >> 6) & 0x3f]! : '=',
      hasB2 ? BASE64_CHARS[triple & 0x3f]! : '=',
    )
  }
  return out.join('')
}

/**
 * Decodes RFC 4648 standard Base64 into a `Uint8Array` without Node `Buffer`.
 *
 * @throws {TypeError} When `value` is not valid RFC 4648 standard Base64.
 */
export function base64ToBytes (value: string): Uint8Array {
  if (value.length % 4 !== 0 || !BASE64_RE.test(value)) {
    throw new TypeError('Invalid RFC 4648 standard Base64 string')
  }
  if (value.length === 0) {
    return new Uint8Array(0)
  }
  const padding = value.endsWith('==') ? 2 : value.endsWith('=') ? 1 : 0
  const outLen = (value.length / 4) * 3 - padding
  const out = new Uint8Array(outLen)
  let outIdx = 0

  for (let i = 0; i < value.length; i += 4) {
    const c0 = BASE64_LOOKUP[value.charCodeAt(i)]!
    const c1 = BASE64_LOOKUP[value.charCodeAt(i + 1)]!
    const ch2 = value.charCodeAt(i + 2)
    const ch3 = value.charCodeAt(i + 3)
    const c2 = ch2 === 61 ? 0 : BASE64_LOOKUP[ch2]!
    const c3 = ch3 === 61 ? 0 : BASE64_LOOKUP[ch3]!
    const triple = (c0 << 18) | (c1 << 12) | (c2 << 6) | c3

    if (outIdx < outLen) out[outIdx++] = (triple >> 16) & 0xff
    if (outIdx < outLen) out[outIdx++] = (triple >> 8) & 0xff
    if (outIdx < outLen) out[outIdx++] = triple & 0xff
  }
  return out
}

/**
 * Converts a canonical `ErrorDetail` into a `google.protobuf.Any` message
 * preserving raw bytes.
 */
export function detailToAny (detail: ErrorDetail): Any {
  return create(AnySchema, {
    typeUrl: detail.typeUrl,
    value: base64ToBytes(detail.value),
  })
}

/**
 * Converts a `google.protobuf.Any` message into a canonical `ErrorDetail`
 * preserving unknown bytes as RFC 4648 standard Base64.
 */
export function anyToDetail (any: Any): ErrorDetail {
  return {
    typeUrl: any.typeUrl,
    value: bytesToBase64(any.value),
  }
}

/**
 * Converts a `JsonValue` into a `google.protobuf.Value`, rejecting nonfinite
 * numbers and normalizing `-0` to `0`.
 */
export function jsonToProtoValue (
  raw: JsonValue,
  depth = 0,
  maxDepth = 8,
): Value {
  if (depth > maxDepth) {
    throw new RangeError(`Value cause exceeds maximum depth (${maxDepth})`)
  }
  if (raw === null) {
    return create(ValueSchema, { kind: { case: 'nullValue', value: NullValue.NULL_VALUE } })
  }
  if (typeof raw === 'boolean') {
    return create(ValueSchema, { kind: { case: 'boolValue', value: raw } })
  }
  if (typeof raw === 'number') {
    if (!Number.isFinite(raw)) {
      throw new TypeError('Protobuf Value numbers must be finite')
    }
    return create(ValueSchema, {
      kind: { case: 'numberValue', value: Object.is(raw, -0) ? 0 : raw },
    })
  }
  if (typeof raw === 'string') {
    return create(ValueSchema, { kind: { case: 'stringValue', value: raw } })
  }
  if (Array.isArray(raw)) {
    const list: ListValue = create(ListValueSchema, {
      values: raw.map((item) => jsonToProtoValue(item, depth + 1, maxDepth)),
    })
    return create(ValueSchema, { kind: { case: 'listValue', value: list } })
  }
  const fields: Record<string, Value> = {}
  for (const key of Object.keys(raw)) {
    if (key === '__proto__' || key === 'constructor' || key === 'prototype') {
      throw new TypeError(`Disallowed key "${key}" in Value cause`)
    }
    fields[key] = jsonToProtoValue((raw as Record<string, JsonValue>)[key]!, depth + 1, maxDepth)
  }
  const struct: Struct = create(StructSchema, { fields })
  return create(ValueSchema, { kind: { case: 'structValue', value: struct } })
}

/**
 * Converts a `google.protobuf.Value` into a `JsonValue`, enforcing depth and
 * node budgets and rejecting nonfinite numbers.
 */
export function protoValueToJson (
  value: Value,
  depth: number,
  budget: { remainingNodes: number },
  maxDepth = 8,
): JsonValue {
  budget.remainingNodes -= 1
  if (budget.remainingNodes < 0) {
    throw new RangeError('Protobuf Value exceeds maximum node budget')
  }
  if (depth > maxDepth) {
    throw new RangeError(`Protobuf Value exceeds maximum depth (${maxDepth})`)
  }

  switch (value.kind.case) {
    case 'nullValue':
    case undefined:
      return null
    case 'boolValue':
      return value.kind.value
    case 'stringValue':
      return value.kind.value
    case 'numberValue': {
      const num = value.kind.value
      if (!Number.isFinite(num)) {
        throw new TypeError('Protobuf Value numbers must be finite')
      }
      return Object.is(num, -0) ? 0 : num
    }
    case 'listValue':
      return value.kind.value.values.map((item) =>
        protoValueToJson(item, depth + 1, budget, maxDepth),
      )
    case 'structValue': {
      const out: Record<string, JsonValue> = {}
      for (const [key, fieldVal] of Object.entries(value.kind.value.fields)) {
        if (key === '__proto__' || key === 'constructor' || key === 'prototype') {
          throw new TypeError(`Disallowed key "${key}" in Protobuf Struct`)
        }
        out[key] = protoValueToJson(fieldVal, depth + 1, budget, maxDepth)
      }
      return out
    }
  }
}
