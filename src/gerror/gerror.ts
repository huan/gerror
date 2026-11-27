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
  isJsonObject,
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
function extractCallerStackFrames (entryFn?: Function): string[] {
  const err = new Error()
  if (typeof (Error as any).captureStackTrace === 'function' && entryFn) {
    ;(Error as any).captureStackTrace(err, entryFn)
  }
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
        trimmed.includes('/gerror/gerror.') ||
        trimmed.includes('gerror.ts:') ||
        trimmed.includes('gerror.js:') ||
        trimmed.includes('at Function.from') ||
        trimmed.includes('at GError.') ||
        trimmed.includes('.from (') ||
        trimmed.includes('.fromJSON (')
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
   * Automatically parses JSON strings to support wire payloads and puppet events.
   */
  static from<T extends typeof GError>(
    this: T,
    payload: unknown,
    options?: { stitchStack?: boolean; entryFn?: Function },
  ): InstanceType<T> {
    if (isPuppetEventErrorPayload(payload)) {
      payload = payload.data
    }

    if (payload instanceof this) {
      return payload as InstanceType<T>
    }

    if (typeof payload === 'string') {
      const trimmed = payload.trim()
      if (trimmed.startsWith('{') && trimmed.endsWith('}')) {
        try {
          const parsed = JSON.parse(trimmed)
          if (typeof parsed === 'object' && parsed !== null) {
            return this.from(parsed, options)
          }
        } catch {
          // If JSON parse fails, treat as plain string message
        }
      }
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
      let instance: InstanceType<T> | undefined

      const factory = GError.getRegisteredFactory(payload.code) || GError.getRegisteredFactory(payload.name)
      if (factory) {
        let candidate: GError
        if (typeof factory === 'function' && !(factory.prototype instanceof GError)) {
          candidate = (factory as (dto: GErrorDTO) => GError)(payload)
        } else {
          candidate = new (factory as any)(payload.message)
        }
        if (candidate instanceof (this as any)) {
          instance = candidate as InstanceType<T>
        }
      }

      if (!instance) {
        instance = new this(payload.message) as InstanceType<T>
      }

      // Shared canonical hydration pipeline for all instances (base and registered subclasses):
      instance.name = payload.name
      instance.code = payload.code

      if (payload.details !== undefined) {
        instance.details = payload.details
      } else {
        instance.details = undefined
      }

      if (payload.timestamp !== undefined) {
        instance.timestamp = payload.timestamp
      } else {
        instance.timestamp = undefined
      }

      if (payload.data !== undefined) {
        instance.data = payload.data
      } else {
        instance.data = undefined
      }

      // Rehydrate cause independently through base GError factory to prevent subclass leak
      if ('cause' in payload && payload.cause !== undefined) {
        instance.cause = GError.from(payload.cause, { stitchStack: false })
        ;(instance as any)._hasCause = true
      } else {
        delete (instance as any).cause
        ;(instance as any)._hasCause = false
      }

      if (payload.stack !== undefined) {
        ;(instance as any)._hadRemoteStack = true
        if (options?.stitchStack !== false) {
          const entryFn = options?.entryFn || this.from
          const localFrames = extractCallerStackFrames(entryFn)
          if (localFrames.length > 0) {
            instance.stack = `${payload.stack}\n    --- remote boundary ---\n${localFrames.join('\n')}`
          } else {
            instance.stack = payload.stack
          }
        } else {
          instance.stack = payload.stack
        }
      } else {
        ;(instance as any)._hadRemoteStack = false
        if (options?.stitchStack === false) {
          instance.stack = undefined
        }
      }

      return instance
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
      if (typeof (payload as any).stack === 'string') {
        gerrorOpts.stack = (payload as any).stack
      }
      const instance = new this(payload.message || '', gerrorOpts)
      if (payload.details === undefined) {
        instance.details = undefined
      }
      if (typeof (payload as any).stack === 'string') {
        instance._hadRemoteStack = true
        if (options?.stitchStack !== false) {
          const entryFn = options?.entryFn || this.from
          const localFrames = extractCallerStackFrames(entryFn)
          if (localFrames.length > 0) {
            instance.stack = `${(payload as any).stack}\n    --- remote boundary ---\n${localFrames.join('\n')}`
          } else {
            instance.stack = (payload as any).stack
          }
        } else {
          instance.stack = (payload as any).stack
        }
      }
      return instance as InstanceType<T>
    }

    if (isEcmaError(payload)) {
      const gerrorOpts: GErrorOptions = {
        name: payload.name,
      }
      if (typeof payload.stack === 'string') {
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
    options?: { stitchStack?: boolean; entryFn?: Function },
  ): InstanceType<T> {
    let parsed: unknown = payload

    if (typeof payload === 'string') {
      try {
        parsed = JSON.parse(payload)
      } catch (err) {
        throw new TypeError(`GError.fromJSON(): invalid JSON string: ${(err as Error).message}`)
      }
    }

    if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
      throw new TypeError(`GError.fromJSON(): expected JSON object but received ${Array.isArray(parsed) ? 'array' : typeof parsed}`)
    }

    const candidate = parsed as Record<string, unknown>

    // Strict validation of DTO / error properties if present:
    if ('name' in candidate && candidate['name'] !== undefined && typeof candidate['name'] !== 'string') {
      throw new TypeError("GError.fromJSON(): malformed DTO: 'name' must be a string")
    }
    if ('message' in candidate && candidate['message'] !== undefined && typeof candidate['message'] !== 'string') {
      throw new TypeError("GError.fromJSON(): malformed DTO: 'message' must be a string")
    }
    if ('code' in candidate && candidate['code'] !== undefined) {
      const code = candidate['code']
      if (typeof code === 'number') {
        if (!Number.isFinite(code)) {
          throw new TypeError("GError.fromJSON(): malformed DTO: 'code' must be a finite number or string")
        }
      } else if (typeof code !== 'string') {
        throw new TypeError("GError.fromJSON(): malformed DTO: 'code' must be a finite number or string")
      }
    }
    if ('details' in candidate && candidate['details'] !== undefined && typeof candidate['details'] !== 'string') {
      throw new TypeError("GError.fromJSON(): malformed DTO: 'details' must be a string")
    }
    if ('stack' in candidate && candidate['stack'] !== undefined && typeof candidate['stack'] !== 'string') {
      throw new TypeError("GError.fromJSON(): malformed DTO: 'stack' must be a string")
    }
    if ('timestamp' in candidate && candidate['timestamp'] !== undefined) {
      const ts = candidate['timestamp']
      if (typeof ts !== 'number' || !Number.isFinite(ts)) {
        throw new TypeError("GError.fromJSON(): malformed DTO: 'timestamp' must be a finite number")
      }
    }
    if ('data' in candidate && candidate['data'] !== undefined) {
      if (!isJsonObject(candidate['data'])) {
        throw new TypeError("GError.fromJSON(): malformed DTO: 'data' must be a valid JSON object")
      }
    }
    if ('cause' in candidate && candidate['cause'] !== undefined) {
      if (!isGErrorDTO(candidate['cause'])) {
        throw new TypeError("GError.fromJSON(): malformed DTO: 'cause' must be a valid GErrorDTO")
      }
    }

    // Now dispatch based on canonical shape:
    const dispatchOptions = { ...options, entryFn: options?.entryFn || this.fromJSON }
    if (isGErrorDTO(candidate)) {
      return this.from(candidate, dispatchOptions)
    }

    if (isGrpcStatus(candidate)) {
      return this.from(candidate, dispatchOptions)
    }

    if (isEcmaError(candidate)) {
      return this.from(candidate, dispatchOptions)
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
    } else if (payloadRec && typeof payloadRec['code'] === 'number' && Code[payloadRec['code']]) {
      this.name = Code[payloadRec['code']] as string
    } else {
      this.name = this.constructor.name || 'GError'
    }

    // Resolve stack
    if (payloadRec && typeof payloadRec['stack'] === 'string') {
      this.stack = payloadRec['stack']
      this._hadRemoteStack = true
    } else if (options && typeof options.stack === 'string') {
      this.stack = options.stack
      this._hadRemoteStack = true
    }

    // Resolve details preserving undefined vs empty string
    if (payloadRec && 'details' in payloadRec && payloadRec['details'] !== undefined) {
      this.details = payloadRec['details'] as string
    } else if (options && 'details' in options && options.details !== undefined) {
      this.details = options.details
    } else if (
      typeof messageOrPayload === 'string' ||
      messageOrPayload instanceof Error ||
      (isEcmaError(messageOrPayload) && !isGrpcStatus(messageOrPayload) && !isGErrorDTO(messageOrPayload))
    ) {
      this.details = this.stack
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

  public toJSON (keyOrVisited?: string | Set<unknown>, maybeVisited?: Set<unknown>): GErrorDTO {
    const visited = (keyOrVisited instanceof Set)
      ? keyOrVisited
      : ((maybeVisited instanceof Set) ? maybeVisited : new Set<unknown>())

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
      if (typeof cause === 'object' && cause !== null) {
        if (visited.has(cause)) {
          causeDto = {
            code: Code.UNKNOWN,
            message: '[Circular]',
            name: (cause as any).name || 'Error',
          }
        } else if (cause instanceof GError) {
          causeDto = cause.toJSON(visited)
        } else if (cause instanceof Error) {
          visited.add(cause)
          const wrapped = GError.from(cause, { stitchStack: false })
          causeDto = wrapped.toJSON(visited)
        } else if (isGErrorDTO(cause)) {
          causeDto = cause
        } else {
          causeDto = {
            code: Code.UNKNOWN,
            message: String(cause),
            name: (cause as any).name || 'Error',
          }
        }
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
