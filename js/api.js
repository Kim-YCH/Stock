const Api = (() => {
  const inflightRequests = new Map();
  const ACCESS_KEY_STORAGE = "stocklab_session_access_key";
  const PUBLIC_ACTIONS = new Set(["version", "lookupStock"]);

  function isConfigured() {
    return typeof API_BASE_URL !== "undefined" && Boolean(API_BASE_URL && API_BASE_URL.trim());
  }

  function requestKey(action, params) {
    return action + ":" + JSON.stringify(params || {});
  }

  function authError(message) {
    const err = new Error(message);
    err.code = "AUTH";
    return err;
  }

  // 使用者按過取消之後就不再自動追問，避免每個請求都彈一次視窗。
  // 要重新輸入請走畫面上的「重新輸入存取金鑰」按鈕。
  let accessKeyDeclined = false;
  let accessKeyRequest = null;

  /**
   * 存取金鑰是選用的：後端沒設 STOCKLAB_API_TOKEN 就完全不需要，
   * 這裡也不會主動詢問。只有後端回 code:"AUTH" 時才會跳出輸入框並自動重試一次。
   */
  function getStoredAccessKey() {
    try { return sessionStorage.getItem(ACCESS_KEY_STORAGE) || ""; } catch (err) { return ""; }
  }

  function clearAccessKey() {
    try { sessionStorage.removeItem(ACCESS_KEY_STORAGE); } catch (err) {}
  }

  /** 主動詢問並保存。供「重新輸入存取金鑰」按鈕與自動重試共用。 */
  function promptAccessKey() {
    const entered = String(window.prompt("請輸入 StockLab 存取金鑰") || "").trim();
    if (!entered) return "";
    accessKeyDeclined = false;
    try { sessionStorage.setItem(ACCESS_KEY_STORAGE, entered); } catch (err) {}
    return entered;
  }

  /** 自動重試用：尊重「使用者已取消」的狀態。 */
  function requestAccessKey() {
    if (accessKeyDeclined) return "";
    const entered = promptAccessKey();
    if (!entered) accessKeyDeclined = true;
    return entered;
  }

  function requestAccessKeyOnce() {
    const stored = getStoredAccessKey();
    if (stored) return Promise.resolve(stored);
    if (accessKeyRequest) return accessKeyRequest;
    accessKeyRequest = Promise.resolve()
      .then(() => getStoredAccessKey() || requestAccessKey())
      .finally(() => { accessKeyRequest = null; });
    return accessKeyRequest;
  }

  function getOnce(action, params = {}, options = {}) {
    const requestParams = options.force ? Object.assign({}, params, { force: "1" }) : params;
    const key = requestKey(action, requestParams);
    if (inflightRequests.has(key)) return inflightRequests.get(key);
    const promise = jsonp(action, requestParams).finally(() => inflightRequests.delete(key));
    inflightRequests.set(key, promise);
    return promise;
  }

  /**
   * 帶認證重試的傳輸層。後端要求金鑰時跳出輸入框，然後**只重試一次**——
   * 第二次仍失敗就往外丟，不會變成無限彈窗迴圈。
   *
   * window.prompt 是同步阻塞的，所以並行請求不會同時彈窗：
   * 先撞到 AUTH 的那個請求問完並存好，其餘的會在 getStoredAccessKey() 直接拿到。
   */
  async function jsonp(action, params = {}) {
    try {
      return await jsonpRaw(action, params);
    } catch (err) {
      if (!err || err.code !== "AUTH") throw err;
      const key = getStoredAccessKey() || await requestAccessKeyOnce();
      if (!key) throw err;
      return jsonpRaw(action, params);
    }
  }

  function jsonpRaw(action, params = {}) {
    return new Promise((resolve, reject) => {
      if (!isConfigured()) {
        reject(new Error("尚未設定 API_BASE_URL，請先更新 js/config.js"));
        return;
      }

      const callbackName = "stock_cb_" + Date.now() + "_" + Math.floor(Math.random() * 100000);
      const url = new URL(API_BASE_URL);
      url.searchParams.set("action", action);
      url.searchParams.set("callback", callbackName);

      // 記住這次請求真正送出的 key。較早送出的 AUTH 回應不得清掉使用者
      // 在另一個請求中剛輸入的新 key，否則並行請求會要求輸入兩次。
      let requestAccessToken = "";
      if (!PUBLIC_ACTIONS.has(action)) {
        requestAccessToken = getStoredAccessKey();
        if (requestAccessToken) url.searchParams.set("token", requestAccessToken);
      }

      Object.entries(params || {}).forEach(([key, value]) => {
        if (value !== undefined && value !== null && value !== "") url.searchParams.set(key, value);
      });

      const script = document.createElement("script");
      let callbackCalled = false;
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
        callbackCalled = true;
        cleanup();
        if (data && data.ok === false) {
          const message = String(data.message || "API 回傳錯誤");
          if (data.code === "AUTH") {
            if (requestAccessToken && requestAccessToken === getStoredAccessKey()) clearAccessKey();
            reject(authError(message));
            return;
          }
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
      script.onload = () => {
        setTimeout(() => {
          if (callbackCalled) return;
          cleanup();
          reject(new Error("API 已載入，但後端沒有執行 JSONP callback"));
        }, 0);
      };

      script.src = url.toString();
      document.body.appendChild(script);
    });
  }

  return {
    isConfigured,
    clearAccessKey,
    promptAccessKey,
    getBackendVersion: () => getOnce("version"),
    getDashboard: (force = false) => getOnce("dashboard", {}, { force }),
    getCandidates: () => getOnce("candidates"),
    getMarketSummary: () => getOnce("marketSummary"),
    getNotifications: (params = {}) => getOnce("notifications", params),
    getNotificationSummary: () => getOnce("notificationSummary"),
    markNotificationRead: (id) => jsonp("markNotificationRead", { id }),
    markAllNotificationsRead: () => jsonp("markAllNotificationsRead"),
    clearNotifications: () => jsonp("clearNotifications"),
    getPortfolio: (force = false) => getOnce("portfolio", {}, { force }),
    refreshPortfolio: () => jsonp("refreshPortfolio"),
    getAnalysis: (symbol, force = false) => getOnce("analysis", { symbol, force: force ? "1" : undefined }, { force }),
    getTransactions: (params = {}) => getOnce("transactions", Object.assign({ limit: 20 }, params)),
    lookupStock: (symbol) => jsonp("lookupStock", { symbol }),
    addWatchlist: (data) => jsonp("addWatchlist", data),
    removeWatchlist: (symbol, name = "") => jsonp("removeWatchlist", { symbol, name }),
    updateDailyPrices: () => jsonp("updateDailyPrices"),
    runDerivedNow: () => jsonp("runDerivedNow"),
    backfillHistoricalPrices: (months = 12, symbols = "") => jsonp("backfillHistoricalPrices", { months, symbols }),
    addTransaction: (data) => jsonp("addTransaction", data),
    deleteTransaction: (id) => jsonp("deleteTransaction", { id })
  };
})();
