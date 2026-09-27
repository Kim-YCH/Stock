# Screener Local Pagination Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Return every completed screener match as a compact nine-field list once, then paginate and sort entirely in the browser with zero result API calls.

**Architecture:** The backend continues to filter, persist, cache, and sort full snapshot rows, then projects completed results into a compact response envelope. The frontend accepts that envelope only for the current `jobId + matchCount` revision, stores it in memory, and switches to local pagination and sorting; the existing paged API remains the running-job and transport-failure fallback.

**Tech Stack:** Google Apps Script, Google Sheets, CacheService, vanilla JavaScript, JSONP, Node.js VM-based tests.

## Global Constraints

- Release version is exactly `v11.25`.
- Every screener condition remains combined with AND logic.
- The result UI remains fixed at 10 rows per page.
- Completed browser results contain only `symbol`, `name`, `market`, `industry`, `close`, `changePercent`, `volume`, `peRatio`, and `rsi14`.
- Complete results stay in memory only; do not use `localStorage` or `sessionStorage`.
- While a job is running, preserve the v11.24 paged API, page cache, request-revision fences, and visible rows during network loads.
- After complete results are accepted, page and sort actions make zero `Api.getScreenerResults` calls.
- Public and private `index.html`, `css/style.css`, `js/app.js`, `js/api.js`, `js/config.js`, and `service-worker.js` remain byte-for-byte identical.
- Keep one canonical checkout at `C:\Users\user\Desktop\git\Stock`; use Git branches and commits for history, not persistent duplicate code folders.
- Do not push or deploy until the user explicitly requests release.

---

### Task 1: Build compact completed-result envelopes

**Files:**
- Modify: `private_backend/app.gs:3059-3386`
- Test: `private_backend/tests/test-screener-jobs.js`

**Interfaces:**
- Consumes: `readSortedScreenerResultRows_(job, owner, sortField, sortDirection)` returning globally sorted full result rows.
- Produces: `projectScreenerListRow_(row)` and `buildScreenerCompleteResults_(job, owner, sortField, sortDirection)`.
- `buildScreenerCompleteResults_` returns `{ items, total, pageSize, totalPages, allLoaded, jobId, revision, sortField, sortDirection }`.

- [ ] **Step 1: Extend the result-cache fixture with every allowed and forbidden field**

In `makeResultCacheFixture`, change each payload to include the nine list fields plus a sentinel full-row field that must not reach the browser:

```js
const payload = {
  symbol: "S" + String(rank).padStart(2, "0"),
  name: "股票" + rank,
  market: "TWSE",
  industry: "測試",
  close: rank,
  changePercent: rank / 10,
  volume: rank * 10,
  peRatio: rank + 5,
  rsi14: 40 + rank,
  macdHist: 999
};
```

- [ ] **Step 2: Write failing compact-envelope tests**

Add tests that call the not-yet-existing `buildScreenerCompleteResults_`:

```js
check("completed results return every match with only compact list fields", () => {
  const fixture = makeResultCacheFixture();
  const bundle = fixture.ctx.buildScreenerCompleteResults_(
    fixture.job, "alice@example.com", "volume", "desc"
  );
  eq(bundle.items.length, 11);
  eq(Object.keys(bundle.items[0]).sort(), [
    "changePercent", "close", "industry", "market", "name",
    "peRatio", "rsi14", "symbol", "volume"
  ]);
  eq(bundle.items.map(row => row.symbol), [
    "S11", "S10", "S09", "S08", "S07", "S06",
    "S05", "S04", "S03", "S02", "S01"
  ]);
  eq(bundle.total, 11);
  eq(bundle.pageSize, 10);
  eq(bundle.totalPages, 2);
  eq(bundle.allLoaded, true);
  eq(bundle.jobId, "job-cache");
  eq(bundle.revision, 11);
  eq(bundle.sortField, "volume");
  eq(bundle.sortDirection, "desc");
});

check("completed results enforce owner isolation", () => {
  const fixture = makeResultCacheFixture();
  throws(() => fixture.ctx.buildScreenerCompleteResults_(
    fixture.job, "bob@example.com", "volume", "desc"
  ));
});
```

Extend the existing broken-cache test to call `buildScreenerCompleteResults_`, assert all 11 symbols are returned, and assert exactly one durable `ScreenerResults` scan.

