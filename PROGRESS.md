# StockLab 股票管理網站進度追蹤

## 專案目標

建立一個個人股票管理網站，主要用於：

- 首頁查看大盤與關注股票
- 管理自己的股票庫存
- 使用盤後資料計算技術指標
- 使用固定規則分析偏多、盤整、偏弱、過熱等狀態
- 支援電腦版與手機版瀏覽
- 前端部署在 GitHub Pages
- 後端 Google Apps Script 不上傳 GitHub

---

## 目前架構

### 前端

部署位置：

- GitHub Pages
- Repo 根目錄直接放 `index.html`

目前前端包含：

- `index.html`
- `css/style.css`
- `js/config.js`
- `js/api.js`
- `js/app.js`
- `icons/`
- `manifest.webmanifest`
- `PROGRESS.md`

### 後端

後端使用：

- Google Apps Script
- Google Sheets 作為資料庫

注意：

- 後端程式不放 GitHub
- `apps_script/` 不上傳
- Apps Script 程式只保留在 Google Apps Script 編輯器或本機私有備份

---

## Google Sheets 資料表

目前需要的 Sheet：

| Sheet | 用途 |
|---|---|
| `Stocks` | 股票基本資料 |
| `StockMaster` | 台股代號與名稱查詢 |
| `Watchlist` | 首頁關注股票 |
| `Transactions` | 買進、賣出、股息紀錄 |
| `Prices` | 每日盤後價格 |
| `MarketIndex` | 大盤指數資料 |
| `Indicators` | 技術指標計算結果 |
| `Signals` | 技術訊號 |
| `Portfolio` | 庫存計算結果 |

---

## 已完成功能

### 1. 黑色背景 UI

已完成：

- 深色金融儀表板風格
- 卡片式資訊區塊
- 關注股票列表
- 庫存表格
- 技術分析線圖
- 手機版響應式排版

狀態：

- 已完成初版

---

### 2. GitHub Pages 結構調整

已完成：

- `index.html` 移到專案根目錄
- 不需要進入 `frontend/index.html`
- GitHub Pages 可直接使用 `/root`

狀態：

- 已完成

---

### 3. Icon / App Icon

已完成：

- `icons/favicon.svg`
- `icons/favicon.ico`
- `icons/apple-touch-icon.png`
- `manifest.webmanifest`

狀態：

- 已完成

---

### 4. 手機 / 電腦版支援

已完成：

- 電腦版使用左側選單
- 手機版自動變成底部固定選單
- 表格手機版可左右滑動
- 卡片手機版變單欄
- 依裝置自動切換，不顯示手機版 / 電腦版文字

狀態：

- 已完成初版

---

### 5. 前端 API 串接

已完成：

- 使用 Apps Script Web App URL
- `js/config.js` 設定 `API_BASE_URL`
- 未設定 API 時使用假資料 fallback
- 可呼叫 dashboard / portfolio / analysis / transactions

狀態：

- 已完成初版

---

### 6. 手動更新功能

已完成：

- 前端按鈕：更新盤後資料
- 前端按鈕：回補歷史資料
- 前端按鈕：清除範例資料

後端對應函式：

- `updateDailyPrices()`
- `backfillHistoricalPrices()`
- `clearDemoData()`
- `calculateAllAnalysis()`

狀態：

- 已完成初版

---

### 7. 技術分析規則

目前已支援：

- MA5
- MA20
- MA60
- RSI14
- MACD
- MACD Signal
- MACD Hist
- 20 日均量
- 量比
- 20MA 乖離率
- 趨勢分數
- 動能分數
- 風險分數
- 技術總分

狀態：

- 已完成初版

---

### 8. 技術訊號

目前已支援：

- MA5 上穿 MA20
- 收盤站上 MA20
- 跌破 MA20
- RSI 低於 30
- RSI 高於 75
- MACD 轉正
- 放量突破 20 日高點

狀態：

- 已完成初版

---

### 9. 歷史資料回補

已完成：

- 可回補指定月份
- 可指定股票代號
- 避免只靠每日累積資料
- 回補後可立即計算 MA20 / MA60 / RSI / MACD

狀態：

- 已完成初版

---

## 尚未完成 / 待辦事項

### 高優先

- [ ] 確認實際部署後 `API_BASE_URL` 是否正確
- [ ] 確認 GitHub Pages 首頁是否可正常開啟
- [ ] 確認 `apps_script/` 已從 GitHub 移除
- [ ] 確認 `.gitignore` 已加入後端排除規則
- [ ] 實際執行 `updateDailyPrices()` 測試台股盤後資料
- [ ] 實際執行 `backfillHistoricalPrices(12, "2330")` 測試歷史回補
- [ ] 確認 `MarketIndex` 是否正常更新加權指數
- [ ] 確認首頁不再顯示舊範例大盤資料

### 中優先

- [ ] 前端加入更新中 loading 狀態
- [ ] 前端加入錯誤訊息區塊
- [ ] 交易紀錄支援編輯
- [ ] 交易紀錄支援刪除
- [ ] 線圖加入買進點 / 賣出點標記
- [ ] 庫存頁加入成本線小圖
- [ ] 手機版表格改成卡片式顯示
- [ ] 設定 Apps Script API Token

### 低優先

- [ ] 股息自動抓取
- [ ] 策略勝率回測
- [ ] LINE / Email 通知
- [ ] 登入權限控管

