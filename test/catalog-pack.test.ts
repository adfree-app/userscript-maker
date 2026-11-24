import { describe, expect, test } from 'bun:test'
import { join } from 'node:path'
import { readFile } from 'node:fs/promises'
import { buildMany } from '../src/build.ts'
import { buildCatalog, catalogJson, writeCatalog } from '../src/catalog.ts'
import { metaJson, packScripts } from '../src/pack.ts'
import { makeScript, metaBlock } from './helpers.ts'

async function buildTwo() {
  const a = await makeScript({ 'index.ts': `${metaBlock(",\n  grant: 'none'")}\nconsole.log('a')\n` })
  const b = await makeScript({ 'index.ts': `${metaBlock(",\n  description: 'second'")}\nconsole.log('b')\n` })
  const scripts = await buildMany([a.dir, b.dir], { write: false })
  return { a, b, scripts }
}

describe('catalog', () => {
  test('describes every script', async () => {
    const { a, b, scripts } = await buildTwo()
    try {
      const catalog = buildCatalog(scripts, { baseUrl: 'https://me.dev/us' })
      expect(catalog.manifestVersion).toBe(1)
      expect(catalog.scripts).toHaveLength(2)
      const [first] = catalog.scripts
      expect(first!.name).toBe('Test script')
      expect(first!.version).toBe('1.0.0')
      expect(first!.match).toEqual(['https://example.com/*'])
      expect(first!.size).toBeGreaterThan(0)
      expect(first!.gzip).toBeLessThan(first!.size)
      expect(first!.hash).toMatch(/^[0-9a-f]{64}$/)
      expect(first!.file).toEndWith('.user.js')
      expect(first!.url).toBe(`https://me.dev/us/${first!.slug}.user.js`)
      expect(catalog.scripts[1]!.description).toBe('second')
      expect(JSON.parse(catalogJson(catalog)).scripts).toHaveLength(2)
    } finally {
      await a.cleanup()
      await b.cleanup()
    }
  })

  test('writes catalog.json next to the scripts', async () => {
    const { a, b, scripts } = await buildTwo()
    try {
      const file = await writeCatalog(a.dir, buildCatalog(scripts))
      const json = JSON.parse(await readFile(file, 'utf8')) as { scripts: unknown[] }
      expect(json.scripts).toHaveLength(2)
    } finally {
      await a.cleanup()
      await b.cleanup()
    }
  })
})

describe('pack', () => {
  test('creates a readable zip with scripts, metadata and the catalog', async () => {
    const { a, b, scripts } = await buildTwo()
    try {
      const packed = await packScripts(scripts, { outDir: a.dir, name: 'release.zip' })
      expect(packed.file).toBe(join(a.dir, 'release.zip'))
      expect(packed.entries).toEqual([
        `${scripts[0]!.slug}.user.js`,
        `${scripts[0]!.slug}.meta.json`,
        `${scripts[1]!.slug}.user.js`,
        `${scripts[1]!.slug}.meta.json`,
        'catalog.json'
      ])

      const bytes = await readFile(packed.file)
      expect(bytes.subarray(0, 4).toString('hex')).toBe('504b0304')
      const raw = bytes.toString('latin1')
      expect(raw).toContain('catalog.json')
      expect(raw).toContain(`${scripts[0]!.slug}.user.js`)

      const meta = JSON.parse(metaJson(scripts[0]!)) as { slug: string; hash: string; version: string }
      expect(meta.slug).toBe(scripts[0]!.slug)
      expect(meta.version).toBe('1.0.0')
      expect(meta.hash).toBe(scripts[0]!.hash)
    } finally {
      await a.cleanup()
      await b.cleanup()
    }
  })

  test('refuses to pack nothing', async () => {
    await expect(packScripts([])).rejects.toThrow(/nothing to pack/)
  })
})
