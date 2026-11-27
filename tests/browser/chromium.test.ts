/**
 * Real-browser Chromium verification for `gerror` native ESM module.
 */

import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { createServer } from 'node:http'
import { join, resolve } from 'node:path'
import { describe, it } from 'node:test'

import { chromium } from 'playwright'

const GERROR_DIST = resolve('packages/gerror/dist')

describe('Chromium browser compatibility', () => {
  it('executes gerror ESM in real headless Chromium', async (t) => {
    const server = createServer((req, res) => {
      const urlPath = req.url ?? '/'
      if (urlPath === '/') {
        res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' })
        res.end(`<!doctype html>
<html>
  <body>
    <script type="module">
      import { Code, GError } from '/dist/mod.js'
      try {
        const err = new GError('browser failure', {
          code: Code.NotFound,
          cause: { item: 'contact-1' },
        })
        if (!(err instanceof Error) || !(err instanceof GError)) {
          throw new Error('instanceof failed')
        }
        if (!GError.isGError(err)) {
          throw new Error('isGError failed')
        }
        const data = err.toData()
        if (data.diagnostics !== undefined) {
          throw new Error('diagnostics should be omitted by default')
        }
        const restored = GError.parse(GError.stringify(err))
        if (restored.code !== Code.NotFound || restored.message !== 'browser failure') {
          throw new Error('round-trip mismatch')
        }
        const normalized = GError.from(new AggregateError([new Error('a')], 'agg'))
        if (normalized.toData().errors?.length !== 1) {
          throw new Error('aggregate mismatch')
        }
        window.__GERROR_RESULT__ = { ok: true, code: restored.code }
      } catch (e) {
        window.__GERROR_RESULT__ = { ok: false, error: String(e) }
      }
    </script>
  </body>
</html>`)
        return
      }

      if (urlPath.startsWith('/dist/') && urlPath.endsWith('.js')) {
        const filePath = join(GERROR_DIST, urlPath.slice('/dist/'.length))
        res.writeHead(200, { 'Content-Type': 'application/javascript; charset=utf-8' })
        res.end(readFileSync(filePath))
        return
      }

      res.writeHead(404)
      res.end('Not found')
    })

    await new Promise<void>((resolveListen) => server.listen(0, '127.0.0.1', resolveListen))
    t.after(() => server.close())

    const addr = server.address()
    assert.ok(addr && typeof addr === 'object')
    const url = `http://127.0.0.1:${addr.port}/`

    const browser = await chromium.launch()
    t.after(() => browser.close())

    const page = await browser.newPage()
    await page.goto(url)
    await page.waitForFunction(() => Boolean((window as unknown as { __GERROR_RESULT__?: unknown }).__GERROR_RESULT__))

    const result = await page.evaluate(
      () => (window as unknown as { __GERROR_RESULT__: { ok: boolean; code?: number; error?: string } }).__GERROR_RESULT__,
    )
    assert.equal(result.ok, true, result.error)
    assert.equal(result.code, 5)
  })
})
