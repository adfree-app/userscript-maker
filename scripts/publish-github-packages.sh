#!/usr/bin/env bash
# Publish the tarball to GitHub Packages (https://npm.pkg.github.com).
#
# npm.pkg.github.com only accepts *scoped* package names, so the published copy is
# renamed to `@<owner>/userscript-maker`. The code is identical — the package's own
# import shims accept both `userscript-maker` and `@<owner>/userscript-maker`.
#
# Usage: GITHUB_REPOSITORY_OWNER=<owner> [GITHUB_REPOSITORY=<owner/repo>] \
#          [DRY_RUN=1] bun run scripts/publish-github-packages.sh
set -euo pipefail

owner="${GITHUB_REPOSITORY_OWNER:-}"
if [ -z "$owner" ]; then
  echo "publish: GITHUB_REPOSITORY_OWNER is not set" >&2
  exit 1
fi

repo_dir="$(cd "$(dirname "$0")/.." && pwd)"
stage="$(mktemp -d)"
trap 'rm -rf "$stage"' EXIT

cp -r "$repo_dir/index.ts" "$repo_dir/src" "$repo_dir/README.md" "$repo_dir/LICENSE" "$stage/"
cp "$repo_dir/package.json" "$stage/package.json"

OWNER="$owner" GITHUB_REPOSITORY="${GITHUB_REPOSITORY:-}" node --input-type=module -e '
import { readFileSync, writeFileSync } from "node:fs"
const file = process.argv[1]
const pkg = JSON.parse(readFileSync(file, "utf8"))
const owner = process.env.OWNER
pkg.name = `@${owner}/${pkg.name.replace(/^@[^/]+\//, "")}`
pkg.publishConfig = { registry: "https://npm.pkg.github.com", access: "public" }
// the staged copy has no node_modules: CI already ran `bun run verify`
delete pkg.scripts?.prepublishOnly
delete pkg.scripts?.prepare
if (process.env.GITHUB_REPOSITORY) {
  pkg.repository = { type: "git", url: `git+https://github.com/${process.env.GITHUB_REPOSITORY}.git` }
  pkg.homepage = `https://github.com/${process.env.GITHUB_REPOSITORY}#readme`
  pkg.bugs = { url: `https://github.com/${process.env.GITHUB_REPOSITORY}/issues` }
}
writeFileSync(file, `${JSON.stringify(pkg, null, 2)}\n`)
console.log(`publish: ${pkg.name}@${pkg.version}`)
' "$stage/package.json"

cd "$stage"
if [ "${DRY_RUN:-}" = "1" ]; then
  npm publish --dry-run --ignore-scripts --registry=https://npm.pkg.github.com
else
  : "${NODE_AUTH_TOKEN:?NODE_AUTH_TOKEN (a GitHub token with packages:write) is required}"
  npm publish --ignore-scripts --registry=https://npm.pkg.github.com
fi