- [ ] **Step 3: Run the focused backend test and confirm RED**

Run:

```powershell
node tests\test-screener-jobs.js
```

Expected: FAIL because `buildScreenerCompleteResults_` is not defined.

- [ ] **Step 4: Implement compact projection and envelope construction**

Add near the existing sort/page helpers:

```js
const SCREENER_LIST_RESULT_FIELDS = [
  "symbol", "name", "market", "industry", "close",
  "changePercent", "volume", "peRatio", "rsi14"
];

function projectScreenerListRow_(row) {
  row = row || {};
  return SCREENER_LIST_RESULT_FIELDS.reduce((result, field) => {
    result[field] = row[field] === undefined ? "" : row[field];
    return result;
  }, {});
}

function buildScreenerCompleteResults_(job, owner, sortField, sortDirection) {
  owner = normalizeEmail_(owner);
  if (!canAccessScreenerJob_(job, owner)) throw authError_("無權讀取此選股工作");
  const sort = normalizeScreenerResultSort_(sortField || job.sortField, sortDirection || job.sortDirection);
  const rows = readSortedScreenerResultRows_(job, owner, sort.sortField, sort.sortDirection)
    .map(projectScreenerListRow_);
  return {
    items: rows,
    total: rows.length,
    pageSize: SCREENER_RESULT_PAGE_SIZE,
    totalPages: Math.max(1, Math.ceil(rows.length / SCREENER_RESULT_PAGE_SIZE)),
    allLoaded: true,
    jobId: String(job.jobId || ""),
    revision: Number(job.matchCount || 0),
    sortField: sort.sortField,
    sortDirection: sort.sortDirection
  };
}
```

- [ ] **Step 5: Run backend and syntax tests and confirm GREEN**

Run:

```powershell
node tests\test-screener-jobs.js
node tests\check-syntax.js
```

Expected: all checks pass; the broken-cache test may print its intentional cache-unavailable warnings but has zero failures.

- [ ] **Step 6: Commit Task 1**

```powershell
git add app.gs tests/test-screener-jobs.js
git commit -m "feat: build compact screener result bundles"
```

---

### Task 2: Attach complete bundles to terminal screener responses

**Files:**
- Modify: `private_backend/app.gs:3286-3329`
- Modify: `private_backend/js/api.js:244-251`
- Test: `private_backend/tests/test-screener-jobs.js`

**Interfaces:**
- Consumes: `buildScreenerCompleteResults_(job, owner, sortField, sortDirection)` from Task 1.
- Produces: `shouldIncludeAllScreenerResults_(value)` and `attachScreenerResponseResults_(summary, owner, options)`.
- Browser API becomes `Api.continueScreener(jobId, includeAll = true)`.

- [ ] **Step 1: Write failing terminal-response tests**

Add a helper-independent unit around a completed fixture:

```js
check("terminal response attaches all compact results when requested", () => {
  const fixture = makeResultCacheFixture();
  const response = fixture.ctx.attachScreenerResponseResults_(
    fixture.ctx.summarizeScreenerJob_(fixture.job),
    "alice@example.com",
    { includeAll: true }
  );
  eq(response.results.allLoaded, true);
  eq(response.results.items.length, 11);
});

check("running response does not attach the full bundle", () => {
  const fixture = makeResultCacheFixture();
  fixture.job.status = "QUEUED";
  fixture.ctx.writeScreenerJobs_([fixture.job]);
  const response = fixture.ctx.attachScreenerResponseResults_(
    fixture.ctx.summarizeScreenerJob_(fixture.job),
    "alice@example.com",
    { includeAll: true }
  );
  eq(response.results, undefined);
});

check("terminal response honors includeAll false", () => {
  const fixture = makeResultCacheFixture();
  const response = fixture.ctx.attachScreenerResponseResults_(
    fixture.ctx.summarizeScreenerJob_(fixture.job),
    "alice@example.com",
    { includeAll: false }
  );
  eq(response.results, undefined);
});
```

Update the existing completed-in-first-batch assertion to require `started.results.allLoaded === true` and the compact field set.

- [ ] **Step 2: Add a browser API parameter test**

In the API VM test, replace `jsonp` with a capturing stub before reading `Api`, call:

