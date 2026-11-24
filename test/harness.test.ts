import { describe, expect, test } from 'bun:test'
import { buildScript } from '../src/build.ts'
import { installGmMock } from '../src/gm-mock.ts'
import { harnessHtml } from '../src/harness.ts'
import { createHarness } from '../src/testing.ts'
import { makeScript, metaBlock } from './helpers.ts'

const DOM_SCRIPT = `${metaBlock(",\n  grant: ['GM.setValue', 'GM.getValue']")}
const seen = ((await GM.getValue('runs', 0)) as number) + 1
await GM.setValue('runs', seen)

const box = document.createElement('div')
box.id = 'made-by-script'
box.textContent = 'runs: ' + seen + ' @ ' + location.host
document.body.append(box)

GM_addStyle('#made-by-script { color: red }')
`

describe('createHarness', () => {
  test('runs the script in a happy-dom page with a GM mock', async () => {
    const script = await makeScript({
      'index.ts': DOM_SCRIPT,
      'fixture.html': '<html><body><h1 id="existing">page</h1></body></html>'
    })
    const harness = await createHarness(script.dir, { url: 'https://example.com/page' })
    try {
      expect(harness.script.issues.filter(i => i.level === 'error')).toHaveLength(0)
      expect(harness.document.querySelector('#existing')).not.toBeNull()
      expect(harness.document.querySelector('#made-by-script')).toBeNull()

      harness.run()
      await Bun.sleep(20)

      const box = harness.document.querySelector('#made-by-script')
      expect(box?.textContent).toBe('runs: 1 @ example.com')
      expect(harness.mock.storage.get('runs')).toBe(1)
      expect(harness.document.querySelectorAll('style').length).toBe(1)

      // running again keeps the storage but appends a second badge
      harness.run()
      await Bun.sleep(20)
      expect(harness.mock.storage.get('runs')).toBe(2)
      expect(harness.document.querySelectorAll('#made-by-script')).toHaveLength(2)
      expect(harness.mock.log.some(entry => entry.api === 'addStyle')).toBe(true)
    } finally {
      harness.dispose()
      await script.cleanup()
    }
  })

  test('uses options.html when no fixture exists', async () => {
    const script = await makeScript({ 'index.ts': DOM_SCRIPT })
    const harness = await createHarness(script.dir, {
      html: '<main id="custom">custom page</main>',
      url: 'https://example.org/x'
    })
    try {
      expect(harness.document.querySelector('#custom')).not.toBeNull()
      expect(harness.window.location.host).toBe('example.org')
    } finally {
      harness.dispose()
      await script.cleanup()
    }
  })

  test('restores the globals it swapped', async () => {
    const script = await makeScript({ 'index.ts': DOM_SCRIPT })
    const before = typeof (globalThis as { document?: unknown }).document
    const harness = await createHarness(script.dir)
    try {
      expect(typeof (globalThis as { document?: unknown }).document).toBe('object')
    } finally {
      harness.dispose()
      await script.cleanup()
    }
    expect(typeof (globalThis as { document?: unknown }).document).toBe(before)
  })
})

describe('installGmMock', () => {
  test('keeps values, records calls and can restore', async () => {
    const target: Record<string, unknown> = {}
    const mock = installGmMock({ window: target as never })
    await (mock.GM.setValue as (k: string, v: unknown) => Promise<void>)('a', 1)
    const value = await (mock.GM.getValue as (k: string, d?: unknown) => Promise<unknown>)('a', 0)
    expect(value).toBe(1)
    expect(mock.storage.get('a')).toBe(1)
    expect(mock.log.map(l => l.api)).toContain('setValue')
    expect(typeof target.GM).toBe('object')
    expect(typeof target.GM_getValue).toBe('function')
    mock.restore()
    expect(target.GM).toBeUndefined()
  })
})

describe('harnessHtml', () => {
  test('embeds metadata, mock and script', async () => {
    const script = await makeScript({ 'index.ts': `${metaBlock()}\nconsole.log('x')\n` })
    try {
      const built = await buildScript(script.dir, { write: false })
      const html = harnessHtml({ script: built, reloadPath: '/events', fixture: '<p id="fixture">hi</p>' })
      expect(html).toContain('Test script')
      expect(html).toContain('name="viewport"')
      expect(html).toContain('<p id="fixture">hi</p>')
      expect(html).toContain('/gm-mock.js')
      expect(html).toContain('./script.user.js')
      expect(html).toContain('EventSource("/events")')
      expect(html).toContain('https://example.com/*')
    } finally {
      await script.cleanup()
    }
  })
})
