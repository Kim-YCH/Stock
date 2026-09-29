# Analysis Indicator Self-Healing Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make an individual stock analysis response fill missing technical indicators immediately from already-loaded price history, then repair persistent indicator rows asynchronously without slowing the chart request.

**Architecture:** A shared completeness contract identifies incomplete indicator rows. A pure O(N) calculator is extracted from the existing indicator writer and reused by the chart cache builder, while a small deduplicated Script Properties queue performs the existing Sheet-writing repair later. The daily watchdog also requires both matching date and complete values before treating a symbol as current.

**Tech Stack:** Google Apps Script JavaScript, Google Sheets, CacheService, Script Properties, time-based triggers, Node.js VM test harness.

## Global Constraints

- The analysis HTTP request must not write `Indicators`, `Signals`, or `IndicatorsLatest`.
- No new external network request may be added to chart loading.
- The chart response must reuse price rows already loaded for that symbol.
- Missing fields may be synthesized only when there are at least 60 valid closing-price rows.
- Background writes must be deduplicated, bounded, and isolated per symbol.
- Existing chart UI, screener, portfolio, and transaction behavior must remain unchanged.
- The release version will advance from `v11.27` to `v11.28`; `DATA_VERSION` remains `d4` because shared market-data semantics do not change.

---

### Task 1: Centralize Technical Completeness And Fix Daily Current Detection

**Files:**
- Modify: `private_backend/app.gs:6271-6345`
- Modify: `private_backend/app.gs:12052-12067`
- Create: `private_backend/tests/test-analysis-indicator-self-healing.js`

**Interfaces:**
- Produces: `analysisTechnicalChecks_(): Array<[string, string]>`.
- Produces: `hasCompleteAnalysisTechnicalValues_(indicator: Object): boolean`.
- Changes: `isDailyIndicatorSymbolCurrent_(symbol, dataDate)` returns true only when the latest row has the requested date and all required technical values.
- Consumes: existing `isValid_`, `getLatestIndicatorsMap_`, and `normalizeMarketDate_`.

- [ ] **Step 1: Write failing completeness tests**

Create `tests/test-analysis-indicator-self-healing.js` with the harness imports and assertions below. Build one complete row by assigning a finite number to every key returned by the desired contract, then delete one late-added field to prove the current partial contract is insufficient.

```js
const { buildContext, check, eq, ok, report } = require("./harness.js");

function completeIndicator(ctx, date) {
  const row = { date: date || "2026-09-28" };
  ctx.analysisTechnicalChecks_().forEach(pair => { row[pair[0]] = 1; });
  return row;
}

check("technical completeness covers every field shown by technicalStatus", () => {
  const ctx = buildContext();
  const row = completeIndicator(ctx);
  eq(ctx.hasCompleteAnalysisTechnicalValues_(row), true);
  delete row.superTrend;
  eq(ctx.hasCompleteAnalysisTechnicalValues_(row), false);
  ok(ctx.buildAnalysisTechnicalStatus_(row).missing.includes("SuperTrend"));
});

check("daily current requires matching date and complete technical values", () => {
  const ctx = buildContext();
  const row = completeIndicator(ctx, "2026-09-28");
  ctx.getLatestIndicatorsMap_ = () => ({ "2330": row });
  eq(ctx.isDailyIndicatorSymbolCurrent_("2330", "2026-09-28"), true);
  delete row.vwap20;
  eq(ctx.isDailyIndicatorSymbolCurrent_("2330", "2026-09-28"), false);
});
```

- [ ] **Step 2: Run the new test and verify RED**

Run:

```powershell
Set-Location private_backend
node tests/test-analysis-indicator-self-healing.js
```

Expected: FAIL because `analysisTechnicalChecks_` and `hasCompleteAnalysisTechnicalValues_` do not exist, and the daily check currently accepts date-only rows.

- [ ] **Step 3: Add the shared completeness contract**

Implement the following contract next to the existing analysis cache helpers, then replace the hard-coded checks in `hasAnalysisTechnicalValues_` and `buildAnalysisTechnicalStatus_` with it:

