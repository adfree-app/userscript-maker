/**
 * ZIP writing for `userscript-maker pack`, on top of `fflate`.
 * Unzip-compatible deflate (no zlib header), no ZIP64, no encryption, no directories.
 */
import { crc32 as zlibCrc32 } from 'node:zlib'
import { strToU8, zipSync, type Zippable } from 'fflate'

export interface ZipEntry {
  name: string
  data: string | Uint8Array
}

export function crc32(bytes: Uint8Array): number {
  return zlibCrc32(bytes)
}

export function createZip(entries: ZipEntry[], now = new Date()): Uint8Array {
  const files: Zippable = {}
  for (const entry of entries) {
    const data = typeof entry.data === 'string' ? strToU8(entry.data) : entry.data
    files[entry.name] = [data, { mtime: now, level: 6 }]
  }
  return zipSync(files, { level: 6 })
}
