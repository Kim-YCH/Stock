# Screener Interaction And Fast Pagination Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Release StockLab v11.24 with a single-flight animated screener button, direct checkbox rendering for `in`-only conditions, and cached/prefetched result pagination that normally switches pages within one second after the first page loads.

**Architecture:** Keep the public frontend and private frontend mirror byte-identical. Add explicit screener run/page state in the browser, cache page promises by job result revision, and prefetch adjacent pages. In Apps Script, cache the current job record and the parsed, sorted result set by owner/job/result revision/sort so a page hit does not rescan Google Sheets; every cache failure falls back to the existing sheet path.

**Tech Stack:** Vanilla HTML/CSS/JavaScript, Google Apps Script, CacheService, Google Sheets, Node.js `vm` test harness, Git worktrees.

## Global Constraints

- Create the public worktree at `C:/Users/user/Desktop/git/Stock/.worktrees/screener-interaction-pagination` from public `main` using the `using-git-worktrees` skill.
- Create the private worktree at `C:/Users/user/Desktop/git/Stock/.worktrees/screener-interaction-pagination/private_backend/market-screener-v11.21` from `feature/market-screener-v11.21`; use a new private branch named `feature/screener-interaction-pagination-v11.24`.
- Use strict red-green-refactor: each behavior test must fail for the expected missing behavior before production code changes.
- Keep page size fixed at 10, condition logic fixed at AND, and the condition API shape unchanged.
- Do not change pages outside the screener or introduce browser persistence.
- Public and private copies of `index.html`, `css/style.css`, `js/app.js`, `js/config.js`, and `service-worker.js` must be byte-identical at release.
- Version all frontend shell assets and Apps Script as `v11.24` only in the release task.

---

## File Structure

- `private_backend/market-screener-v11.21/tests/test-screener-ui.js`: observable UI behavior tests for run locking, `in` controls, page caching, prefetch, busy state, and stale-response fencing.
- `private_backend/market-screener-v11.21/tests/test-screener-jobs.js`: Apps Script result-cache correctness, isolation, invalidation, and sheet-fallback tests.
- `private_backend/market-screener-v11.21/js/app.js`: screener run state and frontend page cache/prefetch coordinator.
- `private_backend/market-screener-v11.21/css/style.css`: button spinner and pagination busy styling.
- `private_backend/market-screener-v11.21/app.gs`: per-job metadata and sorted-result CacheService fast path.
- `private_backend/market-screener-v11.21/tests/test-release-version.js`: v11.24 and public/private mirror contract.
- `private_backend/market-screener-v11.21/index.html`, `js/config.js`, `service-worker.js`: private release shell.
- `js/app.js`, `css/style.css`, `index.html`, `js/config.js`, `service-worker.js`: public mirrors copied from the verified private implementation.

---

### Task 1: Direct `in` Controls And Single-Flight Run Button

**Files:**
- Modify: `private_backend/market-screener-v11.21/tests/test-screener-ui.js`
- Modify: `private_backend/market-screener-v11.21/js/app.js:147-505`
- Modify: `private_backend/market-screener-v11.21/css/style.css:2380-2490`

**Interfaces:**
- Produces: `shouldRenderScreenerOperator_(definition) -> boolean`
- Produces: `isScreenerRunActive_() -> boolean`
- Produces: `syncScreenerRunButton_() -> void`
- Extends: `screenerState.startInFlight: boolean`
- Consumes: existing `isScreenerJobTerminal_(job)` and `startScreenerRun_()`.

- [ ] **Step 1: Extend the UI harness with observable button attributes and classes**

In `loadConditionUi()`, add `screenerConditionBar` to the element map. In `loadRunUi()`, replace the inert element class/attribute doubles with stateful doubles so tests observe real effects:

```js
function makeElement(value = "") {
  const attributes = new Map();
  const classes = new Set();
  return {
    innerHTML: "", textContent: "", disabled: false, value,
    classList: {
      add: name => classes.add(name),
      remove: name => classes.delete(name),
      toggle: (name, enabled) => enabled ? classes.add(name) : classes.delete(name),
      contains: name => classes.has(name)
    },
    setAttribute: (name, next) => attributes.set(name, String(next)),
    removeAttribute: name => attributes.delete(name),
    getAttribute: name => attributes.has(name) ? attributes.get(name) : null,
    querySelectorAll: () => []
  };
}
```