```js
function analysisTechnicalChecks_() {
  return [
    ["ma20", "MA20"], ["rsi14", "RSI14"], ["k9", "KD"],
    ["bbPercentB", "布林 %B"], ["atrPercent", "ATR %"], ["adx14", "ADX14"],
    ["high20", "20 日高"], ["low20", "20 日低"], ["ema20", "EMA20"],
    ["vwap20", "VWAP20"], ["obv", "OBV"], ["mfi14", "MFI14"],
    ["cci20", "CCI20"], ["superTrend", "SuperTrend"],
    ["donchianHigh20", "Donchian 20"], ["donchianLow20", "Donchian 20 下軌"]
  ];
}

function hasCompleteAnalysisTechnicalValues_(indicator) {
  return Boolean(indicator) && analysisTechnicalChecks_().every(pair => isValid_(indicator[pair[0]]));
}
```

Keep `hasAnalysisTechnicalValues_` as a compatibility wrapper that delegates to the new complete check. Make `buildAnalysisTechnicalStatus_` derive missing labels from `analysisTechnicalChecks_()` and de-duplicate labels before joining the message.

- [ ] **Step 4: Require completeness in the daily current check**

Change the function to:

```js
function isDailyIndicatorSymbolCurrent_(symbol, dataDate) {
  const map = getLatestIndicatorsMap_([symbol], { allowFullScan: false });
  const row = map[normalizeTwSymbol_(symbol)] || {};
  return normalizeMarketDate_(row.date, "") === normalizeMarketDate_(dataDate, "") &&
    hasCompleteAnalysisTechnicalValues_(row);
}
```

- [ ] **Step 5: Run focused tests and verify GREEN**

Run:

```powershell
node tests/test-analysis-indicator-self-healing.js
node tests/test-daily-indicator-queue.js
node tests/test-dashboard-indicator-window.js
```

Expected: all three commands exit 0.

- [ ] **Step 6: Commit the contract change**

```powershell
git add app.gs tests/test-analysis-indicator-self-healing.js
git commit -m "fix: require complete analysis indicators"
```

---

### Task 2: Extract Pure Indicator Calculation And Fill Analysis In Memory

**Files:**
- Modify: `private_backend/app.gs:6348-6440`
- Modify: `private_backend/app.gs:9017-9285`
- Modify: `private_backend/tests/test-analysis-indicator-self-healing.js`
- Modify: `private_backend/tests/test-indicators.js`

**Interfaces:**
- Produces: `calculateAnalysisRowsFromPrices_(priceRows: Object[], symbols?: string[]): { indicatorRows: Array<Array>, signalRows: Array<Array>, symbols: string[] }`.
- Produces: `indicatorRowsToObjects_(rows: Array<Array>): Object[]` using `HEADERS.Indicators`.
- Changes: `updateAnalysisFromPrices_` delegates all formula calculation to the pure helper, then performs only Sheet writes and latest-index updates.
- Changes: `buildAnalysisCacheForSymbol_` replaces incomplete stored indicators with pure in-memory rows when 60 valid price rows are available.

- [ ] **Step 1: Add failing pure-calculator and analysis-fallback tests**

Extend the new test file with a deterministic 70-row OHLCV series. Assert that the pure helper returns 70 indicator rows, includes finite values for every key in `analysisTechnicalChecks_()` on the latest row, and never touches SpreadsheetApp when passed price objects.

