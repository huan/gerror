/**
 * [RFC] We need a better error system #159
 *  https://github.com/wechaty/puppet/issues/159
 */
import type { EcmaError }       from './ecma.js'
import { isEcmaError }          from './ecma.js'
import type { GrpcStatus }      from './grpc.js'
import {
  isGrpcStatus,
  Code,
}                               from './grpc.js'
import {
  isPuppetEventErrorPayload,
}                               from './puppet.js'
import type { GErrorDTO }       from './dto.js'
import { isGErrorDTO }          from './dto.js'

export interface GErrorOptions {
  code?: number | string
  details?: string
  cause?: unknown
  data?: Record<string, unknown>
  stack?: string
  name?: string
}

const isGError = (payload: any): payload is GError =>
  payload instanceof Error &&
  'code' in payload &&
  'toJSON' in payload &&
  typeof (payload as any).toJSON === 'function'

class GError extends Error implements GrpcStatus, EcmaError {

  code: number | string
  details?: string
  data?: Record<string, unknown>

  static stringify (payload: any): string {
    return JSON.stringify(
      this.from(payload).toJSON(),
    )
  }

  /**
   * Universal, polymorphic factory:
   * Rehydrates GError (or subclasses) from string, Error, GErrorDTO, GrpcStatus, EcmaError, etc.
   */
  static from<T extends typeof GError>(
    this: T,
    payload: unknown,
    options?: { stitchStack?: boolean },
  ): InstanceType<T> {
    if (isPuppetEventErrorPayload(payload)) {
      payload = payload.data
    }

    // Try parsing string as JSON first
    if (typeof payload === 'string') {
      try {
        const parsed = JSON.parse(payload)
        if (typeof parsed === 'object' && parsed !== null) {
          return this.from(parsed, options)
        }
      } catch {
        // Plain non-JSON string
        const instance = new this(payload)
        return instance as InstanceType<T>
      }
    }

    if (payload instanceof this) {
      return payload as InstanceType<T>
    }

    if (payload instanceof Error) {
      const gerrorOpts: GErrorOptions = {
        cause: payload.cause,
        stack: payload.stack,
        name: payload.name,
      }
      if ('code' in payload && (typeof (payload as any).code === 'number' || typeof (payload as any).code === 'string')) {
        gerrorOpts.code = (payload as any).code
      }
      if ('details' in payload && typeof (payload as any).details === 'string') {
        gerrorOpts.details = (payload as any).details
      }
      if ('data' in payload && typeof (payload as any).data === 'object') {
        gerrorOpts.data = (payload as any).data
      }

      const instance = new this(payload.message, gerrorOpts)
      return instance as InstanceType<T>
    }

    if (isGErrorDTO(payload)) {
      const gerrorOpts: GErrorOptions = {
        code: payload.code,
        details: payload.details,
        data: payload.data,
        name: payload.name,
      }

      if (payload.cause) {
        gerrorOpts.cause = this.from(payload.cause, { stitchStack: false })
      }

      const instance = new this(payload.message, gerrorOpts)

      // Stitch remote stack with local call-site stack
      if (payload.stack) {
        if (options?.stitchStack !== false) {
          const localError = new Error()
          const localLines = localError.stack ? localError.stack.split('\n').slice(2) : []
          instance.stack = `${payload.stack}\n    --- remote boundary ---\n${localLines.join('\n')}`
        } else {
          instance.stack = payload.stack
        }
      }

      return instance as InstanceType<T>
    }

    if (isGrpcStatus(payload)) {
      const instance = new this(payload.message || '', {
        code: payload.code,
        details: payload.details,
      })
      return instance as InstanceType<T>
    }

    if (isEcmaError(payload)) {
      const instance = new this(payload.message, {
        name: payload.name,
        stack: payload.stack,
      })
      return instance as InstanceType<T>
    }

    // Fallback for objects or other primitives
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
   * From a gRPC standard error / Protobuf / DTO
   */
  public static fromJSON<T extends typeof GError>(
    this: T,
    payload: string | GrpcStatus | EcmaError | GErrorDTO,
  ): InstanceType<T> {
    return this.from(payload)
  }

  constructor(
    messageOrPayload?: string | GrpcStatus | EcmaError | GErrorDTO,
    options?: GErrorOptions,
  ) {
    let resolvedMessage = ''
    let resolvedOptions: GErrorOptions = options ?? {}

    if (typeof messageOrPayload === 'string') {
      resolvedMessage = messageOrPayload
    } else if (typeof messageOrPayload === 'object' && messageOrPayload !== null) {
      resolvedMessage = (messageOrPayload as any).message ?? ''
      resolvedOptions = {
        ...resolvedOptions,
        code: (messageOrPayload as any).code,
        details: (messageOrPayload as any).details,
        cause: (messageOrPayload as any).cause ?? resolvedOptions.cause,
        data: (messageOrPayload as any).data ?? resolvedOptions.data,
        stack: (messageOrPayload as any).stack ?? resolvedOptions.stack,
        name: (messageOrPayload as any).name ?? resolvedOptions.name,
      }
    }

    super(resolvedMessage, { cause: resolvedOptions.cause })

    this.code = resolvedOptions.code ?? Code.UNKNOWN
    this.data = resolvedOptions.data

    if (resolvedOptions.name) {
      this.name = resolvedOptions.name
    } else {
      this.name = this.constructor.name || 'GError'
    }

    if (resolvedOptions.stack) {
      this.stack = resolvedOptions.stack
    }

    this.details = resolvedOptions.details ?? this.stack
  }

  public toJSON (): GErrorDTO {
    let causeDto: GErrorDTO | undefined
    if (this.cause) {
      causeDto = GError.from(this.cause, { stitchStack: false }).toJSON()
    }

    return {
      code: this.code,
      details: this.details,
      message: this.message,
      name: this.name,
      stack: this.stack,
      ...(causeDto ? { cause: causeDto } : {}),
      ...(this.data ? { data: this.data } : {}),
    }
  }

  public toGrpcStatus (): GrpcStatus {
    return {
      code: typeof this.code === 'number' ? this.code : Code.UNKNOWN,
      details: this.details,
      message: this.message,
    }
  }

  public toEcmaError (): EcmaError {
    return {
      message: this.message,
      name: this.name,
      stack: this.stack,
    }
  }

}

export {
  GError,
  isGError,
  isGrpcStatus,
  isEcmaError,
}
