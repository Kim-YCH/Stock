# Screener Batch Performance Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Reduce the measured 300.6-second full-market screener run to less than 90 seconds while preserving AND conditions, partial results, recovery, ten-row pages, and completed local paging.

**Architecture:** Persist the active snapshot's physical sheet block on each job, read only the next range, skip normal-path durable-result rescans, and return each compact batch directly to the browser. The browser merges running results locally and continues after 500 milliseconds; after those fixed costs are removed, the backend batch size rises from 200 to 500. Existing full-sheet and paged-result paths remain compatibility and recovery fallbacks.

**Tech Stack:** Google Apps Script, Google Sheets, CacheService, vanilla JavaScript, JSONP, Node.js VM tests, GitHub Pages.

## Global Constraints

- Release version is exactly `v11.26`.
- Every screener condition remains combined with AND logic.
- The result UI remains fixed at 10 rows per page.
- Compact rows contain only `symbol`, `name`, `market`, `industry`, `close`, `changePercent`, `volume`, `peRatio`, and `rsi14`.
- Keep the start button disabled and labelled `選股中` while a job is active.
- Keep `getScreenerResults`, completed full bundles, recovery triggers, owner isolation, and durable `ScreenerResults` as fallbacks.
- Do not persist result rows in browser storage.
- Public and private frontend runtime files remain byte-for-byte identical.
- Work in the canonical checkouts at `C:\Users\user\Desktop\git\Stock` and `C:\Users\user\Desktop\git\Stock\private_backend`; do not create persistent duplicate source folders.
- Do not push or deploy until the user explicitly requests it.

---

### Task 1: Persist snapshot block metadata and read only one batch range

**Files:**
- Modify: `private_backend/app.gs:129,2232-2241,3059-3103,3167-3189,3253-3283,3290-3323`
- Modify: `private_backend/tests/test-screener-jobs.js`

**Interfaces:**
- Produces: `findScreenerSnapshotBlock_(snapshotId) -> { startRow, rowCount } | null`.
- Produces: `readScreenerSnapshotBatch_(job, batchSize) -> { rows, startCursor, endCursor, complete }`.
- Extends screener jobs with optional numeric `snapshotStartRow` and `snapshotRowCount`.
- Extends `processScreenerBatch_(jobId, owner, batchSize, options)`; `options.snapshotRows` is used only by the first batch.

- [ ] **Step 1: Extend the fake-sheet fixture so range reads can be observed**

In `makeSpreadsheetJobFixture` inside `test-screener-jobs.js`, wrap the `ScreenerSnapshot` sheet's `getRange` method and collect `{ row, col, numRows, numCols }`. Return the collection from the fixture:

```js
const snapshotRanges = [];
const snapshotSheet = ss.getSheetByName("ScreenerSnapshot");
const getRange = snapshotSheet.getRange;
snapshotSheet.getRange = (row, col, numRows, numCols) => {
  snapshotRanges.push({ row, col, numRows, numCols });
  return getRange(row, col, numRows, numCols);
};
```

- [ ] **Step 2: Write failing snapshot block and range tests**

Add focused checks:

```js
check("snapshot block locator returns the contiguous active block", () => {
  const fixture = makeSpreadsheetJobFixture({ rowCount: 1200 });
  eq(fixture.ctx.findScreenerSnapshotBlock_("snap-1"), {
    startRow: 2,
    rowCount: 1200
  });
});

check("continuation reads only the next snapshot range", () => {
  const fixture = makeSpreadsheetJobFixture({ rowCount: 1200, cursor: 500 });
  fixture.ctx.processScreenerBatch_(fixture.job.jobId, fixture.job.ownerEmail, 500);
  ok(fixture.snapshotRanges.some(range => range.row === 502 && range.numRows === 500));
  eq(fixture.snapshotFullReads(), 0);
});

check("legacy jobs without block metadata retain the full-scan fallback", () => {
  const fixture = makeSpreadsheetJobFixture({ rowCount: 3, omitSnapshotBlock: true });
  fixture.ctx.processScreenerBatch_(fixture.job.jobId, fixture.job.ownerEmail, 2);
  eq(fixture.snapshotFullReads(), 1);
});
```

