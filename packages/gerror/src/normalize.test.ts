/**
 * Unit tests for defensive `GError.from()` normalization.
 */

import assert from 'node:assert/strict'
import { describe, it } from 'node:test'

import { Code, GError } from './mod.ts'

describe('GError.from()', () => {
  it('returns an existing GError instance unchanged (idempotent)', () => {
    const original = new GError('already gerror', { code: Code.NotFound })
    assert.equal(GError.from(original), original)
  })

  it('normalizes native Error and AggregateError without inferring RPC code', () => {
    const cause = new Error('inner')
    const nativeErr = Object.assign(new TypeError('bad input'), { code: 'ENOENT', cause })
    const gerr = GError.from(nativeErr)

    assert.equal(GError.isGError(gerr), true)
    assert.equal(gerr.code, Code.Unknown)
    assert.equal(gerr.message, 'bad input')
    assert.equal(gerr.cause, cause)

    const agg = new AggregateError([new Error('a'), new Error('b')], 'multiple')
    const gAgg = GError.from(agg)
    assert.equal(gAgg.code, Code.Unknown)
    assert.equal(gAgg.message, 'multiple')

    const emptyMsgErr = new RangeError('')
    Object.defineProperty(emptyMsgErr, 'message', { value: undefined })
    assert.equal(GError.from(emptyMsgErr).message, 'RangeError')
  })

  it('normalizes strings, numbers, booleans, null, undefined, symbols, bigints, and functions', () => {
    assert.equal(GError.from('boom').message, 'boom')
    assert.equal(GError.from(404).message, '404')
    assert.equal(GError.from(false).message, 'false')
    assert.equal(GError.from(null).message, 'Unknown error (null)')
    assert.equal(GError.from(undefined).message, 'Unknown error (undefined)')
    assert.equal(GError.from(Symbol('sym')).message, 'Unknown error (Symbol(sym))')
    assert.equal(GError.from(42n).message, 'Unknown error (bigint: 42)')

    const longBigInt = BigInt(`1${'0'.repeat(600)}`)
    const bounded = GError.from(longBigInt)
    assert.equal(bounded.message.endsWith('...'), true)
    assert.equal(bounded.message.length <= 515, true)

    function namedFn () {}
    assert.equal(GError.from(namedFn).message, 'Unknown error (function: namedFn)')
    assert.equal(GError.from(() => {}).message, 'Unknown error (function)')
  })

  it('normalizes plain objects, throwing getters, and cyclic causes safely', () => {
    const plain = { code: 'EACCES', message: 'denied', cause: 'disk' }
    const fromPlain = GError.from(plain)
    assert.equal(fromPlain.code, Code.Unknown)
    assert.equal(fromPlain.message, 'denied')
    assert.equal(fromPlain.cause, 'disk')

    const nonStringMsg = { message: 123 }
    assert.equal(GError.from(nonStringMsg).message, '123')

    const noMsg = { foo: 'bar' }
    assert.equal(GError.from(noMsg).message, 'Unknown error (object)')

    const hostile = {
      get message () {
        throw new Error('getter exploded')
      },
      get cause () {
        throw new Error('cause getter exploded')
      },
    }
    const fromHostile = GError.from(hostile)
    assert.equal(fromHostile.code, Code.Unknown)
    assert.equal(fromHostile.message, 'Unknown error (object)')
    assert.equal('cause' in fromHostile, false)

    const cyclic: { message: string; cause?: unknown } = { message: 'loop' }
    cyclic.cause = cyclic
    const fromCyclic = GError.from(cyclic)
    assert.equal(fromCyclic.message, 'loop')
    assert.equal(GError.isGError(fromCyclic.cause), true)
    assert.equal((fromCyclic.cause as GError).message, 'Unknown error (cyclic cause)')
  })
})
