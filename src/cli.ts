#!/usr/bin/env bun
import { existsSync, watch } from 'node:fs'
import { join, resolve } from 'node:path'
import { cancel, confirm, intro, isCancel, outro, text as prompt } from '@clack/prompts'
import bytes from 'bytes'
import { Command } from 'commander'
import pc from 'picocolors'
import prettyBytes from 'pretty-bytes'
import { buildScript, resolveEntry, type BuildOptions, type BuiltScript } from './build'
import { buildCatalog, catalogJson, writeCatalog } from './catalog'
import { loadConfig, mergeOptions } from './config'
import { startDevServer } from './dev'
import { hasErrors, type LintIssue } from './lint'
import { packScripts } from './pack'
import type { BumpKind } from './version'

const { dim, green, red, cyan, yellow } = pc

const pkg = (await import('../package.json')) as { version?: string }

const COMMANDS = {
  build: 'bundle every script: header + body → <outDir>/<slug>.user.js',
  check: 'same pipeline, nothing written; exit 1 on lint errors',
  dev: 'build + serve a harness page with a GM mock and live reload',
  catalog: 'build + write <outDir>/catalog.json',
  pack: 'build + one release .zip (scripts, .meta.json, catalog.json)',
  test: 'run `bun test` (extra arguments are forwarded)',
  init: 'scaffold scripts/<name> (interactive in a terminal)'
} as const

type SourcemapMode = 'none' | 'inline' | 'external'

interface BuildArgs {
  inputs: string[]
  outDir: string
  minify: boolean
  sourcemap: SourcemapMode
  watch: boolean
  quiet: boolean
  json: boolean
  banner: boolean
  strict: boolean
  css: boolean | undefined
  assets: boolean | undefined
  baseUrl?: string
  versionFrom?: 'git' | 'package'
  bump?: BumpKind
  defines: Record<string, string | number | boolean>
  externals: Record<string, string>
  budget?: number
  configFile?: string
  port?: number
  host?: string
}

interface RawOptions {
  out?: string
  minify?: boolean
  sourcemap?: string
  baseUrl?: string
  versionFrom?: string
  bump?: string
  define?: string[]
  external?: string[]
  budget?: string
  css?: boolean
  assets?: boolean
  banner?: boolean
  strict?: boolean
  config?: string
  watch?: boolean
  json?: boolean
  quiet?: boolean
  port?: string
  host?: string
  yes?: boolean
}

