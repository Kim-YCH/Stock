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
  dashboard: "stocklab_dashboard_cache_v10",
  transactions: "stocklab_transactions_cache_v1"
};
const STRATEGY_MODELS_FALLBACK = [
  {
    strategyType: "MULTI_FACTOR_BALANCED_V1",
    strategyName: "多指標平衡波段策略",
    riskLevel: "中等",
    bestFor: "一般個股與 ETF 的波段比較",
    description: "綜合趨勢、動能、風險、KD、布林、ATR 與 ADX，訊號較均衡。",
    buySummary: "站上 MA20、MACD 正向，搭配分數、RSI 與趨勢確認。",
    sellSummary: "跌破 MA20、動能轉弱、分數惡化或觸發停損停利。"
  },
  {
    strategyType: "TREND_FOLLOWING_V1",
    strategyName: "趨勢順勢策略",
    riskLevel: "中高",
    bestFor: "趨勢明確、成交活躍的個股",
    description: "使用 MA20 / MA60、ADX、DI 與 MACD 確認趨勢後順勢進場。",
    buySummary: "收盤高於 MA20、MA20 高於 MA60，ADX 與 +DI 確認多頭。",
    sellSummary: "跌破 MA20 且動能轉弱、空方 DI 轉強，或觸發停損停利。"
  },
  {
    strategyType: "VOLUME_BREAKOUT_V1",
    strategyName: "量價突破策略",
    riskLevel: "高",
    bestFor: "接近 20 日高點且量能放大的強勢股",
    description: "用 20 日高點、成交量、布林位置與動能分數尋找突破。",
    buySummary: "突破分數達標、量比放大、站上 MA20，且 RSI 尚未極端過熱。",
    sellSummary: "跌回 MA20、突破失敗與 MACD 轉弱，或快速停損停利。"
  },
  {
    strategyType: "BULL_PULLBACK_V1",
    strategyName: "多頭回檔策略",
    riskLevel: "中等",
    bestFor: "MA20 高於 MA60、短線拉回的標的",
    description: "只在中期多頭結構內，利用 RSI、KD 與布林位置等待回檔。",
    buySummary: "MA20 高於 MA60，價格守住 MA60，RSI 與布林位置落在回檔區。",
    sellSummary: "跌破 MA60、MACD 續弱、反彈達標或觸發停損。"
  },
  {
    strategyType: "LOW_VOLATILITY_V1",
    strategyName: "低波動防守策略",
    riskLevel: "低",
    bestFor: "大型股、ETF 與偏穩健的波段配置",
    description: "偏好低 ATR、風險分數高且均線結構向上的標的。",
    buySummary: "MA20 高於 MA60、價格站上 MA20，ATR 較低且風險分數較高。",
    sellSummary: "跌破 MA60、月線與動能同步轉弱，或較緊的停損停利。"
  },
  {
    strategyType: "SCORE_ROTATION_V1",
    strategyName: "分數輪動策略",
    riskLevel: "中高",
    bestFor: "想用盤後技術分數挑隔日強勢候選",
    description: "以總分、趨勢、動能與風險分數做輪動篩選，避免只看單一指標。",
    buySummary: "總分與風險分數達標，趨勢或突破至少一項強，且收盤站上短均線。",
    sellSummary: "分數轉弱、跌破 MA20、MACD 轉空，或觸發停損停利。"
  },
  {
    strategyType: "EARLY_TURNAROUND_V1",
    strategyName: "早期轉強策略",
    riskLevel: "中等",
    bestFor: "回檔後剛轉強、還沒明顯追高的標的",
    description: "用 KD、MACD、布林位置與 RSI 捕捉偏早的轉強訊號。",
    buySummary: "RSI 由低檔回升區、KD 偏多、MACD 不再惡化，且風險分數可接受。",
    sellSummary: "轉強失敗、跌破 MA20 或風險分數惡化即退出。"
  },
  {
    strategyType: "MOMENTUM_CONTINUATION_V1",
    strategyName: "動能續強策略",
    riskLevel: "高",
    bestFor: "主升段或產業輪動明顯時的強勢股",
    description: "用 MA 結構、MACD、量比、突破分數與 ADX 篩選續強標的。",
    buySummary: "MA20 高於 MA60，價格站上 MA20，MACD 與量能確認動能延續。",
    sellSummary: "跌破短均線且動能降溫，或高檔過熱後轉弱。"
  },
  {
    strategyType: "ETF_STABLE_SWING_V1",
    strategyName: "ETF 穩定波段策略",
    riskLevel: "低",
    bestFor: "ETF、大型權值股與低波動配置",
    description: "偏重低 ATR、MA 結構、風險分數與不過熱的布林位置。",
    buySummary: "低波動、MA20 高於 MA60，價格站上 MA20，RSI 與布林位置不過熱。",
    sellSummary: "跌破 MA60、風險轉弱，或達到較保守的獲利保護。"
  }
];
let strategyModels = STRATEGY_MODELS_FALLBACK.slice();
const STRATEGY_CHART_COLORS = ["#38bdf8", "#22c55e", "#f59e0b", "#f472b6", "#a78bfa", "#14b8a6", "#fb7185", "#84cc16", "#eab308"];
const analysisMemoryCache = new Map();
const analysisRequests = new Map();
const ANALYSIS_LINE_OPTIONS = [
  { key: "ma5", label: "MA5", color: "#f97316", default: false },
  { key: "ma20", label: "MA20", color: "#38bdf8", default: true },
  { key: "ma60", label: "MA60", color: "#a78bfa", default: false },
  { key: "bbUpper", label: "布林上軌", color: "#f472b6", default: false, dash: "7 6" },
  { key: "bbLower", label: "布林下軌", color: "#f472b6", default: false, dash: "7 6" },
  { key: "high20", label: "20日高", color: "#eab308", default: false, dash: "5 5" },
  { key: "low20", label: "20日低", color: "#14b8a6", default: false, dash: "5 5" }
];
const analysisLineState = Object.fromEntries(ANALYSIS_LINE_OPTIONS.map(option => [option.key, option.default === true]));
let activeAnalysisSymbol = "";
let activeAnalysisData = null;
let currentCandidateData = Mock.candidates;
let currentBacktestResults = [];
let activeBacktestStrategyType = "";
let topHistoricalBacktestStrategyType = "";
let runtimeBackendVersion = "";

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
  document.getElementById("btnBackfillHistory").addEventListener("click", onBackfillHistoricalPrices);
  document.getElementById("btnRefreshVersion").addEventListener("click", refreshAppVersion);
  document.getElementById("btnToggleWatchForm").addEventListener("click", toggleWatchForm);
  document.getElementById("btnEmptyAddWatch").addEventListener("click", () => toggleWatchForm(true));
  document.getElementById("watchlistForm").addEventListener("submit", onSubmitWatchlist);
  document.addEventListener("click", onDocumentClick);

  document.getElementById("transactionForm").addEventListener("submit", onSubmitTransaction);

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
    analysisMemoryCache.clear();
    const marketText = result.marketIndex && result.marketIndex.ok
      ? `，加權 ${result.marketIndex.close}`
      : `，大盤未更新：${(result.marketIndex && result.marketIndex.message) || "未知原因"}`;
    setApiStatus(`更新完成：新增 ${result.inserted || 0}，更新 ${result.updated || 0}${marketText}`);
    await loadDashboard();
  } catch (err) {
    setApiStatus("更新失敗：" + err.message);
  } finally {
    btn.disabled = false;
    btn.textContent = oldText;
  }
}


