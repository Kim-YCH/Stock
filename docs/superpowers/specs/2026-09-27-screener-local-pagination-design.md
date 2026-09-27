# 選股精簡結果與本地分頁設計

## 目標

改善選股清單第一次完整顯示、翻頁及排序速度。後端繼續使用完整快照資料執行 AND 條件篩選，但選股完成後只把清單需要的精簡欄位一次傳到瀏覽器，之後由前端本地分頁及排序，不再為每一頁呼叫 Apps Script。

本次發行版本為 v11.25。除選股策略頁的結果載入、分頁及排序外，其他頁面與既有資料更新流程不變。

## 現況與根因

- `ScreenerResults.payloadJson` 保存約 60 多個快照欄位，供完整條件與排序使用。
- 清單畫面實際只使用 9 個欄位。
- v11.24 已有後端排序結果快取及前端相鄰頁預抓，因此工作表重掃成本已降低。
- 每個未命中的頁面仍需經過一次瀏覽器到 Apps Script 的 JSONP 往返；固定網路延遲及 Apps Script 啟動成本高於 10 筆資料本身的傳輸成本。

## 精簡結果格式

傳到瀏覽器的每筆資料只包含：

- `symbol`
- `name`
- `market`
- `industry`
- `close`
- `changePercent`
- `volume`
- `peRatio`
- `rsi14`

這些欄位同時涵蓋目前表格顯示與五種排序選項。完整 `payloadJson` 仍保留在後端，既有選股條件、快取及資料表格式不變。

完整結果信封包含：

- `items`：全部精簡結果，依目前排序排列。
- `total`：符合條件總數。
- `pageSize`：固定為 10。
- `allLoaded`：完整結果成功載入時為 `true`。
- `revision`：以工作 `matchCount` 表示的結果版本。
- `sortField`、`sortDirection`：產生結果時的排序資訊。

## 後端資料流

1. `startScreener` 保持目前行為：建立工作、掃描第一批，並回傳第一頁，讓使用者儘早看到結果。
2. `continueScreener` 在工作尚未完成時保持目前的漸進式掃描與分頁讀取。
3. 前端呼叫 `continueScreener` 時傳入 `includeAll=true`；當工作成為 `COMPLETED` 時，後端在同一次回應附上全部精簡結果，避免完成後再發一個清單請求。
4. 若工作在 `startScreener` 的第一批即完成，該回應直接附上全部精簡結果。
5. 後端先以既有完整資料完成排序，再投影成 9 欄精簡列；瀏覽器不會收到其餘快照欄位。
6. 既有 owner 驗證、工作版本快取及 durable Sheet fallback 保持不變。

## 前端狀態與互動

- 新增完整精簡結果狀態，綁定 `jobId + matchCount` revision。
- 收到 `allLoaded: true` 後，把所有精簡列留在記憶體中；不寫入 `localStorage` 或 `sessionStorage`。
- 每頁仍顯示 10 筆，頁碼與總筆數外觀不變。
- 上一頁、下一頁只切割記憶體陣列，不呼叫 `Api.getScreenerResults`。
- 五種排序在瀏覽器使用與後端相同的空值、數值及股票代號 tie-break 規則；排序後回到第 1 頁。
- 工作尚未完成、完整結果尚未收到時，保留 v11.24 的逐頁載入及競態防護。
- 開始新工作時清除完整結果、頁面快取及舊 revision。

## 競態與錯誤處理

- 完整結果只在 `jobId` 及 `matchCount` 與目前工作一致時採用。
- 舊工作或舊 revision 的延遲回應不得覆蓋新工作。
- 含完整結果的 `continueScreener` 傳輸失敗時，前端保留目前已顯示的清單，改以輕量的 `getScreenerStatus` 確認工作狀態；若工作已完成，該次工作階段停用完整結果模式並沿用既有逐頁 API，不反覆要求同一個完整 payload。
- 本地切頁不得顯示載入動畫；只有實際發生網路請求時才顯示載入狀態。
- owner 驗證仍在後端完成，前端本地資料僅包含目前已登入使用者的工作結果。

## 測試與驗收

後端測試需確認：

- 完整結果只含允許的 9 個欄位。
- 完整結果保留正確排序、總筆數與 revision。
- 非擁有者無法取得完整結果。
- CacheService 失效時仍可由 ScreenerResults 工作表產生結果。
- `startScreener` 或帶有 `includeAll=true` 的 `continueScreener` 只有在工作完成時附上 `allLoaded: true`。

前端測試需確認：

- 收到完整結果後，連續翻頁不會呼叫 `Api.getScreenerResults`。
- 本地排序結果與後端排序規則一致，並回到第 1 頁。
- 只有 0～10 筆、超過一頁以及接近全市場筆數時，頁數與列數都正確。
- 新工作會清除舊完整結果。
- 舊 revision 回應、完整 payload 失敗後的狀態確認，以及工作進行中的分頁 fallback 不會破壞目前畫面或重複要求失敗的完整 payload。
- 公開與私有的 `index.html`、`css/style.css`、`js/app.js`、`js/config.js`、`service-worker.js` 維持位元組一致。

驗收標準：選股完成並收到完整結果後，翻頁與排序產生 0 次清單 API 請求；畫面維持每頁 10 筆，其他頁面行為不變。