function parseValue(raw: string): string | number | boolean {
  const trimmed = raw.trim()
  if (trimmed === 'true') return true
  if (trimmed === 'false') return false
  if (trimmed !== '' && !Number.isNaN(Number(trimmed))) return Number(trimmed)
  try {
    const parsed = JSON.parse(trimmed) as unknown
    if (typeof parsed === 'string' || typeof parsed === 'number' || typeof parsed === 'boolean') {
      return parsed
    }
  } catch {
    // plain string
  }
  return trimmed.replace(/^['"]|['"]$/g, '')
}

export function parseSize(raw: string): number {
  const value = bytes.parse(raw)
  if (value === null || Number.isNaN(value)) throw new Error(`invalid size: ${raw}`)
  return value
}

/** Collect a repeatable option (`--define A=1 --define B=2`). */
function collect(value: string, previous: string[] = []): string[] {
  return [...previous, value]
}

/** `key=value` pairs from a repeatable option (`--external lodash=url#_`). */
function pairs(values: string[] = [], flag: string): Record<string, string> {
  const out: Record<string, string> = {}
  for (const value of values) {
    const eq = value.indexOf('=')
    if (eq <= 0) throw new Error(`${flag} expects KEY=VALUE`)
    out[value.slice(0, eq)] = value.slice(eq + 1)
  }
  return out
}

function toArgs(inputs: string[], options: RawOptions): BuildArgs {
  const sourcemap = (options.sourcemap ?? 'none') as SourcemapMode
  if (!['none', 'inline', 'external'].includes(sourcemap)) {
    throw new Error('--sourcemap must be none, inline or external')
  }
  const versionFrom = options.versionFrom
  if (versionFrom && versionFrom !== 'git' && versionFrom !== 'package') {
    throw new Error('--version-from must be git or package')
  }
  const bump = options.bump
  if (bump && bump !== 'patch' && bump !== 'minor' && bump !== 'major') {
    throw new Error('--bump must be patch, minor or major')
  }

  const defines: Record<string, string | number | boolean> = {}
  for (const [key, value] of Object.entries(pairs(options.define, '--define'))) {
    defines[key] = parseValue(value)
  }

  return {
    inputs,
    outDir: options.out ?? 'dist',
    minify: options.minify === true,
    sourcemap,
    watch: options.watch === true,
    quiet: options.quiet === true,
    json: options.json === true,
    // Commander defaults `--no-x` flags to true: only an explicit `--no-x` matters.
    banner: options.banner !== false,
    strict: options.strict === true,
    css: options.css === false ? false : undefined,
    assets: options.assets === false ? false : undefined,
    baseUrl: options.baseUrl,
    versionFrom: versionFrom as 'git' | 'package' | undefined,
    bump: bump as BumpKind | undefined,
    defines,
    externals: pairs(options.external, '--external'),
    budget: options.budget === undefined ? undefined : parseSize(options.budget),
    configFile: options.config,
    port: options.port === undefined ? undefined : Number(options.port),
    host: options.host
  }
}

/** Options shared by every command that builds scripts. */
function buildOptionsOf(command: Command): Command {
  return command
    .option('-o, --out <dir>', 'output directory', 'dist')
    .option('-m, --minify', 'minify the body (the header is never minified)')
    .option('--sourcemap <mode>', 'none | inline | external', 'none')
    .option('--base-url <url>', 'public URL of the dist folder → auto @downloadURL/@updateURL')
    .option('--version-from <source>', 'git | package — take @version from there')
    .option('--bump <kind>', 'patch | minor | major — bump and write back into the source')
    .option('--define <key=value>', 'compile-time constant (repeatable)', collect)
    .option(
      '--external <spec=url[#global]>',
      'keep a library out of the bundle (@require, repeatable)',
      collect
    )
    .option('--budget <size>', 'maximum body size, e.g. 40kb')
    .option('--no-css', 'do not inline the CSS sidecar')
    .option('--no-assets', 'do not inline the assets/ folder')
    .option('--no-banner', 'drop the "built by userscript-maker" line')
    .option('--strict', 'fail on lint warnings too')
    .option('--config <file>', 'config file (default: userscript.config.ts|json)')
    .option('-w, --watch', 'rebuild on change')
    .option('--json', 'machine-readable output for CI')
    .option('-q, --quiet', 'only print problems')
}

function createProgram(run: CommandRunner): Command {
  const program = new Command('userscript-maker')
    .description('Compile TypeScript userscripts into standard .user.js files with Bun.')
    .version(pkg.version ?? '0.0.0', '-v, --version')
    .exitOverride()

  for (const [name, description] of Object.entries(COMMANDS)) {
    if (name === 'test') continue // forwarded to `bun test` before parsing
    if (name === 'init') {
      program
        .command('init [name]', {})
        .description(description)
        .option('-y, --yes', 'skip the prompts, use the defaults')
        .action((slug: string | undefined, options: RawOptions) => {
          run.init(slug, options)
        })
      continue
    }

    const command = buildOptionsOf(program.command(`${name} [inputs...]`).description(description))
    if (name === 'dev') {
      command
        .option('--port <port>', 'harness port (default: 4000)')
        .option('--host <host>', 'harness hostname (default: localhost)')
        .action((inputs: string[], options: RawOptions) => {
          run.build(name, inputs, options)
        })
    } else {
      command.action((inputs: string[], options: RawOptions) => {
        run.build(name, inputs, options)
      })
    }
  }

  return program
}

interface CommandRunner {
  build(command: string, inputs: string[], options: RawOptions): void
  init(name: string | undefined, options: RawOptions): void
}

function formatSize(n: number): string {
  return prettyBytes(n)
}

function printIssues(script: BuiltScript, quiet: boolean): void {
  const rows = script.issues.filter(issue => !quiet || issue.level === 'error')
  for (const issue of rows) {
    const tag = issue.level === 'error' ? red('error') : yellow('warn')
    console.log(`      ${tag} ${dim(issue.code)} ${issue.message}`)
  }
}

function report(script: BuiltScript, args: BuildArgs, command: string): void {
  if (args.json) return
  const version = script.meta.version ? ` ${dim(`v${script.meta.version}`)}` : ''
  const errors = script.issues.filter(i => i.level === 'error').length
  const warnings = script.issues.filter(i => i.level === 'warn').length
  const mark = errors > 0 ? red('fail') : green('ok')
  const extra = [
    formatSize(script.stats.total),
    `gzip ${formatSize(script.stats.gzip)}`,
    errors ? red(`${errors} error${errors > 1 ? 's' : ''}`) : '',
    warnings ? yellow(`${warnings} warning${warnings > 1 ? 's' : ''}`) : ''
  ]
    .filter(Boolean)
    .join(dim(' · '))

  if (!args.quiet || errors > 0) {
    const target = command === 'check' ? '' : ` ${dim('→')} ${cyan(script.outputPath ?? '(not written)')}`
    console.log(`  ${mark} ${script.slug}${version}${target}  ${extra}`)
  }
  for (const note of script.auto) {
    if (!args.quiet) console.log(`      ${dim('auto')} ${note}`)
  }
  printIssues(script, args.quiet)
}

function jsonPayload(scripts: BuiltScript[]): string {
  return `${JSON.stringify(
    scripts.map(script => ({
      slug: script.slug,
      entry: script.entry,
      output: script.outputPath,
      version: script.meta.version,
      name: script.meta.name,
      hash: script.hash,
      stats: script.stats,
      auto: script.auto,
      meta: script.meta,
      issues: script.issues
    })),
    null,
    2
  )}\n`
}

function shouldFail(scripts: BuiltScript[], args: BuildArgs): boolean {
  for (const script of scripts) {
    if (hasErrors(script.issues)) return true
    if (args.strict && script.issues.some((issue: LintIssue) => issue.level === 'warn')) return true
  }
  return false
}

function toBuildOptions(args: BuildArgs): BuildOptions {
  return {
    outDir: args.outDir,
    minify: args.minify,
    sourcemap: args.sourcemap,
    baseUrl: args.baseUrl,
    versionFrom: args.versionFrom,
    bump: args.bump,
    defines: args.defines,
    externals: args.externals,
    budget: args.budget,
    css: args.css,
    assets: args.assets,
    strict: false,
    banner: args.banner ? `// built by userscript-maker${args.minify ? ' (minified)' : ''}` : undefined,
    write: true
  }
}

async function expandInputs(inputs: string[]): Promise<string[]> {
  const out: string[] = []
  for (const input of inputs) {
    if (/[*?[{]/.test(input)) {
      const glob = new Bun.Glob(input)
      for await (const file of glob.scan({ cwd: process.cwd(), onlyFiles: false, dot: false })) {
        if (file.includes('node_modules')) continue
        out.push(file)
      }
      continue
    }
    out.push(input)
  }
  return [...new Set(out)]
}

/** `./scripts/*` as a fallback, but only folders that really are scripts. */
async function defaultInputs(configInputs: string[]): Promise<string[]> {
  if (configInputs.length > 0) return configInputs
  if (!existsSync('scripts')) return []
  const out: string[] = []
  for await (const file of new Bun.Glob('scripts/*').scan({ onlyFiles: false, dot: false })) {
    if (existsSync(join(file, 'index.ts'))) out.push(file)
  }
  return out
}

async function runBuilds(
  inputs: string[],
  options: BuildOptions
): Promise<{ scripts: BuiltScript[]; failures: number }> {
  const scripts: BuiltScript[] = []
  let failures = 0
  for (const input of inputs) {
    try {
      scripts.push(await buildScript(input, options))
    } catch (error) {
      failures += 1
      console.error(`  ${red('fail')} ${input}\n${indent(String((error as Error).message ?? error))}`)
    }
  }
  return { scripts, failures }
}

function indent(text: string): string {
  return text
    .split('\n')
    .map(line => `       ${line}`)
    .join('\n')
}

async function runTests(passthrough: string[]): Promise<number> {
  const proc = Bun.spawn(['bun', 'test', ...passthrough], {
    stdio: ['inherit', 'inherit', 'inherit']
  })
  return await proc.exited
}

const SLUG_RE = /^[a-z0-9][a-z0-9-]*$/

function template(options: {
  slug: string
  description: string
  matches: string[]
  grants: string[]
}): string {
  const matches = options.matches.map(match => `'${match}'`).join(', ')
  const grants = options.grants.map(grant => `'${grant}'`).join(', ')
  return `import { defineMeta } from 'userscript-maker'
import 'userscript-maker/gm'

defineMeta({
  name: '${options.slug}',
  namespace: 'https://example.com/${options.slug}',
  version: '1.0.0',
  description: '${options.description}',
  author: 'tachibana-shin',
  license: 'MIT',
  match: [${matches}],
  grant: [${grants}],
  runAt: 'document-end'
})

// Your script body goes here, after the defineMeta() call.
const seen = (await GM.getValue('seen', 0)) as number
await GM.setValue('seen', seen + 1)
console.log('[${options.slug}] running on', location.href)
`
}

interface InitAnswers {
  slug: string
  description: string
  matches: string[]
  grants: string[]
  fixture: boolean
}

/** Interactive `init`: skipped in CI / piped shells, or with `--yes`. */
async function promptInit(initialSlug: string): Promise<InitAnswers | null> {
  intro(pc.bgCyan(pc.black(' userscript-maker init ')))

  const slug = await prompt({
    message: 'Script folder name',
    placeholder: 'my-script',
    initialValue: initialSlug,
    validate: value => (SLUG_RE.test(value ?? '') ? undefined : 'use lowercase letters, digits and dashes')
  })
  if (isCancel(slug)) return null

  const description = await prompt({
    message: 'What does it do?',
    placeholder: 'Hides the noise on example.com',
    defaultValue: 'What this script does'
  })
  if (isCancel(description)) return null

  const rawMatches = await prompt({
    message: 'Match patterns (comma separated)',
    placeholder: '*://example.com/*',
    defaultValue: '*://example.com/*'
  })
  if (isCancel(rawMatches)) return null

  const storage = await confirm({
    message: 'Use GM storage (getValue/setValue)?',
    initialValue: true
  })
  if (isCancel(storage)) return null

  const fixture = await confirm({
    message: 'Add a fixture.html page for the dev harness?',
    initialValue: true
  })
  if (isCancel(fixture)) return null

  return {
    slug: slug.trim(),
    description: description.trim() || 'What this script does',
    matches: rawMatches
      .split(',')
      .map(match => match.trim())
      .filter(Boolean),
    grants: storage ? ['GM.getValue', 'GM.setValue'] : [],
    fixture
  }
}

async function init(name: string | undefined, options: RawOptions): Promise<number> {
  const interactive = !options.yes && Boolean(process.stdin.isTTY && process.stdout.isTTY)

  let answers: InitAnswers = {
    slug: name ?? 'my-script',
    description: 'What this script does',
    matches: ['*://example.com/*'],
    grants: ['GM.getValue', 'GM.setValue'],
    fixture: false
  }
  if (interactive) {
    const prompted = await promptInit(answers.slug)
    if (!prompted) {
      cancel('cancelled')
      return 1
    }
    answers = prompted
    outro(dim(`scripts/${answers.slug}`))
  }

  if (!SLUG_RE.test(answers.slug)) {
    console.error(red(`invalid name: ${answers.slug} (use lowercase letters, digits and dashes)`))
    return 1
  }

  const dir = resolve('scripts', answers.slug)
  const file = resolve(dir, 'index.ts')
  if (existsSync(file)) {
    console.error(red(`already exists: ${file}`))
    return 1
  }

  await Bun.write(file, template(answers))
  if (answers.fixture) {
    await Bun.write(
      resolve(dir, 'fixture.html'),
      `<!doctype html>\n<html lang="en">\n  <head><meta charset="utf-8" /><title>${answers.slug}</title></head>\n  <body>\n    <p>Fixture page for \`userscript-maker dev\`.</p>\n  </body>\n</html>\n`
    )
  }

  if (options.quiet !== true) {
    console.log(`  ${green('ok')} created ${cyan(file)}${answers.fixture ? dim(' + fixture.html') : ''}`)
    console.log(dim(`  next: userscript-maker build scripts/${answers.slug}`))
  }
  return 0
}

const timers = new Map<string, ReturnType<typeof setTimeout>>()

/** Watch every script folder and rebuild whatever changed. */
async function watchAndRebuild(
  inputs: string[],
  options: BuildOptions,
  args: BuildArgs,
  command: string
): Promise<number> {
  let failures = 0
  const dirs = new Map<string, string[]>()
  for (const input of inputs) {
    const entry = await resolveEntry(input)
    const dir = resolve(entry, '..')
    dirs.set(dir, [...(dirs.get(dir) ?? []), input])
  }

  for (const [dir, dirInputs] of dirs) {
    try {
      watch(dir, { recursive: true }, () => {
        clearTimeout(timers.get(dir))
        timers.set(
          dir,
          setTimeout(async () => {
            console.log(dim('\nrebuilding…'))
            const { scripts, failures: failed } = await runBuilds(dirInputs, options)
            failures = failed
            for (const script of scripts) report(script, args, command)
          }, 120)
        )
      })
    } catch (error) {
      console.warn(yellow(`cannot watch ${dir}: ${String((error as Error).message)}`))
    }
  }

  // Keep the process alive; SIGINT exits with the last build status.
  return await new Promise<number>(() => {
    process.on('SIGINT', () => process.exit(failures > 0 ? 1 : 0))
  })
}

async function runBuildCommand(command: string, args: BuildArgs): Promise<number> {
  let config
  try {
    config = await loadConfig(process.cwd(), args.configFile)
  } catch (error) {
    console.error(red(String((error as Error).message)))
    return 1
  }
  if (config.file && !args.quiet && !args.json) console.log(dim(`config: ${config.file}`))

  const options = mergeOptions(config.config, toBuildOptions(args))
  if (command === 'check') options.write = false

  const inputs = await expandInputs(
    args.inputs.length > 0 ? args.inputs : await defaultInputs(config.config.scripts ?? [])
  )
  if (inputs.length === 0) {
    console.error(red('no userscript given'))
    console.error(dim('pass a directory/file, or create ./scripts and run `userscript-maker build`'))
    return 1
  }

  if (command === 'dev') {
    const server = await startDevServer(inputs, {
      ...options,
      port: args.port,
      hostname: args.host
    })
    for (const [index, script] of server.scripts.entries()) {
      console.log(`  ${green('ok')} ${script.slug} ${dim('→')} ${cyan(server.urls[index] ?? '')}`)
      printIssues(script, args.quiet)
    }
    console.log(dim(`\nharness: http://${args.host ?? 'localhost'}:${args.port ?? 4000}/  (ctrl+c to stop)`))
    return await new Promise<number>(done => {
      process.on('SIGINT', async () => {
        await server.stop()
        done(0)
      })
    })
  }

  if (!args.quiet && !args.json) {
    const mode = command === 'check' ? 'checking' : command === 'pack' ? 'packing' : 'building'
    console.log(dim(`userscript-maker ${mode} ${inputs.length} script(s)`))
  }

  const { scripts, failures } = await runBuilds(inputs, options)
  for (const script of scripts) report(script, args, command)

  if (command === 'catalog' || command === 'pack') {
    const catalog = buildCatalog(scripts, { baseUrl: args.baseUrl })
    if (command === 'catalog') {
      const file = await writeCatalog(resolve(args.outDir), catalog)
      if (args.json) process.stdout.write(catalogJson(catalog))
      else if (!args.quiet) {
        console.log(
          `  ${green('ok')} catalog ${dim('→')} ${cyan(file)} ${dim(`${catalog.scripts.length} script(s)`)}`
        )
      }
    } else if (scripts.length > 0) {
      const packed = await packScripts(scripts, { outDir: resolve(args.outDir) })
      if (args.json) {
        process.stdout.write(
          `${JSON.stringify({ zip: packed.file, bytes: packed.bytes, entries: packed.entries, catalog }, null, 2)}\n`
        )
      } else if (!args.quiet) {
        console.log(
          `  ${green('ok')} packed ${dim('→')} ${cyan(packed.file)} ${dim(formatSize(packed.bytes))}`
        )
      }
    }
  }

  if (args.json && command === 'build') process.stdout.write(jsonPayload(scripts))

  const failed = failures > 0 || shouldFail(scripts, args)
  if (command === 'build' && args.watch) {
    if (!args.quiet && !args.json) console.log(dim('\nwatching for changes… (ctrl+c to stop)'))
    return await watchAndRebuild(inputs, options, args, command)
  }
  return failed ? 1 : 0
}

export async function main(argv: string[]): Promise<number> {
  // `test` forwards everything to `bun test`, flags included.
  if (argv[0] === 'test') return await runTests(argv.slice(1))

  let pending: Promise<number> | undefined
  const program = createProgram({
    build(command, inputs, options) {
      let args: BuildArgs
      try {
        args = toArgs(inputs ?? [], options)
      } catch (error) {
        console.error(red(String((error as Error).message ?? error)))
        pending = Promise.resolve(1)
        return
      }
      pending = runBuildCommand(command, args)
    },
    init(name, options) {
      pending = init(name, options)
    }
  })

  if (argv.length === 0) {
    program.outputHelp()
    return 0
  }

  try {
    program.parse(argv, { from: 'user' })
  } catch (error) {
    const { code, message } = error as { code?: string; message?: string }
    if (code === 'commander.helpDisplayed' || code === 'commander.version') return 0
    // Commander already printed `error: …`; only add the hint.
    if (!code?.startsWith('commander.')) {
      console.error(red(String(message ?? error)))
    }
    console.error(dim('run `userscript-maker --help` for usage'))
    return 1
  }

  return pending === undefined ? 0 : await pending
}

const exitCode = await main(process.argv.slice(2))
process.exit(exitCode)
