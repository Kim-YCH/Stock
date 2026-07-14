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

### v10.14 All-model Candidates

完成：

- 候選清單改為一次掃描全部策略模型，任一模型達標即列入表格
- 買入 / 賣出候選新增命中模型欄位，同一檔股票可顯示多個命中模型
- candidates 快取改為全模型版本，並以 modelSignature 防止舊模型清單快取沿用
- 新增分數輪動、早期轉強、動能續強、ETF 穩定波段四個策略模型
- 回測 / 虛擬交易 / strategyModels API 共用同一份模型清單
- 前端候選頁移除單模型下拉，改為全模型候選與模型命中標籤

### v10.15 Backtest Valuation / Market Filter

完成：

- 修正回測 equity curve：持倉每日改用最後已知收盤價估值，不再用買進成本隱藏浮動損益
- 回測最後強制平倉後會補入最終 equity，最大回撤會納入最後平倉結果
- 回測買賣加入台股手續費與證交稅，與虛擬交易成本邏輯一致
- 新增 TAIEX 大盤 context：marketRiskOn、marketMa20、marketReturn20
- 新增大盤濾網防守策略，弱市可選擇空手等待，避免所有模型硬做多
- 候選清單理由會顯示大盤濾網偏多或轉弱

### v10.16 Defensive Backtest Baselines

完成：

- 新增現金觀望基準，回測比較可直接看空手 0% 是否勝過進場策略
- 新增大盤確認趨勢策略，要求 TAIEX 與個股同時多方才買進
- 收緊大盤濾網防守策略，要求 TAIEX 站上 MA20 且 20 日報酬不低於 -1%
- 前端策略清單與回測顏色同步支援新增模型

### v10.17 Spreadsheet Timeout Repair

完成：

- DashboardCache 清舊候選快取改為只讀 key 欄，不再整張讀取大型 JSON
- Prices / Indicators 新增輕量 window 讀取，避免每次 getValues + getDisplayValues 雙倍整表掃描
- 首頁、候選清單、虛擬交易、庫存計算改為只讀目標股票最近資料
- 回測資料準備改為只讀指定股票與指定日期區間附近資料
- getLatestMarketOrPriceDate 改讀最近列，降低每日模擬與狀態查詢逾時機率

### v10.18 Strategy Model / Next-open Backtest

完成：

- 可選模型收斂為持續動能、多頭回檔、確認突破、多頭超賣反彈、ETF 月線趨勢五種用途
- 移除新回測與候選清單中的高度重複舊模型，舊虛擬策略會自動對應新版規則
- 新增 5 / 20 日報酬、10 日上漲持續度、MA20 五日斜率、前 20 日高點與 MACD 變化
- 回測改為 T 日盤後產生訊號、T+1 開盤成交，避免使用尚未可交易的當日收盤價
- 加入持有天數、收盤高點回撤、賣出後冷卻三個交易日與平均持有日統計
- ETF 賣出稅率改用 0.1%，股票維持 0.3%
- 新增買進持有與現金觀望基準，避免只用勝率判斷模型
- 回測結果只在 ALL 列保存完整 summary JSON，並限制歷史保留列數，降低試算表逾時

### v10.19 Bulk Watchlist Import

完成：

- 新增關注股票改為單一輸入框，同時支援一個或多個股票代號
- 支援逗號、空白、頓號與分號分隔，例如 2330,006208,0050
- 一次最多匯入 50 檔，輸入內重複與資料庫既有股票直接略過
- 批次只讀寫關注清單一次，最後才重建候選與首頁快取
- 完成訊息顯示新增、重複略過與失敗數量

### v11.0 Candidate Ranking / Market Intelligence / Strategy Health

完成：

- 前後端版本同步更新為 v11.0。
- 完整實作 candidateLeaderboard：分組排名、信心分數、星等、詳細 reasonList、riskList 與操作建議。
- 完整實作 marketSummary：TAIEX 均線、市場模式、關注股廣度、風險與產業代理分數。
- 完整實作 strategyResearch 與 strategyHealth，彙整回測、虛擬交易、30 / 90 / 180 天狀態與失效警告。
- 新增 Notifications Sheet、通知產生、未讀數、標記已讀、清除通知與分頁 API。
- 新增 stats 快取，提供資料列、交易、策略與候選統計。
- 新增 stockDetail API 與完整股票詳細頁，包含技術、候選、持倉、訊號、交易、回測及規則分析。
- Indicators 新增 EMA、VWAP20、OBV、MFI、CCI、Williams %R、ROC、SuperTrend、Donchian Channel。
- 每日更新改為核心行情與衍生快取分離，單一衍生功能失敗不影響行情更新。
- 前端新增獨立策略研究頁、通知未讀、股票連結、回測明細延遲載入與手機更多選單。
- app.gs 維持本機 untracked 私有檔，不納入 Git commit。

