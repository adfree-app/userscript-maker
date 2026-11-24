/**
 * A userscript-manager mock, used by `userscript-maker dev` (browser) and by
 * the test harness (happy-dom). Single source of truth for both.
 */

export interface GmMockMeta {
  name?: string
  namespace?: string
  version?: string
  description?: string
}

/** Anything global-ish: `globalThis`, a happy-dom window, … */
export interface GmMockTarget {
  document?: Document
  localStorage?: Storage
  navigator?: Navigator
  open?: (url: string, target?: string) => unknown
  [key: string]: unknown
}

export interface GmMockOptions {
  /** Object to attach `GM`, `GM_*` and `unsafeWindow` to. Defaults to globalThis. */
  window?: GmMockTarget
  /** `name` → data URL, i.e. what `assets/` turns into. */
  resources?: Record<string, string>
  meta?: GmMockMeta
  /** Print every GM call to the console (dev harness). */
  verbose?: boolean
}

export interface GmMock {
  GM: Record<string, unknown>
  storage: Map<string, unknown>
  /** Every value passed to `GM.setClipboard`, in order. */
  clipboard: string[]
  /** Every call, in order — handy in tests. */
  log: Array<{ api: string; args: unknown[] }>
  restore(): void
}

export function installGmMock(options: GmMockOptions = {}): GmMock {
  const target: GmMockTarget = options.window ?? (globalThis as unknown as GmMockTarget)
  const storage = new Map<string, unknown>()
  const clipboard: string[] = []
  const readResources = (): Record<string, string> => ({
    ...options.resources,
    ...(target.__USERSCRIPT_MAKER_RESOURCES__ as Record<string, string> | undefined)
  })
  const log: Array<{ api: string; args: unknown[] }> = []
  const menuCommands = new Map<string | number, () => void>()

  // Read earlier values from localStorage so reloading the harness keeps state.
  try {
    const saved = target.localStorage?.getItem('__userscript_mock_storage__')
    if (saved)
      for (const [key, value] of Object.entries(JSON.parse(saved) as Record<string, unknown>))
        storage.set(key, value)
  } catch {
    // storage unavailable, stay in memory
  }

  const persist = (): void => {
    try {
      target.localStorage?.setItem('__userscript_mock_storage__', JSON.stringify(Object.fromEntries(storage)))
    } catch {
      // ignore quota / disabled storage
    }
  }

  const record = (api: string, args: unknown[]): void => {
    log.push({ api, args })
    if (options.verbose) console.debug(`[GM mock] ${api}`, ...args)
  }

  const addStyle = (css: string): unknown => {
    record('addStyle', [css])
    const doc = target.document
    if (!doc?.head) return undefined
    const style = doc.createElement('style')
    style.textContent = css
    doc.head.append(style)
    return style
  }

  const xmlHttpRequest = (details: {
    method?: string
    url: string
    headers?: Record<string, string>
    data?: string
    responseType?: string
    onload?: (r: unknown) => void
    onerror?: (r: unknown) => void
  }) => {
    record('xmlHttpRequest', [details])
    const controller = new AbortController()
    void (async () => {
      try {
        const response = await fetch(details.url, {
          method: details.method ?? 'GET',
          headers: details.headers,
          body: details.data,
          signal: controller.signal
        })
        const text = await response.text()
        details.onload?.({
          readyState: 4,
          status: response.status,
          statusText: response.statusText,
          responseText: text,
          response: details.responseType === 'json' ? safeJson(text) : text,
          finalUrl: response.url,
          responseHeaders: [...response.headers].map(([k, v]) => `${k}: ${v}`).join('\r\n')
        })
      } catch (error) {
        details.onerror?.({ readyState: 4, status: 0, statusText: String(error) })
      }
    })()
    return { abort: () => controller.abort() }
  }

  const info = {
    script: {
      name: options.meta?.name ?? 'mock-script',
      namespace: options.meta?.namespace,
      version: options.meta?.version,
      description: options.meta?.description
    },
    scriptMetaStr: undefined,
    scriptHandler: 'userscript-maker mock',
    version: '0.1.0'
  }

  const GM = {
    info,
    async getValue(key: string, defaultValue?: unknown) {
      record('getValue', [key, defaultValue])
      return storage.has(key) ? storage.get(key) : defaultValue
    },
    async setValue(key: string, value: unknown) {
      record('setValue', [key, value])
      storage.set(key, value)
      persist()
    },
    async deleteValue(key: string) {
      record('deleteValue', [key])
      storage.delete(key)
      persist()
    },
    async listValues() {
      record('listValues', [])
      return [...storage.keys()]
    },
    xmlHttpRequest,
    addStyle,
    notification(text: string, title?: string) {
      record('notification', [text, title])
      console.info(`[GM mock] notification: ${title ?? ''} ${text}`)
    },
    openInTab(url: string) {
      record('openInTab', [url])
      target.open?.(url, '_blank')
    },
    async setClipboard(text: string) {
      record('setClipboard', [text])
      clipboard.push(text)
      try {
        await (target.navigator as Navigator | undefined)?.clipboard?.writeText(text)
      } catch {
        // clipboard blocked, nothing to do
      }
    },
    registerMenuCommand(caption: string, onClick: () => void) {
      record('registerMenuCommand', [caption])
      const id = `menu-${menuCommands.size + 1}`
      menuCommands.set(id, onClick)
      return id
    },
    unregisterMenuCommand(id: string | number) {
      record('unregisterMenuCommand', [id])
      menuCommands.delete(id)
    },
    getResourceUrl(name: string) {
      record('getResourceUrl', [name])
      return readResources()[name] ?? 'data:text/plain,'
    },
    getResourceText(name: string) {
      record('getResourceText', [name])
      return decodeDataUrl(readResources()[name] ?? '')
    },
    download(details: { url: string; name: string }) {
      record('download', [details])
      console.info(`[GM mock] download ${details.name} ← ${details.url}`)
    }
  }

  const legacy: Record<string, unknown> = {
    GM_info: info,
    GM_getValue: <T>(key: string, defaultValue?: T): T =>
      (storage.has(key) ? storage.get(key) : defaultValue) as T,
    GM_setValue: (key: string, value: unknown) => {
      storage.set(key, value)
      persist()
    },
    GM_deleteValue: (key: string) => {
      storage.delete(key)
      persist()
    },
    GM_listValues: () => [...storage.keys()],
    GM_addStyle: addStyle,
    GM_xmlhttpRequest: xmlHttpRequest,
    GM_notification: GM.notification,
    GM_openInTab: GM.openInTab,
    GM_setClipboard: GM.setClipboard,
    GM_registerMenuCommand: GM.registerMenuCommand,
    GM_unregisterMenuCommand: GM.unregisterMenuCommand,
    GM_getResourceText: GM.getResourceText,
    GM_getResourceURL: GM.getResourceUrl,
    GM_download: GM.download
  }

  const previous = new Map<string, unknown>()
  const remember = (key: string) => {
    if (!previous.has(key)) previous.set(key, target[key])
  }

  for (const [key, value] of Object.entries(legacy)) {
    remember(key)
    target[key] = value
  }
  remember('GM')
  target.GM = GM
  remember('unsafeWindow')
  target.unsafeWindow = target.window ?? target
  remember('__USERSCRIPT_MAKER_RESOURCES__')
  target.__USERSCRIPT_MAKER_RESOURCES__ = readResources()

  return {
    GM,
    storage,
    clipboard,
    log,
    restore() {
      for (const [key, value] of previous) {
        if (value === undefined) delete target[key]
        else target[key] = value
      }
    }
  }
}

function decodeDataUrl(url: string): string {
  const comma = url.indexOf(',')
  if (comma === -1) return url
  const header = url.slice(0, comma)
  const payload = url.slice(comma + 1)
  if (header.includes('base64')) {
    const binary = atob(payload)
    const bytes = new Uint8Array(binary.length)
    for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i)
    return new TextDecoder().decode(bytes)
  }
  return decodeURIComponent(payload)
}

function safeJson(text: string): unknown {
  try {
    return JSON.parse(text)
  } catch {
    return text
  }
}
