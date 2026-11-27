# GError v2 Architecture

**Native by behavior. Standard by semantics. Portable by representation. Serializable by design.**

## 1. Three Canonical Representations

GError v2 models a single logical failure across three representations:

1. **`GError` (Runtime):** Extends native ECMAScript `Error` (`instanceof Error`, `instanceof GError`), carries canonical `code: Code` (1–16) and immutable `details: readonly ErrorDetail[]`, and preserves native `cause`.
2. **`GErrorData` (Plain JSON / Redux / CQRS):** Versioned (`version: 1`) plain-object snapshot safe for `JSON.stringify`, Redux actions/state, and event-sourcing replay.
3. **`google.rpc.Status` (Protobuf Wire):** Standard Google RPC envelope carrying `code`, `message`, and `repeated google.protobuf.Any details` (with `gerror.v1.ErrorContext` for ECMAScript causes, aggregate members, and diagnostic names/codes, plus `google.rpc.DebugInfo` for opted-in stacks).

## 2. Package Boundaries

```text
gerror-connect  ──▶  gerror-protobuf  ──▶  gerror (zero runtime deps)
```

- **`gerror`:** Zero runtime dependencies, universal ECMAScript + WinterTC (`TextEncoder`/`TextDecoder`, no `Buffer`, `process`, or `fs`). Exports `GError`, `Code`, and public TypeScript types only.
- **`gerror-protobuf`:** Depends on `gerror` and `@bufbuild/protobuf`. Maps `GError` / `GErrorData` <-> `google.rpc.Status` using Buf-generated schemas.
- **`gerror-connect`:** Depends on `gerror`, `gerror-protobuf`, and `@connectrpc/connect`. Maps `GError` <-> `ConnectError` using `rawMessage`, canonical `Code`, and registered details.

## 3. Canonical Codes & Identity

`Code` defines the 16 canonical Google RPC failure codes (`1..16`) and excludes `OK` (`0`). Decoding `Status` with `code === 0` throws `TypeError`; unknown nonzero `int32` codes normalize to `Code.Unknown` with `originalCode` recorded in `diagnostics`. Application-specific identity belongs in `google.rpc.ErrorInfo` (`domain`, `reason`, `metadata`), not custom numeric codes.
