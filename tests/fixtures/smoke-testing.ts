/**
 * Typed ESM pack smoke test consumer for gerror v2.
 * Validates package exports, TypeScript types, and runtime behaviors.
 */
import assert from 'node:assert/strict'
import {
  GError,
  VERSION,
  isGErrorDTO,
  Code,
  type GErrorDTO,
  type GrpcStatus,
} from 'gerror'

async function main (): Promise<void> {
  const message = 'smoke testing error'
  const original = new GError(message, {
    code: 'CUSTOM_CODE',
    details: 'Custom details for smoke testing',
    data: { testKey: 'testValue' },
  })

  // 1. Verify instance properties
  assert.equal(original.message, message)
  assert.equal(original.code, 'CUSTOM_CODE')

  // 2. Verify DTO serialization and type guard
  const dto: GErrorDTO = original.toJSON()
  assert.ok(isGErrorDTO(dto), 'DTO must satisfy isGErrorDTO')
  assert.equal(dto.message, message)
  assert.equal(dto.code, 'CUSTOM_CODE')

  // Direct JSON.stringify(error) calling convention
  const directJson = JSON.stringify(original)
  assert.ok(directJson.includes('"message":"smoke testing error"'))

  // Legacy Puppet wire format fixture decoding
  const puppetWire = {
    data: JSON.stringify({
      code: 14,
      message: 'Puppet unavailable',
      details: 'Connection lost',
    }),
  }
  const fromPuppet = GError.from(puppetWire)
  assert.equal(fromPuppet.code, 14)
  assert.equal(fromPuppet.message, 'Puppet unavailable')
  assert.equal(fromPuppet.details, 'Connection lost')

  // 3. Verify gRPC conversion with numeric boundary
  const grpc: GrpcStatus = original.toGrpcStatus()
  assert.equal(typeof grpc.code, 'number', 'gRPC code must be numeric at adapter boundary')
  assert.equal(grpc.code, Code.UNKNOWN, 'Unknown string code should map to Code.UNKNOWN in gRPC status')

  // 4. Verify rehydration
  const rehydrated = GError.from(dto)
  assert.ok(rehydrated instanceof GError, 'Must be GError instance')
  assert.equal(rehydrated.message, message)
  assert.equal(rehydrated.code, 'CUSTOM_CODE')

  console.log(`GError v${VERSION} typed ESM smoke testing passed!`)
}

main().catch((err) => {
  console.error('Smoke testing failed:', err)
  process.exit(1)
})
