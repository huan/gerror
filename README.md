# GError

[![NPM Version](https://badge.fury.io/js/gerror.svg)](https://badge.fury.io/js/gerror)
[![NPM](https://github.com/huan/gerror/workflows/NPM/badge.svg)](https://github.com/huan/gerror/actions?query=workflow%3ANPM)
[![TypeScript](https://img.shields.io/badge/%3C%2F%3E-TypeScript-blue.svg)](https://www.typescriptlang.org/)
[![ES Modules](https://img.shields.io/badge/ES-Modules-brightgreen)](https://github.com/Chatie/tsconfig/issues/16)

Mixer of gRPC Error &amp; ECMAScript Error

![GError](docs/images/gerror-logo.png)

## Motivation

We are writing async programs with gRPC with Node.js(ECMAScript) so we need to mix gRPC Error &amp; ECMAScript Error.

In order to make it easy, we build GError module

## Features

1. **Pure WinterTC Standards**: Universal execution across Node.js >= 20, Deno, Bun, Cloudflare Workers, and modern browsers with zero Node-specific built-in dependencies.
2. **Canonical `GErrorDTO` Wire Contract**: Plain serializable JSON object for distributed systems, gRPC, Redux, and CQRS events.
3. **Lossless `toJSON()`**: Recursively serializes nested ES2022 `cause` chains and arbitrary metadata (`data`).
4. **Distributed Stack Trace Stitching**: Stitches remote error stack traces with local caller call sites across process boundaries.
5. **Polymorphic Subclass Rehydration**: `GError.from(payload)` preserves subclass types and `instanceof` hierarchies (e.g. `WechatyError extends GError`).

## Examples

### 1. JSON DTO Serialization for Event-Driven Systems (Redux / CQRS)

```ts
import { GError, type GErrorDTO } from 'gerror'

const error = new GError('Authentication expired', {
  code: 'AUTH_EXPIRED',
  details: 'Token expired at 1700000000',
  data: { userId: 'u123' },
  cause: new Error('Network timeout'),
})

// Produces a clean JSON DTO that survives JSON.stringify() and structuredClone()
const dto: GErrorDTO = error.toJSON()
const json = JSON.stringify(dto)

// Rehydrates losslessly on remote client with cause chain intact
const rehydrated = GError.from(JSON.parse(json))
console.log(rehydrated.code) // 'AUTH_EXPIRED'
console.log(rehydrated.cause) // Error('Network timeout')
```

### 2. Distributed Stack Trace Stitching

```ts
// Remote puppet driver stack is stitched to local caller call-site:
const clientError = GError.from(remoteDto)
console.log(clientError.stack)
// Error: Remote connection failed
//     at RemotePuppet.connect (/app/driver.js:42:15)
//     --- remote boundary ---
//     at Wechaty.start (file:///client/bot.js:15:20)
```

## API Reference

### `class GError`

`GError` can be used to replace the standard `Error` as a drop in replacement.

```ts
import { GError } from 'gerror'

const gerror = GError.from(new Error('test'))
```

### `GError.stringify(e: any)`

Convert anything to a `JSON.stringify()`-ed `GError` payload

```ts
GError.stringify('this is a string error')

// It acepts any type of args
GError.stringify(new Error() as unknown)
```

### `wrapAsyncError()`

It has been designed to convert a Async to Sync, for example:

1. `async (...args: any[]) => Promise<any>` will be converted to `(...args: any[]) => void`
1. `Promise<any>` will be converted to `void`

The error will be send via the `onError` callback.

```ts
import { wrapAsyncError } from 'gerror'

const onError = (e: any) => console.error(e)
const wrapAsync = wrapAsyncError(onError)

const asyncFunc = async () => Promise.reject('rejection')
const syncFunc = wrapAsync(asyncFunc)
// ReturnType<typeof syncFunc> === 'void'

asyncFunc() // <- nothing happens (no unhandled rejections)
// console.error('Rejection')
```

## Resources

1. [Google Cloud APIs - Errors](https://cloud.google.com/apis/design/errors)

## History

### v2.0 (Nov 2026)

1. Upgrade to GError 2.0 with WinterTC baseline (Node.js >= 20, Deno, Bun, Cloudflare Workers, modern browsers).
2. Introduce canonical `GErrorDTO` JSON wire contract for CQRS, Redux, and gRPC events.
3. Add lossless recursive `toJSON()` with ES2022 `cause` support.
4. Add distributed cross-process stack trace stitching in `GError.from()`.
5. Support polymorphic subclass rehydration for domain error hierarchies.

### master v1.0 (Oct 30, 2021)

1. Initial code from `wechaty-puppet` module
1. Add `timeoutPromise()` function

## Author

[Huan LI](https://github.com/huan) ([李卓桓](http://linkedin.com/in/zixia)), Google Developer Export (GDE), zixia@zixia.net

[![Profile of Huan LI (李卓桓) on StackOverflow](https://stackexchange.com/users/flair/265499.png)](https://stackexchange.com/users/265499)

## Copyright & License

* Docs released under Creative Commons
* Code released under the Apache-2.0 License
* Code & Docs © 2021 Huan LI \<zixia@zixia.net\>
