import type { Page } from 'playwright'

export interface SearchAdapter {
  results: string
  row: string
  busy: string
  highlight: string
}

export const adapters: Record<string, SearchAdapter> = {
  lvce: {
    results: '.TreeItems',
    row: '.TreeItems [role="treeitem"]',
    busy: '[role=progressbar], [aria-busy=true]',
    highlight: '.Highlight, .SearchHighlight, [class*=Highlight], [class*=highlight], mark',
  },
  vscode: {
    results: '.search-view .search-results, .search-view .monaco-list',
    row: '.search-view .monaco-list-row, .search-view .filematch, .search-view .match',
    busy: '.search-view [aria-busy=true], .search-view .progress-bit',
    highlight: '.search-view .findMatch, .search-view .match, .search-view mark, .search-view [class*=Highlight], .search-view [class*=highlight]',
  },
  cursor: {
    results: '.search-view .search-results, .search-view .monaco-list',
    row: '.search-view .monaco-list-row, .search-view .filematch, .search-view .match',
    busy: '.search-view [aria-busy=true], .search-view .progress-bit',
    highlight: '.search-view .findMatch, .search-view .match, .search-view mark, .search-view [class*=Highlight], .search-view [class*=highlight]',
  },
  theia: {
    results: 'body',
    row: '[role="treeitem"], .theia-tree-node',
    busy: '[aria-busy=true], .search-container .progress-bit',
    highlight: '.highlight, .Highlight, .findMatch, mark, [class*=Highlight], [class*=highlight], [class*=match], [class*=Match]',
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
    const expectedName = expectedPath.split('/').at(-1)!.toLowerCase()
    const host = window as typeof window & { __searchBenchmarkStart?: number; __searchBenchmarkInput?: HTMLInputElement | HTMLTextAreaElement }
    const input = host.__searchBenchmarkInput
    if (!input) return reject(new Error('Search input missing: focused input was not recorded'))
    const started = host.__searchBenchmarkStart ?? performance.now()
    let previous = ''
    let stableFrames = 0
    let frame = 0
    const timeout = setTimeout(() => {
      cancelAnimationFrame(frame)
      const allRows = [...document.querySelectorAll(adapter.row)].filter(visible)
      const texts = allRows.map(row => row.textContent ?? '')
      const expectedRows = allRows.filter(row => `${row.textContent ?? ''} ${row.getAttribute('aria-label') ?? ''} ${row.getAttribute('title') ?? ''}`.toLowerCase().includes(expectedName))
      const fields = [...document.querySelectorAll<HTMLInputElement | HTMLTextAreaElement>('input,textarea')].filter(visible).map(element => ({ tag: element.tagName, type: element.getAttribute('type'), name: element.getAttribute('name'), aria: element.getAttribute('aria-label'), placeholder: element.getAttribute('placeholder'), className: element.className, value: element.value }))
      const diagnostic = { query, value: input.value, rows: texts.length, sample: texts.slice(0, 5), expectedHtml: expectedRows.slice(0, 2).map(row => row.outerHTML.slice(0, 1500)), highlights: allRows.flatMap(row => [...row.querySelectorAll(adapter.highlight)].map(element => ({ className: element.className, text: element.textContent }))).slice(0, 10), busy: [...document.querySelectorAll(adapter.busy)].filter(visible).map(element => element.outerHTML.slice(0, 500)), resultRoot: document.querySelector(adapter.results)?.outerHTML.slice(0, 500), active: document.activeElement instanceof HTMLElement ? document.activeElement.outerHTML.slice(0, 500) : null, fields }
      reject(new Error(`Search completion timeout: ${JSON.stringify(diagnostic)}`))
    }, timeoutMs)
    const tick = () => {
      const resultRoot = document.querySelector(adapter.results)
      const rows = [...document.querySelectorAll(adapter.row)].filter(visible)
      const rowTexts = rows.map(row => `${row.textContent ?? ''} ${row.getAttribute('aria-label') ?? ''} ${row.getAttribute('title') ?? ''}`)
      const expected = rowTexts.find(text => text.toLowerCase().includes(expectedName))
      const highlightedQuery = rows.some(row => [...row.querySelectorAll(adapter.highlight)].some(element => visible(element) && element.textContent?.toLowerCase().includes(query.toLowerCase())))
      const busy = [...document.querySelectorAll(adapter.busy)].some(visible)
      const signature = rowTexts.join('\n')
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
  if (editor !== 'theia') await page.keyboard.press('Escape').catch(() => {})
  if (editor === 'cursor') {
    await page.keyboard.press('Control+Shift+p')
    await page.keyboard.insertText('Search: Find in Files')
    await page.keyboard.press('Enter')
  } else {
    await page.keyboard.press('Control+Shift+f')
  }
  await page.waitForFunction(() => {
    const element = document.activeElement
    return (element instanceof HTMLInputElement || element instanceof HTMLTextAreaElement) && Boolean(element.getClientRects().length) && /search/i.test(`${element.getAttribute('aria-label') ?? ''} ${element.getAttribute('placeholder') ?? ''} ${element.getAttribute('title') ?? ''}`)
  }, undefined, { timeout: 15000 }).catch(async error => {
    const fields = await page.locator('input,textarea').evaluateAll(elements => elements.filter(element => Boolean(element.getClientRects().length)).map(element => ({ tag: element.tagName, aria: element.getAttribute('aria-label'), placeholder: element.getAttribute('placeholder'), className: element.className, value: (element as HTMLInputElement).value })))
    throw new Error(`Search shortcut did not focus a visible text field in ${editor}: ${String(error)}; visible fields=${JSON.stringify(fields)}`)
  })
  await page.keyboard.press('Control+A')
  await page.keyboard.press('Backspace')
  await page.evaluate(() => {
    const element = document.activeElement
    if (!(element instanceof HTMLInputElement || element instanceof HTMLTextAreaElement)) throw new Error('Active search control is not a text input')
    const host = window as typeof window & { __searchBenchmarkStart?: number; __searchBenchmarkInput?: HTMLInputElement | HTMLTextAreaElement }
    host.__searchBenchmarkInput = element
    host.__searchBenchmarkStart = undefined
    element.addEventListener('input', () => { host.__searchBenchmarkStart = performance.now() }, { once: true })
  })
  await page.keyboard.insertText(query)
  return await waitForSearch(page, adapter, query, expectedPath)
}
