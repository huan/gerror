import { VERSION } from './version.js'

import {
  isEcmaError,
  isGrpcStatus,
  isGError,
  GError,
  type GErrorOptions,
}                         from './gerror/gerror.js'
import type {
  EcmaError,
}                         from './gerror/ecma.js'
import type {
  GrpcStatus,
}                         from './gerror/grpc.js'
import {
  Code,
}                         from './gerror/grpc.js'
import type {
  GErrorDTO,
}                         from './gerror/dto.js'
import {
  isGErrorDTO,
}                         from './gerror/dto.js'

import {
  timeoutPromise,
  TimeoutPromiseGError,
}                         from './timeout-promise/mod.js'

import {
  wrapAsyncError,
  type WrapAsync,
  type WrapAsyncErrorCallback,
}                           from './wrap-async-error/wrap-async-error.js'

export type {
  WrapAsync,
  WrapAsyncErrorCallback,
  EcmaError,
  GrpcStatus,
  GErrorDTO,
  GErrorOptions,
}
export {
  Code,
  GError,
  isEcmaError,
  isGError,
  isGErrorDTO,
  isGrpcStatus,
  timeoutPromise,
  TimeoutPromiseGError,
  VERSION,
  wrapAsyncError,
}
