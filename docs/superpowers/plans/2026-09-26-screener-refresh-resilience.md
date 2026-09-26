# Screener Refresh Resilience Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the full-market screener data refresh recover automatically from Apps Script timeouts, shared-lock contention, stale trigger events, and missing one-shot triggers without resetting the current 51% checkpoint.

**Architecture:** Keep the existing Apps Script backend and one-shot worker, but bound each worker to a 240-second soft budget and persist progress after every minimum work unit. Add a short-lock lease/revision protocol plus a permanent five-minute watchdog that repairs missing worker triggers and expired leases; expose recovery state to the existing ten-second frontend poll.

**Tech Stack:** Google Apps Script V8, Script Properties, ScriptApp time-driven triggers, LockService, vanilla JavaScript, Node.js VM test harness, GitHub Pages/PWA service worker.

## Global Constraints

- Preserve all existing screener conditions, AND evaluation, data sources, sheet formats, and ten-row result pagination.
- Do not move processing outside Google Apps Script.
- Do not change the behavior or data pipeline of `runDailyIndicatorWatchdog`.
- Resume the existing job at its saved `dateCursor`; never silently reset 51% to zero.
- External requests and bulk calculations must not run while the screener owns the Script lock.
- The watchdog cadence is exactly five minutes; stale progress threshold is exactly ten minutes.
- Worker soft limit is 240 seconds with a 15-second safety margin.
- A true work-unit failure becomes terminal after five consecutive failures; lock contention, valid leases, and superseded events are not failures.
- `private_backend/` is intentionally ignored and marked private. Never use `git add -f private_backend`; deploy its tested `app.gs` through Apps Script only.
- Preserve the user's existing unstaged `js/config.js` changes, especially `API_BASE_URL`; when versioning, alter only the intended version line.

---

## File Map

- `private_backend/market-screener-v11.21/app.gs`: private production backend; job schema, lease worker, watchdog, trigger repair, recovery entry point, and backend version.
- `private_backend/market-screener-v11.21/tests/test-screener-data-job.js`: job normalization, time budget, checkpoint, and legacy compatibility tests.
- `private_backend/market-screener-v11.21/tests/test-screener-recovery.js`: new focused tests for leases, duplicate/stale events, watchdog repair, and daily-start recovery.
- `private_backend/market-screener-v11.21/tests/fake-google.js`: extend trigger fakes only if a test requires trigger delays or inspection not already exposed.
- `private_backend/market-screener-v11.21/tests/test-screener-ui.js`: frontend recovery-copy regression tests.
- `private_backend/market-screener-v11.21/tests/test-release-version.js`: v11.23 backend/frontend and cache-key assertions.
- `js/app.js`: public frontend status copy; mirrored to the private test fixture.
- `js/config.js`: public version only; retain the existing endpoint line byte-for-byte.
- `index.html`: public cache-busting query strings.
- `service-worker.js`: public PWA cache name and shell asset query strings.
- `private_backend/market-screener-v11.21/{js/app.js,js/config.js,index.html,service-worker.js}`: exact mirrors used by the private test suite; never publish through GitHub.

---

### Task 1: Backward-Compatible Job Metadata and Health State

**Files:**
- Modify: `private_backend/market-screener-v11.21/tests/test-screener-data-job.js`
- Modify: `private_backend/market-screener-v11.21/app.gs:2290-2375`

**Interfaces:**
- Produces: `normalizeScreenerDataJob_(job, nowMs) -> job|null`
- Produces: `isScreenerDataLeaseActive_(job, nowMs) -> boolean`
- Extends: `summarizeScreenerDataJob_(job, nowMs)` with `lastProgressAt`, `stalled`, `recovering`, and `lastError`
- Adds constants: `SCREENER_DATA_SOFT_LIMIT_MS`, `SCREENER_DATA_SAFETY_MS`, `SCREENER_DATA_STALL_MS`, `SCREENER_DATA_LEASE_MS`

- [ ] **Step 1: Add failing compatibility and health tests**

Add cases that load an old job without the new fields and verify defaults without changing its cursor:

```js
check("legacy active jobs gain recovery metadata without losing progress", () => {
  const ctx = buildContext();
  const oldJob = Object.assign(makeJob(ctx), {
    phase: "HISTORY", status: "QUEUED", dateCursor: 87, updatedAt: "2026-09-25 18:13:15"
  });
  const normalized = ctx.normalizeScreenerDataJob_(oldJob, Date.parse("2026-09-26T06:30:00+08:00"));
  eq(normalized.dateCursor, 87);
  eq(normalized.revision, 0);
  eq(normalized.workerId, "");
  eq(normalized.consecutiveFailures, 0);
  ok(Boolean(normalized.lastProgressAt));
});

check("summary reports a queued job as stalled after ten minutes", () => {
  const ctx = buildContext();
  const job = Object.assign(makeJob(ctx), {
    phase: "HISTORY", status: "QUEUED", lastProgressAt: "2026-09-26T06:00:00.000Z"
  });
  const state = ctx.summarizeScreenerDataJob_(job, Date.parse("2026-09-26T06:10:01.000Z"));
  eq(state.stalled, true);
  eq(state.recovering, false);
});
```

- [ ] **Step 2: Run the focused test and verify RED**

Run from `private_backend/market-screener-v11.21`:

```powershell
node tests/test-screener-data-job.js
```

Expected: FAIL because `normalizeScreenerDataJob_` and the new summary fields do not exist.

- [ ] **Step 3: Add constants and normalization**

Implement explicit defaults, preserving old cursor and phase values:

```js
const SCREENER_DATA_SOFT_LIMIT_MS = 240000;
const SCREENER_DATA_SAFETY_MS = 15000;
const SCREENER_DATA_STALL_MS = 10 * 60 * 1000;
const SCREENER_DATA_LEASE_MS = 6 * 60 * 1000;

function normalizeScreenerDataJob_(job, nowMs) {
  if (!job) return null;
  const next = JSON.parse(JSON.stringify(job));
  next.revision = Math.max(0, Number(next.revision || 0));
  next.workerId = String(next.workerId || "");
  next.leaseUntil = String(next.leaseUntil || "");
  next.heartbeatAt = String(next.heartbeatAt || "");
  next.lastProgressAt = String(next.lastProgressAt || next.updatedAt || formatDateTime_(new Date(nowMs || Date.now())));
  next.lastScheduledAt = String(next.lastScheduledAt || "");
  next.consecutiveFailures = Math.max(0, Number(next.consecutiveFailures || 0));
  next.retryNotBefore = String(next.retryNotBefore || "");
  next.lastError = String(next.lastError || "");
  next.recovering = next.recovering === true;
  return next;
}
```

Make `readScreenerDataJob_()` normalize parsed jobs, initialize the same fields in `createScreenerDataJob_()`, and compute `stalled` from `lastProgressAt` only for active jobs.

- [ ] **Step 4: Run focused tests and syntax check**

```powershell
node tests/test-screener-data-job.js
node tests/check-syntax.js
```

Expected: both PASS; the existing 51% progress calculation remains unchanged.

- [ ] **Step 5: Record the private checkpoint without staging it**

```powershell
git status --short
git check-ignore -v private_backend/market-screener-v11.21/app.gs
```

Expected: `private_backend` remains ignored and is not staged. Do not commit private backend code to the public repository.

---

### Task 2: Time-Budgeted Minimum Work Units

**Files:**
- Modify: `private_backend/market-screener-v11.21/tests/test-screener-data-job.js`
- Modify: `private_backend/market-screener-v11.21/app.gs:2375-2460`

**Interfaces:**
- Extends: `advanceScreenerDataJob_(job, handlers, options)` with `options.canContinue(processedCount) -> boolean`
- Produces: `createScreenerDataBudget_(startedAtMs, nowFn) -> { canContinue(processedCount), remainingMs() }`
- Guarantees: at least one minimum work unit per invocation when a phase has work, then stops before the safety margin

- [ ] **Step 1: Replace the fixed-two-date test with failing budget tests**