```js
function buildPriceObjects(symbol, count) {
  const start = Date.UTC(2026, 0, 2);
  return Array.from({ length: count }, (_, index) => {
    const close = 100 + index * 0.35 + 8 * Math.sin(index / 5);
    const open = close - 0.8 + Math.sin(index / 3);
    const date = new Date(start + index * 86400000).toISOString().slice(0, 10);
    return {
      date, symbol, name: "測試股", market: "TWSE", open,
      high: Math.max(open, close) + 2, low: Math.min(open, close) - 2,
      close, volume: 1000000 + index * 10000
    };
  });
}

function buildAnalysisWithoutSheet(ctx, prices, indicators) {
  ctx.getRecentRowsBySymbols_ = sheet => {
    if (sheet === "Prices") return prices;
    if (sheet === "Indicators") return indicators || [];
    return [];
  };
  ctx.writeDashboardCache_ = () => {};
  ctx.putCachedJson_ = () => {};
  ctx.queueAnalysisIndicatorRepair_ = () => ({ ok: true, queued: true, symbols: 1 });
  return ctx.buildAnalysisCacheForSymbol_("2330");
}

check("pure calculation produces every required technical value without Sheet access", () => {
  const ctx = buildContext({
    SpreadsheetApp: { getActiveSpreadsheet: () => { throw new Error("Sheet access forbidden"); } }
  });
  const prices = buildPriceObjects("2330", 70);
  const calculated = ctx.calculateAnalysisRowsFromPrices_(prices, ["2330"]);
  eq(calculated.indicatorRows.length, 70);
  const latest = ctx.indicatorRowsToObjects_(calculated.indicatorRows).slice(-1)[0];
  eq(ctx.hasCompleteAnalysisTechnicalValues_(latest), true);
});

check("analysis fills incomplete indicators in memory when 60 prices exist", () => {
  const ctx = buildContext();
  const prices = buildPriceObjects("2330", 70);
  const data = buildAnalysisWithoutSheet(ctx, prices,
    [{ date: prices[prices.length - 1].date, symbol: "2330", ma20: 100 }]);
  eq(data.technicalStatus.ok, true);
  eq(ctx.hasCompleteAnalysisTechnicalValues_(data.latest), true);
  ok(data.prices.some(row => isFinite(Number(row.ema20))));
  ok(data.prices.some(row => isFinite(Number(row.donchianHigh20))));
});

check("analysis keeps the missing status when history is too short", () => {
  const ctx = buildContext();
  const prices = buildPriceObjects("2330", 30);
  const data = buildAnalysisWithoutSheet(ctx, prices, []);
  eq(data.technicalStatus.ok, false);
});
```

- [ ] **Step 2: Run the focused test and verify RED**

Run:

```powershell
node tests/test-analysis-indicator-self-healing.js
```

Expected: FAIL because the pure calculator and object conversion functions do not exist and incomplete analysis rows remain incomplete.

- [ ] **Step 3: Extract the existing calculation body without changing formulas**

Move the normalization/grouping and the complete per-symbol calculation loop currently inside `updateAnalysisFromPrices_` into this pure boundary:

```js
function calculateAnalysisRowsFromPrices_(priceRows, symbols) {
  const targets = new Set((symbols || []).map(normalizeTwSymbol_).filter(Boolean));
  const grouped = {};
  (priceRows || [])
    .map(normalizePriceBarForStorage_)
    .filter(row => row && row.date && row.symbol && row.close !== "")
    .filter(row => !targets.size || targets.has(normalizeTwSymbol_(row.symbol)))
    .forEach(row => {
      const symbol = normalizeTwSymbol_(row.symbol);
      (grouped[symbol] = grouped[symbol] || []).push({
        date: new Date(normalizeMarketDate_(row.date, "")), symbol,
        name: String(row.name || "").trim(), market: String(row.market || "").trim(),
        open: Number(row.open), high: Number(row.high), low: Number(row.low),
        close: Number(row.close), volume: isFinite(Number(row.volume)) ? Number(row.volume) : 0
      });
    });
  const indicatorRows = [];
  const signalRows = [];
  // Relocate the existing lines that calculate MA/RSI/MACD/KD/ATR/ADX/high-low/EMA/VWAP/
  // OBV/MFI/CCI/SuperTrend/Donchian, scores, and signals here byte-for-byte.
  return { indicatorRows, signalRows, symbols: Object.keys(grouped) };
}
```

The relocation must preserve the exact current rounding, warm-up periods, score inputs, signal detection, and `INDICATORS_HISTORY_KEEP_DAYS` trimming. `updateAnalysisFromPrices_` must retain its existing scoped/full price read and all persistence logic, but obtain `indicatorRows` and `signalRows` from this helper.

