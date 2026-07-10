// StockLab Apps Script Backend v10.1 PRIVATE - do not upload to GitHub
const APP_VERSION = "v10.1";

const CONFIG = {
  // 個人使用可先留空。
  // 若要防止別人亂新增交易 / 觸發更新，可設定例如 "my_secret_token"，
  // 然後前端 js/config.js 的 API_TOKEN 也要填一樣。
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
  STOCK_MASTER: "StockMaster",
  WATCHLIST: "Watchlist",
  TRANSACTIONS: "Transactions",
  PRICES: "Prices",
  MARKET_INDEX: "MarketIndex",
  INDICATORS: "Indicators",
  SIGNALS: "Signals",
  PORTFOLIO: "Portfolio",
  DASHBOARD_CACHE: "DashboardCache"
};

const HEADERS = {
  Stocks: ["symbol", "name", "market", "currency", "type", "enabled"],
  StockMaster: ["symbol", "name", "market", "currency", "type", "source", "updatedAt"],
  Watchlist: ["symbol", "name", "market", "currency", "type", "note", "target_price", "alert_price", "enabled", "createdAt", "updatedAt"],
  Transactions: ["id", "date", "action", "symbol", "name", "market", "quantity", "price", "fee", "tax", "currency", "note", "created_at"],
  Prices: ["date", "symbol", "name", "market", "open", "high", "low", "close", "volume"],
  MarketIndex: ["date", "symbol", "name", "close", "change", "changePercent", "volume"],
  Indicators: ["date", "symbol", "name", "close", "ma5", "ma20", "ma60", "rsi14", "macd", "macdSignal", "macdHist", "volumeMA20", "volumeRatio", "bias20", "trendScore", "momentumScore", "riskScore", "totalScore", "trendText", "signalSummary"],
  Signals: ["date", "symbol", "name", "signalType", "signalName", "direction", "close", "note"],
  Portfolio: ["symbol", "name", "market", "currency", "quantity", "avgCost", "lastPrice", "marketValue", "totalCost", "unrealizedPnl", "unrealizedRate", "dividendTotal", "totalReturn", "lastDate", "trendText", "totalScore", "riskScore", "updatedAt"],
  DashboardCache: ["key", "json", "updatedAt"]
};


function normalizeSymbolCode_(symbol, name, type) {
  return normalizeOfficialTwSymbol_(symbol, name);
}

const OFFICIAL_TW_SYMBOL_BY_NAME = {
  "富邦台50": "006208",
  "富邦台灣50": "006208",
  "國泰永續高股息": "00878",
  "元大台灣50": "0050",
  "元大高股息": "0056"
};

function normalizeTwSymbol(symbol) {
  return normalizeTwSymbol_(symbol);
}

function normalizeTwSymbol_(symbol) {
  const s = String(symbol === undefined || symbol === null ? "" : symbol).trim();
  return s.charAt(0) === "'" ? s.slice(1).trim() : s;
}

function normalizeOfficialTwSymbol_(symbol, name) {
  const n = String(name || "").trim();
  if (OFFICIAL_TW_SYMBOL_BY_NAME[n]) return OFFICIAL_TW_SYMBOL_BY_NAME[n];
  return normalizeTwSymbol_(symbol);
}

function getTwSymbolCandidates_(symbol) {
  const normalized = normalizeTwSymbol_(symbol);
  return normalized ? [normalized] : [];
}

function applySymbolTextFormats_() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  Object.keys(HEADERS).forEach(sheetName => {
    const sheet = ss.getSheetByName(sheetName);
    if (!sheet) return;
    const headers = HEADERS[sheetName];
    formatSymbolColumn_(sheet, headers);
  });
}

function formatSymbolColumn_(sheet, headers) {
  const idx = headers.indexOf("symbol");
  if (idx >= 0) {
    sheet.getRange(1, idx + 1, Math.max(sheet.getMaxRows(), 1), 1).setNumberFormat("@");
  }
}

function protectSymbolCells_(sheet, headers, startRow, rows) {
  const idx = headers.indexOf("symbol");
  if (idx < 0 || !rows || rows.length === 0) return;

  const symbols = rows.map(row => [normalizeTwSymbol_(row[idx])]);
  const range = sheet.getRange(startRow, idx + 1, rows.length, 1);
  range.setNumberFormat("@");
  range.setValues(symbols);
}

function writeDataRow_(sheet, headers, rowIndex, row) {
  formatSymbolColumn_(sheet, headers);
  sheet.getRange(rowIndex, 1, 1, headers.length).setValues([row]);
  protectSymbolCells_(sheet, headers, rowIndex, [row]);
}

function appendDataRow_(sheet, headers, row) {
  writeDataRow_(sheet, headers, sheet.getLastRow() + 1, row);
}

function getSymbolCellValue_(values, displayValues, rowIndex, symbolIdx) {
  if (symbolIdx < 0) return "";
  const displayed = displayValues && displayValues[rowIndex] ? displayValues[rowIndex][symbolIdx] : "";
  const raw = values && values[rowIndex] ? values[rowIndex][symbolIdx] : "";
  return normalizeTwSymbol_(displayed || raw);
}

function symbolsMatchForWatchlist_(storedSymbol, storedName, targetSymbol, targetName) {
  const stored = normalizeTwSymbol_(storedSymbol);
  const target = normalizeTwSymbol_(targetSymbol);
  if (!stored || !target) return false;
  if (stored === target) return true;

  const storedOfficial = recoverTwSymbolByName_(stored, storedName);
  const targetOfficial = recoverTwSymbolByName_(target, targetName);
  if (storedOfficial && targetOfficial && storedOfficial === targetOfficial) return true;

  return false;
}

function recoverTwSymbolByName_(symbol, name) {
  const n = String(name || "").trim();
  if (OFFICIAL_TW_SYMBOL_BY_NAME[n]) return OFFICIAL_TW_SYMBOL_BY_NAME[n];

  const fromMaster = findStockMasterSymbolByName_(n);
  return fromMaster || normalizeTwSymbol_(symbol);
}

function findStockMasterSymbolByName_(name) {
  const n = String(name || "").trim();
  if (!n) return "";

  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const sheet = ss.getSheetByName(SHEETS.STOCK_MASTER);
  if (!sheet || sheet.getLastRow() < 2) return "";

  const range = sheet.getDataRange();
  const values = range.getValues();
  const displayValues = range.getDisplayValues();
  const headers = values[0].map(h => String(h).trim());
  const symbolIdx = headers.indexOf("symbol");
  const nameIdx = headers.indexOf("name");
  if (symbolIdx < 0 || nameIdx < 0) return "";

  for (let i = 1; i < values.length; i++) {
    const rowName = String(values[i][nameIdx] || displayValues[i][nameIdx] || "").trim();
    if (rowName !== n) continue;

    const symbol = getSymbolCellValue_(values, displayValues, i, symbolIdx);
    if (symbol) return symbol;
  }

  return "";
}

function repairSymbolCodes() {
  const result = repairSymbolCodes_();
  calculateAllAnalysis();
  return result;
}

function repairOfficialEtfSymbols() {
  return repairSymbolCodes();
}

function repairSymbolCodes_() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  let changed = 0;
  const details = [];

  Object.keys(HEADERS).forEach(sheetName => {
    const sheet = ss.getSheetByName(sheetName);
    if (!sheet || sheet.getLastRow() < 2) return;

    const range = sheet.getDataRange();
    const values = range.getValues();
    const displayValues = range.getDisplayValues();
    const header = values[0].map(h => String(h).trim());
    const symbolIdx = header.indexOf("symbol");
    if (symbolIdx < 0) return;

    const nameIdx = header.indexOf("name");
    const typeIdx = header.indexOf("type");
    let sheetChanged = 0;

    for (let r = 1; r < values.length; r++) {
      const rawBefore = normalizeTwSymbol_(values[r][symbolIdx]);
      const before = getSymbolCellValue_(values, displayValues, r, symbolIdx);
      const name = nameIdx >= 0 ? values[r][nameIdx] : "";
      const type = typeIdx >= 0 ? values[r][typeIdx] : "";
      const after = recoverTwSymbolByName_(before, name);
      if (before && after && (before !== after || rawBefore !== after)) {
        values[r][symbolIdx] = after;
        changed++;
        sheetChanged++;
      }
    }

    if (sheetChanged > 0) {
      formatSymbolColumn_(sheet, header);
      sheet.getRange(1, 1, values.length, values[0].length).setValues(values);
      protectSymbolCells_(sheet, header, 2, values.slice(1));
      details.push(sheetName + ": " + sheetChanged);
    }
  });

  applySymbolTextFormats_();
  SpreadsheetApp.flush();

  return {
    ok: true,
    message: "股票代號修正完成",
    changed: changed,
    details: details,
    hint: "股票代號只做文字化與 trim，不會自動補零或互轉。"
  };
}

