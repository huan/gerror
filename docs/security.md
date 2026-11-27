# GError v2 Security & Resource Policy

## 1. Default Disclosure Policy

- `toData()` and `toJSON()` default to `{ diagnostics: 'omit' }`.
- `ErrorDiagnostics` (`name`, `stack`, `originalCode`) are omitted recursively across `cause` and `errors` unless `{ diagnostics: 'include' }` is explicitly passed.
- **Note:** Default diagnostic omission does not sanitize `message`, `value` causes, or opaque `details`. Applications must still sanitize or apply `detailPolicy` before crossing trust boundaries.

## 2. Resource Budgets & Hard Caps

| Parameter | Default | Hard Cap |
|---|---:|---:|
| `maxDepth` | 8 | 32 |
| `maxNodes` | 128 | 1024 |
| `maxBytes` | 65536 | 1048576 |
| `message` UTF-8 bytes | 8192 | 8192 |
| `stack` UTF-8 bytes | 16384 | 16384 |
| `details` count | 32 | 32 |
| `detail` decoded bytes | 16384 | 16384 |
| `typeUrl` UTF-8 bytes | 512 | 512 |
| `errors` (aggregate) count | 32 | 32 |

- **Cycles:** Active-path `WeakSet` tracking distinguishes cycles (`{ kind: 'omitted', reason: 'cycle' }`) from shared non-cyclic references.
- **Mutation isolation:** `GError` copies and freezes `options.details`; `toData()` returns detached snapshots; `detailPolicy` receives a detached copy; `fromData()` clones `value` causes.
- **Untrusted input:** `fromData()` / `parse()` / `statusToData()` enforce strict own-key checks, reject `version !== 1`, `code === 0`, nonfinite numbers, sparse arrays, invalid RFC 4648 standard Base64, duplicate `ErrorContext`, and `__proto__` / `constructor` / `prototype` keys.
- **Remote stacks & constructors:** `fromData()` never instantiates remote named constructors and never overwrites locally generated `stack` with `diagnostics.stack`.
- **Transport metadata:** `fromConnectError()` never copies `ConnectError.metadata` (`Headers` such as `authorization` or `cookie`) into `GError.details`.
