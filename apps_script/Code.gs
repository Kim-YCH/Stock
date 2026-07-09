const CONFIG = {
  // 個人使用可先留空。
  // 若要防止別人亂新增交易 / 觸發更新，可設定例如 "my_secret_token"，
  // 然後前端 frontend/js/config.js 的 API_TOKEN 也要填一樣。
  API_TOKEN: "",

  // 官方盤後資料來源。
  // TWSE：上市個股每日收盤資料。
  // TPEX：上櫃股票每日收盤資料。
  TWSE_STOCK_DAY_ALL_URL: "https://openapi.twse.com.tw/v1/exchangeReport/STOCK_DAY_ALL",
  TPEX_DAILY_CLOSE_URL: "https://www.tpex.org.tw/openapi/v1/tpex_mainboard_daily_close_quotes",

  // 歷史資料來源。
  // TWSE：單一上市股票單月日成交資料。
  // TPEX：單一上櫃股票單月日成交資料。
  TWSE_STOCK_DAY_HISTORY_URL: "https://www.twse.com.tw/exchangeReport/STOCK_DAY",
  TPEX_STOCK_HISTORY_URL: "https://www.tpex.org.tw/www/zh-tw/afterTrading/tradingStock",
  TPEX_STOCK_HISTORY_LEGACY_URL: "https://www.tpex.org.tw/web/stock/aftertrading/daily_trading_info/st43_result.php",

  // 歷史資料預設回補幾個月。
  // 12 個月通常足夠算 MA60 / RSI / MACD。
  HISTORY_MONTHS_DEFAULT: 12,


  // 大盤指數資料來源。TAIEX 使用 TWSE 舊版 JSON endpoint，方便依日期查詢。
  TWSE_MI_INDEX_URL: "https://www.twse.com.tw/exchangeReport/MI_INDEX",

  // 預設只抓 Stocks / Watchlist / Portfolio 裡出現的股票。
  // 若你想抓全部上市上櫃，改成 true，但資料量會大很多。
  FETCH_ONLY_MY_SYMBOLS: true
};

const SHEETS = {
  STOCKS: "Stocks",
  WATCHLIST: "Watchlist",
  TRANSACTIONS: "Transactions",
  PRICES: "Prices",
  MARKET_INDEX: "MarketIndex",
  INDICATORS: "Indicators",
  SIGNALS: "Signals",
  PORTFOLIO: "Portfolio"
};

const HEADERS = {
  Stocks: ["symbol", "name", "market", "currency", "type", "enabled"],
  Watchlist: ["symbol", "name", "market", "note", "target_price", "alert_price", "enabled"],
  Transactions: ["id", "date", "action", "symbol", "name", "market", "quantity", "price", "fee", "tax", "currency", "note", "created_at"],
  Prices: ["date", "symbol", "name", "market", "open", "high", "low", "close", "volume"],
  MarketIndex: ["date", "symbol", "name", "close", "change", "changePercent", "volume"],
  Indicators: ["date", "symbol", "name", "close", "ma5", "ma20", "ma60", "rsi14", "macd", "macdSignal", "macdHist", "volumeMA20", "volumeRatio", "bias20", "trendScore", "momentumScore", "riskScore", "totalScore", "trendText", "signalSummary"],
  Signals: ["date", "symbol", "name", "signalType", "signalName", "direction", "close", "note"],
  Portfolio: ["symbol", "name", "market", "currency", "quantity", "avgCost", "lastPrice", "marketValue", "totalCost", "unrealizedPnl", "unrealizedRate", "dividendTotal", "totalReturn", "lastDate", "trendText", "totalScore", "riskScore", "updatedAt"]
};

/**
 * 第一次請手動執行這個函式。
 * 會建立所有需要的 Sheet 與範例資料。
 */
function setupDatabase() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();

  Object.keys(HEADERS).forEach(sheetName => {
    const sheet = getOrCreateSheet_(ss, sheetName);
    if (sheet.getLastRow() === 0) {
      sheet.getRange(1, 1, 1, HEADERS[sheetName].length).setValues([HEADERS[sheetName]]);
      sheet.setFrozenRows(1);
    }
  });

  seedSampleData_();
  calculateAllAnalysis();
}

/**
 * 每天盤後可以執行這個。
 * 流程：Prices -> Indicators / Signals -> Portfolio
 */
function calculateAllAnalysis() {
  updateAnalysisFromPrices_();
  calculatePortfolio_();
}

/**
 * 真實盤後資料更新入口。
 * 建議每天晚上 20:00 以後執行。
 *
 * 手動執行：updateDailyPrices()
 * API 執行：?action=updateDailyPrices&token=你的token
 */
function updateDailyPrices(dateText) {
  const result = updateDailyPrices_({ date: dateText || "" });
  return result;
}

/**
 * 歷史資料回補入口。
 *
 * 手動執行範例：
 * backfillHistoricalPrices(12)
 * backfillHistoricalPrices(6, "2330,2317,006208")
 *
 * API 執行範例：
 * ?action=backfillHistoricalPrices&months=12&symbols=2330,2317
 */
function backfillHistoricalPrices(months, symbolsText) {
  return backfillHistoricalPrices_({
    months: months || CONFIG.HISTORY_MONTHS_DEFAULT,
    symbols: symbolsText || ""
  });
}


function backfillHistoricalPrices_(params) {
  checkToken_(params.token || "");

  const months = clamp_(Math.floor(toNumber_(params.months || CONFIG.HISTORY_MONTHS_DEFAULT)), 1, 36);
  const targets = getBackfillTargets_(params.symbols || params.symbol || "");

  if (targets.length === 0) {
    throw new Error("沒有可回補的股票。請先在 Stocks 或 Watchlist 加入股票代號。");
  }

  const monthStarts = getMonthStartDates_(months, new Date());
  const allRows = [];
  const details = [];

  targets.forEach(target => {
    const resolvedMarket = resolveHistoricalMarket_(target, monthStarts[0]);
    let symbolCount = 0;
    let symbolErrors = [];

    monthStarts.forEach(monthDate => {
      try {
        let rows = [];

        if (resolvedMarket === "TWSE") {
          rows = fetchTwseHistoricalMonth_(target, monthDate);
        } else if (resolvedMarket === "TPEX") {
          rows = fetchTpexHistoricalMonth_(target, monthDate);
        }

        if (rows.length > 0) {
          rows.forEach(r => allRows.push(r));
          symbolCount += rows.length;
        }

        // 避免短時間太多請求。
        Utilities.sleep(120);
      } catch (err) {
        symbolErrors.push(formatDate_(monthDate).slice(0, 7) + " " + err.message);
      }
    });

    details.push({
      symbol: target.symbol,
      name: target.name || "",
      market: resolvedMarket,
      rows: symbolCount,
      errors: symbolErrors.slice(0, 3)
    });
  });

  if (allRows.length === 0) {
    throw new Error("沒有回補到任何歷史資料。請確認股票代號、市場別，或官方資料來源是否暫時無法連線。");
  }

  const upsertResult = upsertPrices_(allRows);
  calculateAllAnalysis();

  return {
    ok: true,
    message: "歷史資料回補完成",
    months: months,
    symbols: targets.map(t => t.symbol),
    fetched: allRows.length,
    inserted: upsertResult.inserted,
    updated: upsertResult.updated,
    details: details,
    updatedAt: formatDateTime_(new Date())
  };
}

