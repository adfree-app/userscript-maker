import { dirname } from 'node:path'
import { gitRemoteUrl, gitUserName, gitVersion } from './git'
import type { UserScriptMeta } from './types'
import { packageVersion } from './version'

export interface AutoMetaOptions {
  /** Entry file, used to find git repo / package.json. */
  entry: string
  /** Script name, for derived URLs. */
  slug: string
  /** Where the built `.user.js` files will be hosted. */
  baseUrl?: string
  /** Force `@version` from git tags or the closest package.json. */
  versionFrom?: 'git' | 'package'
  /** Fallbacks from `userscript.config.ts`. */
  author?: string
  namespace?: string
}

export interface AutoMetaResult {
  meta: UserScriptMeta
  /** Human-readable notes about what was filled in automatically. */
  notes: string[]
}

/** Fills the metadata fields that can be derived safely, leaving user values alone. */
export async function applyAutoMeta(meta: UserScriptMeta, options: AutoMetaOptions): Promise<AutoMetaResult> {
  const notes: string[] = []
  const result: UserScriptMeta = { ...meta }
  const dir = dirname(options.entry)
  const base = options.baseUrl ? options.baseUrl.replace(/\/+$/, '') : undefined

  if (options.versionFrom === 'git') {
    const version = await gitVersion(dir)
    if (version && version !== result.version) {
      notes.push(`version ${version} (git)`)
      result.version = version
    }
  } else if (options.versionFrom === 'package') {
    const pkg = await packageVersion(dir)
    if (pkg && pkg.version !== result.version) {
      notes.push(`version ${pkg.version} (package.json)`)
      result.version = pkg.version
    }
  } else if (!result.version) {
    const pkg = await packageVersion(dir)
    const version = pkg?.version ?? (await gitVersion(dir))
    if (version) {
      notes.push(`version ${version} (auto)`)
      result.version = version
    }
  }

  if (!result.author) {
    const author = options.author ?? (await gitUserName(dir))
    if (author) {
      notes.push(`author (auto)`)
      result.author = author
    }
  }

  if (!result.source && !result.homepage && !result.homepageURL) {
    const remote = await gitRemoteUrl(dir)
    if (remote) {
      notes.push('source (git remote)')
      result.source = remote
    }
  }

  if (!result.namespace) {
    const namespace = options.namespace ?? (await gitRemoteUrl(dir))
    if (namespace) {
      result.namespace = `${namespace.replace(/\/+$/, '')}/${options.slug}`
      notes.push(`namespace → ${result.namespace}`)
    }
  }

  if (base) {
    const scriptUrl = `${base}/${options.slug}.user.js`
    if (!result.downloadURL) {
      result.downloadURL = scriptUrl
      notes.push(`downloadURL → ${scriptUrl}`)
    }
    if (!result.updateURL) {
      result.updateURL = scriptUrl
      notes.push(`updateURL → ${scriptUrl}`)
    }
  }

  return { meta: result, notes }
}
