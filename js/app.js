const Mock = {
  dashboard: {
    ok: false,
    updatedAt: "API 未連線",
    market: [],
    watchlist: [],
    message: "尚未取得真實資料。請確認 js/config.js 的 API_BASE_URL 已填入最新 Apps Script Web App URL，並且 GitHub Pages 已重新部署。"
  },
  portfolio: {
    ok: true,
    items: [
      { symbol: "2330", name: "台積電", quantity: 10, avgCost: 820, lastPrice: 965, marketValue: 9650, unrealizedPnl: 1450, unrealizedRate: 17.68, trendText: "偏多" },
      { symbol: "2317", name: "鴻海", quantity: 20, avgCost: 200, lastPrice: 190, marketValue: 3800, unrealizedPnl: -200, unrealizedRate: -5, trendText: "盤整觀察" }
    ]
  },
  analysis: {
    ok: true,
    symbol: "2330",
    name: "台積電",
    portfolio: { avgCost: 820 },
    latest: { close: 965, ma20: 920, ma60: 880, rsi14: 63, totalScore: 78, riskScore: 72, trendText: "偏多" },
    prices: [
      { date: "D1", close: 820, ma20: 815 },
      { date: "D2", close: 835, ma20: 820 },
      { date: "D3", close: 828, ma20: 826 },
      { date: "D4", close: 845, ma20: 832 },
      { date: "D5", close: 860, ma20: 840 },
      { date: "D6", close: 875, ma20: 850 },
      { date: "D7", close: 868, ma20: 858 },
      { date: "D8", close: 890, ma20: 866 },
      { date: "D9", close: 905, ma20: 875 },
      { date: "D10", close: 915, ma20: 884 },
      { date: "D11", close: 930, ma20: 894 },
      { date: "D12", close: 925, ma20: 902 },
      { date: "D13", close: 940, ma20: 910 },
      { date: "D14", close: 955, ma20: 918 },
      { date: "D15", close: 965, ma20: 920 }
    ],
    signals: [
      { date: "2026-07-09", signalName: "收盤站上 MA20", direction: "bullish", note: "股價位於月線上方，趨勢偏多。" },
      { date: "2026-07-09", signalName: "RSI 63", direction: "watch", note: "動能偏多，尚未進入過熱區。" }
    ]
  },
  transactions: {
    ok: true,
    items: [
      { date: "2026-07-01", action: "BUY", symbol: "2330", name: "台積電", quantity: 10, price: 820, fee: 20, tax: 0, currency: "TWD", note: "初始買進" },
      { date: "2026-07-02", action: "BUY", symbol: "2317", name: "鴻海", quantity: 20, price: 200, fee: 20, tax: 0, currency: "TWD", note: "觀察" }
    ]
  }
};

const pages = {
  dashboard: {
    title: "首頁總覽",
    subtitle: "盤後大盤、關注股票與技術訊號",
    loader: loadDashboard
  },
  portfolio: {
    title: "我的庫存",
    subtitle: "成本、損益與技術狀態",
    loader: loadPortfolio
  },
  analysis: {
    title: "線圖分析",
    subtitle: "收盤價線、MA20、平均成本線",
    loader: () => loadAnalysis(normalizeSymbolInput(document.getElementById("analysisSymbol").value) || "2330")
  },
  transactions: {
    title: "交易紀錄",
    subtitle: "新增買進、賣出與股息",
    loader: loadTransactions
  }
};

const CACHE_KEYS = {
  dashboard: "stocklab_dashboard_cache_v1",
  transactions: "stocklab_transactions_cache_v1"
};