function getBackfillTargets_(symbolsText) {
  const requested = String(symbolsText || "")
    .split(/[\s,，;；]+/)
    .map(s => s.trim())
    .filter(Boolean);

  const requestedSet = new Set(requested);
  const map = {};

  function add(row) {
    const symbol = String(row.symbol || "").trim();
    if (!symbol) return;
    if (requestedSet.size > 0 && !requestedSet.has(symbol)) return;

    if (!map[symbol]) {
      map[symbol] = {
        symbol: symbol,
        name: String(row.name || "").trim(),
        market: String(row.market || "").trim()
      };
      return;
    }

    if (!map[symbol].name && row.name) map[symbol].name = String(row.name).trim();
    if (!map[symbol].market && row.market) map[symbol].market = String(row.market).trim();
  }

  getSheetObjects_(SHEETS.STOCKS).forEach(r => {
    if (r.enabled === false || String(r.enabled).toUpperCase() === "FALSE") return;
    add(r);
  });

  getSheetObjects_(SHEETS.WATCHLIST).forEach(r => {
    if (r.enabled === false || String(r.enabled).toUpperCase() === "FALSE") return;
    add(r);
  });

  getSheetObjects_(SHEETS.TRANSACTIONS).forEach(add);
  getSheetObjects_(SHEETS.PORTFOLIO).forEach(add);

  return Object.values(map).sort((a, b) => a.symbol.localeCompare(b.symbol));
}

function resolveHistoricalMarket_(target, sampleMonthDate) {
  const market = String(target.market || "").toUpperCase();

  if (market.indexOf("OTC") >= 0 || market.indexOf("TPEX") >= 0 || market.indexOf("上櫃") >= 0) return "TPEX";
  if (market === "TWSE" || market.indexOf("上市") >= 0) return "TWSE";

  // 未填市場別或只填 TW 時，自動偵測：先試上市，再試上櫃。
  try {
    const twseRows = fetchTwseHistoricalMonth_(target, sampleMonthDate);
    if (twseRows.length > 0) return "TWSE";
  } catch (err) {}

  try {
    const tpexRows = fetchTpexHistoricalMonth_(target, sampleMonthDate);
    if (tpexRows.length > 0) return "TPEX";
  } catch (err) {}

  // 預設當上市，錯誤會寫入 details。
  return "TWSE";
}

function fetchTwseHistoricalMonth_(target, monthDate) {
  const url = CONFIG.TWSE_STOCK_DAY_HISTORY_URL +
    "?response=json&date=" + toTwseMonthDate_(monthDate) +
    "&stockNo=" + encodeURIComponent(target.symbol);

  const json = fetchJson_(url);
  const data = Array.isArray(json.data) ? json.data : [];
  const output = [];

  data.forEach(row => {
    if (!Array.isArray(row) || row.length < 7) return;

    const date = normalizeMarketDate_(row[0], "");
    const volume = parseMarketNumber_(row[1]);
    const open = parseMarketNumber_(row[3]);
    const high = parseMarketNumber_(row[4]);
    const low = parseMarketNumber_(row[5]);
    const close = parseMarketNumber_(row[6]);

    if (!date || !isFinite(close) || close <= 0) return;

    output.push({
      date: date,
      symbol: target.symbol,
      name: target.name || parseTwseTitleName_(json.title, target.symbol),
      market: "TW",
      open: open,
      high: high,
      low: low,
      close: close,
      volume: volume
    });
  });

  return output;
}

function fetchTpexHistoricalMonth_(target, monthDate) {
  const urls = [
    CONFIG.TPEX_STOCK_HISTORY_URL +
      "?code=" + encodeURIComponent(target.symbol) +
      "&date=" + encodeURIComponent(toAdMonthDateForTpex_(monthDate)) +
      "&id=&response=json",
    CONFIG.TPEX_STOCK_HISTORY_LEGACY_URL +
      "?l=zh-tw&d=" + encodeURIComponent(toRocMonth_(monthDate)) +
      "&stkno=" + encodeURIComponent(target.symbol)
  ];

  let lastError = null;

  for (let i = 0; i < urls.length; i++) {
    try {
      const json = fetchJson_(urls[i]);
      const rows = parseTpexHistoricalJson_(json, target);
      if (rows.length > 0) return rows;
    } catch (err) {
      lastError = err;
    }
  }

  if (lastError) throw lastError;
  return [];
}

function parseTpexHistoricalJson_(json, target) {
  const output = [];

  // 新版 TPEx：可能是 { tables:[{ fields:[], data:[] }] }
  if (json && Array.isArray(json.tables)) {
    json.tables.forEach(table => {
      const fields = (table.fields || table.header || []).map(h => String(h).trim());
      const data = table.data || [];
      data.forEach(row => {
        const obj = arrayRowToObject_(fields, row);
        const parsed = parseTpexHistoricalObject_(obj, target);
        if (parsed) output.push(parsed);
      });
    });
  }

  // 舊版 TPEx：可能是 { aaData: [...] }
  if (json && Array.isArray(json.aaData)) {
    json.aaData.forEach(row => {
      const parsed = parseTpexHistoricalArray_(row, target);
      if (parsed) output.push(parsed);
    });
  }

  // 有些回傳直接是 data 陣列。
  if (json && Array.isArray(json.data)) {
    json.data.forEach(row => {
      let parsed = null;
      if (Array.isArray(row)) parsed = parseTpexHistoricalArray_(row, target);
      else parsed = parseTpexHistoricalObject_(row, target);
      if (parsed) output.push(parsed);
    });
  }

  // 有些 OpenAPI 直接回傳物件陣列。
  if (Array.isArray(json)) {
    json.forEach(row => {
      const parsed = parseTpexHistoricalObject_(row, target);
      if (parsed) output.push(parsed);
    });
  }

  return output;
}

function parseTpexHistoricalArray_(row, target) {
  if (!Array.isArray(row) || row.length < 7) return null;

  // 常見欄位：日期、成交千股、成交千元、開盤、最高、最低、收盤、漲跌、筆數
  const date = normalizeMarketDate_(row[0], "");
  const open = parseMarketNumber_(row[3]);
  const high = parseMarketNumber_(row[4]);
  const low = parseMarketNumber_(row[5]);
  const close = parseMarketNumber_(row[6]);
  let volume = parseMarketNumber_(row[1]);

  // 舊版 TPEx 成交量常見單位為「仟股」，轉成股數。
  if (isFinite(volume) && volume > 0 && volume < 100000000) {
    volume = volume * 1000;
  }

  if (!date || !isFinite(close) || close <= 0) return null;

  return {
    date: date,
    symbol: target.symbol,
    name: target.name || "",
    market: "TW_OTC",
    open: open,
    high: high,
    low: low,
    close: close,
    volume: volume
  };
}

function parseTpexHistoricalObject_(obj, target) {
  if (!obj) return null;

  const dateRaw = pickValue_(obj, ["Date", "date", "資料日期", "日期"]);
  const date = normalizeMarketDate_(dateRaw, "");

  const open = parseMarketNumber_(pickValue_(obj, ["Open", "OpeningPrice", "開盤", "開盤價"]));
  const high = parseMarketNumber_(pickValue_(obj, ["High", "HighestPrice", "最高", "最高價"]));
  const low = parseMarketNumber_(pickValue_(obj, ["Low", "LowestPrice", "最低", "最低價"]));
  const close = parseMarketNumber_(pickValue_(obj, ["Close", "ClosingPrice", "收盤", "收盤價"]));
  let volume = parseMarketNumber_(pickValue_(obj, ["TradingShares", "TradeVolume", "成交股數", "成交量", "成交仟股", "Volume"]));

  if (String(pickValue_(obj, ["成交仟股"]))) volume = volume * 1000;

  if (!date || !isFinite(close) || close <= 0) return null;

  return {
    date: date,
    symbol: target.symbol,
    name: target.name || pickValue_(obj, ["Name", "名稱", "CompanyName"]) || "",
    market: "TW_OTC",
    open: open,
    high: high,
    low: low,
    close: close,
    volume: volume
  };
}

