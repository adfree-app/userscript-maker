import { basename, join, resolve } from 'node:path'
import { statSync } from 'node:fs'
import { rm } from 'node:fs/promises'
import { gzipSync } from 'node:zlib'
import type { BunPlugin } from 'bun'
import {
  collectAssets,
  collectCss,
  cssBootstrap,
  externalShim,
  normalizeExternals,
  resourcesModuleSource,
  type ExternalSpec,
  type ResourceFile
} from './assets'
import { applyAutoMeta } from './meta-fill'
import { hasErrors, lintScript, type LintIssue } from './lint'
import { renderHeader } from './header'
import { extractMetaCall, stripMetaCall, type MetaCallSpan } from './parse'
import type { UserScriptMeta } from './types'
import { bumpVersion, rewriteVersionLiteral, type BumpKind } from './version'

const DEFINE_SOURCE = new URL('./define.ts', import.meta.url).pathname
const GM_SOURCE = new URL('./gm.ts', import.meta.url).pathname
const RESOURCES_SOURCE = new URL('./resources.ts', import.meta.url).pathname

const ENTRY_CANDIDATES = ['index.ts', 'index.tsx', 'index.mts', 'index.js', 'index.mjs']

export interface BuildOptions {
  /** Where to write the `.user.js` files. Defaults to `dist`. */
  outDir?: string
  /** Minify the bundled body. */
  minify?: boolean
  /** Emit a source map for the body (`none` by default). */
  sourcemap?: 'none' | 'inline' | 'external'
  /** Don't touch the disk, just build in memory. */
  write?: boolean
  /** Comment placed between the header and the body. */
  banner?: string
  /** Public URL of the folder the `.user.js` files are served from. */
  baseUrl?: string
  /** Force `@version` to come from git tags or package.json. */
  versionFrom?: 'git' | 'package'
  /** Bump the version and write it back into the source before building. */
  bump?: BumpKind
  /** Libraries kept out of the bundle, loaded through `@require`. */
  externals?: Record<string, string | { url: string; global?: string }>
  /** Compile-time constants: `{ __FLAG__: true }`. */
  defines?: Record<string, string | number | boolean>
  /** Inline `index.css`/`style.css` next to the entry (default true). */
  css?: boolean
  /** Inline files from `<script>/assets` (default true). */
  assets?: boolean
  /** Fail the build when lint reports an error. */
  strict?: boolean
  /** Maximum body size in bytes. */
  budget?: number
  /** Development build: sets `__DEV__`, inlines the source map. */
  dev?: boolean
  /** Fallbacks for metadata auto-fill. */
  author?: string
  namespace?: string
}

export interface ScriptStats {
  header: number
  body: number
  total: number
  gzip: number
}

export interface BuiltScript {
  entry: string
  slug: string
  meta: UserScriptMeta
  header: string
  body: string
  /** Final file contents: header + banner + body. */
  code: string
  outputPath?: string
  /** Non-fatal notes from the header renderer and the build itself. */
  warnings: string[]
  /** Lint results (errors + warnings). */
  issues: LintIssue[]
  stats: ScriptStats
  /** sha256 of `code`. */
  hash: string
  /** Metadata fields filled in automatically. */
  auto: string[]
  externals: ExternalSpec[]
  /** Sidecar CSS that was inlined, if any. */
  cssFile?: string
  resources: ResourceFile[]
}

/** Accepts a script directory, a `.ts`/`.js` file, or nothing (cwd). */
export async function resolveEntry(input: string): Promise<string> {
  const path = resolve(input)
  const stat = await statOrNull(path)
  if (!stat) throw new Error(`userscript not found: ${input}`)
  if (stat.isFile()) return path

  for (const candidate of ENTRY_CANDIDATES) {
    const file = join(path, candidate)
    if (await statOrNull(file)) return file
  }
  throw new Error(`${input}: no entry file (looked for ${ENTRY_CANDIDATES.join(', ')})`)
}

async function statOrNull(path: string) {
  try {
    return await Bun.file(path).stat()
  } catch {
    return null
  }
}

