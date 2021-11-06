import { VERSION } from './version.js'

import {
  isEcmaError,
  isGrpcStatus,
  isGError,
  GError,
}                   from './gerror/gerror.js'
import {
  wrapAsyncError,
  WrapAsync,
  WrapAsyncErrorCallback,
}                           from './wrap-async-error/wrap-async-error.js'

import { timeoutPromise } from './timeout-promise.js'

export type {
  WrapAsync,
  WrapAsyncErrorCallback,
}
export {
  GError,
  isEcmaError,
  isGError,
  isGrpcStatus,
  timeoutPromise,
  VERSION,
  wrapAsyncError,
}
