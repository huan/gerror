# GError

**Native by behavior. Standard by semantics. Portable by representation. Serializable by design.**

GError v2 is a universal error architecture bridging native ECMAScript `Error`, plain JSON data (`GErrorData`) for Redux/CQRS/event sourcing, `google.rpc.Status` (`gerror-protobuf`), and ConnectRPC (`gerror-connect`).

## Packages

- **`gerror`** — Zero-dependency universal core (`GError`, `Code`, `GErrorData`). Node.js >=26, Deno, and browsers (WinterTC).
- **`gerror-protobuf`** — Bidirectional `GError` / `GErrorData` <-> `google.rpc.Status` adapter using Protobuf-ES v2 and `gerror.v1.ErrorContext`.
- **`gerror-connect`** — Bidirectional `GError` <-> `ConnectError` adapter for ConnectRPC v2.

## Quick Start

```ts
import { Code, GError } from 'gerror'

const err = new GError('Contact not found', {
  code: Code.NotFound,
  cause: { contactId: 'c1' },
})

// Plain JSON-safe snapshot (diagnostics omitted by default)
const data = err.toData()
const restored = GError.parse(JSON.stringify(data))
```

See [docs/architecture.md](docs/architecture.md), [docs/security.md](docs/security.md), and [docs/migration-v1.md](docs/migration-v1.md).
