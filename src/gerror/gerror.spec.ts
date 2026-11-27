import test from 'node:test'
import assert from 'node:assert/strict'

import { GError } from './gerror.js'
import { Code } from './grpc.js'
import { isPuppetEventErrorPayload } from './puppet.js'

test('GError class smoke testing', async () => {
  const MESSAGE = 'test'

  const gerror = GError.fromJSON(new Error(MESSAGE))
  const obj = gerror.toJSON()

  assert.equal(obj.code, Code.UNKNOWN, 'should be default code UNKNOWN')
  assert.equal(obj.message, MESSAGE, 'should set message')
})

test('GError from primitive values', async () => {
  const FIXTURES = [
    42,
    'hello world',
    null,
    undefined,
    true,
    false,
    {},
    [],
  ]

  for (const value of FIXTURES) {
    assert.doesNotThrow(() => GError.from(value as any), `should not throw for ${typeof value}: "${JSON.stringify(value)}"`)
  }
})

test('GError JSON payload v.s. EventErrorPayload', async () => {
  const MESSAGE = 'test'

  const gerror = GError.fromJSON(new Error(MESSAGE))
  const obj = gerror.toJSON()

  assert.ok(!isPuppetEventErrorPayload(obj), 'should not pass the EventErrorPayload check')
})

test('GError.from(string) should have stack info', async () => {
  const e = GError.from('test')
  assert.equal(e.name, 'GError', 'should be Error')
  assert.ok(e.stack, 'should have stack info')
})