function loaderFor(path: string) {
  if (path.endsWith('.tsx')) return 'tsx' as const
  if (path.endsWith('.jsx')) return 'jsx' as const
  if (path.endsWith('.ts') || path.endsWith('.mts') || path.endsWith('.cts')) return 'ts' as const
  return 'js' as const
}

/**
 * Reads the `defineMeta()` object without executing the script body.
 * Handles plain literals first, then TypeScript-only syntax, then a real
 * module import as a last resort.
 */
export async function evaluateMeta(
  entry: string,
  objectText: string,
  /** Everything before the `defineMeta()` call, so module-scope values resolve. */
  prefixSource = ''
): Promise<UserScriptMeta> {
  const literal = `{${objectText}}`

  try {
    return new Function(`return (${literal})`)() as UserScriptMeta
  } catch {
    // TypeScript-only syntax in the literal (`as const`, `satisfies`, ...)
  }

  try {
    const js = new Bun.Transpiler({ loader: 'ts' }).transformSync(`const __meta = (${literal});`)
    return new Function(`${js}\nreturn __meta`)() as UserScriptMeta
  } catch {
    // The literal references something from outside, import it for real.
  }

  // The literal references something declared in the script (a const, an
  // import, …). Import a module made of the leading statements only, so the
  // metadata can be read without running the script body.
  const tempFile = join(dirnameOf(entry), `.userscript-meta-${process.pid}-${Date.now()}.ts`)
  await Bun.write(tempFile, `${prefixSource}\nexport default (${literal})\n`)
  try {
    const mod = (await import(`${tempFile}?t=${Date.now()}`)) as { default: UserScriptMeta }
    return mod.default
  } catch (error) {
    throw new Error(
      `could not read the metadata of ${basename(entry)}.\n` +
        'Keep the defineMeta() argument a literal object, or use constants declared above it.\n' +
        `\n${String((error as Error).message ?? error)}`,
      { cause: error }
    )
  } finally {
    await rm(tempFile, { force: true })
  }
}

function dirnameOf(path: string): string {
  return resolve(path, '..')
}

interface BuildLogEntry {
  message: string
  position?: { file: string; line: number; column: number } | null
}

function formatLogs(logs: BuildLogEntry[]): string {
  return logs
    .map(log => {
      const where = log.position ? `${log.position.file}:${log.position.line}:${log.position.column} ` : ''
      return `${where}${log.message}`
    })
    .join('\n')
}

function defineExpression(value: string | number | boolean): string {
  if (typeof value === 'string') return JSON.stringify(value)
  return String(value)
}

function buildDefines(meta: UserScriptMeta, options: BuildOptions): Record<string, string> {
  const dev = options.dev ?? false
  const defines: Record<string, string> = {
    __DEV__: String(dev),
    __PROD__: String(!dev),
    __NAME__: defineExpression(meta.name ?? 'userscript'),
    __VERSION__: defineExpression(meta.version ?? '0.0.0'),
    __BUILD_TIME__: defineExpression(new Date().toISOString()),
    __BUILD_HASH__: defineExpression(Math.random().toString(36).slice(2, 10))
  }
  for (const [key, value] of Object.entries(options.defines ?? {})) {
    defines[key] = defineExpression(value)
  }
  return defines
}

export interface BundleInput {
  entry: string
  source: string
  span: MetaCallSpan
  css?: string | null
  resources?: ResourceFile[]
  externals?: ExternalSpec[]
  defines?: Record<string, string>
  options: BuildOptions
}

const IMPORT_STATEMENT = /^[ \t]*import\s+(?:type\s+)?(?:[\s\S]*?from\s*)?['"][^'"\n]+['"][ \t]*;?[ \t]*$/gm

/**
 * Userscripts may use top-level `await`, which an IIFE bundle cannot contain.
 * Imports are hoisted, the rest runs inside an async function.
 */
export function wrapAsync(source: string): string {
  const imports: string[] = []
  const body = source.replace(IMPORT_STATEMENT, statement => {
    imports.push(statement.trim())
    return ''
  })

  return `${imports.join('\n')}\n;(async () => {\n${body}\n})();\n`
}

