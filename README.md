# GError

[![NPM Version](https://badge.fury.io/js/gerror.svg)](https://badge.fury.io/js/gerror)
[![NPM](https://github.com/huan/gerror/workflows/NPM/badge.svg)](https://github.com/huan/gerror/actions?query=workflow%3ANPM)
[![TypeScript](https://img.shields.io/badge/%3C%2F%3E-TypeScript-blue.svg)](https://www.typescriptlang.org/)
[![ES Modules](https://img.shields.io/badge/ES-Modules-brightgreen)](https://github.com/Chatie/tsconfig/issues/16)

Mixer of gRPC Error &amp; ECMAScript Error

![GError](docs/images/gerror-logo.png)

## Motivation

We working with gRPC with Node.js(ECMAScript) and we need to mix gRPC Error &amp; ECMAScript Error.

In order to make it easy, we build GError module

## Features

1. `GError.from(anyting: any)`
1. `gerror.toJSON()`

## Examples

```ts
import { GError } from 'gerror'

const gerror = GError.from(new Error('test'))
```

## API Reference

TBW


## History

### master v0.1 (Oct 30, 2021)

1. Initial code from `wechaty-puppet` module

## Author

[Huan LI](https://github.com/huan) ([李卓桓](http://linkedin.com/in/zixia)), Google Developer Export (GDE), zixia@zixia.net

[![Profile of Huan LI (李卓桓) on StackOverflow](https://stackexchange.com/users/flair/265499.png)](https://stackexchange.com/users/265499)

## Copyright & License

* Docs released under Creative Commons
* Code released under the Apache-2.0 License
* Code & Docs © 2021 Huan LI \<zixia@zixia.net\>