function arrayRowToObject_(fields, row) {
  const obj = {};
  if (!Array.isArray(row)) return obj;
  fields.forEach((field, i) => {
    obj[field] = row[i];
  });
  return obj;
}

function parseTwseTitleName_(title, symbol) {
  const s = String(title || "");
  const idx = s.indexOf(symbol);
  if (idx < 0) return "";
  const tail = s.slice(idx + String(symbol).length).trim();
  return tail.split(/\s+/)[0] || "";
}

function getMonthStartDates_(months, endDate) {
  const result = [];
  const base = new Date(endDate);
  base.setDate(1);

  for (let i = 0; i < months; i++) {
    const d = new Date(base);
    d.setMonth(base.getMonth() - i);
    result.push(d);
  }

  return result;
}

function toTwseMonthDate_(date) {
  if (!(date instanceof Date)) date = new Date(date);
  return Utilities.formatDate(date, Session.getScriptTimeZone(), "yyyyMM") + "01";
}

function toAdMonthDateForTpex_(date) {
  if (!(date instanceof Date)) date = new Date(date);
  return Utilities.formatDate(date, Session.getScriptTimeZone(), "yyyy/MM") + "/01";
}

function toRocMonth_(date) {
  if (!(date instanceof Date)) date = new Date(date);
  const y = date.getFullYear() - 1911;
  const m = Utilities.formatDate(date, Session.getScriptTimeZone(), "MM");
  return y + "/" + m;
}

function updateDailyPrices_(params) {
  checkToken_(params.token || "");

  const targetDate = params.date ? new Date(params.date) : new Date();
  const dateForSheet = formatDate_(targetDate);
  const targetSymbols = getTargetSymbols_();

  const listedRows = fetchTwseDailyPrices_(targetDate, targetSymbols);
  const otcRows = fetchTpexDailyPrices_(targetDate, targetSymbols);
  const allRows = listedRows.concat(otcRows);

  if (allRows.length === 0) {
    throw new Error("沒有抓到任何價格資料。請確認今天是否為交易日，或 Watchlist / Stocks 是否有股票代號。");
  }

  const upsertResult = upsertPrices_(allRows);

  // 大盤資料先至少更新 TAIEX；櫃買指數不同資料源欄位較不穩，先保留原表資料。
  const marketResult = updateTwseMarketIndex_(targetDate);

  calculateAllAnalysis();

  return {
    ok: true,
    message: "盤後資料更新完成",
    date: dateForSheet,
    fetched: allRows.length,
    inserted: upsertResult.inserted,
    updated: upsertResult.updated,
    twseCount: listedRows.length,
    tpexCount: otcRows.length,
    marketIndex: marketResult,
    updatedAt: formatDateTime_(new Date())
  };
}

/**
 * 建立每日排程。
 * 建議第一次手動執行 createDailyPriceTrigger()。
 * 預設每天 20:00～21:00 之間自動跑 updateDailyPrices。
 */
function createDailyPriceTrigger() {
  ScriptApp.newTrigger("updateDailyPrices")
    .timeBased()
    .everyDays(1)
    .atHour(20)
    .create();
}

/**
 * 刪除本專案內 updateDailyPrices 的排程。
 */
function deleteDailyPriceTriggers() {
  const triggers = ScriptApp.getProjectTriggers();
  triggers.forEach(t => {
    if (t.getHandlerFunction() === "updateDailyPrices") {
      ScriptApp.deleteTrigger(t);
    }
  });
}

/**
 * 抓上市股票每日收盤資料 TWSE OpenAPI。
 */
function fetchTwseDailyPrices_(targetDate, targetSymbols) {
  const json = fetchJson_(CONFIG.TWSE_STOCK_DAY_ALL_URL);
  const rows = Array.isArray(json) ? json : [];
  const output = [];
  const dateForSheet = formatDate_(targetDate);

  rows.forEach(item => {
    const symbol = pickValue_(item, ["Code", "證券代號", "代號", "code", "stockNo"]);
    if (!symbol) return;
    if (CONFIG.FETCH_ONLY_MY_SYMBOLS && targetSymbols.size > 0 && !targetSymbols.has(String(symbol))) return;

    const name = pickValue_(item, ["Name", "證券名稱", "名稱", "name"]);
    const open = parseMarketNumber_(pickValue_(item, ["OpeningPrice", "Open", "開盤價", "開盤"]));
    const high = parseMarketNumber_(pickValue_(item, ["HighestPrice", "High", "最高價", "最高"]));
    const low = parseMarketNumber_(pickValue_(item, ["LowestPrice", "Low", "最低價", "最低"]));
    const close = parseMarketNumber_(pickValue_(item, ["ClosingPrice", "Close", "收盤價", "收盤"]));
    const volume = parseMarketNumber_(pickValue_(item, ["TradeVolume", "TradingShares", "成交股數", "成交量", "Volume"]));

    if (!isFinite(close) || close <= 0) return;

    output.push({
      date: dateForSheet,
      symbol: String(symbol).trim(),
      name: String(name || "").trim(),
      market: "TW",
      open: open,
      high: high,
      low: low,
      close: close,
      volume: volume
    });
  });

  return output;
}

/**
 * 抓上櫃股票每日收盤資料 TPEx OpenAPI。
 * TPEx 日期參數採民國年格式，例如 115/07/09。
 */
function fetchTpexDailyPrices_(targetDate, targetSymbols) {
  const rocDate = toRocDate_(targetDate);
  const url = CONFIG.TPEX_DAILY_CLOSE_URL + "?l=zh-tw&d=" + encodeURIComponent(rocDate) + "&s=0,asc,0";
  const json = fetchJson_(url);
  const rows = Array.isArray(json) ? json : [];
  const output = [];
  const fallbackDate = formatDate_(targetDate);

  rows.forEach(item => {
    const symbol = pickValue_(item, ["SecuritiesCompanyCode", "SecuritiesCode", "Code", "代號", "有價證券代號", "code"]);
    if (!symbol) return;
    if (CONFIG.FETCH_ONLY_MY_SYMBOLS && targetSymbols.size > 0 && !targetSymbols.has(String(symbol))) return;

    const name = pickValue_(item, ["CompanyName", "Name", "名稱", "有價證券名稱", "name"]);
    const rowDate = pickValue_(item, ["Date", "資料日期", "date"]);
    const open = parseMarketNumber_(pickValue_(item, ["Open", "OpeningPrice", "開盤", "開盤價"]));
    const high = parseMarketNumber_(pickValue_(item, ["High", "HighestPrice", "最高", "最高價"]));
    const low = parseMarketNumber_(pickValue_(item, ["Low", "LowestPrice", "最低", "最低價"]));
    const close = parseMarketNumber_(pickValue_(item, ["Close", "ClosingPrice", "收盤", "收盤價"]));
    const volume = parseMarketNumber_(pickValue_(item, ["TradingShares", "TradeVolume", "成交股數", "成交量", "Volume"]));

    if (!isFinite(close) || close <= 0) return;

    output.push({
      date: rowDate ? normalizeMarketDate_(rowDate, fallbackDate) : fallbackDate,
      symbol: String(symbol).trim(),
      name: String(name || "").trim(),
      market: "TW_OTC",
      open: open,
      high: high,
      low: low,
      close: close,
      volume: volume
    });
  });

  return output;
}

/**
 * 更新 TAIEX 加權指數。
 * 使用 TWSE MI_INDEX JSON endpoint，若官方欄位變動，會回傳 skipped，不影響個股更新。
 */
