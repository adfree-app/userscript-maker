import { existsSync, readFileSync, watch, type FSWatcher } from 'node:fs'
import { join, resolve } from 'node:path'
import { buildScript, resolveEntry, slugFor, type BuildOptions, type BuiltScript } from './build'
import { scriptDir } from './assets'
import { harnessHtml } from './harness'

const MOCK_SOURCE = new URL('./gm-mock.ts', import.meta.url).pathname

export interface DevOptions extends BuildOptions {
  port?: number
  hostname?: string
}

export interface DevServer {
  /** One harness URL per script. */
  urls: string[]
  scripts: BuiltScript[]
  rebuild(): Promise<BuiltScript[]>
  stop(): Promise<void>
}

const RELOAD_PATH = '__userscript_dev__/events'

/** Compiles the GM mock into a browser IIFE the harness can load first. */
async function buildMock(): Promise<string> {
  const mockSource = await Bun.file(MOCK_SOURCE).text()
  const boot = `
const __host = globalThis as any;
installGmMock({
  window: __host,
  resources: __host.__USERSCRIPT_MAKER_RESOURCES__ ?? {},
  meta: __host.__US_META__ ?? {},
  verbose: true
});
`

  const result = await Bun.build({
    entrypoints: [MOCK_SOURCE],
    target: 'browser',
    format: 'iife',
    plugins: [
      {
        name: 'userscript-maker:mock-boot',
        setup(build) {
          build.onLoad({ filter: /.*/ }, args => {
            if (args.path !== MOCK_SOURCE) return undefined
            return { loader: 'ts', contents: `${mockSource}\n${boot}` }
          })
        }
      }
    ]
  })
  if (!result.success) {
    throw new Error(`could not build the GM mock\n${result.logs.map(l => l.message).join('\n')}`)
  }
  return await result.outputs[0]!.text()
}

function readFixture(dir: string): string {
  const file = join(dir, 'fixture.html')
  if (!existsSync(file)) return ''
  const html = readFileSync(file, 'utf8')
  const body = /<body[^>]*>([\s\S]*?)<\/body>/i.exec(html)
  return body ? body[1]! : html
}

/**
 * Builds the scripts, writes a self-contained harness page per script, and
 * serves them with live reload — no userscript manager needed.
 */
export async function startDevServer(inputs: string[], options: DevOptions = {}): Promise<DevServer> {
  const devOut = resolve(options.outDir ?? 'dist', '.dev')
  const mockPath = join(devOut, 'gm-mock.js')
  await Bun.write(mockPath, await buildMock())

  const clients = new Set<ReadableStreamDefaultController<Uint8Array>>()
  const broadcast = (): void => {
    const payload = new TextEncoder().encode('data: reload\n\n')
    for (const client of clients) {
      try {
        client.enqueue(payload)
      } catch {
        clients.delete(client)
      }
    }
  }

  const buildOptions: BuildOptions = {
    ...options,
    write: false,
    dev: true,
    minify: false,
    sourcemap: 'inline'
  }

  const buildAll = async (): Promise<BuiltScript[]> => {
    const built: BuiltScript[] = []
    for (const input of inputs) {
      const script = await buildScript(input, buildOptions)
      const entry = await resolveEntry(input)
      const slug = slugFor(input, entry)
      const dir = join(devOut, slug)
      await Bun.write(join(dir, 'script.user.js'), script.code)
      await Bun.write(
        join(dir, 'index.html'),
        harnessHtml({ script, reloadPath: `/${RELOAD_PATH}`, fixture: readFixture(scriptDir(entry)) })
      )
      built.push(script)
    }
    return built
  }

  let scripts = await buildAll()

  const port = options.port ?? Number(process.env.PORT ?? 4000)
  const hostname = options.hostname ?? 'localhost'

  const server = Bun.serve({
    port,
    hostname,
    async fetch(request) {
      const url = new URL(request.url)
      if (url.pathname === `/${RELOAD_PATH}`) {
        let controller: ReadableStreamDefaultController<Uint8Array> | undefined
        const stream = new ReadableStream<Uint8Array>({
          start(c) {
            controller = c
            clients.add(c)
            c.enqueue(new TextEncoder().encode(': connected\n\n'))
          },
          cancel() {
            if (controller) clients.delete(controller)
          }
        })
        return new Response(stream, {
          headers: {
            'content-type': 'text/event-stream',
            'cache-control': 'no-cache',
            connection: 'keep-alive'
          }
        })
      }

      if (url.pathname === '/' || url.pathname === '') {
        const links = scripts
          .map(
            s => `<li><a href="/${s.slug}/">${s.meta.name} <small>v${s.meta.version ?? '?'}</small></a></li>`
          )
          .join('')
        return new Response(
          `<!doctype html><meta charset="utf-8"><title>userscript-maker dev</title>
<body style="font:15px system-ui;padding:2rem"><h1>userscript-maker dev</h1><ul>${links}</ul>`,
          { headers: { 'content-type': 'text/html; charset=utf-8' } }
        )
      }

      const pathname = url.pathname.endsWith('/') ? `${url.pathname}index.html` : url.pathname
      const file = Bun.file(join(devOut, pathname))
      if (await file.exists()) {
        const type = pathname.endsWith('.html')
          ? 'text/html; charset=utf-8'
          : pathname.endsWith('.js')
            ? 'text/javascript; charset=utf-8'
            : undefined
        return new Response(file, type ? { headers: { 'content-type': type } } : undefined)
      }
      return new Response('not found', { status: 404 })
    }
  })

  const watchers: FSWatcher[] = []
  let timer: ReturnType<typeof setTimeout> | undefined
  for (const input of new Set(inputs)) {
    const dir = scriptDir(await resolveEntry(input))
    try {
      watchers.push(
        watch(dir, { recursive: true }, () => {
          clearTimeout(timer)
          timer = setTimeout(async () => {
            try {
              scripts = await buildAll()
              broadcast()
            } catch (error) {
              console.error(String((error as Error).message ?? error))
            }
          }, 150)
        })
      )
    } catch (error) {
      console.warn(`cannot watch ${dir}: ${String((error as Error).message)}`)
    }
  }

  return {
    urls: scripts.map(s => `http://${hostname}:${server.port}/${s.slug}/`),
    get scripts() {
      return scripts
    },
    async rebuild() {
      scripts = await buildAll()
      broadcast()
      return scripts
    },
    async stop() {
      clearTimeout(timer)
      for (const watcher of watchers) watcher.close()
      for (const client of clients) {
        try {
          client.close()
        } catch {
          // already gone
        }
      }
      await server.stop(true)
    }
  }
}
