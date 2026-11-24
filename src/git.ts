/** Small helpers around the local git checkout. */

async function run(cmd: string[], cwd: string): Promise<string | null> {
  try {
    const proc = Bun.spawn(cmd, { cwd, stdout: 'pipe', stderr: 'ignore', stdin: 'ignore' })
    const output = await new Response(proc.stdout).text()
    const code = await proc.exited
    return code === 0 ? output.trim() : null
  } catch {
    return null
  }
}

/** `git@github.com:user/repo.git` → `https://github.com/user/repo`. */
export function normalizeRemoteUrl(remote: string): string | null {
  const value = remote.trim()
  if (!value) return null
  if (/^https?:\/\//.test(value)) return value.replace(/\.git$/, '').replace(/\/$/, '')
  const ssh = /^(?:ssh:\/\/)?git@([^:/]+)[:/](.+?)(?:\.git)?$/.exec(value)
  if (ssh) return `https://${ssh[1]}/${ssh[2]}`
  return null
}

export async function gitRemoteUrl(dir: string): Promise<string | null> {
  const remote = await run(['git', 'config', '--get', 'remote.origin.url'], dir)
  return remote ? normalizeRemoteUrl(remote) : null
}

/** Most recent tag (or `--always` short hash) of the repository. */
export async function gitVersion(dir: string): Promise<string | null> {
  const described = await run(['git', 'describe', '--tags', '--abbrev=0'], dir)
  if (described) return described.replace(/^v/, '')
  const exact = await run(['git', 'describe', '--tags', '--dirty'], dir)
  if (exact) return exact.replace(/^v/, '').replace(/-dirty$/, '')
  return null
}

export async function gitUserName(dir: string): Promise<string | null> {
  return await run(['git', 'config', '--get', 'user.name'], dir)
}

export async function gitCommitHash(dir: string): Promise<string | null> {
  return await run(['git', 'rev-parse', '--short', 'HEAD'], dir)
}
