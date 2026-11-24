import { FLAG_KEYS, HEADER_FIELDS, type UserScriptMeta } from './types'

export interface HeaderResult {
  /** Full `// ==UserScript== ... // ==/UserScript==` block, newline-terminated. */
  header: string
  /** The individual `@header` lines, without the surrounding markers. */
  lines: string[]
  /** Non-fatal problems found while rendering. */
  warnings: string[]
}

const OPEN = '// ==UserScript=='
const CLOSE = '// ==/UserScript=='
const MAX_LINE_WIDTH = 28

/** Values are single-line by definition; anything else breaks the header. */
function cleanValue(value: string | number): string {
  return String(value).replace(/\r?\n/g, ' ').replace(/\s+/g, ' ').trim()
}

function toValues(value: unknown): Array<string | number> {
  if (Array.isArray(value)) return value.filter(v => v !== undefined && v !== null) as Array<string | number>
  if (value === undefined || value === null) return []
  return [value as string | number]
}

export function renderHeader(meta: UserScriptMeta): HeaderResult {
  const warnings: string[] = []
  const lines: string[] = []

  if (!meta || typeof meta !== 'object') {
    throw new Error('defineMeta() must be called with an object literal')
  }
  if (!meta.name || typeof meta.name !== 'string') {
    throw new Error('defineMeta(): `name` is required and must be a string')
  }
  if (!meta.version) {
    warnings.push('no `version` given — script managers will treat the script as 0.0.0')
  }
  if (!meta.namespace) {
    warnings.push('no `namespace` given — updates may collide with other scripts of the same name')
  }

  const known = new Set<string>(HEADER_FIELDS.map(f => f.key))
  for (const key of Object.keys(meta)) {
    if (key === 'custom') continue
    if (!known.has(key)) warnings.push(`unknown metadata field \`${key}\` was ignored`)
  }

  const push = (header: string, value: string | number): void => {
    const text = cleanValue(value)
    if (text === '') return
    lines.push(`${header}${' '.repeat(Math.max(1, MAX_LINE_WIDTH - header.length))}${text}`)
  }

  for (const { key, header } of HEADER_FIELDS) {
    const value = (meta as unknown as Record<string, unknown>)[key]
    if (value === undefined || value === null) continue

    if (FLAG_KEYS.has(key)) {
      if (value === true) lines.push(header)
      continue
    }

    if (typeof value === 'boolean') {
      warnings.push(`field \`${key}\` is a boolean but not a flag — skipped`)
      continue
    }

    for (const item of toValues(value)) push(header, item)
  }

  if (meta.custom) {
    for (const [rawKey, rawValue] of Object.entries(meta.custom)) {
      const header = `@${rawKey.replace(/^@/, '')}`
      if (rawValue === true) {
        lines.push(header)
        continue
      }
      if (rawValue === false) continue
      for (const item of toValues(rawValue)) push(header, item)
    }
  }

  const width = Math.max(MAX_LINE_WIDTH + 2, ...lines.map(l => l.length))
  const padded = lines.map(l => `// ${l.length < width ? l.padEnd(width).trimEnd() : l}`)
  const header = [OPEN, ...padded, CLOSE].join('\n') + '\n'
  return { header, lines, warnings }
}
