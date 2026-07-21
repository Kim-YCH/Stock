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
    subtitle: "依最新盤後技術指標產生，供下一交易日參考",
    loader: loadCandidates
  },
  market: {
    title: "市場總覽",
    subtitle: "大盤、廣度、關注清單與風險模式",
    loader: loadMarketSummary
  },
  portfolio: {
    title: "我的庫存",
    subtitle: "成本、損益與技術狀態",
    loader: loadPortfolio
  },
  analysis: {
    title: "線圖分析",
    subtitle: "線圖、技術指標、系統分析與持股交易",
    loader: () => {
      const symbol = normalizeSymbolInput(document.getElementById("analysisSymbol").value);
      if (symbol) loadAnalysis(symbol);
    }
  }
};

const LEGACY_ROUTE_REDIRECTS = {
  "candidate-ranking": "candidates",
  leaderboard: "candidates",
  "strategy-research": "dashboard",
  "strategy-health": "dashboard",
  backtest: "dashboard",
  paper: "dashboard",
  "paper-trading": "dashboard",
  notifications: "dashboard",
  stats: "dashboard",
  statistics: "dashboard",
  "stock-detail": "analysis",
  transactions: "portfolio"
};

const PAGE_ROUTE_ALIASES = Object.assign({}, LEGACY_ROUTE_REDIRECTS, {
  transactions: "portfolio",
  "stock-detail": "analysis",
  stockDetail: "analysis",
  strategyResearch: "dashboard",
  strategyHealth: "dashboard"
});

const CACHE_KEYS = {
  dashboard: "stocklab_cache_dashboard_schema2",
  transactions: "stocklab_cache_transactions_v1111"
};
const CACHE_TTL_MS = {
  [CACHE_KEYS.dashboard]: 7 * 24 * 60 * 60 * 1000,
  [CACHE_KEYS.transactions]: 24 * 60 * 60 * 1000
};
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
let runtimeBackendVersion = "";
let currentWatchlistItems = [];
let currentPortfolioItems = [];
let portfolioTransactionsLoaded = false;
let notificationCacheLoadedAt = 0;
const watchlistSortState = { key: "", direction: "asc" };

