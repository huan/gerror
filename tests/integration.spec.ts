#!/usr/bin/env -S node --no-warnings --loader ts-node/esm

import { test }  from 'tstest'

import { GError } from '../src/mod.js'

test('smoke testing', async t => {
  const gerror = GError.from(new Error('test'))

  t.ok(gerror, 'should instanciate GError from Error')
})