/** Bundles the (defineMeta-stripped) script to a single browser IIFE. */
export async function bundleBody(input: BundleInput): Promise<string> {
  const { entry, source, span, options } = input
  const resources = input.resources ?? []
  const externals = input.externals ?? []

  const prelude = input.css ? cssBootstrap(input.css) : ''
  const entryContents = wrapAsync(`${prelude}${stripMetaCall(source, span)}`)

  const entryPlugin: BunPlugin = {
    name: 'userscript-maker:entry',
    setup(build) {
      build.onLoad({ filter: /.*/ }, args => {
        if (args.path !== entry) return undefined
        return { contents: entryContents, loader: loaderFor(entry) }
      })
    }
  }

  const resourcesSource = await Bun.file(RESOURCES_SOURCE).text()
  const modules: Record<string, string> = {
    'userscript-maker': await Bun.file(DEFINE_SOURCE).text(),
    'userscript-maker/define': await Bun.file(DEFINE_SOURCE).text(),
    'userscript-maker/gm': await Bun.file(GM_SOURCE).text(),
    'userscript-maker/resources': resourcesModuleSource(resourcesSource, resources)
  }

  const shimPlugin: BunPlugin = {
    name: 'userscript-maker:shim',
    setup(build) {
      // Accept a scoped install too (`@tachibana-shin/userscript-maker`): GitHub Packages
      // requires a scope, and the shim should not care how it was installed.
      build.onResolve({ filter: /^(?:@[^/]+\/)?userscript-maker(\/.*)?$/ }, args => {
        const specifier = args.path.replace(/^@[^/]+\//, '')
        if (!(specifier in modules)) {
          throw new Error(
            `${args.path} is not a userscript-maker module (available: ${Object.keys(modules).join(', ')})`
          )
        }
        return { path: specifier, namespace: 'userscript-maker' }
      })
      build.onLoad({ filter: /.*/, namespace: 'userscript-maker' }, args => {
        const contents = modules[args.path]
        if (contents === undefined) return undefined
        return { contents, loader: 'ts' }
      })
    }
  }

  const result = await Bun.build({
    entrypoints: [entry],
    target: 'browser',
    format: 'iife',
    minify: options.minify ?? false,
    sourcemap: options.sourcemap ?? 'none',
    external: externals.map(e => e.spec),
    define: input.defines ?? { 'process.env.NODE_ENV': '"production"' },
    plugins: [entryPlugin, shimPlugin]
  })

  if (!result.success) {
    throw new Error(`bundling failed for ${basename(entry)}\n${formatLogs(result.logs)}`)
  }

  const chunk = result.outputs.find(o => o.kind === 'entry-point') ?? result.outputs[0]
  if (!chunk) throw new Error(`bundler produced no output for ${basename(entry)}`)

  const body = (await chunk.text()).trimStart()
  return `${externalShim(externals)}${body}`
}

function textStats(body: string, header: string, code: string): ScriptStats {
  const total = Buffer.byteLength(code)
  return {
    header: Buffer.byteLength(header),
    body: Buffer.byteLength(body),
    total,
    gzip: gzipSync(code).byteLength
  }
}

function sha256(text: string): string {
  return new Bun.CryptoHasher('sha256').update(text).digest('hex')
}

function asList(value: string | string[] | undefined): string[] {
  if (!value) return []
  return Array.isArray(value) ? [...value] : [value]
}

/** True when the source imports `spec` statically or dynamically. */
export function usesSpecifier(source: string, spec: string): boolean {
  const escaped = spec.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  const pattern = new RegExp(`(?:from\\s*|import\\s*\\(\\s*|require\\s*\\(\\s*)['"]${escaped}['"]`)
  return pattern.test(source)
}

/** Compiles one userscript source (file or directory) into a `.user.js`. */
export async function buildScript(input: string, options: BuildOptions = {}): Promise<BuiltScript> {
  const entry = await resolveEntry(input)
  const slug = slugFor(input, entry)
  const warnings: string[] = []

  let source = await Bun.file(entry).text()
  let span = extractMetaCall(source, entry)
  let meta = await evaluateMeta(entry, span.objectText, source.slice(0, span.start))

  if (options.bump) {
    const next = bumpVersion(meta.version, options.bump)
    const rewrite = rewriteVersionLiteral(source, span, next)
    if (!rewrite.changed) {
      warnings.push(rewrite.reason ?? 'could not bump the version')
    } else {
      source = rewrite.source
      await Bun.write(entry, source)
      span = extractMetaCall(source, entry)
      meta = await evaluateMeta(entry, span.objectText, source.slice(0, span.start))
      warnings.push(`version ${rewrite.previous ?? '?'} → ${next} (written back to ${basename(entry)})`)
    }
  }

  const css = options.css === false ? null : await collectCss(entry, slug)
  const resources = options.assets === false ? [] : await collectAssets(entry)
  // Only externals the script actually imports get a @require line and the shim.
  const externals = normalizeExternals(options.externals).filter(external =>
    usesSpecifier(source, external.spec)
  )

  const grants = asList(meta.grant)
  if (css && !grants.some(g => /^gm[._]addstyle$/i.test(g))) {
    grants.push('GM_addStyle')
    meta = { ...meta, grant: grants }
    warnings.push(`${css.file.split('/').pop()} inlined — added \`grant: "GM_addStyle"\``)
  }
  if (externals.length > 0) {
    const require = asList(meta.require)
    for (const external of externals) {
      if (!require.includes(external.url)) require.push(external.url)
    }
    meta = { ...meta, require }
  }

  const auto = await applyAutoMeta(meta, {
    entry,
    slug,
    baseUrl: options.baseUrl,
    versionFrom: options.versionFrom,
    author: options.author,
    namespace: options.namespace
  })
  meta = auto.meta

  const defines = buildDefines(meta, options)
  const body = await bundleBody({
    entry,
    source,
    span,
    css: css?.css,
    resources,
    externals,
    defines,
    options: options.dev ? { ...options, sourcemap: options.sourcemap ?? 'inline' } : options
  })

  const rendered = renderHeader(meta)
  const issues = lintScript({
    meta,
    body,
    source,
    headerWarnings: rendered.warnings,
    budget: options.budget
  })

  const banner = options.banner ? `${options.banner.trimEnd()}\n\n` : ''
  const code = `${rendered.header}\n${banner}${body}\n`
  const stats = textStats(body, rendered.header, code)

  if (options.strict && hasErrors(issues)) {
    const messages = issues
      .filter(issue => issue.level === 'error')
      .map(issue => `  [${issue.code}] ${issue.message}`)
      .join('\n')
    throw new Error(`${slug}: lint failed\n${messages}`)
  }

  const outDir = resolve(options.outDir ?? 'dist')
  const outputPath = join(outDir, `${slug}.user.js`)
  if (options.write !== false) await Bun.write(outputPath, code)

  return {
    entry,
    slug,
    meta,
    header: rendered.header,
    body,
    code,
    outputPath: options.write === false ? undefined : outputPath,
    warnings: [...warnings, ...rendered.warnings],
    issues,
    stats,
    hash: sha256(code),
    auto: auto.notes,
    externals,
    cssFile: css?.file,
    resources
  }
}

/**
 * Script file names: `dir/index.ts` → `dir`, `foo.user.ts` → `foo`,
 * `bar.ts` → `bar`.
 */
export function slugFor(input: string, entry: string): string {
  let isDir = false
  try {
    isDir = statSync(resolve(input)).isDirectory()
  } catch {
    // not on disk yet — treat it as a file name
  }
  const base = isDir
    ? basename(resolve(input))
    : basename(entry).replace(/\.(ts|tsx|mts|cts|js|jsx|mjs|cjs)$/, '')
  return base.replace(/\.user$/, '')
}

/** Builds every given script, in order. */
export async function buildMany(inputs: string[], options: BuildOptions = {}): Promise<BuiltScript[]> {
  const built: BuiltScript[] = []
  for (const input of inputs) {
    built.push(await buildScript(input, options))
  }
  return built
}

export { extractMetaCall, renderHeader }
export type { UserScriptMeta }
export { defineMeta } from './define'
