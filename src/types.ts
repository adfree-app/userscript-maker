/**
 * Type definitions for the userscript metadata block.
 *
 * Field names are the *camelCase* userscript keys (`runAt`, `updateURL`, ...).
 * `src/header.ts` maps each one to its real `@header` line.
 */
export interface UserScriptMeta {
  /** @name — required, shown in the script manager */
  name: string
  /** @namespace — groups scripts by author/project */
  namespace?: string
  /** @version — semver-ish string */
  version?: string
  /** @description */
  description?: string
  /** @author */
  author?: string
  /** @license */
  license?: string
  /** @copyright */
  copyright?: string
  /** @homepage */
  homepage?: string
  /** @homepageURL (alias of `homepage`) */
  homepageURL?: string
  /** @website */
  website?: string
  /** @source */
  source?: string
  /** @icon */
  icon?: string
  /** @iconURL (alias of `icon`) */
  iconURL?: string
  /** @icon64 */
  icon64?: string
  /** @icon64URL (alias of `icon64`) */
  icon64URL?: string
  /** @updateURL */
  updateURL?: string
  /** @downloadURL */
  downloadURL?: string
  /** @supportURL */
  supportURL?: string
  /** @include — pages to run on (glob-ish) */
  include?: string | string[]
  /** @match — pages to run on (Chrome match patterns) */
  match?: string | string[]
  /** @exclude — pages to skip */
  exclude?: string | string[]
  /** @require — extra libraries loaded before the script */
  require?: string | string[]
  /** @resource — assets available through GM_getResourceURL / GM_getResourceText */
  resource?: string | string[]
  /** @grant — GM_* / GM.* APIs to request, use `"none"` for no API */
  grant?: string | string[]
  /** @connect — hosts allowed for GM_xmlhttpRequest */
  connect?: string | string[]
  /** @run-at */
  runAt?: UserScriptRunAt
  /** @sandbox */
  sandbox?: 'raw' | 'JavaScript' | 'DOM'
  /** @noframes */
  noframes?: boolean
  /** @unwrap */
  unwrap?: boolean
  /** @antifeature */
  antifeature?: string | string[]
  /** @nocompat */
  nocompat?: boolean
  /** Any extra `@header` lines, e.g. `{ customHeader: 'value' }` */
  custom?: Record<string, string | number | boolean | string[]>
}

export type UserScriptRunAt =
  | 'document-start'
  | 'document-body'
  | 'document-end'
  | 'document-idle'
  | 'document-ready'
  | 'context-menu'

/**
 * Header keys in the order script managers expect them, with the exact
 * `@`-prefixed spelling to emit.
 */
export const HEADER_FIELDS: ReadonlyArray<{
  key: keyof UserScriptMeta
  header: string
}> = [
  { key: 'name', header: '@name' },
  { key: 'namespace', header: '@namespace' },
  { key: 'version', header: '@version' },
  { key: 'description', header: '@description' },
  { key: 'author', header: '@author' },
  { key: 'license', header: '@license' },
  { key: 'copyright', header: '@copyright' },
  { key: 'homepage', header: '@homepage' },
  { key: 'homepageURL', header: '@homepageURL' },
  { key: 'website', header: '@website' },
  { key: 'source', header: '@source' },
  { key: 'icon', header: '@icon' },
  { key: 'iconURL', header: '@iconURL' },
  { key: 'icon64', header: '@icon64' },
  { key: 'icon64URL', header: '@icon64URL' },
  { key: 'updateURL', header: '@updateURL' },
  { key: 'downloadURL', header: '@downloadURL' },
  { key: 'supportURL', header: '@supportURL' },
  { key: 'include', header: '@include' },
  { key: 'match', header: '@match' },
  { key: 'exclude', header: '@exclude' },
  { key: 'require', header: '@require' },
  { key: 'resource', header: '@resource' },
  { key: 'grant', header: '@grant' },
  { key: 'connect', header: '@connect' },
  { key: 'runAt', header: '@run-at' },
  { key: 'sandbox', header: '@sandbox' },
  { key: 'noframes', header: '@noframes' },
  { key: 'unwrap', header: '@unwrap' },
  { key: 'antifeature', header: '@antifeature' },
  { key: 'nocompat', header: '@nocompat' }
]

/** Keys emitted as a bare flag (`// @noframes`) instead of `key value`. */
export const FLAG_KEYS: ReadonlySet<string> = new Set(['noframes', 'unwrap', 'nocompat'])