document.addEventListener("DOMContentLoaded", () => {
  cleanupLocalCaches();
  setAppVersionLabel();
  loadBackendVersion();
  detectDeviceMode();
  window.addEventListener("resize", detectDeviceMode);

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
  // 庫存頁的強制重算入口。changePage 呼叫 loader 不帶參數，
  // 所以在這之前沒有任何方式能送出 force=1 讓後端重算庫存。
  const btnRefreshPortfolio = document.getElementById("btnRefreshPortfolio");
  if (btnRefreshPortfolio) {
    btnRefreshPortfolio.addEventListener("click", () => {
      pageDataCache.portfolio = null;
      setPortfolioStatus("重新計算中...", "warning");
      loadPortfolio({ force: true });
    });
  }

  renderAnalysisLineControls();
  document.getElementById("analysisLineControls").addEventListener("change", onAnalysisLineToggle);

  document.getElementById("candidateSort").addEventListener("change", () => {
    renderCandidates(currentCandidateData);
  });
  document.getElementById("candidateFilter").addEventListener("change", () => {
    renderCandidates(currentCandidateData);
  });

  document.getElementById("btnUpdateDaily").addEventListener("click", onUpdateDailyPrices);
  const btnRunDerived = document.getElementById("btnRunDerived");
  if (btnRunDerived) btnRunDerived.addEventListener("click", onRunDerivedNow);
  document.getElementById("btnBackfillHistory").addEventListener("click", openBackfillSheet);
  document.getElementById("btnRefreshVersion").addEventListener("click", refreshAppVersion);
  document.getElementById("btnToggleWatchForm").addEventListener("click", toggleWatchForm);
  document.getElementById("btnEmptyAddWatch").addEventListener("click", () => toggleWatchForm(true));
  document.getElementById("watchlistForm").addEventListener("submit", onSubmitWatchlist);
  document.addEventListener("click", onDocumentClick);

  document.getElementById("transactionForm").addEventListener("submit", onSubmitTransaction);
  const tradeSymbolInput = document.querySelector("#transactionForm input[name='symbol']");
  if (tradeSymbolInput) tradeSymbolInput.addEventListener("change", lookupTradeStockName);
  document.querySelectorAll("#transactionForm input[name='action']").forEach(input => {
    input.addEventListener("change", prefillSellQuantity);
  });
  document.getElementById("portfolioTransactionsDetails").addEventListener("toggle", event => {
    if (event.currentTarget.open && !portfolioTransactionsLoaded) {
      portfolioTransactionsLoaded = true;
      loadTransactions();
    }
  });
  document.getElementById("backfillForm").addEventListener("submit", onBackfillHistoricalPrices);

  const dateInput = document.querySelector("#transactionForm input[name='date']");
  if (dateInput) {
    dateInput.valueAsDate = new Date();
    dateInput.max = formatLocalDate(new Date());
  }
  document.addEventListener("keydown", onGlobalEscape);

  setApiStatus();
  const initialRoute = decodeURIComponent(String(window.location.hash || "").replace(/^#/, ""));
  if (initialRoute) changePage(initialRoute, { replaceHash: true });
  else loadDashboard();

  const notificationButton = document.getElementById("btnNotificationCenter");
  if (notificationButton) notificationButton.addEventListener("click", openNotificationSheet);
  const clearButton = document.getElementById("btnClearNotificationSheet");
  if (clearButton) clearButton.addEventListener("click", clearV11Notifications);
  const markAllButton = document.getElementById("btnMarkAllNotificationsRead");
  if (markAllButton) markAllButton.addEventListener("click", markAllNotificationsRead);
  const moreTransactions = document.getElementById("btnLoadMoreTransactions");
  if (moreTransactions) moreTransactions.addEventListener("click", () => loadTransactions({ append: true }));
  const moreNotifications = document.getElementById("btnLoadMoreNotifications");
  if (moreNotifications) moreNotifications.addEventListener("click", () => loadNotifications({ append: true }));
  const mobileMore = document.getElementById("btnMobileMore");
  if (mobileMore) mobileMore.addEventListener("click", openMobileMore);
  window.addEventListener("hashchange", () => changePage(window.location.hash, { replaceHash: true }));
  buildMobileMoreLinks();
});


function detectDeviceMode() {
  const isMobile = window.matchMedia("(max-width: 760px), (pointer: coarse)").matches;
  document.body.classList.toggle("device-mobile", isMobile);
  document.body.classList.toggle("device-desktop", !isMobile);
}


/**
 * 不依賴背景排程，直接把技術指標與所有衍生快取重算一次。
 * 環境不跑 time-driven trigger 時，這是唯一能把指標算出來的路徑。
 */
async function onRunDerivedNow() {
  const btn = document.getElementById("btnRunDerived");
  if (!Api.isConfigured()) {
    setApiStatus("尚未設定 API_BASE_URL，無法重算");
    return;
  }

  btn.disabled = true;
  const oldText = btn.textContent;
  btn.textContent = "重算中...";
  setApiStatus("正在重算技術指標與衍生快取，標的多時需要數十秒");

  try {
    const result = await Api.runDerivedNow();
    invalidateFrontendQuoteCaches();
    pageDataCache.dashboard = null;
    clearCache(CACHE_KEYS.dashboard);
    await loadDashboard({ force: true });
    const failed = [];
    const phases = result.phases || {};
    Object.keys(phases).forEach(name => { if (phases[name] && phases[name].ok === false) failed.push(name); });
    const text = failed.length
      ? `重算完成，但有階段失敗：${failed.join("、")}`
      : "技術指標與衍生快取已重算完成";
    setApiStatus(text);
    showToast(text, failed.length ? "warning" : "success");
  } catch (err) {
    setApiStatus("重算失敗：" + err.message);
    showToast("重算失敗：" + err.message, "error");
  } finally {
    btn.disabled = false;
    btn.textContent = oldText;
  }
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
  if (!Number.isFinite(months) || months < 1 || months > 36) {
    message.textContent = "回補月份須介於 1 到 36";
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
    const requestText = `API ${result.apiRequests || 0} 次，略過 ${result.skippedRequests || 0} 個已有月份`;
    const resultText = result.noChanges
      ? `${result.message || "回補完成：沒有缺漏資料"}（${requestText}）`
      : `回補完成：補入 ${result.inserted || 0} 筆（${requestText}）`;
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
    const expiresAt = Number(parsed && parsed.expiresAt || 0);
    if (!expiresAt || expiresAt <= Date.now()) {
      localStorage.removeItem(key);
      return null;
    }
    return parsed && parsed.data ? parsed.data : null;
  } catch (err) {
    return null;
  }
}

function writeCache(key, data) {
  try {
    const ttl = CACHE_TTL_MS[key] || 60 * 60 * 1000;
    localStorage.setItem(key, JSON.stringify({
      savedAt: Date.now(),
      expiresAt: Date.now() + ttl,
      data
    }));
    return true;
  } catch (err) {
    console.warn("StockLab cache write failed", err);
    showToast("瀏覽器快取寫入失敗，重新整理後可能需要再次載入資料", "warning");
    return false;
  }
}

function cleanupLocalCaches() {
  migrateLegacyDashboardCache();
  const activeKeys = new Set(Object.values(CACHE_KEYS));
  try {
    Object.keys(localStorage).forEach(key => {
      if (!key.startsWith("stocklab_cache_")) return;
      if (!activeKeys.has(key)) { localStorage.removeItem(key); return; }
      readCache(key);
    });
  } catch (err) {
    console.warn("StockLab cache cleanup failed", err);
  }
}

function migrateLegacyDashboardCache() {
  try {
    if (localStorage.getItem(CACHE_KEYS.dashboard)) return;
    const maxAge = 7 * 24 * 60 * 60 * 1000;
    let newest = null;
    Object.keys(localStorage).forEach(key => {
      if (!key.startsWith("stocklab_cache_dashboard_") || key === CACHE_KEYS.dashboard) return;
      try {
        const envelope = JSON.parse(localStorage.getItem(key) || "null");
        const data = envelope && envelope.data;
        const savedAt = Number(envelope && envelope.savedAt || 0);
        if (!data || !Array.isArray(data.market) || !Array.isArray(data.watchlist)) return;
        if (!savedAt || Date.now() - savedAt > maxAge) return;
        if (!newest || savedAt > newest.savedAt) newest = { savedAt, data };
      } catch (err) {}
    });
    if (newest) writeCache(CACHE_KEYS.dashboard, newest.data);
  } catch (err) {
    console.warn("StockLab dashboard cache migration failed", err);
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
  pageDataCache.marketSummary = null;
  pageDataCache.analysis = {};
  clearCache(CACHE_KEYS.dashboard);
}

function clearPageMemoryCache() {
  analysisMemoryCache.clear();
  analysisRequests.clear();
  Object.keys(pageDataCache).forEach(key => {
    pageDataCache[key] = key === "analysis" ? {} : null;
  });
}

function getAppVersion() {
  return typeof APP_VERSION === "undefined" ? "unknown" : APP_VERSION;
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
  const cacheable = Object.assign({}, data, {
    watchlist: (data.watchlist || []).filter(item => item && item.pending !== true)
  });
  writeCache(CACHE_KEYS.dashboard, cacheable);
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
  if (event.target.closest('[data-action="prompt-access-key"]')) {
    // 只有後端有設 STOCKLAB_API_TOKEN 時才會走到這裡。
    // 沒設的話前端不會詢問金鑰，這個畫面也不會出現。
    if (Api.promptAccessKey && Api.promptAccessKey()) {
      pageDataCache.dashboard = null;
      pageDataCache.portfolio = null;
      pageDataCache.transactions = null;
      changePage(window.location.hash || "dashboard", { replaceHash: true });
    }
    return;
  }
  if (event.target.closest('[data-action="close-trade-modal"]')) {
    closeTradeModal();
    return;
  }
  const tradeButton = event.target.closest('[data-action="open-trade-modal"]');
  if (tradeButton) {
    openTradeModal({
      action: tradeButton.dataset.tradeAction || "BUY",
      symbol: tradeButton.dataset.symbol || "",
      name: tradeButton.dataset.name || "",
      price: tradeButton.dataset.price || ""
    });
    return;
  }
  if (event.target.closest('[data-action="close-notifications"]')) {
    closeNotificationSheet();
    return;
  }
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
  if (event.target.closest('[data-action="mobile-refresh"]')) {
    closeMobileMore();
    await loadDashboard({ force: true });
    showToast("首頁資料已重新整理", "success");
    return;
  }
  if (event.target.closest('[data-action="mobile-version"]')) {
    closeMobileMore();
    showToast(`前端 ${getAppVersion()} · 後端 ${runtimeBackendVersion || "尚未確認"}`);
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
    const input = document.getElementById("analysisSymbol");
    if (input) input.value = symbol;
    changePage("analysis");
    return;
  }
  const notificationButton = event.target.closest('[data-action="mark-notification-read"]');
  if (notificationButton) {
    await markNotificationRead(notificationButton.dataset.id);
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

function resolvePageName(pageName) {
  const raw = String(pageName || "dashboard")
    .replace(/^#/, "")
    .replace(/^\/+|\/+$/g, "")
    .trim();
  if (!raw) return "dashboard";
  return PAGE_ROUTE_ALIASES[raw] || LEGACY_ROUTE_REDIRECTS[raw.toLowerCase()] || raw;
}

function openTradeModal(prefill = {}) {
  const modal = document.getElementById("tradeModal");
  const form = document.getElementById("transactionForm");
  if (!modal || !form) return;
  form.reset();
  const action = String(prefill.action || "BUY").toUpperCase() === "SELL" ? "SELL" : "BUY";
  const actionInput = form.querySelector(`input[name="action"][value="${action}"]`);
  if (actionInput) actionInput.checked = true;
  form.elements.symbol.value = normalizeSymbolInput(prefill.symbol || "");
  if (action === "SELL" && form.elements.symbol.value) {
    const holding = currentPortfolioItems.find(item => normalizeSymbolInput(item.symbol) === form.elements.symbol.value);
    if (holding && Number(holding.quantity || 0) > 0) form.elements.quantity.value = holding.quantity;
  }
  form.elements.price.value = prefill.price || "";
  form.elements.date.value = formatLocalDate(new Date());
  form.elements.fee.value = "0";
  form.elements.tax.value = "0";
  document.getElementById("tradeStockName").textContent = prefill.name || "股票名稱將由後端自動查詢";
  document.getElementById("formMessage").textContent = "";
  modal.hidden = false;
  document.body.classList.add("floating-sheet-open");
  setTimeout(() => (form.elements.symbol.value ? form.elements.quantity : form.elements.symbol).focus(), 0);
}

function closeTradeModal() {
  const modal = document.getElementById("tradeModal");
  if (modal) modal.hidden = true;
  syncOverlayBodyClasses();
}

function syncOverlayBodyClasses() {
  const floatingOpen = Array.from(document.querySelectorAll(".floating-sheet")).some(element => !element.hidden);
  const detailOpen = Array.from(document.querySelectorAll(".detail-sheet")).some(element => !element.hidden);
  document.body.classList.toggle("floating-sheet-open", floatingOpen);
  document.body.classList.toggle("detail-sheet-open", detailOpen);
}

function onGlobalEscape(event) {
  if (event.key !== "Escape") return;
  const trade = document.getElementById("tradeModal");
  const notifications = document.getElementById("notificationSheet");
  const backfill = document.getElementById("backfillSheet");
  const detail = document.getElementById("dashboardDetailSheet");
  if (trade && !trade.hidden) closeTradeModal();
  if (notifications && !notifications.hidden) closeNotificationSheet();
  if (backfill && !backfill.hidden) closeBackfillSheet();
  if (detail && !detail.hidden) closeDashboardDetail();
}

let tradeLookupRequest = 0;

async function lookupTradeStockName(event) {
  const input = event.currentTarget;
  const symbol = normalizeSymbolInput(input.value);
  input.value = symbol;
  const nameTarget = document.getElementById("tradeStockName");
  if (!symbol || !nameTarget) return;
  const requestId = ++tradeLookupRequest;
  nameTarget.textContent = "查詢股票名稱中...";
  try {
    const result = await Api.lookupStock(symbol);
    if (requestId !== tradeLookupRequest || normalizeSymbolInput(input.value) !== symbol) return;
    nameTarget.textContent = result.stock && result.stock.name ? result.stock.name : "查無股票名稱";
  } catch (err) {
    if (requestId === tradeLookupRequest) nameTarget.textContent = "股票名稱查詢失敗：" + err.message;
  }
}

function prefillSellQuantity(event) {
  if (event.currentTarget.value !== "SELL" || !event.currentTarget.checked) return;
  const form = document.getElementById("transactionForm");
  const symbol = normalizeSymbolInput(form.elements.symbol.value);
  const holding = currentPortfolioItems.find(item => normalizeSymbolInput(item.symbol) === symbol);
  form.elements.quantity.value = holding && Number(holding.quantity || 0) > 0 ? holding.quantity : "";
}

function changePage(pageName, options = {}) {
  const requestedPage = String(pageName || "dashboard").replace(/^#/, "");
  pageName = resolvePageName(requestedPage);
  if (!pages[pageName] || !document.getElementById(pageName + "Page")) pageName = "dashboard";
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
  const targetHash = `#${pageName}`;
  if (window.location.hash !== targetHash) {
    if (options.replaceHash || requestedPage !== pageName) history.replaceState(null, "", targetHash);
    else history.pushState(null, "", targetHash);
  }
  if (requestedPage === "transactions") {
    const details = document.getElementById("portfolioTransactionsDetails");
    if (details) {
      details.open = true;
      if (!portfolioTransactionsLoaded) {
        portfolioTransactionsLoaded = true;
        loadTransactions();
      }
      setTimeout(() => details.scrollIntoView({ behavior: "smooth", block: "start" }), 0);
    }
  }
}

let dashboardRetryTimer = null;

async function loadDashboard(options = {}) {
  const cached = pageDataCache.dashboard || getCachedDashboard();
  if (cached) {
    renderDashboard(cached);
    setApiStatus("已載入快取，正在更新...");
  } else {
    renderSkeleton("marketCards", "summary", 6);
    renderTableLoading("watchlistBody", 11, "首頁資料載入中");
  }

  try {
    const data = await Api.getDashboard(options.force === true);
    if (data.cacheMiss || data.rebuilding) {
      const displayData = data.cacheMiss && cached ? cached : data;
      if (displayData) renderDashboard(displayData);
      // 後端已經放棄重試就別再空轉，把真正的錯誤顯示出來讓使用者能處理。
      if (data.rebuildGaveUp) {
        clearDashboardRetry();
        showPageError("watchlistBody", new Error(data.rebuildError || "首頁快取重建失敗"));
      } else {
        scheduleDashboardRetry(data.retryAfterSeconds);
      }
      setApiStatus(data.message || "首頁快取正在背景更新");
      return;
    }

    clearDashboardRetry();
    pageDataCache.dashboard = data;
    saveDashboardCache(data);
    renderDashboard(data);
    setApiStatus("API 已連線");
  } catch (err) {
    if (isAuthError(err)) {
      showAuthRequired("watchlistBody", err);
      setApiStatus("需要存取金鑰：" + err.message);
      return;
    }
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
  if (data.notificationsSummary) updateNotificationBadge(data.notificationsSummary.unreadCount);
}

async function loadCandidates() {
  const cached = pageDataCache.candidates;
  if (cached) {
    currentCandidateData = cached;
    renderCandidates(cached);
  } else {
    renderSkeleton("candidateSummary", "summary", 4);
    renderTableLoading("buyCandidatesBody", 10, "候選資料載入中");
    renderTableLoading("sellCandidatesBody", 10, "候選資料載入中");
  }
  try {
    const data = await Api.getCandidates();
    pageDataCache.candidates = data;
    currentCandidateData = data;
    renderCandidates(data);
    setApiStatus("候選清單已更新");
  } catch (err) {
    if (isAuthError(err)) {
      setApiStatus("需要存取金鑰：" + err.message);
      return;
    }
    if (!cached) {
      currentCandidateData = Mock.candidates;
      renderCandidates(Mock.candidates);
    }
    setApiStatus("候選清單載入失敗：" + err.message);
  }
}

function renderCandidates(data) {
  const sortMode = document.getElementById("candidateSort").value;
  const rawBuyItems = (data.buyCandidates || []).map(item => Object.assign({ candidateType: "BUY" }, item));
  const rawSellItems = (data.sellCandidates || []).map(item => Object.assign({ candidateType: "SELL" }, item));
  const buyItems = sortCandidateItems(rawBuyItems.filter(candidateMatchesFilter), sortMode);
  const sellItems = sortCandidateItems(rawSellItems.filter(candidateMatchesFilter), sortMode);
  const status = document.getElementById("candidateStatus");
  status.textContent = `盤後資料 ${data.dataDate || "尚未建立"} · 買入 ${rawBuyItems.length} 檔 · 賣出 ${rawSellItems.length} 檔 · 供下一交易日參考`;
  buyItems.concat(sellItems).forEach(cacheExplainContext);
  document.getElementById("candidateSummary").innerHTML = [
    summaryCard("買入候選", rawBuyItems.length, "up"),
    summaryCard("賣出候選", rawSellItems.length, "down"),
    summaryCard("資料日期", escapeHtml(data.dataDate || "-"), ""),
    summaryCard("更新時間", escapeHtml(data.updatedAt || "-"), "")
  ].join("");

  document.getElementById("buyCandidatesBody").innerHTML = buyItems.length
    ? buyItems.map(item => `
        <tr>
          <td data-label="股票">${renderStockLink(item.symbol, item.name)}</td>
          <td data-label="收盤價">${number(item.close)}</td>
          <td data-label="RSI">${explainableButton("RSI", number(item.rsi14), item.symbol)}</td>
          <td data-label="ADX">${explainableButton("ADX", hasMetricValue(item.adx14) ? number(item.adx14) : "尚未計算", item.symbol)}</td>
          <td data-label="ATR">${explainableButton("ATR", hasMetricValue(item.atrPercent) ? `${number(formatAtrPercent(item.atrPercent))}%` : "尚未計算", item.symbol)}</td>
          <td data-label="技術分數">${explainableButton("TECH_SCORE", number(item.totalScore), item.symbol, scoreClass(item.totalScore))}</td>
          <td data-label="風險分數">${explainableButton("RISK_SCORE", number(item.riskScore), item.symbol)}</td>
          <td data-label="狀態">${explainableButton("TREND_TEXT", escapeHtml(item.trendText || "觀察"), item.symbol, `badge ${getBadgeClass(item.trendText)}`)}</td>
          <td data-label="符合原因" class="candidate-reason">${renderCandidateReasons(item)}</td>
          <td data-label="建議">${escapeHtml(item.suggestion || "列入觀察")}</td>
        </tr>
      `).join("")
    : candidateEmptyRow("目前沒有符合技術條件的買入候選", 10);

  document.getElementById("sellCandidatesBody").innerHTML = sellItems.length
    ? sellItems.map(item => `
          <tr>
            <td data-label="股票">${renderStockLink(item.symbol, item.name)}</td>
            <td data-label="收盤價">${number(item.close)}</td>
            <td data-label="RSI">${explainableButton("RSI", number(item.rsi14), item.symbol)}</td>
            <td data-label="ADX">${explainableButton("ADX", hasMetricValue(item.adx14) ? number(item.adx14) : "尚未計算", item.symbol)}</td>
            <td data-label="ATR">${explainableButton("ATR", hasMetricValue(item.atrPercent) ? `${number(formatAtrPercent(item.atrPercent))}%` : "尚未計算", item.symbol)}</td>
            <td data-label="技術分數">${explainableButton("TECH_SCORE", number(item.totalScore), item.symbol, scoreClass(item.totalScore))}</td>
            <td data-label="風險分數">${explainableButton("RISK_SCORE", number(item.riskScore), item.symbol)}</td>
            <td data-label="狀態">${explainableButton("TREND_TEXT", escapeHtml(item.trendText || "觀察"), item.symbol, `badge ${getBadgeClass(item.trendText)}`)}</td>
            <td data-label="符合原因" class="candidate-reason">${renderCandidateReasons(item)}</td>
            <td data-label="建議">${escapeHtml(item.suggestion || "檢視持股")}</td>
          </tr>
        `).join("")
    : candidateEmptyRow("目前持股沒有符合技術條件的賣出候選", 10);
}

function sortCandidateItems(items, mode) {
  return items.slice().sort((a, b) => {
    if (mode === "riskScore") return Number(b.riskScore || 0) - Number(a.riskScore || 0);
    if (mode === "symbol") return String(a.symbol || "").localeCompare(String(b.symbol || ""), "zh-Hant", { numeric: true });
    return Number(b.totalScore || 0) - Number(a.totalScore || 0);
  });
}

function candidateEmptyRow(message, colspan) {
  return `<tr><td colspan="${colspan}" class="candidate-empty">${escapeHtml(message)}</td></tr>`;
}

function renderCandidateReasons(item) {
  const reasons = normalizeTextList(item.reasonList || item.reason);
  const risks = normalizeTextList(item.riskList);
  return `<details class="candidate-details"><summary>${escapeHtml(reasons[0] || "查看理由")}</summary>
    ${reasons.length ? `<ul class="v11-reasons">${reasons.map(text => `<li>${explainableButton("CANDIDATE_REASON", escapeHtml(text), item.symbol, "candidate-reason-explain", "indicator", text)}</li>`).join("")}</ul>` : ""}
    ${risks.length ? `<ul class="v11-risk-list">${risks.map(text => `<li>${explainableButton("RISK_SCORE", escapeHtml(text), item.symbol, "candidate-reason-explain", "indicator", text)}</li>`).join("")}</ul>` : ""}
  </details>`;
}

function candidateMatchesFilter(item) {
  const select = document.getElementById("candidateFilter");
  const mode = select ? select.value : "all";
  if (mode === "all") return true;
  const symbol = normalizeSymbolInput(item.symbol);
  const isEtf = String(item.type || "").toUpperCase() === "ETF" || /^00\d{3,4}$/.test(symbol);
  if (mode === "buy") return String(item.candidateType || "").toUpperCase() === "BUY";
  if (mode === "sell") return String(item.candidateType || "").toUpperCase() === "SELL";
  if (mode === "etf") return isEtf;
  if (mode === "stock") return !isEtf;
  return true;
}

function scheduleDashboardRetry(retryAfterSeconds) {
  clearDashboardRetry();
  const seconds = Math.max(10, Number(retryAfterSeconds || 70));
  dashboardRetryTimer = setTimeout(() => {
    dashboardRetryTimer = null;
    loadDashboard();
  }, seconds * 1000);
}

function clearDashboardRetry() {
  if (!dashboardRetryTimer) return;
  clearTimeout(dashboardRetryTimer);
  dashboardRetryTimer = null;
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
  const bullish = getDashboardListSummary(dashboard, "bullish");
  const risk = getDashboardListSummary(dashboard, "risk");
  const signals = getDashboardSignalSummary(dashboard);
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
  cacheExplainContext(Object.assign({ symbol: "TAIEX", marketMode: mode, trendText: mode }, taiex, marketState));
  cacheExplainContext({ symbol: "MARKET_AVERAGE", totalScore: average.value, trendText: mode, marketMode: mode });

  container.innerHTML = [
    dashboardMetricCard({ title: "今日市場", value: mode, cls: marketModeClass(mode), meta: (marketState.reasonList || []).slice(0, 2).join(" · ") || "依盤後技術資料判斷", explainKey: "MARKET_MODE", explainSymbol: "TAIEX" }),
    dashboardMetricCard({ title: "加權指數", value: number(marketState.close || taiex.close), cls: changeClass, meta: `${changeArrow} ${number(Math.abs(changePercent))}% · ${mode}`, detailHtml: buildMarketIndicatorLine(marketState, taiex) }),
    dashboardMetricCard({ title: "偏多股票", value: `${number(bullish.count)} / ${number(bullish.total)}`, cls: "up", meta: `偏多率 ${number(bullish.rate)}%`, action: "bullish" }),
    dashboardMetricCard({ title: "風險提醒", value: `${number(risk.count)} 檔`, cls: risk.level === "high" ? "down" : "warn", meta: `${riskStars(risk.stars)} ${riskLevel}`, action: "risk" }),
    dashboardMetricCard({ title: "今日候選", value: `買入 ${number(signals.buyCount)} · 賣出 ${number(signals.sellCount)}`, meta: "查看技術條件明細", action: "signals" }),
    dashboardMetricCard({ title: "平均技術分數", value: `${number(average.value)} / 100`, cls: scoreClass(average.value), meta: averageMeta, explainKey: "TECH_SCORE", explainSymbol: "MARKET_AVERAGE" })
  ].join("");
}

function dashboardMetricCard(options) {
  const content = `<div class="card-title">${escapeHtml(options.title || "")}</div>
    <div class="dashboard-card-value ${options.cls || ""}">${escapeHtml(String(options.value === undefined ? "-" : options.value))}</div>
    ${options.meta ? `<div class="dashboard-card-meta">${escapeHtml(options.meta)}</div>` : ""}
    ${options.detailHtml ? `<div class="dashboard-card-detail dashboard-indicator-links">${options.detailHtml}</div>` : (options.detail ? `<div class="dashboard-card-detail">${escapeHtml(options.detail)}</div>` : "")}
    ${options.action ? '<div class="dashboard-card-link">查看詳細 →</div>' : ""}`;
  if (options.explainKey) return `<button type="button" class="card dashboard-metric-card is-action explainable-card" data-explain-type="indicator" data-explain-key="${escapeHtml(options.explainKey)}" data-symbol="${escapeHtml(options.explainSymbol || "")}">${content}</button>`;
  if (!options.action) return `<article class="card dashboard-metric-card">${content}</article>`;
  return `<button type="button" class="card dashboard-metric-card is-action" data-action="open-dashboard-detail" data-detail-type="${escapeHtml(options.action)}">${content}</button>`;
}

function isBullishWatchItem(item) {
  const score = Number(item && (item.totalScore ?? item.score) || 0);
  const risk = Number(item && item.riskScore || 0);
  const trend = String(item && (item.statusText || item.trendText || item.status) || "");
  return ["強勢多頭", "偏多", "中性偏多"].some(label => trend.includes(label)) || (score >= 60 && risk >= 50);
}

function isRiskWatchItem(item) {
  const riskValue = finiteValue(item && item.riskScore);
  const score = Number(item && (item.totalScore ?? item.score) || 0);
  const trend = String(item && (item.statusText || item.trendText || item.status) || "");
  const rsi = Number(item && (item.rsi14 ?? item.rsi) || 0);
  const macdHist = finiteValue(item && item.macdHist);
  return (riskValue !== null && riskValue < 50) || score < 40 ||
    ["偏弱", "偏空", "空頭"].some(label => trend.includes(label)) ||
    rsi >= 75 || (macdHist !== null && macdHist < 0);
}

function getBullishItemsFromDashboard(data) {
  const list = (data && (data.watchlist || data.items)) || [];
  return list.filter(isBullishWatchItem);
}

function getRiskItemsFromDashboard(data) {
  const list = (data && (data.watchlist || data.items)) || [];
  return list.filter(isRiskWatchItem);
}

function getDashboardListSummary(data, type) {
  const market = (data && data.marketSummary) || {};
  const source = type === "bullish"
    ? (data.bullishSummary || market.bullishSummary || {})
    : (data.riskSummary || market.riskSummary || {});
  const fallbackItems = type === "bullish" ? getBullishItemsFromDashboard(data) : getRiskItemsFromDashboard(data);
  const items = Array.isArray(data && data.watchlist)
    ? fallbackItems
    : (Array.isArray(source.items) ? source.items : []);
  const total = Number(source.total || ((data && data.watchlist) || []).length || 0);
  const rate = total ? items.length / total * 100 : 0;
  return Object.assign({}, source, { count: items.length, total, rate, items });
}

function getDashboardSignalSummary(data) {
  const source = (data && data.todaySignalSummary) || {};
  let buyItems = Array.isArray(source.buyItems) ? source.buyItems : [];
  let sellItems = Array.isArray(source.sellItems) ? source.sellItems : [];
  if ((!buyItems.length && !sellItems.length) && Array.isArray(source.items)) {
    buyItems = source.items.filter(item => String(item.candidateType || item.signalSide || "").toUpperCase() === "BUY" || item.signalSide === "買入");
    sellItems = source.items.filter(item => String(item.candidateType || item.signalSide || "").toUpperCase() === "SELL" || item.signalSide === "賣出");
  }
  return Object.assign({}, source, {
    count: buyItems.length + sellItems.length,
    buyCount: buyItems.length,
    sellCount: sellItems.length,
    buyItems,
    sellItems,
    items: buyItems.concat(sellItems)
  });
}

function buildMarketIndicatorLine(state, taiex) {
  const ma20 = state.ma20 !== undefined ? state.ma20 : taiex.ma20;
  const aboveMa20 = state.aboveMa20 !== undefined ? state.aboveMa20 : taiex.aboveMa20;
  const parts = [];
  if (ma20 !== "" && ma20 !== undefined) parts.push(explainableButton("MA20", `MA20：${aboveMa20 ? "站上" : "跌破"}`, "TAIEX", "dashboard-inline-explain"));
  if (state.rsi14 !== "" && state.rsi14 !== undefined) parts.push(explainableButton("RSI", `RSI：${number(state.rsi14)}`, "TAIEX", "dashboard-inline-explain"));
  if (state.adx14 !== "" && state.adx14 !== undefined) parts.push(explainableButton("ADX", `ADX：${number(state.adx14)}`, "TAIEX", "dashboard-inline-explain"));
  return parts.join('<span aria-hidden="true">·</span>');
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
    cacheExplainContext(item);
    const statusText = dashboardStatusText(item);
    const badgeClass = getBadgeClass(statusText);
    const safeSymbol = escapeHtml(String(item.symbol || ""));
    const safeName = escapeHtml(String(item.name || ""));
    const signals = buildSignalChips_(item);
    const rsiArrow = item.rsiDirection === "up" ? "↑" : (item.rsiDirection === "down" ? "↓" : (item.rsiDirection === "flat" ? "→" : ""));
    const adxValue = finiteValue(item.adx14);
    const atrValue = formatAtrPercent(item.atrPercent);
    const volumeValue = finiteValue(item.volumeRatio);
    const previousClose = finiteValue(item.previousClose);
    const priceChange = finiteValue(item.priceChange);
    const changePercent = finiteValue(item.changePercent);
    const changeClass = changePercent === null ? "" : (changePercent > 0 ? "up" : (changePercent < 0 ? "down" : ""));
    const changeTitle = previousClose === null || priceChange === null || changePercent === null
      ? "需要今日與昨日兩筆收盤價"
      : `今日 ${number(item.close)} - 昨日 ${number(previousClose)} = ${signedNumber(priceChange)}（${signedNumber(changePercent)}%）`;
    const sparkStats = calcSparklineStats_(item.sparkline || []);
    const sparkTitle = sparkStats.valid ? `近 20 日｜最高 ${number(sparkStats.high)}｜最低 ${number(sparkStats.low)}｜漲跌 ${signedNumber(sparkStats.changePercent)}%｜波動 ${number(sparkStats.rangePercent)}%` : "近 20 日資料不足";
    return `
      <tr>
        <td data-label="股票"><div class="stock-cell">${renderStockLink(item.symbol, item.name)}<small>收盤 ${number(item.close)}</small></div></td>
        <td data-label="漲跌幅"><div class="daily-change ${changeClass}" title="${escapeHtml(changeTitle)}"><strong>${changePercent === null ? "-" : signedNumber(changePercent) + "%"}</strong><small>${priceChange === null ? "" : signedNumber(priceChange)}</small></div></td>
        <td data-label="技術分數">${explainableButton("TECH_SCORE", `<strong>${number(item.totalScore)}</strong>`, item.symbol, `score-value ${scoreClass(item.totalScore)}`)}</td>
        <td data-label="狀態">${explainableButton("TREND_TEXT", escapeHtml(statusText), item.symbol, `badge ${badgeClass}`)}</td>
        <td data-label="RSI">${explainableButton("RSI", `${number(item.rsi14)} ${rsiArrow}`, item.symbol, `indicator-value ${rsiDirectionClass(item.rsiDirection)}`)}</td>
        <td data-label="ADX">${explainableButton("ADX", adxValue === null ? "-" : number(adxValue), item.symbol, `indicator-value ${adxClass(adxValue)}`)}</td>
        <td data-label="ATR%">${explainableButton("ATR_PERCENT", atrValue === null ? "-" : number(atrValue) + "%", item.symbol, `indicator-value ${atrClass(atrValue)}`)}</td>
        <td data-label="量比">${explainableButton("VOLUME_RATIO", volumeValue === null ? "-" : number(volumeValue) + "x", item.symbol, `volume-ratio ${volumeRatioClass(volumeValue)}`)}</td>
        <td data-label="訊號"><div class="signal-chips signal-chip-row">${renderSignalChips(signals, item.symbol)}</div></td>
        <td data-label="迷你線圖" class="td-sparkline"><button class="sparkline-button" type="button" data-action="open-sparkline-stats" data-symbol="${safeSymbol}" title="${escapeHtml(sparkTitle)}">${sparkline(item.sparkline || [], "#38bdf8", 160, 36)}</button></td>
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

function atrClass(value) {
  if (value === null) return "indicator-flat";
  if (value >= 5) return "indicator-down";
  if (value >= 2) return "indicator-warn";
  return "indicator-flat";
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
  const low20 = finiteValue(context.low20);
  const adx = finiteValue(context.adx14);
  const atr = formatAtrPercent(context.atrPercent);
  const volume = finiteValue(context.volumeRatio);
  const vwap20 = finiteValue(context.vwap20);
  const obv = finiteValue(context.obv);
  const obvMa20 = finiteValue(context.obvMa20);
  const mfi = finiteValue(context.mfi14);
  const cci = finiteValue(context.cci20);
  const williams = finiteValue(context.williamsR14);
  const roc5 = finiteValue(context.roc5);
  const superTrend = String(context.superTrendDirection || "").toUpperCase();
  const summary = String(context.signalSummary || "");
  if (close !== null && ma20 !== null) add(close >= ma20 ? "MA20" : "跌破MA20");
  if (close !== null && ma60 !== null) add(close >= ma60 ? "MA60" : "跌破MA60");
  if (rsi !== null && rsi > 70) add("RSI過熱");
  else if (rsi !== null && rsi > 50) add("RSI>50");
  else if (rsi !== null && rsi < 30) add("RSI超賣");
  else if (rsi !== null) add("RSI<=50");
  if (/KD.*金叉|KD金叉/.test(summary)) add("KD金叉");
  else if (/KD.*死叉|KD死叉/.test(summary)) add("KD死叉");
  else if (k9 !== null && d9 !== null) add(k9 >= d9 ? "KD金叉" : "KD死叉");
  if (macdHist !== null) add(macdHist >= 0 ? "MACD+" : "MACD-");
  if (bbPercentB !== null && bbPercentB >= 0.8) add("布林上緣");
  else if (bbPercentB !== null && bbPercentB <= 0.2) add("布林下緣");
  else if (bbPercentB !== null) add("布林健康");
  if (close !== null && high20 !== null && close >= high20) add("突破20高");
  if (close !== null && low20 !== null && close <= low20) add("跌破20低");
  if (adx !== null && adx >= 25) add("ADX趨勢");
  if (volume !== null) add(volume >= 1.5 ? "量增" : (volume < 0.8 ? "量縮" : ""));
  if (atr !== null) add(atr >= 5 ? "ATR高波動" : (atr < 2 ? "ATR低波動" : ""));
  if (superTrend) add(superTrend === "UP" || superTrend.includes("多") ? "SuperTrend多方" : "SuperTrend空方");
  if (close !== null && vwap20 !== null) add(close >= vwap20 ? "VWAP上方" : "VWAP下方");
  if (obv !== null && obvMa20 !== null) add(obv >= obvMa20 ? "OBV轉強" : "OBV轉弱");
  if (mfi !== null && mfi >= 80) add("MFI過熱");
  else if (mfi !== null && mfi >= 50) add("MFI偏多");
  if (cci !== null && cci >= 0) add("CCI轉強");
  if (williams !== null && williams <= -80) add("Williams超賣");
  if (roc5 !== null) add(roc5 >= 0 ? "ROC轉正" : "ROC轉負");
  return chips;
}

function renderSignalChips(chips, symbol = "") {
  if (!chips || !chips.length) return '<span class="signal-empty">暫無</span>';
  return chips.map(chip => `<button type="button" class="explainable-chip signal-chip" data-explain-type="signal" data-explain-key="${escapeHtml(chip)}" data-symbol="${escapeHtml(normalizeSymbolInput(symbol))}">✓ ${escapeHtml(chip)}</button>`).join("");
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
  const allowed = ["symbol", "date", "close", "changePercent", "rsi14", "adx14", "atrPercent", "volumeRatio", "totalScore", "trendText", "signalSummary"];
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
  const numericKeys = ["close", "changePercent", "rsi14", "adx14", "atrPercent", "volumeRatio", "totalScore"];
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
    renderSkeleton("portfolioSummary", "summary", 6);
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
    if (isAuthError(err)) {
      showAuthRequired("portfolioBody", err);
      setPortfolioStatus("需要存取金鑰才能載入庫存", "warning");
      setApiStatus("需要存取金鑰：" + err.message);
      return;
    }
    // 沒有本地快取時若不繪製，畫面會永遠停在骨架。
    // 對照 loadDashboard 的 catch 分支同樣會兜底繪製。
    data = data || Mock.portfolio;
    renderPortfolioData(data);
    setApiStatus(err.message);
  }
}

function renderPortfolioData(data) {
  const items = data.items || [];
  currentPortfolioItems = items.slice();
  const summary = data.summary || {};
  const totalCost = Number(summary.totalCost ?? items.reduce((sum, x) => sum + Number(x.totalCost || (x.avgCost * x.quantity) || 0), 0));
  const marketValue = Number(summary.totalMarketValue ?? items.reduce((sum, x) => sum + Number(x.marketValue || 0), 0));
  const dailyPnl = Number(summary.dailyPnl ?? items.reduce((sum, x) => sum + Number(x.dailyPnl || 0), 0));
  const previousMarketValue = Number(summary.previousMarketValue ?? items.reduce((sum, x) => sum + Number(x.previousClose || 0) * Number(x.quantity || 0), 0));
  const dailyRate = Number(summary.dailyPnlPercent ?? (previousMarketValue ? dailyPnl / previousMarketValue * 100 : 0));
  const unrealizedPnl = Number(summary.unrealizedPnl ?? items.reduce((sum, x) => sum + Number(x.unrealizedPnl || 0), 0));
  const unrealizedRate = Number(summary.unrealizedRate ?? (totalCost ? unrealizedPnl / totalCost * 100 : 0));
  const realizedPnl = Number(summary.realizedPnl ?? items.reduce((sum, x) => sum + Number(x.realizedPnl || 0), 0));
  const totalReturn = Number(summary.totalReturn ?? items.reduce((sum, x) => sum + Number(x.totalReturn || 0), 0));
  const dataProblems = Array.isArray(data.dataProblems) ? data.dataProblems : [];
  if (dataProblems.length) {
    // 交易重放時被跳過或夾住的列。庫存照樣算得出來，但使用者必須知道哪一筆要修。
    setPortfolioStatus(`有 ${dataProblems.length} 筆交易需要修正：${dataProblems.join("；")}`, "warning");
  } else {
    setPortfolioStatus(data.stale ? "庫存計算中..." : `資料日期：${data.dataDate || latestPortfolioDate(items) || "-"} · ${data.message || "最新股價已更新"}`, data.stale ? "warning" : "success");
  }

  document.getElementById("portfolioSummary").innerHTML = `
    ${summaryCard("庫存總市值", money(marketValue), "")}
    ${summaryCard("今日損益", `${dailyPnl > 0 ? "+" : ""}${money(dailyPnl)}`, dailyPnl >= 0 ? "up" : "down")}
    ${summaryCard("今日漲跌幅", `${dailyRate > 0 ? "+" : ""}${number(dailyRate)}%`, dailyRate >= 0 ? "up" : "down")}
    ${summaryCard("未實現損益", `${unrealizedPnl > 0 ? "+" : ""}${money(unrealizedPnl)}`, unrealizedPnl >= 0 ? "up" : "down")}
    ${summaryCard("未實現報酬率", `${unrealizedRate > 0 ? "+" : ""}${number(unrealizedRate)}%`, unrealizedRate >= 0 ? "up" : "down")}
    ${summaryCard("已實現損益", `${realizedPnl > 0 ? "+" : ""}${money(realizedPnl)}`, realizedPnl >= 0 ? "up" : "down")}
    ${summaryCard("總報酬", `${totalReturn > 0 ? "+" : ""}${money(totalReturn)}`, totalReturn >= 0 ? "up" : "down")}
    ${summaryCard("持有檔數", number(summary.holdingCount ?? items.length), "")}
  `;

  document.getElementById("portfolioBody").innerHTML = items.map(item => {
    cacheExplainContext(item);
    // 缺價時不要上漲跌色，否則「無資料」會被塗成上漲。
    const pnlCls = isBlankValue(item.unrealizedPnl) ? "" : (Number(item.unrealizedPnl) >= 0 ? "up" : "down");
    const dailyCls = Number(item.dailyChange || item.dailyPnl || 0) >= 0 ? "up" : "down";
    const currentPrice = item.currentPrice ?? item.lastPrice;
    const hasPrevious = Number(item.previousClose || 0) > 0;
    return `
      <tr>
        <td data-label="股票">${renderStockLink(item.symbol, item.name)}</td>
        <td data-label="股數">${number(item.quantity)}</td>
        <td data-label="平均成本">${number(item.avgCost)}</td>
        <td data-label="現價">${dashIfBlank(number(currentPrice))}</td>
        <td data-label="今日漲跌" class="${dailyCls}">${hasPrevious ? `${Number(item.dailyChange) > 0 ? "+" : ""}${number(item.dailyChange)} (${Number(item.dailyChangePercent) > 0 ? "+" : ""}${number(item.dailyChangePercent)}%)` : "前日資料不足"}</td>
        <td data-label="今日損益" class="${dailyCls}">${hasPrevious ? `${Number(item.dailyPnl) > 0 ? "+" : ""}${money(item.dailyPnl)}` : "-"}</td>
        <td data-label="市值">${dashIfBlank(money(item.marketValue))}</td>
        <td data-label="未實現損益" class="${pnlCls}">${dashIfBlank(money(item.unrealizedPnl))}</td>
        <td data-label="累積報酬率" class="${pnlCls}">${isBlankValue(item.unrealizedRate) ? "—" : `${number(item.unrealizedRate)}%`}</td>
        <td data-label="技術狀態">${explainableButton("TREND_TEXT", escapeHtml(item.trendText || "觀察"), item.symbol, `badge ${getBadgeClass(item.trendText)}`)}</td>
        <td data-label="操作"><div class="portfolio-row-actions"><button type="button" data-action="open-trade-modal" data-trade-action="BUY" data-symbol="${escapeHtml(item.symbol)}" data-name="${escapeHtml(item.name || "")}" data-price="${escapeHtml(currentPrice || "")}">買</button><button type="button" data-action="open-trade-modal" data-trade-action="SELL" data-symbol="${escapeHtml(item.symbol)}" data-name="${escapeHtml(item.name || "")}" data-price="${escapeHtml(currentPrice || "")}">賣</button><button type="button" data-action="open-stock-detail" data-symbol="${escapeHtml(item.symbol)}">線圖</button></div></td>
      </tr>
    `;
  }).join("") || candidateEmptyRow("目前沒有庫存", 11);
}

function setPortfolioStatus(message, type) {
  const target = document.getElementById("portfolioStatus");
  if (!target) return;
  target.textContent = message || "";
  target.className = `muted portfolio-status ${type || ""}`;
}

function latestPortfolioDate(items) {
  return (items || []).map(item => String(item.dataDate || item.lastDate || "")).filter(Boolean).sort().pop() || "";
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

  const analysisRequestKey = symbol + (forceRefresh ? ":force" : ":cached");
  let request = analysisRequests.get(analysisRequestKey);
  if (!request) {
    document.getElementById("mainChart").innerHTML = `<text x="40" y="80" fill="#94a3b8">線圖載入中...</text>`;
    request = Api.getAnalysis(symbol, forceRefresh)
      .then(data => {
        analysisMemoryCache.set(symbol, data);
        pageDataCache.analysis[symbol] = data;
        return data;
      })
      .finally(() => {
        analysisRequests.delete(analysisRequestKey);
      });
    analysisRequests.set(analysisRequestKey, request);
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
  const context = cacheExplainContext(Object.assign({}, data, data.latest || {}));
  document.getElementById("analysisTitle").textContent =
    `${data.symbol || symbol} ${data.name || ""} 線圖分析`;

  const latest = data.latest || {};
  const portfolio = data.portfolio || {};
  const cards = [
    ["收盤價", formatMetricNumber(latest.close, ""), ""],
    ["MA20", formatMetricNumber(latest.ma20), "MA20"],
    ["MA60", formatMetricNumber(latest.ma60), "MA60"],
    ["RSI14", formatMetricNumber(latest.rsi14), "RSI"],
    ["KD", formatMetricPair(latest.k9, latest.d9), "KD"],
    ["MACD 柱狀體", formatMetricNumber(latest.macdHist), "MACD_HIST"],
    ["布林 %B", formatMetricNumber(latest.bbPercentB), "BB_PERCENT_B"],
    ["ATR %", formatMetricPercent(latest.atrPercent), "ATR_PERCENT"],
    ["ADX14", formatMetricNumber(latest.adx14), "ADX"],
    ["EMA20", formatMetricNumber(latest.ema20), "EMA20"],
    ["VWAP20", formatMetricNumber(latest.vwap20), "VWAP20"],
    ["OBV / OBV MA20", formatMetricPair(latest.obv, latest.obvMa20), "OBV"],
    ["MFI14", formatMetricNumber(latest.mfi14), "MFI"],
    ["CCI20", formatMetricNumber(latest.cci20), "CCI"],
    ["Williams %R", formatMetricNumber(latest.williamsR14), "WILLIAMS_R"],
    ["ROC5 / ROC20", formatMetricPair(latest.roc5, latest.roc20), "ROC20"],
    ["SuperTrend", latest.superTrendDirection || formatMetricNumber(latest.superTrend), "SUPER_TREND"],
    ["Donchian 上 / 下", formatMetricPair(latest.donchianHigh20, latest.donchianLow20), "DONCHIAN"],
    ["20 日高 / 低", formatMetricPair(latest.high20, latest.low20), "HIGH20"],
    ["技術分數", formatMetricNumber(latest.totalScore), "TECH_SCORE"],
    ["趨勢分數", formatMetricNumber(latest.trendScore), "TREND_SCORE"],
    ["動能分數", formatMetricNumber(latest.momentumScore), "MOMENTUM_SCORE"],
    ["風險分數", formatMetricNumber(latest.riskScore), "RISK_SCORE"],
    ["突破分數", formatMetricNumber(latest.breakoutScore), "BREAKOUT_SCORE"],
    ["波動分數", formatMetricNumber(latest.volatilityScore), "VOLATILITY_SCORE"],
    ["技術狀態", latest.trendText || "觀察", "TREND_TEXT"],
    ["平均成本", formatMetricNumber(portfolio.avgCost, "無庫存"), ""]
  ];

  document.getElementById("indicatorCards").innerHTML = cards.map(([label, value, key]) => `
    <div class="metric">
      <div class="label">${label}</div>
      ${key ? explainableButton(key, escapeHtml(String(value ?? "")), context.symbol || symbol, `num ${value === "尚未計算" || value === "無庫存" ? "num-muted" : ""}`) : `<div class="num ${value === "尚未計算" || value === "無庫存" ? "num-muted" : ""}">${escapeHtml(String(value ?? ""))}</div>`}
    </div>
  `).join("");

  renderAnalysisDataNotice(data);
  drawMainChart(data.prices || [], portfolio.avgCost || null, getSelectedAnalysisLines());

  const signals = data.signals || [];
  document.getElementById("signalsBox").innerHTML = signals.length
    ? signals.map(s => `
        <div class="signal ${signalClass(s.direction)}">
          <strong>${escapeHtml(s.date || "")} ${explainableButton(String(s.signalName || s.signalType || "技術訊號"), escapeHtml(s.signalName || s.signalType || "技術訊號"), context.symbol || symbol, "signal-name-explain", "signal", s.note || "")}</strong>
          <div class="muted">${escapeHtml(s.note || "")}</div>
        </div>
      `).join("")
    : `<div class="muted">目前沒有近期訊號。</div>`;
  renderStockDetail(data);
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
    const existingItems = pageDataCache.transactions ? pageDataCache.transactions.items || [] : (cached ? cached.items || [] : []);
    const localPending = existingItems.filter(item => item && (item.pending === true || item.error === true));
    const previousServerItems = append ? existingItems.filter(item => item && item.pending !== true && item.error !== true) : [];
    const serverItems = previousServerItems.concat(data.items || []);
    const seen = new Set();
    const mergedItems = localPending.concat(serverItems).filter(item => {
      const key = String(item.id || `${item.date}|${item.symbol}|${item.action}|${item.quantity}|${item.price}`);
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });
    const merged = Object.assign({}, data, { items: mergedItems });
    pageDataCache.transactions = merged;
    state.hasMore = Boolean(data.hasMore);
    state.offset = Number(data.offset || state.offset) + (data.items || []).length;
    saveTransactionsCache(merged);
    renderTransactions(merged.items);
    setApiStatus("交易紀錄已更新");
  } catch (err) {
    if (isAuthError(err)) {
      showAuthRequired("transactionsBody", err);
      setApiStatus("需要存取金鑰：" + err.message);
      return;
    }
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
  payload.fee = Number(payload.fee || 0);
  payload.tax = Number(payload.tax || 0);
  payload.symbol = normalizeSymbolInput(payload.symbol);

  const message = document.getElementById("formMessage");
  const submitButton = form.querySelector('button[type="submit"]');
  const quantity = Number(payload.quantity || 0);
  const price = Number(payload.price || 0);
  if (!payload.symbol || !payload.date || quantity <= 0 || price <= 0) {
    message.textContent = "請完整填寫股票代號、股數、價格與日期";
    return;
  }
  if (payload.date > formatLocalDate(new Date())) {
    message.textContent = "交易日期不可晚於今天";
    return;
  }
  if (payload.tradeAction === "SELL") {
    const holding = currentPortfolioItems.find(item => normalizeSymbolInput(item.symbol) === payload.symbol);
    const available = Number(holding && holding.quantity || 0);
    if (quantity > available) {
      message.textContent = `可賣股數只有 ${number(available)}`;
      showToast("賣出股數超過目前庫存", "error");
      return;
    }
  }
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
  message.textContent = "正在儲存並更新庫存...";
  if (submitButton) submitButton.disabled = true;

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
    if (result.portfolio) {
      pageDataCache.portfolio = result.portfolio;
      renderPortfolioData(result.portfolio);
    } else {
      pageDataCache.portfolio = null;
      refreshPortfolioAfterTransaction(0);
    }
    message.textContent = "新增成功";
    showToast("交易已儲存，庫存已更新", "success");
    closeTradeModal();
  } catch (err) {
    message.textContent = "新增失敗：" + err.message;
    replaceCachedTransaction(optimisticItem.id, { pending: false, error: true, errorMessage: err.message });
    showToast("交易儲存失敗：" + err.message, "error");
  } finally {
    if (submitButton) submitButton.disabled = false;
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
    if (result.portfolio) {
      pageDataCache.portfolio = result.portfolio;
      renderPortfolioData(result.portfolio);
    }
    showToast("交易重試成功", "success");
    if (!result.portfolio) refreshPortfolioAfterTransaction(0);
  } catch (err) {
    replaceCachedTransaction(id, { pending: false, error: true, errorMessage: err.message });
    showToast("重試失敗：" + err.message, "error");
  }
}

function refreshPortfolioAfterTransaction(delay = 1000) {
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
  }, Math.max(0, Number(delay || 0)));
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
    const result = await Api.deleteTransaction(id);
    clearCache(CACHE_KEYS.dashboard);
    pageDataCache.dashboard = null;
    if (result.portfolio) {
      pageDataCache.portfolio = result.portfolio;
      renderPortfolioData(result.portfolio);
    } else {
      pageDataCache.portfolio = null;
      refreshPortfolioAfterTransaction(0);
    }
    setApiStatus("已刪除交易紀錄，庫存已更新");
    showToast("交易已刪除", "success");
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

function chartPriceValue(value) {
  if (value === null || value === undefined) return null;
  if (typeof value === "string" && value.trim() === "") return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : null;
}

function drawMainChart(rows, cost, technicalLines = getSelectedAnalysisLines()) {
  const svg = document.getElementById("mainChart");
  const tooltip = document.getElementById("chartTooltip");
  const width = 920;
  const height = 420;
  const pad = 44;

  const validRows = rows.filter(r => chartPriceValue(r.close) !== null);
  if (tooltip) tooltip.hidden = true;
  if (!validRows.length) {
    svg.innerHTML = `<text x="40" y="80" fill="#94a3b8">沒有價格資料</text>`;
    return;
  }

  const closes = validRows.map(r => chartPriceValue(r.close));
  const selectedLineValues = technicalLines.flatMap(option => validRows
    .map(r => chartPriceValue(r[option.key]))
    .filter(v => v !== null));
  const all = closes.concat(selectedLineValues);
  const costValue = chartPriceValue(cost);
  if (costValue !== null) all.push(costValue);

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
      .map((r, i) => ({ value: chartPriceValue(r[key]), i }))
      .filter(p => p.value !== null)
      .map(p => `${x(p.i, validRows)},${y(p.value)}`)
      .join(" ");
  }

  function lineSegmentsBy(key) {
    const segments = [];
    let segment = [];
    validRows.forEach((row, i) => {
      const value = chartPriceValue(row[key]);
      if (value === null) {
        if (segment.length > 1) segments.push(segment.join(" "));
        segment = [];
        return;
      }
      segment.push(`${x(i, validRows)},${y(value)}`);
    });
    if (segment.length > 1) segments.push(segment.join(" "));
    return segments;
  }

  const grid = [];
  for (let i = 0; i < 5; i++) {
    const gy = pad + i * ((height - pad * 2) / 4);
    grid.push(`<line x1="${pad}" y1="${gy}" x2="${width - pad}" y2="${gy}" stroke="#1f2937" stroke-width="1" />`);
  }

  const last = validRows[validRows.length - 1];
  const lastX = x(validRows.length - 1, validRows);
  const lastY = y(chartPriceValue(last.close));
  const chartPoints = validRows.map((row, i) => ({
    x: x(i, validRows),
    y: y(chartPriceValue(row.close)),
    row: row
  }));

  let costLine = "";
  if (costValue !== null) {
    const cy = y(costValue);
    costLine = `
      <line x1="${pad}" y1="${cy}" x2="${width - pad}" y2="${cy}" stroke="#eab308" stroke-width="2" stroke-dasharray="8 8" />
      <text x="${width - pad - 96}" y="${cy - 8}" fill="#eab308" font-size="13">成本 ${number(cost)}</text>
    `;
  }

  const technicalLineSvg = technicalLines.map(option => {
    const segments = lineSegmentsBy(option.key);
    if (!segments.length) return "";
    const dash = option.dash ? ` stroke-dasharray="${escapeHtml(option.dash)}"` : "";
    return segments.map(points => `<polyline points="${points}" fill="none" stroke="${escapeHtml(option.color)}" stroke-width="2.5" opacity="0.92"${dash} />`).join("");
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
    const cost = chartPriceValue(config.cost);

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
      const value = chartPriceValue(row[option.key]);
      if (value !== null) parts.push(`<span>${escapeHtml(option.label)} ${number(value)}</span>`);
    });
    if (cost !== null) parts.push(`<span>平均成本 ${number(cost)}</span>`);

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
  const arr = values.map(chartPriceValue).filter(v => v !== null);
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

// 後端「無資料」是空字串，而 Number("") 是 0。
// 少了這個檢查，缺價的持股會顯示成現價 0、未實現損益 0，比顯示 -100% 一樣誤導。
function isBlankValue(value) {
  return value === null || value === undefined || String(value).trim() === "";
}

function number(value) {
  if (isBlankValue(value)) return "";
  const n = Number(value);
  if (!isFinite(n)) return "";
  return n.toLocaleString("zh-TW", { maximumFractionDigits: 2 });
}

function money(value) {
  if (isBlankValue(value)) return "";
  const n = Number(value);
  if (!isFinite(n)) return "";
  return n.toLocaleString("zh-TW", { maximumFractionDigits: 0 });
}

/** 空值顯示破折號，避免和真實的 0 混淆。 */
function dashIfBlank(text) {
  return text === "" ? "—" : text;
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
  marketSummary: null,
  notifications: null,
  transactions: null,
  analysis: {}
};

const paginationState = {
  transactions: { limit: 20, offset: 0, hasMore: false, loading: false },
  notifications: { limit: 30, offset: 0, hasMore: false, loading: false }
};

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
    marketSummary: "marketSummaryBody"
  };
  const target = document.getElementById(map[cacheKey]);
  if (target) target.innerHTML = Array.from({ length: 3 }).map(() => '<div class="v11-card skeleton-card"></div>').join("");
}

function loadMarketSummary() {
  return loadV11PageWithCache("marketSummary", () => Api.getMarketSummary(), renderMarketSummary, () => ({ ok: false, summaryText: "等待後端 v11 marketSummary 部署" }));
}

function renderMarketSummary(data) {
  const taiex = data.taiex || {};
  const breadth = data.breadth || {};
  const watch = data.watchlistMarket || {};
  const sectors = data.sectorProxy || {};
  cacheExplainContext(Object.assign({ symbol: "TAIEX", marketMode: data.marketMode || taiex.trendText, trendText: data.marketMode || taiex.trendText }, taiex));
  cacheExplainContext({ symbol: "MARKET_AVERAGE", totalScore: watch.avgScore, marketMode: data.marketMode || taiex.trendText });
  document.getElementById("marketSummaryCards").innerHTML = [
    summaryCard("TAIEX", number(taiex.close), Number(taiex.change) >= 0 ? "up" : "down"),
    summaryCard("大盤模式", explainableButton("MARKET_MODE", escapeHtml(data.marketMode || taiex.trendText || "-"), "TAIEX"), ""),
    summaryCard("上漲比率", number(breadth.upRatio) + "%", Number(breadth.upRatio) >= 50 ? "up" : "down"),
    summaryCard("關注均分", explainableButton("TECH_SCORE", number(watch.avgScore), "MARKET_AVERAGE"), "")
  ].join("");
  document.getElementById("marketSummaryBody").innerHTML = `
    <div class="v11-card"><strong>${escapeHtml(data.summaryText || "尚無市場摘要")}</strong><p>${escapeHtml(data.riskText || "")}</p></div>
    <div class="v11-grid compact">
      <div class="v11-card key-value"><span>TAIEX MA20 / MA60</span><strong>${explainableButton("MA20", number(taiex.ma20), "TAIEX")} / ${explainableButton("MA60", number(taiex.ma60), "TAIEX")}</strong></div>
      ${renderKeyValueCard("強勢 / 弱勢", `${number(breadth.strongCount)} / ${number(breadth.weakCount)}`)}
      ${renderKeyValueCard("過熱 / 超跌", `${number(breadth.overheatCount)} / ${number(breadth.oversoldCount)}`)}
      ${renderKeyValueCard("Risk On", data.marketRiskOn ? "是" : "否")}
    </div>
    <div class="v11-card"><strong>產業代理分數</strong><div class="period-status">
      <span>半導體 ${number(sectors.semiconductor)}</span><span>AI 伺服器 ${number(sectors.aiServer)}</span><span>金融 ${number(sectors.financial)}</span><span>航運 ${number(sectors.shipping)}</span><span>ETF ${number(sectors.etf)}</span>
    </div></div>`;
}

async function loadNotifications(options = {}) {
  const state = paginationState.notifications;
  if (state.loading) return;
  const append = options.append === true;
  if (!append) state.offset = 0;
  const cached = pageDataCache.notifications;
  if (cached && !append) renderNotifications(cached, { stale: true });
  else if (!append) showLoading("notificationSheetBody", "通知載入中");
  state.loading = true;
  try {
    const data = await Api.getNotifications({ limit: state.limit, offset: state.offset });
    const previousItems = append && cached ? cached.items || [] : [];
    const merged = Object.assign({}, data, { items: previousItems.concat(data.items || []) });
    pageDataCache.notifications = merged;
    notificationCacheLoadedAt = Date.now();
    state.hasMore = Boolean(data.hasMore);
    state.offset = merged.items.length;
    renderNotifications(merged);
    updateNotificationBadge(data.unreadCount);
  } catch (err) {
    if (!cached) showPageError("notificationSheetBody", err);
    else setApiStatus("通知資料可能不是最新：" + err.message);
  } finally {
    state.loading = false;
    updateLoadMoreButton("btnLoadMoreNotifications", state.hasMore, false);
  }
}

function renderNotifications(data) {
  const items = Array.isArray(data.items) ? data.items : [];
  const allowedLevels = new Set(["info", "success", "warning", "error", "risk", "danger"]);
  document.getElementById("notificationSheetBody").innerHTML = items.map(item => {
    const level = String(item.level || "info").toLowerCase();
    const safeLevel = allowedLevels.has(level) ? level : "info";
    return `<article class="notification-card ${safeLevel} ${isNotificationRead(item) ? "is-read" : "is-unread"}">
    <div class="v11-card-head"><strong>${escapeHtml(item.title || item.type || "通知")}</strong><span>${escapeHtml(item.date || item.createdAt || "")}</span></div>
    <div class="notification-message">${escapeHtml(item.message || "")}</div>
    <div class="notification-footer"><div class="v11-meta">${item.symbol ? renderStockLink(item.symbol, item.name) : ""} · ${escapeHtml(item.source || "StockLab")}</div>${isNotificationRead(item) ? "" : `<button type="button" data-action="mark-notification-read" data-id="${escapeHtml(String(item.id || ""))}">標為已讀</button>`}</div>
  </article>`;
  }).join("") || renderV11Empty("目前沒有通知");
  updateLoadMoreButton("btnLoadMoreNotifications", paginationState.notifications.hasMore, false);
}

async function clearV11Notifications() {
  if (!Api.clearNotifications) return;
  await Api.clearNotifications();
  pageDataCache.notifications = { ok: true, items: [], unreadCount: 0 };
  notificationCacheLoadedAt = Date.now();
  paginationState.notifications.offset = 0;
  updateNotificationBadge(0);
  renderNotifications({ items: [], unreadCount: 0 });
}

function openNotificationSheet() {
  const sheet = document.getElementById("notificationSheet");
  if (!sheet) return;
  sheet.hidden = false;
  document.body.classList.add("floating-sheet-open");
  const cacheFresh = pageDataCache.notifications && Date.now() - notificationCacheLoadedAt < 5 * 60 * 1000;
  if (cacheFresh) renderNotifications(pageDataCache.notifications);
  else loadNotifications();
}

function closeNotificationSheet() {
  const sheet = document.getElementById("notificationSheet");
  if (sheet) sheet.hidden = true;
  syncOverlayBodyClasses();
}

async function markAllNotificationsRead() {
  if (!Api.markAllNotificationsRead) return;
  try {
    const data = await Api.markAllNotificationsRead();
    pageDataCache.notifications = data;
    notificationCacheLoadedAt = Date.now();
    renderNotifications(data);
    updateNotificationBadge(0);
    showToast("通知已全部標為已讀", "success");
  } catch (err) {
    showToast("更新通知失敗：" + err.message, "error");
  }
}

function renderStockDetail(data) {
  if (!data || data.ok === false) {
    showPageError("analysisDetailBody", new Error((data && data.message) || "股票詳細資料讀取失敗"));
    return;
  }
  const latest = data.latest || data.indicator || {};
  const portfolio = data.portfolio || {};
  const symbol = normalizeSymbolInput(data.symbol || latest.symbol);
  cacheExplainContext(Object.assign({}, data, latest));
  const technicalFields = [
    ["MA5", latest.ma5, "MA5"], ["MA20", latest.ma20, "MA20"], ["MA60", latest.ma60, "MA60"],
    ["EMA5", latest.ema5, "EMA5"], ["EMA10", latest.ema10, "EMA10"], ["EMA20", latest.ema20, "EMA20"], ["EMA60", latest.ema60, "EMA60"],
    ["RSI14", latest.rsi14, "RSI"], ["K9", latest.k9, "K9"], ["D9", latest.d9, "D9"],
    ["MACD", latest.macd, "MACD"], ["MACD Histogram", latest.macdHist, "MACD_HIST"],
    ["布林 %B", latest.bbPercentB, "BB_PERCENT_B"], ["布林寬度", latest.bbWidth, "BB_WIDTH"],
    ["ATR", latest.atr14 || latest.atr, "ATR"], ["ATR %", formatMetricPercent(latest.atrPercent), "ATR_PERCENT"],
    ["ADX", latest.adx14, "ADX"], ["+DI", latest.plusDI14, "PLUS_DI"], ["-DI", latest.minusDI14, "MINUS_DI"],
    ["Bias20", latest.bias20, "BIAS20"], ["量比", latest.volumeRatio, "VOLUME_RATIO"], ["VWAP20", latest.vwap20, "VWAP20"],
    ["OBV", latest.obv, "OBV"], ["MFI14", latest.mfi14, "MFI"], ["CCI20", latest.cci20, "CCI"],
    ["Williams %R", latest.williamsR14, "WILLIAMS_R"], ["ROC5", latest.roc5, "ROC5"], ["ROC20", latest.roc20, "ROC20"],
    ["SuperTrend", `${latest.superTrendDirection || "-"} ${number(latest.superTrend)}`, "SUPER_TREND"],
    ["Donchian 20", `${number(latest.donchianLow20)} / ${number(latest.donchianHigh20)}`, "DONCHIAN"],
    ["20 日高點", latest.high20, "HIGH20"], ["20 日低點", latest.low20, "LOW20"],
    ["技術分數", latest.totalScore, "TECH_SCORE"], ["趨勢分數", latest.trendScore, "TREND_SCORE"],
    ["動能分數", latest.momentumScore, "MOMENTUM_SCORE"], ["風險分數", latest.riskScore, "RISK_SCORE"],
    ["突破分數", latest.breakoutScore, "BREAKOUT_SCORE"], ["波動分數", latest.volatilityScore, "VOLATILITY_SCORE"]
  ];
  const signalChips = buildSignalChips_(latest);
  document.getElementById("analysisDetailBody").innerHTML = `
    <section class="panel"><div class="panel-header"><div><h2>指標詳細資料</h2><div class="muted">點擊任一指標查看白話說明與目前數值原因。</div></div></div>
      <div class="signal-chip-row">${renderSignalChips(signalChips, symbol)}</div>
      <div class="v11-grid compact technical-detail-grid">${technicalFields.map(([label, value, key]) => `<div class="v11-card key-value"><span>${escapeHtml(label)}</span>${explainableButton(key, escapeHtml(value === undefined || value === null || value === "" ? "-" : (typeof value === "number" ? number(value) : value)), symbol)}</div>`).join("")}</div>
    </section>
    <section class="v11-card"><strong>系統分析</strong><p>${escapeHtml(data.analysisText || "尚無分析文字")}</p></section>
    <section class="v11-card"><strong>持倉摘要</strong><p>${Number(portfolio.quantity || 0) > 0 ? "目前持有" : "目前未持有"} · 股數 ${number(portfolio.quantity)} · 平均成本 ${number(portfolio.avgCost)} · 未實現損益 ${money(portfolio.unrealizedPnl)} (${number(portfolio.unrealizedRate)}%)</p></section>`;
}

function normalizeTextList(value) {
  if (Array.isArray(value)) {
    return value.map(item => typeof item === "string" ? item : (item.strategyName || item.name || item.strategyType || "")).filter(Boolean);
  }
  return String(value || "").split(/[\n,、|]/).map(text => text.trim()).filter(Boolean);
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
      notificationCacheLoadedAt = Date.now();
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

function isAuthError(err) {
  return Boolean(err && err.code === "AUTH");
}

/**
 * 認證失敗時**絕對不要** fallback 到 Mock。
 * 顯示一整頁看起來合理的模擬數字，比顯示錯誤更危險——
 * 使用者會以為那是自己的真實庫存。
 */
function showAuthRequired(target, err) {
  const container = typeof target === "string" ? document.getElementById(target) : target;
  if (!container) return;
  const body = `<div class="v11-empty error-state">`
    + `<strong>需要存取金鑰</strong>`
    + `<p>${escapeHtml((err && err.message) || "存取金鑰錯誤或已失效")}</p>`
    + `<p><button type="button" data-action="prompt-access-key">重新輸入存取金鑰</button></p>`
    + `</div>`;
  if (container.tagName === "TBODY") {
    const table = container.closest("table");
    const columns = table ? Math.max(1, table.querySelectorAll("thead th").length) : 1;
    container.innerHTML = `<tr><td colspan="${columns}">${body}</td></tr>`;
    return;
  }
  container.innerHTML = body;
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

function renderDashboardV11Summary(data) {
  const container = document.getElementById("dashboardV11Summary");
  if (!container) return;
  const market = data.marketSummary || {};
  const narrative = data.marketNarrative || market.narrative;
  if (!narrative) {
    container.innerHTML = "";
    return;
  }
  const reasonList = narrative && Array.isArray(narrative.reasonList) ? narrative.reasonList : (market.reasonList || []);
  container.innerHTML = `<section class="market-narrative">
    <div class="market-narrative-head">
      <div><div class="section-kicker">盤後判讀</div><h2>${escapeHtml((narrative && narrative.title) || `今日市場：${market.marketMode || "資料不足"}`)}</h2></div>
    </div>
    <p>${escapeHtml((narrative && narrative.summaryText) || market.summaryText || "")}</p>
    ${(narrative && narrative.suggestionText) || market.riskText ? `<p class="market-suggestion">${escapeHtml((narrative && narrative.suggestionText) || market.riskText || "")}</p>` : ""}
    <div class="reason-chips">${reasonList.map(reason => explainableButton("CANDIDATE_REASON", escapeHtml(reason), "TAIEX", "reason-chip-explain", "indicator", reason)).join("")}</div>
  </section>`;
}

function buildMobileMoreLinks() {
  const container = document.getElementById("mobileMoreLinks");
  if (!container) return;
  const links = [
    ["market", "市場總覽"], ["refresh", "重新整理"], ["version", "版本資訊"]
  ];
  container.innerHTML = links.map(([action, label]) => action === "market"
    ? `<button type="button" data-action="open-page" data-page="market">${label}</button>`
    : `<button type="button" data-action="mobile-${action}">${label}</button>`).join("");
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
  let title = "詳細清單";
  let items = [];
  let kind = type;
  if (type === "bullish") {
    title = "偏多股票清單";
    items = getDashboardListSummary(data, "bullish").items;
  } else if (type === "risk") {
    title = "風險提醒清單";
    items = getDashboardListSummary(data, "risk").items;
  } else if (type === "signals") {
    title = "今日訊號清單";
    const summary = getDashboardSignalSummary(data);
    const buyItems = summary.buyItems.map(item => Object.assign({ signalSide: "買入" }, item));
    const sellItems = summary.sellItems.map(item => Object.assign({ signalSide: "賣出" }, item));
    const sellEmpty = Number(summary.sellTotal || 0) > 0 ? "目前持股沒有賣出訊號" : "目前沒有庫存，因此沒有賣出訊號";
    const body = `<div class="dashboard-signal-groups">
      <section><h3>買入訊號</h3>${renderDashboardDetailItems(buyItems, kind, "目前沒有買入訊號")}</section>
      <section><h3>賣出訊號</h3>${renderDashboardDetailItems(sellItems, kind, sellEmpty)}</section>
    </div>`;
    openDashboardDetailSheet(title, body);
    return;
  }
  openDashboardDetailSheet(title, renderDashboardDetailItems(items, kind, dashboardDetailEmptyMessage(type)));
}

function dashboardDetailEmptyMessage(type) {
  if (type === "bullish") return "目前沒有偏多股票";
  if (type === "risk") return "目前沒有風險提醒";
  return "目前沒有符合條件的股票";
}

function renderDashboardDetailItems(items, kind, emptyMessage) {
  if (!items || !items.length) return renderV11Empty(emptyMessage || "目前沒有符合條件的股票");
  return `<div class="detail-list">${items.map(item => {
    const reasons = normalizeTextList(item.reasonList || item.message || item.reason || item.warningType);
    const status = item.trendText || item.statusText || item.signalSide || item.title || "";
    const primaryScore = kind === "risk" ? `風險分數 ${number(item.riskScore)}` : (kind === "signals" ? `${escapeHtml(item.signalSide || "訊號")} · 信心 ${number(item.confidenceScore || item.totalScore)}` : `技術分數 ${number(item.totalScore)}`);
    return `<article class="detail-list-item ${kind === "risk" ? "is-risk" : ""}">
      <div class="detail-list-head"><div>${renderStockLink(item.symbol, item.name)}</div><span class="badge ${getBadgeClass(status)}">${escapeHtml(status)}</span></div>
      <strong>${primaryScore}</strong>
      ${reasons.length ? `<ul>${reasons.map(reason => `<li>${kind === "risk" ? "⚠" : "✓"} ${escapeHtml(reason)}</li>`).join("")}</ul>` : '<p class="muted">尚無進一步說明</p>'}
    </article>`;
  }).join("")}</div>`;
}

function openSparklineStats(symbol) {
  const item = (currentWatchlistItems || []).find(row => normalizeSymbolInput(row.symbol) === normalizeSymbolInput(symbol));
  const stats = calcSparklineStats_((item && item.sparkline) || []);
  const title = `${displaySymbol(symbol, item && item.name)} 近 20 日統計`;
  const body = !stats.valid ? renderV11Empty("資料不足") : `<div class="sparkline-stats-grid">
    <div><span>最高</span><strong>${number(stats.high)}</strong></div>
    <div><span>最低</span><strong>${number(stats.low)}</strong></div>
    <div><span>漲跌</span><strong class="${stats.changePercent >= 0 ? "up" : "down"}">${signedNumber(stats.changePercent)}%</strong></div>
    <div><span>波動</span><strong>${number(stats.rangePercent)}%</strong></div>
  </div>${sparkline((item && item.sparkline) || [], stats.changePercent >= 0 ? "#22c55e" : "#ef4444", 520, 110)}`;
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
  syncOverlayBodyClasses();
}

function openBackfillSheet() {
  const sheet = document.getElementById("backfillSheet");
  if (sheet) sheet.hidden = false;
  document.body.classList.add("detail-sheet-open");
}

function closeBackfillSheet() {
  const sheet = document.getElementById("backfillSheet");
  if (sheet) sheet.hidden = true;
  syncOverlayBodyClasses();
}

function showToast(message, type = "info") {
  const region = document.getElementById("toastRegion");
  if (!region || !message) return;
  const toast = document.createElement("div");
  const safeType = ["info", "success", "warning", "error"].includes(type) ? type : "info";
  toast.className = `toast ${safeType}`;
  toast.textContent = message;
  region.appendChild(toast);
  setTimeout(() => toast.remove(), 4200);
}
