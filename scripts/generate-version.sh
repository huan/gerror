#!/usr/bin/env bash
set -e

SRC_VERSION_TS_FILE='src/version.ts'

[ -f ${SRC_VERSION_TS_FILE} ] || {
  echo ${SRC_VERSION_TS_FILE}" not found"
  exit 1
}

# The publish job uses this script with OIDC permissions. Read the manifest locally.
VERSION=$(node --input-type=module -e '
  import { readFileSync } from "node:fs"
  console.log(JSON.parse(readFileSync("package.json", "utf8")).version)
')

cat <<_SRC_ > ${SRC_VERSION_TS_FILE}
/**
 * This file was auto generated from scripts/generate-version.sh
 */
export const VERSION: string = '${VERSION}'
_SRC_

echo "$VERSION generated."
