# Remove Section Subtitles Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Remove the six requested explanatory subtitle lines and make the after-hours candidate subtitle show only its `YYYY-MM-DD` data date.

**Architecture:** Implement and test the change in the private source worktree, then mirror only the three public runtime files into the GitHub Pages repository. Keep candidate-date rendering in the existing `renderCandidates` path, remove the unused visible screener-progress node, and use a frontend-only `11.22.1` cache suffix so browsers receive the changed HTML and JavaScript without changing the backend or displayed application version.

**Tech Stack:** Static HTML, browser JavaScript, Node.js VM tests, service worker cache versioning, Git.

## Global Constraints

- 「盤後候選」下方只顯示資料日期，格式為 `YYYY-MM-DD`；沒有日期時顯示空字串。
- 「買入候選」、「賣出候選」、「自訂選股條件」、「符合條件清單」、「持有部位」與「線圖分析」下方不顯示小字。
- Do not change tables, buttons, data flow, colors, spacing, backend code, or the displayed `v11.22` application version.
- Preserve the existing uncommitted `C:\Users\user\Desktop\git\Stock\js\config.js` change exactly; never stage or overwrite that file.
- Private source worktree: `C:\Users\user\Desktop\git\Stock\private_backend\market-screener-v11.21`.
- Public GitHub Pages repository: `C:\Users\user\Desktop\git\Stock`.

---

### Task 1: Remove the visible subtitle copy

**Files:**
- Create: `private_backend/market-screener-v11.21/tests/test-section-subtitles.js`
- Modify: `private_backend/market-screener-v11.21/index.html:148-348`
- Modify: `private_backend/market-screener-v11.21/js/app.js:2081-2091`

**Interfaces:**
- Consumes: `renderCandidates(data)` where `data.dataDate` is a string such as `2026-09-24`.
- Produces: `candidateStatus.textContent` containing only `data.dataDate`; no visible `screenerProgress` element.

- [ ] **Step 1: Write the failing subtitle regression test**

Create `tests/test-section-subtitles.js` in the private worktree:

```js
const fs = require("fs");
const path = require("path");
const vm = require("vm");
const { check, eq, ok, report } = require("./harness.js");

const root = path.join(__dirname, "..");
const html = fs.readFileSync(path.join(root, "index.html"), "utf8");
const source = fs.readFileSync(path.join(root, "js", "app.js"), "utf8");

check("requested section subtitles are absent from visible HTML", () => {
  [
    "僅從啟用的關注清單自動產生",
    "僅從目前持有數量大於零的庫存自動產生",
    "所有條件固定以 AND 組合；本版不儲存策略。",
    "加入條件後即可開始掃描全市場。",
    "今日損益以最近兩個交易日收盤價計算",
    "輸入台股代號查看線圖、指標、系統分析、持股與交易。"
  ].forEach(copy => ok(!html.includes(copy), `subtitle still present: ${copy}`));
  ok(/id="candidateStatus" class="muted">\s*<\/div>/.test(html), "candidate status has initial copy");
  ok(!html.includes('id="screenerProgress"'), "visible screener progress subtitle still exists");
});

check("after-hours candidate subtitle renders only the data date", () => {
  const start = source.indexOf("function renderCandidates(data)");
  const end = source.indexOf("function candidateEmptyRow", start);
  ok(start >= 0 && end > start, "renderCandidates source is missing");

  const elements = new Map([
    ["candidateSort", { value: "totalScore" }],
    ["candidateFilter", { value: "all" }],
    ["candidateStatus", { textContent: "" }],
    ["candidateSummary", { innerHTML: "" }],
    ["buyCandidatesBody", { innerHTML: "" }],
    ["sellCandidatesBody", { innerHTML: "" }]
  ]);
  const sandbox = {
    document: { getElementById: id => elements.get(id) || null },
    sortCandidateItems: items => items,
    candidateMatchesFilter: () => true,
    cacheExplainContext: () => {},
    summaryCard: () => "",
    candidateEmptyRow: () => "",
    renderCandidateReasons: () => "",
    escapeHtml: value => String(value)
  };
  const context = vm.createContext(sandbox);
  vm.runInContext(source.slice(start, end), context, { filename: "js/app.js:renderCandidates" });

  context.renderCandidates({ dataDate: "2026-09-24", buyCandidates: [], sellCandidates: [] });
  eq(elements.get("candidateStatus").textContent, "2026-09-24");
});

process.exit(report("section subtitle cleanup") ? 0 : 1);
```

- [ ] **Step 2: Run the test and verify the expected failures**

Run from the private worktree:

```powershell
node tests/test-section-subtitles.js
```

Expected: FAIL because the six explanatory strings still exist and `renderCandidates` currently writes date, counts, and reference copy.

- [ ] **Step 3: Apply the minimal HTML and JavaScript change**

In private `index.html`:

- Change `candidateStatus` to an empty element: `<div id="candidateStatus" class="muted"></div>`.
- Delete the six specified subtitle `<div>` elements.
- Delete the complete `<div id="screenerProgress" class="muted">...</div>` element.
- Preserve each surrounding header wrapper and every button/table node.

In private `js/app.js`, replace the current candidate-status template with:

```js
  const status = document.getElementById("candidateStatus");
  status.textContent = String(data.dataDate || "");
```