- [ ] **Step 3: Run the backend test and confirm RED**

Run:

```powershell
Set-Location private_backend
node tests\test-screener-jobs.js
```

Expected: FAIL because the block locator and range reader do not exist and continuation still scans the complete snapshot.

- [ ] **Step 4: Add optional job headers and summary fields**

Insert the two fields after `snapshotDate` in `HEADERS.ScreenerJobs` and include them in `summarizeScreenerJob_`:

```js
snapshotStartRow: Number(job.snapshotStartRow || 0),
snapshotRowCount: Number(job.snapshotRowCount || job.universeCount || 0),
```

`ensureHeader_` performs the existing non-destructive column migration.

- [ ] **Step 5: Implement snapshot block location and range conversion**

Add helpers beside `getActiveScreenerSnapshotRows_`:

```js
function findScreenerSnapshotBlock_(snapshotId) {
  const sheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(SHEETS.SCREENER_SNAPSHOT);
  if (!sheet || sheet.getLastRow() < 2) return null;
  const headers = sheet.getRange(1, 1, 1, sheet.getLastColumn()).getValues()[0].map(value => String(value).trim());
  const snapshotColumn = headers.indexOf("snapshotId");
  if (snapshotColumn < 0) return null;
  const values = sheet.getRange(2, snapshotColumn + 1, sheet.getLastRow() - 1, 1).getValues();
  const matches = values.map((row, index) => String(row[0] || "") === String(snapshotId || "") ? index + 2 : 0).filter(Boolean);
  if (!matches.length || matches[matches.length - 1] - matches[0] + 1 !== matches.length) return null;
  return { startRow: matches[0], rowCount: matches.length };
}

function readScreenerSnapshotBatch_(job, batchSize) {
  const sheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(SHEETS.SCREENER_SNAPSHOT);
  const startCursor = Math.max(0, Number(job.cursor || 0));
  const rowCount = Number(job.snapshotRowCount || job.universeCount || 0);
  const count = Math.min(Math.max(1, Number(batchSize || SCREENER_JOB_BATCH_SIZE)), Math.max(0, rowCount - startCursor));
  if (!sheet || !job.snapshotStartRow || count <= 0) return null;
  const headers = sheet.getRange(1, 1, 1, sheet.getLastColumn()).getValues()[0].map(value => String(value).trim());
  const values = sheet.getRange(Number(job.snapshotStartRow) + startCursor, 1, count, headers.length).getValues();
  const rows = values.map(row => rowToObject_(headers, row));
  if (rows.some(row => String(row.snapshotId || "") !== String(job.snapshotId || ""))) return null;
  return { rows, startCursor, endCursor: startCursor + rows.length, complete: startCursor + rows.length >= rowCount };
}
```

Normalize the symbol field after `rowToObject_` using the same symbol-column behavior as `getSheetObjects_`.

- [ ] **Step 6: Integrate the range reader with a legacy fallback**

At job creation, call `findScreenerSnapshotBlock_(snapshotId)` and store the block values. Pass the already-loaded `snapshotRows` into the first `processScreenerBatch_` call.

Inside `processScreenerBatch_`, prefer `options.snapshotRows` for the first call, then `readScreenerSnapshotBatch_`. Only when neither path validates should it execute the existing full-sheet filter and sort. Preserve cursor, progress, conditions, terminal status, and lock behavior.

- [ ] **Step 7: Run focused tests and confirm GREEN**

Run:

```powershell
node tests\test-screener-jobs.js
node tests\test-screener-recovery.js
node tests\check-syntax.js
```

Expected: all checks pass; the normal continuation has zero complete snapshot reads.

- [ ] **Step 8: Commit Task 1 in the backend repository**

