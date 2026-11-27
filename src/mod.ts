import { VERSION } from './version.js'

import {
  isEcmaError,
  isGrpcStatus,
  isGError,
  GError,
  type GErrorOptions,
  type GErrorSubclassFactory,
}                         from './gerror/gerror.js'
import type {
  EcmaError,
}                         from './gerror/ecma.js'
import type {
  GrpcStatus,
}                         from './gerror/grpc.js'
import {
  Code,
  toNumericGrpcCode,
}                         from './gerror/grpc.js'
import type {
  GErrorDTO,
  JsonObject,
  JsonValue,
  JsonPrimitive,
  JsonArray,
}                         from './gerror/dto.js'
import {
  isGErrorDTO,
  isJsonObject,
  isJsonValue,
  normalizeJsonData,
  normalizeJsonValue,
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
  GErrorSubclassFactory,
  JsonObject,
  JsonValue,
  JsonPrimitive,
  JsonArray,
}
export {
  Code,
  GError,
  isEcmaError,
  isGError,
  isGErrorDTO,
  isJsonObject,
  isJsonValue,
  isGrpcStatus,
  normalizeJsonData,
  normalizeJsonValue,
  timeoutPromise,
  TimeoutPromiseGError,
  toNumericGrpcCode,
  VERSION,
  wrapAsyncError,
}
