/**
 * Unit and security tests for `toData()`, `toJSON()`, `GError.stringify()`,
 * disclosure policy, cycle/budget bounds, and mutation isolation.
 */

import assert from 'node:assert/strict'
import { describe, it } from 'node:test'

import { Code, GError } from './mod.ts'

describe('GError serialization (toData / toJSON / stringify)', () => {
  it('produces minimal canonical GErrorData and omits diagnostics by default', () => {
    const err = new GError('Contact not found', { code: Code.NotFound })
    const data = err.toData()

    assert.deepEqual(data, {
      version: 1,
      code: Code.NotFound,
      message: 'Contact not found',
      details: [],
    })
    assert.equal('diagnostics' in data, false)
    assert.deepEqual(err.toJSON(), data)
    assert.equal(GError.stringify(err), JSON.stringify(data))
  })

  it('includes diagnostics recursively only when explicitly requested', () => {
    const root = Object.assign(new TypeError('inner'), { code: 'ENOENT' })
    const outer = new GError('outer', { code: Code.Internal, cause: root })

    const omitted = outer.toData()
    assert.equal(omitted.diagnostics, undefined)
    assert.equal(omitted.cause?.kind, 'error')
    if (omitted.cause?.kind === 'error') {
      assert.equal(omitted.cause.error.diagnostics, undefined)
    }

    const included = outer.toData({ diagnostics: 'include' })
    assert.equal(included.diagnostics?.name, 'GError')
    assert.equal(typeof included.diagnostics?.stack, 'string')
    assert.equal(included.cause?.kind, 'error')
    if (included.cause?.kind === 'error') {
      assert.equal(included.cause.error.diagnostics?.name, 'TypeError')
      assert.equal(included.cause.error.diagnostics?.originalCode, 'ENOENT')
    }
  })

  it('serializes JSON causes, normalizes -0 and sparse arrays, and marks unsupported values', () => {
    const sparse = [1]
    sparse[2] = 3
    const withJsonCause = new GError('failed', {
      cause: { attempt: 2, negZero: -0, sparse },
    })
    const jsonData = withJsonCause.toData()
    assert.deepEqual(jsonData.cause, {
      kind: 'value',
      value: { attempt: 2, negZero: 0, sparse: [1, null, 3] },
    })

    const withNaN = new GError('nan', { cause: Number.NaN })
    assert.deepEqual(withNaN.toData().cause, {
      kind: 'omitted',
      reason: 'unsupported-value',
    })

    const withFn = new GError('fn', { cause: () => {} })
    assert.deepEqual(withFn.toData().cause, {
      kind: 'omitted',
      reason: 'unsupported-value',
    })

    const withCustomClass = new GError('map', { cause: new Map() })
    assert.deepEqual(withCustomClass.toData().cause, {
      kind: 'omitted',
      reason: 'unsupported-value',
    })
  })

  it('distinguishes cycles from shared non-cyclic references', () => {
    const shared = { tag: 'shared' }
    const withShared = new GError('shared', { cause: { a: shared, b: shared } })
    assert.deepEqual(withShared.toData().cause, {
      kind: 'value',
      value: { a: { tag: 'shared' }, b: { tag: 'shared' } },
    })

    const cyclicObj: Record<string, unknown> = { name: 'loop' }
    cyclicObj['self'] = cyclicObj
    const withCycle = new GError('cycle', { cause: cyclicObj })
    assert.deepEqual(withCycle.toData().cause, {
      kind: 'omitted',
      reason: 'cycle',
    })

    const rawCyclic: { message: string; cause?: unknown } = { message: 'err-loop' }
    rawCyclic.cause = rawCyclic
    const fromCyclic = GError.from(rawCyclic)
    assert.deepEqual(fromCyclic.toData().cause, {
      kind: 'omitted',
      reason: 'cycle',
    })
  })

  it('enforces maxDepth, maxNodes, maxBytes, and detailPolicy on detached copies', () => {
    const deep = new GError('d0', {
      cause: new GError('d1', {
        cause: new GError('d2'),
      }),
    })
    const depthLimited = deep.toData({ maxDepth: 1 })
    assert.equal(depthLimited.cause?.kind, 'error')
    if (depthLimited.cause?.kind === 'error') {
      assert.deepEqual(depthLimited.cause.error.cause, {
        kind: 'omitted',
        reason: 'depth-limit',
      })
    }

    const nodeLimited = deep.toData({ maxNodes: 2 })
    assert.equal(nodeLimited.cause?.kind, 'error')
    if (nodeLimited.cause?.kind === 'error') {
      assert.deepEqual(nodeLimited.cause.error.cause, {
        kind: 'omitted',
        reason: 'size-limit',
      })
    }

    const detail = { typeUrl: 'type.googleapis.com/a', value: 'AQID' }
    const withDetails = new GError('details', {
      details: [detail, { typeUrl: 'type.googleapis.com/secret', value: 'BAU=' }],
    })
    const filtered = withDetails.toData({
      detailPolicy: (d) => {
        if (d.typeUrl.endsWith('/secret')) {
          return undefined
        }
        return { typeUrl: d.typeUrl, value: 'AAAA' }
      },
    })
    assert.deepEqual(filtered.details, [{ typeUrl: 'type.googleapis.com/a', value: 'AAAA' }])
    assert.equal(withDetails.details[0]?.value, 'AQID')

    assert.throws(() => new GError('x'.repeat(9000)).toData(), RangeError)
    assert.throws(() => new GError('hello').toData({ maxBytes: 10 }), RangeError)
    assert.throws(() => new GError('hello').toData({ maxDepth: 0 }), RangeError)
    assert.throws(() => new GError('hello').toData({ maxNodes: 1.5 }), TypeError)
    assert.throws(() => new GError('hello').toData({ diagnostics: 'invalid' as never }), TypeError)
    assert.throws(() => new GError('hello').toData({ detailPolicy: 'nope' as never }), TypeError)
  })

  it('serializes AggregateError members and truncates multi-byte UTF-8 stacks cleanly', () => {
    const agg = new AggregateError([new Error('first'), new Error('second')], 'many')
    const gAgg = GError.from(agg)
    const data = gAgg.toData()
    assert.equal(data.errors?.length, 2)
    assert.equal(data.errors?.[0]?.message, 'first')
    assert.equal(data.errors?.[1]?.message, 'second')

    const bigStackErr = new Error('utf8-stack')
    bigStackErr.stack = '😀'.repeat(5000)
    const gStack = GError.from(bigStackErr).toData({ diagnostics: 'include' })
    assert.ok(gStack.diagnostics?.stack)
    assert.equal(new TextEncoder().encode(gStack.diagnostics.stack).byteLength <= 16_384, true)
    assert.equal(gStack.diagnostics.stack.includes('\uFFFD'), false)

    // Non-4-byte aligned multi-byte UTF-8 boundary (3-byte char '中' after 16382 ASCII bytes)
    const unalignedStackErr = new Error('utf8-unaligned')
    unalignedStackErr.stack = `${'a'.repeat(16_382)}中`
    const gUnaligned = GError.from(unalignedStackErr).toData({ diagnostics: 'include' })
    assert.equal(gUnaligned.diagnostics?.stack?.length, 16_382)
  })

  it('rejects oversized details, invalid detailPolicy returns, and cyclic/oversized aggregates', () => {
    const tooManyDetails = Array.from({ length: 33 }, (_, i) => ({
      typeUrl: `type.googleapis.com/t${i}`,
      value: '',
    }))
    assert.throws(() => new GError('many', { details: tooManyDetails }).toData(), RangeError)

    assert.throws(
      () => new GError('bad-b64', { details: [{ typeUrl: 'a', value: 'bad!' }] }).toData(),
      TypeError,
    )
    assert.throws(
      () => new GError('long-url', { details: [{ typeUrl: 'a'.repeat(513), value: '' }] }).toData(),
      RangeError,
    )
    assert.throws(
      () =>
        new GError('big-detail', {
          details: [{ typeUrl: 'a', value: 'AAAA'.repeat(5500) }],
        }).toData(),
      RangeError,
    )
    assert.throws(
      () =>
        new GError('policy-bad', {
          details: [{ typeUrl: 'a', value: 'AQID' }],
        }).toData({ detailPolicy: () => 'invalid' as never }),
      TypeError,
    )
    assert.throws(() => new GError('opts').toData(null as never), TypeError)

    const tooManyErrors = Array.from({ length: 33 }, (_, i) => new Error(`e${i}`))
    assert.throws(() => GError.from(new AggregateError(tooManyErrors, 'many')).toData(), RangeError)

    const aggCyclic = new AggregateError([], 'cyc')
    Object.defineProperty(aggCyclic, 'errors', { value: [aggCyclic] })
    assert.throws(() => new GError('outer', { cause: aggCyclic }).toData(), RangeError)

    // Empty AggregateError omits errors field
    const emptyAgg = GError.from(new AggregateError([], 'empty'))
    assert.equal(emptyAgg.toData().errors, undefined)

    // Missing stack with diagnostics: 'include'
    const noStack = new Error('no-stack')
    noStack.stack = undefined
    const noStackData = GError.from(noStack).toData({ diagnostics: 'include' })
    assert.equal(noStackData.diagnostics?.name, 'Error')
    assert.equal(noStackData.diagnostics?.stack, undefined)

    // Mutating returned toData() snapshot does not affect subsequent calls
    const source = new GError('isolated', {
      details: [{ typeUrl: 'type.googleapis.com/a', value: 'AQID' }],
      cause: { nested: [1] },
    })
    const snap1 = source.toData()
    ;(snap1.details as Array<{ typeUrl: string; value: string }>).push({
      typeUrl: 'type.googleapis.com/b',
      value: 'BAU=',
    })
    ;((snap1.cause as { value: { nested: number[] } }).value.nested).push(99)
    const snap2 = source.toData()
    assert.equal(snap2.details.length, 1)
    assert.deepEqual(snap2.cause, { kind: 'value', value: { nested: [1] } })

    // Native Error cause with non-GError numeric .code stays Code.Unknown
    const nativeWithNumCode = Object.assign(new Error('inner'), { code: -111 })
    const wrappedNative = new GError('outer', { cause: nativeWithNumCode })
    const wrappedData = wrappedNative.toData({ diagnostics: 'include' })
    assert.equal(wrappedData.cause?.kind, 'error')
    if (wrappedData.cause?.kind === 'error') {
      assert.equal(wrappedData.cause.error.code, Code.Unknown)
      assert.equal(wrappedData.cause.error.diagnostics?.originalCode, -111)
    }

    // Sparse array holes count against maxNodes budget
    const hugeSparse: unknown[] = []
    hugeSparse[200] = 'tail'
    const sparseBudget = new GError('sparse-budget', { cause: hugeSparse }).toData({ maxNodes: 2 })
    assert.deepEqual(sparseBudget.cause, { kind: 'omitted', reason: 'size-limit' })
  })
})