```js
check("history work checkpoints dates until the time budget closes", () => {
  const ctx = buildContext();
  const calls = [];
  const checkpoints = [];
  const job = Object.assign(makeJob(ctx), { phase: "HISTORY" });
  const result = ctx.advanceScreenerDataJob_(job, {
    historyDay: date => { calls.push(date); return { count: 10 }; },
    checkpoint: next => checkpoints.push(next.dateCursor)
  }, { now: () => 2000, canContinue: processed => processed < 3 });
  eq(calls.length, 3);
  eq(result.job.dateCursor, 3);
  eq(checkpoints, [1, 2, 3]);
});

check("history work performs one unit even when the budget is already tight", () => {
  const ctx = buildContext();
  const job = Object.assign(makeJob(ctx), { phase: "HISTORY" });
  const result = ctx.advanceScreenerDataJob_(job, {
    historyDay: () => ({ count: 10 })
  }, { now: () => 2000, canContinue: () => false });
  eq(result.job.dateCursor, 1);
});
```

- [ ] **Step 2: Run the test and verify RED**

```powershell
node tests/test-screener-data-job.js
```

Expected: FAIL because the current loop is limited by `SCREENER_DATA_HISTORY_BATCH === 2`.

- [ ] **Step 3: Implement the budget helper and remove the fixed batch dependency**

Use the supplied clock for deterministic tests:

```js
function createScreenerDataBudget_(startedAtMs, nowFn) {
  nowFn = nowFn || Date.now;
  const deadline = Number(startedAtMs) + SCREENER_DATA_SOFT_LIMIT_MS - SCREENER_DATA_SAFETY_MS;
  return {
    remainingMs: () => Math.max(0, deadline - Number(nowFn())),
    canContinue: processed => Number(processed || 0) === 0 || Number(nowFn()) < deadline
  };
}
```

Change the `HISTORY` loop condition to use `options.canContinue(processed)` and checkpoint every date. Keep other phases at their existing bounded unit size; check the budget between, never during, irreversible operations.

- [ ] **Step 4: Verify focused and source/idempotency regressions**

```powershell
node tests/test-screener-data-job.js
node tests/test-screener-sources.js
node tests/check-syntax.js
```

Expected: all PASS, including the existing same-date upsert test.

- [ ] **Step 5: Confirm no private file is staged**

```powershell
git status --short
```

Expected: only pre-existing public changes and plan documentation appear.

---

### Task 3: Short-Lock Lease and Fenced Checkpoint Commits

**Files:**
- Create: `private_backend/market-screener-v11.21/tests/test-screener-recovery.js`
- Modify: `private_backend/market-screener-v11.21/app.gs:2725-2765`

**Interfaces:**
- Produces: `claimScreenerDataWorker_(event, nowMs, workerId) -> {ok,busy,superseded,terminal,job,revision,workerId}`
- Produces: `commitScreenerDataCheckpoint_(claim, nextJob, nowMs) -> {ok,stale,job}`
- Produces: `releaseScreenerDataWorker_(claim, nextJob, nowMs) -> {ok,stale,job}`
- Replaces screener use of: `runScheduledWithLock_()`; other jobs continue using it unchanged

- [ ] **Step 1: Write failing lease and fencing tests**

Create the new test with its own fixture and the following cases:

```js
const { buildContext, scriptProps, check, eq, ok, report } = require("./harness.js");
const { makeScriptApp } = require("./fake-google.js");

function makeJob(ctx) {
  return ctx.createScreenerDataJob_("bootstrap", ["2026-09-23", "2026-09-22"], {
    now: () => 1000,
    jobId: "data-job-1",
    snapshotId: "snapshot-1"
  });
}

check("only one worker claims an active screener job", () => {
  scriptProps.clear();
  const ctx = buildContext();
  ctx.saveScreenerDataJob_(Object.assign(makeJob(ctx), { phase: "HISTORY", status: "QUEUED" }));
  const first = ctx.claimScreenerDataWorker_({}, 1000, "worker-a");
  const second = ctx.claimScreenerDataWorker_({}, 2000, "worker-b");
  eq(first.ok, true);
  eq(second.busy, true);
});

check("a stale worker cannot overwrite a newer revision", () => {
  scriptProps.clear();
  const ctx = buildContext();
  ctx.saveScreenerDataJob_(Object.assign(makeJob(ctx), { phase: "HISTORY", status: "QUEUED" }));
  const claim = ctx.claimScreenerDataWorker_({}, 1000, "worker-a");
  const current = ctx.readScreenerDataJob_();
  current.revision += 1;
  current.workerId = "worker-b";
  ctx.saveScreenerDataJob_(current);
  const result = ctx.commitScreenerDataCheckpoint_(claim, Object.assign({}, claim.job, { dateCursor: 1 }), 2000);
  eq(result.stale, true);
  eq(ctx.readScreenerDataJob_().dateCursor, 0);
});

process.exit(report("screener data recovery") ? 0 : 1);
```

