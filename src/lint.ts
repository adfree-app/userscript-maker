import type { UserScriptMeta } from './types'
import { SEMVER_RE } from './version'

export type LintLevel = 'error' | 'warn'

export interface LintIssue {
  level: LintLevel
  /** Stable rule id, e.g. `grant-missing`. */
  code: string
  message: string
}

export interface LintContext {
  meta: UserScriptMeta
  /** The bundled body — what will actually run. */
  body: string
  /** The userscript source (metadata + body). */
  source?: string
  /** Metadata warnings produced by the header renderer. */
  headerWarnings?: string[]
  /** Maximum body size in bytes. */
  budget?: number
}

const RUN_AT = new Set([
  'document-start',
  'document-body',
  'document-end',
  'document-idle',
  'document-ready',
  'context-menu'
])

const MATCH_SCHEMES = new Set(['*', 'http', 'https', 'file', 'ftp', 'urn', 'ws', 'wss'])

/** Chrome-style match pattern, plus `<all_urls>`. */
export function isValidMatchPattern(pattern: string): boolean {
  if (pattern === '<all_urls>') return true
  const match = /^([a-z*]+):\/\/([^/]*)(\/.*)$/i.exec(pattern)
  if (!match) return false
  const scheme = match[1]!.toLowerCase()
  const host = match[2]!
  if (!MATCH_SCHEMES.has(scheme)) return false
  if (scheme === 'file' || scheme === 'urn') return host === ''
  if (host === '*') return true
  if (host.startsWith('*.')) return /^\*\.[^*/]+$/.test(host)
  return host.length > 0 && /^[^*/\s]+$/.test(host)
}

/** `GM.setValue` / `GM_setValue` → `setvalue` */
function normalizeApi(name: string): string {
  return name.replace(/^gm[._]/i, '').toLowerCase()
}

function asList(value: string | string[] | undefined): string[] {
  if (!value) return []
  const list = Array.isArray(value) ? value : value.split(/[,\s]+/)
  return list.map(item => item.trim()).filter(Boolean)
}

/** GM APIs the bundled body actually calls, normalized. */
export function usedGmApis(body: string): Set<string> {
  const used = new Set<string>()
  for (const match of body.matchAll(/\bGM[._]([A-Za-z][\w]*)/g)) {
    const name = normalizeApi(match[1]!)
    if (name === 'info') continue
    used.add(name)
  }
  return used
}

/** Declared `@grant` names, normalized (skips `none`). */
export function grantedGmApis(meta: UserScriptMeta): Set<string> {
  const grants = new Set<string>()
  for (const grant of asList(meta.grant)) {
    if (grant.toLowerCase() === 'none') continue
    grants.add(normalizeApi(grant))
  }
  return grants
}

/**
 * Flags `el.innerHTML = …` unless the right-hand side is one complete string
 * literal: a variable, a call, a template with `${}` or a `+` concatenation are
 * all injection risks.
 */
export function riskyHtmlAssignment(text: string): boolean {
  for (const match of text.matchAll(/\.(?:inner|outer)HTML\s*=\s*/g)) {
    const rest = text.slice((match.index ?? 0) + match[0].length)
    if (!isCompleteStringLiteral(rest)) return true
  }
  return false
}

function isCompleteStringLiteral(text: string): boolean {
  const quote = text[0]
  if (quote !== "'" && quote !== '"' && quote !== '`') return false

  let index = 1
  while (index < text.length) {
    const char = text[index]
    if (char === '\\') {
      index += 2
      continue
    }
    if (quote === '`' && char === '$' && text[index + 1] === '{') return false
    if (char === quote) break
    index++
  }
  if (index >= text.length) return false

  // Nothing may follow the literal except a separator / closing token.
  const next = /^[ \t]*([^\s])/.exec(text.slice(index + 1))?.[1]
  if (next === undefined) return true
  return next === ';' || next === ',' || next === ')' || next === '}' || next === '\n'
}

export function lintScript({ meta, body, source, headerWarnings = [], budget }: LintContext): LintIssue[] {
  const issues: LintIssue[] = []
  const error = (code: string, message: string) => issues.push({ level: 'error', code, message })
  const warn = (code: string, message: string) => issues.push({ level: 'warn', code, message })

  for (const warning of headerWarnings) warn('header', warning)

  if (!meta.name) error('meta-name', '`name` is required')
  if (!meta.version) warn('meta-version', 'no `version` — set one so updates are detected')
  else if (!SEMVER_RE.test(String(meta.version))) {
    warn('meta-version', `\`version\` "${meta.version}" is not semver (use 1.2.3)`)
  }
  if (!meta.namespace) warn('meta-namespace', 'no `namespace` — scripts with the same name may collide')

  if (meta.runAt && !RUN_AT.has(meta.runAt)) {
    error('meta-runat', `\`runAt: "${meta.runAt}"\` is not a valid value (${[...RUN_AT].join(', ')})`)
  }

  const matches = asList(meta.match)
  const includes = asList(meta.include)
  if (matches.length === 0 && includes.length === 0) {
    warn('match-missing', 'no `match`/`include` — the script will never run')
  }
  for (const pattern of matches) {
    if (!isValidMatchPattern(pattern)) {
      error('match-pattern', `\`match: "${pattern}"\` is not a valid match pattern (https://example.com/*)`)
    }
  }

  const used = usedGmApis(body)
  const granted = grantedGmApis(meta)
  const grantsDeclared = asList(meta.grant).length > 0
  const grantsNone = asList(meta.grant).some(grant => grant.toLowerCase() === 'none')

  for (const api of used) {
    if (grantsNone) {
      warn('grant-none', `the body uses GM.${api} but \`grant: "none"\` blocks every GM API`)
      break
    }
    if (!granted.has(api)) {
      warn('grant-missing', `the body calls GM.${api} but no matching \`grant\` is declared`)
    }
  }

  if (grantsDeclared) {
    for (const api of granted) {
      if (api === 'unsafewindow') continue
      if (!used.has(api)) warn('grant-unused', `\`grant\` declares ${api} but the body never uses it`)
    }
  }

  if (/\bunsafeWindow\b/.test(body) && !granted.has('unsafewindow')) {
    warn('grant-unsafe-window', '`unsafeWindow` is used without `grant: "unsafeWindow"`')
  }

  if (granted.has('xmlhttprequest') && asList(meta.connect).length === 0) {
    warn('connect-missing', '`GM_xmlhttpRequest` is granted but no `connect` host is declared')
  }

  for (const [code, pattern, message] of [
    ['risky-eval', /\beval\s*\(/, '`eval()` is blocked by most pages and reviewers'],
    ['risky-function', /\bnew\s+Function\s*\(/, '`new Function()` is blocked by many CSPs'],
    ['risky-document-write', /\bdocument\.write(?:ln)?\s*\(/, '`document.write()` breaks on modern pages']
  ] as const) {
    if (pattern.test(body) || (source !== undefined && pattern.test(source))) warn(code, message)
  }

  if (riskyHtmlAssignment(body) || (source !== undefined && riskyHtmlAssignment(source))) {
    warn(
      'risky-innerhtml',
      'assigning a dynamic string to innerHTML is an injection risk — build nodes instead'
    )
  }

  if (budget && budget > 0) {
    const size = Buffer.byteLength(body)
    if (size > budget) error('budget', `body is ${size} bytes, over the ${budget} byte budget`)
  }

  return issues
}

/** True when at least one issue blocks a release. */
export function hasErrors(issues: LintIssue[]): boolean {
  return issues.some(issue => issue.level === 'error')
}
