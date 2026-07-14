const Mock = {
  dashboard: {
    ok: false,
    updatedAt: "API 未連線",
    market: [],
    watchlist: [],
    message: "尚未取得真實資料。請確認 js/config.js 的 API_BASE_URL 已填入最新 Apps Script Web App URL，並且 GitHub Pages 已重新部署。"
  },
  candidates: {
    ok: false,
    buyCandidates: [],
    sellCandidates: []
  },
  paper: { ok: false, strategies: [], positions: [], trades: [], performance: [] },
  backtest: { ok: false, trades: [], equityCurve: [], bySymbol: [] },
  portfolio: {
    ok: false,
    items: []
  },
  analysis: {
    ok: false,
    symbol: "",
    name: "",
    portfolio: {},
    latest: {},
    prices: [],
    signals: []
  },
  transactions: {
    ok: false,
    items: []
  }
};

const pages = {
  dashboard: {
    title: "首頁總覽",
    subtitle: "盤後大盤、關注股票與技術訊號",
    loader: loadDashboard
  },
  candidates: {
    title: "候選清單",
    subtitle: "依最新盤後資料產生下一交易日觀察",
    loader: loadCandidates
  },
  paper: {
    title: "虛擬交易",
    subtitle: "選擇技術指標模型進行 Paper Trading 模擬",
    loader: loadPaperSummary
  },
  backtest: {
    title: "策略回測",
    subtitle: "用相同歷史行情比較不同策略模型",
    loader: loadBacktestRuns
  },
  portfolio: {
    title: "我的庫存",
    subtitle: "成本、損益與技術狀態",
    loader: loadPortfolio
  },
  analysis: {
    title: "線圖分析",
    subtitle: "收盤價、平均成本與可勾選技術線",
    loader: () => {
      const symbol = normalizeSymbolInput(document.getElementById("analysisSymbol").value);
      if (symbol) loadAnalysis(symbol);
    }
  },
  transactions: {
    title: "交易紀錄",
    subtitle: "新增買進、賣出與股息",
    loader: loadTransactions
  }
};

const CACHE_KEYS = {
  dashboard: "stocklab_cache_dashboard_v115",
  transactions: "stocklab_cache_transactions_v2"
};
const STRATEGY_MODELS_FALLBACK = [
  {
    strategyType: "PERSISTENT_MOMENTUM_V2",
    strategyName: "持續動能波段策略",
    riskLevel: "中等",
    bestFor: "大盤多方、連續轉強 2 至 4 週的個股",
    description: "要求報酬具有持續性、均線向上且大盤同步多方，排除單日暴衝的假動能。",
    buySummary: "大盤站上 MA20，個股 MA5 > MA20 > MA60，20 日正報酬且 10 日至少 6 日上漲。",
    sellSummary: "跌破趨勢、回撤 4%、停損 5%，或持有滿 20 個交易日。"
  },
  {
    strategyType: "TREND_PULLBACK_V2",
    strategyName: "多頭回檔確認策略",
    riskLevel: "中低",
    bestFor: "一個月內的多頭回檔反彈",
    description: "只在大盤與中期趨勢向上時，等待價格回到 MA20 附近且 KD 重新轉強。",
    buySummary: "MA20 向上且高於 MA60，價格靠近 MA20、RSI 42 至 58、KD 偏多。",
    sellSummary: "跌破 MA60、停損 4.5%、回撤 3.5%，或持有滿 15 個交易日。"
  },
  {
    strategyType: "CONFIRMED_BREAKOUT_V2",
    strategyName: "確認突破短波段策略",
    riskLevel: "中高",
    bestFor: "帶量突破前 20 日高點、預計持有 1 至 3 週",
    description: "使用不含當日的前 20 日高點，配合量能、ADX 與上漲持續度確認突破。",
    buySummary: "收盤突破前 20 日高點、量比至少 1.2，且趨勢強度與大盤方向一致。",
    sellSummary: "突破失敗、回撤 4%、停損 5%，或持有滿 15 個交易日。"
  },
  {
    strategyType: "OVERSOLD_REBOUND_V2",
    strategyName: "多頭超賣反彈策略",
    riskLevel: "中等",
    bestFor: "大盤仍偏多、個股短線急跌後的 1 至 2 週反彈",
    description: "只接中期多頭內的短線超賣，要求 KD 與 MACD 柱狀體開始改善。",
    buySummary: "MA20 高於 MA60，價格守住 MA60，RSI 與布林進入超賣區後開始轉強。",
    sellSummary: "反彈回 MA20、RSI 達 60、停損 3.5%，或持有滿 10 個交易日。"
  },
  {
    strategyType: "ETF_TREND_V2",
    strategyName: "ETF 月線趨勢策略",
    riskLevel: "低",
    bestFor: "0050、006208 等低波動 ETF 的一個月波段",
    description: "以大盤、月線斜率、20 日報酬與低 ATR 判斷 ETF 趨勢，減少過度交易。",
    buySummary: "大盤與 ETF 同步多方、MA20 向上、20 日報酬溫和且 ATR 偏低。",
    sellSummary: "月線轉弱、回撤 2.5%、停損 3%，或持有滿 20 個交易日。"
  },
  {
    strategyType: "BUY_HOLD_BASELINE_V1",
    strategyName: "買進持有基準",
    riskLevel: "基準",
    bestFor: "判斷策略是否真的勝過同期間持有標的",
    description: "在第一個可交易訊號後買進並持有至區間結束。",
    buySummary: "第一個可交易訊號後次日開盤買進。",
    sellSummary: "回測區間結束時賣出。"
  },
  {
    strategyType: "CASH_WAIT_BASELINE_V1",
    strategyName: "現金觀望基準",
    riskLevel: "最低",
    bestFor: "判斷這段期間空手是否勝過進場策略",
    description: "回測比較用基準模型，不買進任何標的，報酬固定接近 0%。",
    buySummary: "永不買進，用來衡量市場是否不值得交易。",
    sellSummary: "無持倉。"
  }
];
let strategyModels = STRATEGY_MODELS_FALLBACK.slice();
let strategyModelsLoaded = false;
const STRATEGY_CHART_COLORS = ["#38bdf8", "#22c55e", "#f59e0b", "#f472b6", "#a78bfa", "#14b8a6", "#fb7185", "#84cc16", "#eab308", "#94a3b8", "#22d3ee", "#cbd5e1"];
const analysisMemoryCache = new Map();
const analysisRequests = new Map();
const ANALYSIS_LINE_OPTIONS = [
  { key: "ma5", label: "MA5", color: "#f97316", default: false },
  { key: "ma20", label: "MA20", color: "#38bdf8", default: true },
  { key: "ma60", label: "MA60", color: "#a78bfa", default: false },
  { key: "bbUpper", label: "布林上軌", color: "#f472b6", default: false, dash: "7 6" },
  { key: "bbLower", label: "布林下軌", color: "#f472b6", default: false, dash: "7 6" },
  { key: "high20", label: "20日高", color: "#eab308", default: false, dash: "5 5" },
  { key: "low20", label: "20日低", color: "#14b8a6", default: false, dash: "5 5" },
  { key: "ema20", label: "EMA20", color: "#fb7185", default: false },
  { key: "vwap20", label: "VWAP20", color: "#84cc16", default: false },
  { key: "superTrend", label: "SuperTrend", color: "#f59e0b", default: false, dash: "6 4" },
  { key: "donchianHigh20", label: "Donchian 上緣", color: "#eab308", default: false, dash: "3 4" },
  { key: "donchianLow20", label: "Donchian 下緣", color: "#14b8a6", default: false, dash: "3 4" }
];
const analysisLineState = Object.fromEntries(ANALYSIS_LINE_OPTIONS.map(option => [option.key, option.default === true]));
let activeAnalysisSymbol = "";
let currentDashboardData = null;
let activeAnalysisData = null;
let currentCandidateData = Mock.candidates;
let currentBacktestResults = [];
let activeBacktestStrategyType = "";
let topHistoricalBacktestStrategyType = "";
let runtimeBackendVersion = "";
let currentWatchlistItems = [];
const watchlistSortState = { key: "", direction: "asc" };

document.addEventListener("DOMContentLoaded", () => {
  setAppVersionLabel();
  loadBackendVersion();
  detectDeviceMode();
  window.addEventListener("resize", detectDeviceMode);
  setupStrategyModelSelectors();

  document.querySelectorAll(".nav-btn").forEach(btn => {
    btn.addEventListener("click", () => changePage(btn.dataset.page));
  });

  document.getElementById("btnLoadAnalysis").addEventListener("click", () => {
    const symbol = normalizeSymbolInput(document.getElementById("analysisSymbol").value);
    if (!symbol) {
      setApiStatus("請先輸入股票代號");
      return;
    }
    loadAnalysis(symbol);
  });

  document.getElementById("btnRefreshAnalysis").addEventListener("click", () => {
    const symbol = normalizeSymbolInput(document.getElementById("analysisSymbol").value);
    if (!symbol) {
      setApiStatus("請先輸入股票代號");
      return;
    }
    loadAnalysis(symbol, true);
  });
  renderAnalysisLineControls();
  document.getElementById("analysisLineControls").addEventListener("change", onAnalysisLineToggle);

  document.getElementById("candidateSort").addEventListener("change", () => {
    renderCandidates(currentCandidateData);
  });
  document.getElementById("paperStrategyForm").addEventListener("submit", onCreatePaperStrategy);
  document.getElementById("btnRunPaper").addEventListener("click", onRunPaperTrading);
  document.getElementById("paperStrategies").addEventListener("change", onTogglePaperStrategy);
  document.getElementById("backtestForm").addEventListener("submit", onRunBacktest);
  document.getElementById("backtestComparisonBody").addEventListener("click", onBacktestComparisonClick);

  document.getElementById("btnUpdateDaily").addEventListener("click", onUpdateDailyPrices);
  document.getElementById("btnBackfillHistory").addEventListener("click", openBackfillSheet);
  document.getElementById("btnRefreshVersion").addEventListener("click", refreshAppVersion);
  document.getElementById("btnToggleWatchForm").addEventListener("click", toggleWatchForm);
  document.getElementById("btnEmptyAddWatch").addEventListener("click", () => toggleWatchForm(true));
  document.getElementById("watchlistForm").addEventListener("submit", onSubmitWatchlist);
  document.addEventListener("click", onDocumentClick);

  document.getElementById("transactionForm").addEventListener("submit", onSubmitTransaction);
  document.getElementById("backfillForm").addEventListener("submit", onBackfillHistoricalPrices);

  const dateInput = document.querySelector("input[name='date']");
  if (dateInput) dateInput.valueAsDate = new Date();
  const backtestEnd = document.getElementById("backtestEndDate");
  const backtestStart = document.getElementById("backtestStartDate");
  if (backtestEnd) backtestEnd.valueAsDate = new Date();
  if (backtestStart) { const start = new Date(); start.setMonth(start.getMonth() - 6); backtestStart.valueAsDate = start; }

  setApiStatus();
  loadDashboard();
});


function detectDeviceMode() {
  const isMobile = window.matchMedia("(max-width: 760px), (pointer: coarse)").matches;
  document.body.classList.toggle("device-mobile", isMobile);
  document.body.classList.toggle("device-desktop", !isMobile);
}


async function onUpdateDailyPrices() {
  const btn = document.getElementById("btnUpdateDaily");
  if (!Api.isConfigured()) {
    setApiStatus("尚未設定 API_BASE_URL，無法更新真實資料");
    return;
  }

  btn.disabled = true;
  const oldText = btn.textContent;
  btn.textContent = "更新中...";
  setApiStatus("正在抓取 TWSE / TPEX 盤後資料");

  try {
    const result = await Api.updateDailyPrices();
    invalidateFrontendQuoteCaches();
    const marketText = result.marketIndex && result.marketIndex.ok
      ? `，加權 ${result.marketIndex.close}`
      : `，大盤未更新：${(result.marketIndex && result.marketIndex.message) || "未知原因"}`;
    const stale = (result.staleSymbols || []).concat(result.unresolvedSymbols || []);
    const staleText = stale.length ? `，${stale.length} 檔今日尚無資料：${stale.slice(0, 6).join(", ")}` : "";
    await loadDashboard();
    const derivedText = result.derivedSchedule && result.derivedSchedule.ok
      ? "，技術指標背景更新中"
      : "";
    const successText = `更新完成：資料日期 ${result.dataDate || "待背景確認"}，新增 ${result.inserted || 0}，覆寫 ${result.updated || 0}${marketText}${staleText}${derivedText}`;
    setApiStatus(successText);
    showToast(successText, "success");
  } catch (err) {
    const errorText = "更新失敗：" + err.message;
    setApiStatus(errorText);
    showToast(errorText, "error");
  } finally {
    btn.disabled = false;
    btn.textContent = oldText;
  }
}


async function onBackfillHistoricalPrices(event) {
  event.preventDefault();
  const btn = document.getElementById("btnBackfillHistory");
  const form = event.currentTarget;
  const submitButton = form.querySelector('button[type="submit"]');
  const message = document.getElementById("backfillMessage");
  if (!Api.isConfigured()) {
    message.textContent = "尚未設定 API_BASE_URL，無法回補歷史資料";
    return;
  }

  const data = Object.fromEntries(new FormData(form).entries());
  const months = Number(data.months || 12);
  if (!Number.isFinite(months) || months <= 0) {
    message.textContent = "回補月份格式錯誤";
    return;
  }
  const normalizedSymbols = normalizeSymbolListInput(data.symbols || "");

  btn.disabled = true;
  submitButton.disabled = true;
  const oldText = btn.textContent;
  btn.textContent = "回補中...";
  submitButton.textContent = "回補中...";
  message.textContent = "正在讀取官方歷史資料，請勿關閉頁面";
  setApiStatus(`正在回補最近 ${months} 個月歷史資料`);

  try {
    const result = await Api.backfillHistoricalPrices(months, normalizedSymbols);
    invalidateFrontendQuoteCaches();
    const resultText = `回補完成：抓到 ${result.fetched || 0} 筆，新增 ${result.inserted || 0}，更新 ${result.updated || 0}`;
    setApiStatus(resultText);
    showToast(resultText, "success");
    message.textContent = resultText;
    await loadDashboard();
  } catch (err) {
    const errorText = "回補失敗：" + err.message;
    setApiStatus(errorText);
    showToast(errorText, "error");
    message.textContent = errorText;
  } finally {
    btn.disabled = false;
    submitButton.disabled = false;
    btn.textContent = oldText;
    submitButton.textContent = "開始回補";
  }
}

async function refreshAppVersion() {
  showToast("正在重新載入最新版...");
  try {
    clearPageMemoryCache();
    Object.keys(localStorage).forEach(key => {
      if (key.startsWith("stocklab_")) localStorage.removeItem(key);
    });

    if ("serviceWorker" in navigator) {
      const registrations = await navigator.serviceWorker.getRegistrations();
      await Promise.all(registrations.map(registration => registration.update().catch(() => null)));
    }
  } catch (error) {
    console.warn("refresh version cleanup failed", error);
  }
  reloadWithVersionStamp();
}

function reloadWithVersionStamp() {
  const url = new URL(window.location.href);
  url.searchParams.set("v", Date.now().toString());
  window.location.replace(url.toString());
}

function setApiStatus(message) {
  const el = document.getElementById("apiStatus");
  if (message) {
    el.textContent = message;
    return;
  }

  el.textContent = Api.isConfigured() ? "已設定 API" : "未設定 API，無法取得真實資料";
}

function readCache(key) {
  try {
    const raw = localStorage.getItem(key);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    return parsed && parsed.data ? parsed.data : null;
  } catch (err) {
    return null;
  }
}

function writeCache(key, data) {
  try {
    localStorage.setItem(key, JSON.stringify({
      savedAt: Date.now(),
      data
    }));
  } catch (err) {
    // localStorage 可能被瀏覽器限制；失敗時不影響主要流程。
  }
}

function clearCache(key) {
  try {
    localStorage.removeItem(key);
  } catch (err) {
    // Ignore localStorage cleanup errors.
  }
}

function invalidateFrontendQuoteCaches() {
  analysisMemoryCache.clear();
  pageDataCache.dashboard = null;
  pageDataCache.portfolio = null;
  pageDataCache.candidates = null;
  pageDataCache.candidateLeaderboard = null;
  pageDataCache.marketSummary = null;
  pageDataCache.strategyHealth = null;
  pageDataCache.stats = null;
  pageDataCache.analysis = {};
  pageDataCache.stockDetail = {};
  clearCache(CACHE_KEYS.dashboard);
}

function clearPageMemoryCache() {
  analysisMemoryCache.clear();
  analysisRequests.clear();
  Object.keys(pageDataCache).forEach(key => {
    pageDataCache[key] = key === "analysis" || key === "stockDetail" ? {} : null;
  });
}

function getAppVersion() {
  return typeof APP_VERSION === "undefined" ? "v11.5" : APP_VERSION;
}

function setAppVersionLabel() {
  const el = document.getElementById("appVersion");
  if (el) el.textContent = "前端 " + getAppVersion();
  setBackendVersionLabel("");
}

