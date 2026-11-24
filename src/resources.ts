/**
 * Access to files inlined from the `assets/` folder next to `index.ts`.
 *
 * The maker replaces this module with the real asset table at build time, so
 * these helpers work in the built userscript and in tests.
 */
const TABLE = '__USERSCRIPT_MAKER_RESOURCES__'

function table(): Record<string, string> {
  const holder = globalThis as unknown as Record<string, Record<string, string> | undefined>
  return holder[TABLE] ?? {}
}

/** Names of the inlined assets. */
export function listResources(): string[] {
  return Object.keys(table())
}

export function hasResource(name: string): boolean {
  return name in table()
}

/** The asset as a `data:` URL (usable as an `src`/`href`). */
export function getResource(name: string): string {
  const value = table()[name]
  if (value === undefined)
    throw new Error(`unknown resource: ${name} (available: ${listResources().join(', ') || 'none'})`)
  return value
}

/** The asset as text. */
export function getResourceText(name: string): string {
  return decode(getResource(name))
}

/** The asset as a base64 payload, without the `data:` prefix. */
export function getResourceBase64(name: string): string {
  return getResource(name).split(',')[1] ?? ''
}

/** The asset as a Blob (needs a MIME type in the table; defaults to text/plain). */
export function getResourceBlob(name: string): Blob {
  const url = getResource(name)
  const header = url.slice(5, url.indexOf(','))
  const type = header.split(';')[0] || 'text/plain'
  if (header.includes('base64')) {
    const binary = atob(url.split(',')[1] ?? '')
    const bytes = new Uint8Array(binary.length)
    for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i)
    return new Blob([bytes], { type })
  }
  return new Blob([decode(url)], { type })
}

function decode(dataUrl: string): string {
  const comma = dataUrl.indexOf(',')
  if (comma === -1) return dataUrl
  const header = dataUrl.slice(0, comma)
  const payload = dataUrl.slice(comma + 1)
  if (header.includes('base64')) {
    const binary = atob(payload)
    const bytes = new Uint8Array(binary.length)
    for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i)
    return new TextDecoder().decode(bytes)
  }
  return decodeURIComponent(payload)
}
