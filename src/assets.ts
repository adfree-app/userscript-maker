/** Collects the sidecar files a userscript folder can carry: CSS and assets. */
import { statSync } from 'node:fs'
import { dirname, join, relative, resolve } from 'node:path'
import { lookup } from 'mrmime'

export const RESOURCE_TABLE_KEY = '__USERSCRIPT_MAKER_RESOURCES__'

/** `assets/logo.svg` → `image/svg+xml`; unknown extensions become a binary stream. */
export function mimeFor(path: string): string {
  return lookup(path) ?? 'application/octet-stream'
}

function isDir(path: string): boolean {
  try {
    return statSync(path).isDirectory()
  } catch {
    return false
  }
}

export function scriptDir(entry: string): string {
  return dirname(resolve(entry))
}

/** Walks a folder recursively, returning absolute file paths. */
async function walk(dir: string, out: string[] = []): Promise<string[]> {
  const glob = new Bun.Glob('**/*')
  for await (const file of glob.scan({ cwd: dir, onlyFiles: true, dot: false })) {
    out.push(join(dir, file))
  }
  return out.toSorted()
}

export interface ResourceFile {
  /** Name used at runtime, e.g. `logo.svg` or `icons/a.svg`. */
  name: string
  dataUrl: string
  bytes: number
}

/** Every file under `<script>/assets`, inlined as a data URL. */
export async function collectAssets(entry: string): Promise<ResourceFile[]> {
  const dir = join(scriptDir(entry), 'assets')
  if (!isDir(dir)) return []
  const files = await walk(dir)
  const resources: ResourceFile[] = []
  for (const file of files) {
    const name = relative(dir, file).split('\\').join('/')
    const bytes = await Bun.file(file).arrayBuffer()
    const base64 = Buffer.from(bytes).toString('base64')
    resources.push({
      name,
      dataUrl: `data:${mimeFor(file)};base64,${base64}`,
      bytes: bytes.byteLength
    })
  }
  return resources
}

export interface CssSidecar {
  file: string
  css: string
}

/** `index.css` / `style.css` / `<slug>.css` next to the script. */
export async function collectCss(entry: string, slug: string): Promise<CssSidecar | null> {
  const dir = scriptDir(entry)
  for (const name of [`${slug}.css`, 'index.css', 'style.css']) {
    const file = join(dir, name)
    if (isDir(file)) continue
    try {
      const css = await Bun.file(file).text()
      if (css.trim()) return { file, css: collapse(css) }
    } catch {
      // not there, try the next candidate
    }
  }
  return null
}

function collapse(css: string): string {
  return css
    .replace(/\/\*[\s\S]*?\*\//g, ' ')
    .replace(/\s*\n\s*/g, ' ')
    .replace(/\s{2,}/g, ' ')
    .trim()
}

/**
 * Code prepended to the script body so the sidecar CSS applies.
 * Uses GM_addStyle when the manager provides it, otherwise injects a <style>.
 */
export function cssBootstrap(css: string): string {
  return `;(() => {
  const css = ${JSON.stringify(css)};
  if (typeof GM_addStyle === 'function') { GM_addStyle(css); return; }
  const gm = (globalThis as { GM?: { addStyle?: (c: string) => void } }).GM;
  if (gm?.addStyle) { gm.addStyle(css); return; }
  const style = document.createElement('style');
  style.textContent = css;
  (document.head ?? document.documentElement).appendChild(style);
})();
`
}

/** Module body for `userscript-maker/resources`, with the asset table injected. */
export function resourcesModuleSource(realSource: string, resources: ResourceFile[]): string {
  const table = JSON.stringify(Object.fromEntries(resources.map(r => [r.name, r.dataUrl])))
  return `;(globalThis as Record<string, unknown>)[${JSON.stringify(RESOURCE_TABLE_KEY)}] = ${table};\n${realSource}`
}

export interface ExternalSpec {
  /** Import specifier used in code, e.g. `lodash`. */
  spec: string
  /** URL for the `@require` header. */
  url: string
  /** Global the @require script defines, e.g. `lodash` or `jQuery`. */
  global: string
}

/**
 * Normalizes `--external` input:
 * ```
 * lodash=https://cdn/lodash.min.js
 * lodash=https://cdn/lodash.min.js#_      # explicit global name
 * ```
 */
export function normalizeExternals(
  input?: Record<string, string | { url: string; global?: string }>
): ExternalSpec[] {
  if (!input) return []
  return Object.entries(input).map(([spec, value]) => {
    if (typeof value === 'object') {
      return { spec, url: value.url, global: value.global ?? defaultGlobal(spec) }
    }
    const [url, global] = value.split('#')
    return { spec, url: url ?? value, global: global ?? defaultGlobal(spec) }
  })
}

function defaultGlobal(spec: string): string {
  const bare = spec.replace(/^@[^/]+\//, '')
  const last = bare.split('/').filter(Boolean).pop() ?? spec
  return last.replace(/[^\w$]/g, '')
}

/**
 * `@require`d libraries are globals, not modules. This shim gives the bundler's
 * `require()` calls something to resolve, with a clear error when the user
 * forgot to declare the dependency.
 */
export function externalShim(specs: ExternalSpec[]): string {
  if (specs.length === 0) return ''
  const map = Object.fromEntries(specs.map(s => [s.spec, s.global]))
  return `/* userscript-maker: @require externals */\n(() => {
  const host = globalThis;
  const map = ${JSON.stringify(map)};
  const resolveExternal = (name) => {
    const globalName = map[name];
    const mod = globalName ? host[globalName] : undefined;
    if (mod === undefined) {
      throw new Error('[userscript-maker] external "' + name + '" is not loaded (expected window.' + globalName + ') — check its @require URL');
    }
    return mod;
  };
  host.require = host.require ?? resolveExternal;
})();
`
}
