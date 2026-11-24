import { describe, expect, test } from 'bun:test'
import { startDevServer } from '../src/dev.ts'
import { makeScript, metaBlock } from './helpers.ts'

describe('startDevServer', () => {
  test('serves a harness page, the script, the mock and reload events', async () => {
    const script = await makeScript({
      'index.ts': `${metaBlock()}
console.log('dev harness')
`,
      'fixture.html': '<html><body><h1 id="fixture">fixture</h1></body></html>'
    })
    const server = await startDevServer([script.dir], { port: 0, outDir: script.dir })
    try {
      expect(server.urls).toHaveLength(1)
      const base = new URL(server.urls[0]!)

      const page = await fetch(base)
      const html = await page.text()
      expect(page.status).toBe(200)
      expect(html).toContain('fixture')
      expect(html).toContain('dev harness'.length > 0 ? '<script src="./script.user.js"></script>' : '')
      expect(html).toContain('/gm-mock.js')

      const mock = await fetch(new URL('/gm-mock.js', base))
      expect(mock.status).toBe(200)
      expect(await mock.text()).toContain('installGmMock')

      const bundle = await fetch(new URL('/' + server.scripts[0]!.slug + '/script.user.js', base))
      expect(bundle.status).toBe(200)
      expect(await bundle.text()).toContain('// ==UserScript==')

      const events = await fetch(new URL('/__userscript_dev__/events', base))
      expect(events.headers.get('content-type')).toContain('text/event-stream')
      await events.body?.cancel()

      // editing the script and rebuilding refreshes the bundle on disk
      await Bun.write(
        script.entry,
        `${metaBlock()}
console.log('changed')
`
      )
      const rebuilt = await server.rebuild()
      expect(rebuilt[0]!.body).toContain('changed')

      const refreshed = await fetch(new URL('/' + rebuilt[0]!.slug + '/script.user.js', base))
      expect(await refreshed.text()).toContain('changed')
    } finally {
      await server.stop()
      await script.cleanup()
    }
  })
})
