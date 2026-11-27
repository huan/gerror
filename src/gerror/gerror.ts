/**
 * [RFC] We need a better error system #159
 *  https://github.com/wechaty/puppet/issues/159
 *
 * GError 2.0: Isomorphic, WinterTC-compliant error mixer
 * supporting ES2022 cause chaining, JSON Data Transfer Objects (DTO),
 * gRPC Status, and distributed stack trace stitching.
 */
import type { EcmaError } from './ecma.js'
import { isEcmaError } from './ecma.js'
import type { GrpcStatus } from './grpc.js'
import {
  isGrpcStatus,
  Code,
  toNumericGrpcCode,
} from './grpc.js'
import {
  isPuppetEventErrorPayload,
} from './puppet.js'
import type {
  GErrorDTO,
  JsonObject,
} from './dto.js'
import {
  isGErrorDTO,
  normalizeJsonData,
} from './dto.js'

export interface GErrorOptions {
  code?: number | string
  details?: string
  cause?: unknown
  data?: Record<string, unknown> | JsonObject
  stack?: string
  name?: string
  timestamp?: number
}

export type GErrorSubclassFactory<T extends GError = GError> =
  | (new (message?: string, options?: GErrorOptions) => T)
  | ((dto: GErrorDTO) => T)

/**
 * Extracts local stack frames skipping internal GError factory methods.
 * Preserves caller frame across V8 (Node/Deno), SpiderMonkey (Firefox),
 * and JavaScriptCore (Safari).
 */
function extractCallerStackFrames (): string[] {
  const err = new Error()
  if (!err.stack) {
    return []
  }
  const lines = err.stack.split('\n')

  let firstFrameIndex = 0
  while (firstFrameIndex < lines.length) {
    const line = lines[firstFrameIndex]!.trim()
    if (line.startsWith('at ') || line.includes('@')) {
      break
    }
    firstFrameIndex++
  }

  const frames = lines.slice(firstFrameIndex)
  const callerFrames: string[] = []
  let skippingInternal = true

  for (const frame of frames) {
    if (skippingInternal) {
      const trimmed = frame.trim()
      if (
        trimmed.includes('extractCallerStackFrames') ||
        trimmed.includes('GError.from') ||
        trimmed.includes('fromJSON')
      ) {
        continue
      }
      skippingInternal = false
    }
    callerFrames.push(frame)
  }

  return callerFrames
}

const isGError = (payload: unknown): payload is GError =>
  payload instanceof Error &&
  'code' in payload &&
  'toJSON' in payload &&
  typeof (payload as { toJSON: unknown }).toJSON === 'function'

class GError extends Error implements EcmaError {

  private static _registry = new Map<string | number, GErrorSubclassFactory>()

  code: number | string
  details?: string
  data?: JsonObject
  timestamp?: number

  private _hasCause: boolean = false
  private _hadRemoteStack: boolean = false

  /**
   * Registers a subclass or factory function for automatic polymorphic dispatch
   * based on error code or error name (supporting ADR-21 domain error hierarchies).
   */
  public static register<T extends GError> (
    codeOrName: string | number,
    factory: GErrorSubclassFactory<T>,
  ): void {
    this._registry.set(codeOrName, factory as GErrorSubclassFactory)
  }

  /**
   * Unregisters a previously registered subclass or factory.
   */
  public static unregister (codeOrName: string | number): boolean {
    return this._registry.delete(codeOrName)
  }

  /**
   * Retrieves a registered subclass or factory by code or name.
   */
  public static getRegisteredFactory (codeOrName: string | number): GErrorSubclassFactory | undefined {
    return this._registry.get(codeOrName)
  }

  static stringify (payload: unknown): string {
    return JSON.stringify(
      this.from(payload).toJSON(),
    )
  }

