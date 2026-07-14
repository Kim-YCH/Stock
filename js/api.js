const Api = (() => {
  const inflightRequests = new Map();

  function isConfigured() {
    return typeof API_BASE_URL !== "undefined" && Boolean(API_BASE_URL && API_BASE_URL.trim());
  }

  function requestKey(action, params) {
    return action + ":" + JSON.stringify(params || {});
  }

  function getOnce(action, params = {}, options = {}) {
    const key = requestKey(action, params);
    if (options.force) return jsonp(action, params);
    if (!options.force && inflightRequests.has(key)) return inflightRequests.get(key);
    const promise = jsonp(action, params).finally(() => inflightRequests.delete(key));
    inflightRequests.set(key, promise);
    return promise;
  }

  function jsonp(action, params = {}) {
    return new Promise((resolve, reject) => {
      if (!isConfigured()) {
        reject(new Error("尚未設定 API_BASE_URL，請先更新 js/config.js"));
        return;
      }

      const callbackName = "stock_cb_" + Date.now() + "_" + Math.floor(Math.random() * 100000);
      const url = new URL(API_BASE_URL);
      url.searchParams.set("action", action);
      url.searchParams.set("callback", callbackName);

      const token = typeof API_TOKEN === "undefined" ? "" : API_TOKEN;
      if (token) url.searchParams.set("token", token);

      Object.entries(params || {}).forEach(([key, value]) => {
        if (value !== undefined && value !== null && value !== "") url.searchParams.set(key, value);
      });

      const script = document.createElement("script");
      const timeout = setTimeout(() => {
        cleanup();
        reject(new Error("API 逾時"));
      }, 180000);

      function cleanup() {
        clearTimeout(timeout);
        delete window[callbackName];
        if (script.parentNode) script.parentNode.removeChild(script);
      }

      window[callbackName] = (data) => {
        cleanup();
        if (data && data.ok === false) {
          const message = String(data.message || "API 回傳錯誤");
          if (message.includes("Unknown action")) {
            reject(new Error("Apps Script 後端尚未支援此 action，請部署新版 Web App"));
            return;
          }
          reject(new Error(message));
          return;
        }
        resolve(data);
      };

      script.onerror = () => {
        cleanup();
        reject(new Error("API 載入失敗"));
      };

      script.src = url.toString();
      document.body.appendChild(script);
    });
  }

  return {
    isConfigured,
    getBackendVersion: () => getOnce("version"),
    getDashboard: (force = false) => getOnce("dashboard", {}, { force }),
    getStrategyModels: () => getOnce("strategyModels"),
    getCandidates: () => getOnce("candidates"),
    getCandidateLeaderboard: () => getOnce("candidateLeaderboard"),
    getMarketSummary: () => getOnce("marketSummary"),
    getStrategyResearch: () => getOnce("strategyResearch"),
    getStrategyHealth: () => getOnce("strategyHealth"),
    getStats: () => getOnce("stats"),
    getNotifications: (params = {}) => getOnce("notifications", params),
    getNotificationSummary: () => getOnce("notificationSummary"),
    markNotificationRead: (id) => jsonp("markNotificationRead", { id }),
    clearNotifications: () => jsonp("clearNotifications"),
    getStockDetail: (symbol, force = false) => getOnce("stockDetail", { symbol, force: force ? "1" : undefined }, { force }),
    getPaperSummary: (params = {}) => getOnce("paperSummary", Object.assign({ limit: 50 }, params)),
    createPaperStrategy: (data) => jsonp("createPaperStrategy", data),
    togglePaperStrategy: (strategyId, enabled) => jsonp("togglePaperStrategy", { strategyId, enabled }),
    runPaperTrading: () => jsonp("runPaperTrading"),
    runBacktest: (data) => jsonp("runBacktest", data),
    runBacktestComparison: (data) => jsonp("runBacktestComparison", data),
    getBacktestRuns: (params = {}) => getOnce("backtestRuns", Object.assign({ limit: 20 }, params)),
    getBacktestResult: (runId, tradesLimit = 100) => getOnce("backtestResult", { runId, tradesLimit }),
    getPortfolio: (force = false) => getOnce("portfolio", {}, { force }),
    refreshPortfolio: () => jsonp("refreshPortfolio"),
    getAnalysis: (symbol, force = false) => getOnce("analysis", { symbol, force: force ? "1" : undefined }, { force }),
    getTransactions: (params = {}) => getOnce("transactions", Object.assign({ limit: 100 }, params)),
    lookupStock: (symbol) => jsonp("lookupStock", { symbol }),
    addWatchlist: (data) => jsonp("addWatchlist", data),
    removeWatchlist: (symbol, name = "") => jsonp("removeWatchlist", { symbol, name }),
    updateDailyPrices: () => jsonp("updateDailyPrices"),
    backfillHistoricalPrices: (months = 12, symbols = "") => jsonp("backfillHistoricalPrices", { months, symbols }),
    calculateAllAnalysis: () => jsonp("calculateAllAnalysis"),
    runDailyDerivedCaches: () => jsonp("runDailyDerivedCaches"),
    addTransaction: (data) => jsonp("addTransaction", data),
    deleteTransaction: (id) => jsonp("deleteTransaction", { id }),
    recalculateAfterTransaction: () => jsonp("recalculateAfterTransaction")
  };
})();