function setBackendVersionLabel(version) {
  const el = document.getElementById("backendVersion");
  if (!el) return;
  const backendVersion = String(version || "").trim();
  const frontendVersion = getAppVersion();
  el.classList.remove("is-pending", "is-match", "is-mismatch");

  if (!backendVersion) {
    el.textContent = "後端 尚未確認";
    el.classList.add("is-pending");
    el.title = "等待 Dashboard API 回傳後端版本";
    return;
  }

  const matches = backendVersion === frontendVersion;
  el.textContent = "後端 " + backendVersion + (matches ? "" : " · 版本不一致");
  el.classList.add(matches ? "is-match" : "is-mismatch");
  el.title = matches
    ? "前後端版本一致"
    : "前端為 " + frontendVersion + "，目前 Web App 後端為 " + backendVersion;
}

async function loadBackendVersion() {
  if (!Api.isConfigured() || typeof Api.getBackendVersion !== "function") return;
  try {
    const data = await Api.getBackendVersion();
    if (!data || data.ok !== true || !data.version) return;
    runtimeBackendVersion = String(data.version).trim();
    setBackendVersionLabel(runtimeBackendVersion);
  } catch (err) {
    // Dashboard version remains available as a fallback for older deployments.
  }
}

function getCachedDashboard() {
  return readCache(CACHE_KEYS.dashboard);
}

function saveDashboardCache(data) {
  writeCache(CACHE_KEYS.dashboard, data);
}

function getCachedTransactions() {
  return readCache(CACHE_KEYS.transactions);
}

function saveTransactionsCache(data) {
  writeCache(CACHE_KEYS.transactions, data);
}

function addCachedTransaction(item) {
  const cached = getCachedTransactions() || { ok: true, items: [] };
  cached.items = [item].concat(cached.items || []);
  pageDataCache.transactions = cached;
  saveTransactionsCache(cached);
  renderTransactions(cached.items);
}

function removeCachedTransaction(id) {
  const cached = getCachedTransactions();
  if (!cached) return;
  cached.items = (cached.items || []).filter(item => String(item.id || "") !== String(id));
  pageDataCache.transactions = cached;
  saveTransactionsCache(cached);
  renderTransactions(cached.items);
}

function replaceCachedTransaction(id, nextItem) {
  const cached = pageDataCache.transactions || getCachedTransactions() || { ok: true, items: [] };
  cached.items = (cached.items || []).map(item => String(item.id || "") === String(id) ? Object.assign({}, item, nextItem) : item);
  pageDataCache.transactions = cached;
  saveTransactionsCache(cached);
  renderTransactions(cached.items);
}

function upsertCachedWatchlistItem(item) {
  const cached = getCachedDashboard() || { ok: true, market: [], watchlist: [] };
  const symbol = String(item.symbol || "").trim();
  const list = (cached.watchlist || []).filter(row => String(row.symbol || "").trim() !== symbol);
  cached.watchlist = [item].concat(list);
  pageDataCache.dashboard = cached;
  saveDashboardCache(cached);
  renderDashboard(cached);
}

function replaceCachedWatchlistItem(symbol, nextItem) {
  const cached = getCachedDashboard();
  if (!cached) return;
  const target = String(symbol || "").trim();
  cached.watchlist = (cached.watchlist || []).map(item => {
    if (String(item.symbol || "").trim() !== target) return item;
    return Object.assign({}, item, nextItem, { pending: false });
  });
  pageDataCache.dashboard = cached;
  saveDashboardCache(cached);
  renderDashboard(cached);
}

function removeCachedWatchlistItem(symbol) {
  const cached = getCachedDashboard();
  if (!cached) return;
  const target = String(symbol || "").trim();
  cached.watchlist = (cached.watchlist || []).filter(item => String(item.symbol || "").trim() !== target);
  pageDataCache.dashboard = cached;
  saveDashboardCache(cached);
  renderDashboard(cached);
}

function toggleWatchForm(forceOpen) {
  const form = document.getElementById("watchlistForm");
  const shouldOpen = forceOpen === true ? true : form.classList.contains("hidden");
  form.classList.toggle("hidden", !shouldOpen);
  if (shouldOpen) {
    document.getElementById("watchSymbol").focus();
  }
}

async function onSubmitWatchlist(event) {
  event.preventDefault();

  const form = event.currentTarget;
  const formData = new FormData(form);
  const payload = Object.fromEntries(formData.entries());
  payload.backfill = formData.has("backfill") ? "true" : "false";
  payload.symbol = normalizeSymbolListInput(payload.symbol);

  const message = document.getElementById("watchFormMessage");
  const submitButton = form.querySelector('button[type="submit"]');
  const symbols = payload.symbol.split(",").filter(Boolean);
  if (!symbols.length) {
    message.textContent = "請輸入股票代號";
    return;
  }

  const cached = getCachedDashboard() || { watchlist: [] };
  const existing = new Set((cached.watchlist || []).map(item => normalizeSymbolInput(item.symbol)));
  const optimisticSymbols = symbols.filter(symbol => !existing.has(symbol));
  optimisticSymbols.forEach(symbol => {
    upsertCachedWatchlistItem({
      symbol,
      name: "",
      trendText: "同步中",
      signalSummary: "後端查詢股票名稱中",
      pending: true
    });
  });
  message.textContent = `正在同步 ${symbols.length} 檔股票...`;
  if (submitButton) submitButton.disabled = true;

  try {
    const result = await Api.addWatchlist(payload);
    if (payload.backfill === "true") invalidateFrontendQuoteCaches();
    (result.stocks || []).forEach(stock => {
      replaceCachedWatchlistItem(stock.symbol, {
        symbol: stock.symbol,
        name: stock.name || "",
        trendText: "觀察",
        signalSummary: ""
      });
    });
    let resultMessage = result.warning
      ? `${result.message || "已加入關注股票"}：${result.warning}`
      : (result.message || "已加入關注股票");
    if ((result.skipped || []).length) {
      const preview = result.skipped.slice(0, 8).join(", ");
      resultMessage += `（重複：${preview}${result.skipped.length > 8 ? "..." : ""}）`;
    }
    if ((result.failed || []).length) {
      const preview = result.failed.slice(0, 5).map(item => item.symbol).join(", ");
      resultMessage += `（失敗：${preview}${result.failed.length > 5 ? "..." : ""}）`;
    }
    message.textContent = resultMessage;
    form.reset();
    form.querySelector("input[name='backfill']").checked = false;
    pageDataCache.dashboard = null;
    clearCache(CACHE_KEYS.dashboard);
    await loadDashboard({ force: true });
  } catch (err) {
    message.textContent = "加入失敗：" + err.message;
    optimisticSymbols.forEach(removeCachedWatchlistItem);
  } finally {
    if (submitButton) submitButton.disabled = false;
  }
}

async function onDocumentClick(event) {
  const sortButton = event.target.closest("[data-watch-sort]");
  if (sortButton) {
    setWatchlistSort(sortButton.dataset.watchSort);
    return;
  }
  if (event.target.closest('[data-action="close-dashboard-detail"]')) {
    closeDashboardDetail();
    return;
  }
  if (event.target.closest('[data-action="close-backfill"]')) {
    closeBackfillSheet();
    return;
  }
  const dashboardDetailButton = event.target.closest('[data-action="open-dashboard-detail"]');
  if (dashboardDetailButton) {
    openDashboardDetail(dashboardDetailButton.dataset.detailType || "");
    return;
  }
  const sparklineButton = event.target.closest('[data-action="open-sparkline-stats"]');
  if (sparklineButton) {
    openSparklineStats(sparklineButton.dataset.symbol || "");
    return;
  }
  if (event.target.closest('[data-action="close-mobile-more"]')) {
    closeMobileMore();
    return;
  }
  const pageButton = event.target.closest('[data-action="open-page"]');
  if (pageButton) {
    changePage(pageButton.dataset.page);
    return;
  }
  const stockButton = event.target.closest('[data-action="open-stock-detail"]');
  if (stockButton) {
    const symbol = normalizeSymbolInput(stockButton.dataset.symbol);
    const input = document.getElementById("stockDetailSymbol");
    if (input) input.value = symbol;
    changePage("stockDetail");
    return;
  }
  const notificationButton = event.target.closest('[data-action="mark-notification-read"]');
  if (notificationButton) {
    await markNotificationRead(notificationButton.dataset.id);
    return;
  }
  const backtestButton = event.target.closest('[data-action="open-backtest-result"]');
  if (backtestButton) {
    backtestButton.disabled = true;
    try {
      renderBacktest(await Api.getBacktestResult(backtestButton.dataset.runId, 100));
    } catch (err) {
      setApiStatus("回測結果讀取失敗：" + err.message);
    } finally {
      backtestButton.disabled = false;
    }
    return;
  }
  const modelButton = event.target.closest('[data-action="expand-model-tags"]');
  if (modelButton) {
    let names = [];
    try { names = JSON.parse(decodeURIComponent(modelButton.dataset.models || "")); } catch (err) {}
    const container = modelButton.closest(".matched-models, .candidate-models");
    if (container && names.length) container.innerHTML = names.map(name => `<span class="matched-model-tag">${escapeHtml(name)}</span>`).join("");
    return;
  }
  const txBtn = event.target.closest('[data-action="delete-transaction"]');
  if (txBtn) {
    await onDeleteTransaction(txBtn);
    return;
  }
  const retryTransactionButton = event.target.closest('[data-action="retry-pending-transaction"]');
  if (retryTransactionButton) {
    await retryPendingTransaction(retryTransactionButton.dataset.id || "");
    return;
  }
  const removePendingButton = event.target.closest('[data-action="remove-pending-transaction"]');
  if (removePendingButton) {
    removeCachedTransaction(removePendingButton.dataset.id || "");
    return;
  }

  const btn = event.target.closest('[data-action="remove-watchlist"]');
  if (!btn) return;

  const symbol = btn.dataset.symbol;
  const name = btn.dataset.name || "";
  if (!symbol) return;

  const ok = confirm(`確定要移除 ${displaySymbol(symbol, name)} ${name} 嗎？`);
  if (!ok) return;

  removeCachedWatchlistItem(symbol);

  try {
    btn.disabled = true;
    setApiStatus("正在移除關注股票...");
    await Api.removeWatchlist(symbol, name);
    setApiStatus("已移除關注股票");
    pageDataCache.dashboard = null;
    clearCache(CACHE_KEYS.dashboard);
    await loadDashboard();
  } catch (err) {
    setApiStatus("移除失敗：" + err.message);
  } finally {
    btn.disabled = false;
  }
}

function changePage(pageName) {
  if (!pages[pageName] || !document.getElementById(pageName + "Page")) return;
  closeMobileMore();
  document.querySelectorAll(".nav-btn").forEach(btn => {
    btn.classList.toggle("active", btn.dataset.page === pageName);
  });

  document.querySelectorAll(".page").forEach(page => {
    page.classList.remove("active");
  });

  document.getElementById(pageName + "Page").classList.add("active");
  document.getElementById("pageTitle").textContent = pages[pageName].title;
  document.getElementById("pageSubtitle").textContent = pages[pageName].subtitle;

  pages[pageName].loader();
}

let dashboardRetryTimer = null;

async function loadDashboard(options = {}) {
  const cached = pageDataCache.dashboard || getCachedDashboard();
  if (cached) {
    renderDashboard(cached);
    setApiStatus("已載入快取，正在更新...");
  } else {
    renderSkeleton("marketCards", "summary", 6);
    renderTableLoading("watchlistBody", 10, "首頁資料載入中");
  }

  try {
    const data = await Api.getDashboard(options.force === true);
    if (data.cacheMiss || data.rebuilding) {
      const displayData = data.cacheMiss && cached ? cached : data;
      if (displayData) renderDashboard(displayData);
      scheduleDashboardRetry(data.retryAfterSeconds);
      setApiStatus(data.message || "首頁快取正在背景更新");
      return;
    }

    clearDashboardRetry();
    pageDataCache.dashboard = data;
    saveDashboardCache(data);
    renderDashboard(data);
    setApiStatus("API 已連線");
  } catch (err) {
    if (!cached) {
      renderDashboard(Mock.dashboard);
    }
    setApiStatus("API 未連線 / 呼叫失敗：" + err.message);
  }
}

function renderDashboard(data) {
  currentDashboardData = data || null;
  const lastRun = data.lastRun || {};
  const dataDate = data.dataDate || lastRun.dataDate || "";
  const updatedAt = data.updatedAt || lastRun.finishedAt || lastRun.updatedAt || "";
  setBackendVersionLabel(runtimeBackendVersion || data.version || lastRun.version || "");

  renderUpdateStatus(updatedAt, dataDate, data.version, lastRun);
  renderMarketCards(data);
  renderDashboardV11Summary(data);
  renderWatchlist(data.watchlist || []);
}

async function loadCandidates() {
  loadStrategyModels();
  const cached = pageDataCache.candidates;
  if (cached) {
    currentCandidateData = cached;
    renderCandidates(cached);
  } else {
    renderTableLoading("buyCandidatesBody", 9, "候選資料載入中");
    renderTableLoading("sellCandidatesBody", 12, "候選資料載入中");
  }
  try {
    const data = await Api.getCandidates();
    pageDataCache.candidates = data;
    currentCandidateData = data;
    renderCandidates(data);
    setApiStatus("候選清單已更新");
  } catch (err) {
    if (!cached) {
      currentCandidateData = Mock.candidates;
      renderCandidates(Mock.candidates);
    }
    setApiStatus("候選清單載入失敗：" + err.message);
  }
}

function renderCandidates(data) {
  const sortMode = document.getElementById("candidateSort").value;
  const buyItems = sortCandidateItems(data.buyCandidates || [], sortMode, false);
  const sellItems = sortCandidateItems(data.sellCandidates || [], sortMode, true);
  const status = document.getElementById("candidateStatus");
  const strategyName = data.strategyName || "全模型候選";
  const modelCount = Number(data.modelCount || (data.models || strategyModels).length || 0);
  status.textContent = `盤後資料 ${data.dataDate || "尚未建立"} · ${strategyName}${modelCount ? ` ${modelCount} 個模型` : ""} · 買入 ${buyItems.length} 檔 · 賣出 ${sellItems.length} 檔 · 供下一交易日參考`;

  document.getElementById("buyCandidatesBody").innerHTML = buyItems.length
    ? buyItems.map(item => `
        <tr>
          <td data-label="股票">${renderStockLink(item.symbol, item.name)}</td>
          <td data-label="模型" class="candidate-models">${formatCandidateModels(item)}</td>
          <td data-label="收盤價">${number(item.close)}</td>
          <td data-label="RSI">${number(item.rsi14)}</td>
          <td data-label="技術分數">${number(item.totalScore)}</td>
          <td data-label="風險分數">${number(item.riskScore)}</td>
          <td data-label="狀態"><span class="badge ${getBadgeClass(item.trendText)}">${escapeHtml(item.trendText || "觀察")}</span></td>
          <td data-label="候選分數"><strong>${number(item.buyScore)}</strong></td>
          <td data-label="符合原因" class="candidate-reason">${renderCandidateReasons(item)}</td>
        </tr>
      `).join("")
    : candidateEmptyRow(`目前沒有符合「${strategyName}」的買入候選`, 9);

  document.getElementById("sellCandidatesBody").innerHTML = sellItems.length
    ? sellItems.map(item => {
        const pnlClass = Number(item.unrealizedPnl) >= 0 ? "up" : "down";
        return `
          <tr>
            <td data-label="股票">${renderStockLink(item.symbol, item.name)}</td>
            <td data-label="模型" class="candidate-models">${formatCandidateModels(item)}</td>
            <td data-label="收盤價">${number(item.close)}</td>
            <td data-label="平均成本">${number(item.avgCost)}</td>
            <td data-label="持有股數">${number(item.quantity)}</td>
            <td data-label="未實現損益" class="${pnlClass}">${money(item.unrealizedPnl)}</td>
            <td data-label="報酬率" class="${pnlClass}">${number(item.unrealizedRate)}%</td>
            <td data-label="RSI">${number(item.rsi14)}</td>
            <td data-label="技術分數">${number(item.totalScore)}</td>
            <td data-label="風險分數">${number(item.riskScore)}</td>
            <td data-label="候選分數"><strong>${number(item.sellScore)}</strong></td>
            <td data-label="符合原因" class="candidate-reason">${renderCandidateReasons(item)}</td>
          </tr>
        `;
      }).join("")
    : candidateEmptyRow(`目前沒有符合「${strategyName}」的賣出候選`, 12);
}

function sortCandidateItems(items, mode, isSell) {
  return items.slice().sort((a, b) => {
    if (mode === "risk") return Number(a.riskScore || 0) - Number(b.riskScore || 0);
    if (mode === "rsi") return Number(b.rsi14 || 0) - Number(a.rsi14 || 0);
    if (mode === "return") return Number(b.unrealizedRate || 0) - Number(a.unrealizedRate || 0);
    const scoreKey = isSell ? "sellScore" : "buyScore";
    return Number(b[scoreKey] || 0) - Number(a[scoreKey] || 0);
  });
}

function candidateEmptyRow(message, colspan) {
  return `<tr><td colspan="${colspan}" class="candidate-empty">${escapeHtml(message)}</td></tr>`;
}

function formatCandidateModels(item) {
  const matched = Array.isArray(item.matchedModels) ? item.matchedModels : [];
  const names = matched.length
    ? matched.map(model => model.strategyName || model.strategyType).filter(Boolean)
    : String(item.modelNames || item.strategyName || "").split(/[、,]/).map(name => name.trim()).filter(Boolean);
  const unique = Array.from(new Set(names));
  if (!unique.length) return escapeHtml("未標示");
  return renderModelTags(unique, 2);
}

