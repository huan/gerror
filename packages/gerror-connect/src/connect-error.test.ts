/**
 * Unit tests for `gerror-connect` (`toConnectError` and `fromConnectError`).
 */

import assert from 'node:assert/strict'
import { describe, it } from 'node:test'

import { create, toBinary } from '@bufbuild/protobuf'
import { file_google_protobuf_empty } from '@bufbuild/protobuf/wkt'
import { Code as ConnectCode, ConnectError, createClient, createRouterTransport } from '@connectrpc/connect'
import { Code, GError } from 'gerror'
import { ErrorInfoSchema, fromStatus, RetryInfoSchema, StatusSchema, toStatus } from 'gerror-protobuf'

import { fromConnectError, toConnectError } from './mod.ts'

describe('gerror-connect', () => {
  it('preserves canonical code, rawMessage, and registered details across toConnectError / fromConnectError', () => {
    const errorInfo = create(ErrorInfoSchema, {
      domain: 'wechaty.dev',
      reason: 'PUPPET_NOT_READY',
      metadata: { puppetId: 'p1' },
    })
    const gerr = new GError('puppet not ready', {
      code: Code.FailedPrecondition,
      details: [
        {
          typeUrl: `type.googleapis.com/${ErrorInfoSchema.typeName}`,
          value: Buffer.from(toBinary(ErrorInfoSchema, errorInfo)).toString('base64'),
        },
      ],
      cause: new GError('upstream timeout', { code: Code.DeadlineExceeded }),
    })

    const connectErr = toConnectError(gerr)
    assert.equal(connectErr instanceof ConnectError, true)
    assert.equal(connectErr.code, ConnectCode.FailedPrecondition)
    assert.equal(connectErr.rawMessage, 'puppet not ready')
    assert.equal(connectErr.message, '[failed_precondition] puppet not ready')

    const restored = fromConnectError(connectErr)
    assert.equal(GError.isGError(restored), true)
    assert.equal(restored.code, Code.FailedPrecondition)
    assert.equal(restored.message, 'puppet not ready')
    assert.equal(restored.details.length, 1)
    assert.equal(GError.isGError(restored.cause), true)
    assert.equal((restored.cause as GError).code, Code.DeadlineExceeded)
  })

  it('handles incoming wire details, local ConnectError causes, and isolates metadata headers', () => {
    const incoming = new ConnectError('unauthorized', ConnectCode.Unauthenticated, {
      authorization: 'Bearer super-secret-token',
      cookie: 'session=abc',
    })
    const opaqueBytes = new Uint8Array([1, 2, 3, 4])
    incoming.details.push({
      type: 'acme.v1.CustomDetail',
      value: opaqueBytes,
    })

    const gerr = fromConnectError(incoming)
    assert.equal(gerr.code, Code.Unauthenticated)
    assert.equal(gerr.message, 'unauthorized')
    assert.equal(gerr.details.length, 1)
    assert.equal(gerr.details[0]?.typeUrl, 'type.googleapis.com/acme.v1.CustomDetail')

    // Ensure auth headers/cookies never leak into GErrorData
    const serialized = JSON.stringify(gerr.toData({ diagnostics: 'include' }))
    assert.equal(serialized.includes('super-secret-token'), false)
    assert.equal(serialized.includes('session=abc'), false)

    // Local ConnectError with native cause and OutgoingDetail
    const localCause = new Error('socket closed')
    const outgoing = new ConnectError(
      'unavailable',
      ConnectCode.Unavailable,
      undefined,
      [{ desc: RetryInfoSchema, value: create(RetryInfoSchema, { retryDelay: { seconds: 2n } }) }],
      localCause,
    )
    const fromOutgoing = fromConnectError(outgoing)
    assert.equal(fromOutgoing.code, Code.Unavailable)
    assert.equal(fromOutgoing.cause, localCause)
    assert.equal(fromOutgoing.details.length, 1)
  })

  it('supports cancellation, deadline, and rejects non-ConnectError input in fromConnectError', () => {
    const cancelled = toConnectError(new GError('aborted by caller', { code: Code.Cancelled }))
    assert.equal(cancelled.code, ConnectCode.Canceled)
    assert.equal(fromConnectError(cancelled).code, Code.Cancelled)

    const deadline = toConnectError(new GError('timed out', { code: Code.DeadlineExceeded }))
    assert.equal(deadline.code, ConnectCode.DeadlineExceeded)
    assert.equal(fromConnectError(deadline).code, Code.DeadlineExceeded)

    assert.throws(() => fromConnectError(new Error('plain') as never), TypeError)

    // Converting an existing ConnectError preserves its code and rawMessage
    const existing = new ConnectError('already connect', ConnectCode.NotFound)
    const reWrapped = toConnectError(existing)
    assert.equal(reWrapped.code, ConnectCode.NotFound)
    assert.equal(reWrapped.rawMessage, 'already connect')
  })

  it('supports unary terminal failures and streaming domain events + terminal failures over ConnectRPC', async () => {
    const emptySchema = file_google_protobuf_empty.messages[0]!
    const failUnaryMethod: Record<string, unknown> = {
      kind: 'rpc' as const,
      name: 'FailUnary',
      localName: 'failUnary',
      methodKind: 'unary' as const,
      input: emptySchema,
      output: emptySchema,
    }
    const streamEventsMethod: Record<string, unknown> = {
      kind: 'rpc' as const,
      name: 'StreamEvents',
      localName: 'streamEvents',
      methodKind: 'server_streaming' as const,
      input: emptySchema,
      output: StatusSchema,
    }
    const testService = {
      kind: 'service' as const,
      typeName: 'gerror.test.v1.TestService',
      name: 'TestService',
      methods: [failUnaryMethod, streamEventsMethod],
      method: {
        failUnary: failUnaryMethod,
        streamEvents: streamEventsMethod,
      },
    }
    failUnaryMethod['parent'] = testService
    streamEventsMethod['parent'] = testService

    const transport = createRouterTransport(({ service }) => {
      service(testService as never, {
        async failUnary () {
          throw toConnectError(
            new GError('unary failed', {
              code: Code.PermissionDenied,
              cause: new GError('missing scope', { code: Code.Unauthenticated }),
            }),
          )
        },
        async *streamEvents () {
          // 1. Nonterminal domain GError event (stream continues)
          yield toStatus(new GError('domain warning', { code: Code.FailedPrecondition }))
          // 2. Terminal RPC failure (stream ends)
          throw toConnectError(new GError('stream down', { code: Code.Unavailable }))
        },
      })
    })

    const client = createClient(testService as never, transport) as {
      failUnary: (req: Record<string, never>) => Promise<unknown>
      streamEvents: (req: Record<string, never>) => AsyncIterable<ReturnType<typeof toStatus>>
    }

    await assert.rejects(
      () => client.failUnary({}),
      (err: unknown) => {
        const gerr = fromConnectError(err as ConnectError)
        assert.equal(gerr.code, Code.PermissionDenied)
        assert.equal(gerr.message, 'unary failed')
        assert.equal((gerr.cause as GError).code, Code.Unauthenticated)
        return true
      },
    )

    const receivedDomain: GError[] = []
    let terminal: GError | undefined
    try {
      for await (const statusMsg of client.streamEvents({})) {
        receivedDomain.push(fromStatus(statusMsg))
      }
    } catch (err) {
      terminal = fromConnectError(err as ConnectError)
    }

    assert.equal(receivedDomain.length, 1)
    assert.equal(receivedDomain[0]?.code, Code.FailedPrecondition)
    assert.equal(receivedDomain[0]?.message, 'domain warning')
    assert.equal(terminal?.code, Code.Unavailable)
    assert.equal(terminal?.message, 'stream down')
  })

  it('preserves ErrorContext omitted cause and aggregate errors when ConnectError also has a native cause', () => {
    const agg = GError.from(new AggregateError([new Error('m1')], 'agg'))
    const withOmittedCause = new GError('agg-root', {
      code: Code.Internal,
      cause: () => {},
    })
    const combinedData = {
      ...withOmittedCause.toData(),
      errors: agg.toData().errors,
    }
    const connectErr = toConnectError(GError.fromData(combinedData))
    connectErr.cause = new Error('local connect cause')

    const restored = fromConnectError(connectErr)
    const restoredData = restored.toData()
    assert.deepEqual(restoredData.cause, { kind: 'omitted', reason: 'unsupported-value' })
    assert.equal(restoredData.errors?.length, 1)

    // When ConnectError has aggregate errors (no wire cause) + native cause, preserve both
    const aggConnect = toConnectError(agg)
    aggConnect.cause = new Error('local agg cause')
    const restoredAgg = fromConnectError(aggConnect)
    assert.equal(restoredAgg.toData().errors?.length, 1)
    assert.equal((restoredAgg.cause as GError).message, 'local agg cause')
  })
})
