/**
 * Optional Protobuf-ES v2 schema registry for `gerror-protobuf`.
 *
 * Owns `createGErrorRegistry()` pre-populated with `google.rpc.Status`,
 * standard `google.rpc.*` error details, `gerror.v1.ErrorContext`, and
 * `google.protobuf.*` well-known types for optional ProtoJSON inspection.
 */

import { createRegistry, type Registry } from '@bufbuild/protobuf'
import { file_google_protobuf_any, file_google_protobuf_struct } from '@bufbuild/protobuf/wkt'
import type { GenFile } from '@bufbuild/protobuf/codegenv2'

import { file_gerror_v1_error_context } from './generated/gerror/v1/error_context_pb.ts'
import { file_google_rpc_error_details } from './generated/google/rpc/error_details_pb.ts'
import { file_google_rpc_status } from './generated/google/rpc/status_pb.ts'

/**
 * Creates a Protobuf-ES v2 `FileRegistry` containing `google.rpc.Status`,
 * standard Google RPC detail schemas, `gerror.v1.ErrorContext`, and any
 * caller-supplied schemas for ProtoJSON or `Any` inspection.
 */
export function createGErrorRegistry (...extraFiles: readonly GenFile[]): Registry {
  return createRegistry(
    file_google_rpc_status,
    file_google_rpc_error_details,
    file_gerror_v1_error_context,
    file_google_protobuf_struct,
    file_google_protobuf_any,
    ...extraFiles,
  )
}
