/**
 * Public entry point for the `gerror` core package.
 *
 * Exports only `GError`, `Code`, and the public data/options TypeScript types.
 * Internal helpers remain unexported to keep the surface minimal and stable.
 */

export { Code } from './code.ts'
export type {
  ErrorCause,
  ErrorDetail,
  ErrorDiagnostics,
  GErrorData,
  GErrorOptions,
  JsonValue,
  SerializationOptions,
} from './data.ts'
export { GError } from './gerror.ts'
