import { defineMeta } from 'userscript-maker'
import 'userscript-maker/gm'
import { getResourceText } from 'userscript-maker/resources'

defineMeta({
  name: 'Demo script',
  namespace: 'https://example.com/demo',
  version: '1.0.0',
  description: 'Shows what userscript-maker can do: metadata, storage, styles, assets.',
  author: 'tachibana-shin',
  license: 'MIT',
  match: ['https://example.com/*'],
  grant: ['GM.setValue', 'GM.getValue'],
  runAt: 'document-end'
})

const visits = ((await GM.getValue('demo.visits', 0)) as number) + 1
await GM.setValue('demo.visits', visits)

const badge = document.createElement('div')
badge.id = 'userscript-maker-demo'
badge.textContent = `demo script · visit #${visits}`
document.body.append(badge)

// assets/note.txt is inlined at build time — no network request.
console.log(`[demo] visit #${visits} on ${location.href}`, getResourceText('note.txt').trim())
