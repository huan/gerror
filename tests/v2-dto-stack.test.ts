import test from 'node:test'
import assert from 'node:assert/strict'

import {
  GError,
  isGErrorDTO,
  Code,
  TimeoutPromiseGError,
  type GErrorDTO,
  type GrpcStatus,
} from '../src/mod.js'

test('GError 2.0: GErrorDTO wire contract & lossless round-trip serialization', async () => {
  const original = new GError('User authentication failed', {
    code: 'AUTH_FAILED',
    details: 'JWT token expired at timestamp 1700000000',
    data: { userId: 'user_123', realm: 'admin' },
  })

  // 1. toJSON produces clean GErrorDTO
  const dto: GErrorDTO = original.toJSON()
  assert.ok(isGErrorDTO(dto), 'DTO must satisfy isGErrorDTO guard')
  assert.equal(dto.message, 'User authentication failed')
  assert.equal(dto.code, 'AUTH_FAILED')
  assert.equal(dto.details, 'JWT token expired at timestamp 1700000000')
  assert.deepEqual(dto.data, { userId: 'user_123', realm: 'admin' })
  assert.ok(dto.stack, 'DTO must preserve stack trace')

  // 2. Wire transmission simulation: JSON stringify / parse
  const serialized = JSON.stringify(dto)
  assert.notEqual(serialized, '{}', 'GError must never serialize to empty {}')
  const wireReceived = JSON.parse(serialized)

  // 3. Rehydration on remote recipient
  const rehydrated = GError.from(wireReceived)
  assert.ok(rehydrated instanceof GError, 'Must rehydrate into GError instance')
  assert.equal(rehydrated.message, 'User authentication failed')
  assert.equal(rehydrated.code, 'AUTH_FAILED')
  assert.equal(rehydrated.details, 'JWT token expired at timestamp 1700000000')
  assert.deepEqual(rehydrated.data, { userId: 'user_123', realm: 'admin' })
})

test('GError 2.0: ES2022 nested cause recursion', async () => {
  const rootCause = new Error('Socket ECONNRESET at 192.168.1.1:443')
  const networkError = new GError('Puppet connection dropped', {
    code: Code.UNAVAILABLE,
    cause: rootCause,
  })
  const highLevelError = new GError('Failed to send message', {
    code: Code.INTERNAL,
    cause: networkError,
  })

  // Verify in-memory cause chain
  assert.equal(highLevelError.cause, networkError)
  assert.equal((highLevelError.cause as any).cause, rootCause)

  // Verify serialization of cause chain
  const dto = highLevelError.toJSON()
  assert.ok(dto.cause, 'DTO must serialize cause')
  assert.equal(dto.cause.message, 'Puppet connection dropped')
  assert.equal(dto.cause.code, Code.UNAVAILABLE)
  assert.ok(dto.cause.cause, 'DTO must serialize nested cause')
  assert.equal(dto.cause.cause.message, 'Socket ECONNRESET at 192.168.1.1:443')

  // Rehydrate full cause chain from JSON
  const rehydrated = GError.from(JSON.parse(JSON.stringify(dto)))
  assert.ok(rehydrated.cause instanceof GError, 'Rehydrated cause must be a GError instance')
  assert.equal((rehydrated.cause as GError).message, 'Puppet connection dropped')
  assert.ok((rehydrated.cause as GError).cause instanceof GError)
  assert.equal(((rehydrated.cause as GError).cause as GError).message, 'Socket ECONNRESET at 192.168.1.1:443')
})

test('GError 2.0: Distributed stack trace stitching across remote boundaries', async () => {
  const remoteStack = `Error: Database query timeout
    at RemoteDbDriver.query (/var/service/driver.js:88:12)
    at RemotePuppetService.getContact (/var/service/puppet.js:45:9)`

  const remoteDto: GErrorDTO = {
    name: 'TimeoutError',
    message: 'Database query timeout',
    code: Code.DEADLINE_EXCEEDED,
    stack: remoteStack,
  }

  // Client rehydrates with stack stitching:
  const clientError = GError.from(remoteDto)

  assert.ok(clientError.stack, 'Stack must exist')
  assert.ok(clientError.stack.includes('Database query timeout'), 'Must contain remote error header')
  assert.ok(clientError.stack.includes('/var/service/driver.js:88:12'), 'Must preserve remote line numbers')
  assert.ok(clientError.stack.includes('--- remote boundary ---'), 'Must include boundary delimiter')
  assert.ok(clientError.stack.includes('v2-dto-stack.test'), 'Must capture local call-site line numbers')

  // Caller frame preservation: first frame after remote boundary is the actual caller
  const boundaryIndex = clientError.stack.indexOf('--- remote boundary ---')
  const afterBoundary = clientError.stack.slice(boundaryIndex).split('\n').slice(1)
  assert.ok(afterBoundary.length > 0, 'Must have at least one caller frame')
  assert.ok(!afterBoundary[0]?.includes('extractCallerStackFrames'), 'Must not include internal extractCallerStackFrames')
  assert.ok(!afterBoundary[0]?.includes('GError.from'), 'Must not include GError.from internal frame')
})

