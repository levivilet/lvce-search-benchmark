import { setTimeout as delay } from 'node:timers/promises'
import type { Browser } from 'playwright'
import type { Protocol } from './protocol.ts'

// Let search-triggered workers finish starting before profile membership is frozen.
export async function settleTargets(browser: Browser, editor: string, main?: Protocol) {
  const session = await browser.newBrowserCDPSession()
  const start = performance.now()
  let previous = ''
  let since = start
  let observed: string[] = []
  try {
    while (performance.now() - start < 30000) {
      const { targetInfos } = await session.send('Target.getTargets')
      const targets = targetInfos.filter(x => ['page', 'worker', 'shared_worker', 'service_worker', 'iframe'].includes(x.type))
      const processes: { pid: number; serviceName?: string }[] = main ? (await main.send('Runtime.evaluate', { expression: 'globalThis.__benchmarkProcesses.filter(x => x.alive)', returnByValue: true })).result.value : []
      observed = [...targets.map(target => target.title), ...processes.map(process => process.serviceName ?? String(process.pid))]
      const signature = [...targets.map(x => `${x.type}:${x.targetId}`), ...processes.map(x => `process:${x.pid}`)].sort().join()
      if (signature !== previous) { previous = signature; since = performance.now() }
      const hasPage = targets.some(target => target.type === 'page')
      const hasSyntaxWorker = editor !== 'vscode' || targets.some(target => target.type === 'worker' && target.title === 'TextMateWorker')
      const hasTerminalHost = editor !== 'cursor' || !main || processes.some(process => process.serviceName?.startsWith('ptyHost-'))
      if (hasPage && hasSyntaxWorker && hasTerminalHost && performance.now() - since >= 500) return { editor, milliseconds: performance.now() - start, targets }
      await delay(100)
    }
    throw new Error(`Search targets did not finish initializing: ${JSON.stringify({ editor, observed })}`)
  } finally { await session.detach() }
}
