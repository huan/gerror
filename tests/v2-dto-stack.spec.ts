import test from 'node:test'
import assert from 'node:assert/strict'

import {
  GError,
  isGErrorDTO,
  Code,
  type GErrorDTO,
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
  assert.ok(clientError.stack.includes('v2-dto-stack.spec'), 'Must capture local call-site line numbers')
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
