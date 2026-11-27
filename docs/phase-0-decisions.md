# Phase 0 — Prior-Art Audit and Design Decisions

> References: `huan/gerror#5` (Architectural RFC), `huan/gerror#6` (Extended Technical Reference)
> Status: Approved · Baseline branch: `main` (`103258a`, `gerror@1.0.16`)

## 1. v1 Audit Summary (`main`)

- **Public exports (`src/mod.ts`):** `GError`, `isEcmaError`, `isGError`, `isGrpcStatus`, `timeoutPromise`, `TimeoutPromiseGError`, `VERSION`, `wrapAsyncError`, and types `WrapAsync`, `WrapAsyncErrorCallback`, `EcmaError`, `GrpcStatus`.
- **Constructor (`src/gerror/gerror.ts`):** `new GError(payload: GrpcStatus | EcmaError)`, differing from v2's `new GError(message: string, options?: GErrorOptions)`.
- **Code enum (`src/gerror/grpc.ts`):** TypeScript `enum Code` with `SCREAMING_SNAKE_CASE` keys including `OK = 0`. v2 replaces this with a `const` object + literal union using `PascalCase` keys and excludes `OK`.
- **Details & Puppet coupling:** v1 stores `details?: string` (first detail or stack string) and unwraps `PuppetEventErrorPayload` (`{ data: string }`) inside `GError.from()`. v2 removes Wechaty/Puppet coupling from core and uses `readonly ErrorDetail[]` (`{ typeUrl, value }` in RFC 4648 Base64).
- **Serialization:** v1 `toJSON()` returns `{ code, details, message, name, stack }`. v2 separates runtime `GError` from plain JSON-safe `GErrorData` (`version: 1`) with explicit diagnostic disclosure (`omit` by default).

## 2. Registry & Dependency Verification

- **`gerror`:** Published on npm at `1.0.16` (maintainer `zixia <zixia@zixia.net>`).
- **`gerror-protobuf` & `gerror-connect`:** Available on npm (404).
- **Planned adapter dependencies:**
  - `@bufbuild/protobuf@2.17.0` — `(Apache-2.0 AND BSD-3-Clause)`
  - `@connectrpc/connect@2.3.0` — `Apache-2.0`
- **Prior art reference:** `serialize-error@13.1.0` — `MIT` (zero runtime dependencies in `gerror` core).

## 3. Approved Phase 0 Design Decisions

1. **Validation exceptions:** Throw standard `TypeError` (invalid types, schema, version, Base64, or `Code`), `RangeError` (budget/limit exceeded), and `SyntaxError` (from `JSON.parse` in `parse()`). Core exports only `GError`, `Code`, and public types.
2. **Aggregate & per-detail limits:** `maxErrors = 32` (aggregate members per node, also bounded by shared `maxNodes = 128`), `maxDetailBytes = 16384` (decoded bytes per detail), `maxTypeUrlBytes = 512` (UTF-8 bytes), alongside `maxDepth = 8`, `maxBytes = 65536`, `message` 8192B, `stack` 16384B, and `32` details.
3. **Caller-supplied `SerializationOptions` limits:** Allow lowering limits; clamp values above hard caps (`maxDepth <= 32`, `maxNodes <= 1024`, `maxBytes <= 1048576`) and reject non-positive, non-integer, or non-finite values.
4. **Strict schema keys:** Reject unexpected own keys on `GErrorData`, `ErrorDiagnostics`, `ErrorDetail`, and `ErrorCause` when decoding `version: 1`.
5. **Cause, sparse arrays, and truncation:**
   - Absent `cause` or explicit `cause: undefined` omits `cause`; explicit `cause: null` maps to `{ kind: 'value', value: null }`.
   - Sparse arrays in `value` causes normalize holes to `null` (matching `JSON.stringify`).
   - `cause` hitting depth/node/size limits emits `{ kind: 'omitted', reason: 'depth-limit' | 'size-limit' }`. Unrepresentable budget exhaustion throws `RangeError` rather than silently dropping data.
6. **Reserved-detail ownership & `DebugInfo`:** Match `type.googleapis.com/gerror.v1.ErrorContext` (`type.googleapis.com/` prefix). Allow at most one `ErrorContext` on `statusToData` / `fromStatus` and reject duplicates with `TypeError`. Preserve third-party `google.rpc.DebugInfo` entries.
7. **Empty `AggregateError`:** Omit `errors` when empty so `GErrorData` and proto3 `repeated google.rpc.Status errors = 5` remain 1:1.
8. **Original unknown RPC code:** Stored in `diagnostics.originalCode`, omitted by default when `diagnostics: 'omit'` and preserved when `diagnostics: 'include'`.
9. **Protobuf `Value` numbers:** Reject `NaN`, `Infinity`, and `-Infinity`; normalize `-0` to `0`.