- [ ] **Step 4: Add deterministic row-object conversion**

```js
function indicatorRowsToObjects_(rows) {
  return (rows || []).map(row => {
    const value = {};
    HEADERS.Indicators.forEach((header, index) => { value[header] = row[index] === undefined ? "" : row[index]; });
    return value;
  });
}
```

- [ ] **Step 5: Apply the in-memory fallback before chart rows are assembled**

In `buildAnalysisCacheForSymbol_`, make `indicators` mutable. Only on the normal single-symbol path (`sourceData` is absent), when `shouldRebuildAnalysisIndicatorsForSymbol_(symbol, source)` is true and `hasEnoughAnalysisHistory_(prices, 60)` is true, call the pure helper with the already-loaded `prices`, convert its indicator rows to objects, and use those objects for `indicatorByDate`, `latest`, and `technicalStatus`. Do not run this per-symbol fallback inside `buildAnalysisCacheForSymbols_`, because that bulk caller passes a shared `sourceData` table and would otherwise repeatedly filter the entire market. Do not call `updateAnalysisFromPrices_` from the normal analysis request and do not write Indicators/Signals/IndicatorsLatest.

Preserve the existing explicit `{ rebuildIndicatorsIfMissing: true }` branch only for non-HTTP maintenance callers; the normal in-memory path must run before it and must not require Sheet writes.

- [ ] **Step 6: Verify formula equivalence and fallback behavior**

Run:

```powershell
node tests/test-analysis-indicator-self-healing.js
node tests/test-indicators.js
node tests/test-isolation-analysis.js
node tests/check-syntax.js
```

Expected: all commands exit 0 and the existing golden indicator snapshot remains unchanged.

- [ ] **Step 7: Commit the calculation extraction**

```powershell
git add app.gs tests/test-analysis-indicator-self-healing.js tests/test-indicators.js
git commit -m "perf: fill chart indicators in memory"
```

---

### Task 3: Add A Deduplicated Background Persistence Queue

**Files:**
- Modify: `private_backend/app.gs:6348-6440`
- Modify: `private_backend/app.gs:12028-12043`
- Modify: `private_backend/app.gs:13514-13563`
- Modify: `private_backend/tests/test-analysis-indicator-self-healing.js`

**Interfaces:**
- Produces: `queueAnalysisIndicatorRepair_(symbol): { ok: boolean, queued: boolean, symbols: number }`.
- Produces: `runAnalysisIndicatorRepairs(event): { ok: boolean, attempted: number, remaining: number, failedSymbols: string[] }`.
- Stores: `STOCKLAB_ANALYSIS_REPAIR_QUEUE_V1` JSON with `symbols`, `attempts`, and `updatedAt`.
- Uses: `scheduleOneTimeTrigger_("runAnalysisIndicatorRepairs", 60000, { skipIfExists: true })`.

- [ ] **Step 1: Add failing queue tests**

Extend the self-healing test file with isolated Script Properties and a fake trigger service. Cover duplicate insertion, successful drain, failure isolation, retry limit, cache invalidation, and the analysis integration hook.