Add cases for expired lease takeover and for a lock-busy result not changing `consecutiveFailures`.

- [ ] **Step 2: Run the new test and verify RED**

```powershell
node tests/test-screener-recovery.js
```

Expected: FAIL because lease helpers do not exist.

- [ ] **Step 3: Implement claim and fenced commit with only short critical sections**

Use a dedicated one-second lock wrapper for screener coordination:

```js
function withScreenerDataShortLock_(fn) {
  const previousDepth = Number(withScriptWriteLock_.depth || 0);
  if (previousDepth > 0) return fn();
  const lock = LockService.getScriptLock();
  if (!lock.tryLock(1000)) return { ok: false, busy: true };
  withScriptWriteLock_.depth = previousDepth + 1;
  try { return fn(); }
  finally {
    withScriptWriteLock_.depth = previousDepth;
    lock.releaseLock();
  }
}
```

Claim rules:

```js
if (isScreenerDataLeaseActive_(job, nowMs) && job.workerId !== workerId) {
  return { ok: false, busy: true, job: summarizeScreenerDataJob_(job, nowMs) };
}
job.workerId = workerId;
job.leaseUntil = new Date(nowMs + SCREENER_DATA_LEASE_MS).toISOString();
job.heartbeatAt = new Date(nowMs).toISOString();
job.recovering = false;
```

Validate `event.triggerUid` while holding the short lock. If it differs from the current expected UID, return `superseded`; before returning, verify a future worker trigger exists or create one. For an accepted event, mark only that expected UID consumed. Do not delete all triggers for the handler.

Commit only when `jobId`, `revision`, and `workerId` match the claim. On success increment revision, refresh lease/heartbeat, and update the mutable claim revision. On release clear `workerId` and `leaseUntil`; do not regress cursor or phase.

- [ ] **Step 4: Rebuild `runScreenerDataRefresh` around the lease**

The worker flow must be:

```js
function runScreenerDataRefresh(event) {
  const startedAt = Date.now();
  const workerId = Utilities.getUuid();
  const claim = claimScreenerDataWorker_(event, startedAt, workerId);
  if (!claim.ok) return claim;
  const budget = createScreenerDataBudget_(startedAt, Date.now);
  const handlers = buildLiveScreenerDataHandlers_();
  handlers.checkpoint = next => {
    const committed = commitScreenerDataCheckpoint_(claim, next, Date.now());
    if (!committed.ok) throw new Error("SCREENER_LEASE_LOST");
  };
  const result = advanceScreenerDataJob_(claim.job, handlers, { canContinue: budget.canContinue });
  return finishScreenerDataWorker_(claim, result.job, Date.now());
}
```

Generate the worker ID without relying on `Utilities.getUuid()` in tests by allowing a test override/helper. Do not call external handlers inside `withScreenerDataShortLock_`.

- [ ] **Step 5: Verify concurrency and existing job tests**

```powershell
node tests/test-screener-recovery.js
node tests/test-screener-data-job.js
node tests/check-syntax.js
```

Expected: all PASS; a second worker returns `busy`, and a stale worker cannot commit.

- [ ] **Step 6: Private checkpoint review**

Inspect the diff locally and confirm `runScheduledWithLock_` is unchanged for all non-screener handlers. Do not stage private files.

