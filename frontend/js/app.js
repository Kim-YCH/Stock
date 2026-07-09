const Mock = {
  dashboard: {
    ok: true,
    updatedAt: "Mock Data",
    market: [
      { symbol: "TAIEX", name: "加權指數", close: 23520, change: 180, changePercent: 0.77, trend: [23100, 23150, 23280, 23240, 23400, 23520] },
      { symbol: "OTC", name: "櫃買指數", close: 260.5, change: 2.1, changePercent: 0.82, trend: [252, 254, 253, 257, 258, 260.5] },
      { symbol: "BULL", name: "關注股偏多", close: 12, change: 0, changePercent: 60, trend: [7, 8, 8, 10, 11, 12] },
      { symbol: "RISK", name: "風險提醒", close: 3, change: 0, changePercent: 0, trend: [1, 2, 2, 3, 2, 3] }
    ],
    watchlist: [
      { symbol: "2330", name: "台積電", close: 965, rsi14: 63, volumeRatio: 1.35, totalScore: 78, trendText: "偏多", signalSummary: "收盤站上 MA20", trend: [900, 910, 920, 935, 955, 965] },
      { symbol: "2317", name: "鴻海", close: 190, rsi14: 45, volumeRatio: 0.82, totalScore: 48, trendText: "盤整觀察", signalSummary: "跌破 MA20", trend: [202, 198, 195, 192, 188, 190] },
      { symbol: "006208", name: "富邦台50", close: 125, rsi14: 61, volumeRatio: 1.1, totalScore: 75, trendText: "偏多", signalSummary: "均線多頭", trend: [112, 115, 118, 121, 123, 125] }
    ]
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
    loader: () => loadAnalysis(document.getElementById("analysisSymbol").value || "2330")
  },
  transactions: {
    title: "交易紀錄",
    subtitle: "新增買進、賣出與股息",
    loader: loadTransactions
  }
};

document.addEventListener("DOMContentLoaded", () => {
  document.querySelectorAll(".nav-btn").forEach(btn => {
    btn.addEventListener("click", () => changePage(btn.dataset.page));
  });

  document.getElementById("btnLoadAnalysis").addEventListener("click", () => {
    loadAnalysis(document.getElementById("analysisSymbol").value || "2330");
  });

  document.getElementById("btnUpdateDaily").addEventListener("click", onUpdateDailyPrices);
  document.getElementById("btnBackfillHistory").addEventListener("click", onBackfillHistoricalPrices);

  document.getElementById("transactionForm").addEventListener("submit", onSubmitTransaction);

  const dateInput = document.querySelector("input[name='date']");
  if (dateInput) dateInput.valueAsDate = new Date();

  setApiStatus();
  loadDashboard();
});


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
    setApiStatus(`更新完成：新增 ${result.inserted || 0}，更新 ${result.updated || 0}`);
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

  btn.disabled = true;
  const oldText = btn.textContent;
  btn.textContent = "回補中...";
  setApiStatus(`正在回補最近 ${months} 個月歷史資料`);

  try {
    const result = await Api.backfillHistoricalPrices(months, symbols || "");
    setApiStatus(`回補完成：抓到 ${result.fetched || 0} 筆，新增 ${result.inserted || 0}，更新 ${result.updated || 0}`);
    await loadDashboard();
  } catch (err) {
    setApiStatus("回補失敗：" + err.message);
  } finally {
    btn.disabled = false;
    btn.textContent = oldText;
  }
}

function setApiStatus(message) {
  const el = document.getElementById("apiStatus");
  if (message) {
    el.textContent = message;
    return;
  }

  el.textContent = Api.isConfigured() ? "已設定 API" : "未設定 API，使用假資料";
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
  let data;
  try {
    data = await Api.getDashboard();
    setApiStatus("API 已連線");
  } catch (err) {
    data = Mock.dashboard;
    setApiStatus(err.message);
  }

  renderMarketCards(data.market || []);
  renderWatchlist(data.watchlist || []);
}

function renderMarketCards(items) {
  const container = document.getElementById("marketCards");
  container.innerHTML = items.map(item => {
    const cls = Number(item.change) >= 0 ? "up" : "down";
    const changeText = item.symbol === "BULL" || item.symbol === "RISK"
      ? `${item.changePercent || 0}%`
      : `${number(item.change)} ${number(item.changePercent)}%`;

    return `
      <div class="card">
        <div class="card-title">${escapeHtml(item.name || item.symbol)}</div>
        <div class="card-value">${number(item.close)}</div>
        <div class="${cls}">${changeText}</div>
        ${sparkline(item.trend || [], cls === "up" ? "#22c55e" : "#ef4444")}
      </div>
    `;
  }).join("");
}

function renderWatchlist(items) {
  const tbody = document.getElementById("watchlistBody");
  tbody.innerHTML = items.map(item => {
    const badgeClass = getBadgeClass(item.trendText);
    return `
      <tr>
        <td>${escapeHtml(item.symbol)} ${escapeHtml(item.name || "")}</td>
        <td>${number(item.close)}</td>
        <td>${number(item.rsi14)}</td>
        <td>${number(item.volumeRatio)}</td>
        <td>${number(item.totalScore)}</td>
        <td><span class="badge ${badgeClass}">${escapeHtml(item.trendText || "觀察")}</span></td>
        <td>${escapeHtml(item.signalSummary || "")}</td>
        <td>${sparkline(item.trend || [], "#38bdf8", 160, 36)}</td>
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
        <td>${escapeHtml(item.symbol)} ${escapeHtml(item.name || "")}</td>
        <td>${number(item.quantity)}</td>
        <td>${number(item.avgCost)}</td>
        <td>${number(item.lastPrice)}</td>
        <td>${money(item.marketValue)}</td>
        <td class="${pnlCls}">${money(item.unrealizedPnl)}</td>
        <td class="${pnlCls}">${number(item.unrealizedRate)}%</td>
        <td><span class="badge ${getBadgeClass(item.trendText)}">${escapeHtml(item.trendText || "觀察")}</span></td>
      </tr>
    `;
  }).join("");
}

async function loadAnalysis(symbol) {
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
  let data;
  try {
    data = await Api.getTransactions();
    setApiStatus("API 已連線");
  } catch (err) {
    data = Mock.transactions;
    setApiStatus(err.message);
  }

  const items = data.items || [];
  document.getElementById("transactionsBody").innerHTML = items.map(item => `
    <tr>
      <td>${escapeHtml(item.date || "")}</td>
      <td>${escapeHtml(item.action || "")}</td>
      <td>${escapeHtml(item.symbol || "")} ${escapeHtml(item.name || "")}</td>
      <td>${number(item.quantity)}</td>
      <td>${number(item.price)}</td>
      <td>${number(item.fee)}</td>
      <td>${number(item.tax)}</td>
      <td>${escapeHtml(item.currency || "")}</td>
      <td>${escapeHtml(item.note || "")}</td>
    </tr>
  `).join("");
}

async function onSubmitTransaction(event) {
  event.preventDefault();

  const form = event.currentTarget;
  const formData = new FormData(form);
  const payload = Object.fromEntries(formData.entries());

  const message = document.getElementById("formMessage");

  try {
    await Api.addTransaction(payload);
    message.textContent = "新增成功";
    form.reset();
    const dateInput = document.querySelector("input[name='date']");
    if (dateInput) dateInput.valueAsDate = new Date();
    await loadTransactions();
  } catch (err) {
    message.textContent = "新增失敗：" + err.message;
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
