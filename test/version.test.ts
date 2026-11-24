import { describe, expect, test } from 'bun:test'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { bumpVersion, packageVersion, rewriteVersionLiteral, SEMVER_RE } from '../src/version.ts'
import { normalizeRemoteUrl } from '../src/git.ts'

describe('bumpVersion', () => {
  test('bumps each part', () => {
    expect(bumpVersion('1.2.3', 'patch')).toBe('1.2.4')
    expect(bumpVersion('1.2.3', 'minor')).toBe('1.3.0')
    expect(bumpVersion('1.2.3', 'major')).toBe('2.0.0')
  })

  test('drops prerelease and build metadata', () => {
    expect(bumpVersion('1.2.3-beta.4', 'patch')).toBe('1.2.4')
    expect(bumpVersion('2.0.0+build.7', 'major')).toBe('3.0.0')
  })

  test('recovers from garbage', () => {
    expect(bumpVersion(undefined, 'patch')).toBe('0.0.1')
    expect(bumpVersion('vnext', 'minor')).toBe('0.1.0')
  })
})

describe('SEMVER_RE', () => {
  test('accepts semver, rejects junk', () => {
    expect(SEMVER_RE.test('1.0.0')).toBe(true)
    expect(SEMVER_RE.test('1.0.0-rc.1')).toBe(true)
    expect(SEMVER_RE.test('1.0')).toBe(false)
  })
})

describe('rewriteVersionLiteral', () => {
  const source = `defineMeta({\n  name: 'x',\n  version: '1.2.3'\n})\n`
  const span = { objectStart: source.indexOf('{'), objectEnd: source.lastIndexOf('}') }

  test('replaces the version and keeps the quotes', () => {
    const result = rewriteVersionLiteral(source, span, '1.3.0')
    expect(result.changed).toBe(true)
    expect(result.previous).toBe('1.2.3')
    expect(result.source).toContain("version: '1.3.0'")
  })

  test('works with double quotes and no space', () => {
    const src = `defineMeta({ name: "x", version:"2.0.0" })`
    const result = rewriteVersionLiteral(
      src,
      { objectStart: src.indexOf('{'), objectEnd: src.lastIndexOf('}') },
      '2.0.1'
    )
    expect(result.source).toContain('version:"2.0.1"')
  })

  test('explains when the version is not a literal', () => {
    const src = `defineMeta({ name: 'x', version: VERSION })`
    const result = rewriteVersionLiteral(
      src,
      { objectStart: src.indexOf('{'), objectEnd: src.lastIndexOf('}') },
      '9.9.9'
    )
    expect(result.changed).toBe(false)
    expect(result.reason).toContain('bump it by hand')
  })
})

describe('packageVersion', () => {
  test('reads the closest package.json', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'usm-ver-'))
    try {
      await Bun.write(join(dir, 'package.json'), JSON.stringify({ name: 'x', version: '4.5.6' }))
      const nested = join(dir, 'a', 'b')
      await Bun.write(join(nested, 'index.ts'), '')
      expect(await packageVersion(nested)).toMatchObject({ version: '4.5.6' })
    } finally {
      await rm(dir, { recursive: true, force: true })
    }
  })
})

describe('normalizeRemoteUrl', () => {
  test('handles ssh and https remotes', () => {
    expect(normalizeRemoteUrl('git@github.com:me/repo.git')).toBe('https://github.com/me/repo')
    expect(normalizeRemoteUrl('https://gitlab.com/me/repo.git')).toBe('https://gitlab.com/me/repo')
    expect(normalizeRemoteUrl('https://github.com/me/repo/')).toBe('https://github.com/me/repo')
    expect(normalizeRemoteUrl('')).toBeNull()
  })
})
