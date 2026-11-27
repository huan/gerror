#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
TMP_DIR="$(mktemp -d)"
trap 'rm -rf "$TMP_DIR"' EXIT

cd "$ROOT_DIR"
npm run build

mkdir -p "$TMP_DIR/tarballs" "$TMP_DIR/consumer"

GERROR_TGZ="$(npm pack --workspace gerror --pack-destination "$TMP_DIR/tarballs" | tail -n 1)"
PROTO_TGZ="$(npm pack --workspace gerror-protobuf --pack-destination "$TMP_DIR/tarballs" | tail -n 1)"
CONNECT_TGZ="$(npm pack --workspace gerror-connect --pack-destination "$TMP_DIR/tarballs" | tail -n 1)"

cat > "$TMP_DIR/consumer/package.json" <<EOF
{
  "name": "gerror-pack-consumer",
  "private": true,
  "type": "module",
  "dependencies": {
    "gerror": "file:$TMP_DIR/tarballs/$GERROR_TGZ",
    "gerror-protobuf": "file:$TMP_DIR/tarballs/$PROTO_TGZ",
    "gerror-connect": "file:$TMP_DIR/tarballs/$CONNECT_TGZ"
  }
}
EOF

cd "$TMP_DIR/consumer"
npm install --no-audit --no-fund

node --input-type=module <<'EOF'
import assert from 'node:assert/strict'
import { existsSync } from 'node:fs'
import * as gerrorMod from 'gerror'
import { Code, GError } from 'gerror'
import { fromStatus, toStatus } from 'gerror-protobuf'
import { fromConnectError, toConnectError } from 'gerror-connect'

assert.deepEqual(Object.keys(gerrorMod).sort(), ['Code', 'GError'])
assert.equal(existsSync('node_modules/gerror/dist/mod.d.ts'), true)
assert.equal(existsSync('node_modules/gerror-protobuf/dist/mod.d.ts'), true)
assert.equal(existsSync('node_modules/gerror-connect/dist/mod.d.ts'), true)

const err = new GError('packed test', { code: Code.NotFound, cause: { id: 42 } })
const parsed = GError.parse(GError.stringify(err))
const fromProto = fromStatus(toStatus(parsed))
const fromConnect = fromConnectError(toConnectError(fromProto))

assert.equal(fromConnect.code, Code.NotFound)
assert.equal(fromConnect.message, 'packed test')
assert.deepEqual(fromConnect.cause, { id: 42 })
console.log('pack-testing passed')
EOF
