/**
 * Unit and security tests for `GError.fromData()`, `GError.fromJSON()`,
 * `GError.parse()`, validation budgets, and semantic JSON round trips.
 */

import assert from 'node:assert/strict'
import { describe, it } from 'node:test'

import { Code, GError, type GErrorData } from './mod.ts'

describe('GError deserialization (fromData / fromJSON / parse)', () => {
  it('round-trips canonical GErrorData with deep equality under identical policy', () => {
    const original = new GError('outer', {
      code: Code.FailedPrecondition,
      details: [{ typeUrl: 'type.googleapis.com/google.rpc.ErrorInfo', value: 'AQID' }],
      cause: new GError('inner', {
        code: Code.Unavailable,
        cause: { attempt: 3, ok: false },
      }),
    })

    const first = original.toData()
    const restored = GError.fromData(first)
    const second = restored.toData()

    assert.equal(GError.isGError(restored), true)
    assert.deepEqual(second, first)
    assert.deepEqual(GError.fromJSON(first).toData(), first)
    assert.deepEqual(GError.parse(JSON.stringify(first)).toData(), first)
  })

  it('round-trips diagnostics, aggregate errors, and omitted causes without overwriting local stack', () => {
    const remoteData: GErrorData = {
      version: 1,
      code: Code.Internal,
      message: 'remote failure',
      details: [],
      diagnostics: {
        name: 'RemoteCustomError',
        stack: 'RemoteCustomError: boom\n    at remote.ts:1:1',
        originalCode: 'ECONNRESET',
      },
      cause: { kind: 'omitted', reason: 'cycle' },
      errors: [
        { version: 1, code: Code.NotFound, message: 'missing', details: [] },
      ],
    }

    const restored = GError.fromData(remoteData)
    assert.equal(restored.name, 'GError')
    assert.notEqual(restored.stack, remoteData.diagnostics?.stack)

    // Default policy omits diagnostics
    const omitted = restored.toData()
    assert.equal(omitted.diagnostics, undefined)
    assert.deepEqual(omitted.cause, { kind: 'omitted', reason: 'cycle' })
    assert.equal(omitted.errors?.length, 1)

    // Explicit include preserves remote diagnostics
    const included = restored.toData({ diagnostics: 'include' })
    assert.deepEqual(included, remoteData)
  })

  it('isolates mutations to value causes on deserialization', () => {
    const input: GErrorData = {
      version: 1,
      code: Code.InvalidArgument,
      message: 'bad',
      details: [],
      cause: { kind: 'value', value: { nested: [1, 2] } },
    }
    const restored = GError.fromData(input)
    ;((input.cause as { value: { nested: number[] } }).value.nested).push(3)
    assert.deepEqual(restored.cause, { nested: [1, 2] })
  })

  it('rejects malformed JSON, wrong version, OK code, invalid Base64, unknown keys, and nonfinite numbers', () => {
    assert.throws(() => GError.parse(123 as never), TypeError)
    assert.throws(() => GError.parse('{not-json'), SyntaxError)

    const valid: GErrorData = {
      version: 1,
      code: Code.NotFound,
      message: 'missing',
      details: [],
    }

    assert.throws(() => GError.fromData(null), TypeError)
    assert.throws(() => GError.fromData({ ...valid, version: 2 }), TypeError)
    assert.throws(() => GError.fromData({ ...valid, code: 0 }), TypeError)
    assert.throws(() => GError.fromData({ ...valid, extra: true }), TypeError)
    assert.throws(() => GError.fromData({ ...valid, details: [{ typeUrl: 'a', value: 'bad!' }] }), TypeError)
    assert.throws(() => GError.fromData({ ...valid, details: [{ typeUrl: 'a', value: 'AQ==' , x: 1 }] }), TypeError)
    assert.throws(
      () => GError.fromData({ ...valid, cause: { kind: 'value', value: Number.NaN } }),
      TypeError,
    )
    assert.throws(
      () => GError.fromData({ ...valid, cause: { kind: 'omitted', reason: 'bogus' } }),
      TypeError,
    )
  })

  it('rejects prototype pollution keys and oversized inputs', () => {
    const pollutedJson =
      '{"version":1,"code":2,"message":"polluted","details":[],"cause":{"kind":"value","value":{"__proto__":{"admin":true}}}}'
    assert.throws(() => GError.parse(pollutedJson), TypeError)

    const constructorKeyJson =
      '{"version":1,"code":2,"message":"polluted","details":[],"cause":{"kind":"value","value":{"constructor":{"x":1}}}}'
    assert.throws(() => GError.parse(constructorKeyJson), TypeError)

    const oversizedMsg: GErrorData = {
      version: 1,
      code: Code.Unknown,
      message: 'a'.repeat(8193),
      details: [],
    }
    assert.throws(() => GError.fromData(oversizedMsg), RangeError)

    // Exceed maxDepth (8)
    let deep: GErrorData = { version: 1, code: Code.Unknown, message: 'leaf', details: [] }
    for (let i = 0; i < 10; i += 1) {
      deep = { version: 1, code: Code.Unknown, message: `n${i}`, details: [], cause: { kind: 'error', error: deep } }
    }
    assert.throws(() => GError.fromData(deep), RangeError)

    // Additional validation branches: details, diagnostics, errors, JsonValue, node/byte limits
    const base: GErrorData = { version: 1, code: Code.Unknown, message: 'ok', details: [] }
    assert.throws(() => GError.fromData({ ...base, message: 123 }), TypeError)
    assert.throws(() => GError.fromData({ ...base, details: 'nope' }), TypeError)
    assert.throws(() => GError.fromData({ ...base, details: [null] }), TypeError)
    assert.throws(
      () => GError.fromData({ ...base, details: [{ typeUrl: 1, value: '' }] }),
      TypeError,
    )
    assert.throws(
      () => GError.fromData({ ...base, details: [{ typeUrl: 'a'.repeat(513), value: '' }] }),
      RangeError,
    )
    assert.throws(
      () =>
        GError.fromData({
          ...base,
          details: [{ typeUrl: 'a', value: 'AAAA'.repeat(5500) }],
        }),
      RangeError,
    )
    assert.throws(
      () =>
        GError.fromData({
          ...base,
          details: Array.from({ length: 33 }, () => ({ typeUrl: 'a', value: '' })),
        }),
      RangeError,
    )

    assert.throws(() => GError.fromData({ ...base, diagnostics: 'bad' }), TypeError)
    assert.throws(() => GError.fromData({ ...base, diagnostics: { name: 1 } }), TypeError)
    assert.throws(() => GError.fromData({ ...base, diagnostics: { stack: 1 } }), TypeError)
    assert.throws(
      () => GError.fromData({ ...base, diagnostics: { stack: 's'.repeat(16_385) } }),
      RangeError,
    )
    assert.throws(
      () => GError.fromData({ ...base, diagnostics: { originalCode: Number.NaN } }),
      TypeError,
    )
    assert.throws(
      () => GError.fromData({ ...base, diagnostics: { originalCode: true } }),
      TypeError,
    )

    assert.throws(() => GError.fromData({ ...base, cause: 'bad' }), TypeError)
    assert.throws(() => GError.fromData({ ...base, cause: { kind: 'other' } }), TypeError)
    assert.throws(
      () => GError.fromData({ ...base, cause: { kind: 'value', value: [1, undefined] } }),
      TypeError,
    )

    assert.throws(() => GError.fromData({ ...base, errors: 'bad' }), TypeError)
    assert.throws(
      () =>
        GError.fromData({
          ...base,
          errors: Array.from({ length: 33 }, () => base),
        }),
      RangeError,
    )

    // Exceed node budget (128)
    const wideArray = Array.from({ length: 130 }, (_, i) => i)
    assert.throws(
      () => GError.fromData({ ...base, cause: { kind: 'value', value: wideArray } }),
      RangeError,
    )
  })
})