```js
await Api.continueScreener("job-1", true);
eq(lastCall.action, "continueScreener");
eq(lastCall.params, { jobId: "job-1", includeAll: "1" });
```

Also assert `includeAll=false` sends `"0"`.

- [ ] **Step 3: Run focused tests and confirm RED**

Run:

```powershell
node tests\test-screener-jobs.js
```

Expected: FAIL because the response helper and new API parameter do not exist.

- [ ] **Step 4: Implement terminal response attachment**

Add:

```js
function shouldIncludeAllScreenerResults_(value) {
  return value === true || value === 1 || String(value || "").toLowerCase() === "true" || String(value || "") === "1";
}

function attachScreenerResponseResults_(summary, owner, options) {
  options = options || {};
  const response = Object.assign({}, summary || {});
  if (!response.jobId || response.status !== "COMPLETED" || options.includeAll !== true) return response;
  const job = findScreenerJob_(response.jobId);
  if (!job) throw new Error("找不到選股工作");
  response.results = buildScreenerCompleteResults_(job, owner, job.sortField, job.sortDirection);
  return response;
}
```

Change `startScreener_` so a first-batch completion uses the full bundle, while a queued job still returns the existing first page:

```js
if (summary.status === "COMPLETED") {
  return attachScreenerResponseResults_(summary, owner, { includeAll: true });
}
return Object.assign({}, summary, {
  results: getScreenerResults_({
    owner, jobId: job.jobId, page: 1,
    sortField: job.sortField, sortDirection: job.sortDirection
  })
});
```

Change `continueScreener_` return logic to:

```js
return attachScreenerResponseResults_(summary, owner, {
  includeAll: shouldIncludeAllScreenerResults_(params.includeAll)
});
```

Change the browser API method to:

```js
continueScreener: (jobId, includeAll = true) =>
  jsonp("continueScreener", { jobId, includeAll: includeAll ? "1" : "0" }),
```

- [ ] **Step 5: Run focused regressions and confirm GREEN**

Run:

```powershell
node tests\test-screener-jobs.js
node tests\test-screener-rules.js
node tests\check-syntax.js
```

Expected: all pass.

- [ ] **Step 6: Commit Task 2**

```powershell
git add app.gs js/api.js tests/test-screener-jobs.js
git commit -m "feat: return complete screener results at completion"
```

---

### Task 3: Paginate and sort completed results locally

**Files:**
- Modify: `private_backend/js/app.js:147-164,400-604,888-894`
- Test: `private_backend/tests/test-screener-ui.js`

**Interfaces:**
- Consumes: terminal `response.results` envelope from Task 2.
- Produces: `clearScreenerCompleteResults_()`, `acceptScreenerCompleteResults_(job, results)`, `sortScreenerListRows_()`, `getLocalScreenerPage_()`, and `renderLocalScreenerPage_()`.
- Existing `getScreenerResultsPage_()` remains the running/fallback network path.

- [ ] **Step 1: Extend the UI test API fixture**

Track result calls separately and let tests override status behavior:

```js
const resultCalls = [];
// Api.getScreenerResults test stub pushes { jobId, page, sortField, sortDirection }.
// Api.getScreenerStatus defaults to an async function returning screenerState.job.
return { context, state, elements, timers, apiCalls, resultCalls };
```

- [ ] **Step 2: Write failing local pagination and sorting tests**

Add an async test that accepts 25 compact rows and proves no network calls occur:

```js
const items = Array.from({ length: 25 }, (_, index) => ({
  symbol: "S" + String(index + 1).padStart(2, "0"),
  name: "股票" + (index + 1), market: "TWSE", industry: "測試",
  close: index + 1, changePercent: index / 10, volume: index + 1,
  peRatio: index + 5, rsi14: 40 + index
}));
ui.state.job = { jobId: "job-local", status: "COMPLETED", matchCount: 25 };
ok(ui.context.acceptScreenerCompleteResults_(ui.state.job, {
  items, total: 25, pageSize: 10, totalPages: 3,
  allLoaded: true, jobId: "job-local", revision: 25,
  sortField: "volume", sortDirection: "desc"
}));
ui.context.renderLocalScreenerPage_(2);
eq(ui.state.page, 2);
eq(ui.state.items.length, 10);
eq(ui.resultCalls.length, 0);
```

