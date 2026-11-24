import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

export interface TempScript {
  dir: string
  entry: string
  cleanup(): Promise<void>
}

/** Creates a throwaway script folder: `makeScript({ 'index.ts': '...' })`. */
export async function makeScript(files: Record<string, string>): Promise<TempScript> {
  const dir = await mkdtemp(join(tmpdir(), 'usm-script-'))
  for (const [name, contents] of Object.entries(files)) {
    const file = join(dir, name)
    await mkdir(join(file, '..'), { recursive: true })
    await writeFile(file, contents)
  }
  return {
    dir,
    entry: join(dir, 'index.ts'),
    async cleanup() {
      await rm(dir, { recursive: true, force: true })
    }
  }
}

export function metaBlock(extra = ''): string {
  return `import { defineMeta } from 'userscript-maker'

defineMeta({
  name: 'Test script',
  namespace: 'https://example.com/test',
  version: '1.0.0',
  match: 'https://example.com/*'${extra}
})
`
}
