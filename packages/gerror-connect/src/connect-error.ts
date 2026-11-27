/**
 * Bidirectional `GError` <-> `ConnectError` adapter for ConnectRPC v2.
 *
 * Owns `toConnectError()` and `fromConnectError()` mapping canonical `Code`,
 * `ConnectError.rawMessage` (never the `[code]`-prefixed `message`), typed
 * details via `gerror-protobuf`, and native `cause` while keeping transport
 * `metadata` (`Headers`) isolated from error details.
 */

import { create, type DescMessage, toBinary } from '@bufbuild/protobuf'
import { type Any, AnySchema, anyUnpack } from '@bufbuild/protobuf/wkt'
import { type Code as ConnectCode, ConnectError } from '@connectrpc/connect'
import { GError, type SerializationOptions } from 'gerror'
import {
  createGErrorRegistry,
  fromStatus,
  StatusSchema,
  toStatus,
} from 'gerror-protobuf'

type OutgoingDetail = {
  desc: DescMessage
  value: Record<string, unknown>
}

const defaultRegistry = createGErrorRegistry()

function typeNameFromUrl (typeUrl: string): string {
  const idx = typeUrl.lastIndexOf('/')
  return idx >= 0 ? typeUrl.slice(idx + 1) : typeUrl
}

function typeUrlFromName (typeName: string): string {
  return typeName.includes('/') ? typeName : `type.googleapis.com/${typeName}`
}

/**
 * Converts any `unknown` error into a `ConnectError` using `toStatus()`.
 *
 * Known Protobuf detail schemas registered in `createGErrorRegistry()`
 * (including `gerror.v1.ErrorContext` and standard `google.rpc.*` details)
 * are unpacked into ConnectRPC `OutgoingDetail` entries. Unknown `Any` details
 * without a schema cannot be passed as `ConnectError` `OutgoingDetail`s in
 * ConnectRPC v2 and are omitted here (use `gerror-protobuf` `toStatus()` for
 * opaque unknown-detail forwarding).
 */
export function toConnectError (
  error: unknown,
  options?: SerializationOptions,
): ConnectError {
  const gerror = error instanceof ConnectError ? fromConnectError(error) : GError.from(error)
  const status = toStatus(gerror, options)
  const outgoingDetails: OutgoingDetail[] = []

  for (const any of status.details) {
    const typeName = typeNameFromUrl(any.typeUrl)
    const desc = defaultRegistry.getMessage(typeName)
    if (desc !== undefined) {
      const unpacked = anyUnpack(any, desc)
      if (unpacked !== undefined) {
        outgoingDetails.push({
          desc,
          value: unpacked as unknown as Record<string, unknown>,
        })
      }
    }
  }

  return new ConnectError(
    status.message,
    status.code as ConnectCode,
    undefined,
    outgoingDetails,
    'cause' in gerror ? gerror.cause : undefined,
  )
}

/**
 * Converts a `ConnectError` into a local `GError` instance.
 *
 * Uses `error.rawMessage` (not the formatted `[code] ...` message), maps both
 * `OutgoingDetail` and `IncomingDetail` entries into `google.rpc.Status`
 * details, and keeps `error.metadata` (`Headers`) isolated from error details.
 */
export function fromConnectError (error: ConnectError): GError {
  if (!(error instanceof ConnectError)) {
    throw new TypeError('fromConnectError() requires a ConnectError instance')
  }

  const details: Any[] = []
  for (const detail of error.details) {
    if ('desc' in detail) {
      const msg = create(detail.desc, detail.value)
      details.push(
        create(AnySchema, {
          typeUrl: `type.googleapis.com/${detail.desc.typeName}`,
          value: toBinary(detail.desc, msg),
        }),
      )
    } else {
      details.push(
        create(AnySchema, {
          typeUrl: typeUrlFromName(detail.type),
          value: detail.value,
        }),
      )
    }
  }

  const status = create(StatusSchema, {
    code: error.code,
    message: error.rawMessage,
    details,
  })

  const gerror = fromStatus(status)
  if (!('cause' in gerror) && error.cause !== undefined) {
    return new GError(gerror.message, {
      code: gerror.code,
      details: gerror.details,
      cause: error.cause,
    })
  }
  return gerror
}