- [ ] **Step 2: Write failing tests for `in` rendering and the run-button lifecycle**

Add checks that exercise rendered output and asynchronous behavior:

```js
check("an enum with only the in operator renders checkboxes without an operator select", () => {
  const ui = loadConditionUi();
  ui.state.meta = { catalog: [
    { field: "market", label: "市場", type: "enum", ops: ["in"], values: ["TWSE", "TPEX"] }
  ] };
  ui.add("market");
  const html = ui.elements.get("screenerConditionBar").innerHTML;
  ok(!/data-screener-op-index/.test(html));
  ok(/data-screener-enum-index="0"/.test(html));
  eq(ui.serialize(), [{ field: "market", op: "in", value: [] }]);
});
```

Add an async test with a deferred `Api.startScreener` that calls `startScreenerRun_()` twice before resolving. Assert one API call, a disabled button, text `選股中`, `aria-busy="true"`, and class `is-loading`; resolve to a queued job and assert it stays locked. Then feed a completed poll and assert text `開始選股`, no busy attribute, and enabled state. Add a separate rejected-start assertion that restores the button.

- [ ] **Step 3: Run the focused UI test and verify RED**

Run:

```powershell
node tests/test-screener-ui.js
```

Expected: FAIL because the `in` condition still renders `data-screener-op-index`, duplicate calls both reach `Api.startScreener`, and the button is re-enabled in `finally` while the queued job is active.

- [ ] **Step 4: Implement the minimal `in` rendering rule**

Add:

```js
function shouldRenderScreenerOperator_(definition) {
  const ops = (definition && definition.ops) || [];
  return !(ops.length === 1 && ops[0] === "in");
}
```

In `renderScreenerConditions_()`, render the `<select data-screener-op-index>` only when this function returns true. Do not change `defaultScreenerCondition_()` or serialization; hidden `in` remains part of the payload.

- [ ] **Step 5: Implement the minimal single-flight button state**

Add `startInFlight: false` to `screenerState`, then add:

```js
function isScreenerRunActive_() {
  return screenerState.startInFlight ||
    !!(screenerState.job && !isScreenerJobTerminal_(screenerState.job));
}

function syncScreenerRunButton_() {
  const button = document.getElementById("btnStartScreener");
  if (!button) return;
  const active = isScreenerRunActive_();
  button.disabled = active;
  button.textContent = active ? "選股中" : "開始選股";
  button.classList.toggle("is-loading", active);
  if (active) button.setAttribute("aria-busy", "true");
  else button.removeAttribute("aria-busy");
}
```

Guard `startScreenerRun_()` before `stopScreenerPolling_()`. Set `startInFlight` before serialization/API work, clear it once the initial request settles, and call `syncScreenerRunButton_()` after every job assignment, terminal poll, and initial error. Remove the unconditional `button.disabled = false` from `finally`.

- [ ] **Step 6: Add the button spinner without changing its text markup**

```css
#btnStartScreener.is-loading::before {
  content: "";
  display: inline-block;
  width: 14px;
  height: 14px;
  margin-right: 7px;
  border: 2px solid rgba(255, 255, 255, 0.45);
  border-top-color: currentColor;
  border-radius: 50%;
  vertical-align: -2px;
  animation: screener-button-spin 0.75s linear infinite;
}

@keyframes screener-button-spin {
  to { transform: rotate(360deg); }
}
```

- [ ] **Step 7: Run the focused test and verify GREEN**

Run `node tests/test-screener-ui.js`.

Expected: all UI checks pass, including queued-state locking and terminal/error restoration.

- [ ] **Step 8: Commit the private UI behavior**

```powershell
git add tests/test-screener-ui.js js/app.js css/style.css
git commit -m "feat: improve screener run feedback"
```

---

### Task 2: Frontend Page Promise Cache, Prefetch, And Race Fencing

**Files:**
- Modify: `private_backend/market-screener-v11.21/tests/test-screener-ui.js`
- Modify: `private_backend/market-screener-v11.21/js/app.js:393-507`
- Modify: `private_backend/market-screener-v11.21/css/style.css:2473-2490`

**Interfaces:**
- Produces: `screenerPageCacheKey_(page) -> string`
- Produces: `getScreenerResultsPage_(page) -> Promise<PageData>`
- Produces: `prefetchAdjacentScreenerPages_(pageData) -> void`
- Produces: `setScreenerPaginationBusy_(busy) -> void`
- Extends: `screenerState.pageCache: Map`, `pageRequestId: number`, `pageLoading: boolean`.
- Consumes: `Api.getScreenerResults(jobId, page, sortField, sortDirection)`.