Known Issues：

- Apps Script v11 後端需由擁有者重新部署 Web App，正式站才會使用新增 actions 與 Indicators 欄位。
- LINE 通知尚未串接，本版先完成站內通知。
- 若歷史資料不足，長週期指標與候選理由會自動略過，不會用假資料補值。
- 公司基本資料與財報資料保留至後續版本。

### v11.0 Performance Pass

完成：

- 所有 v11 GET API 優先讀 CacheService，再讀 DashboardCache，最後才重建。
- API 新增 inflight request map，同一 action 與參數共用請求。
- 前端建立完整 pageDataCache，頁面先顯示 stale 資料再背景更新。
- 首頁只合併 dashboard、marketSummary、stats、strategyHealth、候選與通知摘要快取。
- 候選排行、市場、策略研究、策略健檢與統計頁不在開頁時掃描完整大型工作表。
- Analysis 改為單一 symbol 最近 250 筆資料與 analysis:symbol 快取。
- Transactions、Notifications、BacktestRuns 與 BacktestResult 加入 limit / offset 或明細上限。
- 回測頁初始載入只顯示最近 runs，點擊後才取得交易明細。
- 新增 getRecentSheetObjects_、getRecentRowsBySymbols_ 與 getOrBuildCachedResponse_ 共用函式。
- 新增 safeRun_、runDailyDerivedCaches 與 DashboardCache 清理機制。
- 手機版固定保留五個底部入口，其餘功能收進更多選單，長列表使用載入更多。
- 所有新增頁面具備 skeleton、局部錯誤與 stale cache fallback，不會造成整頁白畫面。

### v11.1 Daily Quote Sync / Detail Cache / Watchlist Sort

完成：

- 每日盤後更新改為逐檔確認關注、庫存與交易標的，批次來源缺漏時自動用單股月資料補抓。
- 更新結果新增 complete、staleSymbols 與 unresolvedSymbols，可辨識停牌、尚未發布或抓取失敗的個股。
- 每日行情更新後立即重建 marketSummary、首頁 dashboard，並清除股票詳情舊快取。
- 股票詳情重建時同步取得該股票最新 analysis，前端查詢支援 force refresh。
- 前端每日更新與歷史回補後清除首頁、庫存、分析與股票詳情記憶快取，再強制讀取新版資料。
- 今日市場在 TAIEX 歷史不足 60 筆時，改用 MA20、5 日報酬或當日漲跌判讀，不再一律顯示資料不足。
- 首頁關注表新增資料日欄，並支援點擊股票、日期、價格、RSI、量比、分數、狀態與訊號表頭排序。

### v11.2 TAIEX History Backfill

完成：

- 今日市場判讀前先檢查 MarketIndex 是否具備 60 個 TAIEX 交易日。
- 歷史不足時透過 TWSE 發行量加權股價指數月資料自動回補，最多往回查 6 個月並在湊滿 60 筆後停止。
- 回補只新增缺少日期，不覆蓋每日更新已寫入的最新漲跌與成交資訊。
- 回補後優先使用 MA60 / MA20 完整判讀；官方資料仍不足時才依序降級為 MA20、5 日報酬與當日漲跌。
- 新增 backfillMarketIndexHistory()，可在 Apps Script 編輯器手動執行並查看補抓筆數與錯誤。

### v11.3 TWSE Quote Date / Stock Detail Repair

完成：

- 支援 TWSE OpenAPI 的緊湊民國日期格式（例如 1150709），不再把舊快照錯標成今日行情。
- 全市場快照日期落後時，會改以單股月日資料取得真正的最近收盤價並覆寫同日錯誤價格。
- analysis 單檔查詢在 Indicators 依股票分區儲存時，可精準讀取該股票資料，不再只看工作表最後 500 列。
- analysis 即使暫時缺少 Indicators，也會用最新 Prices 提供日期與收盤價，不再回傳 close=0。
- 股票詳情不再同步重建全市場候選排行，改讀現有候選快取，避免單檔查詢超過 Apps Script 執行時間。
- getAnalysis 不再於頁面查詢時掃描並重算整張 Indicators，維持單檔快取讀取模式。

### v11.4 Fast Daily Price Update

完成：

- 每日價格改以日期與股票代號定位，既有列直接覆寫，缺少列才批次新增，不再清空並重寫整張 Prices。
- 測試資料清理在沒有命中資料時直接返回，不再每天無條件清空重寫 MarketIndex 與 Transactions。
- 價格更新完成後只同步重算庫存與首頁快取，技術指標、分析快取、候選與研究資料改由三階段背景排程重建。
- 每日更新後立即清除對應 analysis 與 stockDetail 舊快取，避免頁面沿用更新前價格。
- 首頁關注表優先顯示 Prices 最新日期與收盤價；Indicators 尚在背景計算時也能先看到當日價格。
- 前端更新按鈕不再要求同步強制重建 dashboard，核心價格完成後立即載入後端已產生的首頁快取。
- 更新訊息區分新增與覆寫筆數，並顯示技術指標正在背景更新。

