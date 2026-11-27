# Migrating from GError v1 to v2

GError v2 is a clean-slate redesign. Key breaking changes from v1 (`1.0.x`) to v2 (`2.0.x`):

## 1. Constructor & Codes

- **v1:** `new GError(payload: GrpcStatus | EcmaError)` with `enum Code` (`Code.OK`, `Code.NOT_FOUND`, `SCREAMING_SNAKE_CASE`).
- **v2:** `new GError(message: string, options?: GErrorOptions)` with `Code` const object (`Code.NotFound`, `PascalCase`, `1..16`; `OK = 0` is excluded and rejected).

```ts
// v1
throw new GError({ code: Code.NOT_FOUND, message: 'Missing' })

// v2
throw new GError('Missing', { code: Code.NotFound })
```

## 2. Plain Data & JSON Serialization

- **v1:** `toJSON()` returned `{ code, details, message, name, stack }`; `GError.fromJSON()` accepted `string | object`.
- **v2:**
  - `toData(options?)` / `toJSON()` return `GErrorData` (`{ version: 1, code, message, details, ... }`) with `diagnostics` omitted by default.
  - `GError.fromData(data)` / `GError.fromJSON(data)` accept validated `GErrorData` objects; use `GError.parse(jsonString)` for JSON strings.
  - `details` is `readonly ErrorDetail[]` (`{ typeUrl, value }` in RFC 4648 Base64) instead of `string | undefined`.

## 3. Removed v1 Utilities & Coupling

- `PuppetEventErrorPayload` (`{ data: string }`) unwrapping is removed from `gerror` core.
- `timeoutPromise`, `TimeoutPromiseGError`, `wrapAsyncError`, `isEcmaError`, `isGrpcStatus`, and `VERSION` are removed from `gerror` exports. Core exports only `GError`, `Code`, and public TypeScript types.
- `toGrpcStatus()` / `toEcmaError()` are replaced by `gerror-protobuf` (`toStatus` / `fromStatus` / `dataToStatus` / `statusToData`) and `gerror-connect` (`toConnectError` / `fromConnectError`).
