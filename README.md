# LVCE search benchmark

Compare text-search behavior in desktop LVCE Editor, VS Code, Cursor, and Eclipse Theia. The benchmark measures query-to-visible-result latency, frontend/backend sampled JavaScript, Chromium style recalculation and paint duration, and Paint Profiler command instructions. Charts from `main` are published at https://levivilet.github.io/lvce-search-benchmark/.

## Run

Linux x64, Node 24.15+, Git, `tar`, `dpkg-deb`, `ripgrep` (`rg`), and Electron system libraries are required. Editor binaries are pinned with SHA256 checksums in `config/editors.lock.json`. Theia's official Linux AppImage is extracted during setup, so FUSE is not required. The benchmark fixture is the VS Code source tree at tag 1.39.0, commit `9df03c6d6ce97c6645c5846f6dfa2a6a7d276515`. Setup downloads about 900 MB. No fixture dependencies are installed or executed.

```sh
npm ci
npm run setup
xvfb-run -a npm run benchmark -- --repeats 5
npm run report
# Serve site/ with any static HTTP server.
```

Use `--editor lvce`, `--editor vscode`, `--editor cursor`, or `--editor theia`; use `--mode latency`, `--mode profile`, `--mode render`, or `--mode paint` for focused diagnosis. These options overwrite `results/results.json`. Raw JSON, Chromium `.cpuprofile` files, rendering traces, screenshots, and application logs are retained in `results/`; `site/raw/` publishes them alongside the charts.

## Protocol

Each trial launches the same source fixture in a fresh editor profile, with separate Chromium user data and XDG config/data/cache/state directories. Cursor gets a temporary `HOME`; other editors keep the actual home directory. The editor process tree is stopped and its profile removed on completion, launch failure, timeout, or editor crash. Runs use Xvfb and do not control an existing desktop editor. Third-party extensions, updates, and telemetry are disabled where supported.

The fixed queries are `QuickOpenModel` and `editorOptions`; each has a pinned expected source path. A trial opens the editor's workspace text-search UI, enters one query, and records the visible-result update. Completion requires the exact current query in the input, an expected fixture result whose highlight contains the query, no visible busy indicator, and stable result rows across animation frames. Stale results, missing expected paths, crashes, and timeouts fail the trial. This measures a query-qualified visible update, not exhaustive filesystem-search completion or physical display latency. Each measurement mode runs separately; profile, trace, and paint instrumentation do not affect the latency pass.

The comparison uses the same tracked source tree and literal queries with each editor’s default search options. Editor-native case handling, exclusions, and search algorithms remain in effect and can differ. Order alternates across repetitions. The operating-system cache is not flushed, so these are warm machine-cache measurements, not cold disk-cache results.

### JavaScript profiles

Profiling runs separately with V8 sampling at 1 ms:

- Frontend includes discovered Chromium page, worker, iframe, and service-worker isolates, deduplicated by V8 isolate ID.
- Renderer JavaScript reports the identified top-level application page isolate. Workers and iframes are excluded from this submetric but included in the broader frontend total.
- Backend includes Electron main and every live utility created by `utilityProcess.fork`. Theia's forked backend process is instrumented too.
- Node worker threads, standalone child processes, native ripgrep, Chromium browser, GPU, and other native CPU time are not measured. These are sampled JavaScript estimates, not total search cost or instruction counts.

Missing profiles or changed target/process membership invalidate the trial; they never produce synthetic zeros. A valid profile with only idle samples can report zero JavaScript time. Raw profiles retain each process's identity, interval, and sample count.

### Paint measurements

The separate render pass traces Chromium `UpdateLayoutTree` durations for main-frame CSS style recalculation and main-frame `Paint` event durations. Event counts and duration totals are reported in milliseconds. Missing style or paint evidence fails the measurement. Tracing adds overhead. GPU is disabled, so results exclude GPU rasterization, compositing, and physical display latency.

The paint pass uses Chromium Paint Profiler to collect exact command method names from final content-layer snapshots after matching results are visible. Charts report the average, minimum, and maximum command counts and command types across available snapshots. This is a final snapshot, not cumulative paint work while results update. Missing methods in an available snapshot count as zero; unavailable snapshots and failed trials are excluded and raw evidence is retained.

## Validation and CI

```sh
npm run type-check
npm run lint
npx playwright install --with-deps chromium
npm test
```

Tests cover result completion, stale/incomplete searches, invalid profiles and traces, aggregation, paint instruction accounting, and failure reporting. Every pull request must pass `Check` and `Desktop search benchmark (four editors)`, which runs real desktop latency, profiling, rendering, and paint trials for all four editors and both queries. Main runs five repetitions, publishes raw results, builds the report, and deploys Pages only after successful benchmarking.
