import { describe, expect, test } from 'bun:test'
import { codeMask, extractMetaCall, stripMetaCall } from '../src/parse.ts'

const SRC = `import { defineMeta } from 'userscript-maker'

defineMeta({
  name: 'Demo',
  match: ['https://a.com/*']
})

// body: defineMeta({ name: 'not me' })
const s = "defineMeta({ name: 'string' })"
console.log(s)
`

describe('codeMask', () => {
  test('masks comments and strings', () => {
    const mask = codeMask(SRC)
    const commentAt = SRC.indexOf("defineMeta({ name: 'not me' })")
    expect(mask[commentAt]).toBe(0)
    expect(mask[SRC.indexOf('console.log')]).toBe(1)
  })

  test('does not mask template expression code', () => {
    const src = 'const a = `x ${1 + 2} y`'
    const mask = codeMask(src)
    expect(mask[src.indexOf('1 + 2')]).toBe(1)
  })
})

describe('extractMetaCall', () => {
  test('finds the real call and its object literal', () => {
    const span = extractMetaCall(SRC, 'demo.ts')
    expect(span.line).toBe(3)
    expect(span.objectText).toContain("name: 'Demo'")
    expect(SRC.slice(span.start, span.start + 10)).toBe('defineMeta')
    expect(SRC[span.end - 1]).toBe(')')
  })

  test('ignores defineMeta inside strings and comments', () => {
    const src = `const t = "defineMeta({ name: 'a' })"
// defineMeta({ name: 'b' })
defineMeta({ name: 'real' })
`
    const span = extractMetaCall(src)
    expect(span.objectText).toContain("'real'")
  })

  test('ignores nested object braces', () => {
    const span = extractMetaCall(`defineMeta({ name: 'x', custom: { a: { b: '{' } } })\nconsole.log(1)`)
    expect(span.objectText).toContain("b: '{'")
    expect(span.objectText.trimEnd().endsWith('}')).toBe(true)
  })

  test('handles no trailing semicolon and multiline objects', () => {
    const src = `defineMeta({\n  name: 'multi',\n})\nconst x = 1\n`
    const span = extractMetaCall(src)
    expect(span.objectText).toContain("name: 'multi'")
  })

  test('throws a readable error when the call is missing', () => {
    expect(() => extractMetaCall('console.log(1)', 'bad.ts')).toThrow(/No `defineMeta/)
  })

  test('throws when defineMeta is never called', () => {
    expect(() => extractMetaCall('const defineMeta = 1\nconsole.log(defineMeta)')).toThrow(/No `defineMeta\(/)
  })

  test('throws when the argument is not an object literal', () => {
    expect(() => extractMetaCall('const m = { name: "x" }\ndefineMeta(m)')).toThrow(/plain object literal/)
  })
})

describe('stripMetaCall', () => {
  test('replaces the call with the bare object', () => {
    const span = extractMetaCall(`const meta = defineMeta({ name: 'x' })\nconsole.log(meta.name)`)
    const out = stripMetaCall(`const meta = defineMeta({ name: 'x' })\nconsole.log(meta.name)`, span)
    expect(out).toBe(`const meta = ({ name: 'x' })\nconsole.log(meta.name)`)
  })
})
