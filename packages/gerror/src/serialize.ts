/**
 * Bounded, disclosure-aware serialization of `GError` into `GErrorData`.
 *
 * Owns recursive `toData()` conversion with active-path `WeakSet` cycle
 * detection, shared node budgets, UTF-8 byte limits, `detailPolicy` execution
 * on detached copies, and explicit diagnostic disclosure (`omit` by default).
 */

import { Code } from './code.ts'
import type {
  ErrorCause,
  ErrorDetail,
  ErrorDiagnostics,
  GErrorData,
  JsonValue,
  SerializationOptions,
} from './data.ts'
import {
  DEFAULT_MAX_DETAIL_BYTES,
  DEFAULT_MAX_DETAILS,
  DEFAULT_MAX_ERRORS,
  DEFAULT_MAX_MESSAGE_BYTES,
  DEFAULT_MAX_STACK_BYTES,
  DEFAULT_MAX_TYPE_URL_BYTES,
  type ResolvedSerializationPolicy,
  resolveSerializationPolicy,
  truncateUtf8,
  utf8ByteLength,
  validateStandardBase64,
} from './limits.ts'
import { getGErrorMetadata } from './metadata.ts'

interface SerializeContext {
  readonly policy: ResolvedSerializationPolicy
  readonly activePath: WeakSet<object>
  remainingNodes: number
}

function isPlainObject (value: object): boolean {
  const proto = Object.getPrototypeOf(value)
  return proto === Object.prototype || proto === null
}

function serializeDetail (
  detail: ErrorDetail,
  policy: ResolvedSerializationPolicy,
): ErrorDetail | undefined {
  const detached: ErrorDetail = {
    typeUrl: detail.typeUrl,
    value: detail.value,
  }
  const filtered = policy.detailPolicy ? policy.detailPolicy(detached) : detached
  if (filtered === undefined) {
    return undefined
  }
  if (
    typeof filtered !== 'object' ||
    filtered === null ||
    typeof filtered.typeUrl !== 'string' ||
    typeof filtered.value !== 'string'
  ) {
    throw new TypeError('detailPolicy must return an ErrorDetail or undefined')
  }
  if (utf8ByteLength(filtered.typeUrl) > DEFAULT_MAX_TYPE_URL_BYTES) {
    throw new RangeError(`ErrorDetail.typeUrl exceeds ${DEFAULT_MAX_TYPE_URL_BYTES} UTF-8 bytes`)
  }
  const decodedBytes = validateStandardBase64(filtered.value)
  if (decodedBytes > DEFAULT_MAX_DETAIL_BYTES) {
    throw new RangeError(`ErrorDetail decoded value exceeds ${DEFAULT_MAX_DETAIL_BYTES} bytes`)
  }
  return {
    typeUrl: filtered.typeUrl,
    value: filtered.value,
  }
}

type JsonConvertResult =
  | { readonly ok: true; readonly value: JsonValue }
  | { readonly ok: false; readonly reason: Extract<ErrorCause, { readonly kind: 'omitted' }>['reason'] }