function renderCandidateReasons(item) {
  const reasons = normalizeTextList(item.reasonList || item.reason);
  const risks = normalizeTextList(item.riskList);
  return `<details class="candidate-details"><summary>${escapeHtml(item.actionSuggestion || reasons[0] || "查看理由")}</summary>
    ${reasons.length ? `<ul class="v11-reasons">${reasons.map(text => `<li>${escapeHtml(text)}</li>`).join("")}</ul>` : ""}
    ${risks.length ? `<ul class="v11-risk-list">${risks.map(text => `<li>${escapeHtml(text)}</li>`).join("")}</ul>` : ""}
  </details>`;
}

function setupStrategyModelSelectors() {
  renderStrategyModelSelectors();

  const paperSelect = document.getElementById("paperStrategyType");
  const backtestOptions = document.getElementById("backtestStrategyOptions");
  if (paperSelect) {
    paperSelect.addEventListener("change", () => {
      updateStrategyModelInfo("paperStrategyType", "paperStrategyInfo");
      const model = getStrategyModel(paperSelect.value);
      const nameInput = document.querySelector("#paperStrategyForm input[name='name']");
      if (model && nameInput) nameInput.value = model.strategyName;
    });
  }
  if (backtestOptions) backtestOptions.addEventListener("change", updateBacktestStrategyInfo);
  document.getElementById("btnSelectAllStrategies").addEventListener("click", () => setAllBacktestStrategies(true));
  document.getElementById("btnClearStrategies").addEventListener("click", () => setAllBacktestStrategies(false));

}

async function loadStrategyModels() {
  if (strategyModelsLoaded) return;
  if (!Api.isConfigured() || typeof Api.getStrategyModels !== "function") return;
  try {
    const data = await Api.getStrategyModels();
    if (data && Array.isArray(data.items) && data.items.length) {
      strategyModels = data.items;
      strategyModelsLoaded = true;
      renderStrategyModelSelectors();
    }
  } catch (err) {
    // The built-in catalog keeps the selectors usable while an older backend is being replaced.
  }
}

function renderStrategyModelSelectors() {
  ["paperStrategyType"].forEach(id => {
    const select = document.getElementById(id);
    if (!select) return;
    const current = select.value || "PERSISTENT_MOMENTUM_V2";
    select.innerHTML = strategyModels.map(model => `<option value="${escapeHtml(model.strategyType)}">${escapeHtml(model.strategyName)}</option>`).join("");
    select.value = strategyModels.some(model => model.strategyType === current) ? current : "PERSISTENT_MOMENTUM_V2";
  });
  updateStrategyModelInfo("paperStrategyType", "paperStrategyInfo");
  renderCandidateStrategyOverview();
  renderBacktestStrategyOptions();
}

function renderCandidateStrategyOverview() {
  const target = document.getElementById("candidateStrategyInfo");
  if (!target) return;
  const names = strategyModels.map(model => model.strategyName).join("、");
  target.innerHTML = `
    <div class="strategy-model-heading"><strong>全模型候選</strong><span>${strategyModels.length} 個模型</span></div>
    <div>${escapeHtml(names)}</div>`;
}

function renderBacktestStrategyOptions() {
  const target = document.getElementById("backtestStrategyOptions");
  if (!target) return;
  const existing = Array.from(target.querySelectorAll("input:checked")).map(input => input.value);
  const checked = new Set(existing.length ? existing : ["PERSISTENT_MOMENTUM_V2"]);
  target.innerHTML = strategyModels.map(model => `
    <label class="strategy-check">
      <input type="checkbox" value="${escapeHtml(model.strategyType)}" ${checked.has(model.strategyType) ? "checked" : ""} />
      <span><strong>${escapeHtml(model.strategyName)}</strong><small>風險 ${escapeHtml(model.riskLevel || "未設定")} · ${escapeHtml(model.bestFor || "")}</small></span>
    </label>`).join("");
  updateBacktestStrategyInfo();
}

function getSelectedBacktestStrategyTypes() {
  return Array.from(document.querySelectorAll("#backtestStrategyOptions input:checked")).map(input => input.value);
}

function setAllBacktestStrategies(checked) {
  document.querySelectorAll("#backtestStrategyOptions input").forEach(input => { input.checked = checked; });
  updateBacktestStrategyInfo();
}

function updateBacktestStrategyInfo() {
  const target = document.getElementById("backtestStrategyInfo");
  if (!target) return;
  const selected = getSelectedBacktestStrategyTypes().map(getStrategyModel).filter(Boolean);
  if (!selected.length) {
    target.innerHTML = `<div class="warn">請至少選擇一個策略模型</div>`;
    return;
  }
  target.innerHTML = `<div><strong>已選 ${selected.length} 個模型：</strong>${selected.map(model => escapeHtml(model.strategyName)).join("、")}</div><div>所有模型會使用相同股票、期間與初始資金，方便直接比較。</div>`;
}

function getStrategyModel(strategyType) {
  return strategyModels.find(model => model.strategyType === strategyType) || strategyModels[0] || null;
}

function updateStrategyModelInfo(selectId, targetId) {
  const select = document.getElementById(selectId);
  const target = document.getElementById(targetId);
  if (!select || !target) return;
  const model = getStrategyModel(select.value);
  if (!model) {
    target.innerHTML = "";
    return;
  }
  target.innerHTML = `
    <div class="strategy-model-heading"><strong>${escapeHtml(model.strategyName)}</strong><span>風險 ${escapeHtml(model.riskLevel || "未設定")}</span></div>
    <div>${escapeHtml(model.description || "")}</div>
    <div><b>適用：</b>${escapeHtml(model.bestFor || "")}</div>
    <div><b>買進：</b>${escapeHtml(model.buySummary || "")}</div>
    <div><b>賣出：</b>${escapeHtml(model.sellSummary || "")}</div>`;
}

async function loadPaperSummary(options = {}) {
  loadStrategyModels();
  const state = paginationState.paperTrades;
  if (state.loading) return;
  const append = options.append === true;
  if (!append) state.offset = 0;
  const dashboard = getCachedDashboard();
  const symbolInput = document.querySelector("#paperStrategyForm input[name='symbols']");
  if (symbolInput && !symbolInput.value && dashboard && dashboard.watchlist) symbolInput.value = dashboard.watchlist.map(item => normalizeSymbolInput(item.symbol)).filter(Boolean).join(",");
  if (pageDataCache.paperSummary && !append) renderPaperSummary(pageDataCache.paperSummary);
  else if (!append) renderSkeleton("paperSummaryCards", "summary", 4);
  state.loading = true;
  updateLoadMoreButton("btnLoadMorePaperTrades", false, true);
  try {
    const data = await Api.getPaperSummary({ limit: state.limit, offset: state.offset });
    const previousTrades = append && pageDataCache.paperSummary ? pageDataCache.paperSummary.trades || [] : [];
    const merged = Object.assign({}, data, { trades: previousTrades.concat(data.trades || []) });
    pageDataCache.paperSummary = merged;
    state.offset = merged.trades.length;
    state.hasMore = Boolean(data.hasMore);
    renderPaperSummary(merged);
    setApiStatus("虛擬交易資料已更新");
  } catch (err) {
    if (!pageDataCache.paperSummary) renderPaperSummary(Mock.paper);
    setApiStatus("虛擬交易載入失敗：" + err.message);
  } finally {
    state.loading = false;
    updateLoadMoreButton("btnLoadMorePaperTrades", state.hasMore, false);
  }
}

async function onCreatePaperStrategy(event) {
  event.preventDefault(); const form = event.currentTarget; const data = Object.fromEntries(new FormData(form).entries());
  data.enabled = form.elements.enabled.checked ? "true" : "false"; data.symbols = normalizeSymbolListInput(data.symbols);
  const message = document.getElementById("paperMessage"); message.textContent = "正在建立策略...";
  try { const result = await Api.createPaperStrategy(data); pageDataCache.paperSummary = result.summary; renderPaperSummary(result.summary); message.textContent = "虛擬策略已建立"; }
  catch (err) { message.textContent = "建立失敗：" + err.message; }
}

async function onRunPaperTrading() {
  const message = document.getElementById("paperMessage"); message.textContent = "正在執行盤後虛擬交易...";
  try { const result = await Api.runPaperTrading(); pageDataCache.paperSummary = null; message.textContent = `完成，本次產生 ${result.tradeCount || 0} 筆虛擬交易`; await loadPaperSummary(); }
  catch (err) { message.textContent = "執行失敗：" + err.message; }
}

async function onTogglePaperStrategy(event) {
  const input = event.target.closest("[data-strategy-id]"); if (!input) return;
  try { const result = await Api.togglePaperStrategy(input.dataset.strategyId, input.checked ? "true" : "false"); pageDataCache.paperSummary = result.summary; renderPaperSummary(result.summary); }
  catch (err) { input.checked = !input.checked; setApiStatus("策略狀態更新失敗：" + err.message); }
}

function renderPaperSummary(data) {
  const perf = data.performance || []; const strategyCash = (data.strategies || []).reduce((s, x) => s + Number(x.cash || 0), 0);
  const totalEquity = perf.length ? perf.reduce((s, x) => s + Number(x.totalEquity || 0), 0) : strategyCash;
  const totalCash = perf.length ? perf.reduce((s, x) => s + Number(x.cash || 0), 0) : strategyCash; const totalPnl = perf.reduce((s, x) => s + Number(x.totalPnl || 0), 0); const trades = data.trades || [];
  const initialCash = (data.strategies || []).reduce((s, x) => s + Number(x.initialCash || 0), 0); const todayTrades = (data.lastRun && data.lastRun.trades) || [];
  const wins = trades.filter(t => t.action === "SELL" && Number(t.realizedPnl) > 0).length;
  const sells = trades.filter(t => t.action === "SELL").length;
  document.getElementById("paperSummaryCards").innerHTML = [
    summaryCard("目前虛擬資金", money(totalCash), ""), summaryCard("虛擬總資產", money(totalEquity), ""),
    summaryCard("虛擬總損益", money(totalPnl), totalPnl >= 0 ? "up" : "down"), summaryCard("總報酬率", number(initialCash ? totalPnl / initialCash * 100 : 0) + "%", totalPnl >= 0 ? "up" : "down"),
    summaryCard("目前持倉", String((data.positions || []).length), ""), summaryCard("交易次數", String(sells), ""), summaryCard("勝率", number(sells ? wins / sells * 100 : 0) + "%", ""),
    summaryCard("今日虛擬買入 / 賣出", `${todayTrades.filter(t=>t.action==='BUY').length} / ${todayTrades.filter(t=>t.action==='SELL').length}`, "")
  ].join("");
  document.getElementById("paperStrategies").innerHTML = (data.strategies || []).length ? data.strategies.map(s => `
    <div class="strategy-row"><div><strong>${escapeHtml(s.name || "平衡型波段策略")}</strong><div class="muted">${escapeHtml((getStrategyModel(s.strategyType) || {}).strategyName || "多指標平衡波段策略")} · ${escapeHtml(s.symbols || "")} · 初始資金 ${money(s.initialCash)} · 每檔 ${money(s.positionSizeValue)}</div></div>
    <label class="switch-label"><input type="checkbox" data-strategy-id="${escapeHtml(s.strategyId)}" ${String(s.enabled).toUpperCase() === "TRUE" ? "checked" : ""}/>啟用</label></div>`).join("") : `<div class="muted">尚未建立虛擬策略</div>`;
  document.getElementById("paperPositionsBody").innerHTML = (data.positions || []).map(p => `<tr><td data-label="策略">${escapeHtml(p.strategyId || "")}</td><td data-label="股票">${escapeHtml(displaySymbol(p.symbol, p.name))} ${escapeHtml(p.name || "")}</td><td data-label="股數">${number(p.quantity)}</td><td data-label="平均成本">${number(p.avgCost)}</td><td data-label="現價">${number(p.lastPrice)}</td><td data-label="市值">${money(p.marketValue)}</td><td data-label="損益" class="${Number(p.unrealizedPnl)>=0?'up':'down'}">${money(p.unrealizedPnl)}</td><td data-label="報酬率">${number(p.unrealizedRate)}%</td></tr>`).join("") || candidateEmptyRow("目前沒有虛擬持倉", 8);
  document.getElementById("paperTradesBody").innerHTML = trades.map(t => `<tr><td data-label="日期">${escapeHtml(t.date || "")}</td><td data-label="動作">${t.action === "BUY" ? "虛擬買入" : "虛擬賣出"}</td><td data-label="股票">${escapeHtml(displaySymbol(t.symbol, t.name))}</td><td data-label="股數">${number(t.quantity)}</td><td data-label="價格">${number(t.price)}</td><td data-label="損益" class="${Number(t.realizedPnl)>=0?'up':'down'}">${money(t.realizedPnl)}</td><td data-label="原因" class="candidate-reason">${escapeHtml(t.reason || "")}</td></tr>`).join("") || candidateEmptyRow("尚無虛擬交易紀錄", 7);
}

async function loadBacktestRuns(options = {}) {
  loadStrategyModels();
  const state = paginationState.backtestRuns;
  if (state.loading) return;
  const append = options.append === true;
  if (!append) state.offset = 0;
  if (pageDataCache.backtestRuns && !append) renderBacktestRuns(pageDataCache.backtestRuns);
  else if (!append) renderSkeleton("backtestRunsBody", "list", 3);
  state.loading = true;
  updateLoadMoreButton("btnLoadMoreBacktestRuns", false, true);
  try {
    const data = await Api.getBacktestRuns({ limit: state.limit, offset: state.offset });
    const previousItems = append && pageDataCache.backtestRuns ? pageDataCache.backtestRuns.items || [] : [];
    const merged = Object.assign({}, data, { items: previousItems.concat(data.items || []) });
    pageDataCache.backtestRuns = merged;
    state.offset = merged.items.length;
    state.hasMore = Boolean(data.hasMore);
    renderBacktestRuns(merged);
  } catch (err) {
    setApiStatus("尚無回測結果");
  } finally {
    state.loading = false;
    updateLoadMoreButton("btnLoadMoreBacktestRuns", state.hasMore, false);
  }
}

function scheduleDashboardRetry(retryAfterSeconds) {
  clearDashboardRetry();
  const seconds = Math.max(10, Number(retryAfterSeconds || 70));
  dashboardRetryTimer = setTimeout(() => {
    dashboardRetryTimer = null;
    loadDashboard({ force: true });
  }, seconds * 1000);
}

function clearDashboardRetry() {
  if (!dashboardRetryTimer) return;
  clearTimeout(dashboardRetryTimer);
  dashboardRetryTimer = null;
}

function renderBacktestRuns(data) {
  const items = data && Array.isArray(data.items) ? data.items : [];
  const container = document.getElementById("backtestRunsBody");
  if (!container) return;
  container.innerHTML = items.map(item => `<article class="v11-card">
    <div class="v11-card-head"><strong>${escapeHtml(item.strategyName || item.runId || "回測")}</strong><span class="pill">${escapeHtml(item.status || "-")}</span></div>
    <div class="v11-meta">${escapeHtml(item.startDate || "")} 至 ${escapeHtml(item.endDate || "")} · ${escapeHtml(item.symbols || "")}</div>
    ${item.status === "DONE" ? `<button type="button" data-action="open-backtest-result" data-run-id="${escapeHtml(String(item.runId || ""))}">查看結果</button>` : ""}
  </article>`).join("") || renderV11Empty("尚無回測紀錄");
}

async function onRunBacktest(event) {
  event.preventDefault();
  const strategyTypes = getSelectedBacktestStrategyTypes();
  const message = document.getElementById("backtestMessage");
  if (!strategyTypes.length) {
    message.textContent = "請至少選擇一個策略模型";
    return;
  }

  const data = Object.fromEntries(new FormData(event.currentTarget).entries());
  data.symbols = normalizeSymbolListInput(data.symbols);
  data.strategyTypes = strategyTypes.join(",");
  message.textContent = `正在以相同資料回測 ${strategyTypes.length} 個模型，請稍候...`;
  try {
    const comparison = await Api.runBacktestComparison(data);
    renderBacktestComparison(comparison);
    message.textContent = `已完成 ${comparison.results.length} 個模型回測`;
  } catch (err) {
    message.textContent = "回測失敗：" + err.message;
  }
}

function renderBacktestComparison(data) {
  currentBacktestResults = Array.isArray(data.results) ? data.results : [];
  if (!currentBacktestResults.length) throw new Error("後端沒有回傳模型結果");
  topHistoricalBacktestStrategyType = data.topHistoricalStrategyType || "";
  activeBacktestStrategyType = topHistoricalBacktestStrategyType || currentBacktestResults[0].strategyType;

  const panel = document.getElementById("backtestComparisonPanel");
  panel.hidden = currentBacktestResults.length <= 1;
  renderBacktestComparisonRows(topHistoricalBacktestStrategyType);

  const active = currentBacktestResults.find(result => result.strategyType === activeBacktestStrategyType) || currentBacktestResults[0];
  renderBacktest(active, false);
  drawBacktestComparisonChart(currentBacktestResults);
}