```powershell
git add app.gs tests/test-screener-jobs.js
git commit -m "perf: read screener snapshots by batch range"
```

---

### Task 2: Remove normal result rescans and whole-job-sheet rewrites

**Files:**
- Modify: `private_backend/app.gs:3192-3197,3233-3283,3439-3457`
- Modify: `private_backend/tests/test-screener-jobs.js`

**Interfaces:**
- Produces: `writeScreenerJobAtIndex_(jobs, index) -> job`.
- Changes: `appendScreenerJobResults_(job, matches, options)`; `options.reconcile === true` enables durable deduplication.
- Normal batches append without reading `ScreenerResults`; retries with `attempts > 0` reconcile once.

- [ ] **Step 1: Write failing normal-path write tests**

Instrument `getSheetObjects_` and `writeObjectsToSheet_` in the fixture, then add:

```js
check("successful batches do not scan prior results or rewrite all jobs", () => {
  const fixture = makeSpreadsheetJobFixture({ rowCount: 600, cursor: 0 });
  fixture.ctx.processScreenerBatch_(fixture.job.jobId, fixture.job.ownerEmail, 500);
  eq(fixture.resultReads(), 0);
  eq(fixture.fullJobWrites(), 0);
  eq(fixture.singleJobWrites(), 1);
});
```

- [ ] **Step 2: Write a failing retry reconciliation test**

Seed one durable result for the retry batch, set `attempts: 1`, execute the batch, and assert one durable scan and one logical symbol after `readSortedScreenerResultRows_`:

```js
eq(fixture.resultReadsDuringAppend(), 1);
eq(fixture.ctx.readSortedScreenerResultRows_(job, owner, "symbol", "asc").map(row => row.symbol), ["1101", "2330"]);
```

- [ ] **Step 3: Run the backend test and confirm RED**

Run `node tests\test-screener-jobs.js`.

Expected: FAIL because every append scans `ScreenerResults` and every batch calls `writeScreenerJobs_`.

- [ ] **Step 4: Implement a single-row job writer**

Add:

```js
function writeScreenerJobAtIndex_(jobs, index) {
  const job = jobs[index];
  if (!job) throw new Error("找不到選股工作");
  const sheet = getOrCreateSheet_(SpreadsheetApp.getActiveSpreadsheet(), SHEETS.SCREENER_JOBS);
  ensureHeader_(sheet, HEADERS.ScreenerJobs);
  const values = HEADERS.ScreenerJobs.map(header => job[header] === undefined ? "" : job[header]);
  sheet.getRange(index + 2, 1, 1, HEADERS.ScreenerJobs.length).setValues([sanitizeSheetRows_([values])[0]]);
  putCachedJson_(screenerJobCacheKey_(job.jobId), job, SCREENER_QUERY_CACHE_TTL_SECONDS);
  return job;
}
```

Use it only for an existing job's successful batch update. Keep `writeScreenerJobs_` for create, purge, migration, and error transitions.

- [ ] **Step 5: Make durable deduplication conditional on recovery**

Change the append helper to build an empty `existing` set normally and populate it only when `options.reconcile === true`. Call it with:

```js
const inserted = appendScreenerJobResults_(job, result.matches, {
  reconcile: Number(job.attempts || 0) > 0
});
```

Keep cursor advancement after the append succeeds. Keep final result reads deduplicated by symbol.

- [ ] **Step 6: Run focused tests and confirm GREEN**

Run:

```powershell
node tests\test-screener-jobs.js
node tests\test-screener-recovery.js
node tests\test-isolation-candidates.js
node tests\check-syntax.js
```

Expected: all pass, normal batches perform zero result scans, and retry reconciliation preserves one logical row per symbol.

- [ ] **Step 7: Commit Task 2 in the backend repository**

```powershell
git add app.gs tests/test-screener-jobs.js
git commit -m "perf: avoid repeated screener result scans"
```

---

### Task 3: Return and locally merge incremental batch results

