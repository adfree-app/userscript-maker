# userscript-maker

A **library + CLI** that compiles TypeScript userscripts into standard `.user.js` files with Bun —
plus lint, oxlint/oxfmt tooling, a live dev harness, a test harness, a catalog manifest and release
packing.

It is a tool, not a script collection: it ships no userscripts of its own and does not care where
your scripts live. Point it at a folder (or a glob) and it produces Tampermonkey / Violentmonkey /
Greasemonkey ready output.

One folder per script, a `defineMeta({ ... })` block at the top, the rest is normal code:

```ts
// scripts/hn-cleaner/index.ts
import { defineMeta } from 'userscript-maker'
import 'userscript-maker/gm'

defineMeta({
  name: 'HN cleaner',
  namespace: 'https://github.com/tachibana-shin/hn-cleaner',
  version: '1.0.0',
  description: 'Hides the noise on the Hacker News front page',
  author: 'tachibana-shin',
  license: 'MIT',
  match: ['https://news.ycombinator.com/*'],
  grant: ['GM.setValue', 'GM.getValue'],
  runAt: 'document-end'
})

const hidden = Number((await GM.getValue('hidden', 0)) ?? 0)
document.querySelectorAll('.athing').forEach((row, index) => {
  if (index >= hidden) return
  ;(row as HTMLElement).style.display = 'none'
})
await GM.setValue('hidden', hidden + 1)
```

```bash
userscript-maker build scripts/hn-cleaner
# → dist/hn-cleaner.user.js   (header + bundled IIFE, top-level await supported)
```

## Contents

