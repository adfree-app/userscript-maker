/**
 * Ambient types for the userscript manager APIs.
 *
 * ```ts
 * import 'userscript-maker/gm'
 * await GM.setValue('seen', 1)
 * ```
 *
 * Nothing is emitted at runtime — import it for the types only.
 */

export {}

type Value = string | number | boolean | null | undefined | Record<string, unknown> | unknown[]

interface GmRequestDetails {
  method?: string
  url: string
  headers?: Record<string, string>
  data?: string
  responseType?: 'text' | 'json' | 'blob' | 'arraybuffer'
  timeout?: number
  onload?: (response: GmResponse) => void
  onerror?: (response: GmResponse) => void
  ontimeout?: (response: GmResponse) => void
  onabort?: (response: GmResponse) => void
  onprogress?: (response: GmResponse) => void
}

interface GmResponse {
  responseText?: string
  response?: unknown
  readyState: number
  status: number
  statusText: string
  finalUrl?: string
  responseHeaders?: string
}

declare global {
  interface GmApi {
    info: {
      script: { name: string; namespace?: string; version?: string; description?: string }
      scriptMetaStr?: string
      scriptHandler?: string
      version?: string
    }
    getValue<T = unknown>(key: string, defaultValue?: T): Promise<T>
    setValue(key: string, value: Value): Promise<void>
    deleteValue(key: string): Promise<void>
    listValues(): Promise<string[]>
    xmlHttpRequest(details: GmRequestDetails): { abort(): void }
    addStyle(css: string): void
    notification?(text: string, title?: string, image?: string, onclick?: () => void): void
    openInTab(url: string, options?: { active?: boolean; insert?: boolean }): void
    setClipboard(text: string, type?: string): Promise<void>
    registerMenuCommand(caption: string, onClick: () => void, accessKey?: string): string | number
    unregisterMenuCommand(id: string | number): void
    getResourceUrl?(name: string): string
    getResourceText?(name: string): string
    download?(details: { url: string; name: string; headers?: Record<string, string> }): void
  }

  /** Legacy synchronous-ish API, kept for scripts that use it. */
  const GM_info: GmApi['info']
  const GM: GmApi
  const unsafeWindow: Window & typeof globalThis

  function GM_getValue<T = unknown>(key: string, defaultValue?: T): T
  function GM_setValue(key: string, value: Value): void
  function GM_deleteValue(key: string): void
  function GM_listValues(): string[]
  function GM_addStyle(css: string): HTMLStyleElement | undefined
  function GM_xmlhttpRequest(details: GmRequestDetails): { abort(): void }
  function GM_notification(text: string, title?: string, image?: string, onclick?: () => void): void
  function GM_openInTab(url: string, options?: { active?: boolean; insert?: boolean }): void
  function GM_setClipboard(text: string, type?: string): void
  function GM_registerMenuCommand(caption: string, onClick: () => void, accessKey?: string): string | number
  function GM_unregisterMenuCommand(id: string | number): void
  function GM_getResourceText(name: string): string
  function GM_getResourceURL(name: string): string
  function GM_download(details: { url: string; name: string; headers?: Record<string, string> }): void

  /** Compile-time constants injected by userscript-maker. */
  const __DEV__: boolean
  const __PROD__: boolean
  const __NAME__: string
  const __VERSION__: string
  const __BUILD_TIME__: string
  const __BUILD_HASH__: string

  interface Window {
    GM?: GmApi
    GM_info?: GmApi['info']
    unsafeWindow?: Window
  }
}
