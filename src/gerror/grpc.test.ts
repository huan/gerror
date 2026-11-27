import test from 'node:test'
import assert from 'node:assert/strict'

import {
  Code,
  isGrpcStatus,
  toNumericGrpcCode,
} from './grpc.js'

test('gRPC smoke testing', async () => {
  const payload = {
    code: 2,
    details: undefined,
  }

  assert.ok(isGrpcStatus(payload), 'should be grpc payload')
})

test('isGrpcStatus rejects string codes and non-finite numbers', async () => {
  assert.equal(isGrpcStatus({ code: 'AUTH_FAILED' }), false, 'String codes must be rejected by isGrpcStatus')
  assert.equal(isGrpcStatus({ code: NaN }), false, 'NaN must be rejected')
  assert.equal(isGrpcStatus({ code: Infinity }), false, 'Infinity must be rejected')
  assert.equal(isGrpcStatus({ code: Code.UNAVAILABLE }), true, 'Enum Code must be accepted')
  assert.equal(isGrpcStatus({ code: 14 }), true, 'Numeric code must be accepted')
})

test('toNumericGrpcCode handles numeric, custom mapping, and unknown string codes', async () => {
  assert.equal(toNumericGrpcCode(Code.NOT_FOUND), Code.NOT_FOUND)
  assert.equal(toNumericGrpcCode(5), 5)

  // Custom mapping
  const customMap = (code: string) => {
    if (code === 'AUTH_FAILED') return Code.UNAUTHENTICATED
    return undefined
  }
  assert.equal(toNumericGrpcCode('AUTH_FAILED', customMap), Code.UNAUTHENTICATED)
  assert.equal(toNumericGrpcCode('UNKNOWN_DOMAIN_CODE', customMap), Code.UNKNOWN)

  // Numeric string parsing
  assert.equal(toNumericGrpcCode('14'), 14)

  // Undefined code
  assert.equal(toNumericGrpcCode(undefined), Code.UNKNOWN)
})
