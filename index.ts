/**
 * userscript-maker
 *
 * User scripts only need `defineMeta` (build-time metadata + types) and, when
 * they use the extra modules, `userscript-maker/gm` / `userscript-maker/resources`.
 * Everything else here is for tooling, tests and CI.
 */
export { defineMeta } from './src/define'

export {
  buildMany,
  buildScript,
  bundleBody,
  evaluateMeta,
  resolveEntry,
  slugFor,
  type BuildOptions,
  type BuiltScript,
  type BundleInput,
  type ScriptStats
} from './src/build'

export {
  collectAssets,
  collectCss,
  cssBootstrap,
  externalShim,
  normalizeExternals,
  resourcesModuleSource,
  type CssSidecar,
  type ExternalSpec,
  type ResourceFile
} from './src/assets'

export {
  hasErrors,
  grantedGmApis,
  isValidMatchPattern,
  lintScript,
  usedGmApis,
  type LintContext,
  type LintIssue,
  type LintLevel
} from './src/lint'
export { renderHeader, type HeaderResult } from './src/header'
export { codeMask, extractMetaCall, stripMetaCall, type MetaCallSpan } from './src/parse'
export type { UserScriptMeta, UserScriptRunAt } from './src/types'

export {
  buildCatalog,
  catalogEntry,
  catalogJson,
  writeCatalog,
  type Catalog,
  type CatalogEntry
} from './src/catalog'
export { metaJson, packScripts, type PackOptions, type PackResult } from './src/pack'
export { createZip, crc32, type ZipEntry } from './src/zip'
export { loadConfig, mergeOptions, type LoadedConfig, type MakerConfig } from './src/config'
export { applyAutoMeta, type AutoMetaOptions, type AutoMetaResult } from './src/meta-fill'
export { bumpVersion, packageVersion, rewriteVersionLiteral, SEMVER_RE, type BumpKind } from './src/version'
export { gitCommitHash, gitRemoteUrl, gitUserName, gitVersion, normalizeRemoteUrl } from './src/git'
export { harnessHtml, type HarnessInput } from './src/harness'
export { installGmMock, type GmMock, type GmMockOptions } from './src/gm-mock'
// `createHarness` lives at 'userscript-maker/testing': it needs the optional
// happy-dom peer dependency, so it is kept out of the root entry.
export {
  getResource,
  getResourceBase64,
  getResourceBlob,
  getResourceText,
  hasResource,
  listResources
} from './src/resources'
