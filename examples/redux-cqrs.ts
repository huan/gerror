/**
 * Executable example: Redux / CQRS / Event Sourcing with `GError` and `GErrorData`.
 */

import assert from 'node:assert/strict'
import { Code, GError, type GErrorData } from 'gerror'

function isPlainJson (value: unknown): boolean {
  if (value === null || typeof value !== 'object') {
    return typeof value === 'boolean' || typeof value === 'number' || typeof value === 'string'
  }
  if (Array.isArray(value)) {
    return value.every(isPlainJson)
  }
  const proto = Object.getPrototypeOf(value)
  if (proto !== Object.prototype && proto !== null) {
    return false
  }
  return Object.values(value).every(isPlainJson)
}

const failure = new GError('Puppet startup failed', {
  code: Code.Unavailable,
  cause: new Error('upstream socket closed'),
})

// 1. Dispatch plain serializable data in Redux / CQRS
const data: GErrorData = GError.from(failure).toData()
assert.equal(isPlainJson(data), true)
assert.equal(data.diagnostics, undefined)

const action = {
  type: 'puppet/error' as const,
  error: true as const,
  payload: data,
}

// 2. Persist and replay without throwing
const persisted = JSON.stringify(action.payload)
const replayed = GError.parse(persisted)
assert.equal(replayed instanceof GError, true)
assert.equal(replayed.code, Code.Unavailable)
assert.deepEqual(replayed.toData(), data)

console.log('redux-cqrs example passed')
