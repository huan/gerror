import test from 'node:test'
import assert from 'node:assert/strict'

import { Code } from '../gerror/grpc.js'
import { TimeoutPromiseGError } from './timeout-promise-gerror.js'

test('TimeoutPromiseGError smoke testing', async () => {
  const MSG = 'test'
  const e = TimeoutPromiseGError.from(MSG)
  assert.equal(e.code, Code.DEADLINE_EXCEEDED, 'should init code to Code.DEADLINE_EXCEEDED')
  assert.equal(e.name, 'DEADLINE_EXCEEDED', 'should init name to "DEADLINE_EXCEEDED"')
  assert.equal(e.message, MSG, 'should init message to MSG')

  assert.ok(e.stack, 'should have stack')
  assert.equal(e.details, e.stack, 'should set details from stack')
})