function updateTwseMarketIndex_(targetDate) {
  try {
    const url = CONFIG.TWSE_MI_INDEX_URL + "?response=json&date=" + toTwseDate_(targetDate) + "&type=ALL";
    const json = fetchJson_(url);
    const dataSets = [];

    Object.keys(json).forEach(key => {
      if (/^data\d*$/.test(key) && Array.isArray(json[key])) {
        dataSets.push(json[key]);
      }
    });

    let found = null;
    dataSets.some(data => {
      return data.some(row => {
        const first = Array.isArray(row) ? String(row[0] || "") : "";
        if (first.indexOf("發行量加權股價指數") >= 0 || first.toUpperCase().indexOf("TAIEX") >= 0) {
          found = row;
          return true;
        }
        return false;
      });
    });

    if (!found) {
      return { ok: false, skipped: true, message: "沒有找到 TAIEX 欄位" };
    }

    const close = parseMarketNumber_(found[1]);
    const change = parseMarketNumber_(found[3] || found[2]);
    const changePercent = parseMarketNumber_(found[4]);

    if (!isFinite(close) || close <= 0) {
      return { ok: false, skipped: true, message: "TAIEX 數值解析失敗" };
    }

    upsertMarketIndex_([{
      date: formatDate_(targetDate),
      symbol: "TAIEX",
      name: "加權指數",
      close: close,
      change: isFinite(change) ? change : "",
      changePercent: isFinite(changePercent) ? changePercent : "",
      volume: ""
    }]);

    return { ok: true, symbol: "TAIEX", close: close };
  } catch (err) {
    return { ok: false, skipped: true, message: err.message };
  }
}

function upsertPrices_(priceRows) {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const sheet = getOrCreateSheet_(ss, SHEETS.PRICES);
  ensureHeader_(sheet, HEADERS.Prices);

  const existing = getSheetObjects_(SHEETS.PRICES);
  const map = {};

  existing.forEach(r => {
    if (!r.date || !r.symbol) return;
    const date = formatDate_(new Date(r.date));
    const key = date + "|" + String(r.symbol).trim();
    map[key] = {
      date: date,
      symbol: String(r.symbol).trim(),
      name: String(r.name || "").trim(),
      market: String(r.market || "").trim(),
      open: toNumber_(r.open),
      high: toNumber_(r.high),
      low: toNumber_(r.low),
      close: toNumber_(r.close),
      volume: toNumber_(r.volume)
    };
  });

  let inserted = 0;
  let updated = 0;

  priceRows.forEach(r => {
    const date = formatDate_(new Date(r.date));
    const key = date + "|" + String(r.symbol).trim();
    if (map[key]) updated++;
    else inserted++;

    map[key] = {
      date: date,
      symbol: String(r.symbol).trim(),
      name: String(r.name || "").trim(),
      market: String(r.market || "").trim(),
      open: round_(r.open, 4),
      high: round_(r.high, 4),
      low: round_(r.low, 4),
      close: round_(r.close, 4),
      volume: Math.round(toNumber_(r.volume))
    };
  });

  const rows = Object.values(map)
    .sort((a, b) => {
      const d = new Date(a.date) - new Date(b.date);
      if (d !== 0) return d;
      return String(a.symbol).localeCompare(String(b.symbol));
    })
    .map(r => HEADERS.Prices.map(key => r[key] === undefined ? "" : r[key]));

  writeSheet_(sheet, HEADERS.Prices, rows);

  return { inserted: inserted, updated: updated };
}

function upsertMarketIndex_(rows) {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const sheet = getOrCreateSheet_(ss, SHEETS.MARKET_INDEX);
  ensureHeader_(sheet, HEADERS.MarketIndex);

  const existing = getSheetObjects_(SHEETS.MARKET_INDEX);
  const map = {};

  existing.forEach(r => {
    if (!r.date || !r.symbol) return;
    const date = formatDate_(new Date(r.date));
    const key = date + "|" + String(r.symbol).trim();
    map[key] = {
      date: date,
      symbol: String(r.symbol).trim(),
      name: String(r.name || "").trim(),
      close: toNumber_(r.close),
      change: toNumber_(r.change),
      changePercent: toNumber_(r.changePercent),
      volume: toNumber_(r.volume)
    };
  });

  rows.forEach(r => {
    const date = formatDate_(new Date(r.date));
    const key = date + "|" + String(r.symbol).trim();
    map[key] = r;
  });

  const outputRows = Object.values(map)
    .sort((a, b) => {
      const d = new Date(a.date) - new Date(b.date);
      if (d !== 0) return d;
      return String(a.symbol).localeCompare(String(b.symbol));
    })
    .map(r => HEADERS.MarketIndex.map(key => r[key] === undefined ? "" : r[key]));

  writeSheet_(sheet, HEADERS.MarketIndex, outputRows);
}

function getTargetSymbols_() {
  const set = new Set();

  getSheetObjects_(SHEETS.STOCKS).forEach(r => {
    if (r.enabled === false || String(r.enabled).toUpperCase() === "FALSE") return;
    if (r.symbol) set.add(String(r.symbol).trim());
  });

  getSheetObjects_(SHEETS.WATCHLIST).forEach(r => {
    if (r.enabled === false || String(r.enabled).toUpperCase() === "FALSE") return;
    if (r.symbol) set.add(String(r.symbol).trim());
  });

  getSheetObjects_(SHEETS.PORTFOLIO).forEach(r => {
    if (r.symbol) set.add(String(r.symbol).trim());
  });

  return set;
}

function fetchJson_(url) {
  const response = UrlFetchApp.fetch(url, {
    method: "get",
    muteHttpExceptions: true,
    headers: {
      "User-Agent": "Mozilla/5.0 AppsScript StockLab"
    }
  });

  const status = response.getResponseCode();
  const text = response.getContentText("UTF-8");

  if (status < 200 || status >= 300) {
    throw new Error("HTTP " + status + "：" + text.slice(0, 200));
  }

  return JSON.parse(text);
}

function pickValue_(obj, keys) {
  for (let i = 0; i < keys.length; i++) {
    if (obj[keys[i]] !== undefined && obj[keys[i]] !== null && obj[keys[i]] !== "") {
      return obj[keys[i]];
    }
  }
  return "";
}

function parseMarketNumber_(value) {
  if (value === null || value === undefined || value === "") return NaN;
  if (typeof value === "number") return value;

  const s = String(value)
    .replace(/,/g, "")
    .replace(/\+/g, "")
    .replace(/X/g, "")
    .replace(/--/g, "")
    .trim();

  if (!s || s === "-" || s === "除權息" || s === "除息" || s === "除權") return NaN;
  return Number(s);
}

function toTwseDate_(date) {
  if (!(date instanceof Date)) date = new Date(date);
  return Utilities.formatDate(date, Session.getScriptTimeZone(), "yyyyMMdd");
}

function toRocDate_(date) {
  if (!(date instanceof Date)) date = new Date(date);
  const y = date.getFullYear() - 1911;
  const m = Utilities.formatDate(date, Session.getScriptTimeZone(), "MM");
  const d = Utilities.formatDate(date, Session.getScriptTimeZone(), "dd");
  return y + "/" + m + "/" + d;
}

function normalizeMarketDate_(value, fallbackDate) {
  const s = String(value || "").trim();
  if (!s) return fallbackDate;

  // 民國年：115/07/09
  const roc = s.match(/^(\d{2,3})\/(\d{1,2})\/(\d{1,2})$/);
  if (roc) {
    const y = Number(roc[1]) + 1911;
    const m = String(roc[2]).padStart(2, "0");
    const d = String(roc[3]).padStart(2, "0");
    return y + "-" + m + "-" + d;
  }

  // 西元年：2026/07/09 或 2026-07-09
  const ad = s.match(/^(\d{4})[\/\-](\d{1,2})[\/\-](\d{1,2})$/);
  if (ad) {
    return ad[1] + "-" + String(ad[2]).padStart(2, "0") + "-" + String(ad[3]).padStart(2, "0");
  }

  return fallbackDate;
}


