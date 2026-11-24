import { describe, expect, test } from 'bun:test'
import { join } from 'node:path'
import { loadConfig, mergeOptions } from '../src/config.ts'
import { makeScript } from './helpers.ts'

describe('loadConfig', () => {
  test('reads userscript.config.ts', async () => {
    const script = await makeScript({
      'userscript.config.ts': `export default {
  outDir: 'build',
  baseUrl: 'https://me.dev/us',
  defines: { __FLAG__: true },
  externals: { lodash: 'https://cdn/lodash.min.js' },
  scripts: ['scripts/*']
}
`
    })
    try {
      const { config, file } = await loadConfig(script.dir)
      expect(file).toBe(join(script.dir, 'userscript.config.ts'))
      expect(config.outDir).toBe('build')
      expect(config.defines).toEqual({ __FLAG__: true })
      expect(config.scripts).toEqual(['scripts/*'])
    } finally {
      await script.cleanup()
    }
  })

  test('reads userscript.config.json', async () => {
    const script = await makeScript({
      'userscript.config.json': JSON.stringify({ minify: true, budget: 2048 })
    })
    try {
      const { config } = await loadConfig(script.dir)
      expect(config.minify).toBe(true)
      expect(config.budget).toBe(2048)
    } finally {
      await script.cleanup()
    }
  })

  test('returns an empty config when there is none', async () => {
    const script = await makeScript({ 'index.ts': '' })
    try {
      const { config, file } = await loadConfig(script.dir)
      expect(config).toEqual({})
      expect(file).toBeUndefined()
    } finally {
      await script.cleanup()
    }
  })
})

describe('mergeOptions', () => {
  test('explicit options win, map fields merge', () => {
    const merged = mergeOptions(
      { baseUrl: 'https://config', defines: { A: 1, B: 2 }, externals: { lodash: 'https://a/lodash.js' } },
      { baseUrl: 'https://cli', defines: { B: 3 }, externals: { dayjs: 'https://a/dayjs.js' } }
    )
    expect(merged.baseUrl).toBe('https://cli')
    expect(merged.defines).toEqual({ A: 1, B: 3 })
    expect(merged.externals).toEqual({ lodash: 'https://a/lodash.js', dayjs: 'https://a/dayjs.js' })
  })
})

describe('mergeOptions undefined handling', () => {
  test('undefined options do not clobber the config', () => {
    const merged = mergeOptions(
      { baseUrl: 'https://config', minify: true },
      { baseUrl: undefined, minify: undefined }
    )
    expect(merged.baseUrl).toBe('https://config')
    expect(merged.minify).toBe(true)
  })
})
