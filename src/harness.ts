import type { BuiltScript } from './build'

export interface HarnessInput {
  script: BuiltScript
  /** SSE endpoint used for live reload. */
  reloadPath?: string
  /** Markup injected before the script runs (from `fixture.html`). */
  fixture?: string
  /** Show the metadata/lint side panel. */
  showPanel?: boolean
}

const escape = (text: string): string =>
  text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')

/** A self-contained page that loads the GM mock, the metadata and the script. */
export function harnessHtml({ script, reloadPath, fixture = '', showPanel = true }: HarnessInput): string {
  const meta = script.meta
  const matches = Array.isArray(meta.match) ? meta.match : meta.match ? [meta.match] : []
  const grants = Array.isArray(meta.grant) ? meta.grant : meta.grant ? [meta.grant] : []
  const issues = script.issues
    .map(
      issue =>
        `<li class="${issue.level}"><b>${issue.level}</b> <code>${escape(issue.code)}</code> ${escape(issue.message)}</li>`
    )
    .join('')

  const panel = showPanel
    ? `<aside id="__us_panel" style="position:fixed;inset:auto 0 0 0;z-index:2147483647;max-height:45vh;overflow:auto;
        font:12px/1.5 ui-monospace,monospace;background:#0b1020;color:#dbe4ff;padding:.6rem .9rem;border-top:1px solid #2a3352">
        <strong>${escape(meta.name ?? 'userscript')}</strong> <span style="opacity:.7">v${escape(meta.version ?? '?')}${script.stats.total ? ` · ${script.stats.total} B` : ''}</span>
        <div style="opacity:.8">match: ${escape(matches.join(', ') || '(none)')} · grant: ${escape(grants.join(', ') || '(none)')}</div>
        ${issues ? `<ul style="margin:.4rem 0 0;padding-left:1.1rem">${issues}</ul>` : '<div style="opacity:.6">no lint issues</div>'}
      </aside>`
    : ''

  const reload = reloadPath
    ? `<script>
  (() => {
    const source = new EventSource(${JSON.stringify(reloadPath)});
    source.onmessage = () => location.reload();
  })();
</script>`
    : ''

  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${escape(meta.name ?? 'userscript')} — userscript-maker dev</title>
<style>body{margin:0 0 ${panel ? '45vh' : '0'};font:14px system-ui,sans-serif}
#__us_panel .error{color:#ff8a8a}#__us_panel .warn{color:#ffd479}</style>
</head>
<body>
${fixture}
${panel}
<script>
  globalThis.__US_META__ = ${JSON.stringify({
    name: meta.name,
    namespace: meta.namespace,
    version: meta.version,
    description: meta.description
  })};
</script>
<script src="/gm-mock.js"></script>
<script src="./script.user.js"></script>
${reload}
</body>
</html>
`
}