**Files:**
- Modify: `private_backend/app.gs:3253-3339,3398-3422`
- Modify: `private_backend/js/api.js:245-251`
- Modify: `private_backend/js/app.js:147-165,440-536,609-699,989-999`
- Modify: `private_backend/tests/test-screener-jobs.js`
- Modify: `private_backend/tests/test-screener-ui.js`

**Interfaces:**
- Backend response adds `batchResults: { jobId, startCursor, endCursor, revision, items }`.
- Browser API becomes `Api.startScreener(conditions, sortField, sortDirection, includeBatch = true)`.
- Produces frontend helpers `clearScreenerIncrementalResults_()`, `acceptScreenerBatchResults_(job, batchResults)`, and `getScreenerLocalRows_()`.

- [ ] **Step 1: Write failing compact batch response tests**

Add backend assertions:

```js
eq(response.batchResults.jobId, response.jobId);
eq(response.batchResults.startCursor, 0);
eq(response.batchResults.endCursor, 500);
eq(response.batchResults.revision, response.matchCount);
eq(Object.keys(response.batchResults.items[0]).sort(), [
  "changePercent", "close", "industry", "market", "name",
  "peRatio", "rsi14", "symbol", "volume"
]);
```

Add an API test proving `startScreener` sends `includeBatch=1` by default and `0` when disabled.

- [ ] **Step 2: Write failing incremental frontend tests**

Add to `test-screener-ui.js`:

```js
check("running batches merge by symbol and paginate locally", () => {
  const ui = loadRunUi();
  const job = { jobId: "job-live", status: "QUEUED", cursor: 4, matchCount: 3 };
  ok(ui.context.acceptScreenerBatchResults_(job, {
    jobId: "job-live", startCursor: 0, endCursor: 4, revision: 3,
    items: [
      { symbol: "2330", volume: 30 },
      { symbol: "1101", volume: 10 },
      { symbol: "2330", volume: 40 }
    ]
  }));
  ui.context.renderLocalScreenerPage_(1);
  eq(ui.state.items.map(row => row.symbol), ["2330", "1101"]);
  eq(ui.resultCalls.length, 0);
});
```

Add checks that the wrong `jobId` and `endCursor > job.cursor` are rejected, a repeated batch stays deduplicated, and a new start clears prior incremental rows.

- [ ] **Step 3: Write a failing running-poll test with zero result calls**

Have `continueScreener` return a queued response with `batchResults`, run `pollScreenerJob_`, and assert the rows render while `resultCalls.length === 0`. Keep a separate legacy-response test proving a response without `batchResults` still calls `getScreenerResults`.

- [ ] **Step 4: Run backend and frontend tests and confirm RED**

Run:

```powershell
node tests\test-screener-jobs.js
node tests\test-screener-ui.js
```

Expected: FAIL because batch envelopes and incremental browser state do not exist.

- [ ] **Step 5: Attach compact processed matches to each response**

Capture `startCursor` before processing. After a successful append, return:

```js
batchResults: {
  jobId: String(job.jobId || ""),
  startCursor: startCursor,
  endCursor: Number(job.cursor || 0),
  revision: Number(job.matchCount || 0),
  items: result.matches.map(projectScreenerListRow_)
}
```

Preserve this property when `attachScreenerResponseResults_` adds the completed authoritative bundle.

When `params.includeBatch` is true, `startScreener_` returns the batch response directly instead of calling `getScreenerResults_`. When false or absent, retain the current first-page response for older frontends.

- [ ] **Step 6: Implement job-scoped incremental browser state**

Extend `screenerState`:

```js
incrementalResults: null,
```

Implement an object map keyed by `String(row.symbol || "").trim()`. Accept only the active job, a cursor not beyond the response job, and a non-decreasing revision. Upsert every compact row, store the greatest cursor/revision, and make `getScreenerLocalRows_()` return completed items first or incremental map values second.

