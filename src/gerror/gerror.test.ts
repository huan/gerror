import test from 'node:test'
import assert from 'node:assert/strict'

import {
  GError,
  isGError,
} from './gerror.js'
import { Code } from './grpc.js'
import { isPuppetEventErrorPayload } from './puppet.js'
import {
  isJsonObject,
  isJsonValue,
  normalizeJsonData,
  normalizeJsonValue,
} from './dto.js'

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

test('GError.stringify produces valid JSON', async () => {
  const jsonStr = GError.stringify(new Error('error to stringify'))
  assert.ok(typeof jsonStr === 'string')
  const parsed = JSON.parse(jsonStr)
  assert.equal(parsed.message, 'error to stringify')
  assert.equal(parsed.code, Code.UNKNOWN)
})

test('isGError type guard', async () => {
  const gerror = new GError('test')
  assert.equal(isGError(gerror), true)
  assert.equal(isGError(new Error('plain')), false)
  assert.equal(isGError(null), false)
  assert.equal(isGError({ code: 0, toJSON: () => ({}) }), false)
})

test('toEcmaError produces standard Error shape', async () => {
  const gerror = new GError('ecma test', { name: 'CustomName' })
  const ecma = gerror.toEcmaError()
  assert.equal(ecma.message, 'ecma test')
  assert.equal(ecma.name, 'CustomName')
  assert.ok(ecma.stack)
})

test('GError.from idempotency on existing GError instance', async () => {
  const original = new GError('already gerror', { code: 'EXISTING_CODE' })
  const rehydrated = GError.from(original)
  assert.equal(rehydrated, original, 'Should return the same instance')
})

test('GError.from handles PuppetEventErrorPayload', async () => {
  const puppetPayload = {
    data: 'puppet error text',
  }
  assert.ok(isPuppetEventErrorPayload(puppetPayload))
  const gerr = GError.from(puppetPayload)
  assert.equal(gerr.message, 'puppet error text')
})

test('JSON utilities: isJsonValue and isJsonObject', async () => {
  assert.equal(isJsonValue('str'), true)
  assert.equal(isJsonValue(123), true)
  assert.equal(isJsonValue(true), true)
  assert.equal(isJsonValue(null), true)
  assert.equal(isJsonValue([1, 'a', false]), true)
  assert.equal(isJsonValue({ a: 1, b: 'c' }), true)

  // Invalid JSON values
  assert.equal(isJsonValue(123n), false)
  assert.equal(isJsonValue(NaN), false)
  assert.equal(isJsonValue(Infinity), false)
  assert.equal(isJsonValue(() => {}), false)

  // Circular object
  const circular: any = {}
  circular.self = circular
  assert.equal(isJsonValue(circular), false)

  // Object with non-standard prototype
  class CustomClass {}
  assert.equal(isJsonValue(new CustomClass()), false)

  // isJsonObject
  assert.equal(isJsonObject({ valid: true }), true)
  assert.equal(isJsonObject([1, 2]), false)
  assert.equal(isJsonObject('not object'), false)
  assert.equal(isJsonObject(null), false)
})

test('JSON utilities: normalizeJsonData and normalizeJsonValue', async () => {
  assert.equal(normalizeJsonData(null), undefined)
  assert.equal(normalizeJsonData('not object'), undefined)

  const normalized = normalizeJsonData({
    num: 42,
    nan: NaN,
    big: 999n,
    func: () => {},
    sym: Symbol('test'),
    set: new Set([1, 2]),
    map: new Map([['foo', 'bar']]),
    date: new Date('2026-01-01T00:00:00.000Z'),
  })

  assert.deepEqual(normalized, {
    num: 42,
    nan: null,
    big: '999n',
    set: [1, 2],
    map: { foo: 'bar' },
    date: '2026-01-01T00:00:00.000Z',
  })

  // Circular references
  const circular: any = {}
  circular.ref = circular
  const normalizedCircular = normalizeJsonData(circular)
  assert.equal(normalizedCircular?.['ref'], '[Circular]')
})
