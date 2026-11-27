/**
 * Cross-language Protobuf interoperability tests between `gerror-protobuf`
 * and an independent Go (`google.golang.org/genproto/googleapis/rpc/status`)
 * implementation in both directions.
 */

import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { describe, it } from 'node:test'

import { create, fromBinary, toBinary } from '@bufbuild/protobuf'
import { Code, GError } from 'gerror'
import { ErrorInfoSchema, fromStatus, StatusSchema, toStatus } from 'gerror-protobuf'

const GO_FIXTURE_DIR = resolve('tests/fixtures/go')

describe('Go <-> TypeScript google.rpc.Status interoperability', () => {
  it('decodes Go-emitted Status with ErrorInfo, RetryInfo, and unknown Any bytes, and preserves them on re-encode', (t) => {
    const dir = mkdtempSync(join(tmpdir(), 'gerror-go-interop-'))
    t.after(() => rmSync(dir, { recursive: true, force: true }))

    const goBinPath = join(dir, 'go-status.bin')
    execFileSync('go', ['run', '.', 'emit', goBinPath], {
      cwd: GO_FIXTURE_DIR,
      stdio: 'inherit',
    })

    const goBytes = readFileSync(goBinPath)
    const status = fromBinary(StatusSchema, goBytes)
    const gerr = fromStatus(status)

    assert.equal(gerr.code, Code.FailedPrecondition)
    assert.equal(gerr.message, 'go puppet not ready')
    assert.equal(gerr.details.length, 3)
    assert.equal(gerr.details[2]?.typeUrl, 'type.googleapis.com/acme.v1.GoOpaque')

    // Re-encode in TypeScript and verify unknown Any bytes survived untouched
    const reEncoded = toBinary(StatusSchema, toStatus(gerr))
    const reDecoded = fromBinary(StatusSchema, reEncoded)
    assert.deepEqual(reDecoded.details[2]?.value, new Uint8Array([0xde, 0xad, 0xbe, 0xef]))
  })

  it('emits TypeScript Status (including ErrorContext, ErrorInfo, and opaque Any) readable by Go', (t) => {
    const dir = mkdtempSync(join(tmpdir(), 'gerror-ts-interop-'))
    t.after(() => rmSync(dir, { recursive: true, force: true }))

    const errInfo = create(ErrorInfoSchema, {
      domain: 'wechaty.dev',
      reason: 'PUPPET_NOT_READY',
      metadata: { puppetId: 'ts-1' },
    })
    const gerr = new GError('ts puppet not ready', {
      code: Code.FailedPrecondition,
      details: [
        {
          typeUrl: `type.googleapis.com/${ErrorInfoSchema.typeName}`,
          value: Buffer.from(toBinary(ErrorInfoSchema, errInfo)).toString('base64'),
        },
        {
          typeUrl: 'type.googleapis.com/acme.v1.TsOpaque',
          value: Buffer.from([0xca, 0xfe, 0xba, 0xbe]).toString('base64'),
        },
      ],
      cause: new GError('root cause', { code: Code.Unavailable }),
    })

    const tsBinPath = join(dir, 'ts-status.bin')
    writeFileSync(tsBinPath, toBinary(StatusSchema, toStatus(gerr)))

    // Go binary unmarshals Status and verifies Code, Message, ErrorInfo, and TsOpaque
    // even though it has no knowledge of gerror.v1.ErrorContext.
    execFileSync('go', ['run', '.', 'verify', tsBinPath], {
      cwd: GO_FIXTURE_DIR,
      stdio: 'inherit',
    })
  })
})