```js
const { scriptProps } = require("./harness.js");
const { makeScriptApp } = require("./fake-google.js");

function repairQueueContext(initialSymbols) {
  scriptProps.clear();
  const scriptApp = makeScriptApp();
  const ctx = buildContext({ ScriptApp: scriptApp });
  if ((initialSymbols || []).length) {
    scriptProps.set("STOCKLAB_ANALYSIS_REPAIR_QUEUE_V1", JSON.stringify({
      symbols: initialSymbols, attempts: {}, updatedAt: "2026-09-29 00:00:00"
    }));
  }
  return {
    ctx,
    createdHandlers: () => scriptApp._builders.map(item => item.handler),
    readQueue: () => JSON.parse(scriptProps.get("STOCKLAB_ANALYSIS_REPAIR_QUEUE_V1") ||
      '{"symbols":[],"attempts":{},"updatedAt":""}')
  };
}

check("repair queue deduplicates repeated symbols and schedules one worker", () => {
  const setup = repairQueueContext();
  setup.ctx.queueAnalysisIndicatorRepair_("2330");
  setup.ctx.queueAnalysisIndicatorRepair_("2330");
  setup.ctx.queueAnalysisIndicatorRepair_("1101");
  eq(setup.readQueue().symbols, ["2330", "1101"]);
  eq(setup.createdHandlers(), ["runAnalysisIndicatorRepairs"]);
});

check("repair worker persists symbols independently and clears their analysis caches", () => {
  const setup = repairQueueContext(["2330", "1101"]);
  const calls = [];
  setup.ctx.updateAnalysisFromPrices_ = symbols => {
    calls.push(symbols[0]);
    if (symbols[0] === "1101") throw new Error("simulated failure");
    return { ok: true };
  };
  setup.ctx.removeCachedJson_ = key => calls.push(key);
  setup.ctx.removeDashboardCacheKeys_ = keys => calls.push(keys[0]);
  const result = setup.ctx.runAnalysisIndicatorRepairs();
  ok(calls.includes("2330") && calls.includes("analysis:2330"));
  ok(result.failedSymbols.includes("1101"));
  ok(setup.readQueue().symbols.includes("1101"));
});
```

Also add an integration assertion that an incomplete 70-row analysis schedules `2330`, while a complete source and a 30-row source schedule nothing.

- [ ] **Step 2: Run the focused test and verify RED**

Run:

```powershell
node tests/test-analysis-indicator-self-healing.js
```

Expected: FAIL because the repair queue functions do not exist and the analysis builder does not enqueue repair work.

- [ ] **Step 3: Implement bounded queue state**

Add constants near the daily indicator job constants:

```js
const ANALYSIS_REPAIR_QUEUE_PROPERTY = "STOCKLAB_ANALYSIS_REPAIR_QUEUE_V1";
const ANALYSIS_REPAIR_BATCH_SIZE = 2;
const ANALYSIS_REPAIR_MAX_SYMBOLS = 100;
const ANALYSIS_REPAIR_MAX_ATTEMPTS = 3;
const ANALYSIS_REPAIR_TIME_BUDGET_MS = 150000;
```

Read malformed or absent state as `{ symbols: [], attempts: {}, updatedAt: "" }`. Normalize and de-duplicate symbols, cap the list at 100, and retain attempt counters only for queued symbols. All property writes must serialize this compact shape.

- [ ] **Step 4: Queue repairs without delaying the analysis response**

`queueAnalysisIndicatorRepair_` must add only a valid normalized symbol, preserve FIFO order, write state once, and call the existing one-shot scheduler with `skipIfExists: true`. Wrap trigger scheduling in `try/catch`; return `{ ok: false }` on scheduling failure but do not throw into `buildAnalysisCacheForSymbol_`.

Call it only after an incomplete stored indicator set was successfully replaced in memory. Store a response flag `technicalRepairPending: true` for observability; do not add or change frontend text.

- [ ] **Step 5: Implement the background worker**

`runAnalysisIndicatorRepairs` must acquire the normal script write lock and delete/consume any trigger for its own handler before processing, so a remaining queue can schedule a fresh invocation. Process at most two symbols and stop before 150 seconds. For each symbol:

```js
const result = updateAnalysisFromPrices_([symbol]);
if (!result || result.ok === false) throw new Error((result && result.message) || symbol + " 指標修復失敗");
if (String(result.warning || "").trim()) throw new Error(String(result.warning));
removeCachedJson_("analysis:" + symbol);
removeDashboardCacheKeys_(["analysis:" + symbol]);
```

On success, remove the symbol and its attempt counter. On failure, increment its counter, retain it at the tail when attempts remain, and discard it after three attempts while reporting it in `failedSymbols`. Persist state after every attempted symbol so execution interruption cannot lose work. If symbols remain, schedule another one-shot worker with `skipIfExists: true`.

- [ ] **Step 6: Verify queue behavior and existing scheduled jobs**

Run:

```powershell
node tests/test-analysis-indicator-self-healing.js
node tests/test-daily-indicator-queue.js
node tests/test-screener-data-job.js
node tests/test-screener-jobs.js
node tests/check-syntax.js
```

Expected: all commands exit 0.

- [ ] **Step 7: Commit the background repair queue**

```powershell
git add app.gs tests/test-analysis-indicator-self-healing.js
git commit -m "feat: repair incomplete chart indicators in background"
```

---

### Task 4: Release v11.28, Mirror Runtime Files, And Verify

**Files:**
- Modify: `private_backend/app.gs:1-2,14209`
- Modify: `private_backend/js/config.js:3`
- Modify: `private_backend/service-worker.js:13`
- Modify: `private_backend/tests/test-release-version.js`
- Modify: `js/config.js:3`
- Modify: `service-worker.js:13`

**Interfaces:**
- Produces: backend and frontend release identifier `v11.28`.
- Preserves: `DATA_VERSION = "d4"`, analysis schema behavior, API URL, HTML, CSS, and frontend JavaScript behavior.

- [ ] **Step 1: Change release assertions to v11.28 and verify RED**

Update only the expected version strings in `private_backend/tests/test-release-version.js`, then run:

```powershell
Set-Location private_backend
node tests/test-release-version.js
```

Expected: FAIL because runtime files still expose `v11.27`.

- [ ] **Step 2: Bump private runtime version tokens**

Change these exact tokens from `v11.27` to `v11.28`:

```text
private_backend/app.gs header, APP_VERSION, and END marker
private_backend/js/config.js APP_VERSION
private_backend/service-worker.js CACHE_VERSION
```

Do not change `DATA_VERSION`, schema constants, API URL, or unrelated cache keys.

- [ ] **Step 3: Mirror only public runtime version files**

Copy the finalized private frontend versions of `js/config.js` and `service-worker.js` to their root public counterparts. Confirm the diff contains version-token changes only.

- [ ] **Step 4: Run the complete backend suite**

Run from `private_backend`:

```powershell
node tests/check-syntax.js
Get-ChildItem tests\test-*.js | ForEach-Object {
  node $_.FullName
  if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }
}
```

Expected: syntax check and every `test-*.js` command exit 0.

- [ ] **Step 5: Inspect final diffs and version synchronization**

Run:

```powershell
git diff --check
git diff --stat
rg -n 'v11\.27|v11\.28' app.gs js/config.js service-worker.js tests/test-release-version.js
Set-Location ..
git diff --check
git diff --stat
rg -n 'v11\.27|v11\.28' js/config.js service-worker.js
```

Expected: no whitespace errors; runtime files expose `v11.28`; no current runtime file retains `v11.27`.

- [ ] **Step 6: Commit the private release**

From `private_backend`:

```powershell
git add app.gs js/config.js service-worker.js tests/test-release-version.js tests/test-analysis-indicator-self-healing.js tests/test-indicators.js
git commit -m "chore: release indicator self-healing as v11.28"
```

- [ ] **Step 7: Commit the public version mirror**

From the repository root:

```powershell
git add js/config.js service-worker.js
git commit -m "chore: publish indicator self-healing version v11.28"
```

- [ ] **Step 8: Request code review before deployment**

Provide the reviewer the private base and head SHAs, the approved design, this plan, and the requirement that chart requests never write indicator sheets. Resolve every Critical or Important finding, rerun the focused test plus the full suite, and only then prepare deployment and pushes when the user requests them.

## Completion Checklist

- [ ] An incomplete 60+ row analysis response contains every required technical value in the first response.
- [ ] The request path performs no Indicators/Signals/IndicatorsLatest write.
- [ ] The same symbol appears once in the background queue.
- [ ] Background failure does not block other symbols and stops retrying after three attempts.
- [ ] Daily current detection rejects partial rows with the right date.
- [ ] Golden indicator output is unchanged.
- [ ] Full backend test suite and syntax check exit 0.
- [ ] Both repositories expose `v11.28` with clean, scoped diffs.
