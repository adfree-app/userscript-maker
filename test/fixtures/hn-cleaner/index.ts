import { defineMeta } from 'userscript-maker'
import 'userscript-maker/gm'

defineMeta({
  name: 'HN cleaner',
  namespace: 'https://github.com/tachibana-shin/userscripts/hn-cleaner',
  version: '1.0.0',
  description: 'Dims stories you already opened and hides the job ads on the Hacker News front page.',
  author: 'tachibana-shin',
  license: 'MIT',
  homepage: 'https://github.com/tachibana-shin/userscripts',
  match: ['https://news.ycombinator.com/*'],
  grant: ['GM.getValue', 'GM.setValue', 'GM.registerMenuCommand'],
  runAt: 'document-end',
  noframes: true
})

const VISITED_KEY = 'hn.visited'
const visited = new Set<string>((await GM.getValue<string[]>(VISITED_KEY, [])) ?? [])

function markVisited(): void {
  for (const row of document.querySelectorAll<HTMLElement>('tr.athing.submission')) {
    const id = row.id
    if (!id) continue
    const link = row.querySelector<HTMLAnchorElement>('span.titleline > a')
    const already = visited.has(id)

    if (!already && link) {
      link.addEventListener(
        'click',
        () => {
          visited.add(id)
          void GM.setValue(VISITED_KEY, [...visited])
          row.dataset.hnVisited = '1'
        },
        { once: true }
      )
    }

    if (already) row.dataset.hnVisited = '1'
    if (link && /hiring|is hiring/i.test(link.textContent ?? '')) row.dataset.hnAd = '1'
  }
}

markVisited()
document.addEventListener('DOMContentLoaded', markVisited)

GM.registerMenuCommand('HN cleaner: reset visited stories', async () => {
  visited.clear()
  await GM.setValue(VISITED_KEY, [])
  for (const row of document.querySelectorAll<HTMLElement>('[data-hn-visited]')) {
    delete row.dataset.hnVisited
  }
})

if (__DEV__) console.debug(`[${__NAME__} ${__VERSION__}] marked ${visited.size} visited stories`)