/**
 * 第一次請手動執行這個函式。
 * 會建立所有需要的 Sheet。v10.1 起不再自動寫入範例資料。
 */
function setupDatabase() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();

  Object.keys(HEADERS).forEach(sheetName => {
    const sheet = getOrCreateSheet_(ss, sheetName);
    ensureHeader_(sheet, HEADERS[sheetName]);
  });

  applySymbolTextFormats_();
  repairSymbolCodes_();
  calculateAllAnalysis();
  refreshDashboardCache_();
}

function buildStockMaster() {
  return buildStockMaster_();
}

function buildStockMaster_() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const sheet = getOrCreateSheet_(ss, SHEETS.STOCK_MASTER);
  ensureHeader_(sheet, HEADERS.StockMaster);

  const updatedAt = formatDateTime_(new Date());
  const map = {};

  getSheetObjects_(SHEETS.STOCK_MASTER).forEach(r => {
    const symbol = normalizeOfficialTwSymbol_(r.symbol, r.name);
    if (!symbol) return;
    map[symbol] = {
      symbol: symbol,
      name: String(r.name || "").trim(),
      market: "TW",
      currency: "TWD",
      type: String(r.type || inferStockType_(symbol, r.name)).trim() || "stock",
      source: String(r.source || "manual").trim(),
      updatedAt: r.updatedAt || updatedAt
    };
  });

  const loaders = [
    { source: "TWSE", fn: () => fetchTwseStockMasterRows_() },
    { source: "TPEX", fn: () => fetchTpexStockMasterRows_() }
  ];

  let fetched = 0;
  loaders.forEach(loader => {
    try {
      loader.fn().forEach(r => {
        const symbol = normalizeOfficialTwSymbol_(r.symbol, r.name);
        if (!symbol || !r.name) return;
        fetched++;
        map[symbol] = {
          symbol: symbol,
          name: String(r.name || "").trim(),
          market: "TW",
          currency: "TWD",
          type: inferStockType_(symbol, r.name),
          source: loader.source,
          updatedAt: updatedAt
        };
      });
    } catch (err) {
      // 保留既有 StockMaster，不因單一來源失敗而清空。
    }
  });

  const rows = Object.values(map)
    .sort((a, b) => String(a.symbol).localeCompare(String(b.symbol)))
    .map(r => HEADERS.StockMaster.map(key => r[key] === undefined ? "" : r[key]));

  writeSheet_(sheet, HEADERS.StockMaster, rows);

  return {
    ok: true,
    message: "StockMaster 已建立",
    count: rows.length,
    fetched: fetched,
    updatedAt: updatedAt
  };
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
 * 清除舊版 setupDatabase() 放入的範例資料。
 * 若首頁看起來還是模擬資料，請手動執行一次 clearDemoData()。
 */
function clearDemoData() {
  const result = clearDemoData_();
  calculateAllAnalysis();
  return result;
}

function clearDemoData_() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const result = {
    marketIndexRemoved: 0,
    pricesRemoved: 0,
    transactionsRemoved: 0
  };

  result.marketIndexRemoved = removeRowsByPredicate_(SHEETS.MARKET_INDEX, row => {
    const symbol = String(row.symbol || '').trim();
    const date = normalizeMarketDate_(row.date, '');
    const close = toNumber_(row.close);

    // v1~v5 的範例大盤可能卡在首頁：23,520 / 260.5。
    // 不限定日期，避免 2026 範例資料比真實資料日期新而蓋過首頁。
    if (symbol === 'TAIEX' && close === 23520) return true;
    if (symbol === 'OTC' && close === 260.5) return true;

    // 舊版 setupDatabase 的固定日期範例。
    if (date === '2026-07-09' && (symbol === 'TAIEX' || symbol === 'OTC')) return true;
    if (date === '2020-01-01' && symbol === 'TAIEX' && close === 12000) return true;
    if (date === '2020-01-01' && symbol === 'OTC' && close === 150) return true;

    return false;
  });

  result.transactionsRemoved = removeRowsByPredicate_(SHEETS.TRANSACTIONS, row => {
    return String(row.id || '').indexOf('T_SAMPLE_') === 0;
  });

  // v1~v3 範例價格固定是 2330 / 2317 / 006208，日期從 2026-03-20 開始連續 80 天。
  // 真實台股不會週末也有每日資料，所以這裡只清掉舊版範例，避免壓過真實回補資料。
  const demoSymbols = new Set(['2330', '2317', '006208', '6208']);
  result.pricesRemoved = removeRowsByPredicate_(SHEETS.PRICES, row => {
    const symbol = String(row.symbol || '').trim();
    const date = normalizeMarketDate_(row.date, '');
    if (!demoSymbols.has(symbol)) return false;
    if (date >= '2026-03-20' && date <= '2026-06-20') return true;
    if (date >= '2020-01-01' && date <= '2020-03-31') return true;
    return false;
  });

  SpreadsheetApp.flush();
  return result;
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
  const demoCleanup = clearDemoData_();

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
  const cacheResult = safeRefreshDashboardCache_();

  return {
    ok: true,
    message: "歷史資料回補完成",
    months: months,
    symbols: targets.map(t => t.symbol),
    fetched: allRows.length,
    inserted: upsertResult.inserted,
    updated: upsertResult.updated,
    details: details,
    demoCleanup: demoCleanup,
    cache: cacheResult,
    updatedAt: formatDateTime_(new Date())
  };
}