/**
 * Web API 入口。
 */
function doGet(e) {
  const params = (e && e.parameter) ? e.parameter : {};
  const action = params.action || "dashboard";
  const callback = params.callback || "";

  try {
    let result;

    if (action === "dashboard") {
      result = getDashboard_();
    } else if (action === "portfolio") {
      result = getPortfolio_();
    } else if (action === "analysis") {
      result = getAnalysis_(params.symbol || "");
    } else if (action === "transactions") {
      result = getTransactions_();
    } else if (action === "addTransaction") {
      result = addTransaction_(params);
    } else if (action === "updateDailyPrices") {
      result = updateDailyPrices_(params);
    } else if (action === "backfillHistoricalPrices") {
      result = backfillHistoricalPrices_(params);
    } else {
      result = {
        ok: false,
        message: "Unknown action: " + action
      };
    }

    return output_(result, callback);
  } catch (err) {
    return output_({
      ok: false,
      message: err.message,
      stack: err.stack
    }, callback);
  }
}

/**
 * 首頁資料
 */
function getDashboard_() {
  calculatePortfolio_();

  const market = getSheetObjects_(SHEETS.MARKET_INDEX).slice(-4);
  const watchlist = getEnabledWatchlist_();
  const latestIndicators = getLatestIndicatorsMap_();
  const priceTrendMap = getRecentCloseTrendMap_(30);

  const watchlistRows = watchlist.map(w => {
    const ind = latestIndicators[w.symbol] || {};
    return {
      symbol: w.symbol,
      name: w.name,
      market: w.market,
      close: ind.close || "",
      rsi14: ind.rsi14 || "",
      volumeRatio: ind.volumeRatio || "",
      totalScore: ind.totalScore || "",
      trendText: ind.trendText || "觀察",
      signalSummary: ind.signalSummary || "",
      trend: priceTrendMap[w.symbol] || []
    };
  });

  const marketRows = market.map(m => ({
    symbol: m.symbol,
    name: m.name,
    close: toNumber_(m.close),
    change: toNumber_(m.change),
    changePercent: toNumber_(m.changePercent),
    volume: toNumber_(m.volume),
    trend: []
  }));

  return {
    ok: true,
    updatedAt: formatDateTime_(new Date()),
    market: marketRows,
    watchlist: watchlistRows
  };
}

/**
 * 庫存頁資料
 */
function getPortfolio_() {
  const items = calculatePortfolio_();
  return {
    ok: true,
    updatedAt: formatDateTime_(new Date()),
    items: items
  };
}

/**
 * 技術分析頁資料
 */
function getAnalysis_(symbol) {
  symbol = String(symbol || "").trim();

  if (!symbol) {
    throw new Error("請提供 symbol");
  }

  calculatePortfolio_();

  const prices = getSheetObjects_(SHEETS.PRICES)
    .filter(r => String(r.symbol).trim() === symbol)
    .sort((a, b) => new Date(a.date) - new Date(b.date));

  const indicators = getSheetObjects_(SHEETS.INDICATORS)
    .filter(r => String(r.symbol).trim() === symbol)
    .sort((a, b) => new Date(a.date) - new Date(b.date));

  const signals = getSheetObjects_(SHEETS.SIGNALS)
    .filter(r => String(r.symbol).trim() === symbol)
    .sort((a, b) => new Date(b.date) - new Date(a.date))
    .slice(0, 10);

  const portfolio = getSheetObjects_(SHEETS.PORTFOLIO)
    .find(r => String(r.symbol).trim() === symbol) || {};

  const indicatorByDate = {};
  indicators.forEach(r => {
    indicatorByDate[formatDate_(new Date(r.date))] = r;
  });

  const chartRows = prices.slice(-120).map(p => {
    const date = formatDate_(new Date(p.date));
    const ind = indicatorByDate[date] || {};
    return {
      date: date,
      close: toNumber_(p.close),
      ma20: toNumberOrBlank_(ind.ma20),
      ma60: toNumberOrBlank_(ind.ma60),
      volume: toNumber_(p.volume)
    };
  });

  const latest = indicators.length ? indicators[indicators.length - 1] : {};

  return {
    ok: true,
    symbol: symbol,
    name: prices.length ? prices[prices.length - 1].name : "",
    latest: latest,
    portfolio: portfolio,
    prices: chartRows,
    signals: signals
  };
}

/**
 * 交易紀錄頁資料
 */
function getTransactions_() {
  const items = getSheetObjects_(SHEETS.TRANSACTIONS)
    .sort((a, b) => new Date(b.date) - new Date(a.date));

  return {
    ok: true,
    items: items
  };
}

/**
 * 新增交易
 * MVP 為了 GitHub Pages 方便，先支援 JSONP GET 寫入。
 */
function addTransaction_(params) {
  checkToken_(params.token || "");

  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const sheet = getOrCreateSheet_(ss, SHEETS.TRANSACTIONS);
  ensureHeader_(sheet, HEADERS.Transactions);

  const id = "T" + Utilities.formatDate(new Date(), Session.getScriptTimeZone(), "yyyyMMddHHmmss") + Math.floor(Math.random() * 1000);

  const row = [
    id,
    params.date || formatDate_(new Date()),
    String(params.action || "BUY").toUpperCase(),
    String(params.symbol || "").trim(),
    String(params.name || "").trim(),
    String(params.market || "TW").trim(),
    toNumber_(params.quantity),
    toNumber_(params.price),
    toNumber_(params.fee),
    toNumber_(params.tax),
    String(params.currency || "TWD").trim(),
    String(params.note || "").trim(),
    formatDateTime_(new Date())
  ];

  if (!row[3]) throw new Error("symbol 不可空白");
  if (!row[6]) throw new Error("quantity 不可空白");
  if (row[7] === "" || isNaN(row[7])) throw new Error("price 不可空白");

  sheet.appendRow(row);
  calculatePortfolio_();

  return {
    ok: true,
    message: "新增成功",
    id: id
  };
}

/**
 * 從 Prices 計算 Indicators 和 Signals
 */