function renderBacktestComparisonRows(topHistoricalStrategyType) {
  document.getElementById("backtestComparisonBody").innerHTML = currentBacktestResults.map(result => {
    const active = result.strategyType === activeBacktestStrategyType;
    const historicalTop = result.strategyType === topHistoricalStrategyType;
    return `<tr class="${active ? "is-active" : ""}" data-comparison-strategy="${escapeHtml(result.strategyType)}">
      <td data-label="模型"><strong>${escapeHtml(result.strategyName || result.strategyType)}</strong>${historicalTop ? `<span class="historical-top">此區間最高</span>` : ""}</td>
      <td data-label="總報酬率" class="${Number(result.totalReturn) >= 0 ? "up" : "down"}">${number(result.totalReturn)}%</td>
      <td data-label="總損益" class="${Number(result.totalPnl) >= 0 ? "up" : "down"}">${money(result.totalPnl)}</td>
      <td data-label="交易次數">${number(result.tradeCount)}</td>
      <td data-label="勝率">${number(result.winRate)}%</td>
      <td data-label="平均持有日">${number(result.avgHoldingDays)}</td>
      <td data-label="最大回撤" class="down">${number(result.maxDrawdown)}%</td>
      <td data-label="Profit Factor">${number(calculateBacktestProfitFactor(result.trades || []))}</td>
      <td data-label="明細"><button type="button" data-view-backtest="${escapeHtml(result.strategyType)}">${active ? "顯示中" : "查看"}</button></td>
    </tr>`;
  }).join("");
}

function calculateBacktestProfitFactor(trades) {
  const sells = trades.filter(trade => trade.action === "SELL");
  const profit = sells.filter(trade => Number(trade.realizedPnl) > 0).reduce((sum, trade) => sum + Number(trade.realizedPnl || 0), 0);
  const loss = Math.abs(sells.filter(trade => Number(trade.realizedPnl) < 0).reduce((sum, trade) => sum + Number(trade.realizedPnl || 0), 0));
  return loss ? profit / loss : (profit > 0 ? 999 : 0);
}

function onBacktestComparisonClick(event) {
  const button = event.target.closest("[data-view-backtest]");
  if (!button) return;
  const result = currentBacktestResults.find(item => item.strategyType === button.dataset.viewBacktest);
  if (!result) return;
  activeBacktestStrategyType = result.strategyType;
  renderBacktestComparisonRows(topHistoricalBacktestStrategyType);
  renderBacktest(result, false);
  drawBacktestComparisonChart(currentBacktestResults);
}

function renderBacktest(data, drawChart = true) {
  const strategyCaption = document.getElementById("backtestResultStrategy");
  if (strategyCaption) {
    strategyCaption.hidden = false;
    strategyCaption.textContent = `${data.strategyName || "策略模型"} · ${data.startDate || ""} 至 ${data.endDate || ""}${data.strategyDescription ? " · " + data.strategyDescription : ""}`;
  }
  document.getElementById("backtestSummary").innerHTML = [summaryCard("總報酬率", number(data.totalReturn) + "%", Number(data.totalReturn)>=0?"up":"down"), summaryCard("總損益", money(data.totalPnl), Number(data.totalPnl)>=0?"up":"down"), summaryCard("交易次數", number(data.tradeCount), ""), summaryCard("勝率", number(data.winRate) + "%", ""), summaryCard("平均持有日", number(data.avgHoldingDays), ""), summaryCard("平均獲利", money(data.avgProfit), "up"), summaryCard("平均虧損", money(data.avgLoss), "down"), summaryCard("最大回撤", number(data.maxDrawdown) + "%", "down")].join("");
  renderBacktestDiagnostics(data);
  if (drawChart) drawBacktestChart(data.equityCurve || [], data.strategyName || "策略模型");
  document.getElementById("backtestSymbolsBody").innerHTML = (data.bySymbol || []).map(x => `<tr><td data-label="股票">${escapeHtml(x.symbol)}</td><td data-label="交易次數">${number(x.totalTrades)}</td><td data-label="勝率">${number(x.winRate)}%</td><td data-label="累計報酬">${number(x.totalReturn)}%</td><td data-label="平均報酬">${number(x.avgReturn)}%</td><td data-label="Profit Factor">${number(x.profitFactor)}</td></tr>`).join("");
  document.getElementById("backtestTradesBody").innerHTML = (data.trades || []).map(t => `<tr><td data-label="日期">${escapeHtml(t.date)}</td><td data-label="動作">${t.action === "BUY" ? "虛擬買入" : "虛擬賣出"}</td><td data-label="股票">${escapeHtml(t.symbol)}</td><td data-label="股數">${number(t.quantity)}</td><td data-label="價格">${number(t.price)}</td><td data-label="損益">${money(t.realizedPnl)}</td><td data-label="報酬率">${number(t.realizedRate)}%</td><td data-label="原因" class="candidate-reason">${escapeHtml(t.reason || "")}</td></tr>`).join("");
}

function renderBacktestDiagnostics(data) {
  const el = document.getElementById("backtestDiagnostics");
  if (!el) return;

  const d = data && data.diagnostics ? data.diagnostics : null;
  if (!d) {
    el.hidden = true;
    el.innerHTML = "";
    return;
  }

  const parts = [
    `交易日 ${number(d.tradingDays)} 天`,
    `價格資料 ${number(d.priceSymbolDays)} 筆`,
    `指標覆蓋 ${number(d.indicatorSymbolDays)} 筆`,
    `買點 ${number(d.buySignalDays)} 天`
  ];
  if (d.indicatorsRebuilt) parts.push("已自動重建技術指標");
  if (d.zeroTradeReason) parts.push(d.zeroTradeReason);

  const rows = (d.bySymbol || []).map(item => `<span>${escapeHtml(item.symbol)}：價格 ${number(item.priceDays)}、指標 ${number(item.indicatorDays)}、買點 ${number(item.buySignalDays)}</span>`).join("");

  el.hidden = false;
  el.innerHTML = `<div>${parts.map(escapeHtml).join(" · ")}</div>${rows ? `<div class="diagnostic-list">${rows}</div>` : ""}`;
}

function drawBacktestChart(rows, strategyName) {
  const svg = document.getElementById("backtestChart");
  const legend = document.getElementById("backtestChartLegend");
  legend.innerHTML = `<span><i style="background:#22c55e"></i>${escapeHtml(strategyName || "策略模型")}</span>`;
  if (!rows.length) {
    svg.innerHTML = `<text x="32" y="60" fill="#94a3b8">尚無資產曲線</text>`;
    return;
  }
  const w = 920, h = 320, p = 36;
  const values = rows.map(row => Number(row.equity));
  const min = Math.min(...values), max = Math.max(...values), span = max - min || 1;
  const points = values.map((value, index) => `${p + index * (w - p * 2) / Math.max(1, values.length - 1)},${h - p - (value - min) * (h - p * 2) / span}`).join(" ");
  svg.innerHTML = `<line x1="${p}" y1="${h-p}" x2="${w-p}" y2="${h-p}" stroke="#334155"/><polyline points="${points}" fill="none" stroke="#22c55e" stroke-width="3" vector-effect="non-scaling-stroke"/>`;
}

function drawBacktestComparisonChart(results) {
  const svg = document.getElementById("backtestChart");
  const legend = document.getElementById("backtestChartLegend");
  const allValues = results.flatMap(result => (result.equityCurve || []).map(point => Number(point.equity))).filter(Number.isFinite);
  if (!allValues.length) {
    legend.innerHTML = "";
    svg.innerHTML = `<text x="32" y="60" fill="#94a3b8">尚無資產曲線</text>`;
    return;
  }

  const w = 920, h = 320, p = 36;
  const min = Math.min(...allValues), max = Math.max(...allValues), span = max - min || 1;
  const lines = results.map((result, resultIndex) => {
    const rows = result.equityCurve || [];
    const color = STRATEGY_CHART_COLORS[resultIndex % STRATEGY_CHART_COLORS.length];
    const points = rows.map((row, index) => `${p + index * (w - p * 2) / Math.max(1, rows.length - 1)},${h - p - (Number(row.equity) - min) * (h - p * 2) / span}`).join(" ");
    const width = result.strategyType === activeBacktestStrategyType ? 4 : 2;
    return `<polyline points="${points}" fill="none" stroke="${color}" stroke-width="${width}" opacity="${result.strategyType === activeBacktestStrategyType ? 1 : 0.72}" vector-effect="non-scaling-stroke"/>`;
  }).join("");
  svg.innerHTML = `<line x1="${p}" y1="${h-p}" x2="${w-p}" y2="${h-p}" stroke="#334155"/>${lines}`;
  legend.innerHTML = results.map((result, index) => `<span class="${result.strategyType === activeBacktestStrategyType ? "is-active" : ""}"><i style="background:${STRATEGY_CHART_COLORS[index % STRATEGY_CHART_COLORS.length]}"></i>${escapeHtml(result.strategyName)} ${number(result.totalReturn)}%</span>`).join("");
}

function renderUpdateStatus(updatedAt, dataDate, version, lastRun = {}) {
  const el = document.getElementById("dashboardUpdateStatus");
  if (!el) return;

  const displayVersion = version || lastRun.version || getAppVersion();
  const today = formatLocalDate(new Date());

  if (!dataDate) {
    el.className = "update-status warning";
    if (lastRun.ok === true) {
      el.textContent = `已執行每日更新 ${updatedAt || ""}，尚未建立資料日期${displayVersion ? " · " + displayVersion : ""}`;
      return;
    }
    el.textContent = `尚未建立更新資料${displayVersion ? " · " + displayVersion : ""}`;
    return;
  }

  if (dataDate === today) {
    el.className = "update-status success";
    el.textContent = `今日已更新 ${updatedAt || dataDate}${displayVersion ? " · " + displayVersion : ""}`;
    return;
  }

  el.className = "update-status warning";
  el.textContent = `資料日期 ${dataDate}，最後更新 ${updatedAt || "尚未記錄"}${displayVersion ? " · " + displayVersion : ""}`;
}

function renderMarketCards(data) {
  const container = document.getElementById("marketCards");
  const items = Array.isArray(data) ? data : (data.market || []);
  if (!items || items.length === 0) {
    container.innerHTML = `
      <div class="card wide-warning">
        <div class="card-title">尚未取得真實大盤資料</div>
        <div class="card-value">請檢查 API</div>
        <div class="warn">不再顯示 23,520 這類模擬行情，避免誤判。</div>
      </div>
    `;
    return;
  }

  const dashboard = Array.isArray(data) ? { market: items } : data;
  const marketSummary = dashboard.marketSummary || {};
  const marketState = dashboard.marketState || marketSummary.marketState || {};
  const taiex = items.find(item => item.symbol === "TAIEX") || marketSummary.taiex || {};
  const bullish = dashboard.bullishSummary || marketSummary.bullishSummary || fallbackCountSummary(items, "BULL");
  const risk = dashboard.riskSummary || marketSummary.riskSummary || fallbackCountSummary(items, "RISK");
  const signals = dashboard.todaySignalSummary || { buyCount: 0, sellCount: 0, buyItems: [], sellItems: [] };
  const average = dashboard.averageScoreSummary || marketSummary.averageScoreSummary || { value: marketSummary.watchlistMarket && marketSummary.watchlistMarket.avgScore };
  const mode = marketState.marketMode || marketSummary.marketMode || taiex.trendText || "資料不足";
  const changePercent = Number(marketState.changePercent !== undefined ? marketState.changePercent : taiex.changePercent || 0);
  const changeClass = changePercent > 0 ? "up" : (changePercent < 0 ? "down" : "");
  const changeArrow = changePercent > 0 ? "▲" : (changePercent < 0 ? "▼" : "→");
  const riskLevel = risk.level === "high" ? "高風險" : (risk.level === "medium" ? "中度風險" : "低風險");
  const averageChange = Number(average.change);
  const averageMeta = Number.isFinite(averageChange) && average.yesterdayValue !== "" && average.yesterdayValue !== undefined
    ? `昨日 ${number(average.yesterdayValue)} · ${averageChange > 0 ? "↑" : (averageChange < 0 ? "↓" : "→")} ${number(Math.abs(averageChange))}`
    : "滿分 100";

  container.innerHTML = [
    dashboardMetricCard({ title: "今日市場", value: mode, cls: marketModeClass(mode), meta: (marketState.reasonList || []).slice(0, 2).join(" · ") || "依盤後技術資料判斷" }),
    dashboardMetricCard({ title: "加權指數", value: number(marketState.close || taiex.close), cls: changeClass, meta: `${changeArrow} ${number(Math.abs(changePercent))}% · ${mode}`, detail: buildMarketIndicatorLine(marketState, taiex) }),
    dashboardMetricCard({ title: "偏多股票", value: `${number(bullish.count)} / ${number(bullish.total)}`, cls: "up", meta: `偏多率 ${number(bullish.rate)}%`, action: "bullish" }),
    dashboardMetricCard({ title: "風險提醒", value: `${number(risk.count)} 檔`, cls: risk.level === "high" ? "down" : "warn", meta: `${riskStars(risk.stars)} ${riskLevel}`, action: "risk" }),
    dashboardMetricCard({ title: "今日訊號", value: `買入 ${number(signals.buyCount)} · 賣出 ${number(signals.sellCount)}`, meta: "查看策略候選明細", action: "signals" }),
    dashboardMetricCard({ title: "平均技術分數", value: `${number(average.value)} / 100`, cls: scoreClass(average.value), meta: averageMeta })
  ].join("");
}

function dashboardMetricCard(options) {
  const content = `<div class="card-title">${escapeHtml(options.title || "")}</div>
    <div class="dashboard-card-value ${options.cls || ""}">${escapeHtml(String(options.value === undefined ? "-" : options.value))}</div>
    ${options.meta ? `<div class="dashboard-card-meta">${escapeHtml(options.meta)}</div>` : ""}
    ${options.detail ? `<div class="dashboard-card-detail">${escapeHtml(options.detail)}</div>` : ""}
    ${options.action ? '<div class="dashboard-card-link">查看詳細 →</div>' : ""}`;
  if (!options.action) return `<article class="card dashboard-metric-card">${content}</article>`;
  return `<button type="button" class="card dashboard-metric-card is-action" data-action="open-dashboard-detail" data-detail-type="${escapeHtml(options.action)}">${content}</button>`;
}

function fallbackCountSummary(items, symbol) {
  const item = (items || []).find(row => row.symbol === symbol) || {};
  return { count: Number(item.close || 0), total: 0, rate: Number(item.changePercent || 0), items: [] };
}

function buildMarketIndicatorLine(state, taiex) {
  const ma20 = state.ma20 !== undefined ? state.ma20 : taiex.ma20;
  const aboveMa20 = state.aboveMa20 !== undefined ? state.aboveMa20 : taiex.aboveMa20;
  const parts = [];
  if (ma20 !== "" && ma20 !== undefined) parts.push(`MA20：${aboveMa20 ? "站上" : "跌破"}`);
  if (state.rsi14 !== "" && state.rsi14 !== undefined) parts.push(`RSI：${number(state.rsi14)}`);
  if (state.adx14 !== "" && state.adx14 !== undefined) parts.push(`ADX：${number(state.adx14)}`);
  return parts.join(" · ");
}

function riskStars(value) {
  const count = Math.max(0, Math.min(5, Number(value || 0)));
  return "★".repeat(count) + "☆".repeat(5 - count);
}

function marketModeClass(mode) {
  if (String(mode).includes("多頭") || mode === "反彈") return "up";
  if (mode === "空頭") return "down";
  return "warn";
}

function renderWatchlist(items) {
  const tbody = document.getElementById("watchlistBody");
  const empty = document.getElementById("emptyWatchlist");
  currentWatchlistItems = Array.isArray(items) ? items.slice() : currentWatchlistItems;
  const visibleItems = currentWatchlistItems
    .filter(item => item.enabled === undefined || item.enabled === true || String(item.enabled).toUpperCase() === "TRUE" || item.enabled === "")
    .sort(compareWatchlistItems);

  updateWatchlistSortHeaders();

  empty.classList.toggle("hidden", visibleItems.length > 0);

  if (!visibleItems.length) {
    tbody.innerHTML = "";
    return;
  }

  tbody.innerHTML = visibleItems.map(item => {
    const statusText = dashboardStatusText(item);
    const badgeClass = getBadgeClass(statusText);
    const safeSymbol = escapeHtml(String(item.symbol || ""));
    const safeName = escapeHtml(String(item.name || ""));
    const signals = buildSignalChips_(item);
    const rsiArrow = item.rsiDirection === "up" ? "↑" : (item.rsiDirection === "down" ? "↓" : (item.rsiDirection === "flat" ? "→" : ""));
    const adxValue = finiteValue(item.adx14);
    const atrValue = formatAtrPercent(item.atrPercent);
    const volumeValue = finiteValue(item.volumeRatio);
    const sparkStats = calcSparklineStats_(item.sparkline || item.trend || []);
    const sparkTitle = sparkStats.valid ? `近 20 日｜最高 ${number(sparkStats.high)}｜最低 ${number(sparkStats.low)}｜漲跌 ${signedNumber(sparkStats.changePercent)}%｜波動 ${number(sparkStats.rangePercent)}%` : "近 20 日資料不足";
    return `
      <tr>
        <td data-label="股票"><div class="stock-cell">${renderStockLink(item.symbol, item.name)}<small>收盤 ${number(item.close)} · ${escapeHtml(item.date || "-")}</small></div></td>
        <td data-label="技術分數"><strong class="score-value ${scoreClass(item.totalScore)}">${number(item.totalScore)}</strong></td>
        <td data-label="狀態"><span class="badge ${badgeClass}">${escapeHtml(statusText)}</span></td>
        <td data-label="RSI"><span class="indicator-value ${rsiDirectionClass(item.rsiDirection)}">${number(item.rsi14)} ${rsiArrow}</span></td>
        <td data-label="ADX"><span class="indicator-value ${adxClass(adxValue)}" title="${adxTitle(adxValue)}">${adxValue === null ? "-" : number(adxValue)}</span></td>
        <td data-label="ATR%"><span class="indicator-value ${atrClass(atrValue)}" title="${atrTitle(atrValue)}">${atrValue === null ? "-" : number(atrValue) + "%"}</span></td>
        <td data-label="量比"><span class="volume-ratio ${volumeRatioClass(volumeValue)}">${volumeValue === null ? "-" : number(volumeValue) + "x"}</span></td>
        <td data-label="訊號"><div class="signal-chips">${renderSignalChips(signals)}</div></td>
        <td data-label="迷你線圖" class="td-sparkline"><button class="sparkline-button" type="button" data-action="open-sparkline-stats" data-symbol="${safeSymbol}" title="${escapeHtml(sparkTitle)}">${sparkline(item.trend || [], "#38bdf8", 160, 36)}</button></td>
        <td data-label="操作"><button class="danger-btn" type="button" data-action="remove-watchlist" data-symbol="${safeSymbol}" data-name="${safeName}">移除</button></td>
      </tr>
    `;
  }).join("");
}