- [ ] **Step 1: Write a failing test for adjacent-page prefetch and cache reuse**

Configure `Api.getScreenerResults` to record page numbers and return literal page fixtures. Render page 1 with `totalPages: 3`, allow microtasks to drain, and assert page 2 was prefetched. Call `changeScreenerResultsPage_(2)` and assert page 2 was not requested a second time and the result body contains the page-2 symbol.

The cache key assertion must prove a changed `screenerState.job.matchCount` causes a fresh API call for the same page.

- [ ] **Step 2: Write a failing test for stale response fencing**

Use independent deferred promises for pages 2 and 3:

```js
const page2 = deferred();
const page3 = deferred();
const second = ui.context.changeScreenerResultsPage_(2);
const third = ui.context.changeScreenerResultsPage_(3);
page3.resolve({ items: [{ symbol: "PAGE3" }], page: 3, pageSize: 10, total: 30, totalPages: 3 });
await third;
page2.resolve({ items: [{ symbol: "PAGE2" }], page: 2, pageSize: 10, total: 30, totalPages: 3 });
await second;
eq(ui.state.page, 3);
ok(/PAGE3/.test(ui.elements.get("screenerResultBody").innerHTML));
```

Also assert the previous table HTML remains unchanged while a requested page is unresolved.

- [ ] **Step 3: Run the focused test and verify RED**

Run `node tests/test-screener-ui.js`.

Expected: FAIL because every call reaches the API, there is no prefetch, and a late page-2 response overwrites page 3.

- [ ] **Step 4: Implement revision-aware page caching**

Add state:

```js
pageCache: new Map(),
pageRequestId: 0,
pageLoading: false
```

Use this exact identity:

```js
function screenerPageCacheKey_(page) {
  const job = screenerState.job || {};
  return [job.jobId || "", Number(job.matchCount || 0), Number(page || 1),
    screenerState.sortField, screenerState.sortDirection].join(":");
}
```

`getScreenerResultsPage_()` stores the in-flight Promise immediately, replaces it with `Promise.resolve(result)` on success, and deletes the key on rejection so a real click can retry.

- [ ] **Step 5: Implement prefetch and latest-request-only rendering**

`prefetchAdjacentScreenerPages_()` requests only valid `page - 1` and `page + 1` pages and swallows prefetch errors. `changeScreenerResultsPage_()` increments `pageRequestId`, sets busy state, awaits the cached Promise, and renders only if the captured request ID still equals the current ID and `requestEpoch` is unchanged.

Clear `pageCache` when a new screener run begins. A changed `matchCount`, sort field, or direction naturally produces a new key.

- [ ] **Step 6: Implement non-destructive pagination busy styling**

`setScreenerPaginationBusy_()` sets `aria-busy`, toggles `is-loading`, and temporarily disables existing pagination buttons without touching `screenerResultBody`.

```css
.screener-pagination.is-loading::after {
  content: "載入中…";
  color: var(--muted);
  font-size: 12px;
}
```

- [ ] **Step 7: Run the focused test and verify GREEN**

Run `node tests/test-screener-ui.js`.

Expected: page 2 is prefetched once, cache revision changes refetch, page 3 survives a late page-2 response, and current rows remain visible while loading.

- [ ] **Step 8: Commit frontend pagination behavior**

```powershell
git add tests/test-screener-ui.js js/app.js css/style.css
git commit -m "perf: prefetch screener result pages"
```

---

### Task 3: Apps Script Per-Job Result Cache

**Files:**
- Modify: `private_backend/market-screener-v11.21/tests/test-screener-jobs.js`
- Modify: `private_backend/market-screener-v11.21/app.gs:3060-3390`

**Interfaces:**
- Produces: `screenerJobCacheKey_(jobId) -> string`
- Produces: `screenerResultCacheKey_(job, sortField, sortDirection) -> string`
- Produces: `readSortedScreenerResultRows_(job, owner, sortField, sortDirection) -> Array<object>`
- Changes: `findScreenerJob_(jobId)` to use CacheService before Sheets.
- Changes: `writeScreenerJobs_(jobs)` to refresh per-job cache entries after the durable sheet write.
- Changes: `purgeExpiredScreenerJobs_()` to remove cache entries for jobs deleted from Sheets.
- Consumes: existing `getCachedJson_`, `putCachedJson_`, `getSheetObjects_`, and authorization helpers.