function updateAnalysisFromPrices_() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const priceRows = getSheetObjects_(SHEETS.PRICES)
    .filter(r => r.date && r.symbol && r.close !== "");

  const grouped = {};
  priceRows.forEach(r => {
    const symbol = String(r.symbol).trim();
    if (!grouped[symbol]) grouped[symbol] = [];
    grouped[symbol].push({
      date: new Date(r.date),
      symbol: symbol,
      name: String(r.name || "").trim(),
      market: String(r.market || "").trim(),
      open: toNumber_(r.open),
      high: toNumber_(r.high),
      low: toNumber_(r.low),
      close: toNumber_(r.close),
      volume: toNumber_(r.volume)
    });
  });

  const indicatorRows = [];
  const signalRows = [];

  Object.keys(grouped).forEach(symbol => {
    const data = grouped[symbol].sort((a, b) => a.date - b.date);
    const closes = data.map(r => r.close);
    const highs = data.map(r => r.high);
    const volumes = data.map(r => r.volume);

    const ma5 = movingAverage_(closes, 5);
    const ma20 = movingAverage_(closes, 20);
    const ma60 = movingAverage_(closes, 60);
    const volumeMA20 = movingAverage_(volumes, 20);
    const rsi14 = rsiWilder_(closes, 14);
    const macdResult = macd_(closes, 12, 26, 9);

    for (let i = 0; i < data.length; i++) {
      const row = data[i];
      const close = closes[i];

      const volumeRatio = isValid_(volumeMA20[i]) ? row.volume / volumeMA20[i] : "";
      const bias20 = isValid_(ma20[i]) ? (close - ma20[i]) / ma20[i] : "";

      const score = calculateScores_({
        close: close,
        ma5: ma5[i],
        ma20: ma20[i],
        ma60: ma60[i],
        prevMA20: i > 0 ? ma20[i - 1] : "",
        rsi14: rsi14[i],
        macdHist: macdResult.histogram[i],
        volumeRatio: volumeRatio,
        bias20: bias20
      });

      const todaySignals = detectSignals_({
        i: i,
        data: data,
        closes: closes,
        highs: highs,
        ma5: ma5,
        ma20: ma20,
        rsi14: rsi14,
        macdHist: macdResult.histogram,
        volumeRatio: volumeRatio
      });

      indicatorRows.push([
        formatDate_(row.date),
        row.symbol,
        row.name,
        round_(close, 2),
        roundOrBlank_(ma5[i], 2),
        roundOrBlank_(ma20[i], 2),
        roundOrBlank_(ma60[i], 2),
        roundOrBlank_(rsi14[i], 2),
        roundOrBlank_(macdResult.macdLine[i], 4),
        roundOrBlank_(macdResult.signalLine[i], 4),
        roundOrBlank_(macdResult.histogram[i], 4),
        roundOrBlank_(volumeMA20[i], 0),
        roundOrBlank_(volumeRatio, 2),
        roundOrBlank_(bias20, 4),
        score.trendScore,
        score.momentumScore,
        score.riskScore,
        score.totalScore,
        score.trendText,
        todaySignals.map(s => s.signalName).join("、")
      ]);

      todaySignals.forEach(s => {
        signalRows.push([
          formatDate_(row.date),
          row.symbol,
          row.name,
          s.signalType,
          s.signalName,
          s.direction,
          round_(close, 2),
          s.note
        ]);
      });
    }
  });

  writeSheet_(ss.getSheetByName(SHEETS.INDICATORS), HEADERS.Indicators, indicatorRows);
  writeSheet_(ss.getSheetByName(SHEETS.SIGNALS), HEADERS.Signals, signalRows);
}

/**
 * 計算 Portfolio
 */
function calculatePortfolio_() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const transactions = getSheetObjects_(SHEETS.TRANSACTIONS)
    .filter(r => r.symbol && r.action);

  const latestPrice = getLatestPriceMap_();
  const latestIndicator = getLatestIndicatorsMap_();
  const holdings = {};

  transactions
    .sort((a, b) => new Date(a.date) - new Date(b.date))
    .forEach(t => {
      const symbol = String(t.symbol).trim();
      if (!holdings[symbol]) {
        holdings[symbol] = {
          symbol: symbol,
          name: t.name || "",
          market: t.market || "TW",
          currency: t.currency || "TWD",
          quantity: 0,
          totalCost: 0,
          dividendTotal: 0
        };
      }

      const h = holdings[symbol];
      const action = String(t.action || "").toUpperCase();
      const qty = toNumber_(t.quantity);
      const price = toNumber_(t.price);
      const fee = toNumber_(t.fee);
      const tax = toNumber_(t.tax);

      if (action === "BUY") {
        h.quantity += qty;
        h.totalCost += qty * price + fee + tax;
      } else if (action === "SELL") {
        const avgCost = h.quantity > 0 ? h.totalCost / h.quantity : 0;
        const sellQty = Math.min(qty, h.quantity);
        h.quantity -= sellQty;
        h.totalCost -= avgCost * sellQty;
        if (h.quantity < 0.000001) {
          h.quantity = 0;
          h.totalCost = 0;
        }
      } else if (action === "DIVIDEND") {
        h.dividendTotal += qty * price;
      }
    });

  const rows = [];
  const outputItems = [];

  Object.keys(holdings).forEach(symbol => {
    const h = holdings[symbol];

    if (h.quantity <= 0 && h.dividendTotal <= 0) return;

    const priceInfo = latestPrice[symbol] || {};
    const ind = latestIndicator[symbol] || {};

    const lastPrice = toNumber_(priceInfo.close);
    const avgCost = h.quantity > 0 ? h.totalCost / h.quantity : 0;
    const marketValue = h.quantity * lastPrice;
    const unrealizedPnl = marketValue - h.totalCost;
    const unrealizedRate = h.totalCost > 0 ? unrealizedPnl / h.totalCost * 100 : 0;
    const totalReturn = unrealizedPnl + h.dividendTotal;

    const item = {
      symbol: symbol,
      name: priceInfo.name || h.name,
      market: priceInfo.market || h.market,
      currency: h.currency,
      quantity: round_(h.quantity, 4),
      avgCost: round_(avgCost, 4),
      lastPrice: round_(lastPrice, 4),
      marketValue: round_(marketValue, 2),
      totalCost: round_(h.totalCost, 2),
      unrealizedPnl: round_(unrealizedPnl, 2),
      unrealizedRate: round_(unrealizedRate, 2),
      dividendTotal: round_(h.dividendTotal, 2),
      totalReturn: round_(totalReturn, 2),
      lastDate: priceInfo.date ? formatDate_(new Date(priceInfo.date)) : "",
      trendText: ind.trendText || "",
      totalScore: ind.totalScore || "",
      riskScore: ind.riskScore || "",
      updatedAt: formatDateTime_(new Date())
    };

    outputItems.push(item);
    rows.push(HEADERS.Portfolio.map(key => item[key] === undefined ? "" : item[key]));
  });

  writeSheet_(ss.getSheetByName(SHEETS.PORTFOLIO), HEADERS.Portfolio, rows);
  return outputItems;
}

/**
 * 固定規則分數
 */
function calculateScores_(x) {
  let trendScore = 0;
  let momentumScore = 0;
  let riskScore = 100;

  if (isValid_(x.ma20) && x.close > x.ma20) trendScore += 25;
  if (isValid_(x.ma20) && isValid_(x.ma60) && x.ma20 > x.ma60) trendScore += 25;
  if (isValid_(x.ma5) && x.close > x.ma5) trendScore += 15;
  if (isValid_(x.prevMA20) && isValid_(x.ma20) && x.ma20 > x.prevMA20) trendScore += 20;
  if (isValid_(x.volumeRatio) && x.volumeRatio >= 1.2) trendScore += 15;

  if (isValid_(x.rsi14)) {
    if (x.rsi14 >= 50 && x.rsi14 <= 70) momentumScore += 35;
    else if (x.rsi14 > 70 && x.rsi14 <= 75) momentumScore += 25;
    else if (x.rsi14 >= 40 && x.rsi14 < 50) momentumScore += 15;
    else if (x.rsi14 < 30) momentumScore += 10;
  }

  if (isValid_(x.macdHist) && x.macdHist > 0) momentumScore += 35;
  if (isValid_(x.volumeRatio) && x.volumeRatio >= 1.0) momentumScore += 15;
  if (isValid_(x.volumeRatio) && x.volumeRatio >= 1.5) momentumScore += 15;

  if (isValid_(x.bias20)) {
    if (x.bias20 > 0.1) riskScore -= 30;
    else if (x.bias20 > 0.07) riskScore -= 20;
    else if (x.bias20 > 0.05) riskScore -= 10;
    if (x.bias20 < -0.08) riskScore -= 15;
  }

  if (isValid_(x.rsi14)) {
    if (x.rsi14 > 75) riskScore -= 25;
    if (x.rsi14 < 30) riskScore -= 10;
  }

  if (isValid_(x.ma20) && x.close < x.ma20) riskScore -= 25;
  if (isValid_(x.volumeRatio) && x.volumeRatio < 0.7) riskScore -= 10;

  trendScore = clamp_(trendScore, 0, 100);
  momentumScore = clamp_(momentumScore, 0, 100);
  riskScore = clamp_(riskScore, 0, 100);

  const totalScore = Math.round(trendScore * 0.4 + momentumScore * 0.35 + riskScore * 0.25);

  let trendText = "觀察";
  if (totalScore >= 75 && riskScore >= 60) trendText = "偏多";
  else if (totalScore >= 60) trendText = "中性偏多";
  else if (totalScore >= 45) trendText = "盤整觀察";
  else trendText = "偏弱";

  return {
    trendScore,
    momentumScore,
    riskScore,
    totalScore,
    trendText
  };
}

