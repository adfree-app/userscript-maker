import { resolve } from 'node:path'
import type { BuiltScript } from './build'
import { buildCatalog, catalogJson } from './catalog'
import { createZip, type ZipEntry } from './zip'

export interface PackOptions {
  outDir?: string
  /** Zip file name inside `outDir`. */
  name?: string
  now?: Date
}

export interface PackResult {
  file: string
  bytes: number
  entries: string[]
}

/** Sidecar metadata for one script: what it is, plus integrity info. */
export function metaJson(script: BuiltScript, now = new Date()): string {
  return `${JSON.stringify(
    {
      slug: script.slug,
      name: script.meta.name,
      namespace: script.meta.namespace,
      version: script.meta.version,
      hash: script.hash,
      size: script.stats.total,
      gzip: script.stats.gzip,
      generatedAt: now.toISOString(),
      meta: script.meta
    },
    null,
    2
  )}\n`
}

function pad2(value: number): string {
  return String(value).padStart(2, '0')
}

function stamp(date: Date): string {
  return `${date.getFullYear()}${pad2(date.getMonth() + 1)}${pad2(date.getDate())}-${pad2(date.getHours())}${pad2(date.getMinutes())}`
}

/**
 * Bundles every built script into one zip, together with per-script
 * `.meta.json` files and a `catalog.json` — ready to attach to a release.
 */
export async function packScripts(scripts: BuiltScript[], options: PackOptions = {}): Promise<PackResult> {
  if (scripts.length === 0) throw new Error('nothing to pack')
  const now = options.now ?? new Date()
  const outDir = resolve(options.outDir ?? 'dist')

  const entries: ZipEntry[] = []
  for (const script of scripts) {
    entries.push({ name: `${script.slug}.user.js`, data: script.code })
    entries.push({ name: `${script.slug}.meta.json`, data: metaJson(script, now) })
  }
  entries.push({
    name: 'catalog.json',
    data: catalogJson(buildCatalog(scripts, { baseUrl: undefined, now }))
  })

  const name = options.name ?? `userscripts-${stamp(now)}.zip`
  const file = resolve(outDir, name)
  const bytes = createZip(entries, now)
  await Bun.write(file, bytes)

  return { file, bytes: bytes.byteLength, entries: entries.map(entry => entry.name) }
}
