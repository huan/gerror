import test from 'node:test'
import assert from 'node:assert/strict'

import {
  wrapAsyncError,
} from './wrap-async-error.js'

test('wrapAsyncError() smoke testing', async () => {
  const calls: any[][] = []
  const spy = (...args: any[]) => { calls.push(args) }

  const wrapAsync = wrapAsyncError(spy)

  const DATA = 'test'
  const promise = Promise.resolve(DATA)
  const wrappedPromise = wrapAsync(promise)
  assert.equal(await wrappedPromise, undefined, 'should resolve Promise<any> to void')

  const rejection = Promise.reject(new Error('test'))
  const wrappedRejection = wrapAsync(rejection)
  assert.equal(wrappedRejection, undefined, 'should be void and not to reject')

  assert.equal(calls.length, 0, 'should have no error before microtask drain')
  await new Promise(resolve => setImmediate(resolve))
  assert.equal(calls.length, 1, 'should emit error when promise reject with error')
})

test('wrapAsyncError() with async function', async () => {
  const calls: any[][] = []
  const spy = (...args: any[]) => { calls.push(args) }
  const wrapAsync = wrapAsyncError(spy)

  const ERROR = new Error('test error')

  assert.doesNotThrow(() => wrapAsync(async () => 42)(), 'should not throw when wrap async function')
  assert.equal(calls.length, 0, 'should not emit error when wrap async function with no exception')

  assert.doesNotThrow(() => wrapAsync(async () => { throw ERROR })(), 'should not throw when wrap async function with exception')
  await new Promise(resolve => setImmediate(resolve))
  assert.equal(calls.length, 1, 'should emit error when wrap async function with exception')
  assert.equal(calls[0]![0], ERROR, 'should emit error when wrap async function with exception')
})

test('wrapAsyncError() with a Promise value', async () => {
  const calls: any[][] = []
  const spy = (...args: any[]) => { calls.push(args) }
  const wrapAsync = wrapAsyncError(spy)

  const ERROR = new Error('test error')

  assert.doesNotThrow(() => wrapAsync(Promise.resolve(42)), 'should not throw when wrap a resolved promise')
  assert.equal(calls.length, 0, 'should not emit error when wrap resolved promise with no rejection')

  assert.doesNotThrow(() => wrapAsync(Promise.reject(ERROR)), 'should not throw when wrap rejected promise')
  await new Promise(resolve => setImmediate(resolve))
  assert.equal(calls.length, 1, 'should emit error when wrap promise with rejection')
  assert.equal(calls[0]![0], ERROR, 'should emit rejection error when wrap promise with rejection')
})

test('wrapAsyncError() with synchronous function returning value or throwing', async () => {
  const calls: any[][] = []
  const spy = (...args: any[]) => { calls.push(args) }
  const wrapAsync = wrapAsyncError(spy)

  // Sync return (non-Promise)
  assert.doesNotThrow(() => (wrapAsync as any)(() => 'sync value')())
  assert.equal(calls.length, 0)

  // Sync throw
  const syncError = new Error('sync throw')
  assert.doesNotThrow(() => (wrapAsync as any)(() => { throw syncError })())
  assert.equal(calls.length, 1)
  assert.equal(calls[0]![0], syncError)
})