Add a sorting test that selects `close desc`, renders page 1, asserts symbols are in descending close order, asserts page resets to 1, and asserts zero result calls.

Add revision tests that reject a wrong `revision` or `jobId`, and a new-job test that calls `clearScreenerCompleteResults_` through `startScreenerRun_` and asserts old items are gone.

- [ ] **Step 3: Write a failing terminal poll test**

Resolve `Api.continueScreener` with a completed job and a 25-item `allLoaded` bundle. Assert:

```js
eq(ui.state.completeResults.items.length, 25);
eq(ui.resultCalls.length, 0);
eq(ui.state.job.status, "COMPLETED");
```

This replaces the existing terminal-poll expectation that requires `Api.getScreenerResults`.

- [ ] **Step 4: Write a failing complete-payload fallback test**

Make `Api.continueScreener` reject, `Api.getScreenerStatus` return a completed job, and `Api.getScreenerResults` return page 1. Assert the current rows remain visible until the fallback page arrives, `completeResultsDisabled` becomes true, the fallback page renders, and no new poll is scheduled.

- [ ] **Step 5: Run the UI test and confirm RED**

Run:

```powershell
node tests\test-screener-ui.js
```

Expected: FAIL because the complete-result state and local helpers do not exist.

- [ ] **Step 6: Implement complete-result state and local paging**

Extend `screenerState`:

```js
completeResults: null,
completeResultsDisabled: false,
```

Add helpers:

```js
function clearScreenerCompleteResults_() {
  screenerState.completeResults = null;
  screenerState.completeResultsDisabled = false;
}

function acceptScreenerCompleteResults_(job, results) {
  if (!job || !results || results.allLoaded !== true || !Array.isArray(results.items)) return false;
  if (String(results.jobId || "") !== String(job.jobId || "")) return false;
  if (Number(results.revision || 0) !== Number(job.matchCount || 0)) return false;
  screenerState.completeResults = {
    jobId: String(job.jobId || ""),
    revision: Number(results.revision || 0),
    items: results.items.slice()
  };
  return true;
}

function sortScreenerListRows_(rows, sortField, sortDirection) {
  return (rows || []).slice().sort((left, right) => {
    const a = left[sortField];
    const b = right[sortField];
    const aBlank = a === "" || a === null || a === undefined;
    const bBlank = b === "" || b === null || b === undefined;
    if (aBlank !== bBlank) return aBlank ? 1 : -1;
    const aNumber = Number(a);
    const bNumber = Number(b);
    let comparison = !aBlank && !bBlank && Number.isFinite(aNumber) && Number.isFinite(bNumber)
      ? aNumber - bNumber
      : String(a || "").localeCompare(String(b || ""), "zh-Hant");
    if (comparison === 0) comparison = String(left.symbol || "").localeCompare(String(right.symbol || ""));
    return sortDirection === "asc" ? comparison : -comparison;
  });
}

function getLocalScreenerPage_(page) {
  const sorted = sortScreenerListRows_(
    screenerState.completeResults.items,
    screenerState.sortField,
    screenerState.sortDirection
  );
  const total = sorted.length;
  const totalPages = Math.max(1, Math.ceil(total / 10));
  page = Math.min(totalPages, Math.max(1, Number(page || 1)));
  return {
    items: sorted.slice((page - 1) * 10, page * 10),
    page, pageSize: 10, total, totalPages
  };
}

function renderLocalScreenerPage_(page) {
  if (!screenerState.completeResults) return false;
  renderScreenerResults_(getLocalScreenerPage_(page));
  return true;
}
```

Update `prefetchAdjacentScreenerPages_` to return immediately when complete results exist. Update `changeScreenerResultsPage_` to call `renderLocalScreenerPage_` before setting network busy state.

- [ ] **Step 7: Integrate terminal results, sorting, and fallback**

In `startScreenerRun_`, call `clearScreenerCompleteResults_()` before the API call. If the response contains a valid full bundle, accept it and render local page 1; otherwise render the existing first page.

In `pollScreenerJob_`, call:

```js
const job = await Api.continueScreener(
  screenerState.job.jobId,
  !screenerState.completeResultsDisabled
);
```

After updating `screenerState.job`, accept and locally render `job.results` when present. Only call `loadScreenerResults_` if no complete bundle was accepted and no explicit page load is active.

