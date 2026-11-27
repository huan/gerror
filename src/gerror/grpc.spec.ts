import test from 'node:test'
import assert from 'node:assert/strict'

import { isGrpcStatus } from './grpc.js'

test('gRPC smoke testing', async () => {
  const payload = {
    code: 2,
    details: undefined,
  }

  assert.ok(isGrpcStatus(payload), 'should be grpc payload')
})
