import { defineMeta } from 'userscript-maker'

const meta = defineMeta({
  name: 'Assigned Fixture',
  version: '0.1.0',
  match: 'https://example.com/*'
})

console.log('name is', meta.name)
