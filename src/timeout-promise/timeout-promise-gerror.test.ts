import test from 'node:test'
import assert from 'node:assert/strict'

import { Code } from '../gerror/grpc.js'
import { TimeoutPromiseGError } from './timeout-promise-gerror.js'
import { timeoutPromise } from './timeout-promise.js'

test('TimeoutPromiseGError smoke testing', async () => {
  const MSG = 'test'
  const e = TimeoutPromiseGError.from(MSG)
  assert.equal(e.code, Code.DEADLINE_EXCEEDED, 'should init code to Code.DEADLINE_EXCEEDED')
  assert.equal(e.name, 'DEADLINE_EXCEEDED', 'should init name to "DEADLINE_EXCEEDED"')
  assert.equal(e.message, MSG, 'should init message to MSG')

  assert.ok(e.stack, 'should have stack')
  assert.equal(e.details, e.stack, 'should set details from stack')
})

test('timeoutPromise resolves if future completes before timeout', async () => {
  const result = await timeoutPromise(Promise.resolve('success'), 100)
  assert.equal(result, 'success')
})

test('timeoutPromise rejects with TimeoutPromiseGError if future times out', async () => {
  const neverEnding = new Promise<string>(() => {})
  await assert.rejects(
    async () => timeoutPromise(neverEnding, 10),
    (err: unknown) => {
      assert.ok(err instanceof TimeoutPromiseGError)
      assert.equal((err as TimeoutPromiseGError).code, Code.DEADLINE_EXCEEDED)
      return true
    },
  )
})

test('timeoutPromise rejects with custom error when exceptionFactory provided', async () => {
  const neverEnding = new Promise<string>(() => {})
  const customError = new Error('Custom timeout error')
  await assert.rejects(
    async () => timeoutPromise(neverEnding, 10, () => customError),
    (err: unknown) => {
      assert.equal(err, customError)
      return true
    },
  )
})