/**
 * 固定規則訊號
 */
function detectSignals_(ctx) {
  const { i, closes, highs, ma5, ma20, rsi14, macdHist, volumeRatio } = ctx;
  const signals = [];
  if (i <= 0) return signals;

  const close = closes[i];
  const prevClose = closes[i - 1];
  const todayMA5 = ma5[i];
  const yesterdayMA5 = ma5[i - 1];
  const todayMA20 = ma20[i];
  const yesterdayMA20 = ma20[i - 1];
  const todayRSI = rsi14[i];
  const todayMACDHist = macdHist[i];
  const yesterdayMACDHist = macdHist[i - 1];

  if (
    isValid_(todayMA5) && isValid_(todayMA20) &&
    isValid_(yesterdayMA5) && isValid_(yesterdayMA20) &&
    yesterdayMA5 <= yesterdayMA20 && todayMA5 > todayMA20
  ) {
    signals.push({
      signalType: "MA_CROSS",
      signalName: "MA5 上穿 MA20",
      direction: "bullish",
      note: "短線均線向上突破月線，短線轉強"
    });
  }

  if (
    isValid_(todayMA20) && isValid_(yesterdayMA20) &&
    prevClose <= yesterdayMA20 && close > todayMA20
  ) {
    signals.push({
      signalType: "CLOSE_ABOVE_MA20",
      signalName: "收盤站上 MA20",
      direction: "bullish",
      note: "股價重新站上月線"
    });
  }

  if (
    isValid_(todayMA20) && isValid_(yesterdayMA20) &&
    prevClose >= yesterdayMA20 && close < todayMA20
  ) {
    signals.push({
      signalType: "CLOSE_BELOW_MA20",
      signalName: "跌破 MA20",
      direction: "bearish",
      note: "股價跌破月線，需觀察轉弱風險"
    });
  }

  if (isValid_(todayRSI) && todayRSI < 30) {
    signals.push({
      signalType: "RSI_OVERSOLD",
      signalName: "RSI 低於 30",
      direction: "watch",
      note: "短線超跌，但不代表一定反彈"
    });
  }

  if (isValid_(todayRSI) && todayRSI > 75) {
    signals.push({
      signalType: "RSI_OVERHEATED",
      signalName: "RSI 高於 75",
      direction: "risk",
      note: "短線過熱，追價風險提高"
    });
  }

  if (
    isValid_(todayMACDHist) && isValid_(yesterdayMACDHist) &&
    yesterdayMACDHist <= 0 && todayMACDHist > 0
  ) {
    signals.push({
      signalType: "MACD_BULLISH_CROSS",
      signalName: "MACD 轉正",
      direction: "bullish",
      note: "MACD Histogram 由負轉正"
    });
  }

  if (i >= 20 && isValid_(volumeRatio)) {
    const previous20High = Math.max.apply(null, highs.slice(i - 20, i));
    if (close > previous20High && volumeRatio >= 1.5) {
      signals.push({
        signalType: "VOLUME_BREAKOUT",
        signalName: "放量突破 20 日高點",
        direction: "bullish",
        note: "價格突破近期高點且成交量放大"
      });
    }
  }

  return signals;
}

/**
 * 範例資料，方便你第一次看畫面。
 * 之後可以刪除並換成真實 API 抓回來的 Prices。
 */
function seedSampleData_() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();

  const stocksSheet = ss.getSheetByName(SHEETS.STOCKS);
  if (stocksSheet.getLastRow() <= 1) {
    stocksSheet.getRange(2, 1, 3, HEADERS.Stocks.length).setValues([
      ["2330", "台積電", "TW", "TWD", "stock", true],
      ["2317", "鴻海", "TW", "TWD", "stock", true],
      ["006208", "富邦台50", "TW", "TWD", "ETF", true]
    ]);
  }

  const watchSheet = ss.getSheetByName(SHEETS.WATCHLIST);
  if (watchSheet.getLastRow() <= 1) {
    watchSheet.getRange(2, 1, 3, HEADERS.Watchlist.length).setValues([
      ["2330", "台積電", "TW", "核心觀察", "", "", true],
      ["2317", "鴻海", "TW", "盤整觀察", "", "", true],
      ["006208", "富邦台50", "TW", "ETF", "", "", true]
    ]);
  }

  const transSheet = ss.getSheetByName(SHEETS.TRANSACTIONS);
  if (transSheet.getLastRow() <= 1) {
    transSheet.getRange(2, 1, 2, HEADERS.Transactions.length).setValues([
      ["T_SAMPLE_1", "2026-07-01", "BUY", "2330", "台積電", "TW", 10, 820, 20, 0, "TWD", "初始買進", formatDateTime_(new Date())],
      ["T_SAMPLE_2", "2026-07-02", "BUY", "2317", "鴻海", "TW", 20, 200, 20, 0, "TWD", "觀察", formatDateTime_(new Date())]
    ]);
  }

  const marketSheet = ss.getSheetByName(SHEETS.MARKET_INDEX);
  if (marketSheet.getLastRow() <= 1) {
    marketSheet.getRange(2, 1, 2, HEADERS.MarketIndex.length).setValues([
      ["2026-07-09", "TAIEX", "加權指數", 23520, 180, 0.77, 4200000000],
      ["2026-07-09", "OTC", "櫃買指數", 260.5, 2.1, 0.82, 900000000]
    ]);
  }

  const priceSheet = ss.getSheetByName(SHEETS.PRICES);
  if (priceSheet.getLastRow() > 1) return;

  const samples = [
    { symbol: "2330", name: "台積電", market: "TW", start: 820, step: 2.0 },
    { symbol: "2317", name: "鴻海", market: "TW", start: 205, step: -0.15 },
    { symbol: "006208", name: "富邦台50", market: "TW", start: 110, step: 0.25 }
  ];

  const rows = [];
  const startDate = new Date("2026-03-20");

  samples.forEach(s => {
    let close = s.start;
    for (let i = 0; i < 80; i++) {
      const d = new Date(startDate);
      d.setDate(startDate.getDate() + i);

      const wave = Math.sin(i / 4) * (s.start * 0.01);
      close = close + s.step + Math.sin(i / 5) * 1.2;
      const c = Math.max(1, close + wave);
      const open = c * (1 + Math.sin(i) * 0.003);
      const high = Math.max(open, c) * 1.01;
      const low = Math.min(open, c) * 0.99;
      const volume = Math.round(10000000 + Math.abs(Math.sin(i / 3)) * 20000000);

      rows.push([
        formatDate_(d),
        s.symbol,
        s.name,
        s.market,
        round_(open, 2),
        round_(high, 2),
        round_(low, 2),
        round_(c, 2),
        volume
      ]);
    }
  });

  priceSheet.getRange(2, 1, rows.length, HEADERS.Prices.length).setValues(rows);
}

/**
 * 工具：讀取 Sheet 為物件陣列
 */