  /**
   * Universal, polymorphic factory:
   * Rehydrates GError (or subclasses) from string, Error, GErrorDTO, GrpcStatus, EcmaError.
   *
   * Note: Plain string input is treated literally as the error message.
   * To parse and rehydrate from JSON strings, use GError.fromJSON().
   */
  static from<T extends typeof GError>(
    this: T,
    payload: unknown,
    options?: { stitchStack?: boolean },
  ): InstanceType<T> {
    if (isPuppetEventErrorPayload(payload)) {
      payload = payload.data
    }

    if (payload instanceof this) {
      return payload as InstanceType<T>
    }

    if (typeof payload === 'string') {
      const instance = new this(payload)
      return instance as InstanceType<T>
    }

    if (payload instanceof Error) {
      const gerrorOpts: GErrorOptions = {
        name: payload.name,
      }
      if (typeof payload.stack === 'string') {
        gerrorOpts.stack = payload.stack
      }
      if ('cause' in payload) {
        gerrorOpts.cause = payload.cause
      }
      if ('code' in payload && (typeof (payload as any).code === 'number' || typeof (payload as any).code === 'string')) {
        gerrorOpts.code = (payload as any).code
      }
      if ('details' in payload && typeof (payload as any).details === 'string') {
        gerrorOpts.details = (payload as any).details
      }
      if ('data' in payload && typeof (payload as any).data === 'object' && (payload as any).data !== null) {
        gerrorOpts.data = (payload as any).data
      }
      if ('timestamp' in payload && typeof (payload as any).timestamp === 'number') {
        gerrorOpts.timestamp = (payload as any).timestamp
      }

      const instance = new this(payload.message, gerrorOpts)
      return instance as InstanceType<T>
    }

    if (isGErrorDTO(payload)) {
      // Dynamic subclass dispatch if registered
      if ((this as unknown) === GError) {
        const factory = GError.getRegisteredFactory(payload.code) || GError.getRegisteredFactory(payload.name)
        if (factory) {
          if (typeof factory === 'function' && !(factory.prototype instanceof GError)) {
            return (factory as (dto: GErrorDTO) => GError)(payload) as InstanceType<T>
          }
          return (factory as typeof GError).from(payload, options) as InstanceType<T>
        }
      }

      const gerrorOpts: GErrorOptions = {
        code: payload.code,
        name: payload.name,
      }

      if (payload.details !== undefined) {
        gerrorOpts.details = payload.details
      }
      if (payload.data !== undefined) {
        gerrorOpts.data = payload.data
      }
      if (payload.timestamp !== undefined) {
        gerrorOpts.timestamp = payload.timestamp
      }

      // Rehydrate cause independently through base GError factory to prevent subclass leak
      if ('cause' in payload && payload.cause !== undefined) {
        gerrorOpts.cause = GError.from(payload.cause, { stitchStack: false })
      }

      const instance = new this(payload.message, gerrorOpts)

      if (payload.details === undefined) {
        instance.details = undefined
      }

      if (payload.stack !== undefined) {
        instance._hadRemoteStack = true
        if (options?.stitchStack !== false) {
          const localFrames = extractCallerStackFrames()
          if (localFrames.length > 0) {
            instance.stack = `${payload.stack}\n    --- remote boundary ---\n${localFrames.join('\n')}`
          } else {
            instance.stack = payload.stack
          }
        } else {
          instance.stack = payload.stack
        }
      } else {
        instance._hadRemoteStack = false
        if (options?.stitchStack === false) {
          instance.stack = undefined
        }
      }

      return instance as InstanceType<T>
    }

    if (isGrpcStatus(payload)) {
      const codeName = Code[payload.code as number]
      const name = typeof codeName === 'string' ? codeName : (String(payload.code) || 'GError')
      const gerrorOpts: GErrorOptions = {
        code: payload.code,
        name,
      }
      if (payload.details !== undefined) {
        gerrorOpts.details = payload.details
      }
      const instance = new this(payload.message || '', gerrorOpts)
      if (payload.details === undefined) {
        instance.details = undefined
      }
      return instance as InstanceType<T>
    }

    if (isEcmaError(payload)) {
      const gerrorOpts: GErrorOptions = {
        name: payload.name,
      }
      if (payload.stack !== undefined) {
        gerrorOpts.stack = payload.stack
        gerrorOpts.details = payload.stack
      }
      const instance = new this(payload.message, gerrorOpts)
      return instance as InstanceType<T>
    }

    // Fallback for non-error primitives and arbitrary objects
    let message: string
    if (typeof payload === 'object' && payload !== null) {
      try {
        message = JSON.stringify(payload)
      } catch (e) {
        message = (e as Error).message
      }
    } else {
      message = String(payload)
    }

    const instance = new this(message)
    return instance as InstanceType<T>
  }

  /**
   * Strictly deserializes and validates a JSON string or object payload into a GError instance.
   * Throws a TypeError if the payload cannot be decoded or is not a valid GErrorDTO,
   * GrpcStatus, or EcmaError shape.
   */
  public static fromJSON<T extends typeof GError>(
    this: T,
    payload: string | GrpcStatus | EcmaError | GErrorDTO,
    options?: { stitchStack?: boolean },
  ): InstanceType<T> {
    let parsed: unknown = payload

    if (typeof payload === 'string') {
      try {
        parsed = JSON.parse(payload)
      } catch (err) {
        throw new TypeError(`GError.fromJSON(): invalid JSON string: ${(err as Error).message}`)
      }
    }

    if (typeof parsed !== 'object' || parsed === null) {
      throw new TypeError(`GError.fromJSON(): expected JSON object but received ${typeof parsed}`)
    }

    if (isGErrorDTO(parsed) || isGrpcStatus(parsed) || isEcmaError(parsed)) {
      return this.from(parsed, options)
    }

    throw new TypeError('GError.fromJSON(): payload is neither a valid GErrorDTO, GrpcStatus, nor EcmaError')
  }

