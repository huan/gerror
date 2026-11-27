import test from 'node:test'
import assert from 'node:assert/strict'

import { GError } from '../src/mod.js'

test('smoke testing', async () => {
  const gerror = GError.from(new Error('test'))
  assert.ok(gerror, 'should instantiate GError from Error')
  assert.equal(gerror.message, 'test')
})
