import { describe, expect, test } from 'bun:test'
import { join } from 'node:path'
import { buildScript } from '../src/build.ts'
import { makeScript, metaBlock } from './helpers.ts'

describe('build extras', () => {
  test('injects compile-time constants', async () => {
    const script = await makeScript({
      'index.ts': `${metaBlock()}
console.log(__NAME__, __VERSION__, __PROD__, __DEV__)
`
    })
    try {
      const built = await buildScript(script.dir, { write: false, defines: { __FLAG__: true } })
      expect(built.body).toContain('"Test script"')
      expect(built.body).toContain('"1.0.0"')
      expect(built.body).toContain('true')
      expect(built.body).toContain('false')
    } finally {
      await script.cleanup()
    }
  })

  test('supports top-level await', async () => {
    const script = await makeScript({
      'index.ts': `${metaBlock()}
const value = await Promise.resolve(21 * 2)
console.log(value)
`
    })
    try {
      const built = await buildScript(script.dir, { write: false })
      expect(built.body).toContain('async')
      expect(() => new Function(built.body)).not.toThrow()
    } finally {
      await script.cleanup()
    }
  })

  test('inlines a css sidecar and grants GM_addStyle', async () => {
    const script = await makeScript({
      'index.ts': `${metaBlock()}\nconsole.log('hi')\n`,
      'index.css': '#x { color: red }\n'
    })
    try {
      const built = await buildScript(script.dir, { write: false })
      expect(built.body).toContain('GM_addStyle')
      expect(built.body).toContain('#x { color: red }')
      expect(built.header).toContain('// @grant                      GM_addStyle')
      expect(built.cssFile).toEndWith('index.css')
    } finally {
      await script.cleanup()
    }
  })

  test('can skip the css sidecar', async () => {
    const script = await makeScript({
      'index.ts': `${metaBlock()}\nconsole.log('hi')\n`,
      'index.css': '#x { color: red }'
    })
    try {
      const built = await buildScript(script.dir, { write: false, css: false })
      expect(built.body).not.toContain('#x { color: red }')
    } finally {
      await script.cleanup()
    }
  })

  test('inlines the assets folder for userscript-maker/resources', async () => {
    const script = await makeScript({
      'index.ts': `${metaBlock()}
import { getResourceText, listResources } from 'userscript-maker/resources'
console.log(getResourceText('note.txt'), listResources())
`,
      'assets/note.txt': 'hello asset',
      'assets/deep/data.json': '{"a":1}'
    })
    try {
      const built = await buildScript(script.dir, { write: false })
      expect(built.resources.map(r => r.name).toSorted()).toEqual(['deep/data.json', 'note.txt'])
      expect(built.body).toContain('__USERSCRIPT_MAKER_RESOURCES__')
      expect(Buffer.from(built.body).toString()).toContain('data:text/plain;base64,aGVsbG8gYXNzZXQ=')
      expect(() => new Function(built.body)).not.toThrow()
    } finally {
      await script.cleanup()
    }
  })

  test('keeps externals out of the bundle and adds @require', async () => {
    const script = await makeScript({
      'index.ts': `import { defineMeta } from 'userscript-maker'
import _ from 'lodash'

defineMeta({ name: 'Ext', version: '1.0.0', match: 'https://example.com/*' })
console.log(_.map([1], (x) => x))
`
    })
    try {
      const built = await buildScript(script.dir, {
        write: false,
        externals: { lodash: 'https://cdn.example.com/lodash.min.js#_' }
      })
      expect(built.header).toContain('// @require                    https://cdn.example.com/lodash.min.js')
      expect(built.externals[0]).toMatchObject({ spec: 'lodash', global: '_' })
      // the library is not inlined, the shim resolves it from the global
      expect(built.body).toContain('"lodash":"_"')
      expect(built.body).toContain('__require("lodash")')
      expect(built.body).not.toContain('function map(')
    } finally {
      await script.cleanup()
    }
  })

  test('bumps the version and writes it back into the source', async () => {
    const script = await makeScript({
      'index.ts': `${metaBlock()}\nconsole.log('hi')\n`
    })
    try {
      const built = await buildScript(script.dir, { write: false, bump: 'minor' })
      expect(built.meta.version).toBe('1.1.0')
      expect(built.header).toContain('// @version                    1.1.0')
      const source = await Bun.file(script.entry).text()
      expect(source).toContain("version: '1.1.0'")
    } finally {
      await script.cleanup()
    }
  })

  test('fills @downloadURL/@updateURL from --base-url', async () => {
    const script = await makeScript({ 'index.ts': `${metaBlock()}\nconsole.log(1)\n` })
    try {
      const built = await buildScript(script.dir, { write: false, baseUrl: 'https://me.dev/us/' })
      expect(built.header).toContain(
        '// @downloadURL                https://me.dev/us/' + built.slug + '.user.js'
      )
      expect(built.header).toContain(
        '// @updateURL                  https://me.dev/us/' + built.slug + '.user.js'
      )
      expect(built.auto.join('\n')).toContain('downloadURL')
    } finally {
      await script.cleanup()
    }
  })

  test('strict mode refuses lint errors', async () => {
    const script = await makeScript({
      'index.ts': `import { defineMeta } from 'userscript-maker'
defineMeta({ name: 'Bad', version: '1.0.0', match: ['nope'], runAt: 'document-maybe' as never })
`
    })
    try {
      await expect(buildScript(script.dir, { write: false, strict: true })).rejects.toThrow(/lint failed/)
      // without strict the build still succeeds but reports the issues
      const built = await buildScript(script.dir, { write: false })
      expect(built.issues.filter(i => i.level === 'error').length).toBeGreaterThan(0)
    } finally {
      await script.cleanup()
    }
  })

  test('reports file/line for a script without defineMeta', async () => {
    const script = await makeScript({ 'index.ts': 'console.log(1)\n' })
    try {
      await expect(buildScript(script.dir, { write: false })).rejects.toThrow(/No `defineMeta/)
    } finally {
      await script.cleanup()
    }
  })

  test('writes output into a nested out dir', async () => {
    const script = await makeScript({ 'index.ts': `${metaBlock()}\nconsole.log(1)\n` })
    try {
      const outDir = join(script.dir, 'dist')
      const built = await buildScript(script.dir, { outDir })
      expect(built.outputPath).toBe(join(outDir, `${built.slug}.user.js`))
      expect(await Bun.file(built.outputPath!).exists()).toBe(true)
    } finally {
      await script.cleanup()
    }
  })
})
