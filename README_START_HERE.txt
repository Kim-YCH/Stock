股票管理網站 MVP 初版
======================

這是一版適合你目前架構的初版：

前端：
- GitHub Pages
- HTML / CSS / JavaScript
- 黑色背景 UI
- 首頁、庫存頁、技術分析頁、交易紀錄頁
- 線圖使用 SVG，不需要額外套件

後端：
- Google Apps Script
- JSONP API
- 讀取 Google Sheets
- 新增交易紀錄
- 抓取 TWSE / TPEX 官方盤後資料
- 自動寫入 Prices
- 設定每日盤後排程
- 計算庫存
- 計算 MA5 / MA20 / MA60 / RSI14 / MACD / 量比 / 乖離率
- 產生技術訊號

資料庫：
- Google Sheets
- 需要建立的 Sheet 可以用 setupDatabase() 自動建立

------------------------------------------------------------
一、資料庫要先建什麼？
------------------------------------------------------------

請先建立一份 Google Sheet，然後在 Apps Script 貼上 apps_script/Code.gs。

最簡單方式：
1. 開啟 Google Sheets
2. 擴充功能 -> Apps Script
3. 貼上 apps_script/Code.gs
4. 儲存
5. 執行 setupDatabase()
6. 第一次會要求授權，請允許
7. 會自動建立以下 Sheet：

- Stocks
- Watchlist
- Transactions
- Prices
- MarketIndex
- Indicators
- Signals
- Portfolio

其中最重要的是：
- Prices：每日盤後價格
- Transactions：買進 / 賣出 / 股息紀錄
- Watchlist：首頁關注股票
- Portfolio：後端自動計算庫存
- Indicators：後端自動計算技術指標
- Signals：後端自動產生技術訊號

------------------------------------------------------------
二、部署 Google Apps Script API
------------------------------------------------------------

1. Apps Script 右上角「部署」->「新增部署作業」
2. 類型選「網頁應用程式」
3. 執行身分：我
4. 存取權：任何人
5. 部署後複製 Web App URL

注意：
這版是個人使用 MVP。若你要公開給多人用，不能直接把寫入 API 開給所有人。

------------------------------------------------------------
三、設定前端
------------------------------------------------------------

打開 js/config.js

把：

const API_BASE_URL = "";

改成你的 Apps Script Web App URL，例如：

const API_BASE_URL = "https://script.google.com/macros/s/xxxxx/exec";

如果你在 Apps Script Code.gs 有設定 API_TOKEN，這裡也要填一樣：

const API_TOKEN = "your_token";

如果 API_BASE_URL 空白，前端會使用假資料，方便先看 UI。

------------------------------------------------------------
四、前端如何執行？
------------------------------------------------------------

本機測試：
直接打開 index.html 可以看假資料 UI。

部署：
直接把本資料夾最外層內容推到 GitHub Pages。GitHub 會直接讀取最外層的 index.html。

------------------------------------------------------------
五、日常使用流程
------------------------------------------------------------

第一次：
1. setupDatabase()
2. 把 Prices 換成實際台股 / 美股盤後資料
3. 執行 calculateAllAnalysis()
4. 部署 Apps Script
5. 前端 config.js 填入 API URL

每天盤後：
1. 執行 updateDailyPrices()
2. 系統會抓 TWSE / TPEX 官方盤後資料
3. 系統會自動寫入 Prices
4. 系統會自動執行 calculateAllAnalysis()

也可以在前端按「更新盤後資料」按鈕。

這版已經附每日排程函式：
- createDailyPriceTrigger()：建立每天 20:00 的盤後更新排程
- deleteDailyPriceTriggers()：刪除 updateDailyPrices 排程

目前自動抓取範圍：
- TWSE 上市每日收盤資料
- TPEx 上櫃每日收盤資料
- TWSE 加權指數 TAIEX（櫃買指數先保留手動/後續補強）

------------------------------------------------------------
六、目前 API action
------------------------------------------------------------

GET /exec?action=dashboard
取得首頁資料。

GET /exec?action=portfolio
取得庫存資料。

GET /exec?action=analysis&symbol=2330
取得個股線圖、指標、訊號。

GET /exec?action=transactions
取得交易紀錄。

GET /exec?action=updateDailyPrices
抓取 TWSE / TPEX 官方盤後資料，寫入 Prices，並重新計算 Indicators / Signals / Portfolio。

GET /exec?action=backfillHistoricalPrices&months=12&symbols=2330,2317
回補指定股票最近 N 個月歷史價格，寫入 Prices，並重新計算分析。

