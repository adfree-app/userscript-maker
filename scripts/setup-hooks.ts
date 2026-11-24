/**
 * Installs the `.husky/` git hooks for this package.
 *
 * The package normally lives inside a bigger repo (`packages/userscript-maker`),
 * where husky cannot install itself: its own installer writes `core.hooksPath`
 * relative to the current directory and refuses to run without `.git` next to
 * it. So we do the two things husky does — point the repo's `core.hooksPath` at
 * `.husky/_` and emit the `_` shims — using the path relative to the worktree
 * root, which git resolves correctly even when the package is nested.
 *
 * Runs from `prepare`, so it is a no-op for consumers who install the package as
 * a dependency.
 */
import { spawnSync } from 'node:child_process'
import { copyFileSync, existsSync, mkdirSync, rmSync, writeFileSync } from 'node:fs'
import { dirname, join, relative, sep } from 'node:path'
import { fileURLToPath } from 'node:url'

const HOOKS = [
  'pre-commit',
  'pre-merge-commit',
  'prepare-commit-msg',
  'commit-msg',
  'post-commit',
  'pre-applypatch',
  'post-applypatch',
  'post-checkout',
  'post-merge',
  'pre-push'
]

const pkgDir = dirname(import.meta.dir)

function git(cwd: string, ...args: string[]): string {
  const result = spawnSync('git', args, { cwd, encoding: 'utf8' })
  return result.status === 0 ? result.stdout.trim() : ''
}

/** Consumers installing this package as a dependency must not touch their git. */
if (import.meta.dir.includes(`${sep}node_modules${sep}`)) {
  process.exit(0)
}

const repoRoot = git(pkgDir, 'rev-parse', '--show-toplevel')
if (!repoRoot) {
  console.log('userscript-maker: no git repository, skipping hook install')
  process.exit(0)
}

const hooksDir = join(pkgDir, '.husky')
const shimsDir = join(hooksDir, '_')

if (!existsSync(hooksDir)) {
  console.log('userscript-maker: no .husky directory, skipping hook install')
  process.exit(0)
}

// The path git stores is relative to the worktree root, so the hooks keep
// working whether this package is the repo or a folder inside it.
const hooksPath = relative(repoRoot, shimsDir).split(sep).join('/') || '.husky/_'
// Always write the config in the repository that owns this package.
if (git(repoRoot, 'config', '--local', '--get', 'core.hooksPath') !== hooksPath) {
  git(repoRoot, 'config', '--local', 'core.hooksPath', hooksPath)
}

const shimSource = join(dirname(fileURLToPath(import.meta.resolve('husky'))), 'husky')
rmSync(join(shimsDir, 'husky.sh'), { force: true })
mkdirSync(shimsDir, { recursive: true })
writeFileSync(join(shimsDir, '.gitignore'), '*\n')
copyFileSync(shimSource, join(shimsDir, 'h'))
for (const hook of HOOKS) {
  writeFileSync(join(shimsDir, hook), '#!/usr/bin/env sh\n. "$(dirname "$0")/h"\n', { mode: 0o755 })
}

console.log(`userscript-maker: git hooks installed (core.hooksPath=${hooksPath})`)