---

### Task 4: Five-Minute Watchdog and Lost-Trigger Repair

**Files:**
- Modify: `private_backend/market-screener-v11.21/tests/test-screener-recovery.js`
- Modify: `private_backend/market-screener-v11.21/tests/fake-google.js` only if delayed-trigger metadata is required
- Modify: `private_backend/market-screener-v11.21/app.gs:2700-2775`

**Interfaces:**
- Produces: `ensureScreenerDataWatchdogTrigger_() -> {ok,scheduled,removed,handler}`
- Produces: `ensureScreenerDataRefreshScheduled_() -> {ok,scheduled,existing,triggerUid}`
- Produces: `runScreenerDataWatchdog() -> {ok,idle,healthy,busy,recovering,scheduled}`
- Produces: `repairScreenerDataRefresh() -> summarized job state`
- Changes: `runScreenerDailyUpdate()` becomes an idempotent ensure operation

- [ ] **Step 1: Add failing watchdog tests**

```js
check("watchdog installs exactly one five-minute trigger", () => {
  const scriptApp = makeScriptApp();
  const ctx = buildContext({ ScriptApp: scriptApp });
  ctx.withScriptWriteLock_.depth = 1;
  ctx.ensureScreenerDataWatchdogTrigger_();
  ctx.ensureScreenerDataWatchdogTrigger_();
  const live = scriptApp._triggers.filter(t => t.getHandlerFunction() === "runScreenerDataWatchdog");
  eq(live.length, 1);
  eq(live[0].getEveryMinutes(), 5);
});

check("watchdog repairs an active job with no worker trigger", () => {
  scriptProps.clear();
  const scriptApp = makeScriptApp();
  const ctx = buildContext({ ScriptApp: scriptApp });
  ctx.saveScreenerDataJob_(Object.assign(makeJob(ctx), {
    phase: "HISTORY", status: "QUEUED", workerId: "", leaseUntil: "",
    lastProgressAt: "2026-09-26T00:00:00.000Z"
  }));
  const result = ctx.runScreenerDataWatchdog({ nowMs: Date.parse("2026-09-26T00:11:00.000Z") });
  eq(result.recovering, true);
  eq(scriptApp._triggers.filter(t => t.getHandlerFunction() === "runScreenerDataRefresh").length, 1);
});
```

Add tests proving completed jobs remain idle, live leases remain healthy, lock busy returns `busy`, and a superseded worker event leaves either a valid worker trigger or the installed watchdog.

Also add a retry schedule test: true data failures set `retryNotBefore` using 1, 2, 5, then 10 minute delays; the watchdog must not schedule a worker before that timestamp. `busy`, active lease, and `superseded` outcomes leave both `consecutiveFailures` and `retryNotBefore` unchanged.

- [ ] **Step 2: Run recovery tests and verify RED**

```powershell
node tests/test-screener-recovery.js
```

Expected: FAIL on missing watchdog functions.

- [ ] **Step 3: Implement non-destructive trigger ensure helpers**

Use `ScriptApp.getProjectTriggers()` to check before creating:

```js
function ensureScreenerDataRefreshScheduled_() {
  const handler = "runScreenerDataRefresh";
  const existing = ScriptApp.getProjectTriggers().filter(t => t.getHandlerFunction() === handler);
  if (existing.length) return { ok: true, scheduled: false, existing: existing.length };
  return scheduleOneTimeTrigger_(handler, 60000, { replace: false });
}
```

Install one `runScreenerDataWatchdog` trigger with `.timeBased().everyMinutes(5).create()`. Remove only duplicate watchdog triggers, never an unrelated handler.

- [ ] **Step 4: Implement watchdog, daily ensure, and manual repair**

`runScreenerDataWatchdog` must use the one-second screener lock. It should set `recovering=true` and update `lastScheduledAt` only when it actually schedules a missing/stalled worker. It must return `backoff=true` without scheduling while `retryNotBefore` is still in the future. `repairScreenerDataRefresh()` must install the watchdog and re-arm the existing active job without replacing it.

