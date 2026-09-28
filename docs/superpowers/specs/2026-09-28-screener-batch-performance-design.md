# Screener Batch Performance Design

## Goal

Reduce a full-market screener run from the measured 300.6 seconds without changing the screener conditions, AND semantics, ten-row page size, displayed columns, or the rest of the application. Completed-result paging and sorting must remain local and effectively immediate.

## Measured Baseline

- Dataset: 2,313 matching TWSE/TPEX rows on snapshot date 2026-09-24.
- End-to-end completion: 300.6 seconds.
- First 200 visible rows: 28.1 seconds.
- Subsequent batch interval: mean 24.8 seconds, median 24.6 seconds, range 20.6-29.5 seconds.
- Completed paging: mean 0.331 seconds across ten page changes.
- Completed sorting: mean 20.9 milliseconds across ten sort changes.

The performance target for the first release is less than 90 seconds for the same 2,313-row broad-market query under comparable Apps Script conditions. A stretch target of less than 30 seconds belongs to a later one-pass execution change and is not required for this release.

## Selected Approach

Use progressive, backward-compatible optimization rather than replacing the job system. Existing jobs, scheduled recovery, owner isolation, durable result storage, and completed-result fallback stay available.

Two alternatives were rejected for this release:

- Processing the entire universe in one request removes nearly all orchestration overhead, but it increases Apps Script timeout risk before the repeated sheet work has been removed and measured.
- Migrating to an indexed external database would improve query flexibility, but it introduces new infrastructure, credentials, cost, and migration risk for only 2,313 rows.

## Architecture

### 1. Read only the current snapshot batch

At job creation, resolve the active snapshot into a contiguous sheet block and store its first data row and row count on the screener job. Each batch reads only `cursor..cursor+batchSize` from that block and converts that range into snapshot objects. It must not call `getSheetObjects_(SHEETS.SCREENER_SNAPSHOT)` or sort the complete snapshot during normal continuation.

The first batch reuses the active snapshot rows already loaded for validation. Legacy or recovery jobs without valid block metadata use the existing full-sheet path as a compatibility fallback.

### 2. Avoid normal-path result rescans

Under the existing script write lock, a normal batch appends its matches without first loading all `ScreenerResults`. Cursor advancement guarantees that a successfully committed batch is not processed twice.

If an earlier attempt failed, the recovery path performs the existing durable-result reconciliation before retrying. This keeps normal batches fast without giving up idempotent recovery after a partial failure. Final reads continue deduplicating by symbol as a last safety boundary.

Only the modified screener job row is written back to `ScreenerJobs`; the complete jobs sheet is not rewritten for every successful batch. Whole-sheet writes remain available for purge and migration operations.

### 3. Return incremental compact results

`startScreener` and `continueScreener` return the compact matches produced by that invocation as `batchResults`. Each item contains only:

- `symbol`
- `name`
- `market`
- `industry`
- `close`
- `changePercent`
- `volume`
- `peRatio`
- `rsi14`

The browser accumulates rows in a job-scoped map keyed by normalized symbol, sorts the accumulated values locally, and renders the selected ten-row page. While the job is running, page and sort operations therefore make zero `getScreenerResults` calls after the first batch has arrived.

On refresh, reconnect, rejected revision, or transport failure, the current paged API remains the fallback. At completion, the existing full compact bundle remains the authoritative reconciliation response.

### 4. Continue promptly

After a successful running response, schedule the next continuation after 500 milliseconds instead of 5,000 milliseconds. Network or server errors keep the existing slower retry behavior so transient failures do not create a tight request loop.

The start button remains disabled and labelled `選股中` for the entire active job. Only one continuation may be in flight.

### 5. Increase the batch only after fixed overhead is removed

Raise the normal batch size from 200 to 500 after the preceding changes pass focused tests. With 2,313 rows this reduces the expected batch count from twelve to five. Recovery and timeout handling continue from the persisted cursor.

Batch size remains one constant so it can be reduced without changing the response contract if production executions approach the Apps Script limit.

## Data Model And Compatibility

Add optional screener-job columns for the snapshot block metadata. Header migration must preserve all existing rows. Jobs without the new values remain readable and use the legacy snapshot scan.

`batchResults` is additive. Older frontends ignore it, and the backend continues supporting `getScreenerResults`, `getScreenerStatus`, and completed `results` envelopes.

Result rows remain durable in `ScreenerResults`. No browser result data is written to `localStorage` or `sessionStorage`.

## Error Handling

- Validate block metadata against the job snapshot ID before range reads; fall back to the legacy scan if it is missing or stale.
- Do not advance the cursor or match count until the result append succeeds.
- Mark a failed attempt using the existing retry policy. A retry reconciles durable results before appending.
- Reject `batchResults` whose `jobId` or revision sequence does not match the active job.
- Preserve currently visible rows during retry and fallback requests.
- Keep the completed full-result response as final reconciliation, preventing missing or duplicated browser rows.

## Testing

Backend tests must prove:

- Normal continuation reads only one snapshot range and does not scan the complete snapshot.
- Normal result append does not read the complete results sheet.
- A retry reconciles durable results and does not create duplicate logical results.
- A successful batch updates one job row rather than rewriting the jobs sheet.
- `batchResults` contains only the nine allowed fields and matches the processed cursor range.
- Legacy jobs without block metadata still complete through the fallback path.
- A 2,313-row job completes in five batches at batch size 500.

Frontend tests must prove:

- Incremental batches merge by symbol and reject the wrong job or stale revision.
- Running-job paging and sorting use accumulated local rows with zero result API calls.
- Polling waits 500 milliseconds after success and retains the existing error backoff.
- Starting a new job clears all prior incremental and completed rows.
- Completion reconciles the incremental set with the authoritative full bundle.

Run the complete private backend suite, syntax checks, public/private mirror checks, and release-version tests before committing the runtime release.

## Release And Measurement

The implementation release will be `v11.26`. Public and private frontend runtime files remain byte-identical. Do not push or deploy until explicitly requested.

After deployment, repeat the same broad `TWSE + TPEX` query and record:

- time to first visible batch;
- each batch milestone;
- total completion time;
- completed and in-progress paging times;
- Apps Script failures or retries.

If total time remains above 90 seconds, use the new timing evidence to decide whether to move the already-optimized path to one-pass execution.