- [Install](#install)
- [Quick start](#quick-start)
- [Script layout](#script-layout)
- [Metadata reference](#metadata-reference)
- [CLI reference](#cli-reference)
- [Compile-time constants](#compile-time-constants)
- [Committed style](#committed-style)
- [Assets and resources](#assets-and-resources)
- [Externals → `@require`](#externals--require)
- [Lint rules](#lint-rules)
- [Dev harness](#dev-harness)
- [Testing scripts](#testing-scripts)
- [Catalog and packing](#catalog-and-packing)
- [Config file](#config-file)
- [Programmatic API](#programmatic-api)
- [CI and releases](#ci-and-releases)
- [Troubleshooting](#troubleshooting)
- [How it works](#how-it-works)
- [Notes and limits](#notes-and-limits)
- [Developing the maker](#developing-the-maker) · [Tooling](#tooling-lint-format-typecheck-hooks) · [Releasing](#releasing-the-package)

## Install

Bun-only (it uses `Bun.build` and `Bun.serve`):

```bash
bun add -d github:adfree-app/userscript-maker      # from git
```

Two identical binaries land in `node_modules/.bin` — `userscript-maker` and the short `usm` — so
`bunx usm build`, `bunx userscript-maker build` and `bun run usm build` all work. Nothing needs to be
built or transpiled: the package ships TypeScript sources and Bun runs them directly.

```bash
usm build scripts/hn-cleaner       # same as: userscript-maker build scripts/hn-cleaner
usm --help
```

Peer dependencies (both optional):

| Package      | Needed for                                                    |
| ------------ | ------------------------------------------------------------- |
| `typescript` | the transpile fallback used when metadata is not a literal    |
| `happy-dom`  | only for `userscript-maker test` / `userscript-maker/testing` |

Everything else is a regular dependency, so nothing has to be installed by hand:
`commander` (CLI), `@clack/prompts` (`init` prompts), `picocolors` (output), `fflate` (release
zip), `mrmime` (asset MIME types), `semver` (`--bump`), `bytes` (`--budget`), `pretty-bytes`
(size column). `@types/bytes` and `@types/semver` ship as dependencies too, so a consumer running
`tsc` over the package's sources needs no extra `@types` install.

## Quick start

```bash
# 1. scaffold a script (index.ts + a stub fixture page)
bunx usm init hello

# 2. edit scripts/hello/index.ts, then build it
bunx usm build scripts/hello
#    ok hello v1.0.0 → dist/hello.user.js  1.2 kB · gzip 620 B

# 3. try it in a real page without installing anything
bunx usm dev scripts/hello
#    ok hello → http://localhost:4000/hello/
```

Install it in a manager: open the manager's dashboard → "Create a new script" (Tampermonkey) or
drag `dist/hello.user.js` into the browser (Violentmonkey/Greasemonkey). The header already carries
`@name`, `@match`, `@grant`, `@run-at` and, if you pass `--base-url`, the `@updateURL` used for
auto-updates.

The day-to-day loop:

```bash
bunx usm check scripts/hello --strict   # metadata + body lint, no output written
bunx usm test                           # your own *.test.ts files
bunx usm build --bump patch              # bump, rebuild, keep source in sync
bunx usm catalog && bunx usm pack
```

## Script layout

Things the maker looks for next to the entry file — all optional:

```
scripts/hn-cleaner/
├── index.ts        entry: defineMeta(...) + code
├── index.css       inlined as GM_addStyle (also: style.css or <folder>.css)
├── assets/         every file inlined, read with userscript-maker/resources
├── fixture.html    page used by `userscript-maker dev` and by the test harness
└── clean.test.ts   your own tests, run with `userscript-maker test`
```

A single `.ts`/`.js` file also works: `userscript-maker build scripts/one-off.ts`. Paths may be
folders, files or globs (`"scripts/*"`), and several of them can be given at once.

## Metadata reference

`defineMeta()` takes a `UserScriptMeta`. Keys map to header fields; `string | string[]` fields emit
one line per value.

| Key                                      | Header                       | Notes                                                |
| ---------------------------------------- | ---------------------------- | ---------------------------------------------------- |
| `name`                                   | `@name`                      | required                                             |
| `namespace`                              | `@namespace`                 | auto-filled from git remote when omitted             |
| `version`                                | `@version`                   | auto-filled; semver expected                         |
| `description`                            | `@description`               | newlines flattened                                   |
| `author`, `license`, `copyright`         | `@author`, `@license`, …     |                                                      |
| `homepage`, `homepageURL`, `website`     | `@homepage`, `@website`      | any of them works                                    |
| `source`                                 | `@source`                    | auto-filled from git remote                          |
| `icon`, `iconURL`, `icon64`, `icon64URL` | `@icon`, `@icon64`           |                                                      |
| `updateURL`, `downloadURL`               | `@updateURL`, `@downloadURL` | auto-filled from `--base-url`                        |
| `supportURL`                             | `@supportURL`                |                                                      |
| `match`, `include`, `exclude`            | `@match`, `@include`, …      | arrays allowed; `match` is validated                 |
| `require`, `resource`                    | `@require`, `@resource`      | `--external` adds to `require`                       |
| `grant`                                  | `@grant`                     | `'none'` allowed; `GM_addStyle` added for CSS        |
| `connect`                                | `@connect`                   | needed for `GM_xmlhttpRequest`                       |
| `runAt`                                  | `@run-at`                    | `document-start`, `document-end`, `document-idle`, … |
| `sandbox`                                | `@sandbox`                   | Tampermonkey                                         |
| `noframes`, `unwrap`, `nocompat`         | `@noframes`, …               | flags — emitted only when `true`                     |
| `antifeature`                            | `@antifeature`               | e.g. `'ads'`                                         |
| `custom`                                 | any                          | `{ contributionURL: '…' }` → `@contributionURL`      |

Rules:

- `grant` and `connect` are copied **verbatim** — `grant: ['GM_xmlhttpRequest']` emits
  `// @grant GM_xmlhttpRequest`, not the modernised `GM.xmlHttpRequest`, and every `connect` host
  keeps its order (`boom`, `*://api.example.com/*`, `self`, … are all passed through). Matching
  `GM_xmlhttpRequest(...)` calls stay untouched in the body too, so legacy managers keep working.
- `runAt` → `@run-at`; unknown `runAt` values fail lint (`meta-runat`).
- Newlines inside a value are flattened, so a multi-line `description` can't break the header.
- Unknown keys are reported as warnings, not silently dropped.
- The argument must be readable _without running the script_: a literal object, optionally using
  constants declared above it. `defineMeta()` returns the object, so you can still use it at runtime
  (`const meta = defineMeta({...})`).

### Auto-filled fields

| Field                      | Filled from                                                              |
| -------------------------- | ------------------------------------------------------------------------ |
| `version`                  | `--version-from git\|package`, else closest `package.json`, else git tag |
| `namespace`                | config `namespace`, else git remote + `/<slug>`                          |
| `author`                   | config `author`, else `git config user.name`                             |
| `source`                   | git remote (`git@…`/ssh remotes are normalized to https)                 |
| `downloadURL`, `updateURL` | `${baseUrl}/<slug>.user.js`                                              |
| `grant` += `GM_addStyle`   | when a CSS sidecar is inlined                                            |
| `require` += url           | for each `--external`                                                    |

Every auto-fill is printed as `auto …` and exposed on the result (`built.auto`).

`--bump patch` rewrites `version: '1.2.3'` inside the source file, so the built script and the
source stay in sync. When the version is defined by a constant the maker says so instead of
guessing.

## CLI reference

| Command              | What it does                                                       |
| -------------------- | ------------------------------------------------------------------ |
| `build [paths...]`   | Bundles every script: header + body → `<outDir>/<slug>.user.js`    |
| `check [paths...]`   | Same pipeline, nothing written; exit 1 on lint errors              |
| `dev [paths...]`     | Build + serve a harness page with a GM mock and live reload        |
| `catalog [paths...]` | Build + write `<outDir>/catalog.json`                              |
| `pack [paths...]`    | Build + one release `.zip` (scripts, `.meta.json`, `catalog.json`) |
| `test [args...]`     | Runs `bun test` (args are forwarded)                               |
| `init [name]`        | Scaffolds `scripts/<name>/index.ts`                                |

With no path the CLI builds `scripts` from `userscript.config.ts`, or `./scripts/*` when that
folder exists.

| Option                     | Meaning                                                               |
| -------------------------- | --------------------------------------------------------------------- |
| `-o, --out <dir>`          | Output directory (default `dist`)                                     |
| `-m, --minify`             | Minify the body (header is never minified)                            |
| `--sourcemap <mode>`       | `none` (default), `inline`, `external`                                |
| `--base-url <url>`         | Public URL of the dist folder → fills `@downloadURL`/`@updateURL`     |
| `--version-from <s>`       | `git` or `package` — take `@version` from there                       |
| `--bump <kind>`            | `patch`/`minor`/`major` — bump and **write back into the source**     |
| `--define <k=v>`           | Compile-time constant (repeatable)                                    |
| `--external <s=u>`         | Keep a library out of the bundle, load it via `@require` (repeatable) |
| `--budget <size>`          | Max body size, e.g. `40kb` (lint error above it)                      |
| `--no-css` / `--no-assets` | Skip the CSS sidecar / the `assets/` folder                           |
| `--no-banner`              | Drop the `// built by userscript-maker` line                          |
| `--strict`                 | Fail on lint warnings too                                             |
| `--config <file>`          | Config file (default `userscript.config.ts` or `.json`)               |
| `-w, --watch`              | Rebuild on change                                                     |
| `--json`                   | Machine-readable output for CI                                        |
| `-q, --quiet`              | Only print problems                                                   |
| `--port`, `--host`         | Dev harness bind options (default `4000`, `localhost`)                |

Exit codes: `0` ok, `1` build failure or lint error (`--strict` also fails on warnings).

## Compile-time constants

`__DEV__`, `__PROD__`, `__NAME__`, `__VERSION__`, `__BUILD_TIME__`, `__BUILD_HASH__` are replaced
at build time (typed in `userscript-maker/gm`). Add your own with `--define __FLAG__=true` or a
config `defines` entry:

```ts
if (__DEV__) console.debug(`[${__NAME__} ${__VERSION__}] boot`)
if (__PROD__) report(__BUILD_HASH__)
```

`dev` implies `__DEV__=true`; every other command implies `__PROD__=true`. Dead branches are removed
by the bundler when minifying.

## Committed style

`index.css` (or `style.css`, or `<folder>.css`) is collapsed and injected at the top of the script
through `GM_addStyle` when available, otherwise a `<style>` element. `grant: 'GM_addStyle'` is added
automatically. Pass `--no-css` to leave it out.

## Assets and resources

Everything under `assets/` is inlined as a data URL at build time and read at runtime — no extra
`@resource` and no network request:

```ts
import {
  getResource,
  getResourceText,
  getResourceBlob,
  hasResource,
  listResources
} from 'userscript-maker/resources'

const logo = getResource('icons/logo.svg') // "data:image/svg+xml;base64,…"
const css = getResourceText('theme.css') // decoded text
const blob = getResourceBlob('data.bin') // Blob
```

| Function                  | Returns                                          |
| ------------------------- | ------------------------------------------------ |
| `getResource(name)`       | data URL string, throws when the name is unknown |
| `getResourceText(name)`   | decoded text (UTF-8 for base64 payloads)         |
| `getResourceBase64(name)` | raw base64 payload                               |
| `getResourceBlob(name)`   | `Blob` with the right MIME type                  |
| `hasResource(name)`       | boolean                                          |
| `listResources()`         | every inlined name                               |

Names are relative to `assets/` and use forward slashes (`icons/logo.svg`). The unknown-name error
lists what is available. Pass `--no-assets` to skip inlining.

## Externals → `@require`

```bash
userscript-maker build scripts/x --external lodash=https://cdn.jsdelivr.net/npm/lodash@4/lodash.min.js#_
```

`import _ from 'lodash'` stays out of the bundle, `@require` is added, and a small shim resolves the
module from `window._` (the part after `#`, defaulting to the last path segment). Missing the global
produces a clear runtime error instead of a silent `undefined`.

Only externals the script actually imports get a `@require` line, so a single config entry cannot
leak into unrelated scripts. Browser/CDN libraries that are UMD or expose a global work best; ES-only
modules cannot be `@require`d this way.

## Lint rules

`userscript-maker check` runs these rules against metadata **and** the bundled body:

| Code                                                                      | Level | Trigger                                               |
| ------------------------------------------------------------------------- | ----- | ----------------------------------------------------- |
| `meta-name`, `meta-runat`                                                 | error | missing name, invalid `runAt`                         |
| `match-pattern`                                                           | error | `match` is not a valid match pattern                  |
| `budget`                                                                  | error | body larger than `--budget`                           |
| `meta-version`                                                            | warn  | no version, or not semver                             |
| `meta-namespace`, `match-missing`                                         | warn  | no namespace, no match/include                        |
| `grant-missing`                                                           | warn  | body calls `GM.x` / `GM_x` without a matching `grant` |
| `grant-unused`                                                            | warn  | `grant` declared but never used                       |
| `grant-none`                                                              | warn  | `grant: 'none'` but GM APIs are used                  |
| `connect-missing`                                                         | warn  | `GM.xmlHttpRequest` granted without `@connect`        |
| `grant-unsafe-window`                                                     | warn  | `unsafeWindow` used without `grant: 'unsafeWindow'`   |
| `risky-eval`, `risky-function`, `risky-document-write`, `risky-innerhtml` | warn  | review-bait APIs                                      |
| `header`                                                                  | warn  | forwarded metadata warnings                           |

`risky-innerhtml` only fires for a _dynamic_ right-hand side: `el.innerHTML = '<b>x</b>'` is fine,
`el.innerHTML = markup`, `` el.innerHTML = `<b>${x}</b>` `` and `'<b>' + x` are not — build nodes
instead.

Warnings never block a normal `build`; `--strict` turns them into a failure for CI. There is no
per-rule ignore list: fix the code, or drop the flag/`grant` that triggers the warning.

## Dev harness

```bash
userscript-maker dev scripts/hn-cleaner --port 4000
#   ok hn-cleaner → http://localhost:4000/hn-cleaner/
```

The page loads a GM mock (`GM`, `GM_*`, `unsafeWindow`, storage backed by `localStorage`), your
`fixture.html` body, a metadata/lint panel, and the script with an inline source map. Save a file and
the page reloads over SSE. `--define __DEV__=true` is implied, plus everything from the CLI table.

`/` lists every script in the current run, so `dev scripts/*` gives you one index page for all of
them. Without `fixture.html` the page is empty except for the script and the panel.

Limitation: the harness page is served from localhost, so code that checks `location.href` sees
`localhost`, not the real site. Use the test harness for URL-dependent logic.

## Testing scripts

`createHarness` builds the script and runs it inside happy-dom with the same GM mock:

```ts
// scripts/hn-cleaner/clean.test.ts
import { describe, expect, test } from 'bun:test'
import { createHarness } from 'userscript-maker/testing'

describe('hn cleaner', () => {
  test('hides the first rows', async () => {
    const harness = await createHarness(import.meta.dir, {
      url: 'https://news.ycombinator.com/',
      html: `<table>${'<tr class="athing"></tr>'.repeat(3)}</table>`
    })
    try {
      harness.run()
      await Bun.sleep(10)
      expect(harness.document.querySelectorAll('tr.athing[style]')).toHaveLength(1)
      expect(harness.mock.storage.get('hidden')).toBe(1)
      expect(harness.mock.log.map(entry => entry.api)).toContain('setValue')
    } finally {
      harness.dispose()
    }
  })
})
```

Options: `html` (defaults to the script's `fixture.html`), `url` (defaults to the first `@match`),
`build` (any `BuildOptions`). The result exposes:

| Property    | What it is                                                                     |
| ----------- | ------------------------------------------------------------------------------ |
| `script`    | the built script — `meta`, `header`, `body`, `code`, `stats`, `hash`, `issues` |
| `window`    | the happy-dom window                                                           |
| `document`  | shortcut for `window.document`                                                 |
| `mock`      | `{ GM, storage, clipboard, log, restore() }`                                   |
| `run()`     | executes the bundle (call it again after changing the DOM)                     |
| `dispose()` | restores swapped globals and closes the window                                 |

Injected globals are `window`, `document`, `location`, `navigator`, `localStorage`,
`sessionStorage`, `MutationObserver`, `IntersectionObserver`, `ResizeObserver`, `HTMLElement`,
`Element`, `Node`, `Event`, `CustomEvent`, `KeyboardEvent`, `MouseEvent`, `getComputedStyle`,
`requestAnimationFrame`, `cancelAnimationFrame`, `matchMedia`, `addEventListener`,
`removeEventListener`, plus `GM`, `GM_*` and `unsafeWindow`.

The GM mock covers `getValue`/`setValue`/`deleteValue`/`listValues`, `xmlHttpRequest` (mapped to
`fetch`), `addStyle`, `setClipboard` (recorded in `mock.clipboard`), `notification`, `openInTab`,
`registerMenuCommand`/`unregisterMenuCommand`, `getResourceUrl`/`getResourceText`, `info`, and the
legacy `GM_*` aliases. Every call lands in `mock.log` as `{ api, args }`.

## Catalog and packing

`userscript-maker catalog --base-url https://me.dev/us` writes:

```json
{
  "manifestVersion": 1,
  "generatedAt": "2026-11-24T14:43:02.131Z",
  "baseUrl": "https://me.dev/us",
  "scripts": [
    {
      "slug": "demo",
      "name": "Demo script",
      "version": "1.0.0",
      "match": ["https://example.com/*"],
      "grant": ["GM.setValue"],
      "size": 2977,
      "gzip": 1244,
      "hash": "sha256…",
      "file": "demo.user.js",
      "url": "https://me.dev/us/demo.user.js",
      "diagnostics": { "errors": 0, "warnings": 0 },
      "updatedAt": "…"
    }
  ]
}
```

`userscript-maker pack` writes `dist/userscripts-<stamp>.zip` containing every `<slug>.user.js`, its
`<slug>.meta.json` and `catalog.json` — ready for a GitHub release. `--json` prints the result for CI.

The catalog is also the natural input for a landing page: render `scripts[].name`, `.description`,
`.version` and link `scripts[].url` for install buttons; compare `.hash` to detect a new build.

## Config file

Optional, and it belongs in **your** project root — the package ships no config of its own. The CLI
looks for `userscript.config.ts|mts|js|json` in the current directory (or pass `--config <file>`):

```ts
// userscript.config.ts — in your userscript repo
export default {
  scripts: ['scripts/*'],
  baseUrl: 'https://me.dev/userscripts',
  author: 'tachibana-shin',
  defines: { __BETA__: false },
  externals: { lodash: 'https://cdn.jsdelivr.net/npm/lodash@4/lodash.min.js#_' },
  budget: 60 * 1024
}
```

CLI flags win over the config; `defines` and `externals` merge, and `undefined` options never
override config values. This package's own fixtures do not use a config file: `package.json` spells
out the same flags on `build:fixtures` / `check:fixtures` / `dev:fixtures`, so the package stays free
of any script-repo setup.

## Programmatic API

Everything the CLI does is a function you can call — useful for a custom build script or a site
generator:

```ts
import { buildScript, buildCatalog, packScripts, lintScript } from 'userscript-maker'
import { createHarness } from 'userscript-maker/testing'

const built = await buildScript('scripts/my-script', { minify: true, baseUrl: 'https://me.dev/us' })
built.meta // metadata after auto-fill
built.header // // ==UserScript== … block
built.body // bundled IIFE (with the async wrapper)
built.code // header + banner + body
built.issues // lint results
built.stats // { header, body, total, gzip }
built.hash // sha256 of `code`
built.auto // auto-filled field notes
```

`{ write: false }` keeps everything in memory (used by `check`, `dev` and tests).

| Export                                                                                                       | Purpose                                      |
| ------------------------------------------------------------------------------------------------------------ | -------------------------------------------- |
| `buildScript(input, options)` / `buildMany(inputs, options)`                                                 | one script / a list of scripts               |
| `bundleBody`, `resolveEntry`, `slugFor`, `evaluateMeta`                                                      | the individual build steps                   |
| `renderHeader(meta)`                                                                                         | metadata → header block                      |
| `extractMetaCall` / `stripMetaCall` / `codeMask`                                                             | the comment/string-aware source scanner      |
| `buildCatalog`, `catalogJson`, `writeCatalog`, `metaJson`                                                    | catalog manifest                             |
| `packScripts(scripts, { outDir, name })`                                                                     | release zip                                  |
| `createZip`, `crc32`                                                                                         | dependency-free zip writer                   |
| `lintScript`, `hasErrors`, `usedGmApis`, `grantedGmApis`, `isValidMatchPattern`                              | linting                                      |
| `loadConfig`, `mergeOptions`                                                                                 | config file handling                         |
| `applyAutoMeta`                                                                                              | version/author/URL auto-fill                 |
| `bumpVersion`, `packageVersion`, `rewriteVersionLiteral`, `SEMVER_RE`                                        | version helpers                              |
| `gitRemoteUrl`, `gitVersion`, `gitUserName`, `gitCommitHash`, `normalizeRemoteUrl`                           | git helpers                                  |
| `collectCss`, `collectAssets`, `cssBootstrap`, `externalShim`, `normalizeExternals`, `resourcesModuleSource` | assets pipeline                              |
| `harnessHtml`, `installGmMock`                                                                               | the dev page and the GM mock                 |
| `getResource`, `getResourceText`, `getResourceBase64`, `getResourceBlob`, `hasResource`, `listResources`     | `userscript-maker/resources`                 |
| `createHarness`                                                                                              | `userscript-maker/testing` (needs happy-dom) |

## CI and releases

A userscript repo only needs three steps: build strictly, catalog, and publish the dist folder next
to the release.

```yaml
# .github/workflows/userscripts.yml
name: userscripts
on:
  push:
    tags: ['v*']

jobs:
  release:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: oven-sh/setup-bun@v2
      - run: bun install --frozen-lockfile
      - run: bun run verify # lint, format, typecheck, tests
      - run: bunx userscript-maker check --strict
      - run: bunx userscript-maker build --base-url https://me.dev/userscripts --version-from git
      - run: bunx userscript-maker catalog --base-url https://me.dev/userscripts
      - run: bunx userscript-maker pack
      - uses: softprops/action-gh-release@v2
        with:
          files: dist/*.zip
```

Publish `dist/` (Netlify, Cloudflare Pages, GitHub Pages, an S3 bucket…) at the same `--base-url`. The
`@downloadURL`/`@updateURL` in the header then point at the files you just uploaded, so
Tampermonkey/Violentmonkey can auto-update on the next check. Bumping `@version` (`--bump patch` or
`--version-from git`) is what the managers compare.

For a site listing your scripts, read `dist/catalog.json` at build time and render `name`,
`description`, `version`, `size` and an install link to `url`.

### CI for this package

The maker's own repository runs two jobs:

| Job       | When                          | Steps                                                                                                                |
| --------- | ----------------------------- | -------------------------------------------------------------------------------------------------------------------- |
| `check`   | every push + pull request     | `bun install --frozen-lockfile` → `lint` → `fmt:check` → `typecheck` → `bun test` → `check:fixtures` → `bun pm pack` |
| `release` | pushes to `main`, after check | `npx semantic-release` → publish to GitHub Packages                                                                  |

`release` needs **conventional commits** (`feat:`, `fix:`, `perf:`, `build:`, `BREAKING CHANGE:`); the
version, tag, `CHANGELOG.md` and GitHub release come from them. Config lives in `.releaserc.json`:
commit-analyzer → release-notes → changelog → `npm` (bump only, `npmPublish: false`) → `exec`
(`bun pm pack --destination dist`) → `github` (release with the `.tgz` attached) → `git` (commit
`package.json` + `CHANGELOG.md`).

**GitHub Packages only accepts scoped names**, so the publish step runs
`scripts/publish-github-packages.sh`: it copies the tarball inputs to a temp dir, renames the copy to
`@<owner>/userscript-maker` (adding `publishConfig.registry = https://npm.pkg.github.com`) and runs
`npm publish` with the workflow's `GITHUB_TOKEN` (permissions: `contents: write`, `packages: write`).
The repository keeps the plain `userscript-maker` name for git installs; the import shim accepts both
forms, so scripts written against either name build.

```bash
# install from GitHub Packages
echo "@you:registry=https://npm.pkg.github.com" >> .npmrc
bun add -d @you/userscript-maker
DRY_RUN=1 GITHUB_REPOSITORY_OWNER=you bun run scripts/publish-github-packages.sh   # local dry run
```

## Troubleshooting

| Symptom                                                  | Cause / fix                                                                                           |
| -------------------------------------------------------- | ----------------------------------------------------------------------------------------------------- |
| `could not read the metadata of …`                       | `defineMeta()` gets a non-literal: keep it an object literal, or use `const` values declared above it |
| `external "lodash" is not loaded (expected window._)`    | the `@require` URL did not run, or the global name in `--external x=url#global` is wrong              |
| `userscript-maker/testing needs happy-dom`               | `bun add -d happy-dom`                                                                                |
| Script does nothing in the browser                       | check `@match`, whether the manager is enabled for that site, and `@noframes`                         |
| `document.body is null` at `document-start`              | `runAt: 'document-end'` / `'document-idle'`, or wait for `DOMContentLoaded`                           |
| Top-level `await` seems to run late                      | the body is wrapped in an async IIFE: it starts immediately but continues on the microtask queue      |
| `bun test` also runs the fixtures                        | pass a path: `bun test test/build.test.ts`, or `userscript-maker test scripts/my-script`              |
| Type errors from `userscript-maker/*.ts` in another tool | use `moduleResolution: "bundler"` and let the package's own sources be checked, or `skipLibCheck`     |

## How it works

1. **Parse** — `defineMeta({...})` is found with a comment/string/regex-aware scanner, so nothing
   executes during the build (no AST dependency).
2. **Read metadata** — the literal is evaluated in up to three passes: plain `new Function`, then
   TypeScript-transpiled, then a temporary module containing only the statements _above_ the call
   (so `const NAME = …` works without running the body).
3. **Prepare** — version bump/auto-fill, CSS sidecar, `assets/`, externals, defines.
4. **Bundle** — the call is replaced by the object literal, imports are hoisted above an async
   wrapper (top-level `await` works), and `Bun.build` produces one browser IIFE.
   `userscript-maker` imports resolve to tiny shims, so nothing from the maker ends up in output.
5. **Render & lint** — metadata becomes the header (`@grant`/`@connect`/`@match` values are written
   byte-for-byte, one line per value), then the body is checked.

## Notes and limits

- `GM_*` APIs are typed through `userscript-maker/gm`; nothing is polyfilled in the shipped file.
- Keep DOM work inside functions/bodies so nothing touches `document` at build time.
- `--watch` and `dev` use recursive directory watchers and rebuild the scripts given on the command
  line.
- The package exports TypeScript sources, so typecheck your scripts with `moduleResolution: "bundler"`
  (the default in Bun projects). No `allowImportingTsExtensions` needed.
- `createHarness` is **only** exported from `userscript-maker/testing`, never from the root entry, so
  projects that skip `happy-dom` still typecheck against the main API.
- No SCSS/Less, no `@resource` rewriting, no `.d.ts` emit: the output is one self-contained `.user.js`.

## Developing the maker

```bash
bun install
bun run build:fixtures    # outputs dist/*.user.js + catalog.json from test/fixtures/*
bun run check:fixtures    # lint-only, exit 1 on warnings
bun run dev:fixtures      # harness over every fixture at http://localhost:4000/
```

Fixtures under `test/fixtures/` are the package's own test corpus:

| Fixture             | Covers                                                                               |
| ------------------- | ------------------------------------------------------------------------------------ |
| `demo`              | minimal metadata, `GM.getValue`/`setValue`, CSS sidecar                              |
| `hn-cleaner`        | top-level `await`, menu command, `@noframes`, `fixture.html` + test                  |
| `copy-code`         | `assets/` → data URLs, `GM.setClipboard`, `MutationObserver`                         |
| `sticky-table-head` | `import _ from 'lodash'` → `@require`, `grant: 'none'`, `custom` header field        |
| `github-stars`      | `@grant GM_xmlhttpRequest` + `@connect api.github.com` kept verbatim, `fixture.html` |
| `basic`, `assigned` | lint fixtures, intentionally fail `--strict` (not part of the dev run)               |

### Tooling: lint, format, typecheck, hooks

| Command             | What it runs                                                                       |
| ------------------- | ---------------------------------------------------------------------------------- |
| `bun run lint`      | `oxlint` (`.oxlintrc.json`) — 0 errors / 0 warnings is the baseline                |
| `bun run lint:fix`  | `oxlint --fix`                                                                     |
| `bun run fmt`       | `oxfmt` (`.oxfmtrc.json`): single quotes, no semicolons, width 110                 |
| `bun run fmt:check` | `oxfmt --check` — fails when a file is not formatted                               |
| `bun run typecheck` | `tsc --noEmit`                                                                     |
| `bun run test`      | `bun test` (79 tests)                                                              |
| `bun run verify`    | lint → fmt:check → typecheck → tests (the gate used by hooks and `prepublishOnly`) |

Git hooks come from [husky](https://typicode.github.io/husky/): `bun run prepare` (also run by
`bun install`) points the repo's `core.hooksPath` at `packages/userscript-maker/.husky/_` and writes
the shims, so the same setup works whether this package is the whole repo or a folder inside a bigger
one.

`.husky/pre-commit` runs `bun run verify`, but **only when the staged changes touch this package** —
a commit elsewhere in the monorepo returns in ~40 ms. It also runs inside the package directory, so
tooling resolves from `packages/userscript-maker`.

```bash
git config --unset core.hooksPath   # disable the hooks for this repo
HUSKY=0 git commit …                # skip them for a single commit
```

### Releasing the package

Releases are automated by `semantic-release` on `main` (see [CI for this package](#ci-for-this-package)).
Locally, the same checks and a manual publish are:

```bash
bun run verify      # lint, format, typecheck, tests
bun pm pack         # tarball: index.ts, src/, README.md, LICENSE, package.json — nothing else
bun publish         # prepublishOnly re-runs verify
bunx semantic-release --dry-run --no-ci    # preview the next version locally
```

The tarball is the compatibility contract: if it installs and `bunx tsc --noEmit` passes in a fresh
project, the published package is healthy.
