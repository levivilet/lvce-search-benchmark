import { setTimeout as delay } from 'node:timers/promises'
import type { Browser } from 'playwright'

// Let search-triggered workers finish starting before profile membership is frozen.
export async function settleTargets(browser: Browser, editor: string) {
  const session = await browser.newBrowserCDPSession()
  const start = performance.now()
  let previous = ''
  let since = start
  let observed: string[] = []
  try {
    while (performance.now() - start < 30000) {
      const { targetInfos } = await session.send('Target.getTargets')
      const targets = targetInfos.filter(x => ['page', 'worker', 'shared_worker', 'service_worker', 'iframe'].includes(x.type))
      observed = targets.map(target => target.title)
      const signature = targets.map(x => `${x.type}:${x.targetId}`).sort().join()
      if (signature !== previous) { previous = signature; since = performance.now() }
      const hasPage = targets.some(target => target.type === 'page')
      if (hasPage && performance.now() - since >= 500) return { editor, milliseconds: performance.now() - start, targets }
      await delay(100)
    }
    throw new Error(`Search targets did not finish initializing: ${JSON.stringify({ editor, observed })}`)
  } finally { await session.detach() }
}
