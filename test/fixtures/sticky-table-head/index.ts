import { defineMeta } from 'userscript-maker'
import _ from 'lodash'

defineMeta({
  name: 'Sticky table head',
  namespace: 'https://github.com/tachibana-shin/userscripts/sticky-table-head',
  version: '0.9.4',
  description:
    'Keeps <thead> visible while you scroll a long table. Loads lodash via @require instead of bundling it.',
  author: 'tachibana-shin',
  license: 'MIT',
  homepage: 'https://github.com/tachibana-shin/userscripts',
  match: ['https://*.example.com/reports/*'],
  grant: 'none',
  runAt: 'document-idle',
  icon: 'https://tachibana-shin.dev/userscripts/sticky.svg',
  custom: { contributionURL: 'https://tachibana-shin.dev/donate' }
})

/** Only used to make the clone look identical. */
function copyCellStyles(from: HTMLTableRowElement, to: HTMLTableRowElement): void {
  const sources = [...from.cells]
  const targets = [...to.cells]
  for (const [index, target] of targets.entries()) {
    const source = sources[index]
    if (!source) continue
    const computed = getComputedStyle(source)
    target.style.width = computed.width
    target.style.textAlign = computed.textAlign
  }
}

function attach(table: HTMLTableElement): void {
  if (table.dataset.stickyHead) return
  const head = table.tHead
  if (!head) return
  table.dataset.stickyHead = '1'

  const float = head.cloneNode(true) as HTMLTableSectionElement
  float.classList.add('userscript-sticky-head')
  for (const [index, row] of [...float.rows].entries()) {
    const original = head.rows[index]
    if (original) copyCellStyles(original, row)
  }

  const wrapper = document.createElement('div')
  wrapper.className = 'userscript-sticky-wrap'
  wrapper.append(float)
  table.before(wrapper)

  const sync = (): void => {
    const rect = table.getBoundingClientRect()
    const offset = table.tHead!.getBoundingClientRect().height
    const visible = rect.top < 0 && rect.bottom > offset
    wrapper.style.transform = visible ? `translateY(${-rect.top}px)` : 'translateY(-200%)'
  }

  // lodash comes from @require: not one byte of it is in this bundle.
  const onScroll = _.throttle(sync, 100, { leading: true, trailing: true })
  addEventListener('scroll', onScroll, { passive: true })
  addEventListener('resize', onScroll)
  sync()
}

const style = document.createElement('style')
style.textContent = `
  .userscript-sticky-wrap { position: sticky; top: 0; z-index: 3; will-change: transform; }
  .userscript-sticky-head { box-shadow: 0 6px 14px rgb(0 0 0 / 0.18); }
`
document.head.append(style)

for (const table of document.querySelectorAll<HTMLTableElement>('table')) attach(table)

if (__PROD__)
  console.debug(
    `[${__NAME__} v${__VERSION__}] ${document.querySelectorAll('[data-sticky-head]').length} table(s) armed`
  )