function toJsonValue (
  raw: unknown,
  depth: number,
  ctx: SerializeContext,
): JsonConvertResult {
  ctx.remainingNodes -= 1
  if (ctx.remainingNodes < 0) {
    return { ok: false, reason: 'size-limit' }
  }
  if (depth > ctx.policy.maxDepth) {
    return { ok: false, reason: 'depth-limit' }
  }

  if (raw === null || typeof raw === 'boolean' || typeof raw === 'string') {
    return { ok: true, value: raw }
  }
  if (typeof raw === 'number') {
    if (!Number.isFinite(raw)) {
      return { ok: false, reason: 'unsupported-value' }
    }
    return { ok: true, value: Object.is(raw, -0) ? 0 : raw }
  }
  if (typeof raw !== 'object') {
    return { ok: false, reason: 'unsupported-value' }
  }
  if (ctx.activePath.has(raw)) {
    return { ok: false, reason: 'cycle' }
  }

  ctx.activePath.add(raw)
  try {
    if (Array.isArray(raw)) {
      const out: JsonValue[] = []
      for (let i = 0; i < raw.length; i += 1) {
        if (!(i in raw)) {
          out.push(null)
          continue
        }
        const elem = toJsonValue(raw[i], depth + 1, ctx)
        if (!elem.ok) {
          return elem
        }
        out.push(elem.value)
      }
      return { ok: true, value: out }
    }

    if (!isPlainObject(raw)) {
      return { ok: false, reason: 'unsupported-value' }
    }

    const out: Record<string, JsonValue> = {}
    for (const key of Object.keys(raw)) {
      if (key === '__proto__' || key === 'constructor' || key === 'prototype') {
        continue
      }
      const prop = toJsonValue((raw as Record<string, unknown>)[key], depth + 1, ctx)
      if (!prop.ok) {
        return prop
      }
      out[key] = prop.value
    }
    return { ok: true, value: out }
  } finally {
    ctx.activePath.delete(raw)
  }
}

function serializeCause (
  rawCause: unknown,
  depth: number,
  ctx: SerializeContext,
): ErrorCause {
  if (depth > ctx.policy.maxDepth) {
    return { kind: 'omitted', reason: 'depth-limit' }
  }
  if (ctx.remainingNodes <= 0) {
    return { kind: 'omitted', reason: 'size-limit' }
  }

  if (typeof rawCause === 'object' && rawCause !== null) {
    if (ctx.activePath.has(rawCause)) {
      return { kind: 'omitted', reason: 'cycle' }
    }
    if (rawCause instanceof Error) {
      return {
        kind: 'error',
        error: serializeErrorNode(rawCause, depth, ctx),
      }
    }
  }

  const converted = toJsonValue(rawCause, depth, ctx)
  if (!converted.ok) {
    return { kind: 'omitted', reason: converted.reason }
  }
  return { kind: 'value', value: converted.value }
}