  constructor (
    messageOrPayload?: string | GrpcStatus | EcmaError | GErrorDTO,
    options?: GErrorOptions,
  ) {
    const isPayloadObj = typeof messageOrPayload === 'object' && messageOrPayload !== null
    const payloadRec = isPayloadObj ? (messageOrPayload as unknown as Record<string, unknown>) : undefined

    let resolvedMessage = ''
    if (typeof messageOrPayload === 'string') {
      resolvedMessage = messageOrPayload
    } else if (payloadRec && typeof payloadRec['message'] === 'string') {
      resolvedMessage = payloadRec['message']
    }

    // Determine cause presence preserving falsy values (0, false, '', null)
    let hasCause = false
    let resolvedCause: unknown
    if (payloadRec && 'cause' in payloadRec) {
      hasCause = true
      resolvedCause = payloadRec['cause']
    } else if (options && 'cause' in options) {
      hasCause = true
      resolvedCause = options.cause
    }

    if (hasCause) {
      super(resolvedMessage, { cause: resolvedCause })
    } else {
      super(resolvedMessage)
    }
    this._hasCause = hasCause

    // Resolve code with explicit presence check
    if (payloadRec && 'code' in payloadRec && payloadRec['code'] !== undefined) {
      this.code = payloadRec['code'] as (number | string)
    } else if (options && 'code' in options && options.code !== undefined) {
      this.code = options.code
    } else {
      this.code = Code.UNKNOWN
    }

    // Resolve name preserving explicit empty strings
    if (payloadRec && typeof payloadRec['name'] === 'string') {
      this.name = payloadRec['name']
    } else if (options && typeof options.name === 'string') {
      this.name = options.name
    } else {
      this.name = this.constructor.name || 'GError'
    }

    // Resolve details preserving undefined vs empty string
    if (payloadRec && 'details' in payloadRec && payloadRec['details'] !== undefined) {
      this.details = payloadRec['details'] as string
    } else if (options && 'details' in options && options.details !== undefined) {
      this.details = options.details
    } else if (typeof messageOrPayload === 'string') {
      this.details = this.stack
    }

    // Resolve stack
    if (payloadRec && typeof payloadRec['stack'] === 'string') {
      this.stack = payloadRec['stack']
      this._hadRemoteStack = true
    } else if (options && typeof options.stack === 'string') {
      this.stack = options.stack
      this._hadRemoteStack = true
    }

    // Resolve data with JSON normalization
    if (payloadRec && 'data' in payloadRec && payloadRec['data'] !== undefined) {
      this.data = normalizeJsonData(payloadRec['data'])
    } else if (options && 'data' in options && options.data !== undefined) {
      this.data = normalizeJsonData(options.data)
    }

    // Resolve timestamp preserving 0
    if (payloadRec && typeof payloadRec['timestamp'] === 'number') {
      this.timestamp = payloadRec['timestamp']
    } else if (options && typeof options.timestamp === 'number') {
      this.timestamp = options.timestamp
    }
  }

  public toJSON (visited: Set<unknown> = new Set()): GErrorDTO {
    if (visited.has(this)) {
      return {
        code: this.code,
        message: '[Circular]',
        name: this.name,
      }
    }
    visited.add(this)

    let causeDto: GErrorDTO | undefined
    if (this._hasCause || ('cause' in this && this.cause !== undefined)) {
      const cause = this.cause
      if (visited.has(cause)) {
        causeDto = {
          code: Code.UNKNOWN,
          message: '[Circular]',
          name: 'Error',
        }
      } else if (cause instanceof GError) {
        causeDto = cause.toJSON(visited)
      } else if (cause instanceof Error) {
        const wrapped = GError.from(cause, { stitchStack: false })
        causeDto = wrapped.toJSON(visited)
      } else if (typeof cause === 'object' && cause !== null && isGErrorDTO(cause)) {
        causeDto = cause
      } else {
        // Primitive cause values (0, false, '', null, undefined, etc.)
        // Kept literal without synthetic JSON parsing
        causeDto = {
          code: Code.UNKNOWN,
          message: String(cause),
          name: 'Error',
        }
      }
    }

    const dto: { -readonly [K in keyof GErrorDTO]?: GErrorDTO[K] } = {
      code: this.code,
      message: this.message,
      name: this.name,
    }

    if (this.details !== undefined) {
      dto.details = this.details
    }
    if (this.stack !== undefined) {
      dto.stack = this.stack
    }
    if (causeDto !== undefined) {
      dto.cause = causeDto
    }
    if (this.data !== undefined) {
      dto.data = this.data
    }
    if (this.timestamp !== undefined) {
      dto.timestamp = this.timestamp
    }

    return dto as GErrorDTO
  }

  public toGrpcStatus (domainCodeMapping?: (code: string) => number): GrpcStatus {
    const status: GrpcStatus = {
      code: toNumericGrpcCode(this.code, domainCodeMapping),
      message: this.message,
    }
    if (this.details !== undefined) {
      status.details = this.details
    }
    return status
  }

  public toEcmaError (): EcmaError {
    const error: EcmaError = {
      message: this.message,
      name: this.name,
    }
    if (this.stack !== undefined) {
      error.stack = this.stack
    }
    return error
  }

}

export {
  GError,
  isGError,
  isGrpcStatus,
  isEcmaError,
}
