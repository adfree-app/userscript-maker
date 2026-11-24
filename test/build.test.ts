import { describe, expect, test } from 'bun:test'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { buildMany, buildScript, resolveEntry, slugFor } from '../src/build.ts'

const FIXTURES = join(import.meta.dir, 'fixtures')

describe('resolveEntry', () => {
  test('picks index.ts inside a directory', async () => {
    expect(await resolveEntry(join(FIXTURES, 'basic'))).toBe(join(FIXTURES, 'basic', 'index.ts'))
  })

  test('accepts a file directly', async () => {
    const file = join(FIXTURES, 'basic', 'index.ts')
    expect(await resolveEntry(file)).toBe(file)
  })

  test('reports missing scripts', async () => {
    await expect(resolveEntry(join(FIXTURES, 'nope'))).rejects.toThrow(/not found/)
  })
})

describe('slugFor', () => {
  test('directory name for a script folder', () => {
    expect(slugFor(join(FIXTURES, 'basic'), join(FIXTURES, 'basic', 'index.ts'))).toBe('basic')
  })

  test('drops extension and .user for files', async () => {
    const file = join(FIXTURES, 'basic', 'util.ts')
    expect(slugFor(file, file)).toBe('util')
    expect(slugFor('/x/foo.user.ts', '/x/foo.user.ts')).toBe('foo')
  })
})

describe('buildScript', () => {
  test('emits header + bundled body, without defineMeta', async () => {
    const built = await buildScript(join(FIXTURES, 'basic'), { write: false })

    expect(built.header).toContain('// ==UserScript==')
    expect(built.header).toContain('// @name')
    expect(built.header).toContain('Basic Fixture')
    expect(built.header).toContain('// @match')
    expect(built.header.indexOf('@name')).toBeLessThan(built.header.indexOf('@match'))
    expect(built.header).toContain('// @run-at')
    expect(built.header).toContain('// @noframes')
    expect(built.header.trimEnd().endsWith('// ==/UserScript==')).toBe(true)

    // the script body is bundled: local import inlined, no bare imports left
    expect(built.body).toContain('hello')
    expect(built.body).not.toContain('defineMeta')
    expect(built.body).not.toMatch(/from\s*["']userscript-maker["']/)

    expect(built.meta.version).toBe('1.2.3')
    expect(built.meta.match).toEqual(['https://example.com/*', 'https://example.org/*'])

    // header comes first in the final file
    expect(built.code.startsWith('// ==UserScript==')).toBe(true)
    expect(built.code.indexOf('// ==/UserScript==')).toBeLessThan(built.code.indexOf('hello'))
  })

  test('keeps the object when defineMeta is assigned to a variable', async () => {
    const built = await buildScript(join(FIXTURES, 'assigned'), { write: false })
    expect(built.body).toContain('Assigned Fixture')
    expect(built.body).not.toContain('defineMeta')
  })

  test('minify shrinks the body', async () => {
    const plain = await buildScript(join(FIXTURES, 'basic'), { write: false })
    const mini = await buildScript(join(FIXTURES, 'basic'), { write: false, minify: true })
    expect(mini.body.length).toBeLessThan(plain.body.length)
  })

  test('writes .user.js files into outDir', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'userscript-maker-'))
    try {
      const built = await buildMany([join(FIXTURES, 'basic'), join(FIXTURES, 'assigned')], { outDir: dir })
      expect(built).toHaveLength(2)
      expect(built[0]!.outputPath).toBe(join(dir, 'basic.user.js'))
      expect(await Bun.file(join(dir, 'assigned.user.js')).text()).toContain('// ==UserScript==')
    } finally {
      await rm(dir, { recursive: true, force: true })
    }
  })

  test('surfaces a broken script as an error', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'userscript-maker-'))
    try {
      await Bun.write(join(dir, 'index.ts'), 'console.log("no metadata here")\n')
      await expect(buildScript(dir, { write: false, outDir: dir })).rejects.toThrow(/No `defineMeta/)
    } finally {
      await rm(dir, { recursive: true, force: true })
    }
  })
})

describe('metadata that is not a pure literal', () => {
  test('reads constants declared above defineMeta()', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'userscript-maker-'))
    try {
      await Bun.write(
        join(dir, 'index.ts'),
        `import { defineMeta, type UserScriptMeta } from 'userscript-maker'

const NAME = 'From a const'
const VERSION = '3.2.1'

defineMeta({ name: NAME, version: VERSION, grant: 'none' } as const satisfies UserScriptMeta)

console.log('body must not run at build time')
`
      )
      const built = await buildScript(dir, { write: false, outDir: dir })
      expect(built.meta.name).toBe('From a const')
      expect(built.meta.version).toBe('3.2.1')
      expect(built.header).toContain('// @name')
      expect(built.body).not.toContain('defineMeta')
    } finally {
      await rm(dir, { recursive: true, force: true })
    }
  })
})