test('GError 2.0: Polymorphic subclass rehydration', async () => {
  class WechatyError extends GError {
    override name = 'WechatyError'
  }

  class WechatyAuthError extends WechatyError {
    override name = 'WechatyAuthError'
  }

  const authError = new WechatyAuthError('QR code expired', { code: 'AUTH_EXPIRED' })
  const jsonDto = authError.toJSON()

  // Rehydrate via WechatyAuthError.from
  const rehydrated = WechatyAuthError.from(jsonDto)
  assert.ok(rehydrated instanceof WechatyAuthError, 'Must rehydrate into WechatyAuthError')
  assert.ok(rehydrated instanceof WechatyError, 'Must be instance of WechatyError')
  assert.ok(rehydrated instanceof GError, 'Must be instance of GError')
  assert.equal(rehydrated.message, 'QR code expired')
  assert.equal(rehydrated.code, 'AUTH_EXPIRED')
})

test('GError 2.0: Nested cause classification independence (no subclass leak)', async () => {
  // Timeout DTO wrapping DB_RETRY cause wrapping numeric UNAVAILABLE
  const dto: GErrorDTO = {
    name: 'DEADLINE_EXCEEDED',
    message: 'Operation timed out',
    code: Code.DEADLINE_EXCEEDED,
    cause: {
      name: 'DbRetryError',
      message: 'Database query failed after 3 retries',
      code: 'DB_RETRY',
      stack: 'DbRetryError: Database query failed\n    at db.js:10:5',
      cause: {
        name: 'UNAVAILABLE',
        message: 'Database server unavailable',
        code: Code.UNAVAILABLE,
        stack: 'UNAVAILABLE: Database server unavailable\n    at net.js:20:8',
      },
    },
  }

  const root = TimeoutPromiseGError.from(dto)
  assert.ok(root instanceof TimeoutPromiseGError, 'Root should be TimeoutPromiseGError')
  assert.equal(root.code, Code.DEADLINE_EXCEEDED)

  const cause1 = root.cause as GError
  assert.ok(cause1 instanceof GError, 'Cause 1 should be GError')
  assert.ok(!(cause1 instanceof TimeoutPromiseGError), 'Cause 1 must NOT be coerced into TimeoutPromiseGError')
  assert.equal(cause1.name, 'DbRetryError')
  assert.equal(cause1.code, 'DB_RETRY')
  assert.equal(cause1.stack, 'DbRetryError: Database query failed\n    at db.js:10:5')

  const cause2 = cause1.cause as GError
  assert.ok(cause2 instanceof GError, 'Cause 2 should be GError')
  assert.ok(!(cause2 instanceof TimeoutPromiseGError), 'Cause 2 must NOT be coerced into TimeoutPromiseGError')
  assert.equal(cause2.name, 'UNAVAILABLE')
  assert.equal(cause2.code, Code.UNAVAILABLE)
  assert.equal(cause2.stack, 'UNAVAILABLE: Database server unavailable\n    at net.js:20:8')

  // Verify codes sequence: [4, 'DB_RETRY', 14]
  assert.deepEqual([root.code, cause1.code, cause2.code], [Code.DEADLINE_EXCEEDED, 'DB_RETRY', Code.UNAVAILABLE])
})

test('GError 2.0: Falsy and primitive cause preservation and presence tracking', async () => {
  // 1. Native error with NO cause
  const noCauseErr = new Error('outer')
  assert.equal(Object.hasOwn(noCauseErr, 'cause'), false)
  const gNoCause = GError.from(noCauseErr)
  assert.equal(Object.hasOwn(gNoCause, 'cause'), false)
  assert.equal('cause' in gNoCause.toJSON(), false)

  // 2. Falsy cause values: 0, false, "", null
  const falsyFixtures = [0, false, '', null]
  for (const falsyVal of falsyFixtures) {
    const err = new Error('outer', { cause: falsyVal })
    assert.equal(Object.hasOwn(err, 'cause'), true)

    const gerr = GError.from(err)
    assert.equal(Object.hasOwn(gerr, 'cause'), true)
    assert.equal(gerr.cause, falsyVal)

    const json = gerr.toJSON()
    assert.ok('cause' in json, `cause should be present in JSON for falsy value ${String(falsyVal)}`)
    assert.equal(json.cause?.message, String(falsyVal))
  }

  // 3. String cause containing JSON is kept literal, not parsed
  const fakeJsonString = '{"name":"GError","message":"fake","code":0}'
  const stringCauseErr = new Error('outer', { cause: fakeJsonString })
  const gStringCause = GError.from(stringCauseErr)
  const stringCauseDto = gStringCause.toJSON()
  assert.equal(stringCauseDto.cause?.message, fakeJsonString)
})

