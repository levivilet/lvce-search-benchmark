import type { Page } from 'playwright'

export interface SearchAdapter {
  input: string
  results: string
  row: string
  busy: string
  highlight: string
}

export const adapters: Record<string, SearchAdapter> = {
  lvce: {
    input: 'textarea[name="SearchValue"]',
    results: '.TreeItems',
    row: '.TreeItems [role="treeitem"]',
    busy: '[role=progressbar], [aria-busy=true]',
    highlight: '.Highlight, .SearchHighlight, [class*=Highlight], [class*=highlight], mark',
  },
  vscode: {
    input: '.search-view .search-widget input, .search-view textarea[aria-label*="Search"]',
    results: '.search-view .search-results, .search-view .monaco-list',
    row: '.search-view .monaco-list-row, .search-view .filematch, .search-view .match',
    busy: '.search-view [aria-busy=true], .search-view .progress-bit',
    highlight: '.search-view .findMatch, .search-view .match, .search-view mark, .search-view [class*=Highlight], .search-view [class*=highlight]',
  },
  cursor: {
    input: '.search-view .search-widget input, .search-view textarea[aria-label*="Search"]',
    results: '.search-view .search-results, .search-view .monaco-list',
    row: '.search-view .monaco-list-row, .search-view .filematch, .search-view .match',
    busy: '.search-view [aria-busy=true], .search-view .progress-bit',
    highlight: '.search-view .findMatch, .search-view .match, .search-view mark, .search-view [class*=Highlight], .search-view [class*=highlight]',
  },
  theia: {
    input: '.search-widget input, .search-widget textarea, textarea[aria-label*="Search"]',
    results: '.search-container, .search-results, .monaco-list',
    row: '.search-container .monaco-list-row, .search-result, .search-file-match',
    busy: '[aria-busy=true], .search-container .progress-bit',
    highlight: '.highlight, .Highlight, .findMatch, mark, [class*=Highlight], [class*=highlight]',
  },
}

export interface SearchResultSample {
  query: string
  milliseconds: number
  resultText: string
  rows: number
}

export const waitForSearch = async (page: Page, adapter: SearchAdapter, query: string, expectedPath: string, timeoutMs = 30000): Promise<SearchResultSample> => {
  return await page.evaluate(({ adapter, query, expectedPath, timeoutMs }) => new Promise((resolve, reject) => {
    const visible = (element: Element) => Boolean(element.getClientRects().length)
    const input = [...document.querySelectorAll<HTMLInputElement | HTMLTextAreaElement>(adapter.input)].find(visible)
    if (!input) return reject(new Error(`Search input missing: ${adapter.input}`))
    const host = window as typeof window & { __searchBenchmarkStart?: number }
    const started = host.__searchBenchmarkStart ?? performance.now()
    let previous = ''
    let stableFrames = 0
    let frame = 0
    const timeout = setTimeout(() => {
      cancelAnimationFrame(frame)
      const allRows = [...document.querySelectorAll(adapter.row)].filter(visible)
      const texts = allRows.map(row => row.textContent ?? '')
      const expectedRows = allRows.filter(row => row.textContent?.toLowerCase().includes(expectedPath.toLowerCase()))
      const diagnostic = { query, value: input.value, rows: texts.length, sample: texts.slice(0, 5), expectedHtml: expectedRows.slice(0, 2).map(row => row.outerHTML.slice(0, 1500)), highlights: allRows.flatMap(row => [...row.querySelectorAll(adapter.highlight)].map(element => ({ className: element.className, text: element.textContent }))).slice(0, 10), busy: [...document.querySelectorAll(adapter.busy)].filter(visible).map(element => element.outerHTML.slice(0, 500)), resultRoot: document.querySelector(adapter.results)?.outerHTML.slice(0, 500) }
      reject(new Error(`Search completion timeout: ${JSON.stringify(diagnostic)}`))
    }, timeoutMs)
    const tick = () => {
      const resultRoot = document.querySelector(adapter.results)
      const rows = [...document.querySelectorAll(adapter.row)].filter(visible)
      const texts = rows.map(row => row.textContent ?? '')
      const expected = texts.find(text => text.toLowerCase().includes(expectedPath.toLowerCase()))
      const highlightedQuery = rows.some(row => [...row.querySelectorAll(adapter.highlight)].some(element => visible(element) && element.textContent?.toLowerCase().includes(query.toLowerCase())))
      const busy = [...document.querySelectorAll(adapter.busy)].some(visible)
      const signature = texts.join('\n')
      const ready = input.value === query && resultRoot && visible(resultRoot) && expected && highlightedQuery && !busy
      stableFrames = ready && signature === previous ? stableFrames + 1 : 0
      previous = signature
      if (stableFrames >= 2) {
        clearTimeout(timeout)
        cancelAnimationFrame(frame)
        resolve({ query, milliseconds: performance.now() - started, resultText: expected!, rows: rows.length })
        return
      }
      frame = requestAnimationFrame(tick)
    }
    frame = requestAnimationFrame(tick)
  }), { adapter, query, expectedPath, timeoutMs })
}

export async function search(page: Page, editor: string, query: string, expectedPath: string): Promise<SearchResultSample> {
  const adapter = adapters[editor]
  if (!adapter) throw new Error(`No search adapter for ${editor}`)
  await page.keyboard.press('Escape').catch(() => {})
  await page.keyboard.press('Control+Shift+f')
  const input = page.locator(adapter.input).filter({ visible: true }).first()
  await input.waitFor({ state: 'visible', timeout: 15000 })
  await input.fill('')
  await page.evaluate(({ selector }) => {
    const element = document.querySelector<HTMLInputElement | HTMLTextAreaElement>(selector)
    if (!element) throw new Error(`Search input missing: ${selector}`)
    const host = window as typeof window & { __searchBenchmarkStart?: number }
    host.__searchBenchmarkStart = undefined
    element.addEventListener('input', () => { host.__searchBenchmarkStart = performance.now() }, { once: true })
  }, { selector: adapter.input })
  await input.fill(query)
  return await waitForSearch(page, adapter, query, expectedPath)
}
