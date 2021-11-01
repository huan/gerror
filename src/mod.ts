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
}                   from './wrap-async-error/wrap-async-error.js'

export type {
  WrapAsync,
}
export {
  isEcmaError,
  isGrpcStatus,
  isGError,
  wrapAsyncError,
  GError,
  VERSION,
}