function buildDiagnostics (err: Error): ErrorDiagnostics | undefined {
  const meta = getGErrorMetadata(err)
  if (meta?.diagnostics !== undefined) {
    const stored = meta.diagnostics
    if (
      stored.name === undefined &&
      stored.stack === undefined &&
      stored.originalCode === undefined
    ) {
      return undefined
    }
    const stack =
      typeof stored.stack === 'string' && stored.stack.length > 0
        ? truncateUtf8(stored.stack, DEFAULT_MAX_STACK_BYTES)
        : undefined
    return {
      ...(stored.name !== undefined ? { name: stored.name } : {}),
      ...(stack !== undefined ? { stack } : {}),
      ...(stored.originalCode !== undefined ? { originalCode: stored.originalCode } : {}),
    }
  }

  const name = err.name || undefined
  const stack =
    typeof err.stack === 'string' && err.stack.length > 0
      ? truncateUtf8(err.stack, DEFAULT_MAX_STACK_BYTES)
      : undefined
  const rawCode = (err as { code?: unknown }).code
  const originalCode =
    err.name !== 'GError' &&
    (typeof rawCode === 'string' || (typeof rawCode === 'number' && Number.isFinite(rawCode)))
      ? rawCode
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

function readGErrorFields (err: Error): {
  readonly code: Code
  readonly details: readonly ErrorDetail[]
} {
  const candidate = err as Error & { code?: unknown; details?: unknown }
  const code = typeof candidate.code === 'number' ? (candidate.code as Code) : Code.Unknown
  const details = Array.isArray(candidate.details)
    ? (candidate.details as readonly ErrorDetail[])
    : []
  return { code, details }
}

function serializeErrorNode (
  err: Error,
  depth: number,
  ctx: SerializeContext,
): GErrorData {
  ctx.remainingNodes -= 1
  if (ctx.remainingNodes < 0) {
    throw new RangeError(`Serialization exceeded maximum node budget (${ctx.policy.maxNodes})`)
  }
  if (depth > ctx.policy.maxDepth) {
    throw new RangeError(`Serialization exceeded maximum depth (${ctx.policy.maxDepth})`)
  }

  ctx.activePath.add(err)
  try {
    const { code, details: rawDetails } = readGErrorFields(err)
    const rawMessage = typeof err.message === 'string' ? err.message : ''
    if (utf8ByteLength(rawMessage) > DEFAULT_MAX_MESSAGE_BYTES) {
      throw new RangeError(`GError.message exceeds ${DEFAULT_MAX_MESSAGE_BYTES} UTF-8 bytes`)
    }

    if (rawDetails.length > DEFAULT_MAX_DETAILS) {
      throw new RangeError(`GError.details exceeds maximum count (${DEFAULT_MAX_DETAILS})`)
    }

    const details: ErrorDetail[] = []
    for (const item of rawDetails) {
      const serialized = serializeDetail(item, ctx.policy)
      if (serialized !== undefined) {
        details.push(serialized)
      }
    }

    const diagnostics =
      ctx.policy.diagnostics === 'include'
        ? buildDiagnostics(err)
        : undefined

    const meta = getGErrorMetadata(err)
    let cause: ErrorCause | undefined
    if (meta?.omittedCause !== undefined) {
      cause = { kind: 'omitted', reason: meta.omittedCause.reason }
    } else if ('cause' in err && err.cause !== undefined) {
      cause = serializeCause(err.cause, depth + 1, ctx)
    }

    const memberErrors =
      meta?.errors ??
      (err instanceof AggregateError && Array.isArray(err.errors) ? err.errors : undefined)

    let errors: GErrorData[] | undefined
    if (memberErrors !== undefined && memberErrors.length > 0) {
      if (memberErrors.length > DEFAULT_MAX_ERRORS) {
        throw new RangeError(`Aggregate errors exceed maximum count (${DEFAULT_MAX_ERRORS})`)
      }
      if (depth + 1 > ctx.policy.maxDepth) {
        throw new RangeError(`Aggregate errors exceed maximum depth (${ctx.policy.maxDepth})`)
      }
      errors = []
      for (const member of memberErrors) {
        if (typeof member === 'object' && member !== null && ctx.activePath.has(member)) {
          throw new RangeError('Cyclic reference inside AggregateError.errors')
        }
        if (member instanceof Error) {
          errors.push(serializeErrorNode(member, depth + 1, ctx))
        } else {
          const fallbackMsg = typeof member === 'string' ? member : 'Unknown error'
          errors.push(serializeErrorNode(new Error(fallbackMsg), depth + 1, ctx))
        }
      }
    }

    return {
      version: 1,
      code,
      message: rawMessage,
      details,
      ...(diagnostics !== undefined ? { diagnostics } : {}),
      ...(cause !== undefined ? { cause } : {}),
      ...(errors !== undefined ? { errors } : {}),
    }
  } finally {
    ctx.activePath.delete(err)
  }
}

/**
 * Serializes a `GError` into a detached, JSON-safe `GErrorData` snapshot
 * enforcing disclosure policy, resource budgets, and Base64/UTF-8 limits.
 */
export function serializeGError (
  error: Error,
  options?: SerializationOptions,
): GErrorData {
  const policy = resolveSerializationPolicy(options)
  const ctx: SerializeContext = {
    policy,
    activePath: new WeakSet(),
    remainingNodes: policy.maxNodes,
  }
  const data = serializeErrorNode(error, 0, ctx)
  const totalBytes = utf8ByteLength(JSON.stringify(data))
  if (totalBytes > policy.maxBytes) {
    throw new RangeError(`Serialized GErrorData exceeds maxBytes (${policy.maxBytes})`)
  }
  return data
}
