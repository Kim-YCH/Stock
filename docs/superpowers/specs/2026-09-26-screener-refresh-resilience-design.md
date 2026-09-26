# 全市場選股背景更新韌性設計

## 背景

2026-09-25 的首次全市場資料建立停在 51%。實際執行紀錄顯示：

- `runScreenerDataRefresh` 曾執行超過約六分鐘並逾時。
- 逾時後短時間內出現多次重疊執行，最後一次執行沒有留下下一個有效觸發器。
- 常駐執行的是 `runDailyIndicatorWatchdog`，不是選股資料更新。
- 當晚 `runScreenerDailyUpdate` 嘗試恢復時，因無法取得 Script 寫入鎖而失敗。
- 工作狀態仍停留在 `HISTORY`，因此前端忠實顯示後端保存的 51%。

問題不是單一錯誤，而是目前設計同時依賴「單次執行不逾時」、「一次性觸發器不中斷」和「全域鎖能在 30 秒內取得」。任一條件失敗，都可能讓工作永久停住。

## 目標

1. 單次 Apps Script 執行逾時、鎖衝突或一次性觸發器遺失後，選股資料工作能自行恢復。
2. 每個已完成日期都立即保存，恢復時不從頭重跑，也不讓進度倒退。
3. 同一時間最多只有一個有效 worker 推進相同工作；重複事件必須安全且冪等。
4. 現有選股條件、AND 邏輯、資料表格式、每頁 10 筆和其他頁面行為不變。
5. 可從目前 51% 的既有工作繼續，不強制清除或重建已完成資料。

## 非目標

- 不把後端搬離 Google Apps Script。
- 不改寫 `runDailyIndicatorWatchdog` 的既有資料處理流程。
- 不改變選股指標公式、來源或篩選結果。
- 不新增使用者可儲存的選股策略。
- 不以人工每天檢查觸發器作為復原機制。

## 採用方案

採用「常駐監控器 + 有時間預算的 worker + checkpoint + 短鎖 lease」設計。

一次性 `runScreenerDataRefresh` 仍負責快速接力；另新增每五分鐘執行一次的 `runScreenerDataWatchdog` 作為獨立保底。即使快速接力中斷，監控器最多在下一個週期重新建立工作觸發器。

### 未採用方案

1. **只把每批兩日改成一日**：可以降低逾時機率，但單日仍可能變慢，也不能解決觸發器遺失。
2. **只在 `finally` 建立下一個觸發器**：Apps Script 強制逾時時不保證會執行 `finally`，仍可能斷鏈。
3. **移至 Cloud Run 或 Cloud Tasks**：韌性最好，但增加部署、權限與費用，目前規模不需要。

## 工作狀態

沿用現有工作資料，新增以下欄位；讀取舊工作時以安全預設值補齊，因此不需要資料遷移：

- `revision`：每次成功提交 checkpoint 加一，用來防止舊 worker 覆寫新狀態。
- `workerId`：目前 lease 擁有者的唯一識別碼。
- `leaseUntil`：lease 到期時間。
- `heartbeatAt`：worker 最近一次確認仍在執行的時間。
- `lastProgressAt`：最近一次 cursor、phase 或輸出確實前進的時間。
- `lastScheduledAt`：最近一次確認快速接力觸發器存在的時間。
- `consecutiveFailures`：連續資料處理失敗次數；鎖忙或 superseded 不計入。
- `lastError`：最後一個可供管理者與前端辨識的錯誤摘要。

既有 `jobId`、`phase`、`dateCursor`、`metricCursor`、`status` 和 `progress` 保持相容。

## 元件設計

### 1. `runScreenerDataRefresh` worker

每次執行使用 240 秒軟性時間預算，不再依賴固定的兩日批次：

1. 短暫取得 Script lock。
2. 讀取工作；若已完成或失敗則直接返回。
3. 若存在尚未過期的其他 worker lease，返回 `busy`，不算失敗。
4. 建立 `workerId`、更新 `leaseUntil` 與 `heartbeatAt`，保存後立即釋放鎖。
5. 執行一個可 checkpoint 的最小工作單位；歷史階段以一個日期為單位。
6. 再短暫取得鎖，確認 `jobId`、`revision` 和 `workerId` 仍符合後提交結果。
7. 每完成一個單位即增加 `revision`、更新 cursor 與 `lastProgressAt`。
8. 若剩餘時間不足安全緩衝，主動結束；不得等到平台強制終止。
9. 工作尚未完成時，確認 60 秒後有一個快速接力觸發器。

外部資料請求與大量運算不得在持有 Script lock 時進行。若 lease 在處理期間到期，worker 在提交前必須再次驗證；舊 worker 不得覆寫較新的 revision。

歷史日期寫入維持依日期／股票鍵值 upsert，讓同一最小工作單位因逾時被重新執行時不會產生重複資料。

### 2. `runScreenerDataWatchdog` 常駐監控器

安裝一個每五分鐘執行的永久 time-driven trigger。監控器只做檢查與排程，不執行市場資料抓取，因此應快速結束。

檢查順序：