test('GError 2.0: Constructor option precedence and presence', async () => {
  // Precedence: explicit null cause on payload must NOT fall back to options.cause
  const fallbackCause = new Error('fallback')
  const payloadWithNullCause = new Error('outer', { cause: null })
  const gerr1 = new GError(payloadWithNullCause, { cause: fallbackCause })
  assert.equal(gerr1.cause, null, 'Explicit null cause should not fall back to options.cause')

  // Explicit code Code.OK (0) and details '' should be preserved
  const gerr2 = new GError(new Error('outer'), { code: Code.OK, details: '' })
  assert.equal(gerr2.code, Code.OK)
  assert.equal(gerr2.details, '')

  // Payload without code or details falling back to options
  const gerr3 = new GError(new Error('failed'), { code: 'AUTH_FAILED', details: 'expired token' })
  assert.equal(gerr3.code, 'AUTH_FAILED')
  assert.equal(gerr3.details, 'expired token')
})

test('GError 2.0: Timestamp preservation across round trips', async () => {
  // Outer timestamp 0 (epoch zero) and nested cause with different timestamp
  const dto: GErrorDTO = {
    name: 'EpochError',
    message: 'Occurred at epoch zero',
    code: 'EPOCH_ZERO',
    timestamp: 0,
    cause: {
      name: 'SubError',
      message: 'Sub error at 1700000000',
      code: 'SUB_CODE',
      timestamp: 1700000000,
    },
  }

  const rehydrated = GError.from(dto, { stitchStack: false })
  assert.equal(rehydrated.timestamp, 0, 'Must preserve timestamp 0')
  assert.equal((rehydrated.cause as GError).timestamp, 1700000000, 'Must preserve nested timestamp')

  const serialized = rehydrated.toJSON()
  assert.equal(serialized.timestamp, 0)
  assert.equal(serialized.cause?.timestamp, 1700000000)

  // DTO without timestamp stays without one
  const noTimestampDto: GErrorDTO = {
    name: 'SimpleError',
    message: 'No timestamp',
    code: 'SIMPLE',
  }
  const rehydratedNoTs = GError.from(noTimestampDto, { stitchStack: false })
  assert.equal(rehydratedNoTs.timestamp, undefined)
  assert.equal('timestamp' in rehydratedNoTs.toJSON(), false)
})

test('GError 2.0: Cause cycle protection against RangeError', async () => {
  const errA = new GError('Error A')
  const errB = new GError('Error B', { cause: errA })
  ;(errA as any).cause = errB // Create cycle: A -> B -> A

  assert.doesNotThrow(() => {
    const dto = errB.toJSON()
    assert.ok(dto.cause)
    assert.equal(dto.cause?.message, 'Error A')
    assert.equal(dto.cause?.cause?.message, '[Circular]')
  })
})

test('GError 2.0: Plain gRPC status semantics preservation', async () => {
  const grpcStatus: GrpcStatus = {
    code: Code.UNAVAILABLE,
  }

  const gerror = GError.from(grpcStatus)
  assert.equal(gerror.name, 'UNAVAILABLE')
  assert.equal(gerror.details, undefined, 'Details should be undefined when omitted in GrpcStatus')

  const backToGrpc = gerror.toGrpcStatus()
  assert.equal(backToGrpc.code, Code.UNAVAILABLE)
  assert.equal(typeof backToGrpc.code, 'number', 'Code must be numeric')
  assert.equal('details' in backToGrpc, false, 'Details should not be populated with local stack')
})

test('GError 2.0: Observable decoding failures in GError.fromJSON', async () => {
  assert.throws(
    () => GError.fromJSON('{}'),
    {
      name: 'TypeError',
    },
    'Empty object should throw TypeError in fromJSON',
  )

  assert.throws(
    () => GError.fromJSON('invalid-json{'),
    {
      name: 'TypeError',
    },
    'Invalid JSON string should throw TypeError in fromJSON',
  )
})

