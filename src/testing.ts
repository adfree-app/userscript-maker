import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import type { Window } from 'happy-dom'
import { buildScript, resolveEntry, type BuildOptions, type BuiltScript } from './build'
import { scriptDir } from './assets'
import { installGmMock, type GmMock, type GmMockTarget } from './gm-mock'

export interface HarnessOptions {
  /** Markup for the page body; defaults to `<script>/fixture.html`. */
  html?: string
  /** Page URL used for `location`, defaults to the first `@match`. */
  url?: string
  /** Extra build options. */
  build?: BuildOptions
}

export interface ScriptHarness {
  script: BuiltScript
  window: Window
  document: Document
  mock: GmMock
  /** Runs the bundle again (after changing the DOM, for example). */
  run(): void
  /** Restores the globals that were swapped in. */
  dispose(): void
}

const SWAPPED = [
  'window',
  'document',
  'location',
  'navigator',
  'localStorage',
  'sessionStorage',
  'self',
  'top',
  'parent',
  'MutationObserver',
  'IntersectionObserver',
  'ResizeObserver',
  'HTMLElement',
  'Element',
  'Node',
  'Event',
  'CustomEvent',
  'KeyboardEvent',
  'MouseEvent',
  'getComputedStyle',
  'requestAnimationFrame',
  'cancelAnimationFrame',
  'matchMedia'
] as const

function readFixture(dir: string): string {
  const file = join(dir, 'fixture.html')
  if (!existsSync(file)) return ''
  const html = readFileSync(file, 'utf8')
  const body = /<body[^>]*>([\s\S]*?)<\/body>/i.exec(html)
  if (body) return body[1]!
  const head = /<head[^>]*>[\s\S]*?<\/head>/i.test(html)
  return head ? html.replace(/<head[^>]*>[\s\S]*?<\/head>/i, '') : html
}

export async function loadHappyDom(): Promise<typeof import('happy-dom')> {
  try {
    return await import('happy-dom')
  } catch {
    throw new Error('userscript-maker/testing needs happy-dom: run `bun add -d happy-dom` in your project')
  }
}

/**
 * Builds a script and runs it inside a happy-dom page with a GM mock, so tests
 * can assert on the DOM the userscript produces.
 *
 * ```ts
 * const harness = await createHarness('./scripts/my-script', { url: 'https://example.com/' })
 * expect(harness.document.querySelector('#demo')).not.toBeNull()
 * harness.dispose()
 * ```
 */
export async function createHarness(input: string, options: HarnessOptions = {}): Promise<ScriptHarness> {
  const { Window } = await loadHappyDom()
  const entry = await resolveEntry(input)
  const script = await buildScript(input, { write: false, ...options.build })

  const matches = Array.isArray(script.meta.match)
    ? script.meta.match
    : script.meta.match
      ? [script.meta.match]
      : []
  const url =
    options.url ?? matches.find(m => m !== '<all_urls>')?.replace(/\*$/, '') ?? 'https://example.com/'

  const window = new Window({ url })
  window.document.body.innerHTML = options.html ?? readFixture(scriptDir(entry))

  const saved = new Map<string, unknown>()
  const holder = globalThis as unknown as Record<string, unknown>
  for (const key of SWAPPED) {
    saved.set(key, holder[key])
    const value = (window as unknown as Record<string, unknown>)[key]
    if (value !== undefined) holder[key] = value
  }

  const syncGlobals = (): void => {
    const source = window as unknown as Record<string, unknown>
    for (const key of SWAPPED) {
      const value = source[key]
      if (value !== undefined) holder[key] = value
    }
    // happy-dom exposes addEventListener on the window object itself
    const sourceWindow = source as {
      addEventListener?: (type: string, cb: unknown, o?: unknown) => void
      removeEventListener?: (type: string, cb: unknown) => void
    }
    holder.addEventListener = sourceWindow.addEventListener?.bind(window)
    holder.removeEventListener = sourceWindow.removeEventListener?.bind(window)
  }

  const mock = installGmMock({
    window: holder as GmMockTarget,
    meta: {
      name: script.meta.name,
      namespace: script.meta.namespace,
      version: script.meta.version,
      description: script.meta.description
    }
  })
  syncGlobals()
  ;(window as unknown as Record<string, unknown>).GM = (holder as { GM?: unknown }).GM

  const run = (): void => {
    // The bundle is an IIFE that expects browser globals.
    new Function(script.body)()
  }

  return {
    script,
    window,
    document: window.document as unknown as Document,
    mock,
    run,
    dispose() {
      mock.restore()
      for (const [key, value] of saved) {
        if (value === undefined) delete holder[key]
        else holder[key] = value
      }
      void window.happyDOM.close()
    }
  }
}