- [ ] **Step 4: Run focused tests**

```powershell
node tests/test-section-subtitles.js
node tests/test-screener-ui.js
node tests/check-syntax.js
```

Expected: all PASS.

- [ ] **Step 5: Commit the private source change**

```powershell
git add index.html js/app.js tests/test-section-subtitles.js
git commit -m "fix: simplify section subtitles"
```

Expected: only the three listed files are committed.

---

### Task 2: Bust the static frontend cache

**Files:**
- Modify: `private_backend/market-screener-v11.21/tests/test-release-version.js`
- Modify: `private_backend/market-screener-v11.21/index.html:524`
- Modify: `private_backend/market-screener-v11.21/service-worker.js:13-22`

**Interfaces:**
- Consumes: unchanged displayed application version `v11.22` and unchanged asset URLs for CSS, config, API, and indicator explanation.
- Produces: cache name `stocklab-shell-v11.22.1` and `js/app.js?v=11.22.1` in both HTML and the service-worker precache list.

- [ ] **Step 1: Change the release test first**

Update only the `static shell cache keys are synchronized` test to assert:

```js
check("frontend-only patch cache keys are synchronized", () => {
  const html = read("index.html");
  const worker = read("service-worker.js");
  eq((html.match(/\?v=11\.22(?:["'])/g) || []).length, 4);
  eq((html.match(/js\/app\.js\?v=11\.22\.1/g) || []).length, 1);
  ok(worker.includes('const CACHE_VERSION = "v11.22.1";'));
  eq((worker.match(/\?v=11\.22(?:["'])/g) || []).length, 4);
  eq((worker.match(/js\/app\.js\?v=11\.22\.1/g) || []).length, 1);
  ok(!html.includes("11.21"));
  ok(!worker.includes("11.21"));
});
```

- [ ] **Step 2: Run the release test and verify it fails**

```powershell
node tests/test-release-version.js
```

Expected: FAIL because the cache and `app.js` asset key are still `v11.22`.

- [ ] **Step 3: Implement the cache-only patch suffix**

In private `service-worker.js`:

```js
const CACHE_VERSION = "v11.22.1";
```

Change only the `app.js` precache entry to:

```js
  "./js/app.js?v=11.22.1",
```

In private `index.html`, change only the `app.js` script URL to:

```html
<script defer src="js/app.js?v=11.22.1"></script>
```

Do not edit `js/config.js` or `APP_VERSION`.

- [ ] **Step 4: Run the complete private suite**

```powershell
$failed = @()
& node tests/check-syntax.js
if ($LASTEXITCODE -ne 0) { $failed += "check-syntax.js" }
Get-ChildItem tests\test-*.js | Sort-Object Name | ForEach-Object {
  & node $_.FullName
  if ($LASTEXITCODE -ne 0) { $failed += $_.Name }
}
if ($failed.Count -gt 0) { throw "Failed: $($failed -join ', ')" }
```

Expected: syntax check and all test files PASS.

- [ ] **Step 5: Commit the private cache change**

```powershell
git add index.html service-worker.js tests/test-release-version.js
git commit -m "chore: refresh frontend cache for subtitle cleanup"
```

Expected: only the three listed files are committed.

---

### Task 3: Mirror the tested runtime files into GitHub Pages

**Files:**
- Modify: `index.html`
- Modify: `js/app.js`
- Modify: `service-worker.js`

**Interfaces:**
- Consumes: the tested private versions of the three runtime files from Tasks 1 and 2.
- Produces: byte-for-byte matching public runtime files while preserving the public repository's existing `js/config.js` working-tree modification.

- [ ] **Step 1: Mirror the three tested runtime files**

Apply the exact Task 1 and Task 2 edits to public `index.html`, `js/app.js`, and `service-worker.js`. Use `apply_patch`; do not copy or stage `js/config.js`.

- [ ] **Step 2: Verify private/public runtime parity**

Run from `C:\Users\user\Desktop\git\Stock`:

```powershell
git diff --no-index -- index.html private_backend\market-screener-v11.21\index.html
git diff --no-index -- js\app.js private_backend\market-screener-v11.21\js\app.js
git diff --no-index -- service-worker.js private_backend\market-screener-v11.21\service-worker.js
```

Expected: all three commands produce no diff and return exit code 0.

- [ ] **Step 3: Verify public syntax and diff scope**

```powershell
node --check js\app.js
node --check service-worker.js
git diff --check -- index.html js\app.js service-worker.js
git status --short
```

Expected: syntax and diff checks pass. Status shows the three intended runtime files plus the pre-existing `M js/config.js`; `js/config.js` remains unstaged and unchanged by this work.

- [ ] **Step 4: Commit only the public runtime files**

```powershell
git add index.html js/app.js service-worker.js
git commit -m "fix: simplify section subtitles"
```

Expected: `js/config.js` is not part of the commit and remains in the working tree.

- [ ] **Step 5: Final verification**

```powershell
git show --stat --oneline HEAD
git diff HEAD -- js/config.js
git -C private_backend\market-screener-v11.21 status --short
```

Expected: the public commit contains only `index.html`, `js/app.js`, and `service-worker.js`; the user's `js/config.js` diff remains intact; the private worktree is clean.