function getSheetObjects_(sheetName) {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const sheet = ss.getSheetByName(sheetName);
  if (!sheet || sheet.getLastRow() < 2) return [];

  const values = sheet.getDataRange().getValues();
  const headers = values[0].map(h => String(h).trim());

  return values.slice(1).filter(row => row.some(cell => cell !== "")).map(row => {
    const obj = {};
    headers.forEach((h, i) => {
      obj[h] = row[i];
    });
    return obj;
  });
}

function getEnabledWatchlist_() {
  return getSheetObjects_(SHEETS.WATCHLIST)
    .filter(r => r.enabled === true || String(r.enabled).toUpperCase() === "TRUE" || r.enabled === "");
}

function getLatestPriceMap_() {
  const rows = getSheetObjects_(SHEETS.PRICES)
    .filter(r => r.symbol && r.date)
    .sort((a, b) => new Date(a.date) - new Date(b.date));

  const map = {};
  rows.forEach(r => {
    map[String(r.symbol).trim()] = r;
  });
  return map;
}

function getLatestIndicatorsMap_() {
  const rows = getSheetObjects_(SHEETS.INDICATORS)
    .filter(r => r.symbol && r.date)
    .sort((a, b) => new Date(a.date) - new Date(b.date));

  const map = {};
  rows.forEach(r => {
    map[String(r.symbol).trim()] = r;
  });
  return map;
}

function getRecentCloseTrendMap_(count) {
  const rows = getSheetObjects_(SHEETS.PRICES)
    .filter(r => r.symbol && r.close !== "")
    .sort((a, b) => new Date(a.date) - new Date(b.date));

  const map = {};
  rows.forEach(r => {
    const symbol = String(r.symbol).trim();
    if (!map[symbol]) map[symbol] = [];
    map[symbol].push(toNumber_(r.close));
  });

  Object.keys(map).forEach(symbol => {
    map[symbol] = map[symbol].slice(-count);
  });

  return map;
}

function writeSheet_(sheet, headers, rows) {
  ensureHeader_(sheet, headers);
  sheet.clearContents();
  sheet.getRange(1, 1, 1, headers.length).setValues([headers]);
  sheet.setFrozenRows(1);
  if (rows.length > 0) {
    sheet.getRange(2, 1, rows.length, headers.length).setValues(rows);
  }
  sheet.autoResizeColumns(1, headers.length);
}

function ensureHeader_(sheet, headers) {
  if (!sheet) throw new Error("Sheet 不存在");
  if (sheet.getLastRow() === 0) {
    sheet.getRange(1, 1, 1, headers.length).setValues([headers]);
    sheet.setFrozenRows(1);
  }
}

function getOrCreateSheet_(ss, name) {
  let sheet = ss.getSheetByName(name);
  if (!sheet) sheet = ss.insertSheet(name);
  return sheet;
}

function output_(data, callback) {
  const json = JSON.stringify(data);
  if (callback) {
    return ContentService
      .createTextOutput(callback + "(" + json + ");")
      .setMimeType(ContentService.MimeType.JAVASCRIPT);
  }

  return ContentService
    .createTextOutput(json)
    .setMimeType(ContentService.MimeType.JSON);
}

function checkToken_(token) {
  if (!CONFIG.API_TOKEN) return;
  if (token !== CONFIG.API_TOKEN) {
    throw new Error("API_TOKEN 錯誤");
  }
}

/**
 * 技術指標工具
 */
function movingAverage_(values, period) {
  const result = Array(values.length).fill("");
  let sum = 0;

  for (let i = 0; i < values.length; i++) {
    sum += values[i];

    if (i >= period) {
      sum -= values[i - period];
    }

    if (i >= period - 1) {
      result[i] = sum / period;
    }
  }

  return result;
}

function rsiWilder_(closes, period) {
  const result = Array(closes.length).fill("");
  if (closes.length <= period) return result;

  let gainSum = 0;
  let lossSum = 0;

  for (let i = 1; i <= period; i++) {
    const change = closes[i] - closes[i - 1];
    if (change >= 0) gainSum += change;
    else lossSum += Math.abs(change);
  }

  let avgGain = gainSum / period;
  let avgLoss = lossSum / period;
  result[period] = calculateRSI_(avgGain, avgLoss);

  for (let i = period + 1; i < closes.length; i++) {
    const change = closes[i] - closes[i - 1];
    const gain = change > 0 ? change : 0;
    const loss = change < 0 ? Math.abs(change) : 0;

    avgGain = ((avgGain * (period - 1)) + gain) / period;
    avgLoss = ((avgLoss * (period - 1)) + loss) / period;

    result[i] = calculateRSI_(avgGain, avgLoss);
  }

  return result;
}

function calculateRSI_(avgGain, avgLoss) {
  if (avgLoss === 0) return 100;
  const rs = avgGain / avgLoss;
  return 100 - (100 / (1 + rs));
}

function macd_(closes, fastPeriod, slowPeriod, signalPeriod) {
  const emaFast = ema_(closes, fastPeriod);
  const emaSlow = ema_(closes, slowPeriod);
  const macdLine = Array(closes.length).fill("");

  for (let i = 0; i < closes.length; i++) {
    if (isValid_(emaFast[i]) && isValid_(emaSlow[i])) {
      macdLine[i] = emaFast[i] - emaSlow[i];
    }
  }

  const signalLine = emaFromNullable_(macdLine, signalPeriod);
  const histogram = Array(closes.length).fill("");

  for (let i = 0; i < closes.length; i++) {
    if (isValid_(macdLine[i]) && isValid_(signalLine[i])) {
      histogram[i] = macdLine[i] - signalLine[i];
    }
  }

  return { macdLine, signalLine, histogram };
}

function ema_(values, period) {
  const result = Array(values.length).fill("");
  const k = 2 / (period + 1);
  if (values.length < period) return result;

  let sum = 0;
  for (let i = 0; i < period; i++) sum += values[i];

  result[period - 1] = sum / period;

  for (let i = period; i < values.length; i++) {
    result[i] = values[i] * k + result[i - 1] * (1 - k);
  }

  return result;
}

function emaFromNullable_(values, period) {
  const result = Array(values.length).fill("");
  const k = 2 / (period + 1);
  let validValues = [];
  let startIndex = -1;

  for (let i = 0; i < values.length; i++) {
    if (isValid_(values[i])) validValues.push(values[i]);
    if (validValues.length === period) {
      startIndex = i;
      break;
    }
  }

  if (startIndex === -1) return result;

  const initialSum = validValues.reduce((a, b) => a + b, 0);
  result[startIndex] = initialSum / period;

  for (let i = startIndex + 1; i < values.length; i++) {
    if (isValid_(values[i])) {
      result[i] = values[i] * k + result[i - 1] * (1 - k);
    }
  }

  return result;
}

/**
 * 基本工具
 */
function toNumber_(value) {
  if (value === null || value === undefined || value === "") return 0;
  if (typeof value === "number") return value;
  return Number(String(value).replace(/,/g, ""));
}

function toNumberOrBlank_(value) {
  if (value === null || value === undefined || value === "") return "";
  return toNumber_(value);
}

function isValid_(value) {
  return value !== "" && value !== null && value !== undefined && !isNaN(value);
}

function round_(value, digits) {
  if (!isValid_(value)) return "";
  const factor = Math.pow(10, digits);
  return Math.round(Number(value) * factor) / factor;
}

function roundOrBlank_(value, digits) {
  if (!isValid_(value)) return "";
  return round_(value, digits);
}

function clamp_(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

function formatDate_(date) {
  if (!(date instanceof Date)) date = new Date(date);
  return Utilities.formatDate(date, Session.getScriptTimeZone(), "yyyy-MM-dd");
}

function formatDateTime_(date) {
  if (!(date instanceof Date)) date = new Date(date);
  return Utilities.formatDate(date, Session.getScriptTimeZone(), "yyyy-MM-dd HH:mm:ss");
}
