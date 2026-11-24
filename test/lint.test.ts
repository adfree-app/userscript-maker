import { describe, expect, test } from 'bun:test'
import { grantedGmApis, hasErrors, isValidMatchPattern, lintScript, usedGmApis } from '../src/lint.ts'

const riskyHtml = (body: string): boolean =>
  lintScript({
    meta: { name: 'x', version: '1.0.0', namespace: 'https://e.com', match: 'https://e.com/*' },
    body
  }).some(issue => issue.code === 'risky-innerhtml')

describe('isValidMatchPattern', () => {
  test('accepts chrome patterns', () => {
    for (const pattern of [
      'https://example.com/*',
      'https://*.example.com/path*',
      '*://*/*',
      'http://localhost:3000/*',
      '<all_urls>',
      'file:///*'
    ]) {
      expect(isValidMatchPattern(pattern)).toBe(true)
    }
  })

  test('rejects broken patterns', () => {
    for (const pattern of [
      'example.com',
      'https://',
      'https://exa mple.com/*',
      'ftp:/nope',
      'chrome://x/*'
    ]) {
      expect(isValidMatchPattern(pattern)).toBe(false)
    }
  })
})

describe('usedGmApis / grantedGmApis', () => {
  test('normalizes both spellings', () => {
    const body = 'GM.setValue(1); GM_getValue("a"); GM.xmlHttpRequest({}); GM.info'
    expect([...usedGmApis(body)].toSorted()).toEqual(['getvalue', 'setvalue', 'xmlhttprequest'])
    expect(
      [...grantedGmApis({ name: 'x', grant: ['GM.setValue', 'GM_getValue', 'none'] })].toSorted()
    ).toEqual(['getvalue', 'setvalue'])
  })
})

describe('lintScript', () => {
  const base = { name: 'x', version: '1.0.0', namespace: 'https://e.com', match: 'https://e.com/*' }

  test('clean script has no issues', () => {
    expect(lintScript({ meta: base, body: 'console.log(1)' })).toEqual([])
  })

  test('reports a missing grant', () => {
    const issues = lintScript({ meta: { ...base, grant: 'none' }, body: 'GM.setValue("a", 1)' })
    expect(issues.map(i => i.code)).toContain('grant-none')
  })

  test('reports a used-but-ungranted API', () => {
    const issues = lintScript({ meta: { ...base, grant: ['GM.getValue'] }, body: 'GM.setValue("a", 1)' })
    expect(issues.some(i => i.code === 'grant-missing')).toBe(true)
  })

  test('reports unused grants', () => {
    const issues = lintScript({ meta: { ...base, grant: ['GM.getValue'] }, body: 'console.log(1)' })
    expect(issues.some(i => i.code === 'grant-unused')).toBe(true)
  })

  test('warns about GM_xmlhttpRequest without connect', () => {
    const issues = lintScript({
      meta: { ...base, grant: ['GM.xmlHttpRequest'] },
      body: 'GM.xmlHttpRequest({ url: "https://api.example.com" })'
    })
    expect(issues.some(i => i.code === 'connect-missing')).toBe(true)
  })

  test('flags an invalid runAt and match pattern as errors', () => {
    const issues = lintScript({
      meta: { ...base, runAt: 'document-nope' as never, match: 'nope' },
      body: ''
    })
    expect(
      issues
        .filter(i => i.level === 'error')
        .map(i => i.code)
        .toSorted()
    ).toEqual(['match-pattern', 'meta-runat'])
    expect(hasErrors(issues)).toBe(true)
  })

  test('warns when no match is set', () => {
    const issues = lintScript({ meta: { name: 'x' }, body: '' })
    expect(issues.some(i => i.code === 'match-missing')).toBe(true)
  })

  test('warns about unsafeWindow and risky APIs', () => {
    const issues = lintScript({
      meta: { ...base },
      body: 'unsafeWindow.foo = 1; eval("1"); document.write("x"); el.innerHTML = value'
    })
    const codes = issues.map(i => i.code)
    expect(codes).toContain('grant-unsafe-window')
    expect(codes).toContain('risky-eval')
    expect(codes).toContain('risky-document-write')
    expect(codes).toContain('risky-innerhtml')
  })

  test('innerHTML is fine with a complete literal, risky with anything dynamic', () => {
    expect(riskyHtml(`el.innerHTML = 'plain text'`)).toBe(false)
    expect(riskyHtml('el.innerHTML = `<b>static</b>`;')).toBe(false)
    expect(riskyHtml('el.innerHTML = `<b>${value}</b>`')).toBe(true)
    expect(riskyHtml(`el.innerHTML = '<b>' + value + '</b>'`)).toBe(true)
    expect(riskyHtml('el.innerHTML = buildMarkup()')).toBe(true)
  })

  test('enforces the body budget', () => {
    const issues = lintScript({ meta: base, body: 'x'.repeat(500), budget: 100 })
    expect(issues.find(i => i.code === 'budget')?.level).toBe('error')
  })

  test('forwards header warnings', () => {
    const issues = lintScript({ meta: base, body: '', headerWarnings: ['no `version`'] })
    expect(issues.some(i => i.code === 'header')).toBe(true)
  })
})