function getBackfillTargets_(symbolsText) {
  const requested = String(symbolsText || "")
    .split(/[\s,，;；]+/)
    .map(s => normalizeSymbolCode_(s.trim(), "", ""))
    .filter(Boolean);

  const requestedSet = new Set(requested);
  const map = {};

  function add(row) {
    const symbol = normalizeSymbolCode_(row.symbol, row.name, row.type);
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
  return updateDailyClosePricesOnly_(params || {});
}

function updateDailyClosePricesOnly_(params) {
  params = params || {};
  checkToken_(params.token || "");
  const demoCleanup = clearDemoData_();

  const targetDate = params.date ? new Date(params.date) : new Date();
  const targets = getBackfillTargets_(params.symbols || params.symbol || "");
  const targetSymbols = new Set(targets.map(t => t.symbol).filter(Boolean));

  if (targetSymbols.size === 0) {
    throw new Error("沒有可更新的股票，請先新增關注股票、庫存或交易紀錄");
  }

  const candidates = getRecentDateCandidates_(targetDate, 10);
  let selectedDate = "";
  let allPriceRows = [];
  let marketResult = null;
  const errors = [];

  for (let i = 0; i < candidates.length; i++) {
    const d = candidates[i];
    let rows = [];

    try {
      const twseRows = fetchTwseDailyPrices_(d, targetSymbols);
      rows = rows.concat(twseRows);
    } catch (err) {
      errors.push(formatDate_(d) + " TWSE: " + err.message);
    }

    try {
      const tpexRows = fetchTpexDailyPrices_(d, targetSymbols);
      rows = rows.concat(tpexRows);
    } catch (err) {
      errors.push(formatDate_(d) + " TPEX: " + err.message);
    }

    rows = rows.filter(r => r && r.symbol && isFinite(Number(r.close)) && Number(r.close) > 0);

    if (rows.length > 0) {
      allPriceRows = rows;
      selectedDate = getLatestDateFromPriceRows_(rows) || formatDate_(d);
      break;
    }
  }

  if (allPriceRows.length === 0) {
    const message = "最近 10 天沒有抓到關注股票的盤後資料" +
      (errors.length ? "；錯誤：" + errors.slice(0, 3).join("；") : "");

    const lastRun = {
      ok: false,
      version: APP_VERSION,
      mode: "daily-close-only",
      message: message,
      startedAt: params.startedAt || "",
      finishedAt: formatDateTime_(new Date()),
      errors: errors
    };

    writeDashboardCache_("lastRun", lastRun);
    safeRefreshDashboardCache_();
    throw new Error(message);
  }

  const upsertResult = upsertPrices_(allPriceRows);

  try {
    marketResult = updateTwseMarketIndex_(new Date(selectedDate));
  } catch (err) {
    marketResult = {
      ok: false,
      message: err.message
    };
  }

  calculateAllAnalysis();

  const result = {
    ok: true,
    version: APP_VERSION,
    mode: "daily-close-only",
    message: "盤後收盤資料更新完成",
    requestedDate: formatDate_(targetDate),
    dataDate: selectedDate,
    targetCount: targetSymbols.size,
    fetched: allPriceRows.length,
    inserted: upsertResult.inserted,
    updated: upsertResult.updated,
    marketIndex: marketResult,
    demoCleanup: demoCleanup,
    errors: errors.slice(0, 5),
    updatedAt: formatDateTime_(new Date())
  };

  writeDashboardCache_("lastRun", result);
  const cacheResult = refreshDashboardCache_();
  result.cache = {
    ok: true,
    updatedAt: cacheResult.updatedAt,
    dataDate: cacheResult.dataDate
  };
  writeDashboardCache_("lastRun", result);
  return result;
}

function getLatestDateFromPriceRows_(rows) {
  const dates = rows
    .map(r => normalizeMarketDate_(r.date, ""))
    .filter(Boolean)
    .sort();

  return dates.length ? dates[dates.length - 1] : "";
}

function updateLatestBySymbolHistory_(params) {
  params = params || {};
  checkToken_(params.token || "");
  const demoCleanup = clearDemoData_();

  const targetDate = params.date ? new Date(params.date) : new Date();
  const dateForSheet = formatDate_(targetDate);

  // v7 重要修正：
  // 不再抓整個 TWSE / TPEX 全市場大型 JSON。
  // 改成只針對 Stocks / Watchlist / Transactions / Portfolio 裡的股票，
  // 用「單一股票月資料」抓最近一筆盤後資料。
  // 這可以避開大型 JSON 偶發截斷造成的：
  // Unterminated string in JSON at position ...
  const targets = getBackfillTargets_(params.symbols || params.symbol || "");

  if (targets.length === 0) {
    throw new Error("沒有可更新的股票。請先在 Stocks 或 Watchlist 加入股票代號。");
  }

  const allRows = [];
  const details = [];
  const errors = [];

  targets.forEach(target => {
    try {
      const row = fetchLatestDailyPriceForTarget_(target, targetDate);
      if (row) {
        allRows.push(row);
        details.push({
          symbol: target.symbol,
          name: row.name || target.name || "",
          market: row.market || target.market || "",
          date: row.date,
          close: row.close,
          ok: true
        });
      } else {
        errors.push(target.symbol + "：沒有抓到最近盤後資料");
      }

      // 避免短時間對官方站台送太多請求。
      Utilities.sleep(120);
    } catch (err) {
      errors.push(target.symbol + "：" + err.message);
      details.push({
        symbol: target.symbol,
        name: target.name || "",
        market: target.market || "",
        ok: false,
        message: err.message
      });
    }
  });

  if (allRows.length === 0) {
    throw new Error("沒有抓到任何價格資料。" + (errors.length ? " 錯誤：" + errors.slice(0, 5).join("；") : ""));
  }

  const upsertResult = upsertPrices_(allRows);

  // 大盤資料單獨更新。若大盤失敗，不阻擋個股更新。
  let marketResult;
  try {
    marketResult = updateTwseMarketIndex_(targetDate);
  } catch (err) {
    marketResult = {
      ok: false,
      skipped: true,
      message: err.message
    };
  }

  calculateAllAnalysis();
  const cacheResult = safeRefreshDashboardCache_();

  return {
    ok: true,
    message: "盤後資料更新完成",
    version: APP_VERSION,
    mode: "per-symbol-history",
    date: dateForSheet,
    targets: targets.length,
    fetched: allRows.length,
    inserted: upsertResult.inserted,
    updated: upsertResult.updated,
    details: details,
    errors: errors.slice(0, 10),
    marketIndex: marketResult,
    demoCleanup: demoCleanup,
    cache: cacheResult,
    updatedAt: formatDateTime_(new Date())
  };
}

function fetchLatestDailyPriceForTarget_(target, targetDate) {
  const months = getRecentMonthCandidates_(targetDate, 2);
  const marketText = String(target.market || "").toUpperCase();

  let marketOrder;
  if (marketText.indexOf("OTC") >= 0 || marketText.indexOf("TPEX") >= 0 || marketText.indexOf("上櫃") >= 0) {
    marketOrder = ["TPEX", "TWSE"];
  } else if (marketText.indexOf("上市") >= 0 || marketText === "TWSE") {
    marketOrder = ["TWSE", "TPEX"];
  } else {
    // 未填市場時，先試上市，再試上櫃。
    marketOrder = ["TWSE", "TPEX"];
  }

  const allErrors = [];

  for (let m = 0; m < marketOrder.length; m++) {
    const market = marketOrder[m];
    const rows = [];

    for (let i = 0; i < months.length; i++) {
      try {
        const monthRows = market === "TWSE"
          ? fetchTwseHistoricalMonth_(target, months[i])
          : fetchTpexHistoricalMonth_(target, months[i]);

        monthRows.forEach(r => rows.push(r));
      } catch (err) {
        allErrors.push(market + " " + formatDate_(months[i]).slice(0, 7) + " " + err.message);
      }
    }

    const latest = chooseLatestRowOnOrBefore_(rows, targetDate);
    if (latest) return latest;
  }

  if (allErrors.length) {
    throw new Error(allErrors.slice(0, 3).join("；"));
  }

  return null;
}

function chooseLatestRowOnOrBefore_(rows, targetDate) {
  if (!rows || rows.length === 0) return null;

  const end = new Date(targetDate);
  end.setHours(23, 59, 59, 999);

  return rows
    .filter(r => r && r.date && isFinite(Number(r.close)) && Number(r.close) > 0)
    .filter(r => new Date(r.date).getTime() <= end.getTime())
    .sort((a, b) => new Date(b.date) - new Date(a.date))[0] || null;
}

function getRecentMonthCandidates_(date, count) {
  const result = [];
  const base = new Date(date);
  base.setDate(1);

  for (let i = 0; i < count; i++) {
    const d = new Date(base);
    d.setMonth(base.getMonth() - i);
    result.push(d);
  }

  return result;
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
    const symbolRaw = pickValue_(item, ["Code", "證券代號", "代號", "code", "stockNo"]);
    if (!symbolRaw) return;
    const name = pickValue_(item, ["Name", "證券名稱", "名稱", "name"]);
    const symbol = normalizeSymbolCode_(symbolRaw, name, "");
    if (CONFIG.FETCH_ONLY_MY_SYMBOLS && targetSymbols.size > 0 && !targetSymbols.has(symbol)) return;
    const rowDate = pickValue_(item, ["Date", "日期", "TradeDate", "資料日期", "date"]);
    const open = parseMarketNumber_(pickValue_(item, ["OpeningPrice", "Open", "開盤價", "開盤"]));
    const high = parseMarketNumber_(pickValue_(item, ["HighestPrice", "High", "最高價", "最高"]));
    const low = parseMarketNumber_(pickValue_(item, ["LowestPrice", "Low", "最低價", "最低"]));
    const close = parseMarketNumber_(pickValue_(item, ["ClosingPrice", "Close", "收盤價", "收盤"]));
    const volume = parseMarketNumber_(pickValue_(item, ["TradeVolume", "TradingShares", "成交股數", "成交量", "Volume"]));

    if (!isFinite(close) || close <= 0) return;

    output.push({
      date: rowDate ? normalizeMarketDate_(rowDate, dateForSheet) : dateForSheet,
      symbol: symbol,
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

function fetchTwseStockMasterRows_() {
  const json = fetchJson_(CONFIG.TWSE_STOCK_DAY_ALL_URL);
  const rows = Array.isArray(json) ? json : [];
  return rows.map(item => {
    const symbol = pickValue_(item, ["Code", "證券代號", "代號", "code", "stockNo"]);
    const name = pickValue_(item, ["Name", "證券名稱", "名稱", "name"]);
    return {
      symbol: normalizeOfficialTwSymbol_(symbol, name),
      name: String(name || "").trim()
    };
  }).filter(r => r.symbol && r.name);
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
    const symbolRaw = pickValue_(item, ["SecuritiesCompanyCode", "SecuritiesCode", "Code", "代號", "有價證券代號", "code"]);
    if (!symbolRaw) return;
    const name = pickValue_(item, ["CompanyName", "Name", "名稱", "有價證券名稱", "name"]);
    const symbol = normalizeSymbolCode_(symbolRaw, name, "");
    if (CONFIG.FETCH_ONLY_MY_SYMBOLS && targetSymbols.size > 0 && !targetSymbols.has(symbol)) return;
    const rowDate = pickValue_(item, ["Date", "資料日期", "date"]);
    const open = parseMarketNumber_(pickValue_(item, ["Open", "OpeningPrice", "開盤", "開盤價"]));
    const high = parseMarketNumber_(pickValue_(item, ["High", "HighestPrice", "最高", "最高價"]));
    const low = parseMarketNumber_(pickValue_(item, ["Low", "LowestPrice", "最低", "最低價"]));
    const close = parseMarketNumber_(pickValue_(item, ["Close", "ClosingPrice", "收盤", "收盤價"]));
    const volume = parseMarketNumber_(pickValue_(item, ["TradingShares", "TradeVolume", "成交股數", "成交量", "Volume"]));

    if (!isFinite(close) || close <= 0) return;

    output.push({
      date: rowDate ? normalizeMarketDate_(rowDate, fallbackDate) : fallbackDate,
      symbol: symbol,
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

function fetchTpexStockMasterRows_() {
  const rocDate = toRocDate_(new Date());
  const url = CONFIG.TPEX_DAILY_CLOSE_URL + "?l=zh-tw&d=" + encodeURIComponent(rocDate) + "&s=0,asc,0";
  const json = fetchJson_(url);
  const rows = Array.isArray(json) ? json : [];
  return rows.map(item => {
    const symbol = pickValue_(item, ["SecuritiesCompanyCode", "SecuritiesCode", "Code", "代號", "有價證券代號", "code"]);
    const name = pickValue_(item, ["CompanyName", "Name", "名稱", "有價證券名稱", "name"]);
    return {
      symbol: normalizeOfficialTwSymbol_(symbol, name),
      name: String(name || "").trim()
    };
  }).filter(r => r.symbol && r.name);
}

function inferStockType_(symbol, name) {
  const s = String(symbol || "").trim();
  const n = String(name || "").trim().toUpperCase();
  if (s.indexOf("00") === 0 || n.indexOf("ETF") >= 0 || n.indexOf("ETN") >= 0 || n.indexOf("台50") >= 0 || n.indexOf("高股息") >= 0) {
    return "ETF";
  }
  return "stock";
}

/**
 * 更新 TAIEX 加權指數。
 * 使用 TWSE MI_INDEX JSON endpoint，若官方欄位變動，會回傳 skipped，不影響個股更新。
 */
function updateTwseMarketIndex_(targetDate) {
  const candidates = getRecentDateCandidates_(targetDate, 14);
  let lastMessage = '';

  // type=IND 是指數資料，type=ALL 有時欄位太多導致解析不穩。
  // 兩個都試，避免官方資料格式調整時大盤不更新。
  const types = ['IND', 'ALL'];

  for (let i = 0; i < candidates.length; i++) {
    const d = candidates[i];

    for (let t = 0; t < types.length; t++) {
      const type = types[t];

      try {
        const url = CONFIG.TWSE_MI_INDEX_URL + '?response=json&date=' + toTwseDate_(d) + '&type=' + type;
        const json = fetchJson_(url);
        const found = findTaiexRow_(json);

        if (!found) {
          lastMessage = '沒有找到 TAIEX 欄位：' + formatDate_(d) + ' type=' + type;
          continue;
        }

        const parsed = parseTaiexRow_(found);
        if (!parsed || !isFinite(parsed.close) || parsed.close <= 0) {
          lastMessage = 'TAIEX 數值解析失敗：' + formatDate_(d) + ' type=' + type;
          continue;
        }

        upsertMarketIndex_([{
          date: formatDate_(d),
          symbol: 'TAIEX',
          name: '加權指數',
          close: parsed.close,
          change: isFinite(parsed.change) ? parsed.change : '',
          changePercent: isFinite(parsed.changePercent) ? parsed.changePercent : '',
          volume: isFinite(parsed.volume) ? parsed.volume : ''
        }]);

        return {
          ok: true,
          symbol: 'TAIEX',
          date: formatDate_(d),
          close: parsed.close,
          triedDays: i + 1,
          type: type
        };
      } catch (err) {
        lastMessage = err.message;
      }
    }
  }

  return {
    ok: false,
    skipped: true,
    message: lastMessage || '沒有抓到 TAIEX 大盤資料'
  };
}

function findTaiexRow_(json) {
  const rows = [];

  function collect(value) {
    if (!value) return;

    if (Array.isArray(value)) {
      if (value.length > 0 && !Array.isArray(value[0]) && typeof value[0] !== 'object') {
        rows.push(value);
        return;
      }

      value.forEach(collect);
      return;
    }

    if (typeof value === 'object') {
      Object.keys(value).forEach(k => collect(value[k]));
    }
  }

  collect(json);

  for (let i = 0; i < rows.length; i++) {
    const first = stripHtml_(rows[i][0] || '');
    if (first.indexOf('發行量加權股價指數') >= 0 || first.toUpperCase().indexOf('TAIEX') >= 0) {
      return rows[i];
    }
  }

  return null;
}

function parseTaiexRow_(row) {
  // 常見 row：名稱、指數、漲跌符號、漲跌點數、漲跌百分比...
  const clean = row.map(stripHtml_);
  const close = parseMarketNumber_(clean[1]);

  let change = NaN;
  let changePercent = NaN;
  let volume = NaN;

  for (let i = 2; i < clean.length; i++) {
    const value = parseMarketNumber_(clean[i]);
    if (!isFinite(value)) continue;

    if (!isFinite(change)) {
      change = value;
      const signText = clean.slice(Math.max(0, i - 2), i + 1).join('');
      if (signText.indexOf('-') >= 0 || signText.indexOf('▼') >= 0 || signText.indexOf('下跌') >= 0) {
        change = -Math.abs(change);
      }
      continue;
    }

    if (!isFinite(changePercent) && Math.abs(value) <= 20) {
      changePercent = value;
      continue;
    }

    if (!isFinite(volume) && Math.abs(value) > 1000000) {
      volume = value;
    }
  }

  return { close: close, change: change, changePercent: changePercent, volume: volume };
}

function getRecentDateCandidates_(date, days) {
  const result = [];
  const base = date instanceof Date ? new Date(date) : new Date(date);
  for (let i = 0; i < days; i++) {
    const d = new Date(base);
    d.setDate(base.getDate() - i);
    result.push(d);
  }
  return result;
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
    const symbol = normalizeSymbolCode_(r.symbol, r.name, r.type);
    const key = date + "|" + symbol;
    map[key] = {
      date: date,
      symbol: symbol,
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
    const symbol = normalizeSymbolCode_(r.symbol, r.name, r.type);
    const key = date + "|" + symbol;
    if (map[key]) updated++;
    else inserted++;

    map[key] = {
      date: date,
      symbol: symbol,
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
    const symbol = normalizeSymbolCode_(r.symbol, r.name, r.type);
    const key = date + "|" + symbol;
    map[key] = {
      date: date,
      symbol: symbol,
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
    if (r.symbol) set.add(normalizeSymbolCode_(r.symbol, r.name, r.type));
  });

  getSheetObjects_(SHEETS.WATCHLIST).forEach(r => {
    if (r.enabled === false || String(r.enabled).toUpperCase() === "FALSE") return;
    if (r.symbol) set.add(normalizeSymbolCode_(r.symbol, r.name, r.type));
  });

  getSheetObjects_(SHEETS.PORTFOLIO).forEach(r => {
    if (r.symbol) set.add(normalizeSymbolCode_(r.symbol, r.name, r.type));
  });

  return set;
}

function fetchJson_(url) {
  const response = UrlFetchApp.fetch(url, {
    method: "get",
    muteHttpExceptions: true,
    followRedirects: true,
    headers: {
      "User-Agent": "Mozilla/5.0 AppsScript StockLab"
    }
  });

  const status = response.getResponseCode();
  let text = response.getContentText("UTF-8");

  if (status < 200 || status >= 300) {
    throw new Error("HTTP " + status + "：" + String(text).slice(0, 200));
  }

  text = String(text || "").replace(/^\uFEFF/, "").trim();

  if (!text) {
    throw new Error("官方資料回傳空白內容");
  }

  if (text[0] === "<") {
    throw new Error("官方資料回傳 HTML，不是 JSON：" + text.slice(0, 120));
  }

  try {
    return JSON.parse(text);
  } catch (err) {
    // v7 防護：少數大型 OpenAPI 回應偶發截斷時，會出現
    // Unterminated string in JSON at position ...
    // 目前 updateDailyPrices 已改用單股月資料，通常不會再遇到。
    // 這裡仍保留錯誤訊息，方便追蹤是哪個資料源壞掉。
    throw new Error(
      "JSON 解析失敗：" + err.message +
      "；URL=" + url +
      "；內容長度=" + text.length +
      "；前 120 字=" + text.slice(0, 120)
    );
  }
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
  if (value === null || value === undefined || value === '') return NaN;
  if (typeof value === 'number') return value;

  const raw = stripHtml_(value);
  const negative = raw.indexOf('-') >= 0 || raw.indexOf('▼') >= 0 || raw.indexOf('下跌') >= 0;
  const s = raw
    .replace(/,/g, '')
    .replace(/\+/g, '')
    .replace(/X/g, '')
    .replace(/--/g, '')
    .replace(/％/g, '')
    .replace(/%/g, '')
    .replace(/[▲▼漲跌下上]/g, '')
    .replace(/[^0-9.\-]/g, '')
    .trim();

  if (!s || s === '-' || s === '.' || raw === '除權息' || raw === '除息' || raw === '除權') return NaN;

  let n = Number(s);
  if (!isFinite(n)) return NaN;
  if (negative && n > 0) n = -n;
  return n;
}

function stripHtml_(value) {
  return String(value || '')
    .replace(/<[^>]*>/g, '')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .trim();
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
  if (value instanceof Date && !isNaN(value.getTime())) {
    return formatDate_(value);
  }

  const s = String(value || "").trim();
  if (!s) return fallbackDate;

  // Google Sheets can expose dates as strings like "Fri Jul 10 2026 ...".
  const parsedDate = new Date(s);
  if (!isNaN(parsedDate.getTime()) && /[A-Za-z]{3}/.test(s)) {
    return formatDate_(parsedDate);
  }

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
    } else if (action === "deleteTransaction") {
      result = deleteTransaction_(params);
    } else if (action === "lookupStock") {
      result = lookupStock_(params.symbol || "");
    } else if (action === "addWatchlist") {
      result = addWatchlist_(params);
    } else if (action === "removeWatchlist") {
      result = removeWatchlistRows_(params);
    } else if (action === "updateDailyPrices") {
      result = updateDailyPrices_(params);
    } else if (action === "backfillHistoricalPrices") {
      result = backfillHistoricalPrices_(params);
    } else if (action === "clearDemoData") {
      checkToken_(params.token || "");
      result = clearDemoData_();
      calculateAllAnalysis();
      result.cache = safeRefreshDashboardCache_();
      result.ok = true;
      result.message = "範例資料已清除";
    } else if (action === "debugStatus") {
      result = debugStatus_();
    } else if (action === "repairSymbolCodes") {
      checkToken_(params.token || "");
      result = repairSymbolCodes();
    } else if (action === "buildStockMaster") {
      checkToken_(params.token || "");
      result = buildStockMaster_();
    } else if (action === "calculateAllAnalysis") {
      checkToken_(params.token || "");
      calculateAllAnalysis();
      result = { ok: true, message: "重新計算完成", updatedAt: formatDateTime_(new Date()) };
    } else if (action === "buildDashboardCache") {
      checkToken_(params.token || "");
      result = buildDashboardCache_();
    } else if (action === "createDailyCloseTrigger") {
      checkToken_(params.token || "");
      result = createDailyCloseTrigger();
    } else if (action === "deleteDailyCloseTriggers") {
      checkToken_(params.token || "");
      result = deleteDailyCloseTriggers();
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
  const cached = getDashboardCache_();
  if (cached) return cached;

  return buildDashboardResponseFromSheets_();
}

function buildDashboardResponseFromSheets_() {
  const watchlist = getEnabledWatchlist_();
  const latestIndicators = getLatestIndicatorsMap_();
  const priceTrendMap = getRecentCloseTrendMap_(30);

  const watchlistRows = watchlist.map(w => {
    const ind = latestIndicators[w.symbol] || {};
    return {
      symbol: w.symbol,
      name: w.name,
      market: w.market,
      close: ind.close || '',
      rsi14: ind.rsi14 || '',
      volumeRatio: ind.volumeRatio || '',
      totalScore: ind.totalScore || '',
      riskScore: ind.riskScore || '',
      trendText: ind.trendText || '觀察',
      signalSummary: ind.signalSummary || '',
      sparkline: priceTrendMap[w.symbol] || [],
      trend: priceTrendMap[w.symbol] || []
    };
  });

  const bullishCount = watchlistRows.filter(x => toNumber_(x.totalScore) >= 75).length;
  const riskCount = watchlistRows.filter(x => {
    const text = String(x.trendText || '');
    const riskScore = toNumber_(x.riskScore);
    return text.indexOf('偏弱') >= 0 || (isFinite(riskScore) && riskScore > 0 && riskScore < 50);
  }).length;

  let marketRows = getLatestMarketRows_();

  // 如果 MarketIndex 沒有任何真實大盤資料，嘗試即時補抓一次 TAIEX。
  // 這可以避免清掉範例資料後首頁完全沒有大盤卡片。
  if (false && !marketRows.some(r => r.symbol === 'TAIEX')) {
    try {
      updateTwseMarketIndex_(new Date());
      marketRows = getLatestMarketRows_();
    } catch (err) {
      // dashboard 不因大盤抓取失敗而整頁失敗。
    }
  }

  marketRows.push({
    symbol: 'BULL',
    name: '關注股偏多',
    close: bullishCount,
    change: '',
    changePercent: watchlistRows.length ? round_(bullishCount / watchlistRows.length * 100, 2) : 0,
    volume: '',
    date: formatDate_(new Date()),
    trend: []
  });
  marketRows.push({
    symbol: 'RISK',
    name: '風險提醒',
    close: riskCount,
    change: '',
    changePercent: watchlistRows.length ? round_(riskCount / watchlistRows.length * 100, 2) : 0,
    volume: '',
    date: formatDate_(new Date()),
    trend: []
  });

  const lastRun = readDashboardCacheFromSheet_("lastRun") || {};
  const latestDataDate = getLatestMarketOrPriceDate_();
  const fallbackDataDate = normalizeMarketDate_(lastRun.dataDate, "");
  const dataDate = latestDataDate || fallbackDataDate || "";

  return {
    ok: true,
    version: APP_VERSION,
    updatedAt: formatDateTime_(new Date()),
    dataDate: dataDate,
    lastRun: lastRun,
    market: marketRows,
    watchlist: watchlistRows
  };
}

function getLatestMarketRows_() {
  const rows = getSheetObjects_(SHEETS.MARKET_INDEX)
    .filter(r => r.symbol && r.date)
    .filter(r => !isDemoMarketRow_(r))
    .sort((a, b) => new Date(a.date) - new Date(b.date));

  const map = {};
  rows.forEach(r => {
    const symbol = String(r.symbol).trim();
    map[symbol] = r;
  });

  const preferred = ['TAIEX', 'OTC'];
  const result = [];

  preferred.forEach(symbol => {
    if (map[symbol]) result.push(normalizeMarketCard_(map[symbol]));
  });

  Object.keys(map).sort().forEach(symbol => {
    if (preferred.indexOf(symbol) >= 0) return;
    result.push(normalizeMarketCard_(map[symbol]));
  });

  return result;
}

function getDashboardCache_() {
  const cached = getCachedJson_("dashboard");
  if (cached) return cached;

  const sheetData = readDashboardCacheFromSheet_("dashboard");
  if (sheetData) {
    putCachedJson_("dashboard", sheetData, 300);
    return sheetData;
  }

  return null;
}

function buildDashboardCache() {
  return buildDashboardCache_();
}

function buildDashboardCache_() {
  const dashboard = buildDashboardResponseFromSheets_();
  writeDashboardCache_("dashboard", dashboard);
  putCachedJson_("dashboard", dashboard, 300);

  const portfolio = buildPortfolioCache_();
  const versionInfo = {
    ok: true,
    version: APP_VERSION,
    updatedAt: dashboard.updatedAt,
    dataDate: dashboard.dataDate
  };
  writeDashboardCache_("version", versionInfo);
  putCachedJson_("version", versionInfo, 300);

  return {
    ok: true,
    version: APP_VERSION,
    updatedAt: dashboard.updatedAt,
    dataDate: dashboard.dataDate,
    dashboard: dashboard,
    portfolio: portfolio
  };
}

function buildPortfolioCache_() {
  const items = getSheetObjects_(SHEETS.PORTFOLIO);
  const data = {
    ok: true,
    version: APP_VERSION,
    updatedAt: formatDateTime_(new Date()),
    items: items
  };
  writeDashboardCache_("portfolio", data);
  putCachedJson_("portfolio", data, 300);
  return data;
}

function refreshDashboardCache_() {
  clearAppCache_();
  return buildDashboardCache_();
}

function safeRefreshDashboardCache_() {
  try {
    return refreshDashboardCache_();
  } catch (err) {
    return {
      ok: false,
      message: err && err.message ? err.message : String(err)
    };
  }
}

function getCachedJson_(key) {
  try {
    const cache = CacheService.getScriptCache();
    const raw = cache.get(key);
    return raw ? JSON.parse(raw) : null;
  } catch (err) {
    return null;
  }
}

function putCachedJson_(key, data, seconds) {
  try {
    CacheService.getScriptCache().put(key, JSON.stringify(data), seconds || 300);
  } catch (err) {}
}

function clearAppCache_() {
  try {
    const cache = CacheService.getScriptCache();
    cache.remove("dashboard");
    cache.remove("portfolio");
    cache.remove("version");
  } catch (err) {}
}

function readDashboardCacheFromSheet_(key) {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const sheet = ss.getSheetByName(SHEETS.DASHBOARD_CACHE);
  if (!sheet || sheet.getLastRow() < 2) return null;

  const values = sheet.getDataRange().getValues();
  const headers = values[0].map(h => String(h).trim());
  const keyIdx = headers.indexOf("key");
  const jsonIdx = headers.indexOf("json");
  if (keyIdx < 0 || jsonIdx < 0) return null;

  for (let i = 1; i < values.length; i++) {
    if (String(values[i][keyIdx] || "").trim() !== key) continue;
    const raw = String(values[i][jsonIdx] || "").trim();
    if (!raw) return null;
    try {
      return JSON.parse(raw);
    } catch (err) {
      return null;
    }
  }

  return null;
}

function writeDashboardCache_(key, data) {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const sheet = getOrCreateSheet_(ss, SHEETS.DASHBOARD_CACHE);
  ensureHeader_(sheet, HEADERS.DashboardCache);

  const values = sheet.getDataRange().getValues();
  const headers = values[0].map(h => String(h).trim());
  const keyIdx = headers.indexOf("key");
  let rowIndex = -1;

  for (let i = 1; i < values.length; i++) {
    if (String(values[i][keyIdx] || "").trim() === key) {
      rowIndex = i + 1;
      break;
    }
  }

  const rowObject = {
    key: key,
    json: JSON.stringify(data),
    updatedAt: formatDateTime_(new Date())
  };
  const row = headers.map(h => rowObject[h] === undefined ? "" : rowObject[h]);

  if (rowIndex > 0) {
    writeDataRow_(sheet, headers, rowIndex, row);
  } else {
    appendDataRow_(sheet, headers, row);
  }
}

function getLatestMarketOrPriceDate_() {
  const dates = [];
  [SHEETS.MARKET_INDEX, SHEETS.PRICES, SHEETS.INDICATORS].forEach(sheetName => {
    getSheetObjects_(sheetName).forEach(row => {
      const date = normalizeMarketDate_(row.date, "");
      if (date) dates.push(date);
    });
  });

  return dates.sort().pop() || "";
}

function createDailyCloseTrigger() {
  deleteDailyCloseTriggers();

  ScriptApp.newTrigger("runDailyCloseUpdate")
    .timeBased()
    .everyDays(1)
    .atHour(20)
    .create();

  return {
    ok: true,
    version: APP_VERSION,
    message: "Daily close trigger created",
    hour: 20
  };
}

function deleteDailyCloseTriggers() {
  const triggers = ScriptApp.getProjectTriggers();
  let deleted = 0;

  triggers.forEach(trigger => {
    if (trigger.getHandlerFunction() === "runDailyCloseUpdate") {
      ScriptApp.deleteTrigger(trigger);
      deleted++;
    }
  });

  return {
    ok: true,
    version: APP_VERSION,
    deleted: deleted
  };
}

function runDailyCloseUpdate() {
  const startedAt = formatDateTime_(new Date());

  try {
    const result = updateDailyClosePricesOnly_({
      token: CONFIG.API_TOKEN || "",
      date: new Date(),
      startedAt: startedAt
    });

    const lastRun = {
      ok: true,
      version: APP_VERSION,
      mode: "daily-close-only",
      message: "每日盤後更新完成",
      startedAt: startedAt,
      finishedAt: formatDateTime_(new Date()),
      dataDate: result.dataDate,
      result: result
    };

    writeDashboardCache_("lastRun", lastRun);
    safeRefreshDashboardCache_();
    return lastRun;
  } catch (err) {
    const lastRun = {
      ok: false,
      version: APP_VERSION,
      mode: "daily-close-only",
      message: err.message,
      stack: err.stack,
      startedAt: startedAt,
      finishedAt: formatDateTime_(new Date())
    };

    writeDashboardCache_("lastRun", lastRun);
    safeRefreshDashboardCache_();
    return lastRun;
  }
}

function normalizeMarketCard_(m) {
  return {
    symbol: String(m.symbol || '').trim(),
    name: String(m.name || m.symbol || '').trim(),
    close: toNumber_(m.close),
    change: toNumber_(m.change),
    changePercent: toNumber_(m.changePercent),
    volume: toNumber_(m.volume),
    date: normalizeMarketDate_(m.date, ''),
    trend: []
  };
}

function isDemoMarketRow_(r) {
  const symbol = String(r.symbol || '').trim();
  const date = normalizeMarketDate_(r.date, '');
  const close = toNumber_(r.close);
  return (symbol === 'TAIEX' && close === 23520) ||
    (symbol === 'OTC' && close === 260.5) ||
    (date === '2026-07-09' && (symbol === 'TAIEX' || symbol === 'OTC'));
}

/**
 * 庫存頁資料
 */
function getPortfolio_() {
  const cached = getCachedJson_("portfolio");
  if (cached) return cached;

  const items = calculatePortfolio_();
  const data = {
    ok: true,
    version: APP_VERSION,
    updatedAt: formatDateTime_(new Date()),
    items: items
  };
  writeDashboardCache_("portfolio", data);
  putCachedJson_("portfolio", data, 300);
  return data;
}

/**
 * 技術分析頁資料
 */
function getAnalysis_(symbol) {
  symbol = normalizeTwSymbol_(symbol);

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

function lookupStock_(symbol) {
  const normalized = normalizeTwSymbol_(symbol);
  if (!normalized) {
    return {
      ok: false,
      message: "查無股票代號，請確認是否為台股代號"
    };
  }

  let stock = findStockMasterStock_(normalized);
  if (stock) return { ok: true, stock: stock };

  refreshStockMasterFromApi();
  stock = findStockMasterStock_(normalized);
  if (stock) return { ok: true, stock: stock };

  return {
    ok: false,
    message: "查無股票代號，請確認是否為台股代號"
  };
}

function refreshStockMasterFromApi() {
  return buildStockMaster_();
}

function fallbackStock_(symbol, name) {
  const normalized = normalizeOfficialTwSymbol_(symbol, name);
  if (!normalized) return null;

  return {
    symbol: normalized,
    name: String(name || "").trim(),
    market: "TW",
    currency: "TWD",
    type: inferStockType_(normalized, name)
  };
}

function findStockMasterStock_(symbol) {
  const normalized = normalizeTwSymbol_(symbol);
  if (!normalized) return null;

  const row = getSheetObjects_(SHEETS.STOCK_MASTER)
    .find(r => normalizeTwSymbol_(r.symbol) === normalized && String(r.name || "").trim());

  if (!row) return null;

  const officialSymbol = normalizeOfficialTwSymbol_(row.symbol, row.name);

  return {
    symbol: officialSymbol,
    name: String(row.name || "").trim(),
    market: "TW",
    currency: "TWD",
    type: String(row.type || inferStockType_(officialSymbol, row.name)).trim() || "stock"
  };
}

function addWatchlist_(params) {
  checkToken_(params.token || "");

  const lookedUp = lookupStock_(params.symbol || "");
  const fallback = fallbackStock_(params.symbol || "", params.name || "");
  if (!lookedUp.ok && !fallback) return lookedUp;

  const stock = lookedUp.ok ? lookedUp.stock : fallback;
  const lookupWarning = lookedUp.ok ? "" : String(lookedUp.message || "");
  const now = formatDateTime_(new Date());
  upsertStock_(stock, now);

  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const sheet = getOrCreateSheet_(ss, SHEETS.WATCHLIST);
  ensureHeader_(sheet, HEADERS.Watchlist);

  const range = sheet.getDataRange();
  const values = range.getValues();
  const displayValues = range.getDisplayValues();
  const headers = values[0].map(h => String(h).trim());
  const symbolIdx = headers.indexOf("symbol");
  const nameIdx = headers.indexOf("name");
  let rowIndex = -1;

  for (let i = 1; i < values.length; i++) {
    const symbol = getSymbolCellValue_(values, displayValues, i, symbolIdx);
    const name = nameIdx >= 0 ? values[i][nameIdx] : "";
    if (symbol === stock.symbol || recoverTwSymbolByName_(symbol, name) === stock.symbol) {
      rowIndex = i + 1;
      break;
    }
  }

  const existing = rowIndex > 0 ? rowToObject_(headers, sheet.getRange(rowIndex, 1, 1, headers.length).getValues()[0]) : {};
  const rowObject = Object.assign({}, existing, {
    symbol: stock.symbol,
    name: stock.name || existing.name || String(params.name || "").trim(),
    market: "TW",
    currency: "TWD",
    type: stock.type || existing.type || inferStockType_(stock.symbol, stock.name || existing.name),
    note: String(params.note || "").trim(),
    target_price: params.target_price === undefined ? "" : params.target_price,
    alert_price: params.alert_price === undefined ? "" : params.alert_price,
    enabled: true,
    createdAt: existing.createdAt || now,
    updatedAt: now
  });

  const row = headers.map(key => rowObject[key] === undefined ? "" : rowObject[key]);
  if (rowIndex > 0) {
    writeDataRow_(sheet, headers, rowIndex, row);
  } else {
    appendDataRow_(sheet, headers, row);
  }

  applySymbolTextFormats_();

  const shouldBackfill = String(params.backfill || "").toLowerCase() === "true";
  let backfillResult = null;
  let backfillWarning = "";
  if (shouldBackfill) {
    try {
      backfillResult = backfillHistoricalPrices_({ months: 12, symbols: stock.symbol, token: params.token || "" });
    } catch (err) {
      backfillWarning = err && err.message ? err.message : String(err);
    }
  }

  let analysisWarning = "";
  try {
    calculateAllAnalysis();
  } catch (err) {
    analysisWarning = err && err.message ? err.message : String(err);
  }
  const cacheResult = safeRefreshDashboardCache_();

  return {
    ok: true,
    message: backfillWarning ? "已加入關注股票，歷史回補稍後可手動執行" : "已加入關注股票",
    stock: stock,
    backfill: backfillResult,
    cache: cacheResult,
    warning: [lookupWarning, backfillWarning, analysisWarning].filter(Boolean).join(" / ")
  };
}

function removeWatchlist_(params) {
  checkToken_(params.token || "");

  const targetSymbol = normalizeTwSymbol_(params.symbol || "");
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const sheet = getOrCreateSheet_(ss, SHEETS.WATCHLIST);
  ensureHeader_(sheet, HEADERS.Watchlist);

  if (!targetSymbol) {
    return { ok: false, message: "找不到關注股票" };
  }

  if (sheet.getLastRow() < 2) {
    return { ok: false, message: "找不到關注股票" };
  }

  const range = sheet.getDataRange();
  const values = range.getValues();
  const displayValues = range.getDisplayValues();
  const headers = values[0].map(h => String(h).trim());
  const symbolIdx = headers.indexOf("symbol");
  const nameIdx = headers.indexOf("name");
  const enabledIdx = headers.indexOf("enabled");
  const updatedAtIdx = headers.indexOf("updatedAt");

  for (let i = 1; i < values.length; i++) {
    const symbol = getSymbolCellValue_(values, displayValues, i, symbolIdx);
    const name = nameIdx >= 0 ? values[i][nameIdx] : "";
    if (!symbolsMatchForWatchlist_(symbol, name, targetSymbol)) continue;

    sheet.getRange(i + 1, enabledIdx + 1).setValue(false);
    if (updatedAtIdx >= 0) sheet.getRange(i + 1, updatedAtIdx + 1).setValue(formatDateTime_(new Date()));
    return {
      ok: true,
      message: "已移除關注股票"
    };
  }

  return {
    ok: false,
    message: "找不到關注股票"
  };
}

/**
 * 新增交易
 * MVP 為了 GitHub Pages 方便，先支援 JSONP GET 寫入。
 */
function removeWatchlistRows_(params) {
  checkToken_(params.token || "");

  const targetSymbol = normalizeTwSymbol_(params.symbol || "");
  const targetName = String(params.name || "").trim();

  if (!targetSymbol) {
    return { ok: false, message: "請提供股票代號" };
  }

  const watchlistDeleted = deleteSymbolRows_(SHEETS.WATCHLIST, HEADERS.Watchlist, targetSymbol, targetName);
  const stocksDeleted = deleteSymbolRows_(SHEETS.STOCKS, HEADERS.Stocks, targetSymbol, targetName);

  if (watchlistDeleted + stocksDeleted <= 0) {
    return { ok: false, message: "找不到可刪除的關注股票" };
  }

  calculateAllAnalysis();
  const cacheResult = safeRefreshDashboardCache_();

  return {
    ok: true,
    message: "已從資料庫刪除關注股票",
    deleted: watchlistDeleted,
    stocksDeleted: stocksDeleted,
    cache: cacheResult
  };
}

function deleteSymbolRows_(sheetName, expectedHeaders, targetSymbol, targetName) {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const sheet = getOrCreateSheet_(ss, sheetName);
  ensureHeader_(sheet, expectedHeaders);

  if (sheet.getLastRow() < 2) return 0;

  const range = sheet.getDataRange();
  const values = range.getValues();
  const displayValues = range.getDisplayValues();
  const headers = values[0].map(h => String(h).trim());
  const symbolIdx = headers.indexOf("symbol");
  const nameIdx = headers.indexOf("name");
  const rowsToDelete = [];

  for (let i = 1; i < values.length; i++) {
    const symbol = getSymbolCellValue_(values, displayValues, i, symbolIdx);
    const name = nameIdx >= 0 ? values[i][nameIdx] : "";
    if (symbolsMatchForWatchlist_(symbol, name, targetSymbol, targetName)) {
      rowsToDelete.push(i + 1);
    }
  }

  rowsToDelete.reverse().forEach(rowIndex => sheet.deleteRow(rowIndex));
  return rowsToDelete.length;
}

function addTransaction_(params) {
  checkToken_(params.token || "");

  const lookedUp = lookupStock_(params.symbol || "");
  const fallback = fallbackStock_(params.symbol || "", params.name || "");
  if (!lookedUp.ok && !fallback) return lookedUp;
  const stock = lookedUp.ok ? lookedUp.stock : fallback;

  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const sheet = getOrCreateSheet_(ss, SHEETS.TRANSACTIONS);
  ensureHeader_(sheet, HEADERS.Transactions);
  formatSymbolColumn_(sheet, HEADERS.Transactions);

  const id = "T" + Utilities.formatDate(new Date(), Session.getScriptTimeZone(), "yyyyMMddHHmmss") + Math.floor(Math.random() * 1000);

  const row = [
    id,
    params.date || formatDate_(new Date()),
    String(params.tradeAction || params.tx_action || params.action || "BUY").toUpperCase(),
    stock.symbol,
    stock.name,
    "TW",
    toNumber_(params.quantity),
    toNumber_(params.price),
    toNumber_(params.fee),
    toNumber_(params.tax),
    "TWD",
    String(params.note || "").trim(),
    formatDateTime_(new Date())
  ];

  if (!row[3]) throw new Error("symbol 不可空白");
  if (!row[6]) throw new Error("quantity 不可空白");
  if (row[7] === "" || isNaN(row[7])) throw new Error("price 不可空白");

  appendDataRow_(sheet, HEADERS.Transactions, row);
  const now = formatDateTime_(new Date());
  upsertStock_(stock, now);
  const portfolioItems = calculatePortfolio_();
  const portfolioItem = portfolioItems.find(item => String(item.symbol || "").trim() === stock.symbol) || null;
  const cacheResult = safeRefreshDashboardCache_();

  return {
    ok: true,
    message: "新增成功",
    id: id,
    stock: stock,
    portfolio: portfolioItem,
    cache: cacheResult
  };
}

function deleteTransaction_(params) {
  checkToken_(params.token || "");

  const id = String(params.id || "").trim();
  if (!id) return { ok: false, message: "交易 id 不可空白" };

  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const sheet = getOrCreateSheet_(ss, SHEETS.TRANSACTIONS);
  ensureHeader_(sheet, HEADERS.Transactions);

  if (sheet.getLastRow() < 2) {
    return { ok: false, message: "找不到交易紀錄" };
  }

  const values = sheet.getDataRange().getValues();
  const headers = values[0].map(h => String(h).trim());
  const idIdx = headers.indexOf("id");

  for (let i = 1; i < values.length; i++) {
    if (String(values[i][idIdx] || "").trim() !== id) continue;
    sheet.deleteRow(i + 1);
    calculateAllAnalysis();
    const cacheResult = safeRefreshDashboardCache_();
    return {
      ok: true,
      message: "已刪除交易紀錄",
      id: id,
      cache: cacheResult
    };
  }

  return { ok: false, message: "找不到交易紀錄" };
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
 * v10.1 起保留此函式只為了相容舊呼叫，不再寫入範例資料。
 */
function seedSampleData_() {
  return {
    ok: true,
    skipped: true,
    message: "Sample data seeding is disabled in v10.1"
  };
}

function removeRowsByPredicate_(sheetName, predicate) {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const sheet = ss.getSheetByName(sheetName);
  if (!sheet || sheet.getLastRow() < 2) return 0;

  const values = sheet.getDataRange().getValues();
  const headers = values[0].map(h => String(h).trim());
  const keep = [values[0]];
  let removed = 0;

  values.slice(1).forEach(row => {
    const obj = {};
    headers.forEach((h, i) => obj[h] = row[i]);

    if (predicate(obj)) {
      removed += 1;
    } else {
      keep.push(row);
    }
  });

  sheet.clearContents();
  sheet.getRange(1, 1, 1, headers.length).setValues([keep[0]]);
  sheet.setFrozenRows(1);
  formatSymbolColumn_(sheet, headers);
  if (keep.length > 1) {
    const rows = keep.slice(1);
    sheet.getRange(2, 1, rows.length, headers.length).setValues(rows);
    protectSymbolCells_(sheet, headers, 2, rows);
  }
  return removed;
}

/**
 * 工具：讀取 Sheet 為物件陣列
 */
function getSheetObjects_(sheetName) {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const sheet = ss.getSheetByName(sheetName);
  if (!sheet || sheet.getLastRow() < 2) return [];

  const range = sheet.getDataRange();
  const values = range.getValues();
  const displayValues = range.getDisplayValues();
  const headers = values[0].map(h => String(h).trim());
  const symbolIdx = headers.indexOf("symbol");

  return values.slice(1).filter(row => row.some(cell => cell !== "")).map((row, offset) => {
    const obj = {};
    headers.forEach((h, i) => {
      obj[h] = i === symbolIdx ? getSymbolCellValue_(values, displayValues, offset + 1, symbolIdx) : row[i];
    });
    if (obj.symbol !== undefined) {
      obj.symbol = normalizeSymbolCode_(obj.symbol, obj.name, obj.type);
    }
    return obj;
  });
}

function getEnabledWatchlist_() {
  return getSheetObjects_(SHEETS.WATCHLIST)
    .filter(r => r.enabled === true || String(r.enabled).toUpperCase() === "TRUE" || r.enabled === "");
}

function upsertStock_(stock, now) {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const sheet = getOrCreateSheet_(ss, SHEETS.STOCKS);
  ensureHeader_(sheet, HEADERS.Stocks);

  const range = sheet.getDataRange();
  const values = range.getValues();
  const displayValues = range.getDisplayValues();
  const headers = values[0].map(h => String(h).trim());
  const symbolIdx = headers.indexOf("symbol");
  const nameIdx = headers.indexOf("name");
  let rowIndex = -1;

  for (let i = 1; i < values.length; i++) {
    const symbol = getSymbolCellValue_(values, displayValues, i, symbolIdx);
    const name = nameIdx >= 0 ? values[i][nameIdx] : "";
    if (symbol === stock.symbol || recoverTwSymbolByName_(symbol, name) === stock.symbol) {
      rowIndex = i + 1;
      break;
    }
  }

  const existing = rowIndex > 0 ? rowToObject_(headers, sheet.getRange(rowIndex, 1, 1, headers.length).getValues()[0]) : {};
  const rowObject = Object.assign({}, existing, {
    symbol: stock.symbol,
    name: stock.name || existing.name || "",
    market: "TW",
    currency: "TWD",
    type: stock.type || existing.type || inferStockType_(stock.symbol, stock.name || existing.name),
    enabled: true,
    updatedAt: now
  });

  const row = headers.map(key => rowObject[key] === undefined ? "" : rowObject[key]);
  if (rowIndex > 0) {
    writeDataRow_(sheet, headers, rowIndex, row);
  } else {
    appendDataRow_(sheet, headers, row);
  }
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
  formatSymbolColumn_(sheet, headers);
  if (rows.length > 0) {
    sheet.getRange(2, 1, rows.length, headers.length).setValues(rows);
    protectSymbolCells_(sheet, headers, 2, rows);
  }
  applySymbolTextFormats_();
  sheet.autoResizeColumns(1, headers.length);
}

function ensureHeader_(sheet, headers) {
  if (!sheet) throw new Error("Sheet 不存在");
  if (sheet.getLastRow() === 0) {
    sheet.getRange(1, 1, 1, headers.length).setValues([headers]);
    sheet.setFrozenRows(1);
    return;
  }

  const current = sheet.getRange(1, 1, 1, Math.max(sheet.getLastColumn(), 1)).getValues()[0]
    .map(h => String(h).trim())
    .filter(h => h !== "");
  const missing = headers.filter(h => current.indexOf(h) < 0);
  if (missing.length > 0) {
    sheet.getRange(1, current.length + 1, 1, missing.length).setValues([missing]);
    sheet.setFrozenRows(1);
  }
}

function getOrCreateSheet_(ss, name) {
  let sheet = ss.getSheetByName(name);
  if (!sheet) sheet = ss.insertSheet(name);
  return sheet;
}

function rowToObject_(headers, row) {
  const obj = {};
  headers.forEach((h, i) => obj[h] = row[i]);
  return obj;
}


function debugStatus_() {
  const marketRows = getSheetObjects_(SHEETS.MARKET_INDEX)
    .filter(r => r.symbol)
    .sort((a, b) => new Date(b.date) - new Date(a.date))
    .slice(0, 10)
    .map(r => ({
      date: normalizeMarketDate_(r.date, ''),
      symbol: String(r.symbol || '').trim(),
      name: String(r.name || '').trim(),
      close: toNumber_(r.close),
      isDemo: isDemoMarketRow_(r)
    }));

  return {
    ok: true,
    version: APP_VERSION,
    time: formatDateTime_(new Date()),
    apiBase: 'Apps Script Web App 已回應',
    marketRows: marketRows,
    message: '如果 GitHub Pages 還顯示 23,520，但這裡不是 23,520，代表前端仍在使用模擬 fallback 或舊部署快取。'
  };
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
