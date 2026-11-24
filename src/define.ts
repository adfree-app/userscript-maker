import type { UserScriptMeta } from './types'

/**
 * Declares the metadata block of a userscript.
 *
 * The maker reads the literal you pass here, turns it into the
 * `// ==UserScript== ... // ==/UserScript==` header, and replaces the call in
 * the compiled script with the plain object, so nothing of this function
 * survives in the output. It also returns the object, which means you can use
 * the metadata inside your script:
 *
 * ```ts
 * const meta = defineMeta({ name: 'My script', version: '1.0.0' })
 * console.log(meta.name)
 * ```
 *
 * The call must be a plain object literal (no spreads of runtime values, no
 * function calls) so it can be read without running the script.
 */
export function defineMeta<T extends UserScriptMeta>(meta: T): T {
  return meta
}
