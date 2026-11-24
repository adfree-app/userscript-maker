import { describe, expect, test } from 'bun:test'
import { join } from 'node:path'
import { buildScript } from '../src/build.ts'
import { metaBlock, makeScript } from './helpers.ts'

const FIXTURES = join(import.meta.dir, 'fixtures')

/** `// @grant      GM_xmlhttpRequest` — one header line per value. */
function headerLine(header: string, field: string): string[] {
  return header
    .split('\n')
    .filter(line => line.startsWith(`// @${field} `))
    .map(line => line.replace(/^\/\/ @[a-z0-9]+ +/i, '').trim())
}

describe('grants and @connect survive the build', () => {
  test('keeps GM_xmlhttpRequest and @connect verbatim', async () => {
    const script = await buildScript(join(FIXTURES, 'github-stars'), { write: false })

    expect(headerLine(script.header, 'grant')).toEqual(['GM_xmlhttpRequest'])
    expect(headerLine(script.header, 'connect')).toEqual(['api.github.com'])
    // the call itself is still in the body and the metadata agrees with it
    expect(script.body).toContain('GM_xmlhttpRequest')
    expect(script.issues.filter(issue => issue.code.startsWith('grant-'))).toHaveLength(0)
    expect(script.issues.map(issue => issue.code)).not.toContain('connect-missing')
  })

  test('keeps several @connect hosts and the modern GM.xmlHttpRequest grant', async () => {
    const dir = await makeScript({
      'index.ts': `${metaBlock(`, connect: ['api.github.com', '*.githubusercontent.com'], grant: ['GM.xmlHttpRequest']`)}
const response = await GM.xmlHttpRequest({ method: 'GET', url: 'https://api.github.com/rate_limit' })
console.log(response.status)
`
    })
    try {
      const script = await buildScript(dir.dir, { write: false })
      expect(headerLine(script.header, 'grant')).toEqual(['GM.xmlHttpRequest'])
      expect(headerLine(script.header, 'connect')).toEqual(['api.github.com', '*.githubusercontent.com'])
      expect(script.issues.map(issue => issue.code)).not.toContain('grant-missing')
      expect(script.issues.map(issue => issue.code)).not.toContain('connect-missing')
    } finally {
      await dir.cleanup()
    }
  })

  test('still warns when the grant or connect host is missing', async () => {
    const dir = await makeScript({
      'index.ts': `${metaBlock()}
GM.xmlHttpRequest({ method: 'GET', url: 'https://api.github.com/rate_limit' })
`
    })
    try {
      const script = await buildScript(dir.dir, { write: false })
      const codes = script.issues.map(issue => issue.code)
      expect(codes).toContain('grant-missing')
      expect(codes).not.toContain('connect-missing')
    } finally {
      await dir.cleanup()
    }
  })
})
