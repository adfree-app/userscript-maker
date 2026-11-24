import { defineMeta } from 'userscript-maker'
import { greet } from './util.ts'

defineMeta({
  name: 'Basic Fixture',
  namespace: 'https://example.com/basic',
  version: '1.2.3',
  description: 'Fixture script that must bundle',
  author: 'tests',
  license: 'MIT',
  match: ['https://example.com/*', 'https://example.org/*'],
  grant: ['GM.setValue', 'GM.getValue'],
  runAt: 'document-end',
  noframes: true
})

console.log(greet('world'))
