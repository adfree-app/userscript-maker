import { existsSync } from 'node:fs'
import { resolve } from 'node:path'
import type { BuildOptions } from './build'

/** Shared defaults, usually kept next to the scripts as `userscript.config.ts`. */
export interface MakerConfig extends Omit<BuildOptions, 'write' | 'bump' | 'dev'> {
  /** Extra directories the CLI should build when no path is given. */
  scripts?: string[]
}

const CANDIDATES = [
  'userscript.config.ts',
  'userscript.config.mts',
  'userscript.config.js',
  'userscript.config.json'
]

export interface LoadedConfig {
  config: MakerConfig
  /** Absolute path of the config file, when one was found. */
  file?: string
}

export async function loadConfig(cwd = process.cwd(), explicit?: string): Promise<LoadedConfig> {
  const candidates = explicit ? [explicit] : CANDIDATES
  for (const candidate of candidates) {
    const file = resolve(cwd, candidate)
    if (!existsSync(file)) continue
    try {
      if (file.endsWith('.json')) {
        return { config: (await Bun.file(file).json()) as MakerConfig, file }
      }
      const mod = (await import(`${file}?t=${Date.now()}`)) as { default?: MakerConfig }
      return { config: mod.default ?? {}, file }
    } catch (error) {
      throw new Error(`could not read ${candidate}: ${String((error as Error).message ?? error)}`, {
        cause: error
      })
    }
  }
  return { config: {} }
}

/** Config file first, then explicit options win. */
export function mergeOptions(config: MakerConfig, options: BuildOptions): BuildOptions {
  const defined = Object.fromEntries(
    Object.entries(options).filter(([, value]) => value !== undefined)
  ) as BuildOptions
  const merged: BuildOptions = { ...config, ...defined }
  if (config.externals || defined.externals) {
    merged.externals = { ...config.externals, ...defined.externals }
  }
  if (config.defines || defined.defines) {
    merged.defines = { ...config.defines, ...defined.defines }
  }
  return merged
}