document.addEventListener("DOMContentLoaded", () => {
  detectDeviceMode();
  window.addEventListener("resize", detectDeviceMode);

  document.querySelectorAll(".nav-btn").forEach(btn => {
    btn.addEventListener("click", () => changePage(btn.dataset.page));
  });

  document.getElementById("btnLoadAnalysis").addEventListener("click", () => {
    loadAnalysis(normalizeSymbolInput(document.getElementById("analysisSymbol").value) || "2330");
  });

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

  el.textContent = Api.isConfigured() ? "已設定 API" : "未設定 API，未顯示模擬行情";
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
    form.querySelector("input[name='backfill']").checked = true;
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
  renderMarketCards(data.market || []);
  renderWatchlist(data.watchlist || []);
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

async function loadAnalysis(symbol) {
  symbol = normalizeSymbolInput(symbol);
  let data;
  try {
    data = await Api.getAnalysis(symbol);
    setApiStatus("API 已連線");
  } catch (err) {
    data = Mock.analysis;
    setApiStatus(err.message);
  }

  document.getElementById("analysisTitle").textContent =
    `${data.symbol || symbol} ${data.name || ""} 線圖分析`;

  const latest = data.latest || {};
  const portfolio = data.portfolio || {};
  const cards = [
    ["收盤價", latest.close],
    ["MA20", latest.ma20],
    ["MA60", latest.ma60],
    ["RSI14", latest.rsi14],
    ["技術分數", latest.totalScore],
    ["風險分數", latest.riskScore],
    ["技術狀態", latest.trendText || "觀察"],
    ["平均成本", portfolio.avgCost || ""]
  ];

  document.getElementById("indicatorCards").innerHTML = cards.map(([label, value]) => `
    <div class="metric">
      <div class="label">${label}</div>
      <div class="num">${escapeHtml(String(value ?? ""))}</div>
    </div>
  `).join("");

  drawMainChart(data.prices || [], portfolio.avgCost || null);

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
    setApiStatus("已刪除交易紀錄");
    await loadTransactions();
  } catch (err) {
    setApiStatus("刪除交易失敗：" + err.message);
    await loadTransactions();
  } finally {
    btn.disabled = false;
  }
}

function drawMainChart(rows, cost) {
  const svg = document.getElementById("mainChart");
  const width = 920;
  const height = 420;
  const pad = 44;

  const validRows = rows.filter(r => isFinite(Number(r.close)));
  if (!validRows.length) {
    svg.innerHTML = `<text x="40" y="80" fill="#94a3b8">沒有價格資料</text>`;
    return;
  }

  const closes = validRows.map(r => Number(r.close));
  const ma20 = validRows.map(r => Number(r.ma20)).filter(v => isFinite(v));
  const all = closes.concat(ma20);
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

  let costLine = "";
  if (cost && isFinite(Number(cost))) {
    const cy = y(Number(cost));
    costLine = `
      <line x1="${pad}" y1="${cy}" x2="${width - pad}" y2="${cy}" stroke="#eab308" stroke-width="2" stroke-dasharray="8 8" />
      <text x="${width - pad - 96}" y="${cy - 8}" fill="#eab308" font-size="13">成本 ${number(cost)}</text>
    `;
  }

  svg.innerHTML = `
    <defs>
      <linearGradient id="areaGreen" x1="0" x2="0" y1="0" y2="1">
        <stop offset="0%" stop-color="#22c55e" stop-opacity="0.24" />
        <stop offset="100%" stop-color="#22c55e" stop-opacity="0" />
      </linearGradient>
    </defs>
    ${grid.join("")}
    ${costLine}
    <polyline points="${pointsBy("ma20")}" fill="none" stroke="#38bdf8" stroke-width="3" opacity="0.9" />
    <polygon points="${pointsBy("close")} ${lastX},${height - pad} ${pad},${height - pad}" fill="url(#areaGreen)" />
    <polyline points="${pointsBy("close")}" fill="none" stroke="#22c55e" stroke-width="4" />
    <circle cx="${lastX}" cy="${lastY}" r="6" fill="#22c55e" stroke="#052e16" stroke-width="3" />
    <text x="${lastX - 46}" y="${lastY - 14}" fill="#e5e7eb" font-size="14">${number(last.close)}</text>
    <line x1="${pad}" y1="${pad}" x2="${pad}" y2="${height - pad}" stroke="#334155" />
    <line x1="${pad}" y1="${height - pad}" x2="${width - pad}" y2="${height - pad}" stroke="#334155" />
    <text x="${pad}" y="${height - 14}" fill="#94a3b8" font-size="13">${escapeHtml(validRows[0].date || "")}</text>
    <text x="${width - pad - 90}" y="${height - 14}" fill="#94a3b8" font-size="13">${escapeHtml(last.date || "")}</text>
  `;
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