async function onBackfillHistoricalPrices() {
  const btn = document.getElementById("btnBackfillHistory");
  if (!Api.isConfigured()) {
    setApiStatus("尚未設定 API_BASE_URL，無法回補歷史資料");
    return;
  }

  const monthsText = prompt("要回補最近幾個月？\n建議先填 12。股票很多時可先填 6。", "12");
  if (monthsText === null) return;

  const months = Number(monthsText || 12);
  if (!Number.isFinite(months) || months <= 0) {
    setApiStatus("回補月份格式錯誤");
    return;
  }

  const symbols = prompt("要指定股票代號嗎？\n空白 = 回補 Stocks / Watchlist / Portfolio 全部股票。\n範例：2330,2317,006208", "");
  if (symbols === null) return;
  const normalizedSymbols = normalizeSymbolListInput(symbols);

  btn.disabled = true;
  const oldText = btn.textContent;
  btn.textContent = "回補中...";
  setApiStatus(`正在回補最近 ${months} 個月歷史資料`);

  try {
    const result = await Api.backfillHistoricalPrices(months, normalizedSymbols);
    analysisMemoryCache.clear();
    setApiStatus(`回補完成：抓到 ${result.fetched || 0} 筆，新增 ${result.inserted || 0}，更新 ${result.updated || 0}`);
    await loadDashboard();
  } catch (err) {
    setApiStatus("回補失敗：" + err.message);
  } finally {
    btn.disabled = false;
    btn.textContent = oldText;
  }
}