---

## GitHub 不上傳的內容

以下內容不應上傳 GitHub：

- `apps_script/`
- `backend/`
- `secrets/`
- `.env`
- `*.secret`
- `*.key`
- `credentials.json`
- `token.json`

原因：

- Apps Script 後端可能包含 API URL、Token 或其他不適合公開的邏輯
- GitHub Pages 只需要前端檔案
- 後端應保留在 Google Apps Script 或本機私有備份

---

## 下一次開發建議順序

1. 確認 GitHub Pages 前端可正常開啟
2. 確認 `apps_script/` 已從 GitHub 移除
3. 到 Apps Script 重新部署 Web App
4. 將 Web App URL 填入 `js/config.js`
5. 前端按「更新盤後資料」
6. 前端按「回補歷史資料」，先測 `2330`
7. 確認首頁、庫存頁、線圖分析頁都顯示真實資料
8. 再開始優化 UI 與錯誤提示

---

## 目前版本紀錄

### v1

完成：

- 前端首頁 / 庫存 / 技術分析 / 交易紀錄
- Google Sheets Schema
- Apps Script 基本 API
- 技術指標計算
- 假資料模式

### v2

完成：

- 台股上市 / 上櫃盤後資料更新
- 大盤資料初版
- 每日排程函式

### v3

完成：

- 歷史資料回補
- 指定股票回補
- 指定月份回補

### v4

完成：

- `index.html` 移到根目錄
- 新增 icon / manifest
- 修正首頁大盤資料容易被範例資料卡住的問題
- 新增清除範例資料
- 手機 / 電腦響應式版面
- 後端不建議上 GitHub

---

## 備註

目前系統定位：

盤後股票管理系統，不是即時看盤系統。

因此第一階段資料重點是：

- 每日收盤價
- 歷史日線
- 技術指標
- 庫存損益
- 關注清單

暫時不做：

- 即時報價
- WebSocket
- 自動下單
- 高頻資料
- AI 量化

## v6 修正紀錄

- 修正首頁在 API 未連線時仍顯示 23,520 模擬加權指數的問題。
- 前端不再用假大盤行情當 fallback，避免誤判。
- clearDemoData() 加強：清除 TAIEX=23520、OTC=260.5 舊範例，不再限定日期。
- TAIEX 抓取改成優先 TWSE MI_INDEX type=IND，再 fallback type=ALL。
- 新增 debugStatus action，用來確認 GitHub Pages 是否真的連到最新版 Apps Script。
- 手機版字體、卡片、按鈕與底部選單加大，改善閱讀性。

### v8

完成：

- 系統調整為台股專用，移除美股 / USD / market 選擇
- 新增 StockMaster 股票名稱查詢表
- 新增 lookupStock API，可由股票代號自動帶入名稱
- 前端新增關注股票功能
- 前端支援移除 / 停用關注股票
- 新增關注股票時可選擇自動回補歷史資料
- 移除前端一次性維護按鈕：修正代號、清除範例資料
- 移除手機版 / 電腦版狀態文字
- 新增更新版本按鈕，方便手機 App / PWA 模式重新載入最新版

### v9

完成：

- 修正 Watchlist 移除按鈕無反應
- 新增股票流程改為只輸入股票代號
- 股票名稱由後端 StockMaster 自動查詢
- lookupStock 改為先查 StockMaster，找不到才呼叫官方 API 更新 StockMaster
- 移除 6208 自動轉 006208 的錯誤邏輯
- 各頁面新增股票不再顯示股票名稱輸入欄
- 交易紀錄固定台股 TWD，不再顯示 market / currency

### v10

Changes:

- Added `APP_VERSION = "v10.0"` to frontend and Apps Script responses.
- Added `DashboardCache` sheet support with `dashboard`, `portfolio`, and `version` cache keys.
- Changed `dashboard` API to read cache first instead of recalculating sheets or calling market APIs on every load.
- Added `buildDashboardCache()`, `runDailyCloseUpdate()`, `createDailyCloseTrigger()`, and `deleteDailyCloseTriggers()`.
- Refreshed DashboardCache after daily update, backfill, watchlist changes, and transaction changes.
- Added dashboard update status with `updatedAt`, `dataDate`, and version display.
- Kept transaction records as the source for portfolio calculation and tracked symbols.

### v10.1

Changes:

- Changed `updateDailyPrices_()` and `runDailyCloseUpdate()` to use quick daily close mode.
- Daily update now scans recent trading days, fetches TWSE/TPEX daily close lists once, and filters only tracked symbols.
- Added `DashboardCache.lastRun` success/failure logging for scheduled updates.
- Stopped `setupDatabase()` from writing sample data.
- Removed frontend fake portfolio, analysis, and transaction fallback rows.
- Added chart hover tooltip for single-point close price, MA20, and average cost.

### v10.1 dataDate fix

Changes:

- Fixed `DashboardCache.dashboard.dataDate` fallback when sheet date values cannot be parsed.
- `normalizeMarketDate_()` now handles Google Sheets Date objects and Date-like strings.
- Dashboard response now includes `lastRun` and falls back to `lastRun.dataDate`.
- Frontend update status now falls back to `data.lastRun` before showing an empty update state.
- `DashboardCache.version.dataDate` continues to use the dashboard `dataDate`.
