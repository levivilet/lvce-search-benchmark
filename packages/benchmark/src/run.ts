import { readFile, mkdir, writeFile } from 'node:fs/promises'
import { execFileSync } from 'node:child_process'
import { launch, type Editor } from './launch.ts'
import { settleTargets } from './readiness.ts'
import { search } from './adapters.ts'
import { profileWorkload } from './profiles.ts'
import { measureRenderingWorkload } from './rendering.ts'
import { collectPaintMetrics } from './paintMetrics.ts'
import { parseArgs } from 'node:util'
const { values } = parseArgs({ options: { repeats: { type: 'string', default: '5' }, editor: { type: 'string' }, mode: { type: 'string' } } })
const repeats = Number(values.repeats)
if (!Number.isSafeInteger(repeats) || repeats < 1 || repeats > 100) throw new Error('repeats must be 1–100')
const editors: Editor[] = JSON.parse(await readFile('config/editors.lock.json', 'utf8'))
if (values.editor && !editors.some(x => x.id === values.editor)) throw new Error('Unknown editor')
if (values.mode && !['latency', 'profile', 'render', 'paint'].includes(values.mode)) throw new Error('Unknown mode')
const fixture = JSON.parse(await readFile('.tmp/fixture.json', 'utf8'))
const expectedCommit = '9df03c6d6ce97c6645c5846f6dfa2a6a7d276515'
if (fixture.commit !== expectedCommit || execFileSync('git', ['-C', '.tmp/fixture', 'rev-parse', 'HEAD'], { encoding: 'utf8' }).trim() !== expectedCommit || execFileSync('git', ['-C', '.tmp/fixture', 'status', '--porcelain'], { encoding: 'utf8' }).trim()) throw new Error('Fixture changed')
const queries = [{ query: 'export class QuickOpenModel', expectedPath: 'src/vs/base/parts/quickopen/browser/quickOpenModel.ts' }, { query: 'export interface IEditorOptions', expectedPath: 'src/vs/editor/common/config/editorOptions.ts' }]
const fixturePaths = execFileSync('git', ['-C', '.tmp/fixture', 'ls-files'], { encoding: 'utf8' }).split('\n')
for (const { expectedPath } of queries) {
  if (!fixturePaths.some(path => path.toLowerCase().endsWith(expectedPath.toLowerCase()))) throw new Error(`Missing expected fixture path ${expectedPath}`)
}
await mkdir('results', { recursive: true })
const report: any = { protocol: 'text-search-visible-result-two-frames-v1', created: new Date().toISOString(), fixture, editors, environment: { platform: process.platform, arch: process.arch, node: process.version }, repeats, queries, trials: [] }
for (let repeat = 0; repeat < repeats; repeat++) {
  // Alternate editor order across repetitions to reduce order bias.
  const order = repeat % 2 ? [...editors].reverse() : editors
  for (const editor of order.filter(x => !values.editor || x.id === values.editor)) for (const mode of ['latency', 'profile', 'render', 'paint'].filter(x => !values.mode || x === values.mode)) for (const { query, expectedPath } of queries) {
    const key = `${editor.id}-${mode}-${repeat}-${query}`
    const trial: any = { editor: editor.id, mode, repeat, query, expectedPath, status: 'failed' }
    let app: Awaited<ReturnType<typeof launch>> | undefined
    try {
      app = await launch(editor, mode === 'profile', `results/${key}.log`, editor.id === 'cursor' ? 60000 : 30000)
      trial.sample = await search(app.page, editor.id, query, expectedPath)
      if (mode !== 'paint' && !['cursor', 'theia'].includes(editor.id)) await app.page.keyboard.press('Escape')
      trial.readiness = await settleTargets(app.browser, editor.id)
      if (mode === 'profile') trial.profile = await profileWorkload(app, `results/${key}`, () => search(app!.page, editor.id, query, expectedPath))
      else if (mode === 'render') trial.rendering = await measureRenderingWorkload(app, `results/${key}.trace.json`, () => search(app!.page, editor.id, query, expectedPath))
      else if (mode === 'paint') trial.paintMetrics = await collectPaintMetrics(app.page)
      await app.page.screenshot({ path: `results/${key}.png` })
      trial.screenshot = `${key}.png`
      trial.status = 'passed'
    } catch (error) {
      trial.error = String(error)
      if (app) {
        try { await app.page.screenshot({ path: `results/${key}-failed.png`, fullPage: true }); trial.screenshot = `${key}-failed.png` } catch { /* Preserve the original benchmark failure. */ }
      }
      console.error(key, error)
    }
    finally {
      await app?.close().catch(error => { trial.status = 'failed'; trial.cleanupError = String(error) })
    }
    report.trials.push(trial)
    await writeFile('results/results.json', JSON.stringify(report, null, 2))
    console.log(key, trial.status)
  }
}
if (report.trials.some((trial: any) => trial.status !== 'passed')) process.exitCode = 1