test('GError 2.0: GErrorDTO type guard validation', async () => {
  // Invalid stack type
  assert.equal(isGErrorDTO({ name: 'Error', message: 'test', code: 0, stack: 42 }), false)

  // Invalid details type
  assert.equal(isGErrorDTO({ name: 'Error', message: 'test', code: 0, details: {} }), false)

  // Invalid code (NaN or Infinity)
  assert.equal(isGErrorDTO({ name: 'Error', message: 'test', code: NaN }), false)
  assert.equal(isGErrorDTO({ name: 'Error', message: 'test', code: Infinity }), false)

  // Invalid timestamp (non-finite)
  assert.equal(isGErrorDTO({ name: 'Error', message: 'test', code: 0, timestamp: NaN }), false)

  // Valid DTO
  assert.equal(isGErrorDTO({ name: 'Error', message: 'test', code: 0 }), true)
  assert.equal(isGErrorDTO({ name: 'Error', message: 'test', code: 'STRING_CODE', details: 'ok' }), true)
})

test('GError 2.0: JSON-safe metadata contract on data', async () => {
  const date = new Date('2026-01-01T00:00:00.000Z')
  const gerr = new GError('Data test', {
    data: {
      bigIntValue: 123456789n,
      dateValue: date,
      setValue: new Set(['a', 'b']),
      mapValue: new Map([['key', 'val']]),
      nanValue: NaN,
      infValue: Infinity,
    },
  })

  const dto = gerr.toJSON()
  assert.equal(dto.data?.['bigIntValue'], '123456789n')
  assert.equal(dto.data?.['dateValue'], '2026-01-01T00:00:00.000Z')
  assert.deepEqual(dto.data?.['setValue'], ['a', 'b'])
  assert.deepEqual(dto.data?.['mapValue'], { key: 'val' })
  assert.equal(dto.data?.['nanValue'], null)
  assert.equal(dto.data?.['infValue'], null)

  // Must survive JSON.stringify without throwing
  assert.doesNotThrow(() => JSON.stringify(dto))
})

test('GError 2.0: Subclass registration and code-to-factory mapping (ADR-21)', async () => {
  class CustomDomainError extends GError {
    override name = 'CustomDomainError'
  }

  GError.register('CUSTOM_DOMAIN_CODE', CustomDomainError)

  const dto: GErrorDTO = {
    name: 'CustomDomainError',
    message: 'Domain specific failure',
    code: 'CUSTOM_DOMAIN_CODE',
  }

  const rehydrated = GError.from(dto)
  assert.ok(rehydrated instanceof CustomDomainError, 'Must rehydrate to registered CustomDomainError')
  assert.equal(rehydrated.code, 'CUSTOM_DOMAIN_CODE')

  GError.unregister('CUSTOM_DOMAIN_CODE')
  const rehydratedAfter = GError.from(dto)
  assert.ok(rehydratedAfter instanceof GError)
  assert.ok(!(rehydratedAfter instanceof CustomDomainError))

  // Test factory function registration
  GError.register('CUSTOM_FUNC_CODE', (dtoPayload: GErrorDTO) => {
    return new CustomDomainError(`FactoryFn: ${dtoPayload.message}`)
  })
  const funcRehydrated = GError.from({
    name: 'CustomDomainError',
    message: 'Via factory function',
    code: 'CUSTOM_FUNC_CODE',
  })
  assert.ok(funcRehydrated instanceof CustomDomainError)
  assert.equal(funcRehydrated.message, 'FactoryFn: Via factory function')
  GError.unregister('CUSTOM_FUNC_CODE')
})

test('GError 2.0: Stack stitching caller preservation from JSON string input', async () => {
  const remoteDto: GErrorDTO = {
    name: 'JsonRemoteError',
    message: 'Error from remote json',
    code: 500,
    stack: 'RemoteError: Error from remote json\n    at remoteService.js:1:1',
  }

  const jsonStr = JSON.stringify(remoteDto)
  const clientError = GError.fromJSON(jsonStr)

  assert.ok(clientError.stack)
  assert.ok(clientError.stack.includes('remoteService.js:1:1'))
  assert.ok(clientError.stack.includes('--- remote boundary ---'))

  const boundaryIndex = clientError.stack.indexOf('--- remote boundary ---')
  const afterBoundary = clientError.stack.slice(boundaryIndex).split('\n').slice(1)
  assert.ok(afterBoundary.length > 0)
  assert.ok(!afterBoundary[0]?.includes('fromJSON'), 'Must not include internal fromJSON frame')
  assert.ok(!afterBoundary[0]?.includes('GError.from'), 'Must not include internal GError.from frame')
})

test('GError 2.0: Preserve optional field absence when rehydrating DTO with stitchStack: false', async () => {
  const minimalDto: GErrorDTO = {
    name: 'MinimalError',
    message: 'Minimal payload',
    code: 10,
  }

  const rehydrated = GError.from(minimalDto, { stitchStack: false })
  assert.equal(rehydrated.details, undefined)
  assert.equal(rehydrated.stack, undefined)

  const reserialized = rehydrated.toJSON()
  assert.equal('details' in reserialized, false)
  assert.equal('stack' in reserialized, false)
  assert.deepEqual(reserialized, minimalDto)
})