async function refreshAppVersion() {
  const confirmed = confirm("要重新載入最新版本嗎？");
  if (!confirmed) return;

  try {
    setApiStatus("正在更新版本...");

    if ("caches" in window) {
      const keys = await caches.keys();
      await Promise.all(keys.map(key => caches.delete(key)));
    }

    if ("serviceWorker" in navigator) {
      const registrations = await navigator.serviceWorker.getRegistrations();

      for (const registration of registrations) {
        if (registration.update) {
          await registration.update();
        }
      }
    }

    reloadWithVersionStamp();
  } catch (error) {
    console.error(error);
    reloadWithVersionStamp();
  }
}

function reloadWithVersionStamp() {
  const url = new URL(window.location.href);
  url.searchParams.set("v", Date.now().toString());
  window.location.href = url.toString();
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

function getAppVersion() {
  return typeof APP_VERSION === "undefined" ? "v10.14" : APP_VERSION;
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
  saveTransactionsCache(cached);
  renderTransactions(cached.items);
}

function removeCachedTransaction(id) {
  const cached = getCachedTransactions();
  if (!cached) return;
  cached.items = (cached.items || []).filter(item => String(item.id || "") !== String(id));
  saveTransactionsCache(cached);
  renderTransactions(cached.items);
}

function upsertCachedWatchlistItem(item) {
  const cached = getCachedDashboard() || { ok: true, market: [], watchlist: [] };
  const symbol = String(item.symbol || "").trim();
  const list = (cached.watchlist || []).filter(row => String(row.symbol || "").trim() !== symbol);
  cached.watchlist = [item].concat(list);
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
  saveDashboardCache(cached);
  renderDashboard(cached);
}

function removeCachedWatchlistItem(symbol) {
  const cached = getCachedDashboard();
  if (!cached) return;
  const target = String(symbol || "").trim();
  cached.watchlist = (cached.watchlist || []).filter(item => String(item.symbol || "").trim() !== target);
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
  payload.symbol = normalizeSymbolInput(payload.symbol);

  const message = document.getElementById("watchFormMessage");
  const symbol = payload.symbol;
  if (!symbol) {
    message.textContent = "請輸入股票代號";
    return;
  }

  upsertCachedWatchlistItem({
    symbol,
    name: "",
    trendText: "同步中",
    signalSummary: "後端查詢股票名稱中",
    pending: true
  });
  message.textContent = "已先加入畫面，正在同步...";

  try {
    const result = await Api.addWatchlist(payload);
    if (payload.backfill === "true") analysisMemoryCache.clear();
    const stock = result.stock || {};
    replaceCachedWatchlistItem(symbol, {
      symbol: stock.symbol || symbol,
      name: stock.name || "",
      trendText: "觀察",
      signalSummary: ""
    });
    message.textContent = result.warning
      ? `${result.message || "已加入關注股票"}：${result.warning}`
      : (result.message || "已加入關注股票");
    form.reset();
    form.querySelector("input[name='backfill']").checked = false;
    await loadDashboard();
  } catch (err) {
    message.textContent = "加入失敗：" + err.message;
    removeCachedWatchlistItem(symbol);
  }
}

async function onDocumentClick(event) {
  const txBtn = event.target.closest('[data-action="delete-transaction"]');
  if (txBtn) {
    await onDeleteTransaction(txBtn);
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
    await loadDashboard();
  } catch (err) {
    setApiStatus("移除失敗：" + err.message);
  } finally {
    btn.disabled = false;
  }
}

function changePage(pageName) {
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

async function loadDashboard() {
  const cached = getCachedDashboard();
  if (cached) {
    renderDashboard(cached);
    setApiStatus("已載入快取，正在更新...");
  }

  try {
    const data = await Api.getDashboard();
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
  const lastRun = data.lastRun || {};
  const dataDate = data.dataDate || lastRun.dataDate || "";
  const updatedAt = data.updatedAt || lastRun.finishedAt || lastRun.updatedAt || "";
  setBackendVersionLabel(runtimeBackendVersion || data.version || lastRun.version || "");

  renderUpdateStatus(updatedAt, dataDate, data.version, lastRun);
  renderMarketCards(data.market || []);
  renderWatchlist(data.watchlist || []);
}

async function loadCandidates() {
  try {
    const data = await Api.getCandidates();
    currentCandidateData = data;
    renderCandidates(data);
    setApiStatus("候選清單已更新");
  } catch (err) {
    currentCandidateData = Mock.candidates;
    renderCandidates(Mock.candidates);
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
          <td data-label="股票">${escapeHtml(displaySymbol(item.symbol, item.name))} ${escapeHtml(item.name || "")}</td>
          <td data-label="模型" class="candidate-models">${formatCandidateModels(item)}</td>
          <td data-label="收盤價">${number(item.close)}</td>
          <td data-label="RSI">${number(item.rsi14)}</td>
          <td data-label="技術分數">${number(item.totalScore)}</td>
          <td data-label="風險分數">${number(item.riskScore)}</td>
          <td data-label="狀態"><span class="badge ${getBadgeClass(item.trendText)}">${escapeHtml(item.trendText || "觀察")}</span></td>
          <td data-label="候選分數"><strong>${number(item.buyScore)}</strong></td>
          <td data-label="符合原因" class="candidate-reason">${escapeHtml(item.reason || "")}</td>
        </tr>
      `).join("")
    : candidateEmptyRow(`目前沒有符合「${strategyName}」的買入候選`, 9);

  document.getElementById("sellCandidatesBody").innerHTML = sellItems.length
    ? sellItems.map(item => {
        const pnlClass = Number(item.unrealizedPnl) >= 0 ? "up" : "down";
        return `
          <tr>
            <td data-label="股票">${escapeHtml(displaySymbol(item.symbol, item.name))} ${escapeHtml(item.name || "")}</td>
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
            <td data-label="符合原因" class="candidate-reason">${escapeHtml(item.reason || "")}</td>
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
  return unique.map(name => `<span>${escapeHtml(name)}</span>`).join("");
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

  loadStrategyModels();
}

async function loadStrategyModels() {
  if (!Api.isConfigured() || typeof Api.getStrategyModels !== "function") return;
  try {
    const data = await Api.getStrategyModels();
    if (data && Array.isArray(data.items) && data.items.length) {
      strategyModels = data.items;
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
    const current = select.value || "MULTI_FACTOR_BALANCED_V1";
    select.innerHTML = strategyModels.map(model => `<option value="${escapeHtml(model.strategyType)}">${escapeHtml(model.strategyName)}</option>`).join("");
    select.value = strategyModels.some(model => model.strategyType === current) ? current : "MULTI_FACTOR_BALANCED_V1";
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
  const checked = new Set(existing.length ? existing : ["MULTI_FACTOR_BALANCED_V1"]);
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

async function loadPaperSummary() {
  const dashboard = getCachedDashboard();
  const symbolInput = document.querySelector("#paperStrategyForm input[name='symbols']");
  if (symbolInput && !symbolInput.value && dashboard && dashboard.watchlist) symbolInput.value = dashboard.watchlist.map(item => normalizeSymbolInput(item.symbol)).filter(Boolean).join(",");
  try { renderPaperSummary(await Api.getPaperSummary()); setApiStatus("虛擬交易資料已更新"); }
  catch (err) { renderPaperSummary(Mock.paper); setApiStatus("虛擬交易載入失敗：" + err.message); }
}

async function onCreatePaperStrategy(event) {
  event.preventDefault(); const form = event.currentTarget; const data = Object.fromEntries(new FormData(form).entries());
  data.enabled = form.elements.enabled.checked ? "true" : "false"; data.symbols = normalizeSymbolListInput(data.symbols);
  const message = document.getElementById("paperMessage"); message.textContent = "正在建立策略...";
  try { const result = await Api.createPaperStrategy(data); renderPaperSummary(result.summary); message.textContent = "虛擬策略已建立"; }
  catch (err) { message.textContent = "建立失敗：" + err.message; }
}

async function onRunPaperTrading() {
  const message = document.getElementById("paperMessage"); message.textContent = "正在執行盤後虛擬交易...";
  try { const result = await Api.runPaperTrading(); message.textContent = `完成，本次產生 ${result.tradeCount || 0} 筆虛擬交易`; await loadPaperSummary(); }
  catch (err) { message.textContent = "執行失敗：" + err.message; }
}

async function onTogglePaperStrategy(event) {
  const input = event.target.closest("[data-strategy-id]"); if (!input) return;
  try { const result = await Api.togglePaperStrategy(input.dataset.strategyId, input.checked ? "true" : "false"); renderPaperSummary(result.summary); }
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

async function loadBacktestRuns() {
  try {
    const data = await Api.getBacktestRuns();
    const done = (data.items || []).find(item => item.status === "DONE");
    if (!done) return;
    currentBacktestResults = [];
    document.getElementById("backtestComparisonPanel").hidden = true;
    renderBacktest(await Api.getBacktestResult(done.runId));
  } catch (err) {
    setApiStatus("尚無回測結果");
  }
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
  document.getElementById("backtestSummary").innerHTML = [summaryCard("總報酬率", number(data.totalReturn) + "%", Number(data.totalReturn)>=0?"up":"down"), summaryCard("總損益", money(data.totalPnl), Number(data.totalPnl)>=0?"up":"down"), summaryCard("交易次數", number(data.tradeCount), ""), summaryCard("勝率", number(data.winRate) + "%", ""), summaryCard("平均獲利", money(data.avgProfit), "up"), summaryCard("平均虧損", money(data.avgLoss), "down"), summaryCard("最大回撤", number(data.maxDrawdown) + "%", "down")].join("");
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

function renderMarketCards(items) {
  const container = document.getElementById("marketCards");
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

  container.innerHTML = items.map(item => {
    const cls = Number(item.change) >= 0 ? "up" : "down";
    const changeText = item.symbol === "BULL" || item.symbol === "RISK"
      ? `${item.changePercent || 0}%`
      : `${number(item.change)} ${number(item.changePercent)}%`;

    const dateText = item.date ? `<div class="card-date">${escapeHtml(item.date)}</div>` : "";
    const isMock = String(item.date || "").includes("模擬") || Number(item.close) === 23520;
    const mockText = isMock ? `<div class="mock-hint">疑似模擬 / 舊資料</div>` : "";

    return `
      <div class="card ${isMock ? "demo-warning" : ""}">
        <div class="card-title">${escapeHtml(item.name || item.symbol)}</div>
        <div class="card-value">${number(item.close)}</div>
        <div class="${cls}">${changeText}</div>
        ${dateText}
        ${mockText}
        ${sparkline(item.trend || [], cls === "up" ? "#22c55e" : "#ef4444")}
      </div>
    `;
  }).join("");
}

function renderWatchlist(items) {
  const tbody = document.getElementById("watchlistBody");
  const empty = document.getElementById("emptyWatchlist");
  const visibleItems = (items || []).filter(item => item.enabled === undefined || item.enabled === true || String(item.enabled).toUpperCase() === "TRUE" || item.enabled === "");

  empty.classList.toggle("hidden", visibleItems.length > 0);

  if (!visibleItems.length) {
    tbody.innerHTML = "";
    return;
  }

  tbody.innerHTML = visibleItems.map(item => {
    const badgeClass = getBadgeClass(item.trendText);
    const safeSymbol = escapeHtml(String(item.symbol || ""));
    const safeName = escapeHtml(String(item.name || ""));
    return `
      <tr>
        <td data-label="股票">${escapeHtml(displaySymbol(item.symbol, item.name))} ${escapeHtml(item.name || "")}</td>
        <td data-label="收盤">${number(item.close)}</td>
        <td data-label="RSI">${number(item.rsi14)}</td>
        <td data-label="量比">${number(item.volumeRatio)}</td>
        <td data-label="分數">${number(item.totalScore)}</td>
        <td data-label="狀態"><span class="badge ${badgeClass}">${escapeHtml(item.trendText || "觀察")}</span></td>
        <td data-label="訊號">${escapeHtml(item.signalSummary || "")}</td>
        <td data-label="迷你線圖" class="td-sparkline">${sparkline(item.trend || [], "#38bdf8", 160, 36)}</td>
        <td data-label="操作"><button class="danger-btn" type="button" data-action="remove-watchlist" data-symbol="${safeSymbol}" data-name="${safeName}">移除</button></td>
      </tr>
    `;
  }).join("");
}

async function loadPortfolio() {
  let data;
  try {
    data = await Api.getPortfolio();
    setApiStatus("API 已連線");
  } catch (err) {
    data = Mock.portfolio;
    setApiStatus(err.message);
  }

  const items = data.items || [];
  const totalCost = items.reduce((sum, x) => sum + Number(x.totalCost || (x.avgCost * x.quantity) || 0), 0);
  const marketValue = items.reduce((sum, x) => sum + Number(x.marketValue || 0), 0);
  const pnl = items.reduce((sum, x) => sum + Number(x.unrealizedPnl || 0), 0);
  const rate = totalCost ? pnl / totalCost * 100 : 0;

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
        <td data-label="股票">${escapeHtml(displaySymbol(item.symbol, item.name))} ${escapeHtml(item.name || "")}</td>
        <td data-label="股數">${number(item.quantity)}</td>
        <td data-label="平均成本">${number(item.avgCost)}</td>
        <td data-label="收盤價">${number(item.lastPrice)}</td>
        <td data-label="市值">${money(item.marketValue)}</td>
        <td data-label="未實現損益" class="${pnlCls}">${money(item.unrealizedPnl)}</td>
        <td data-label="報酬率" class="${pnlCls}">${number(item.unrealizedRate)}%</td>
        <td data-label="技術狀態"><span class="badge ${getBadgeClass(item.trendText)}">${escapeHtml(item.trendText || "觀察")}</span></td>
      </tr>
    `;
  }).join("");
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

async function loadTransactions() {
  const cached = getCachedTransactions();
  if (cached) {
    renderTransactions(cached.items || []);
    setApiStatus("已載入交易快取，正在更新...");
  }

  try {
    const data = await Api.getTransactions();
    saveTransactionsCache(data);
    renderTransactions(data.items || []);
    setApiStatus("API 已連線");
  } catch (err) {
    if (!cached) {
      renderTransactions(Mock.transactions.items || []);
    }
    setApiStatus(err.message);
  }
}

function renderTransactions(items) {
  document.getElementById("transactionsBody").innerHTML = (items || []).map(item => {
    const id = escapeHtml(String(item.id || ""));
    const disabled = item.pending ? "disabled" : "";
    const statusText = item.pending ? "同步中" : "刪除";
    return `
    <tr>
      <td data-label="日期">${escapeHtml(item.date || "")}</td>
      <td data-label="類型">${escapeHtml(item.action || "")}</td>
      <td data-label="股票">${escapeHtml(displaySymbol(item.symbol, item.name))} ${escapeHtml(item.name || "")}</td>
      <td data-label="股數">${number(item.quantity)}</td>
      <td data-label="價格">${number(item.price)}</td>
      <td data-label="手續費">${number(item.fee)}</td>
      <td data-label="稅">${number(item.tax)}</td>
      <td data-label="備註">${escapeHtml(item.note || "")}</td>
      <td data-label="操作"><button class="danger-btn" type="button" data-action="delete-transaction" data-id="${id}" ${disabled}>${statusText}</button></td>
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
    pending: true
  };

  addCachedTransaction(optimisticItem);
  message.textContent = "已先加入畫面，正在同步...";
  form.reset();
  const dateInput = document.querySelector("input[name='date']");
  if (dateInput) dateInput.valueAsDate = new Date();

  try {
    await Api.addTransaction(payload);
    analysisMemoryCache.clear();
    clearCache(CACHE_KEYS.dashboard);
    clearCache(CACHE_KEYS.transactions);
    message.textContent = "新增成功";
    await loadTransactions();
  } catch (err) {
    message.textContent = "新增失敗：" + err.message;
    removeCachedTransaction(optimisticItem.id);
  }
}

async function onDeleteTransaction(btn) {
  const id = btn.dataset.id;
  if (!id) return;

  const ok = confirm("確定要刪除這筆交易紀錄嗎？");
  if (!ok) return;

  const cached = getCachedTransactions();
  if (cached) {
    cached.items = (cached.items || []).filter(item => String(item.id || "") !== id);
    saveTransactionsCache(cached);
    renderTransactions(cached.items || []);
  }

  try {
    btn.disabled = true;
    setApiStatus("正在刪除交易紀錄...");
    await Api.deleteTransaction(id);
    analysisMemoryCache.clear();
    clearCache(CACHE_KEYS.dashboard);
    clearCache(CACHE_KEYS.transactions);
    setApiStatus("已刪除交易紀錄");
    await loadTransactions();
  } catch (err) {
    setApiStatus("刪除交易失敗：" + err.message);
    await loadTransactions();
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
    .split(/[\s,，、]+/)
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
  if (text.includes("偏弱") || text.includes("風險")) return "danger";
  if (text.includes("盤整") || text.includes("過熱") || text.includes("觀察")) return "warn";
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