```js
function runScreenerDailyUpdate() {
  return startScreenerDataRefresh_({ mode: "daily", force: false, ensureRecovery: true });
}

function repairScreenerDataRefresh() {
  return withScreenerDataShortLock_(() => {
    ensureScreenerDataWatchdogTrigger_();
    const job = readScreenerDataJob_();
    if (isScreenerDataJobActive_(job)) ensureScreenerDataRefreshScheduled_();
    return summarizeScreenerDataJob_(job, Date.now());
  });
}
```

Avoid nested acquisition: helpers called from the repair critical section must recognize the held lock or accept an `alreadyLocked` option.

- [ ] **Step 5: Run backend screener and scheduler regressions**

```powershell
node tests/test-screener-recovery.js
node tests/test-screener-data-job.js
node tests/test-screener-jobs.js
node tests/test-daily-indicator-queue.js
node tests/check-syntax.js
```

Expected: all PASS; daily-indicator behavior is unchanged.

- [ ] **Step 6: Confirm the current job can be repaired without reset in the fake environment**

Add and run a test seeded with `dateCursor: 87` that invokes `repairScreenerDataRefresh()` and verifies the cursor stays 87 while watchdog and worker triggers are installed.

---

### Task 5: Frontend Recovery State and Polling Regression

**Files:**
- Modify: `private_backend/market-screener-v11.21/tests/test-screener-ui.js`
- Modify: `js/app.js:286-298`
- Mirror: `private_backend/market-screener-v11.21/js/app.js`

**Interfaces:**
- Consumes: `meta.data.{progress,status,stalled,recovering,lastError,lastProgressAt}`
- Preserves: `scheduleScreenerDataPoll_()` ten-second polling and terminal-state behavior

- [ ] **Step 1: Add failing frontend copy tests**

Extend the UI harness with a `screenerMetaStatus` element and test the pure rendering behavior:

```js
check("screener metadata distinguishes automatic recovery from normal progress", () => {
  const ui = loadRunUi();
  ui.state.meta = { data: { dataDate: "2026-09-24", status: "QUEUED", progress: 51, stalled: true, recovering: true } };
  ui.context.renderScreenerMeta_();
  ok(/51%/.test(ui.elements.get("screenerMetaStatus").textContent));
  ok(/正在自動恢復/.test(ui.elements.get("screenerMetaStatus").textContent));
});
```

Add a terminal failure test that shows `背景更新暫停` and does not expose lease/trigger jargon.

- [ ] **Step 2: Run UI test and verify RED**

```powershell
node tests/test-screener-ui.js
```

Expected: FAIL because the current renderer only prints the percentage.

- [ ] **Step 3: Implement minimal status copy**

Keep the existing date and market suffix:

```js
const progressText = data.status === "FAILED"
  ? " · 背景更新暫停"
  : data.recovering || data.stalled
    ? ` · 背景更新 ${data.progress || 0}% · 正在自動恢復`
    : data.status && data.status !== "COMPLETED" && data.status !== "NOT_STARTED"
      ? ` · 背景更新 ${data.progress || 0}%`
      : "";
```

Do not add a new panel, stored preference, or user-facing technical diagnostics.

- [ ] **Step 4: Mirror the public file and verify identity**

Use the repository's normal copy method, then verify hashes:

```powershell
Get-FileHash js/app.js,private_backend/market-screener-v11.21/js/app.js | Select-Object Hash
```

Expected: hashes are identical.

- [ ] **Step 5: Run frontend regressions**

```powershell
node tests/test-screener-ui.js
node tests/test-section-subtitles.js
node tests/test-runtime-backend-version.js
node tests/check-syntax.js
```

Expected: all PASS.

---

### Task 6: Release Version, Full Verification, and Safe Deployment

**Files:**
- Modify: `private_backend/market-screener-v11.21/app.gs:1-2`
- Modify: `private_backend/market-screener-v11.21/tests/test-release-version.js`
- Modify only version line: `js/config.js`
- Modify: `index.html`
- Modify: `service-worker.js`
- Mirror: `private_backend/market-screener-v11.21/{js/config.js,index.html,service-worker.js}`