### v11.5 Dashboard UX / Frontend-first Trading / Performance Pass

完成：

- 首頁重新整理為今日市場、TAIEX、偏多股票、風險提醒、今日訊號與平均技術分數六個主要資訊區塊。
- 今日市場加入 MA20、RSI、ADX、市場模式與判讀理由；偏多、風險與策略警告可開啟桌面詳情視窗或手機底部面板。
- 關注清單補上技術分數、五級狀態、RSI 方向、ADX、ATR%、量比、訊號 chips 與可點擊的 20 日小圖統計。
- 交易新增與刪除改為 optimistic UI，前端立即更新；Apps Script 完成寫入後才由背景排程重算庫存與衍生快取。
- 庫存先顯示快取資料與資料日期；偵測到交易後待重算狀態時，自動執行明確的庫存更新 API。
- 每日更新不再顯示確認視窗；歷史回補改為非阻塞式面板，送出後可繼續瀏覽其他頁面。
- 前端版本更新只清除 StockLab 記憶快取、更新 Service Worker 並重新載入，不呼叫行情或分析重 API。
- 初始載入只讀 runtime version、dashboard 與通知摘要；策略模型、候選、回測、虛擬交易與長列表在進入頁面後才延遲載入。
- 虛擬交易與回測執行紀錄加入載入更多，保留既有 request de-duplication、page cache、stale-while-refresh 與分階段衍生重建。
- 手機版資訊卡、模型標籤、訊號 chips、關注表格與詳情底部面板完成窄螢幕排列與點擊尺寸調整。
- 前後端版本更新為 v11.5；Apps Script 維持本機 untracked 私有檔，不納入 Git commit。

Known Issues：

- Apps Script v11.5 後端需由擁有者重新部署 Web App，正式站才會使用背景交易重算與新版首頁資料。
- MarketIndex 目前只保存收盤價，大盤 ADX 暫以收盤價序列估算趨勢強度；加入 OHLC 欄位後可改用標準計算。
- 舊 Indicators 列若尚未產生 ADX、ATR 或前一日 RSI，首頁會保留空白而不顯示推測值，待背景重算後補齊。
- LINE 通知尚未串接，本版維持站內通知。

### v11.6 Compact Indicator Reason Modal / Dashboard List Repair

完成：

- 指標與訊號說明視窗改為短版，只顯示目前判斷、判斷原因與參考搭配。
- 移除說明視窗中的長篇教學段落，避免資訊過多。
- 所有主要指標、分數、狀態與訊號 chip 仍可點擊查看判斷原因。
- 說明視窗會依目前股票數值產生 1～4 條短版原因。
- 修正開啟小視窗後滑鼠移動造成背景文字反藍的問題。
- 修正首頁偏多股票 count 與彈窗清單不一致問題。
- 首頁偏多股票、風險提醒、今日訊號、策略警告皆改為 items.length 作為顯示數量來源。
- 賣出候選與賣出訊號改為只檢查目前 Portfolio 有持股的股票。
- 買入候選維持從 Watchlist enabled 股票產生。
- 空清單提示依情境顯示，例如沒有偏多股票、沒有庫存、持股沒有賣出訊號。
- 候選排行合併到候選清單，並以單一 candidatesPage API 載入候選與排行。
- 庫存與交易紀錄合併，交易紀錄改為庫存頁內收合區，展開後才載入。
- 股票詳情與線圖分析合併，線圖放在最上方且只載入目前股票。
- 虛擬交易暫時從主選單隱藏，舊路由會導回首頁。
- 手機版 chip、modal、卡片防止出框。
- 說明 modal 使用前端 context，不額外呼叫 API，避免變慢。
- 修正 TPEX 歷史回補解析，支援官方現行「日 期／成交張數」欄位並保留上櫃市場別。
- 歷史回補改為跳過已有的過去月份，當月只補缺少日期，降低官方 API 請求與 Apps Script 逾時機率。
- 修正 modal、明細 sheet 與手機更多選單的背景遮罩 hover 變色。
- 關注股票表格以每日漲跌幅取代日期顯示，使用最新與前一交易日收盤計算並支援排序。
- 前後端版本更新為 v11.6；Apps Script 維持本機 untracked 私有檔，不納入 Git commit。

Known Issues：

- 若舊資料缺少部分進階指標，小視窗會顯示資料不足。
- 虛擬交易功能保留於後端，前端入口暫時隱藏。