In the poll catch path, call `Api.getScreenerStatus(jobId)`. If it returns `COMPLETED`, set `completeResultsDisabled = true`, store the terminal job, load the current page through the existing paged API once, and do not schedule another poll. For non-terminal status/network failure, preserve the existing delayed retry.

In the sort-change listener:

```js
if (screenerState.completeResults) renderLocalScreenerPage_(1);
else if (screenerState.job) changeScreenerResultsPage_(1);
```

- [ ] **Step 8: Run UI, API, race, and syntax regressions**

Run:

```powershell
node tests\test-screener-ui.js
node tests\test-screener-jobs.js
node tests\test-screener-recovery.js
node tests\check-syntax.js
```

Expected: all pass, including existing navigation/poll race tests.

- [ ] **Step 9: Commit Task 3**

```powershell
git add js/app.js tests/test-screener-ui.js
git commit -m "perf: paginate completed screener results locally"
```

---

### Task 4: Mirror the frontend and release v11.25

**Files:**
- Modify: `private_backend/app.gs:1-2,13968`
- Modify: `private_backend/js/config.js:3`
- Modify: `private_backend/index.html:16,516-519`
- Modify: `private_backend/service-worker.js:13,18-22`
- Modify: `private_backend/tests/test-release-version.js`
- Modify: `js/app.js`
- Modify: `js/api.js`
- Modify: `js/config.js:3`
- Modify: `index.html:16,516-519`
- Modify: `service-worker.js:13,18-22`

**Interfaces:**
- Consumes: completed private frontend from Tasks 2-3.
- Produces: byte-identical public/private frontend at v11.25 with the already-deployed Apps Script URL unchanged.

- [ ] **Step 1: Update the release test first**

Change all v11.24 assertions and asset query strings in `private_backend/tests/test-release-version.js` to v11.25. Keep the formal API URL exactly equal to the current deployed URL:

```text
https://script.google.com/macros/s/AKfycbzYwe1_ntW5cJtlu1VQep3MTAAf12d0QnSY2VoVDkvy7bfu4JzMFONiJMvcGIhLEaYC/exec
```

Ensure the byte-equality list contains:

```js
["index.html", "service-worker.js", "css/style.css", "js/app.js", "js/api.js", "js/config.js"]
```

- [ ] **Step 2: Run the release test and confirm RED**

Run:

```powershell
node tests\test-release-version.js
```

Expected: FAIL because runtime files still expose v11.24 and the public/private changed JavaScript mirrors differ.

- [ ] **Step 3: Bump private runtime and cache versions**

Set:

```js
// app.gs
const APP_VERSION = "v11.25";

// js/config.js
const APP_VERSION = "v11.25";

// service-worker.js
const CACHE_VERSION = "v11.25";
```

Change all five HTML and service-worker asset query strings to `?v=11.25`. Update both backend header/footer version comments to v11.25. Do not change `API_BASE_URL`.

- [ ] **Step 4: Mirror frontend files into the public root**

Apply the private changes byte-for-byte to:

```text
index.html
service-worker.js
js/app.js
js/api.js
js/config.js
```

Do not copy `private_backend/app.gs` into the public repository root. `css/style.css` is unchanged but remains covered by mirror verification.

- [ ] **Step 5: Run focused release verification**

From `private_backend` run:

```powershell
node tests\test-release-version.js
node tests\test-screener-jobs.js
node tests\test-screener-ui.js
node tests\check-syntax.js
```

Expected: all pass and public/private mirror checks report no differences.

- [ ] **Step 6: Commit private v11.25 release integration**

```powershell
git add app.gs index.html js/app.js js/api.js js/config.js service-worker.js tests/test-release-version.js
git commit -m "chore: release local screener pagination as v11.25"
```

- [ ] **Step 7: Commit public v11.25 frontend**

From the public root:

```powershell
git add index.html service-worker.js js/app.js js/api.js js/config.js
git commit -m "perf: load completed screener results once"
```

- [ ] **Step 8: Run the complete private test suite**

From `private_backend`:

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

Expected: every test file and syntax check passes with zero failed files.

- [ ] **Step 9: Verify public syntax, mirrors, versions, and clean trees**

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

Expected: syntax and release checks pass; both worktrees contain no uncommitted files; neither branch has been pushed or deployed.