**Interfaces:**
- Backend/frontend release: `v11.23`
- PWA asset query and cache key: `v11.23`
- Preserves: current `API_BASE_URL`

- [ ] **Step 1: Update the release-version test first**

Change assertions to require v11.23 consistently:

```js
check("backend and frontend expose v11.23", () => {
  ok(read("app.gs").includes('const APP_VERSION = "v11.23";'));
  ok(read("js/config.js").includes('const APP_VERSION = "v11.23";'));
});
```

Require `CACHE_VERSION = "v11.23"` and `?v=11.23` for all versioned shell assets.

- [ ] **Step 2: Run the release test and verify RED**

```powershell
node tests/test-release-version.js
```

Expected: FAIL while files still advertise v11.22/v11.22.1.

- [ ] **Step 3: Bump versions without overwriting the endpoint**

Before editing, record the endpoint line:

```powershell
Select-String -Path js/config.js -Pattern '^const API_BASE_URL'
```

Change only the intended version/cache strings to v11.23, mirror public frontend files into the private test fixture, then run the same command again and confirm the endpoint line is identical.

- [ ] **Step 4: Run the complete private test suite**

From `private_backend/market-screener-v11.21`:

```powershell
node tests/check-syntax.js
$failed = $false
Get-ChildItem tests/test-*.js | ForEach-Object {
  node $_.FullName
  if ($LASTEXITCODE -ne 0) { $failed = $true }
}
if ($failed) { exit 1 }
```

Expected: syntax and every test file PASS.

- [ ] **Step 5: Review public diff and commit only public release files**

```powershell
git diff --check
git diff -- js/app.js js/config.js index.html service-worker.js
git status --short
git add js/app.js index.html service-worker.js
git add -p js/config.js
git commit -m "fix: make screener refresh self-healing"
```

When `git add -p` shows the pre-existing `API_BASE_URL` change and the new `APP_VERSION` change in one hunk, use interactive edit and retain only the `APP_VERSION` lines in the staged patch. Expected: the commit contains no `private_backend` path and no `API_BASE_URL` line; the working tree keeps the user's endpoint change unstaged.

- [ ] **Step 6: Deploy the tested private backend**

In Apps Script, replace the deployed source with the tested private `app.gs`, create a new web-app version, and confirm the runtime version endpoint returns `v11.23`. This is a deployment action and requires the user's explicit go-ahead at execution time.

- [ ] **Step 7: Repair rather than restart the active job**

Run `repairScreenerDataRefresh()` once from Apps Script. Verify:

```text
dateCursor remains 87 (or the latest value already reached)
runScreenerDataWatchdog exists once with a five-minute cadence
runScreenerDataRefresh exists once as the next worker
status remains QUEUED/RUNNING rather than returning to NOT_STARTED
```

- [ ] **Step 8: Observe two watchdog periods before frontend publication**

Wait at least ten minutes while checking Apps Script executions. Acceptance evidence:

```text
progress or dateCursor advances
no worker invocation exceeds the 240-second soft limit
lock-busy runs return without marking the job failed
removing/missing one worker trigger is repaired by the watchdog
```

- [ ] **Step 9: Push the public commit and verify production UI**

Push only after backend observation succeeds. Hard-refresh the GitHub Pages screener and confirm it shows v11.23, continues from the existing percentage, and displays automatic recovery copy only while stalled/recovering.

---

## Final Verification Checklist

- [ ] Existing 51% job resumes from its saved cursor; no bootstrap reset occurs.
- [ ] One and only one five-minute `runScreenerDataWatchdog` trigger exists.
- [ ] Missing one-shot worker triggers are recreated within five minutes.
- [ ] External fetches do not execute while the screener owns the Script lock.
- [ ] Duplicate workers cannot move cursor backward or duplicate per-date rows.
- [ ] Lock contention and superseded events do not consume the five-error budget.
- [ ] Frontend still polls metadata every ten seconds and results remain ten per page.
- [ ] All private tests pass, `git diff --check` is clean, and no private backend file is in the public commit.
- [ ] `js/config.js` retains the user's deployed API URL.