Change `getLocalScreenerPage_` and `renderLocalScreenerPage_` to work with either collection. Clear incremental state before starting a new job. When the authoritative completed bundle is accepted, discard incremental state.

- [ ] **Step 7: Prefer incremental rows in start, poll, page, and sort paths**

On start and successful poll:

```js
const acceptedBatch = acceptScreenerBatchResults_(response, response.batchResults);
if (acceptedCompleteResults || acceptedBatch) renderLocalScreenerPage_(screenerState.page || 1);
else await loadScreenerResults_(screenerState.page, epoch, pageRequestId);
```

Page and sort listeners must use local rendering whenever either completed or incremental rows exist. Retain the existing request fences, busy-state cleanup, status fallback, and terminal full-bundle behavior.

- [ ] **Step 8: Run focused tests and confirm GREEN**

Run:

```powershell
node tests\test-screener-jobs.js
node tests\test-screener-ui.js
node tests\test-screener-recovery.js
node tests\check-syntax.js
```

Expected: all pass; current-backend running page/sort paths make zero result API calls, and the legacy fallback tests still pass.

- [ ] **Step 9: Commit Task 3 in the backend repository**

```powershell
git add app.gs js/api.js js/app.js tests/test-screener-jobs.js tests/test-screener-ui.js
git commit -m "perf: stream screener batches to the browser"
```

---

### Task 4: Shorten successful polling and raise the batch size

**Files:**
- Modify: `private_backend/app.gs:3059`
- Modify: `private_backend/js/app.js:588-594,609-655`
- Modify: `private_backend/tests/test-screener-jobs.js`
- Modify: `private_backend/tests/test-screener-ui.js`

**Interfaces:**
- `SCREENER_JOB_BATCH_SIZE` becomes `500`.
- `scheduleScreenerPoll_(epoch, delayMs)` defaults successful continuation to `500` milliseconds.
- Error paths explicitly retain a `5000` millisecond delay.

- [ ] **Step 1: Change timing expectations first**

Rename the start test to `starting a run paints the first batch and schedules one half-second poll` and change its expected delay to `[500]`. Add an error-path test that rejects continuation and asserts the next timer delay is `5000`.

Add a backend check:

```js
check("a 2313-row universe completes in five configured batches", () => {
  const ctx = buildContext();
  let cursor = 0;
  let batches = 0;
  const rows = Array.from({ length: 2313 }, (_, index) => ({ symbol: String(index) }));
  while (cursor < rows.length) {
    const result = ctx.processScreenerRowsBatch_(rows, cursor, ctx.SCREENER_JOB_BATCH_SIZE, []);
    cursor = result.cursor;
    batches += 1;
  }
  eq(batches, 5);
});
```

Expose the constant through the VM expression if the harness does not add top-level `const` values to the context.

- [ ] **Step 2: Run timing tests and confirm RED**

Run:

```powershell
node tests\test-screener-jobs.js
node tests\test-screener-ui.js
```

Expected: FAIL with the old 200-row constant and 5,000-millisecond successful timer.

- [ ] **Step 3: Implement separate success and error delays**

Add:

```js
const SCREENER_SUCCESS_POLL_MS = 500;
const SCREENER_ERROR_POLL_MS = 5000;
```

Let `scheduleScreenerPoll_` accept a delay. Call it with the success delay after start and successful non-terminal poll, and the error delay only from the catch/retry path. Keep the `pollTimer !== null`, terminal, route, epoch, and in-flight guards unchanged.

- [ ] **Step 4: Raise the backend batch constant**

Set:

```js
const SCREENER_JOB_BATCH_SIZE = 500;
```

Do not introduce a second production batch-size value.

- [ ] **Step 5: Run focused tests and confirm GREEN**

Run:

```powershell
node tests\test-screener-jobs.js
node tests\test-screener-ui.js
node tests\test-screener-recovery.js
node tests\check-syntax.js
```

Expected: all pass, the 2,313-row calculation uses five batches, successful polls use 500 milliseconds, and errors use 5,000 milliseconds.

