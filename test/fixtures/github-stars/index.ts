import { defineMeta } from 'userscript-maker'
import 'userscript-maker/gm'

defineMeta({
  name: 'GitHub stars badge',
  namespace: 'https://github.com/shin/userscripts/github-stars',
  version: '1.0.0',
  description: 'Adds the star count of the current repository next to its name.',
  author: 'shin',
  license: 'MIT',
  match: ['https://github.com/*/*'],
  // Legacy grant spelling on purpose: the header must keep it verbatim.
  grant: ['GM_xmlhttpRequest'],
  connect: ['api.github.com'],
  runAt: 'document-idle'
})

const [owner, repo] = location.pathname.split('/').filter(Boolean)
const title = document.querySelector<HTMLElement>('h1')
if (owner && repo && title) {
  const badge = document.createElement('span')
  badge.id = 'github-stars'
  badge.textContent = ' …'
  title.append(badge)

  GM_xmlhttpRequest({
    method: 'GET',
    url: `https://api.github.com/repos/${owner}/${repo}`,
    headers: { Accept: 'application/vnd.github+json' },
    onload: response => {
      const data = JSON.parse(response.responseText ?? '{}') as { stargazers_count?: number }
      badge.textContent = typeof data.stargazers_count === 'number' ? ` ★ ${data.stargazers_count}` : ' ★ n/a'
    },
    onerror: () => {
      badge.textContent = ' ★ n/a'
    }
  })
}