function dashboardStatusText(item) {
  if (item && item.statusText) return String(item.statusText);
  const score = finiteValue(item && item.totalScore);
  if (score === null) return String((item && item.trendText) || "觀察");
  const risk = Number(item.riskScore || 0);
  const close = Number(item.close || 0);
  const ma20 = finiteValue(item.ma20);
  const ma60 = finiteValue(item.ma60);
  if (score >= 80 && risk >= 60 && ma20 !== null && ma60 !== null && close > ma20 && ma20 > ma60) return "強勢多頭";
  if (score >= 65) return "偏多";
  if (score >= 50) return "中性";
  if (score >= 40) return "偏空";
  return "空頭";
}

function scoreClass(value) {
  const score = Number(value);
  if (!Number.isFinite(score)) return "score-neutral";
  if (score >= 80) return "score-strong";
  if (score >= 60) return "score-good";
  if (score >= 40) return "score-neutral";
  return "score-weak";
}

function finiteValue(value) {
  if (value === "" || value === null || value === undefined) return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function formatAtrPercent(value) {
  const parsed = finiteValue(value);
  if (parsed === null) return null;
  return Math.abs(parsed) <= 1 ? parsed * 100 : parsed;
}

function rsiDirectionClass(direction) {
  if (direction === "up") return "indicator-up";
  if (direction === "down") return "indicator-down";
  return "indicator-flat";
}

function adxClass(value) {
  if (value === null) return "indicator-flat";
  if (value >= 25) return "indicator-up";
  if (value >= 20) return "indicator-warn";
  return "indicator-flat";
}

function adxTitle(value) {
  if (value === null) return "ADX 資料不足";
  if (value >= 25) return "趨勢明顯";
  if (value >= 20) return "趨勢開始";
  return "盤整";
}

function atrClass(value) {
  if (value === null) return "indicator-flat";
  if (value >= 5) return "indicator-down";
  if (value >= 2) return "indicator-warn";
  return "indicator-flat";
}

function atrTitle(value) {
  if (value === null) return "ATR 資料不足";
  if (value >= 5) return "高波動";
  if (value >= 2) return "一般波動";
  return "低波動";
}

function volumeRatioClass(value) {
  if (value === null) return "volume-muted";
  if (value >= 1.5) return "volume-strong";
  if (value >= 1) return "volume-normal";
  return "volume-muted";
}

function buildSignalChips_(context) {
  const chips = [];
  const add = label => { if (label && chips.indexOf(label) < 0) chips.push(label); };
  const close = finiteValue(context.close);
  const ma20 = finiteValue(context.ma20);
  const ma60 = finiteValue(context.ma60);
  const rsi = finiteValue(context.rsi14);
  const k9 = finiteValue(context.k9);
  const d9 = finiteValue(context.d9);
  const macdHist = finiteValue(context.macdHist);
  const bbPercentB = finiteValue(context.bbPercentB);
  const high20 = finiteValue(context.high20);
  const adx = finiteValue(context.adx14);
  const volume = finiteValue(context.volumeRatio);
  const summary = String(context.signalSummary || "");
  if (close !== null && ma20 !== null && close >= ma20) add("MA20");
  if (close !== null && ma60 !== null && close >= ma60) add("MA60");
  if (rsi !== null && rsi > 70) add("RSI過熱");
  else if (rsi !== null && rsi > 50) add("RSI>50");
  if (/KD.*金叉|KD金叉/.test(summary)) add("KD金叉");
  else if (/KD.*死叉|KD死叉/.test(summary)) add("KD死叉");
  else if (k9 !== null && d9 !== null) add(k9 >= d9 ? "KD金叉" : "KD死叉");
  if (macdHist !== null) add(macdHist >= 0 ? "MACD+" : "MACD-");
  if (bbPercentB !== null && bbPercentB >= 0.2 && bbPercentB <= 0.8) add("布林健康");
  if (close !== null && high20 !== null && close >= high20) add("突破20高");
  if (adx !== null && adx >= 25) add("ADX趨勢");
  if (volume !== null && volume >= 1.5) add("量增");
  return chips;
}

function renderSignalChips(chips) {
  if (!chips || !chips.length) return '<span class="signal-empty">暫無</span>';
  return chips.map(chip => `<span class="signal-chip">✓ ${escapeHtml(chip)}</span>`).join("");
}

function calcSparklineStats_(values) {
  const rows = (Array.isArray(values) ? values : []).map(Number).filter(Number.isFinite).slice(-20);
  if (rows.length < 2) return { valid: false };
  const high = Math.max(...rows);
  const low = Math.min(...rows);
  const first = rows[0];
  return {
    valid: true,
    high: high,
    low: low,
    changePercent: first ? (rows[rows.length - 1] / first - 1) * 100 : 0,
    rangePercent: low ? (high / low - 1) * 100 : 0
  };
}

function signedNumber(value) {
  const parsed = Number(value || 0);
  return `${parsed > 0 ? "+" : ""}${number(parsed)}`;
}

function setWatchlistSort(key) {
  const allowed = ["symbol", "date", "close", "rsi14", "adx14", "atrPercent", "volumeRatio", "totalScore", "trendText", "signalSummary"];
  if (allowed.indexOf(key) < 0) return;
  if (watchlistSortState.key === key) {
    watchlistSortState.direction = watchlistSortState.direction === "asc" ? "desc" : "asc";
  } else {
    watchlistSortState.key = key;
    watchlistSortState.direction = ["symbol", "date", "trendText", "signalSummary"].indexOf(key) >= 0 ? "asc" : "desc";
  }
  renderWatchlist(currentWatchlistItems);
}

function compareWatchlistItems(a, b) {
  const key = watchlistSortState.key;
  if (!key) return 0;
  const direction = watchlistSortState.direction === "desc" ? -1 : 1;
  const numericKeys = ["close", "rsi14", "adx14", "atrPercent", "volumeRatio", "totalScore"];
  if (numericKeys.indexOf(key) >= 0) {
    const aBlank = a[key] === "" || a[key] === null || a[key] === undefined || !Number.isFinite(Number(a[key]));
    const bBlank = b[key] === "" || b[key] === null || b[key] === undefined || !Number.isFinite(Number(b[key]));
    if (aBlank !== bBlank) return aBlank ? 1 : -1;
    return (Number(a[key]) - Number(b[key])) * direction;
  }
  const aText = String(a[key] || "").trim();
  const bText = String(b[key] || "").trim();
  if (!aText || !bText) {
    if (!aText && !bText) return 0;
    return !aText ? 1 : -1;
  }
  return aText.localeCompare(bText, "zh-Hant", { numeric: true, sensitivity: "base" }) * direction;
}

function updateWatchlistSortHeaders() {
  document.querySelectorAll("[data-watch-sort]").forEach(button => {
    const active = button.dataset.watchSort === watchlistSortState.key;
    const direction = active ? watchlistSortState.direction : "";
    button.dataset.direction = direction;
    const th = button.closest("th");
    if (th) th.setAttribute("aria-sort", active ? (direction === "desc" ? "descending" : "ascending") : "none");
  });
}

async function loadPortfolio(options = {}) {
  let data = pageDataCache.portfolio;
  if (data) renderPortfolioData(data);
  else {
    renderSkeleton("portfolioSummary", "summary", 4);
    renderTableLoading("portfolioBody", 11, "庫存資料載入中");
  }
  try {
    data = await Api.getPortfolio(options.force === true);
    pageDataCache.portfolio = data;
    renderPortfolioData(data);
    if (data.stale && Api.refreshPortfolio && options.skipRefresh !== true) {
      setPortfolioStatus("庫存計算中...", "warning");
      const refreshed = await Api.refreshPortfolio();
      pageDataCache.portfolio = refreshed;
      data = refreshed;
      renderPortfolioData(data);
      showToast("庫存更新完成", "success");
    }
    setApiStatus("API 已連線");
  } catch (err) {
    data = data || Mock.portfolio;
    setApiStatus(err.message);
  }

  renderPortfolioData(data);
}

function renderPortfolioData(data) {

  const items = data.items || [];
  const totalCost = items.reduce((sum, x) => sum + Number(x.totalCost || (x.avgCost * x.quantity) || 0), 0);
  const marketValue = items.reduce((sum, x) => sum + Number(x.marketValue || 0), 0);
  const pnl = items.reduce((sum, x) => sum + Number(x.unrealizedPnl || 0), 0);
  const rate = totalCost ? pnl / totalCost * 100 : 0;
  setPortfolioStatus(data.stale ? "庫存計算中..." : `資料日期：${data.dataDate || latestPortfolioDate(items) || "-"} · ${data.message || "最新股價已更新"}`, data.stale ? "warning" : "success");

  document.getElementById("portfolioSummary").innerHTML = `
    ${summaryCard("總投入成本", money(totalCost), "")}
    ${summaryCard("目前市值", money(marketValue), "")}
    ${summaryCard("未實現損益", money(pnl), pnl >= 0 ? "up" : "down")}
    ${summaryCard("總報酬率", number(rate) + "%", rate >= 0 ? "up" : "down")}
  `;

  document.getElementById("portfolioBody").innerHTML = items.map(item => {
    const pnlCls = Number(item.unrealizedPnl) >= 0 ? "up" : "down";
    return `
      <tr>
        <td data-label="股票">${renderStockLink(item.symbol, item.name)}</td>
        <td data-label="股數">${number(item.quantity)}</td>
        <td data-label="平均成本">${number(item.avgCost)}</td>
        <td data-label="收盤價">${number(item.lastPrice)}</td>
        <td data-label="市值">${money(item.marketValue)}</td>
        <td data-label="未實現損益" class="${pnlCls}">${money(item.unrealizedPnl)}</td>
        <td data-label="報酬率" class="${pnlCls}">${number(item.unrealizedRate)}%</td>
        <td data-label="技術分數"><span class="${scoreClass(item.totalScore)}">${number(item.totalScore)}</span></td>
        <td data-label="風險分數">${number(item.riskScore)}</td>
        <td data-label="技術狀態"><span class="badge ${getBadgeClass(item.trendText)}">${escapeHtml(item.trendText || "觀察")}</span></td>
        <td data-label="資料日期">${escapeHtml(item.lastDate || data.dataDate || "-")}</td>
      </tr>
    `;
  }).join("");
}

function setPortfolioStatus(message, type) {
  const target = document.getElementById("portfolioStatus");
  if (!target) return;
  target.textContent = message || "";
  target.className = `muted portfolio-status ${type || ""}`;
}

function latestPortfolioDate(items) {
  return (items || []).map(item => String(item.lastDate || "")).filter(Boolean).sort().pop() || "";
}

async function loadAnalysis(symbol, forceRefresh = false) {
  symbol = normalizeSymbolInput(symbol);
  if (!symbol) return;

  activeAnalysisSymbol = symbol;
  const input = document.getElementById("analysisSymbol");
  if (input) input.value = symbol;

  if (!forceRefresh && analysisMemoryCache.has(symbol)) {
    renderAnalysis(analysisMemoryCache.get(symbol), symbol);
    setApiStatus("已載入線圖快取");
    return;
  }

  let request = analysisRequests.get(symbol);
  if (!request) {
    document.getElementById("mainChart").innerHTML = `<text x="40" y="80" fill="#94a3b8">線圖載入中...</text>`;
    request = Api.getAnalysis(symbol, forceRefresh)
      .then(data => {
        analysisMemoryCache.set(symbol, data);
        return data;
      })
      .finally(() => {
        analysisRequests.delete(symbol);
      });
    analysisRequests.set(symbol, request);
  }

  try {
    const data = await request;
    if (activeAnalysisSymbol !== symbol) return;
    renderAnalysis(data, symbol);
    setApiStatus("API 已連線");
  } catch (err) {
    if (activeAnalysisSymbol !== symbol) return;
    renderAnalysis(Mock.analysis, symbol);
    setApiStatus(err.message);
  }
}

function renderAnalysisLineControls() {
  const el = document.getElementById("analysisLineControls");
  if (!el) return;

  el.innerHTML = ANALYSIS_LINE_OPTIONS.map(option => `
    <label class="line-control">
      <input type="checkbox" data-line-key="${escapeHtml(option.key)}" ${analysisLineState[option.key] ? "checked" : ""} />
      <span class="line-swatch" style="background:${escapeHtml(option.color)}"></span>
      <span>${escapeHtml(option.label)}</span>
    </label>
  `).join("");
}

function onAnalysisLineToggle(event) {
  const input = event.target.closest("[data-line-key]");
  if (!input) return;

  const key = input.dataset.lineKey;
  analysisLineState[key] = input.checked;
  if (activeAnalysisData) {
    drawMainChart(activeAnalysisData.prices || [], (activeAnalysisData.portfolio || {}).avgCost || null, getSelectedAnalysisLines());
  }
}

function getSelectedAnalysisLines() {
  return ANALYSIS_LINE_OPTIONS.filter(option => analysisLineState[option.key]);
}

function renderAnalysis(data, symbol) {
  activeAnalysisData = data;
  document.getElementById("analysisTitle").textContent =
    `${data.symbol || symbol} ${data.name || ""} 線圖分析`;

  const latest = data.latest || {};
  const portfolio = data.portfolio || {};
  const cards = [
    ["收盤價", formatMetricNumber(latest.close, "")],
    ["MA20", formatMetricNumber(latest.ma20)],
    ["MA60", formatMetricNumber(latest.ma60)],
    ["RSI14", formatMetricNumber(latest.rsi14)],
    ["KD", formatMetricPair(latest.k9, latest.d9)],
    ["布林 %B", formatMetricNumber(latest.bbPercentB)],
    ["ATR %", formatMetricPercent(latest.atrPercent)],
    ["ADX14", formatMetricNumber(latest.adx14)],
    ["EMA20", formatMetricNumber(latest.ema20)],
    ["VWAP20", formatMetricNumber(latest.vwap20)],
    ["OBV / OBV MA20", formatMetricPair(latest.obv, latest.obvMa20)],
    ["MFI14", formatMetricNumber(latest.mfi14)],
    ["CCI20", formatMetricNumber(latest.cci20)],
    ["Williams %R", formatMetricNumber(latest.williamsR14)],
    ["ROC5 / ROC20", formatMetricPair(latest.roc5, latest.roc20)],
    ["SuperTrend", latest.superTrendDirection || formatMetricNumber(latest.superTrend)],
    ["Donchian 上 / 下", formatMetricPair(latest.donchianHigh20, latest.donchianLow20)],
    ["20 日高 / 低", formatMetricPair(latest.high20, latest.low20)],
    ["技術分數", formatMetricNumber(latest.totalScore)],
    ["風險分數", formatMetricNumber(latest.riskScore)],
    ["技術狀態", latest.trendText || "觀察"],
    ["平均成本", formatMetricNumber(portfolio.avgCost, "無庫存")]
  ];

  document.getElementById("indicatorCards").innerHTML = cards.map(([label, value]) => `
    <div class="metric">
      <div class="label">${label}</div>
      <div class="num ${value === "尚未計算" || value === "無庫存" ? "num-muted" : ""}">${escapeHtml(String(value ?? ""))}</div>
    </div>
  `).join("");

  renderAnalysisDataNotice(data);
  drawMainChart(data.prices || [], portfolio.avgCost || null, getSelectedAnalysisLines());

  const signals = data.signals || [];
  document.getElementById("signalsBox").innerHTML = signals.length
    ? signals.map(s => `
        <div class="signal ${signalClass(s.direction)}">
          <strong>${escapeHtml(s.date || "")} ${escapeHtml(s.signalName || "")}</strong>
          <div class="muted">${escapeHtml(s.note || "")}</div>
        </div>
      `).join("")
    : `<div class="muted">目前沒有近期訊號。</div>`;
}

function hasMetricValue(value) {
  if (value === "" || value === null || value === undefined) return false;
  return isFinite(Number(value));
}

function formatMetricNumber(value, fallback = "尚未計算") {
  return hasMetricValue(value) ? number(value) : fallback;
}

function formatMetricPercent(value, fallback = "尚未計算") {
  return hasMetricValue(value) ? number(Number(value) * 100) + "%" : fallback;
}

function formatMetricPair(left, right, fallback = "尚未計算") {
  return hasMetricValue(left) && hasMetricValue(right) ? `${number(left)} / ${number(right)}` : fallback;
}

function renderAnalysisDataNotice(data) {
  const el = document.getElementById("analysisDataNotice");
  if (!el) return;

  const status = data && data.technicalStatus ? data.technicalStatus : null;
  if (!status || status.ok) {
    el.hidden = true;
    el.textContent = "";
    return;
  }

  el.hidden = false;
  el.textContent = status.message || "部分技術指標尚未計算，請重新整理或重新計算分析資料。";
}

async function loadTransactions(options = {}) {
  const state = paginationState.transactions;
  if (state.loading) return;
  const append = options.append === true;
  if (!append) state.offset = 0;
  const cached = pageDataCache.transactions || getCachedTransactions();
  if (cached && !append) {
    renderTransactions(cached.items || []);
    setApiStatus("已顯示交易快取，正在背景更新");
  } else if (!append) {
    renderTableLoading("transactionsBody", 9, "交易紀錄載入中");
  }
  state.loading = true;
  updateLoadMoreButton("btnLoadMoreTransactions", false, true);
  try {
    const data = await Api.getTransactions({ limit: state.limit, offset: state.offset });
    const previousItems = append && pageDataCache.transactions ? pageDataCache.transactions.items || [] : [];
    const merged = Object.assign({}, data, { items: previousItems.concat(data.items || []) });
    pageDataCache.transactions = merged;
    state.hasMore = Boolean(data.hasMore);
    state.offset = merged.items.length;
    saveTransactionsCache(merged);
    renderTransactions(merged.items);
    setApiStatus("交易紀錄已更新");
  } catch (err) {
    if (!cached) renderTransactions(Mock.transactions.items || []);
    setApiStatus("交易紀錄載入失敗：" + err.message);
  } finally {
    state.loading = false;
    updateLoadMoreButton("btnLoadMoreTransactions", state.hasMore, false);
  }
}

function renderTransactions(items) {
  document.getElementById("transactionsBody").innerHTML = (items || []).map(item => {
    const id = escapeHtml(String(item.id || ""));
    let actionHtml = `<button class="danger-btn" type="button" data-action="delete-transaction" data-id="${id}">刪除</button>`;
    if (item.pending) actionHtml = '<span class="transaction-status pending">儲存中</span>';
    if (item.error) actionHtml = `<div class="transaction-error-actions"><button type="button" data-action="retry-pending-transaction" data-id="${id}">重試</button><button class="danger-btn" type="button" data-action="remove-pending-transaction" data-id="${id}">移除</button></div>`;
    return `
    <tr class="${item.pending ? "is-pending" : ""} ${item.error ? "is-error" : ""}">
      <td data-label="日期">${escapeHtml(item.date || "")}</td>
      <td data-label="類型">${escapeHtml(item.action || "")}</td>
      <td data-label="股票">${renderStockLink(item.symbol, item.name)}</td>
      <td data-label="股數">${number(item.quantity)}</td>
      <td data-label="價格">${number(item.price)}</td>
      <td data-label="手續費">${number(item.fee)}</td>
      <td data-label="稅">${number(item.tax)}</td>
      <td data-label="備註">${escapeHtml(item.note || "")}</td>
      <td data-label="操作">${actionHtml}</td>
    </tr>
  `;
  }).join("");
}

async function onSubmitTransaction(event) {
  event.preventDefault();

  const form = event.currentTarget;
  const formData = new FormData(form);
  const payload = Object.fromEntries(formData.entries());
  payload.tradeAction = payload.action;
  delete payload.action;
  payload.market = "TW";
  payload.currency = "TWD";
  payload.symbol = normalizeSymbolInput(payload.symbol);

  const message = document.getElementById("formMessage");
  const optimisticItem = {
    id: "PENDING_" + Date.now(),
    date: payload.date,
    action: payload.tradeAction,
    symbol: payload.symbol,
    name: "",
    quantity: payload.quantity,
    price: payload.price,
    fee: payload.fee,
    tax: payload.tax,
    note: payload.note,
    pending: true,
    error: false,
    retryPayload: payload
  };

  addCachedTransaction(optimisticItem);
  message.textContent = "已先加入畫面，正在同步...";
  form.reset();
  const dateInput = document.querySelector("input[name='date']");
  if (dateInput) dateInput.valueAsDate = new Date();

  try {
    const result = await Api.addTransaction(payload);
    replaceCachedTransaction(optimisticItem.id, Object.assign({}, result.transaction || {}, {
      id: result.id || (result.transaction && result.transaction.id) || optimisticItem.id,
      name: (result.stock && result.stock.name) || (result.transaction && result.transaction.name) || "",
      pending: false,
      error: false,
      retryPayload: null
    }));
    clearCache(CACHE_KEYS.dashboard);
    pageDataCache.dashboard = null;
    pageDataCache.portfolio = null;
    message.textContent = "新增成功，庫存正在背景更新";
    showToast("交易已儲存，庫存正在背景更新", "success");
    refreshPortfolioAfterTransaction();
  } catch (err) {
    message.textContent = "新增失敗：" + err.message;
    replaceCachedTransaction(optimisticItem.id, { pending: false, error: true, errorMessage: err.message });
    showToast("交易儲存失敗，可在列表重試", "error");
  }
}

async function retryPendingTransaction(id) {
  const cached = pageDataCache.transactions || getCachedTransactions();
  const item = cached && (cached.items || []).find(row => String(row.id || "") === String(id));
  if (!item || !item.retryPayload) return;
  replaceCachedTransaction(id, { pending: true, error: false });
  try {
    const result = await Api.addTransaction(item.retryPayload);
    replaceCachedTransaction(id, Object.assign({}, result.transaction || {}, {
      id: result.id || (result.transaction && result.transaction.id) || id,
      name: (result.stock && result.stock.name) || (result.transaction && result.transaction.name) || item.name || "",
      pending: false,
      error: false,
      retryPayload: null
    }));
    showToast("交易重試成功", "success");
    refreshPortfolioAfterTransaction();
  } catch (err) {
    replaceCachedTransaction(id, { pending: false, error: true, errorMessage: err.message });
    showToast("重試失敗：" + err.message, "error");
  }
}

function refreshPortfolioAfterTransaction() {
  setTimeout(() => {
    Api.getPortfolio(true).then(data => {
      if (data && data.stale && typeof Api.refreshPortfolio === "function") {
        return Api.refreshPortfolio();
      }
      return data;
    }).then(data => {
      pageDataCache.portfolio = data;
      if (!data.stale) showToast("庫存背景更新完成", "success");
    }).catch(() => null);
  }, 65000);
}

async function onDeleteTransaction(btn) {
  const id = btn.dataset.id;
  if (!id) return;

  const ok = confirm("確定要刪除這筆交易紀錄嗎？");
  if (!ok) return;

  const cached = pageDataCache.transactions || getCachedTransactions();
  const previousItems = cached ? (cached.items || []).slice() : null;
  if (cached) {
    cached.items = (cached.items || []).filter(item => String(item.id || "") !== id);
    pageDataCache.transactions = cached;
    saveTransactionsCache(cached);
    renderTransactions(cached.items || []);
  }

  try {
    btn.disabled = true;
    setApiStatus("正在刪除交易紀錄...");
    await Api.deleteTransaction(id);
    clearCache(CACHE_KEYS.dashboard);
    pageDataCache.dashboard = null;
    pageDataCache.portfolio = null;
    setApiStatus("已刪除交易紀錄，庫存正在背景更新");
    showToast("交易已刪除", "success");
    refreshPortfolioAfterTransaction();
  } catch (err) {
    setApiStatus("刪除交易失敗：" + err.message);
    if (previousItems) {
      cached.items = previousItems;
      pageDataCache.transactions = cached;
      saveTransactionsCache(cached);
      renderTransactions(previousItems);
    }
    showToast("刪除失敗，已恢復原紀錄", "error");
  } finally {
    btn.disabled = false;
  }
}

function drawMainChart(rows, cost, technicalLines = getSelectedAnalysisLines()) {
  const svg = document.getElementById("mainChart");
  const tooltip = document.getElementById("chartTooltip");
  const width = 920;
  const height = 420;
  const pad = 44;

  const validRows = rows.filter(r => isFinite(Number(r.close)));
  if (tooltip) tooltip.hidden = true;
  if (!validRows.length) {
    svg.innerHTML = `<text x="40" y="80" fill="#94a3b8">沒有價格資料</text>`;
    return;
  }

  const closes = validRows.map(r => Number(r.close));
  const selectedLineValues = technicalLines.flatMap(option => validRows.map(r => Number(r[option.key])).filter(v => isFinite(v)));
  const all = closes.concat(selectedLineValues);
  if (cost) all.push(Number(cost));

  const min = Math.min(...all) * 0.97;
  const max = Math.max(...all) * 1.03;

  function x(i, arr) {
    return pad + i * ((width - pad * 2) / Math.max(arr.length - 1, 1));
  }

  function y(v) {
    return height - pad - ((v - min) / (max - min || 1)) * (height - pad * 2);
  }

  function pointsBy(key) {
    return validRows
      .map((r, i) => ({ value: Number(r[key]), i }))
      .filter(p => isFinite(p.value))
      .map(p => `${x(p.i, validRows)},${y(p.value)}`)
      .join(" ");
  }

  const grid = [];
  for (let i = 0; i < 5; i++) {
    const gy = pad + i * ((height - pad * 2) / 4);
    grid.push(`<line x1="${pad}" y1="${gy}" x2="${width - pad}" y2="${gy}" stroke="#1f2937" stroke-width="1" />`);
  }

  const last = validRows[validRows.length - 1];
  const lastX = x(validRows.length - 1, validRows);
  const lastY = y(Number(last.close));
  const chartPoints = validRows.map((row, i) => ({
    x: x(i, validRows),
    y: y(Number(row.close)),
    row: row
  }));

  let costLine = "";
  if (cost && isFinite(Number(cost))) {
    const cy = y(Number(cost));
    costLine = `
      <line x1="${pad}" y1="${cy}" x2="${width - pad}" y2="${cy}" stroke="#eab308" stroke-width="2" stroke-dasharray="8 8" />
      <text x="${width - pad - 96}" y="${cy - 8}" fill="#eab308" font-size="13">成本 ${number(cost)}</text>
    `;
  }

  const technicalLineSvg = technicalLines.map(option => {
    const points = pointsBy(option.key);
    if (!points) return "";
    const dash = option.dash ? ` stroke-dasharray="${escapeHtml(option.dash)}"` : "";
    return `<polyline points="${points}" fill="none" stroke="${escapeHtml(option.color)}" stroke-width="2.5" opacity="0.92"${dash} />`;
  }).join("");

  svg.innerHTML = `
    <defs>
      <linearGradient id="areaGreen" x1="0" x2="0" y1="0" y2="1">
        <stop offset="0%" stop-color="#22c55e" stop-opacity="0.24" />
        <stop offset="100%" stop-color="#22c55e" stop-opacity="0" />
      </linearGradient>
    </defs>
    ${grid.join("")}
    ${costLine}
    ${technicalLineSvg}
    <polygon points="${pointsBy("close")} ${lastX},${height - pad} ${pad},${height - pad}" fill="url(#areaGreen)" />
    <polyline points="${pointsBy("close")}" fill="none" stroke="#22c55e" stroke-width="4" />
    <circle cx="${lastX}" cy="${lastY}" r="6" fill="#22c55e" stroke="#052e16" stroke-width="3" />
    <text x="${lastX - 46}" y="${lastY - 14}" fill="#e5e7eb" font-size="14">${number(last.close)}</text>
    <g id="chartHoverLayer" class="chart-hover-layer" style="display:none">
      <line id="chartHoverLine" x1="${lastX}" y1="${pad}" x2="${lastX}" y2="${height - pad}" />
      <circle id="chartHoverDot" cx="${lastX}" cy="${lastY}" r="7" />
    </g>
    <line x1="${pad}" y1="${pad}" x2="${pad}" y2="${height - pad}" stroke="#334155" />
    <line x1="${pad}" y1="${height - pad}" x2="${width - pad}" y2="${height - pad}" stroke="#334155" />
    <text x="${pad}" y="${height - 14}" fill="#94a3b8" font-size="13">${escapeHtml(validRows[0].date || "")}</text>
    <text x="${width - pad - 90}" y="${height - 14}" fill="#94a3b8" font-size="13">${escapeHtml(last.date || "")}</text>
  `;

  bindMainChartHover(svg, tooltip, chartPoints, { width, height, pad, cost, technicalLines });
}

function bindMainChartHover(svg, tooltip, points, config) {
  if (!svg || !tooltip || !points.length) return;

  const layer = svg.querySelector("#chartHoverLayer");
  const line = svg.querySelector("#chartHoverLine");
  const dot = svg.querySelector("#chartHoverDot");
  const width = config.width;
  const pad = config.pad;
  const step = (width - pad * 2) / Math.max(points.length - 1, 1);

  function showPoint(index, event) {
    const point = points[Math.max(0, Math.min(points.length - 1, index))];
    const row = point.row || {};
    const cost = Number(config.cost);

    if (layer) layer.style.display = "";
    if (line) {
      line.setAttribute("x1", point.x);
      line.setAttribute("x2", point.x);
    }
    if (dot) {
      dot.setAttribute("cx", point.x);
      dot.setAttribute("cy", point.y);
    }

    const parts = [
      `<strong>${escapeHtml(row.date || "")}</strong>`,
      `<span>收盤價 ${number(row.close)}</span>`
    ];
    (config.technicalLines || []).forEach(option => {
      const value = Number(row[option.key]);
      if (isFinite(value)) parts.push(`<span>${escapeHtml(option.label)} ${number(value)}</span>`);
    });
    if (isFinite(cost) && cost > 0) parts.push(`<span>平均成本 ${number(cost)}</span>`);

    tooltip.innerHTML = parts.join("");
    tooltip.hidden = false;

    const wrap = svg.parentElement;
    const svgRect = svg.getBoundingClientRect();
    const wrapRect = wrap.getBoundingClientRect();
    const leftInSvg = (point.x / width) * svgRect.width;
    const tooltipWidth = tooltip.offsetWidth || 160;
    const top = event.clientY - wrapRect.top - 62;
    const left = svgRect.left - wrapRect.left + leftInSvg + 12;
    const boundedLeft = Math.max(8, Math.min(left, wrapRect.width - tooltipWidth - 8));

    tooltip.style.left = `${boundedLeft}px`;
    tooltip.style.top = `${Math.max(8, top)}px`;
  }

  function onMove(event) {
    const rect = svg.getBoundingClientRect();
    if (!rect.width) return;
    const svgX = (event.clientX - rect.left) * (width / rect.width);
    const index = Math.round((svgX - pad) / step);
    showPoint(index, event);
  }

  function hide() {
    if (layer) layer.style.display = "none";
    tooltip.hidden = true;
  }

  svg.onpointermove = onMove;
  svg.onpointerleave = hide;
}

function sparkline(values, color = "#22c55e", width = 150, height = 36) {
  const arr = values.map(Number).filter(v => isFinite(v));
  if (!arr.length) return "";
  const min = Math.min(...arr);
  const max = Math.max(...arr);
  const points = arr.map((v, i) => {
    const x = i * (width / Math.max(arr.length - 1, 1));
    const y = height - ((v - min) / (max - min || 1)) * (height - 6) - 3;
    return `${x},${y}`;
  }).join(" ");

  return `
    <svg class="sparkline" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}" preserveAspectRatio="none">
      <polyline points="${points}" fill="none" stroke="${color}" stroke-width="3" />
    </svg>
  `;
}

function summaryCard(title, value, cls) {
  return `
    <div class="card">
      <div class="card-title">${title}</div>
      <div class="card-value ${cls || ""}">${value}</div>
    </div>
  `;
}


function displaySymbol(symbol, name) {
  return String(symbol ?? "").trim();
}

function normalizeSymbolInput(value) {
  const s = String(value ?? "").trim();
  return s.startsWith("'") ? s.slice(1).trim() : s;
}

function normalizeSymbolListInput(value) {
  return String(value ?? "")
    .split(/[\s,，、;；]+/)
    .map(normalizeSymbolInput)
    .filter(Boolean)
    .join(",");
}

function formatLocalDate(date) {
  const d = date instanceof Date ? date : new Date(date);
  const year = d.getFullYear();
  const month = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function getBadgeClass(text) {
  if (!text) return "";
  if (text.includes("偏弱") || text.includes("偏空") || text.includes("空頭") || text.includes("風險")) return "danger";
  if (text.includes("盤整") || text.includes("中性") || text.includes("過熱") || text.includes("觀察")) return "warn";
  return "";
}

function signalClass(direction) {
  if (direction === "bearish") return "danger";
  if (direction === "risk" || direction === "watch") return "risk";
  return "";
}

function number(value) {
  const n = Number(value);
  if (!isFinite(n)) return "";
  return n.toLocaleString("zh-TW", { maximumFractionDigits: 2 });
}

function money(value) {
  const n = Number(value);
  if (!isFinite(n)) return "";
  return n.toLocaleString("zh-TW", { maximumFractionDigits: 0 });
}

function escapeHtml(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

/* StockLab v11 extension: lazy pages, request-friendly renderers, and compact mobile UI. */
const pageDataCache = {
  dashboard: null,
  portfolio: null,
  candidates: null,
  candidateLeaderboard: null,
  marketSummary: null,
  strategyResearch: null,
  strategyHealth: null,
  stats: null,
  notifications: null,
  paperSummary: null,
  backtestRuns: null,
  transactions: null,
  analysis: {},
  stockDetail: {}
};

const paginationState = {
  transactions: { limit: 50, offset: 0, hasMore: false, loading: false },
  notifications: { limit: 50, offset: 0, hasMore: false, loading: false },
  paperTrades: { limit: 50, offset: 0, hasMore: false, loading: false },
  backtestRuns: { limit: 20, offset: 0, hasMore: false, loading: false }
};

Object.assign(pages, {
  leaderboard: { title: "候選排行", subtitle: "買進與賣出候選依信心、風險與模型命中排序", loader: loadCandidateLeaderboard },
  market: { title: "市場總覽", subtitle: "大盤、廣度、關注清單與風險模式", loader: loadMarketSummary },
  strategyResearch: { title: "策略研究", subtitle: "彙整策略模型的回測表現與適用情境", loader: loadStrategyResearch },
  strategyHealth: { title: "策略健康", subtitle: "用近期回測與虛擬交易觀察模型穩定度", loader: loadStrategyHealthPage },
  notifications: { title: "通知中心", subtitle: "候選、風險、策略與資料更新提醒", loader: loadNotifications },
  stats: { title: "統計中心", subtitle: "資料列、交易、策略與候選摘要", loader: loadStats },
  stockDetail: { title: "股票詳情", subtitle: "單一股票的技術、候選與持倉摘要", loader: loadStockDetailFromInput }
});

window.addEventListener("DOMContentLoaded", () => {
  const detailButton = document.getElementById("btnLoadStockDetail");
  if (detailButton) detailButton.addEventListener("click", () => loadStockDetailFromInput(true));
  const detailInput = document.getElementById("stockDetailSymbol");
  if (detailInput) detailInput.addEventListener("keydown", event => {
    if (event.key === "Enter") loadStockDetailFromInput();
  });
  const clearButton = document.getElementById("btnClearNotifications");
  if (clearButton) clearButton.addEventListener("click", clearV11Notifications);
  const notificationButton = document.getElementById("btnNotificationCenter");
  if (notificationButton) notificationButton.addEventListener("click", () => changePage("notifications"));
  const moreNotifications = document.getElementById("btnLoadMoreNotifications");
  if (moreNotifications) moreNotifications.addEventListener("click", () => loadNotifications({ append: true }));
  const moreTransactions = document.getElementById("btnLoadMoreTransactions");
  if (moreTransactions) moreTransactions.addEventListener("click", () => loadTransactions({ append: true }));
  const morePaperTrades = document.getElementById("btnLoadMorePaperTrades");
  if (morePaperTrades) morePaperTrades.addEventListener("click", () => loadPaperSummary({ append: true }));
  const moreBacktestRuns = document.getElementById("btnLoadMoreBacktestRuns");
  if (moreBacktestRuns) moreBacktestRuns.addEventListener("click", () => loadBacktestRuns({ append: true }));
  const mobileMore = document.getElementById("btnMobileMore");
  if (mobileMore) mobileMore.addEventListener("click", openMobileMore);
  buildMobileMoreLinks();
  loadNotificationSummary();
});

async function loadV11PageWithCache(cacheKey, fetcher, renderFn, fallbackBuilder) {
  const cached = pageDataCache[cacheKey];
  if (cached) renderFn(cached, { stale: true });
  else renderV11Loading(cacheKey);

  try {
    const data = await fetcher();
    pageDataCache[cacheKey] = data;
    if (!cached || !sameCachedVersion(cached, data)) renderFn(data, { stale: false });
    setApiStatus("v11 資料已更新");
  } catch (err) {
    if (cached) {
      setApiStatus("v11 API 暫時失敗，已顯示快取：" + err.message);
      return;
    }
    const fallback = typeof fallbackBuilder === "function" ? fallbackBuilder(err) : { ok: false, message: err.message };
    renderFn(fallback, { stale: false, error: err });
    setApiStatus("v11 API 尚未可用：" + err.message);
  }
}

function sameCachedVersion(previous, next) {
  if (!previous || !next) return false;
  const previousStamp = previous.updatedAt || previous.dataDate || previous.version || "";
  const nextStamp = next.updatedAt || next.dataDate || next.version || "";
  return Boolean(previousStamp && nextStamp && String(previousStamp) === String(nextStamp));
}

function renderV11Loading(cacheKey) {
  const map = {
    candidateLeaderboard: "leaderboardBody",
    marketSummary: "marketSummaryBody",
    strategyResearch: "strategyResearchBody",
    strategyHealth: "strategyHealthBody",
    stats: "statsBody",
    notifications: "notificationsBody"
  };
  const target = document.getElementById(map[cacheKey]);
  if (target) target.innerHTML = Array.from({ length: 3 }).map(() => '<div class="v11-card skeleton-card"></div>').join("");
}

function loadCandidateLeaderboard() {
  return loadV11PageWithCache(
    "candidateLeaderboard",
    () => Api.getCandidateLeaderboard ? Api.getCandidateLeaderboard() : Api.getCandidates(),
    renderCandidateLeaderboard,
    () => buildLeaderboardFallback(currentCandidateData)
  );
}

function buildLeaderboardFallback(source) {
  const buy = (source && source.buyCandidates) || [];
  const sell = (source && source.sellCandidates) || [];
  return { ok: true, dataDate: source && source.dataDate, items: buy.map(x => Object.assign({ candidateType: "BUY" }, x)).concat(sell.map(x => Object.assign({ candidateType: "SELL" }, x))) };
}

function renderCandidateLeaderboard(data) {
  const items = Array.isArray(data.items) ? data.items : [];
  const ranked = items.slice().sort((a, b) => Number(b.confidenceScore || b.buyScore || b.sellScore || b.totalScore || 0) - Number(a.confidenceScore || a.buyScore || a.sellScore || a.totalScore || 0));
  document.getElementById("leaderboardSummary").innerHTML = [
    summaryCard("買進候選", ranked.filter(x => String(x.candidateType).toUpperCase() === "BUY").length, ""),
    summaryCard("賣出候選", ranked.filter(x => String(x.candidateType).toUpperCase() === "SELL").length, ""),
    summaryCard("資料日期", escapeHtml(data.dataDate || "-"), ""),
    summaryCard("更新時間", escapeHtml(data.updatedAt || "-"), "")
  ].join("");
  document.getElementById("leaderboardBody").innerHTML = ranked.slice(0, 30).map((item, index) => renderV11CandidateCard(item, index + 1)).join("") || renderV11Empty("目前沒有候選排行資料");
}

function renderV11CandidateCard(item, rank) {
  const type = String(item.candidateType || "BUY").toUpperCase();
  const score = Number(item.confidenceScore || item.buyScore || item.sellScore || item.totalScore || 0);
  const reasons = normalizeTextList(item.reasonList || item.reason || item.actionSuggestion);
  const risks = normalizeTextList(item.riskList);
  return `<article class="v11-card">
    <div class="v11-card-head"><strong>${number(item.rank || rank)}. ${renderStockLink(item.symbol, item.name)}</strong><span class="pill ${type === "SELL" ? "danger" : ""}">${type === "SELL" ? "賣出" : "買進"}</span></div>
    <div class="v11-score"><span>${number(score)}</span><small>${escapeHtml(item.gradeText || scoreToGradeText(score))} · ${renderStars(item.stars || scoreToStars(score))}</small></div>
    <div class="matched-models">${renderModelTags(item.matchedModelNames || item.matchedModels || item.strategyName, 2)}</div>
    <div class="v11-meta">收盤 ${number(item.close)} · RSI ${number(item.rsi14)} · 風險 ${number(item.riskScore)}</div>
    <div class="candidate-action">${escapeHtml(item.actionSuggestion || "")}</div>
    <details class="candidate-details"><summary>查看理由與風險</summary>
      ${reasons.length ? `<ul class="v11-reasons">${reasons.map(text => `<li>${escapeHtml(text)}</li>`).join("")}</ul>` : ""}
      ${risks.length ? `<ul class="v11-risk-list">${risks.map(text => `<li>${escapeHtml(text)}</li>`).join("")}</ul>` : ""}
    </details>
  </article>`;
}

function loadMarketSummary() {
  return loadV11PageWithCache("marketSummary", () => Api.getMarketSummary(), renderMarketSummary, () => ({ ok: false, summaryText: "等待後端 v11 marketSummary 部署" }));
}

function renderMarketSummary(data) {
  const taiex = data.taiex || {};
  const breadth = data.breadth || {};
  const watch = data.watchlistMarket || {};
  const sectors = data.sectorProxy || {};
  document.getElementById("marketSummaryCards").innerHTML = [
    summaryCard("TAIEX", number(taiex.close), Number(taiex.change) >= 0 ? "up" : "down"),
    summaryCard("大盤模式", escapeHtml(data.marketMode || taiex.trendText || "-"), ""),
    summaryCard("上漲比率", number(breadth.upRatio) + "%", Number(breadth.upRatio) >= 50 ? "up" : "down"),
    summaryCard("關注均分", number(watch.avgScore), "")
  ].join("");
  document.getElementById("marketSummaryBody").innerHTML = `
    <div class="v11-card"><strong>${escapeHtml(data.summaryText || "尚無市場摘要")}</strong><p>${escapeHtml(data.riskText || "")}</p></div>
    <div class="v11-grid compact">
      ${renderKeyValueCard("TAIEX MA20 / MA60", `${number(taiex.ma20)} / ${number(taiex.ma60)}`)}
      ${renderKeyValueCard("強勢 / 弱勢", `${number(breadth.strongCount)} / ${number(breadth.weakCount)}`)}
      ${renderKeyValueCard("過熱 / 超跌", `${number(breadth.overheatCount)} / ${number(breadth.oversoldCount)}`)}
      ${renderKeyValueCard("Risk On", data.marketRiskOn ? "是" : "否")}
    </div>
    <div class="v11-card"><strong>產業代理分數</strong><div class="period-status">
      <span>半導體 ${number(sectors.semiconductor)}</span><span>AI 伺服器 ${number(sectors.aiServer)}</span><span>金融 ${number(sectors.financial)}</span><span>航運 ${number(sectors.shipping)}</span><span>ETF ${number(sectors.etf)}</span>
    </div></div>`;
}

function loadStrategyHealthPage() {
  return loadV11PageWithCache("strategyHealth", () => Api.getStrategyHealth(), renderStrategyHealth, () => ({ ok: false, models: [] }));
}

function loadStrategyResearch() {
  return loadV11PageWithCache("strategyResearch", () => Api.getStrategyResearch(), renderStrategyResearch, () => ({ ok: false, items: [] }));
}

function renderStrategyHealth(data) {
  const models = Array.isArray(data.models) ? data.models : [];
  const avg = models.length ? models.reduce((sum, x) => sum + Number(x.healthScore || 0), 0) / models.length : 0;
  document.getElementById("strategyHealthCards").innerHTML = [
    summaryCard("模型數", models.length, ""),
    summaryCard("平均健康分", number(avg), avg >= 70 ? "up" : "warn"),
    summaryCard("警示模型", models.filter(x => (x.warningList || []).length).length, "down"),
    summaryCard("資料日期", escapeHtml(data.dataDate || "-"), "")
  ].join("");
  document.getElementById("strategyHealthBody").innerHTML = models.map(model => `<article class="v11-card">
    <div class="v11-card-head"><strong>${escapeHtml(model.strategyName || model.strategyType)}</strong><span class="pill">${number(model.healthScore)}</span></div>
    <div class="v11-meta">30日勝率 ${number(model.winRate30)}% · 90日 PF ${number(model.profitFactor90)} · 最大回撤 ${number(model.maxDrawdown90)}%</div>
    <div>${escapeHtml(model.healthText || "")}</div>
    ${normalizeTextList(model.warningList).length ? `<ul class="v11-reasons">${normalizeTextList(model.warningList).map(x => `<li>${escapeHtml(x)}</li>`).join("")}</ul>` : ""}
  </article>`).join("") || renderV11Empty("尚無策略健康資料");
}

function renderStrategyResearch(data) {
  const items = Array.isArray(data.items) ? data.items : Array.isArray(data.models) ? data.models : [];
  document.getElementById("strategyResearchBody").innerHTML = items.map(item => `<article class="v11-card">
    <div class="v11-card-head"><strong>${escapeHtml(item.strategyName || item.strategyType || "策略")}</strong><span class="pill">${escapeHtml(item.healthStatus || "-")}</span></div>
    <div class="v11-meta">交易 ${number(item.tradeCount)} · 勝率 ${number(item.winRate)}% · 累計報酬 ${number(item.totalReturn)}% · 平均報酬 ${number(item.avgReturn)}%</div>
    <div class="v11-meta">PF ${number(item.profitFactor)} · 最大回撤 ${number(item.maxDrawdown)}% · 平均持有 ${number(item.avgHoldingDays)} 日</div>
    <div class="period-status"><span>30 天 ${escapeHtml(item.status30 || "樣本不足")}</span><span>90 天 ${escapeHtml(item.status90 || "樣本不足")}</span><span>180 天 ${escapeHtml(item.status180 || "樣本不足")}</span></div>
    <p>${escapeHtml(item.summaryText || item.description || "")}</p>
    <div class="v11-meta">適合：${escapeHtml(item.bestFor || item.applicableType || "-")}<br>不適合：${escapeHtml(item.notBestFor || "-")}</div>
  </article>`).join("") || renderV11Empty("尚無策略研究資料");
}

async function loadNotifications(options = {}) {
  const state = paginationState.notifications;
  if (state.loading) return;
  const append = options.append === true;
  if (!append) state.offset = 0;
  const cached = pageDataCache.notifications;
  if (cached && !append) renderNotifications(cached, { stale: true });
  else if (!append) renderV11Loading("notifications");
  state.loading = true;
  updateLoadMoreButton("btnLoadMoreNotifications", false, true);
  try {
    const data = await Api.getNotifications({ limit: state.limit, offset: state.offset });
    const previousItems = append && cached ? cached.items || [] : [];
    const merged = Object.assign({}, data, { items: previousItems.concat(data.items || []) });
    pageDataCache.notifications = merged;
    state.hasMore = Boolean(data.hasMore);
    state.offset = merged.items.length;
    renderNotifications(merged);
    updateNotificationBadge(data.unreadCount);
  } catch (err) {
    if (!cached) showPageError("notificationsBody", err);
    else setApiStatus("通知資料可能不是最新：" + err.message);
  } finally {
    state.loading = false;
    updateLoadMoreButton("btnLoadMoreNotifications", state.hasMore, false);
  }
}

function renderNotifications(data) {
  const items = Array.isArray(data.items) ? data.items : [];
  document.getElementById("notificationsBody").innerHTML = items.map(item => `<article class="notification-card ${String(item.level || "info").toLowerCase()} ${isNotificationRead(item) ? "is-read" : "is-unread"}">
    <div class="v11-card-head"><strong>${escapeHtml(item.title || item.type || "通知")}</strong><span>${escapeHtml(item.date || item.createdAt || "")}</span></div>
    <div class="notification-message">${escapeHtml(item.message || "")}</div>
    <div class="notification-footer"><div class="v11-meta">${item.symbol ? renderStockLink(item.symbol, item.name) : ""} · ${escapeHtml(item.source || "StockLab")}</div>${isNotificationRead(item) ? "" : `<button type="button" data-action="mark-notification-read" data-id="${escapeHtml(String(item.id || ""))}">標為已讀</button>`}</div>
  </article>`).join("") || renderV11Empty("目前沒有通知");
}

async function clearV11Notifications() {
  if (!Api.clearNotifications) return;
  await Api.clearNotifications();
  pageDataCache.notifications = null;
  paginationState.notifications.offset = 0;
  updateNotificationBadge(0);
  await loadNotifications();
}

function loadStats() {
  return loadV11PageWithCache("stats", () => Api.getStats(), renderStats, () => ({ ok: false }));
}

function renderStats(data) {
  document.getElementById("statsCards").innerHTML = [
    summaryCard("關注股票", number(data.watchlistCount), ""),
    summaryCard("庫存股票", number(data.portfolioCount), ""),
    summaryCard("交易紀錄", number(data.transactionCount), ""),
    summaryCard("價格資料", number(data.priceRows), "")
  ].join("");
  const fields = [
    ["技術指標資料", "indicatorRows"], ["回測次數", "backtestRunCount"], ["虛擬策略", "paperStrategyCount"], ["虛擬交易", "paperTradeCount"],
    ["買入候選", "candidateBuyCount"], ["賣出候選", "candidateSellCount"], ["最佳策略", "bestStrategy"], ["最佳候選", "bestSymbol"],
    ["最佳 ETF", "bestEtf"], ["最佳股票", "bestStock"], ["平均勝率", "avgWinRate"], ["平均 PF", "avgProfitFactor"],
    ["平均持有天數", "avgHoldingDays"], ["平均交易報酬", "avgTradeReturn"], ["最後資料日", "lastDataDate"], ["最後更新", "lastUpdateAt"]
  ];
  document.getElementById("statsBody").innerHTML = fields.map(([label, key]) => renderKeyValueCard(label, data[key])).join("");
}

function loadStockDetailFromInput(forceRefresh = false) {
  const input = document.getElementById("stockDetailSymbol");
  const symbol = normalizeSymbolInput(input && input.value);
  if (!symbol) {
    const body = document.getElementById("stockDetailBody");
    if (body) body.innerHTML = renderV11Empty("請輸入股票代號");
    return;
  }
  return loadStockDetail(symbol, forceRefresh === true);
}

async function loadStockDetail(symbol, forceRefresh = false) {
  symbol = normalizeSymbolInput(symbol);
  if (forceRefresh) delete pageDataCache.stockDetail[symbol];
  const cached = pageDataCache.stockDetail[symbol];
  if (cached) renderStockDetail(cached);
  try {
    const data = Api.getStockDetail ? await Api.getStockDetail(symbol, forceRefresh) : await Api.getAnalysis(symbol, forceRefresh);
    pageDataCache.stockDetail[symbol] = data;
    renderStockDetail(data);
  } catch (err) {
    try {
      const fallback = await Api.getAnalysis(symbol, forceRefresh);
      pageDataCache.stockDetail[symbol] = fallback;
      renderStockDetail(fallback);
    } catch (fallbackErr) {
      renderStockDetail({ ok: false, symbol, message: fallbackErr.message });
    }
  }
}

function renderStockDetail(data) {
  if (!data || data.ok === false) {
    showPageError("stockDetailBody", new Error((data && data.message) || "股票詳細資料讀取失敗"));
    return;
  }
  const latest = data.latest || data.indicator || {};
  const candidate = data.candidate || {};
  const portfolio = data.portfolio || {};
  document.getElementById("stockDetailTitle").textContent = `${data.symbol || ""} ${data.name || ""} 股票詳情`;
  const technicalFields = [
    ["收盤價", latest.close || data.close], ["MA5 / MA20 / MA60", [latest.ma5, latest.ma20, latest.ma60].map(number).join(" / ")],
    ["RSI14", latest.rsi14], ["MACD Histogram", latest.macdHist], ["KD", `${number(latest.k9)} / ${number(latest.d9)}`],
    ["布林 %B", latest.bbPercentB], ["ATR %", latest.atrPercent], ["ADX", latest.adx14], ["OBV", latest.obv],
    ["MFI14", latest.mfi14], ["CCI20", latest.cci20], ["Williams %R", latest.williamsR14],
    ["ROC 5 / 20", `${number(latest.roc5)}% / ${number(latest.roc20)}%`],
    ["SuperTrend", `${latest.superTrendDirection || "-"} ${number(latest.superTrend)}`],
    ["Donchian 20", `${number(latest.donchianLow20)} / ${number(latest.donchianHigh20)}`]
  ];
  const signals = Array.isArray(data.signals) ? data.signals : [];
  const transactions = Array.isArray(data.transactions) ? data.transactions : [];
  const backtests = Array.isArray(data.backtestResults) ? data.backtestResults : [];
  document.getElementById("stockDetailBody").innerHTML = `
    <section><h3>技術狀態</h3><div class="v11-grid compact">${technicalFields.map(field => renderKeyValueCard(field[0], field[1])).join("")}</div></section>
    <section class="v11-card"><strong>系統分析</strong><p>${escapeHtml(data.analysisText || "尚無分析文字")}</p></section>
    <section class="v11-card"><div class="v11-card-head"><strong>候選狀態</strong><span class="pill">${escapeHtml(candidate.candidateType || "未入選")}</span></div>
      <p>信心 ${number(candidate.confidenceScore)} · ${escapeHtml(candidate.gradeText || "-")} · ${escapeHtml(candidate.actionSuggestion || "")}</p>
      <div class="matched-models">${renderModelTags(candidate.matchedModelNames || candidate.matchedModels, 3)}</div>
      ${normalizeTextList(candidate.reasonList).length ? `<ul class="v11-reasons">${normalizeTextList(candidate.reasonList).map(text => `<li>${escapeHtml(text)}</li>`).join("")}</ul>` : ""}
    </section>
    <section class="v11-card"><strong>持倉</strong><p>${data.isHeld ? "目前持有" : "目前未持有"} · 股數 ${number(portfolio.quantity)} · 平均成本 ${number(portfolio.avgCost)} · 未實現損益 ${money(portfolio.unrealizedPnl)} (${number(portfolio.unrealizedRate)}%)</p></section>
    <section><h3>最近訊號</h3><div class="v11-list">${signals.map(item => `<div class="v11-card"><strong>${escapeHtml(item.date || "")} ${escapeHtml(item.signalName || item.signalType || "")}</strong><p>${escapeHtml(item.note || "")}</p></div>`).join("") || renderV11Empty("尚無近期訊號")}</div></section>
    <section><h3>最近交易</h3><div class="v11-list">${transactions.map(item => `<div class="v11-card"><strong>${escapeHtml(item.date || "")} ${escapeHtml(item.action || "")}</strong><p>${number(item.quantity)} 股 · ${number(item.price)} · ${escapeHtml(item.note || "")}</p></div>`).join("") || renderV11Empty("尚無交易紀錄")}</div></section>
    <section><h3>最近回測</h3><div class="v11-grid">${backtests.map(item => `<div class="v11-card"><strong>${escapeHtml(item.runId || "回測")}</strong><p>勝率 ${number(item.winRate)}% · 報酬 ${number(item.totalReturn)}% · PF ${number(item.profitFactor)}</p></div>`).join("") || renderV11Empty("尚無近期回測結果")}</div></section>`;
}

function renderModelTags(models, maxVisible = 2) {
  const names = normalizeTextList(models).filter(Boolean);
  if (!names.length) return '<span class="matched-model-tag">未命中模型</span>';
  const visible = names.slice(0, maxVisible).map(name => `<span class="matched-model-tag">${escapeHtml(name)}</span>`);
  const hidden = names.length - visible.length;
  if (hidden > 0) visible.push(`<button type="button" class="matched-model-tag more" data-action="expand-model-tags" data-models="${escapeHtml(encodeURIComponent(JSON.stringify(names)))}">+${hidden}</button>`);
  return visible.join("");
}

function normalizeTextList(value) {
  if (Array.isArray(value)) {
    return value.map(item => typeof item === "string" ? item : (item.strategyName || item.name || item.strategyType || "")).filter(Boolean);
  }
  return String(value || "").split(/[\n,、|]/).map(text => text.trim()).filter(Boolean);
}

function scoreToGradeText(score) {
  if (score >= 90) return "強烈候選";
  if (score >= 80) return "高品質";
  if (score >= 70) return "可觀察";
  if (score >= 60) return "普通";
  return "風險偏高";
}

function renderKeyValueCard(label, value) {
  return `<div class="v11-card key-value"><span>${escapeHtml(label)}</span><strong>${escapeHtml(value === undefined || value === null || value === "" ? "-" : (typeof value === "number" ? number(value) : value))}</strong></div>`;
}

function renderV11Empty(message) {
  return `<div class="v11-empty">${escapeHtml(message)}</div>`;
}

function renderStockLink(symbol, name) {
  const normalized = normalizeSymbolInput(symbol);
  const label = [displaySymbol(normalized, name), name || ""].filter(Boolean).join(" ");
  if (!normalized) return escapeHtml(label || "-");
  return `<button type="button" class="stock-link" data-action="open-stock-detail" data-symbol="${escapeHtml(normalized)}">${escapeHtml(label)}</button>`;
}

function scoreToStars(score) {
  if (score >= 90) return 5;
  if (score >= 80) return 4.5;
  if (score >= 70) return 4;
  if (score >= 60) return 3;
  if (score >= 50) return 2;
  return 1;
}

function renderStars(stars) {
  const count = Math.max(1, Math.min(5, Math.round(Number(stars) || 1)));
  return `${count}/5 星`;
}

function isNotificationRead(item) {
  return item && (item.read === true || String(item.read || "").toUpperCase() === "TRUE");
}

async function loadNotificationSummary() {
  if (!Api.isConfigured() || !Api.getNotificationSummary) return;
  try {
    const data = await Api.getNotificationSummary();
    updateNotificationBadge(data.unreadCount);
  } catch (err) {
    updateNotificationBadge(0);
  }
}

function updateNotificationBadge(count) {
  const badge = document.getElementById("notificationUnreadCount");
  if (!badge) return;
  const value = Math.max(0, Number(count) || 0);
  badge.textContent = value > 99 ? "99+" : String(value);
  badge.hidden = value === 0;
}

async function markNotificationRead(id) {
  if (!id) return;
  try {
    await Api.markNotificationRead(id);
    const cached = pageDataCache.notifications;
    if (cached) {
      cached.items = (cached.items || []).map(item => String(item.id) === String(id) ? Object.assign({}, item, { read: true }) : item);
      cached.unreadCount = Math.max(0, Number(cached.unreadCount || 0) - 1);
      renderNotifications(cached);
      updateNotificationBadge(cached.unreadCount);
    }
  } catch (err) {
    setApiStatus("通知狀態更新失敗：" + err.message);
  }
}

function updateLoadMoreButton(id, visible, loading) {
  const button = document.getElementById(id);
  if (!button) return;
  button.hidden = !visible && !loading;
  button.disabled = Boolean(loading);
  button.textContent = loading ? "載入中..." : "載入更多";
}

function showLoading(target, message = "資料載入中") {
  const container = typeof target === "string" ? document.getElementById(target) : target;
  if (!container) return;
  container.innerHTML = `<div class="v11-empty loading-state">${escapeHtml(message)}</div>`;
}

function hideLoading(target) {
  const container = typeof target === "string" ? document.getElementById(target) : target;
  if (!container) return;
  container.querySelectorAll(".loading-state, .skeleton-card").forEach(node => node.remove());
}

function showPageError(target, err) {
  const container = typeof target === "string" ? document.getElementById(target) : target;
  if (!container) return;
  container.innerHTML = `<div class="v11-empty error-state"><strong>資料讀取失敗</strong><p>原因：${escapeHtml((err && err.message) || "未知錯誤")}</p><p>請稍後重新整理</p></div>`;
}

function renderSkeleton(container, type = "card", count = 3) {
  const target = typeof container === "string" ? document.getElementById(container) : container;
  if (!target) return;
  target.innerHTML = Array.from({ length: count }).map(() => `<div class="v11-card skeleton-card" data-skeleton-type="${escapeHtml(type)}"></div>`).join("");
}

function renderTableLoading(tbodyId, colspan, message) {
  const body = document.getElementById(tbodyId);
  if (!body) return;
  body.innerHTML = `<tr><td colspan="${Number(colspan) || 1}" class="muted">${escapeHtml(message || "資料載入中")}</td></tr>`;
}

function debounce(fn, wait = 250) {
  let timer = null;
  return function debounced(...args) {
    clearTimeout(timer);
    timer = setTimeout(() => fn.apply(this, args), wait);
  };
}

function renderDashboardV11Summary(data) {
  const container = document.getElementById("dashboardV11Summary");
  if (!container) return;
  const market = data.marketSummary || {};
  const narrative = data.marketNarrative || market.narrative;
  const warnings = data.strategyWarnings || { count: 0, items: [] };
  if (!narrative && !warnings.count) {
    container.innerHTML = "";
    return;
  }
  const reasonList = narrative && Array.isArray(narrative.reasonList) ? narrative.reasonList : (market.reasonList || []);
  container.innerHTML = `<section class="market-narrative">
    <div class="market-narrative-head">
      <div><div class="section-kicker">盤後判讀</div><h2>${escapeHtml((narrative && narrative.title) || `今日市場：${market.marketMode || "資料不足"}`)}</h2></div>
      <button type="button" class="strategy-warning-button" data-action="open-dashboard-detail" data-detail-type="warnings">
        <span>策略警告</span><strong>${number(warnings.count)}</strong><small>查看詳細 →</small>
      </button>
    </div>
    <p>${escapeHtml((narrative && narrative.summaryText) || market.summaryText || "")}</p>
    ${(narrative && narrative.suggestionText) || market.riskText ? `<p class="market-suggestion">${escapeHtml((narrative && narrative.suggestionText) || market.riskText || "")}</p>` : ""}
    <div class="reason-chips">${reasonList.map(reason => `<span>${escapeHtml(reason)}</span>`).join("")}</div>
  </section>`;
}

function buildMobileMoreLinks() {
  const container = document.getElementById("mobileMoreLinks");
  if (!container) return;
  const links = [
    ["leaderboard", "候選排行"], ["market", "市場分析"], ["strategyResearch", "策略研究"],
    ["strategyHealth", "策略健康"], ["notifications", "通知中心"], ["stats", "統計中心"],
    ["transactions", "交易紀錄"], ["analysis", "線圖分析"], ["paper", "虛擬交易"], ["stockDetail", "股票詳細"]
  ];
  container.innerHTML = links.map(([page, label]) => `<button type="button" data-action="open-page" data-page="${page}">${label}</button>`).join("");
}

function openMobileMore() {
  const sheet = document.getElementById("mobileMoreSheet");
  if (!sheet) return;
  sheet.hidden = false;
  document.body.classList.add("mobile-sheet-open");
}

function closeMobileMore() {
  const sheet = document.getElementById("mobileMoreSheet");
  if (!sheet) return;
  sheet.hidden = true;
  document.body.classList.remove("mobile-sheet-open");
}

function openDashboardDetail(type) {
  const data = currentDashboardData || getCachedDashboard() || {};
  const market = data.marketSummary || {};
  let title = "詳細清單";
  let items = [];
  let kind = type;
  if (type === "bullish") {
    title = "偏多股票清單";
    items = ((data.bullishSummary || market.bullishSummary || {}).items || []);
  } else if (type === "risk") {
    title = "風險提醒清單";
    items = ((data.riskSummary || market.riskSummary || {}).items || []);
  } else if (type === "warnings") {
    title = "策略警告清單";
    items = ((data.strategyWarnings || {}).items || []);
  } else if (type === "signals") {
    title = "今日訊號清單";
    const summary = data.todaySignalSummary || {};
    items = (summary.buyItems || []).map(item => Object.assign({ signalSide: "買入" }, item))
      .concat((summary.sellItems || []).map(item => Object.assign({ signalSide: "賣出" }, item)));
  }
  openDashboardDetailSheet(title, renderDashboardDetailItems(items, kind));
}

function renderDashboardDetailItems(items, kind) {
  if (!items || !items.length) return renderV11Empty("目前沒有符合條件的股票");
  return `<div class="detail-list">${items.map(item => {
    const reasons = normalizeTextList(item.reasonList || item.message || item.reason || item.warningType);
    const status = item.trendText || item.statusText || item.signalSide || item.title || "";
    const primaryScore = kind === "risk" ? `風險分數 ${number(item.riskScore)}` : (kind === "signals" ? `${escapeHtml(item.signalSide || "訊號")} · 信心 ${number(item.confidenceScore || item.totalScore)}` : `技術分數 ${number(item.totalScore)}`);
    return `<article class="detail-list-item ${kind === "risk" || kind === "warnings" ? "is-risk" : ""}">
      <div class="detail-list-head"><div>${renderStockLink(item.symbol, item.name)}</div><span class="badge ${getBadgeClass(status)}">${escapeHtml(status)}</span></div>
      <strong>${primaryScore}</strong>
      ${reasons.length ? `<ul>${reasons.map(reason => `<li>${kind === "risk" || kind === "warnings" ? "⚠" : "✓"} ${escapeHtml(reason)}</li>`).join("")}</ul>` : '<p class="muted">尚無進一步說明</p>'}
    </article>`;
  }).join("")}</div>`;
}

function openSparklineStats(symbol) {
  const item = (currentWatchlistItems || []).find(row => normalizeSymbolInput(row.symbol) === normalizeSymbolInput(symbol));
  const stats = calcSparklineStats_((item && (item.sparkline || item.trend)) || []);
  const title = `${displaySymbol(symbol, item && item.name)} 近 20 日統計`;
  const body = !stats.valid ? renderV11Empty("資料不足") : `<div class="sparkline-stats-grid">
    <div><span>最高</span><strong>${number(stats.high)}</strong></div>
    <div><span>最低</span><strong>${number(stats.low)}</strong></div>
    <div><span>漲跌</span><strong class="${stats.changePercent >= 0 ? "up" : "down"}">${signedNumber(stats.changePercent)}%</strong></div>
    <div><span>波動</span><strong>${number(stats.rangePercent)}%</strong></div>
  </div>${sparkline((item && (item.sparkline || item.trend)) || [], stats.changePercent >= 0 ? "#22c55e" : "#ef4444", 520, 110)}`;
  openDashboardDetailSheet(title, body);
}

function openDashboardDetailSheet(title, body) {
  const sheet = document.getElementById("dashboardDetailSheet");
  document.getElementById("dashboardDetailTitle").textContent = title || "詳細清單";
  document.getElementById("dashboardDetailBody").innerHTML = body || "";
  sheet.hidden = false;
  document.body.classList.add("detail-sheet-open");
}

function closeDashboardDetail() {
  const sheet = document.getElementById("dashboardDetailSheet");
  if (sheet) sheet.hidden = true;
  document.body.classList.remove("detail-sheet-open");
}

function openBackfillSheet() {
  const sheet = document.getElementById("backfillSheet");
  if (sheet) sheet.hidden = false;
  document.body.classList.add("detail-sheet-open");
}

function closeBackfillSheet() {
  const sheet = document.getElementById("backfillSheet");
  if (sheet) sheet.hidden = true;
  document.body.classList.remove("detail-sheet-open");
}

function showToast(message, type = "info") {
  const region = document.getElementById("toastRegion");
  if (!region || !message) return;
  const toast = document.createElement("div");
  toast.className = `toast ${type}`;
  toast.textContent = message;
  region.appendChild(toast);
  setTimeout(() => toast.remove(), 4200);
}
