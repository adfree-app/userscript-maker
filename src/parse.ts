/**
 * Source-level helpers: find the `defineMeta({ ... })` call without running the
 * script, and swap it out for the plain object literal.
 */

export interface MetaCallSpan {
  /** Index of the `defineMeta` identifier. */
  start: number
  /** Index just after the closing `)`. */
  end: number
  /** Object literal text, without the surrounding braces. */
  objectText: string
  /** Index of the opening `{` of the object literal. */
  objectStart: number
  /** Index of the closing `}` of the object literal. */
  objectEnd: number
  /** 1-based line of the `defineMeta` identifier. */
  line: number
}

const IDENT_CHAR = /[\w$]/
const REGEX_PRECEDERS = new Set([
  '',
  '(',
  ',',
  '=',
  ':',
  '[',
  '!',
  '&',
  '|',
  '?',
  '{',
  '}',
  ';',
  '+',
  '-',
  '*',
  '/',
  '%',
  '~',
  '^',
  '<',
  '>',
  '\n'
])

/**
 * Bitmap of the positions that are real code (1) rather than comments,
 * strings, template text or regex literals (0).
 */
export function codeMask(source: string): Uint8Array {
  const n = source.length
  const mask = new Uint8Array(n)
  let i = 0
  let mode: 'code' | 'line' | 'block' | 'single' | 'double' | 'template' = 'code'
  let prev = ''
  /** Brace depth of the `${ ... }` expressions we are inside of. */
  const templateStack: number[] = []

  while (i < n) {
    const c = source[i]!
    const next = source[i + 1]

    if (mode === 'line') {
      if (c === '\n') mode = 'code'
      i++
      continue
    }

    if (mode === 'block') {
      if (c === '*' && next === '/') {
        i += 2
        mode = 'code'
        continue
      }
      i++
      continue
    }

    if (mode === 'single' || mode === 'double') {
      if (c === '\\') {
        i += 2
        continue
      }
      if ((mode === 'single' && c === "'") || (mode === 'double' && c === '"')) mode = 'code'
      i++
      continue
    }

    if (mode === 'template') {
      if (c === '\\') {
        i += 2
        continue
      }
      if (c === '`') {
        mode = 'code'
        i++
        continue
      }
      if (c === '$' && next === '{') {
        templateStack.push(0)
        mode = 'code'
        i += 2
        continue
      }
      i++
      continue
    }

    // mode === 'code'
    if (c === '/' && next === '/') {
      mode = 'line'
      i += 2
      continue
    }
    if (c === '/' && next === '*') {
      mode = 'block'
      i += 2
      continue
    }
    if (c === "'") {
      mode = 'single'
      i++
      continue
    }
    if (c === '"') {
      mode = 'double'
      i++
      continue
    }
    if (c === '`') {
      mode = 'template'
      i++
      continue
    }
    if (c === '/' && REGEX_PRECEDERS.has(prev)) {
      // Regex literal: skip to the closing slash, honouring escapes and classes.
      i++
      let inClass = false
      while (i < n) {
        const d = source[i]!
        if (d === '\\') {
          i += 2
          continue
        }
        if (d === '[') inClass = true
        else if (d === ']') inClass = false
        else if (d === '/' && !inClass) {
          i++
          break
        } else if (d === '\n') break
        i++
      }
      prev = '/'
      continue
    }

    if (templateStack.length > 0) {
      const top = templateStack.length - 1
      if (c === '{') {
        templateStack[top] = templateStack[top]! + 1
      } else if (c === '}') {
        if (templateStack[top] === 0) {
          templateStack.pop()
          mode = 'template'
          i++
          continue
        }
        templateStack[top] = templateStack[top]! - 1
      }
    }

    mask[i] = 1
    if (c !== ' ' && c !== '\t' && c !== '\r') prev = c
    i++
  }

  return mask
}

function skipSpace(source: string, mask: Uint8Array, from: number): number {
  let i = from
  while (i < source.length) {
    const c = source[i]!
    if (mask[i] === 1 && c !== ' ' && c !== '\t' && c !== '\r' && c !== '\n') return i
    i++
  }
  return i
}

function matchPair(source: string, mask: Uint8Array, open: number, opening: string, closing: string): number {
  let depth = 0
  for (let i = open; i < source.length; i++) {
    if (mask[i] !== 1) continue
    const c = source[i]
    if (c === opening) depth++
    else if (c === closing) {
      depth--
      if (depth === 0) return i
    }
  }
  return -1
}

function lineOf(source: string, index: number): number {
  let line = 1
  for (let i = 0; i < index; i++) if (source.charCodeAt(i) === 10) line++
  return line
}

/**
 * Locates the `defineMeta({ ... })` call of a userscript source file.
 * Throws a readable error when the call is missing or malformed.
 */
export function extractMetaCall(source: string, file = 'script'): MetaCallSpan {
  const mask = codeMask(source)
  const needle = 'defineMeta'
  const errorAt = (line: number, message: string): Error => new Error(`${file}:${line}\n${message}`)

  for (let i = source.indexOf(needle); i !== -1; i = source.indexOf(needle, i + 1)) {
    if (mask[i] !== 1) continue
    const after = source[i + needle.length]
    if (after && IDENT_CHAR.test(after)) continue
    const before = i === 0 ? '' : source[i - 1]!
    if (before && (IDENT_CHAR.test(before) || before === '.')) continue

    const open = skipSpace(source, mask, i + needle.length)
    // Some other use of the name (`import { defineMeta }`, an object key, a
    // `.defineMeta` method, …) — only a call expression is interesting.
    if (source[open] !== '(' || mask[open] !== 1) continue

    const close = matchPair(source, mask, open, '(', ')')
    if (close === -1) throw errorAt(lineOf(source, i), '`defineMeta(` is never closed — missing `)`?')

    const objectStart = skipSpace(source, mask, open + 1)
    if (source[objectStart] !== '{' || mask[objectStart] !== 1) {
      throw errorAt(
        lineOf(source, i),
        '`defineMeta()` must receive a plain object literal, e.g. `defineMeta({ name: "x", version: "1.0.0" })`.'
      )
    }
    const objectEnd = matchPair(source, mask, objectStart, '{', '}')
    if (objectEnd === -1 || objectEnd > close) {
      throw errorAt(lineOf(source, i), 'the object passed to `defineMeta()` is never closed — missing `}`?')
    }

    return {
      start: i,
      end: close + 1,
      objectText: source.slice(objectStart + 1, objectEnd),
      objectStart,
      objectEnd,
      line: lineOf(source, i)
    }
  }

  throw new Error(
    `${file}\nNo \`defineMeta({ ... })\` call found.\nEvery userscript must start with one, e.g.\n\n  defineMeta({ name: "My script", version: "1.0.0" })\n`
  )
}

/** Replaces the `defineMeta(...)` call with the bare object literal it wraps. */
export function stripMetaCall(source: string, span: MetaCallSpan): string {
  const literal = `(${source.slice(span.objectStart, span.objectEnd + 1)})`
  return source.slice(0, span.start) + literal + source.slice(span.end)
}