- [ ] **Step 6: Commit Task 4 in the backend repository**

```powershell
git add app.gs js/app.js tests/test-screener-jobs.js tests/test-screener-ui.js
git commit -m "perf: reduce screener continuation overhead"
```

---

### Task 5: Release v11.26, mirror the frontend, and verify the complete change

**Files:**
- Modify: `private_backend/app.gs`
- Modify: `private_backend/index.html`
- Modify: `private_backend/js/app.js`
- Modify: `private_backend/js/api.js`
- Modify: `private_backend/js/config.js`
- Modify: `private_backend/service-worker.js`
- Modify: `private_backend/tests/test-release-version.js`
- Modify: `index.html`
- Modify: `js/app.js`
- Modify: `js/api.js`
- Modify: `js/config.js`
- Modify: `service-worker.js`

**Interfaces:**
- Produces private backend and public frontend release `v11.26`.
- Keeps the current Apps Script deployment URL unchanged.
- Keeps the six mirrored frontend files byte-identical.

- [ ] **Step 1: Update release assertions first**

Change every expected runtime and cache version in `private_backend/tests/test-release-version.js` from `v11.25` to `v11.26`. Keep the formal Apps Script URL unchanged and keep byte comparisons for:

```js
["index.html", "service-worker.js", "css/style.css", "js/app.js", "js/api.js", "js/config.js"]
```

- [ ] **Step 2: Run the release test and confirm RED**

Run `node tests\test-release-version.js` from `private_backend`.

Expected: FAIL because runtime files still expose v11.25 and the public/private changed scripts are not mirrored.

- [ ] **Step 3: Bump private runtime and cache versions**

Set backend and frontend `APP_VERSION`, service-worker cache version, backend version response, and every HTML/script query string to `v11.26`. Do not change `API_BASE_URL`.

- [ ] **Step 4: Mirror private frontend runtime files to the public root**

Make these public files byte-identical to their private counterparts:

```text
index.html
service-worker.js
js/app.js
js/api.js
js/config.js
```

`css/style.css` remains unchanged but is still verified. Do not copy the private backend `app.gs` over the public root `app.gs`.

- [ ] **Step 5: Run the complete private test suite**

Run:

```powershell
$failures = 0
Get-ChildItem -LiteralPath tests -Filter 'test-*.js' | Sort-Object Name | ForEach-Object {
  & node $_.FullName
  if ($LASTEXITCODE -ne 0) { $failures += 1 }
}
node tests\check-syntax.js
if ($LASTEXITCODE -ne 0) { $failures += 1 }
if ($failures -ne 0) { exit 1 }
```

Expected: every test and syntax check exits zero.

- [ ] **Step 6: Verify public syntax, mirrors, versions, and diffs**

From the public root run:

```powershell
node --check js\app.js
node --check js\api.js
node --check js\config.js
node --check service-worker.js
git diff --check
git status --short --branch
```

From `private_backend` run:

```powershell
node tests\test-release-version.js
git diff --check
git status --short --branch
```

Expected: syntax and mirror checks pass with no unintended files.

- [ ] **Step 7: Commit the private v11.26 release**

```powershell
git add app.gs index.html js/app.js js/api.js js/config.js service-worker.js tests/test-release-version.js
git commit -m "chore: release faster screener batches as v11.26"
```

- [ ] **Step 8: Commit the public v11.26 frontend**

```powershell
git add index.html service-worker.js js/app.js js/api.js js/config.js
git commit -m "perf: publish faster screener batches"
```

- [ ] **Step 9: Record the deployment measurement procedure without deploying**

Use the same `TWSE + TPEX` broad condition after the user requests deployment. Record first batch, each 500-row milestone, total completion, in-progress paging, completed paging, and any retry. Acceptance is total completion below 90 seconds under comparable Apps Script conditions; otherwise retain v11.26 and use the recorded stage timings to evaluate one-pass filtering separately.
