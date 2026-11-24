import { describe, expect, test } from 'bun:test'
import { createHarness } from 'userscript-maker/testing'

const PAGE = `<table>
  <tr class="athing submission" id="1"><td><span class="titleline"><a href="#">old story</a></span></td></tr>
  <tr class="athing submission" id="2"><td><span class="titleline"><a href="#">new story</a></span></td></tr>
  <tr class="athing submission" id="3"><td><span class="titleline"><a href="#">Acme Is Hiring</a></span></td></tr>
</table>`

describe('hn-cleaner', () => {
  test('dims visited stories and flags job ads', async () => {
    const harness = await createHarness(import.meta.dir, {
      url: 'https://news.ycombinator.com/',
      html: PAGE
    })
    try {
      // pretend story #1 was opened before
      harness.mock.storage.set('hn.visited', ['1'])
      harness.run()
      await Bun.sleep(10)

      const rows = harness.document.querySelectorAll('tr.athing')
      expect(rows[0]!.getAttribute('data-hn-visited')).toBe('1')
      expect(rows[1]!.hasAttribute('data-hn-visited')).toBe(false)
      expect(rows[2]!.getAttribute('data-hn-ad')).toBe('1')
    } finally {
      harness.dispose()
    }
  })

  test('remembers a story after its link is clicked', async () => {
    const harness = await createHarness(import.meta.dir, {
      url: 'https://news.ycombinator.com/',
      html: PAGE
    })
    try {
      harness.run()
      await Bun.sleep(10)

      const link = harness.document.querySelectorAll('a')[1]!
      link.dispatchEvent(new harness.window.Event('click') as unknown as Event)
      await Bun.sleep(10)

      expect(harness.mock.storage.get('hn.visited')).toEqual(['2'])
    } finally {
      harness.dispose()
    }
  })
})
