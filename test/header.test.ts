import { describe, expect, test } from 'bun:test'
import { renderHeader } from '../src/header.ts'

describe('renderHeader', () => {
  test('emits the markers and ordered fields', () => {
    const { header, lines } = renderHeader({
      name: 'Demo',
      namespace: 'https://example.com/',
      version: '1.0.0',
      description: 'does things',
      match: ['https://a.com/*', 'https://b.com/*'],
      grant: ['GM.setValue'],
      runAt: 'document-start',
      noframes: true
    })

    expect(lines.some(l => l.startsWith('@name '))).toBe(true)
    expect(lines.filter(l => l.startsWith('@match'))).toHaveLength(2)
    expect(lines).toContain('@noframes')
    expect(lines.some(l => l.startsWith('@run-at') && l.includes('document-start'))).toBe(true)

    // name comes before match, match before run-at
    const indexOf = (needle: string) => lines.findIndex(l => l.startsWith(needle))
    expect(indexOf('@name')).toBeLessThan(indexOf('@match'))
    expect(indexOf('@match')).toBeLessThan(indexOf('@run-at'))

    expect(header.startsWith('// ==UserScript==\n')).toBe(true)
    expect(header.endsWith('// ==/UserScript==\n')).toBe(true)
  })

  test('skips false flags and empty values', () => {
    const { lines } = renderHeader({ name: 'Demo', noframes: false, description: '' })
    expect(lines).toHaveLength(1)
    expect(lines[0]!.startsWith('@name')).toBe(true)
  })

  test('collapses newlines so the header stays valid', () => {
    const { lines } = renderHeader({ name: 'Demo', description: 'line one\nline two' })
    expect(lines.some(l => l.startsWith('@description') && l.includes('line one line two'))).toBe(true)
  })

  test('supports custom headers', () => {
    const { lines } = renderHeader({ name: 'Demo', custom: { foo: 'bar', flag: true } })
    expect(lines).toContain('@flag')
    expect(lines.some(l => l.startsWith('@foo') && l.includes('bar'))).toBe(true)
  })

  test('warns about unknown fields and missing extras', () => {
    const { warnings } = renderHeader({ name: 'Demo', nonsense: 1 } as never)
    expect(warnings.join('\n')).toContain('unknown metadata field `nonsense`')
    expect(warnings.join('\n')).toContain('no `version`')
  })

  test('requires a name', () => {
    expect(() => renderHeader({} as never)).toThrow(/`name` is required/)
  })
})
