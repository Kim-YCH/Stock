const Api = (() => {
  function isConfigured() {
    return Boolean(API_BASE_URL && API_BASE_URL.trim());
  }

  function jsonp(action, params = {}) {
    return new Promise((resolve, reject) => {
      if (!isConfigured()) {
        reject(new Error("尚未設定 API_BASE_URL，使用假資料"));
        return;
      }

      const callbackName = "stock_cb_" + Date.now() + "_" + Math.floor(Math.random() * 100000);
      const url = new URL(API_BASE_URL);

      url.searchParams.set("action", action);
      url.searchParams.set("callback", callbackName);

      if (API_TOKEN) {
        url.searchParams.set("token", API_TOKEN);
      }

      Object.entries(params).forEach(([key, value]) => {
        if (value !== undefined && value !== null) {
          url.searchParams.set(key, value);
        }
      });

      const script = document.createElement("script");
      const timeout = setTimeout(() => {
        cleanup();
        reject(new Error("API 逾時"));
      }, 180000);

      function cleanup() {
        clearTimeout(timeout);
        delete window[callbackName];
        if (script.parentNode) {
          script.parentNode.removeChild(script);
        }
      }

      window[callbackName] = (data) => {
        cleanup();
        if (data && data.ok === false) {
          reject(new Error(data.message || "API 回傳錯誤"));
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
    getDashboard: () => jsonp("dashboard"),
    getPortfolio: () => jsonp("portfolio"),
    getAnalysis: (symbol) => jsonp("analysis", { symbol }),
    getTransactions: () => jsonp("transactions"),
    updateDailyPrices: () => jsonp("updateDailyPrices"),
    backfillHistoricalPrices: (months = 12, symbols = "") => jsonp("backfillHistoricalPrices", { months, symbols }),
    clearDemoData: () => jsonp("clearDemoData"),
    repairSymbolCodes: () => jsonp("repairSymbolCodes"),
    calculateAllAnalysis: () => jsonp("calculateAllAnalysis"),
    addTransaction: (data) => jsonp("addTransaction", data)
  };
})();
