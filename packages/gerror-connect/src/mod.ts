/**
 * Public entry point for `gerror-connect`.
 *
 * Exports `toConnectError` and `fromConnectError` for ConnectRPC v2
 * interoperability without coupling `gerror` core to ConnectRPC.
 */

export { fromConnectError, toConnectError } from './connect-error.ts'
