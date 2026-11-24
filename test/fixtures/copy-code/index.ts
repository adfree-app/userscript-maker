import { defineMeta } from 'userscript-maker'
import 'userscript-maker/gm'
import { getResource, getResourceText } from 'userscript-maker/resources'

defineMeta({
  name: 'Copy code button',
  namespace: 'https://github.com/tachibana-shin/userscripts/copy-code',
  version: '1.2.0',
  description: 'Adds a copy button to every <pre><code> block and shows a toast when it worked.',
  author: 'tachibana-shin',
  license: 'MIT',
  homepage: 'https://github.com/tachibana-shin/userscripts',
  match: ['https://docs.example.com/*', 'https://developer.mozilla.org/*'],
  grant: ['GM.setClipboard'],
  runAt: 'document-idle'
})

// assets/ is inlined at build time: no extra @resource or network call.
const ICON = getResource('copy.svg')
const TOAST_CSS = getResourceText('toast.css')

function boostrapToast(): void {
  const style = document.createElement('style')
  style.textContent = TOAST_CSS
  document.head.append(style)
}

async function copy(text: string, button: HTMLButtonElement): Promise<void> {
  try {
    await GM.setClipboard(text, 'text')
  } catch {
    await navigator.clipboard.writeText(text)
  }
  button.dataset.state = 'copied'
  button.title = 'Copied!'
  setTimeout(() => {
    button.dataset.state = ''
    button.title = 'Copy code'
  }, 1400)
}

function enhance(block: HTMLElement): void {
  if (block.dataset.copyReady) return
  block.dataset.copyReady = '1'

  const button = document.createElement('button')
  button.className = 'userscript-copy-code'
  button.title = 'Copy code'

  const icon = document.createElement('img')
  icon.src = ICON
  icon.alt = ''
  icon.width = 14
  icon.height = 14
  button.append(icon)
  button.addEventListener('click', () => void copy(block.textContent ?? '', button))
  block.append(button)
}

function scan(): void {
  for (const block of document.querySelectorAll<HTMLElement>('pre > code')) {
    enhance(block.parentElement ?? block)
  }
}

boostrapToast()
scan()
new MutationObserver(scan).observe(document.body, { childList: true, subtree: true })

if (__DEV__) console.debug(`[${__NAME__} v${__VERSION__}] copy buttons armed`)
