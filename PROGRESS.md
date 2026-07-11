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

### v10.2 analysis cache

完成：

- 技術分析頁改用 DashboardCache 快取
- getAnalysis_ 不再即時計算 Portfolio
- 新增 analysis:symbol 快取
- 每日更新 / 歷史回補後自動重建線圖快取
- 前端線圖頁加入 memory cache，避免重複 API request
- 改善線圖頁載入速度

### v10.3 Candidate List / Paper Trading / Backtest Planning

新增：

- 候選清單頁
- 買入候選從 Watchlist 自動產生
- 賣出候選從 Portfolio 自動產生
- 新增 candidates 快取
- 新增虛擬交易資料表規劃
- 新增 PaperStrategies / PaperPositions / PaperTrades / PaperPerformance 規劃
- 新增策略回測規劃
- 新增 BacktestRuns / BacktestResults 規劃
- 新增 Bollinger Bands / KD / ATR / ADX / 支撐壓力欄位規劃
- 保持真實交易與虛擬交易分離

### v10.4 Default Paper Trading Rules

完成：

- 新增 StockLab 內建「平衡型波段策略」
- 使用者不需要自行設定買賣規則
- 候選清單、虛擬交易、回測共用同一套預設規則
- 買入條件包含 totalScore、riskScore、RSI、MA20、MACD、volumeRatio、Bollinger Bands 與 ADX
- 賣出條件包含跌破 MA20、MACD 轉弱、分數轉弱、停損、漲多轉弱停利
- 新增 Bollinger Bands、KD、ATR、ADX 與 20 日支撐壓力指標
- 新增 PaperStrategies、PaperPositions、PaperTrades、PaperOrders、PaperPerformance
- 新增每日虛擬交易與 paper 快取
- 新增 BacktestRuns、BacktestResults、回測績效、交易明細與資產曲線
- 加權指數與個股每日更新使用同一交易日期
- 虛擬交易不影響正式庫存與正式交易紀錄
- 每日行情更新後可自動執行虛擬交易

### v10.5 Backtest Diagnostics

完成：

- 放寬內建波段策略買進規則，避免進階指標缺欄位時完全無法交易
- 回測前會檢查 Indicators 覆蓋率，必要時自動重建技術指標
- 回測結果新增 diagnostics，顯示交易日、價格筆數、指標覆蓋與買點天數
- 前端回測頁顯示零交易原因，避免只看到水平資產曲線

### v10.6 Analysis Chart Lines

完成：

- analysis 快取新增 schemaVersion，舊快取會自動重建
- 線圖資料新增 MA5、MA60、布林上下軌、20 日高低
- 技術分析頁新增技術線勾選，預設只顯示 MA20
- 收盤價與平均成本固定顯示，不提供關閉
- 前端顯示技術指標缺漏提示，協助判斷是否尚未重新計算 Indicators

### v10.7 Analysis Cache Repair

完成：

- analysis 快取有效性新增技術欄位檢查
- 若價格歷史足夠但 KD / 布林 / ATR / ADX / 20 日高低缺值，會跳過舊快取並重建
- 若最新 Prices 日期比最新 Indicators 日期新，線圖查詢會先重算 Indicators

### v10.8 Strategy Models

完成：

- 新增 5 組可選技術指標策略：多指標平衡、趨勢順勢、量價突破、多頭回檔、低波動防守
- 虛擬交易建立策略時可選模型，並保存 strategyType 與該模型買賣規則
- 每日虛擬交易改為執行各策略自己的 buyRuleJson / sellRuleJson
- 策略回測可選模型，回測結果與交易原因會標示實際策略名稱
- 前端顯示策略風險、適用情境、買進摘要與賣出摘要
- 新增 strategyModels API，前端保留內建清單作為舊後端過渡備援

### v10.9 Multi-model Backtest / Next-day Candidates

完成：

- 策略回測支援複選模型，所有模型共用同一份 Prices / Indicators 與日期索引
- 多模型結果完成後一次批次寫入 BacktestRuns / BacktestResults，避免重複整表寫入
- 新增 runBacktestComparison API，一次回傳多模型績效與獨立交易明細
- 前端新增模型比較表，顯示報酬、損益、交易次數、勝率、最大回撤與 Profit Factor
- 資產曲線可同時疊加多個策略，並可切換目前查看的模型明細
- 候選清單可選策略模型，每個模型使用獨立 DashboardCache
- 候選狀態標示最新盤後資料日期，明確定位為下一交易日決策參考
- 舊版 candidates 快取會依 APP_VERSION / strategyType / decisionFor 自動失效重建
- 每次平衡型候選重建時同步清除其他模型舊快取，避免每日更新或交易異動後讀到前一版候選

### v10.10 Market Index Date Repair

完成：

- 修正 2026-07-09 真實 TAIEX 被舊版測試日期規則過濾的問題
- clearDemoData 不再以 2026 日期區間刪除 Prices，避免誤刪正式歷史行情
- 大盤測試資料改為只比對可確認的假數值，不再只憑日期判定
- 7/10、7/11 官方 MI_INDEX 為空表時，會正確保留最近交易日 7/9
- 關注股偏多與風險提醒改顯示 Indicators 最新交易日，不再於週末顯示日曆日期

### v10.11 Frontend / Backend Version Badge

完成：

- 側邊欄分開顯示前端版本與 Dashboard API 回傳的後端版本
- 前後端版本一致時以綠色標示
- Web App 仍為舊部署時顯示黃色「版本不一致」警告
- API 尚未回應時顯示後端尚未確認，避免把前端版本誤認成部署版本

### v10.12 Dashboard Cache Version Repair

完成：

- dashboard CacheService 與 DashboardCache JSON 必須符合目前 APP_VERSION 才會使用
- 發現舊版 dashboard 快取時自動重建並覆寫，不再讓新部署回傳舊版 JSON
- local 前端的 CSS / config.js / api.js / app.js 加入版本參數，避免瀏覽器沿用舊靜態檔
- 前端與後端版本徽章更新為 v10.12，可直接辨識部署與快取狀態

### v10.13 Runtime Backend Version

完成：

- 新增 action=version，直接回傳目前 Web App runtime 的 APP_VERSION
- version API 完全不讀 CacheService 或 DashboardCache
- 前端後端版本徽章優先使用 runtime version，不再被舊 dashboard JSON 誤導
- 舊部署沒有 version action 時，才退回 dashboard.version 顯示