1. 沒有工作或工作已完成：返回 `idle`。
2. 有未過期 lease：返回 `healthy`。
3. 工作仍有效，但沒有快速接力觸發器：建立一個 60 秒後執行的 worker trigger。
4. `lastProgressAt` 超過 10 分鐘且 lease 已過期：清除舊 lease 並建立 worker trigger。
5. Script lock 忙碌：立即返回 `busy`；五分鐘後自然重試，不把工作標成失敗。

監控器不得刪除仍有效的新世代觸發器。若發現多個快速接力觸發器，只保留目前 expected UID 對應的觸發器；無法確認時不做破壞性刪除，交由 lease 阻止重複推進。

### 3. 快速接力與 trigger UID

- worker 成功保存 checkpoint 後才更新下一棒的 expected UID。
- 收到舊 UID 事件時可以返回 `superseded`，但返回前必須確認工作已完成、已有有效下一棒，或常駐監控器已安裝。
- 建立新觸發器失敗時保存 `lastError`，但保留工作為可恢復狀態；常駐監控器稍後重試。
- 不因一次鎖逾時刪除整個 handler 的所有觸發器。

### 4. 每日啟動

`runScreenerDailyUpdate` 改為冪等請求：

- 沒有活動工作時建立每日工作並確保 worker trigger。
- 已有活動工作時不重建資料，只確認 watchdog 和 worker trigger 存在。
- 無法取得鎖時返回 `busy` 並記錄診斷資訊；常駐 watchdog 負責後續恢復，不讓當日工作永久失聯。

## 前端狀態

既有百分比顯示保留。`screenerMeta` 額外回傳：

- `lastProgressAt`
- `stalled`
- `lastError`
- `recovering`

顯示規則：

- 正常執行：`背景更新 51%`
- 超過 10 分鐘沒有進度且系統已重新排程：`背景更新 51% · 正在自動恢復`
- 連續失敗達上限：`背景更新暫停`，並顯示可操作的重新啟動按鈕。

資料日期和現有版面維持不變；不增加一般使用者需要理解的 worker、lease 或 trigger 技術資訊。

## 錯誤處理

- 鎖忙、有效 lease、舊 UID：屬於控制流程，不增加 `consecutiveFailures`。
- 外部 API、資料解析或寫入錯誤：保存錯誤摘要並增加失敗次數。
- 失敗後採 1、2、5、10 分鐘退避，之後維持 10 分鐘。
- 同一最小工作單位連續失敗 5 次後將工作標示為 `FAILED`，避免無限消耗配額。
- 新工作或人工重新啟動會清除失敗計數，但保留可用 checkpoint；除非明確要求，不刪除已完成資料。
- 日誌至少包含 `jobId`、phase、cursor、revision、workerId、triggerUid、執行秒數與結果類型。

## 復原目前 51% 工作

部署後不建立新的 bootstrap job：

1. 讀取既有活動工作並補上新增欄位。
2. 安裝唯一的 `runScreenerDataWatchdog` 常駐觸發器。
3. 清除確認已失效的舊 lease／expected UID。
4. 建立一個快速接力觸發器。
5. 從既有 `dateCursor` 繼續。

若既有工作資料損壞或對應資料表不存在，才停止並要求重新 bootstrap；不得默默把 51% 歸零。

## 測試策略

### 單元測試

- 240 秒時間預算到達時，worker 保存 checkpoint 並正常返回。
- 單一日期超過預算後，下次從相同日期安全重試。
- revision 或 workerId 不一致時，舊 worker 無法覆寫新進度。
- 鎖忙與有效 lease 不增加失敗次數。
- 同一日期重跑不產生重複資料。
- 舊 trigger UID 返回前確保存在恢復路徑。
- 連續五次真實資料錯誤後才轉成 `FAILED`。

### 排程測試

- 活動工作缺少 worker trigger 時，watchdog 會補建。
- worker 被強制終止且 lease 過期後，watchdog 會接手。
- 同時收到兩個 trigger 事件時，只有一個取得 lease 並推進 cursor。
- 每日啟動遇到鎖忙後，watchdog 仍能在下一週期恢復。
- 已完成工作不會被 watchdog 重新啟動。
- watchdog 安裝程序只保留一個常駐觸發器。

### 回歸測試

- 選股條件仍全部使用 AND。
- 查詢仍為每頁 10 筆。
- 現有首頁、自選股、庫存和每日指標流程結果不變。
- `screenerMeta` 對舊版前端維持向後相容。

## 驗收標準

1. 模擬 worker 逾時後，工作在 10 分鐘內自動繼續。
2. 移除一次性 worker trigger 後，watchdog 在下一次執行時補建。
3. 讓其他工作持鎖超過 30 秒後，選股工作不失敗且之後能繼續。
4. 重複或過期事件不會讓 cursor 倒退，也不會產生重複資料。
5. 部署後目前工作從既有 51% 繼續，而不是重新建立。
6. 前端能區分正常更新、自動恢復和真正失敗。

## 部署與回復

部署順序：先部署相容的後端程式，再安裝 watchdog，最後以既有工作執行一次恢復程序。前端狀態欄位為附加欄位，可以在後端部署後獨立發布。

若部署後出現異常，可停用新的 watchdog 並回復 worker 程式；既有工作欄位是附加資料，舊程式會忽略，不需要破壞性資料回復。
