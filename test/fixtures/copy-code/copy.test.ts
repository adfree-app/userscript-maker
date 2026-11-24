import { describe, expect, test } from 'bun:test'
import { createHarness } from 'userscript-maker/testing'

describe('copy-code', () => {
  test('adds one button per code block and copies on click', async () => {
    const harness = await createHarness(import.meta.dir, {
      url: 'https://docs.example.com/guide',
      html: '<main><pre><code>npm install my-thing</code></pre><pre><code>thing()</code></pre></main>'
    })
    try {
      harness.run()
      await Bun.sleep(10)

      const buttons = harness.document.querySelectorAll('.userscript-copy-code')
      expect(buttons.length).toBe(2)

      const icon = buttons[0]!.querySelector('img')!
      expect(icon.getAttribute('src')?.startsWith('data:image/svg+xml')).toBe(true)

      buttons[0]!.dispatchEvent(new harness.window.Event('click') as unknown as Event)
      await Bun.sleep(10)
      expect(harness.mock.clipboard.at(-1)).toBe('npm install my-thing')
      expect((buttons[0] as HTMLElement).dataset.state).toBe('copied')
    } finally {
      harness.dispose()
    }
  })
})