GET /exec?action=clearDemoData
清除舊版範例資料，避免首頁仍顯示模擬資料。

GET /exec?action=calculateAllAnalysis
重新計算 Indicators / Signals / Portfolio。

GET /exec?action=addTransaction&date=2026-07-09&action=BUY&symbol=2330&name=台積電&market=TW&quantity=10&price=900&fee=20&tax=0&currency=TWD
新增交易紀錄。

------------------------------------------------------------
七、下一版建議
------------------------------------------------------------

下一版可以加：
1. StrategyResults：固定規則勝率回測
2. 交易紀錄編輯 / 刪除
3. 買進點 / 賣出點標在線圖上
4. 美股價格與 USD/TWD 匯率
5. 登入與權限

------------------------------------------------------------
八、真實盤後資料來源
------------------------------------------------------------

這版已經補入官方盤後資料 API：

1. TWSE 上市股票
   https://openapi.twse.com.tw/v1/exchangeReport/STOCK_DAY_ALL

2. TPEx 上櫃股票
   https://www.tpex.org.tw/openapi/v1/tpex_mainboard_daily_close_quotes

3. TAIEX 加權指數
   https://www.twse.com.tw/exchangeReport/MI_INDEX?response=json&date=YYYYMMDD&type=ALL

注意：
- 這些是盤後資料，不是即時報價。
- 建議晚上 20:00 後執行 updateDailyPrices()。
- 預設只抓 Stocks / Watchlist / Portfolio 出現的股票。
- 若要抓全部上市上櫃，請到 Code.gs 把 CONFIG.FETCH_ONLY_MY_SYMBOLS 改成 false。
- 如果官方欄位或 endpoint 改版，可能需要調整 parse 欄位。


------------------------------------------------------------
v3 歷史資料回補
------------------------------------------------------------

v3 新增台股歷史資料回補功能：

Apps Script 手動執行：
- backfillHistoricalPrices(12)
- backfillHistoricalPrices(6, "2330,2317,006208")

前端執行：
- 按「回補歷史資料」
- 輸入月份，建議 12
- 股票很多時，建議先指定 1～5 檔測試

API 執行：
?action=backfillHistoricalPrices&months=12
?action=backfillHistoricalPrices&months=12&symbols=2330,2317

回補資料會寫入：
- Prices

回補完成後會自動執行：
- calculateAllAnalysis()

因此會重新產生：
- Indicators
- Signals
- Portfolio

注意：
- 預設只會回補 Stocks / Watchlist / Transactions / Portfolio 裡出現的股票。
- 若股票很多，Apps Script 可能因執行時間限制中斷，請分批指定 symbols 回補。
- 上市股票使用 TWSE STOCK_DAY 單月資料。
- 上櫃股票使用 TPEx 個股日成交資訊。


------------------------------------------------------------
v4 GitHub Pages / 手機版 / Icon 調整
------------------------------------------------------------

v4 變更：
1. index.html 已移到最外層，方便 GitHub Pages 直接部署。
2. css / js / icons 也放在最外層。
3. 新增 favicon.svg、favicon.ico、apple-touch-icon.png、manifest.webmanifest。
4. 新增手機 / 電腦自動偵測：
   - 電腦版：左側選單。
   - 手機版：底部固定選單、卡片單欄、表格可左右滑。
5. 首頁大盤資料改為只取每個指數最新一筆，避免舊範例資料混入。
6. 新增 clearDemoData()：可以清掉舊版範例資料。
7. updateDailyPrices() 執行前會先清除 v1~v3 範例大盤與範例價格，避免首頁還顯示模擬資料。
8. TAIEX 加權指數更新邏輯改成會往前找最近 10 天有資料的交易日。

GitHub Pages 建議結構：

index.html
css/style.css
js/config.js
js/api.js
js/app.js
icons/favicon.svg
icons/apple-touch-icon.png
manifest.webmanifest
apps_script/Code.gs

實際部署時，apps_script 和 database_schema 放在 repo 裡也沒關係；瀏覽器只會使用 index.html / css / js / icons。

若首頁仍顯示 fallback 模擬：
1. 確認 js/config.js 的 API_BASE_URL 已填入 Apps Script Web App URL。
2. 確認 Apps Script 已重新部署最新版。
3. 按「清除範例資料」。
4. 再按「更新盤後資料」。
5. 回 Google Sheets 檢查 MarketIndex 是否有 TAIEX 最新日期。
