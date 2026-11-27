#!/usr/bin/env bash
set -euo pipefail

npm run dist
TARBALL=$(npm pack)

TMPDIR=$(mktemp -d -t gerror-pack-testing.XXXXXX)
cleanup() {
  rm -rf "$TMPDIR"
  rm -f "$TARBALL"
}
trap cleanup EXIT

cp "$TARBALL" "$TMPDIR/"
cp tests/fixtures/smoke-testing.ts "$TMPDIR/"

cd "$TMPDIR"

cat << 'EOF' > package.json
{
  "name": "gerror-pack-testing-consumer",
  "version": "1.0.0",
  "type": "module",
  "private": true
}
EOF

cat << 'EOF' > tsconfig.json
{
  "compilerOptions": {
    "target": "ESNext",
    "module": "NodeNext",
    "moduleResolution": "NodeNext",
    "types": ["node"],
    "strict": true,
    "skipLibCheck": true
  },
  "include": [
    "smoke-testing.ts"
  ]
}
EOF

npm install ./"$TARBALL" \
  @types/node \
  typescript

echo
echo "ES Module: compiling typed consumer..."
./node_modules/.bin/tsc

echo
echo "ES Module: running pack smoke test..."
node smoke-testing.js

echo "Pack testing completed successfully!"
