/**
 * Unit tests for `GError` runtime behavior, branding, immutability, and public exports.
 */

import assert from 'node:assert/strict'
import { describe, it } from 'node:test'

import * as mod from './mod.ts'
import { Code, GError } from './mod.ts'

describe('GError', () => {
  it('extends native Error with defaults and canonical code', () => {
    const err = new GError('something failed')
    assert.equal(err instanceof Error, true)
    assert.equal(err instanceof GError, true)
    assert.equal(err.name, 'GError')
    assert.equal(err.message, 'something failed')
    assert.equal(err.code, Code.Unknown)
    assert.deepEqual(err.details, [])
    assert.equal(typeof err.stack, 'string')
    assert.equal('cause' in err, false)
  })

  it('accepts all canonical codes and rejects OK or invalid codes', () => {
    for (const code of Object.values(Code)) {
      const err = new GError('msg', { code })
      assert.equal(err.code, code)
    }

    assert.throws(() => new GError('ok', { code: 0 as never }), TypeError)
    assert.throws(() => new GError('bad', { code: 99 as never }), TypeError)
    assert.throws(() => new GError('bad', { code: 'NotFound' as never }), TypeError)
  })

  it('preserves explicit cause including null and undefined', () => {
    const root = new Error('root')
    const withErrorCause = new GError('wrapped', { code: Code.Unavailable, cause: root })
    assert.equal('cause' in withErrorCause, true)
    assert.equal(withErrorCause.cause, root)

    const withNullCause = new GError('null cause', { cause: null })
    assert.equal('cause' in withNullCause, true)
    assert.equal(withNullCause.cause, null)

    const withUndefinedCause = new GError('undef cause', { cause: undefined })
    assert.equal('cause' in withUndefinedCause, true)
    assert.equal(withUndefinedCause.cause, undefined)
  })

  it('copies and freezes details to isolate caller mutations', () => {
    const detail = { typeUrl: 'type.googleapis.com/google.rpc.ErrorInfo', value: 'AQID' }
    const inputDetails = [detail]
    const err = new GError('with details', { details: inputDetails })

    inputDetails.push({ typeUrl: 'type.googleapis.com/other', value: 'BAU=' })
    detail.value = 'MUTATED'

    assert.equal(err.details.length, 1)
    assert.deepEqual(err.details[0], {
      typeUrl: 'type.googleapis.com/google.rpc.ErrorInfo',
      value: 'AQID',
    })
    assert.equal(Object.isFrozen(err.details), true)
    assert.equal(Object.isFrozen(err.details[0]), true)
  })

  it('rejects malformed options.details', () => {
    assert.throws(() => new GError('bad', { details: 'not-array' as never }), TypeError)
    assert.throws(() => new GError('bad', { details: [null] as never }), TypeError)
    assert.throws(() => new GError('bad', { details: [{ typeUrl: 123, value: 'a' }] as never }), TypeError)
  })

  it('uses unforgeable private branding in GError.isGError()', () => {
    const real = new GError('real')
    assert.equal(GError.isGError(real), true)

    const spoofedPlain = { name: 'GError', message: 'fake', code: Code.Unknown, details: [] }
    const spoofedError = Object.assign(new Error('fake'), { name: 'GError', code: Code.Unknown })
    const spoofedProto = Object.create(GError.prototype)

    assert.equal(GError.isGError(spoofedPlain), false)
    assert.equal(GError.isGError(spoofedError), false)
    assert.equal(GError.isGError(spoofedProto), false)
    assert.equal(GError.isGError(null), false)
    assert.equal(GError.isGError('GError'), false)
  })

  it('exports only GError and Code at runtime from mod.ts', () => {
    assert.deepEqual(Object.keys(mod).sort(), ['Code', 'GError'])
  })
})
