import test from 'node:test'
import assert from 'node:assert/strict'

import { VERSION } from './version.js'

test('Make sure the VERSION is fresh in source code', async () => {
  assert.equal(VERSION, '0.0.0', 'version should be 0.0.0 in source code, only updated before publish to NPM')
})
