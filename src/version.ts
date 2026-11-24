import { existsSync } from 'node:fs'
import { dirname, join, parse } from 'node:path'
import semver from 'semver'

export const SEMVER_RE = /^\d+\.\d+\.\d+(?:[-+][0-9A-Za-z.-]+)?$/

export type BumpKind = 'major' | 'minor' | 'patch'

/** `bumpVersion('1.4.2', 'minor')` → `1.5.0`. Non-semver versions restart at 1.0.0. */
export function bumpVersion(version: string | undefined, kind: BumpKind): string {
  const base = version ? semver.coerce(version) : null
  if (!base) return kind === 'major' ? '1.0.0' : kind === 'minor' ? '0.1.0' : '0.0.1'
  return semver.inc(base.version, kind) ?? base.version
}

/** Walks up from `from` looking for `name`, like editor config discovery. */
export function findUp(name: string, from: string): string | null {
  let dir = from
  const root = parse(from).root

  while (true) {
    const candidate = join(dir, name)
    if (existsSync(candidate)) return candidate
    if (dir === root) return null
    const parent = dirname(dir)
    if (parent === dir) return null
    dir = parent
  }
}

/** `version` field of the closest package.json, if any. */
export async function packageVersion(from: string): Promise<{ version: string; name?: string } | null> {
  const file = findUp('package.json', from)
  if (!file) return null
  try {
    const pkg = (await Bun.file(file).json()) as { version?: string; name?: string }
    if (typeof pkg.version !== 'string' || !pkg.version) return null
    return { version: pkg.version, name: pkg.name }
  } catch {
    return null
  }
}

export interface VersionRewrite {
  source: string
  changed: boolean
  previous?: string
  reason?: string
}

/**
 * Rewrites a literal `version: '1.2.3'` inside the defineMeta object.
 * Returns `changed: false` with a reason when the version is not a literal.
 */
export function rewriteVersionLiteral(
  source: string,
  span: { objectStart: number; objectEnd: number },
  next: string
): VersionRewrite {
  const objectText = source.slice(span.objectStart, span.objectEnd + 1)
  const re = /(\bversion\s*:\s*)(['"`])([^'"`]*)\2/
  const match = re.exec(objectText)
  if (!match) {
    return {
      source,
      changed: false,
      reason: 'no literal `version: "..."` inside defineMeta() — bump it by hand'
    }
  }
  const start = span.objectStart + match.index
  const replaced = `${match[1]}${match[2]}${next}${match[2]}`
  const updated = source.slice(0, start) + replaced + source.slice(start + match[0].length)
  return { source: updated, changed: true, previous: match[3] }
}
