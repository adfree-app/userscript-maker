import { relative, resolve } from 'node:path'
import type { BuiltScript } from './build'

export interface CatalogEntry {
  slug: string
  name: string
  namespace?: string
  version?: string
  description?: string
  author?: string
  license?: string
  homepage?: string
  match: string[]
  include: string[]
  runAt?: string
  grant: string[]
  /** Bytes of the final `.user.js`. */
  size: number
  gzip: number
  /** sha256 of the final file, for integrity checks / update manifests. */
  hash: string
  /** File name inside the dist folder. */
  file: string
  /** Absolute URL when a base URL is configured. */
  url?: string
  /** Lint summary. */
  diagnostics: { errors: number; warnings: number }
  updatedAt: string
}

export interface Catalog {
  /** Not a userscript manager format — just our own manifest version. */
  manifestVersion: 1
  generatedAt: string
  baseUrl?: string
  scripts: CatalogEntry[]
}

function asList(value: string | string[] | undefined): string[] {
  if (!value) return []
  return Array.isArray(value) ? [...value] : [value]
}

export function catalogEntry(built: BuiltScript, baseUrl?: string, now = new Date()): CatalogEntry {
  const meta = built.meta
  const url = baseUrl ? `${baseUrl.replace(/\/+$/, '')}/${built.slug}.user.js` : undefined
  return {
    slug: built.slug,
    name: meta.name,
    namespace: meta.namespace,
    version: meta.version,
    description: meta.description,
    author: meta.author,
    license: meta.license,
    homepage: meta.homepage ?? meta.homepageURL ?? meta.website,
    match: asList(meta.match),
    include: asList(meta.include),
    runAt: meta.runAt,
    grant: asList(meta.grant),
    size: built.stats.total,
    gzip: built.stats.gzip,
    hash: built.hash,
    file: `${built.slug}.user.js`,
    url,
    diagnostics: {
      errors: built.issues.filter(i => i.level === 'error').length,
      warnings: built.issues.filter(i => i.level === 'warn').length
    },
    updatedAt: now.toISOString()
  }
}

export function buildCatalog(
  scripts: BuiltScript[],
  options: { baseUrl?: string; now?: Date } = {}
): Catalog {
  const now = options.now ?? new Date()
  return {
    manifestVersion: 1,
    generatedAt: now.toISOString(),
    baseUrl: options.baseUrl,
    scripts: scripts.map(script => catalogEntry(script, options.baseUrl, now))
  }
}

export function catalogJson(catalog: Catalog): string {
  return `${JSON.stringify(catalog, null, 2)}\n`
}

/** Writes `<outDir>/catalog.json` and returns its path. */
export async function writeCatalog(outDir: string, catalog: Catalog): Promise<string> {
  const file = resolve(outDir, 'catalog.json')
  await Bun.write(file, catalogJson(catalog))
  return file
}

/** Relative path from `from` to a script file, for manifests. */
export function relativeScript(from: string, file: string): string {
  return relative(from, file).split('\\').join('/')
}
