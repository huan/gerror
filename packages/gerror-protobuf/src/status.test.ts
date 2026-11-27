/**
 * Unit, binary, ProtoJSON, and security tests for `gerror-protobuf`.
 */

import assert from 'node:assert/strict'
import { describe, it } from 'node:test'

import { create, fromBinary, fromJson, toBinary, toJson } from '@bufbuild/protobuf'
import { AnySchema, anyPack } from '@bufbuild/protobuf/wkt'
import { Code, GError, type GErrorData } from 'gerror'

import {
  createGErrorRegistry,
  dataToStatus,
  DebugInfoSchema,
  ErrorContextSchema,
  ErrorInfoSchema,
  fromStatus,
  RetryInfoSchema,
  StatusSchema,
  statusToData,
  toStatus,
} from './mod.ts'

describe('gerror-protobuf', () => {
  it('round-trips all 16 canonical codes through binary Status encoding', () => {
    for (const code of Object.values(Code)) {
      const original = new GError(`code-${code}`, { code })
      const status = toStatus(original)
      const bytes = toBinary(StatusSchema, status)
      const decoded = fromBinary(StatusSchema, bytes)
      const restored = fromStatus(decoded)

      assert.equal(GError.isGError(restored), true)
      assert.equal(restored.code, code)
      assert.equal(restored.message, `code-${code}`)
    }
  })

  it('rejects OK (0) and normalizes unknown nonzero RPC codes to Unknown with originalCode', () => {
    const okStatus = create(StatusSchema, { code: 0, message: 'ok' })
    assert.throws(() => statusToData(okStatus), TypeError)
    assert.throws(() => fromStatus(okStatus), TypeError)

    const unknownStatus = create(StatusSchema, { code: 99, message: 'custom rpc' })
    const data = statusToData(unknownStatus)
    assert.equal(data.code, Code.Unknown)
    assert.equal(data.diagnostics?.originalCode, 99)
  })

  it('preserves standard ErrorInfo, RetryInfo, third-party DebugInfo, and unknown Any bytes', () => {
    const errorInfo = create(ErrorInfoSchema, {
      reason: 'PUPPET_NOT_READY',
      domain: 'wechaty.dev',
      metadata: { puppetId: 'p1' },
    })
    const retryInfo = create(RetryInfoSchema, {
      retryDelay: { seconds: 5n, nanos: 0 },
    })
    const thirdPartyDebug = create(DebugInfoSchema, {
      detail: 'upstream-trace',
      stackEntries: ['upstream:1'],
    })
    const unknownBytes = new Uint8Array([0x08, 0x96, 0x01, 0xff, 0x00])
    const unknownAny = create(AnySchema, {
      typeUrl: 'type.googleapis.com/acme.v1.OpaqueDetail',
      value: unknownBytes,
    })

    const status = create(StatusSchema, {
      code: Code.FailedPrecondition,
      message: 'not ready',
      details: [
        anyPack(ErrorInfoSchema, errorInfo),
        anyPack(RetryInfoSchema, retryInfo),
        anyPack(DebugInfoSchema, thirdPartyDebug),
        unknownAny,
      ],
    })

    const gerr = fromStatus(status)
    assert.equal(gerr.code, Code.FailedPrecondition)
    assert.equal(gerr.details.length, 4)

    const roundTripped = toStatus(gerr)
    const roundTrippedBytes = toBinary(StatusSchema, roundTripped)
    const finalStatus = fromBinary(StatusSchema, roundTrippedBytes)

    assert.equal(finalStatus.details.length, 4)
    assert.equal(finalStatus.details[3]?.typeUrl, 'type.googleapis.com/acme.v1.OpaqueDetail')
    assert.deepEqual(finalStatus.details[3]?.value, unknownBytes)
  })

  it('round-trips nested error causes, JsonValue causes, omitted causes, aggregates, and diagnostics', () => {
    const data: GErrorData = {
      version: 1,
      code: Code.Unavailable,
      message: 'outer',
      details: [],
      diagnostics: {
        name: 'RemoteError',
        stack: 'RemoteError: outer\n  at a.ts:1',
        originalCode: 'ECONNREFUSED',
      },
      cause: {
        kind: 'error',
        error: {
          version: 1,
          code: Code.InvalidArgument,
          message: 'inner',
          details: [],
          cause: {
            kind: 'value',
            value: { attempt: 2, ok: true, tags: ['a', null], negZero: -0 },
          },
        },
      },
      errors: [
        {
          version: 1,
          code: Code.NotFound,
          message: 'member',
          details: [],
          cause: { kind: 'omitted', reason: 'cycle' },
        },
      ],
    }

    const status = dataToStatus(data)
    const bytes = toBinary(StatusSchema, status)
    const decoded = statusToData(fromBinary(StatusSchema, bytes))

    assert.deepEqual(decoded, {
      ...data,
      cause: {
        kind: 'error',
        error: {
          version: 1,
          code: Code.InvalidArgument,
          message: 'inner',
          details: [],
          cause: {
            kind: 'value',
            value: { attempt: 2, ok: true, tags: ['a', null], negZero: 0 },
          },
        },
      },
    })
  })

  it('supports registered ProtoJSON round trips with createGErrorRegistry()', () => {
    const registry = createGErrorRegistry()
    const err = new GError('json proto', {
      code: Code.PermissionDenied,
      cause: { role: 'guest' },
    })
    const status = toStatus(err, { diagnostics: 'include' })
    const json = toJson(StatusSchema, status, { registry })
    const parsed = fromJson(StatusSchema, json, { registry })
    const restored = fromStatus(parsed)

    assert.equal(restored.code, Code.PermissionDenied)
    assert.equal(restored.message, 'json proto')
    assert.deepEqual(restored.cause, { role: 'guest' })
  })

  it('rejects duplicate ErrorContext, nonfinite Value numbers, and oversized nested payloads', () => {
    const ctx = anyPack(ErrorContextSchema, create(ErrorContextSchema, { name: 'A' }))
    const dupStatus = create(StatusSchema, {
      code: Code.Internal,
      message: 'dup',
      details: [ctx, ctx],
    })
    assert.throws(() => statusToData(dupStatus), TypeError)

    assert.throws(
      () =>
        dataToStatus({
          version: 1,
          code: Code.Unknown,
          message: 'bad',
          details: [],
          cause: { kind: 'value', value: Number.NaN },
        }),
      TypeError,
    )

    // Exceed depth limit (8)
    let nested = create(StatusSchema, { code: Code.Unknown, message: 'leaf' })
    for (let i = 0; i < 10; i += 1) {
      nested = create(StatusSchema, {
        code: Code.Unknown,
        message: `n${i}`,
        details: [
          anyPack(
            ErrorContextSchema,
            create(ErrorContextSchema, {
              cause: { case: 'errorCause', value: nested },
            }),
          ),
        ],
      })
    }
    assert.throws(() => statusToData(nested), RangeError)
  })

  it('covers Base64 padding, numeric originalCode, Struct guards, and node/depth limits', () => {
    // 0, 1, 2, 3 byte payloads to exercise all Base64 padding paths
    for (const rawBytes of [
      new Uint8Array([]),
      new Uint8Array([1]),
      new Uint8Array([1, 2]),
      new Uint8Array([1, 2, 3]),
    ]) {
      const status = create(StatusSchema, {
        code: Code.Internal,
        message: 'b64',
        details: [create(AnySchema, { typeUrl: 'type.googleapis.com/x', value: rawBytes })],
      })
      const gerr = fromStatus(status)
      const roundTripped = toStatus(gerr)
      assert.deepEqual(roundTripped.details[0]?.value, rawBytes)
    }

    // Numeric originalCode round trip
    const numOrig: GErrorData = {
      version: 1,
      code: Code.Unknown,
      message: 'orig-num',
      details: [],
      diagnostics: { originalCode: 42 },
    }
    assert.deepEqual(statusToData(dataToStatus(numOrig)), numOrig)

    // Reject manual ErrorContext in details, invalid version/code, and invalid Base64
    assert.throws(
      () =>
        dataToStatus({
          version: 1,
          code: Code.Unknown,
          message: 'manual-ctx',
          details: [{ typeUrl: 'type.googleapis.com/gerror.v1.ErrorContext', value: '' }],
        }),
      TypeError,
    )
    assert.throws(
      () =>
        dataToStatus({
          version: 2 as never,
          code: Code.Unknown,
          message: 'v2',
          details: [],
        }),
      TypeError,
    )
    assert.throws(
      () =>
        dataToStatus({
          version: 1,
          code: 0 as never,
          message: 'ok',
          details: [],
        }),
      TypeError,
    )
    assert.throws(
      () =>
        dataToStatus({
          version: 1,
          code: Code.Unknown,
          message: 'bad-b64',
          details: [{ typeUrl: 'type.googleapis.com/x', value: 'bad!' }],
        }),
      TypeError,
    )

    // Exceed node budget (128) on Status decoding
    const wideList = Array.from({ length: 130 }, (_, i) => i)
    const wideStatus = dataToStatus({
      version: 1,
      code: Code.Unknown,
      message: 'wide',
      details: [],
      cause: { kind: 'value', value: wideList },
    })
    assert.throws(() => statusToData(wideStatus), RangeError)

    // Enforce message, detail count, detail bytes, and typeUrl limits on statusToData
    assert.throws(
      () => statusToData(create(StatusSchema, { code: Code.Unknown, message: 'm'.repeat(8193) })),
      RangeError,
    )
    assert.throws(
      () =>
        statusToData(
          create(StatusSchema, {
            code: Code.Unknown,
            message: 'too many details',
            details: Array.from({ length: 33 }, () =>
              create(AnySchema, { typeUrl: 'type.googleapis.com/a', value: new Uint8Array(0) }),
            ),
          }),
        ),
      RangeError,
    )
    assert.throws(
      () =>
        statusToData(
          create(StatusSchema, {
            code: Code.Unknown,
            message: 'big any',
            details: [
              create(AnySchema, { typeUrl: 'type.googleapis.com/a', value: new Uint8Array(16_385) }),
            ],
          }),
        ),
      RangeError,
    )
    assert.throws(
      () =>
        statusToData(
          create(StatusSchema, {
            code: Code.Unknown,
            message: 'long typeUrl',
            details: [
              create(AnySchema, { typeUrl: 'a'.repeat(513), value: new Uint8Array(0) }),
            ],
          }),
        ),
      RangeError,
    )

    // Enforce message, detail count, and aggregate error count limits on dataToStatus
    assert.throws(
      () =>
        dataToStatus({
          version: 1,
          code: Code.Unknown,
          message: 'm'.repeat(8193),
          details: [],
        }),
      RangeError,
    )
    assert.throws(
      () =>
        dataToStatus({
          version: 1,
          code: Code.Unknown,
          message: 'many details',
          details: Array.from({ length: 33 }, () => ({ typeUrl: 'a', value: '' })),
        }),
      RangeError,
    )
    assert.throws(
      () =>
        dataToStatus({
          version: 1,
          code: Code.Unknown,
          message: 'many errors',
          details: [],
          errors: Array.from({ length: 33 }, () => ({
            version: 1,
            code: Code.Unknown,
            message: 'e',
            details: [],
          })),
        }),
      RangeError,
    )
  })
})