- [ ] **Step 1: Write a failing cache-hit test using the real Apps Script functions**

Use `makeCache()` from `tests/fake-google.js`, seed one job and 11 result rows, then wrap `ctx.getSheetObjects_` to count reads of `ScreenerResults`. Call pages 1 and 2 with identical job revision and sort. Assert literal symbols for each page and exactly one `ScreenerResults` sheet read across both calls.

- [ ] **Step 2: Write failing isolation and invalidation tests**

Add independent checks that prove:

1. Bob cannot read Alice's cached job.
2. A different sort field/direction does not reuse an incompatible sorted cache.
3. After the durable job is rewritten with a larger `matchCount`, the next request reads the sheet and includes the new literal symbol.
4. A CacheService whose `get` returns null and whose `put` throws still returns the correct 10-row page from Sheets.
5. Purging an expired job removes its per-job cache so it cannot remain readable after its durable row is deleted.

Use hand-written expected symbol arrays; do not calculate expected results with the production sorter.

- [ ] **Step 3: Run the focused backend test and verify RED**

Run:

```powershell
node tests/test-screener-jobs.js
```

Expected: FAIL because both pages currently rescan `ScreenerResults` and no cache identity/invalidation path exists.

- [ ] **Step 4: Implement cached job lookup after durable writes**

Use short, deterministic keys safe for CacheService:

```js
function screenerJobCacheKey_(jobId) {
  return "screener:job:" + String(jobId || "");
}
```

`writeScreenerJobs_()` must write Sheets first, then call `putCachedJson_()` for each job with a six-hour TTL. `findScreenerJob_()` reads the per-job cache first and falls back to the current full job sheet scan, caching only a found job. When `purgeExpiredScreenerJobs_()` deletes durable jobs, it must call `removeCachedJson_(screenerJobCacheKey_(jobId))` for every expired ID before returning.

- [ ] **Step 5: Implement revision- and sort-specific result caching**

Normalize sort before building the key:

```js
function screenerResultCacheKey_(job, sortField, sortDirection) {
  return ["screener:results", job.jobId, Number(job.matchCount || 0),
    sortField, sortDirection].join(":");
}
```

The cached envelope must include `ownerEmail`, `jobId`, `matchCount`, `sortField`, `sortDirection`, and `rows`. On hit, validate every identity field. On miss, perform the existing result-sheet scan and JSON parsing once, sort the full array once, cache the envelope for six hours, and then slice the requested 10-row page without sorting again.

Refactor `sortAndPageScreenerResults_()` only as needed to share a `sortScreenerResults_()` helper; preserve its public output and fixed page size.

- [ ] **Step 6: Run the focused backend test and verify GREEN**

Run `node tests/test-screener-jobs.js`.

Expected: all job tests pass; pages 1 and 2 share one sheet scan, owner/revision/sort boundaries remain isolated, and cache failure falls back correctly.

- [ ] **Step 7: Run the screener regression group**

```powershell
node tests/test-screener-rules.js
node tests/test-screener-data-job.js
node tests/test-screener-recovery.js
node tests/test-screener-ui.js
```

Expected: all checks pass.

- [ ] **Step 8: Commit the backend cache**

```powershell
git add tests/test-screener-jobs.js app.gs
git commit -m "perf: cache screener result pagination"
```

---

### Task 4: Synchronize Public Mirrors And Release v11.24

**Files:**
- Modify: `private_backend/market-screener-v11.21/tests/test-release-version.js`
- Modify: `private_backend/market-screener-v11.21/app.gs`
- Modify: `private_backend/market-screener-v11.21/index.html`
- Modify: `private_backend/market-screener-v11.21/js/config.js`
- Modify: `private_backend/market-screener-v11.21/service-worker.js`
- Modify: `index.html`
- Modify: `css/style.css`
- Modify: `js/app.js`
- Modify: `js/config.js`
- Modify: `service-worker.js`

**Interfaces:**
- Produces: public/private shell version `v11.24`.
- Preserves: production `API_BASE_URL` in public `js/config.js` and the matching private mirror.
- Consumes: completed private UI implementation from Tasks 1-2 and backend implementation from Task 3.

