/**
 * Unit tests for canonical Google RPC `Code` values and validation helpers.
 */

import assert from 'node:assert/strict'
import { describe, it } from 'node:test'

import { assertCode, Code, isCode } from './code.ts'

describe('Code', () => {
  it('defines all 16 canonical failure codes (1..16) and excludes OK (0)', () => {
    const entries = Object.entries(Code)
    assert.equal(entries.length, 16)
    assert.equal('OK' in Code, false)

    const values = Object.values(Code).sort((a, b) => a - b)
    assert.deepEqual(values, [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16])
  })

  it('validates canonical codes and rejects OK, out-of-range, and non-numbers', () => {
    for (const code of Object.values(Code)) {
      assert.equal(isCode(code), true)
      assert.equal(assertCode(code), code)
    }

    const invalid = [0, -1, 17, 1.5, Number.NaN, Number.POSITIVE_INFINITY, '5', null, undefined, {}]
    for (const value of invalid) {
      assert.equal(isCode(value), false)
      assert.throws(() => assertCode(value), TypeError)
    }
  })
})
