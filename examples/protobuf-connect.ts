/**
 * Executable example: Protobuf `google.rpc.Status` and ConnectRPC interoperability.
 */

import assert from 'node:assert/strict'
import { create, fromBinary, toBinary } from '@bufbuild/protobuf'
import { Code, GError } from 'gerror'
import { fromConnectError, toConnectError } from 'gerror-connect'
import { ErrorInfoSchema, fromStatus, StatusSchema, toStatus } from 'gerror-protobuf'

const errorInfo = create(ErrorInfoSchema, {
  domain: 'wechaty.dev',
  reason: 'PUPPET_NOT_READY',
  metadata: { puppetId: 'p1' },
})

const original = new GError('Puppet not ready', {
  code: Code.FailedPrecondition,
  details: [
    {
      typeUrl: `type.googleapis.com/${ErrorInfoSchema.typeName}`,
      value: Buffer.from(toBinary(ErrorInfoSchema, errorInfo)).toString('base64'),
    },
  ],
  cause: { attempt: 1 },
})

// 1. Protobuf Status binary round trip
const status = toStatus(original)
const wireBytes = toBinary(StatusSchema, status)
const decoded = fromStatus(fromBinary(StatusSchema, wireBytes))
assert.equal(decoded.code, Code.FailedPrecondition)
assert.deepEqual(decoded.cause, { attempt: 1 })

// 2. ConnectRPC ConnectError round trip
const connectErr = toConnectError(original)
const fromConnect = fromConnectError(connectErr)
assert.equal(fromConnect.code, Code.FailedPrecondition)
assert.equal(fromConnect.message, 'Puppet not ready')

console.log('protobuf-connect example passed')