- [ ] **Step 1: Update the release test first**

Change the expected version and asset list in `tests/test-release-version.js` from v11.23 to v11.24. Keep the byte-for-byte assertions for all five public/private mirror files and add `css/style.css` to that mirror list because v11.24 changes spinner styles.

- [ ] **Step 2: Run the release test and verify RED**

Run `node tests/test-release-version.js`.

Expected: FAIL because code and shell asset URLs still expose v11.23 and public files do not yet contain the new implementation.

- [ ] **Step 3: Bump the private release version**

Set:

- `app.gs`: `APP_VERSION = "v11.24"`
- `js/config.js`: `APP_VERSION = "v11.24"`
- `service-worker.js`: `CACHE_VERSION = "v11.24"`
- `index.html` and `service-worker.js`: all five shell query strings to `?v=11.24`

- [ ] **Step 4: Apply the verified private frontend changes to public files**

Apply identical hunks from the private frontend to public `index.html`, `css/style.css`, `js/app.js`, `js/config.js`, and `service-worker.js`. Preserve this exact production endpoint in both config mirrors:

```js
const API_BASE_URL = "https://script.google.com/macros/s/AKfycbzl_6cei25aPan4LLbJG9ta_dojOfhh_ka-4zFtTDX8bGY3JobLmMpOQTo9hzDU3_Tn/exec"
```

- [ ] **Step 5: Run release and syntax tests and verify GREEN**

```powershell
node tests/check-syntax.js
node tests/test-release-version.js
node tests/test-screener-ui.js
node tests/test-screener-jobs.js
```

Expected: syntax passes, release version reports v11.24, and every public/private mirror comparison passes.

- [ ] **Step 6: Commit the private release changes**

```powershell
git add app.gs index.html css/style.css js/app.js js/config.js service-worker.js tests/test-release-version.js
git commit -m "chore: release screener improvements as v11.24"
```

- [ ] **Step 7: Commit the public implementation**

From the public worktree:

```powershell
git add index.html css/style.css js/app.js js/config.js service-worker.js
git commit -m "feat: improve screener interactions and pagination"
```

---

### Task 5: Full Verification And Release Readiness

**Files:**
- Verify only: public and private worktrees.

**Interfaces:**
- Consumes: all Task 1-4 commits.
- Produces: evidence that the public commit contains no private backend and the private branch contains all backend/tests.

- [ ] **Step 1: Run all private tests from a clean process**

```powershell
$ErrorActionPreference = 'Stop'
node tests/check-syntax.js
$tests = Get-ChildItem tests/test-*.js | Sort-Object Name
foreach ($test in $tests) {
  node $test.FullName
  if ($LASTEXITCODE -ne 0) { throw "Test failed: $($test.Name)" }
}
```

Expected: all syntax checks and every test file pass with zero failures.

- [ ] **Step 2: Verify public syntax, versions, endpoint, and whitespace**

From the public worktree:

```powershell
node --check js/app.js
node --check js/config.js
node --check service-worker.js
git diff --check main...HEAD
rg -n "v11\.24|11\.23|AKfycbzl_6cei25aPan4LLbJG9ta_dojOfhh_ka-4zFtTDX8bGY3JobLmMpOQTo9hzDU3_Tn" index.html js/config.js service-worker.js
```

Expected: no syntax/whitespace errors, v11.24 on every release surface, no v11.23 shell reference, and the production endpoint is present.

- [ ] **Step 3: Verify exact public/private frontend equality**

Run `node tests/test-release-version.js` from the private worktree after all commits. Expected: all mirror checks pass, including CSS.

- [ ] **Step 4: Review commit scope**

```powershell
git status --short
git diff --stat main...HEAD
git log --oneline main..HEAD
```

Expected public scope: specification/plan history plus only `index.html`, `css/style.css`, `js/app.js`, `js/config.js`, and `service-worker.js` for production. The private branch may additionally contain `app.gs` and tests. Both worktrees must be clean.

- [ ] **Step 5: Prepare staged deployment verification**

Do not deploy or push without the user's release instruction. When authorized, deploy private `app.gs` first, verify the live backend reports v11.24, exercise one completed selection and measure cached page 2, then push public GitHub and private GitLab branches separately. Confirm the live button stays locked during a job, `in` conditions have no operator dropdown, and an adjacent page normally renders within one second.
