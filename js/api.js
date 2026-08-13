const Api = (() => {
  const inflightRequests = new Map();
  const SESSION_STORAGE = "stocklab_session";
  const PUBLIC_ACTIONS = new Set(["version", "login", "logout"]);

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

  // 由 app.js 注入：() => Promise<idToken|null>，用於 AUTH 失敗時的靜默重新登入。
  let silentReauth = null;
  function setSilentReauth(fn) { silentReauth = fn; }

  // 單飛（single-flight）重登：多個請求同時因 AUTH 失敗時，GIS 的靜默重新
  // 登入是單例 callback，不能並發呼叫（後一次呼叫會蓋掉前一次，讓前面的
  // caller 卡到逾時才失敗）。所以所有並發的 AUTH 失敗共用同一個
  // 「靜默取 idToken + login 換新 session」promise；settle 後清掉，讓下一次
  // 新的 AUTH 失敗可以重新觸發。
  let reauthPromise = null;
  function reauthAndLogin() {
    if (!reauthPromise) {
      // 清掉 in-flight 標記放進同一個 async IIFE 的 finally，而不是外部再
      // 鏈一個 .finally()——後者會多出一條沒人接的 promise 鏈，reauth 失敗
      // 時（idToken 為空）會變成 Node 認定的 unhandled rejection。
      reauthPromise = (async () => {
        try {
          const idToken = await silentReauth();
          if (!idToken) throw authError("靜默重新登入未取得 idToken");
          return await login(idToken);
        } finally {
          reauthPromise = null;
        }
      })();
    }
    return reauthPromise;
  }

  function getStoredSession() {
    try { return localStorage.getItem(SESSION_STORAGE) || ""; } catch (e) { return ""; }
  }
  function setStoredSession(s) {
    try { localStorage.setItem(SESSION_STORAGE, s || ""); } catch (e) {}
  }
  function clearSession() {
    try { localStorage.removeItem(SESSION_STORAGE); } catch (e) {}
  }
  function hasSession() { return Boolean(getStoredSession()); }

  // 使用者身分（email/role/isAdmin）也持久化，讓「重新整理後用既有 session 進來」
  // 時仍知道自己是不是 admin（否則 admin 分頁重整後不會出現）。
  // 角色一旦被改，後端會撤銷 session 強制重登，所以這份快取不會過期到出錯。
  const USER_STORAGE = "stocklab_user";
  function getStoredUser() {
    try { return JSON.parse(localStorage.getItem(USER_STORAGE) || "null"); } catch (e) { return null; }
  }
  function setStoredUser(u) {
    try { localStorage.setItem(USER_STORAGE, JSON.stringify(u || null)); } catch (e) {}
  }
  function clearStoredUser() {
    try { localStorage.removeItem(USER_STORAGE); } catch (e) {}
  }

  // 共用瀏覽器的多使用者衛生：dashboard/transactions 等資料快取一律以
  // "stocklab_cache_" 為前綴（見 app.js 的 CACHE_KEYS）。登出，或登入的
  // email 與上一個使用者不同時，把這些快取全部清掉，避免 B 看到 A 的資料。
  const DATA_CACHE_PREFIX = "stocklab_cache_";
  function purgeDataCaches() {
    try {
      Object.keys(localStorage).forEach(key => {
        if (key.indexOf(DATA_CACHE_PREFIX) === 0) localStorage.removeItem(key);
      });
    } catch (e) {}
  }

  async function login(idToken) {
    const previousUser = getStoredUser();
    const data = await jsonpRaw("login", { idToken });
    if (data && data.session) setStoredSession(data.session);
    const user = { email: data.email, role: data.role, isAdmin: data.isAdmin === true };
    if (previousUser && previousUser.email && user.email && previousUser.email !== user.email) {
      purgeDataCaches();
    }
    setStoredUser(user);
    return user;
  }
  async function logout() {
    const s = getStoredSession();
    clearSession();
    clearStoredUser();
    purgeDataCaches();
    if (s) { try { await jsonpRaw("logout", { session: s }); } catch (e) {} }
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
   * 帶認證重試的傳輸層。session 失效時（後端回 code:"AUTH"）先嘗試用
   * silentReauth 靜默取得新的 Google ID token 換一個新 session，然後
   * **只重試一次**——第二次仍失敗，或沒有 silentReauth 可用，就往外丟。
   */
  async function jsonp(action, params = {}, options = {}) {
    try {
      return await jsonpRaw(action, params, options);
    } catch (err) {
      if ((options.signal && options.signal.aborted) || !err || err.code !== "AUTH" || !silentReauth) throw err;
      try {
        await reauthAndLogin();                 // 並發 AUTH 共用同一次靜默重登 + 換 session
      } catch (reauthErr) {
        throw err;                              // 靜默重登失敗：往外丟原本的 AUTH 錯誤
      }
      if (options.signal && options.signal.aborted) throw err;
      return jsonpRaw(action, params, options); // 只重試一次
    }
  }

  function jsonpRaw(action, params = {}, options = {}) {
    return new Promise((resolve, reject) => {
      if (!isConfigured()) {
        reject(new Error("尚未設定 API_BASE_URL，請先更新 js/config.js"));
        return;
      }

      const callbackName = "stock_cb_" + Date.now() + "_" + Math.floor(Math.random() * 100000);
      const url = new URL(API_BASE_URL);
      url.searchParams.set("action", action);
      url.searchParams.set("callback", callbackName);

      // 記住這次請求真正送出的 session。較早送出的 AUTH 回應不得清掉
      // 另一個請求剛換好的新 session，否則並行請求會多重新登入一次。
      let requestSession = "";
      if (!PUBLIC_ACTIONS.has(action)) {
        requestSession = getStoredSession();
        if (requestSession) url.searchParams.set("session", requestSession);
      }

      Object.entries(params || {}).forEach(([key, value]) => {
        if (value !== undefined && value !== null && value !== "") url.searchParams.set(key, value);
      });

      const script = document.createElement("script");
      let callbackCalled = false;
      let settled = false;
      // 後端 Apps Script 單次執行硬上限是 6 分鐘。前端逾時設在 350 秒（約 5.8 分），
      // 給重算類請求接近完整的後端預算，又不會在後端已死之後還空等。
      const timeout = setTimeout(() => {
        cleanup();
        reject(new Error("API 逾時"));
      }, 350000);

      let abortListener = null;
      function cleanup() {
        clearTimeout(timeout);
        if (options.signal && abortListener) options.signal.removeEventListener("abort", abortListener);
        delete window[callbackName];
        if (script.parentNode) script.parentNode.removeChild(script);
      }

      function abort() {
        if (settled) return;
        settled = true;
        cleanup();
        const err = new Error("Dashboard status request cancelled");
        err.code = "ABORTED";
        reject(err);
      }

      if (options.signal) {
        if (options.signal.aborted) { abort(); return; }
        abortListener = abort;
        options.signal.addEventListener("abort", abortListener, { once: true });
      }

      window[callbackName] = (data) => {
        if (settled) return;
        settled = true;
        callbackCalled = true;
        cleanup();
        if (data && data.ok === false) {
          const message = String(data.message || "API 回傳錯誤");
          if (data.code === "AUTH") {
            if (requestSession && requestSession === getStoredSession()) clearSession();
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
        if (settled) return;
        settled = true;
        cleanup();
        reject(new Error("API 載入失敗"));
      };
      script.onload = () => {
        setTimeout(() => {
          if (callbackCalled) return;
          if (settled) return;
          settled = true;
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
    login,
    logout,
    hasSession,
    getStoredSession,
    getStoredUser,
    setSilentReauth,
    getBackendVersion: () => getOnce("version"),
    getDashboard: (force = false) => getOnce("dashboard", {}, { force }),
    getDashboardStatus: (options = {}) => jsonp("dashboard", {}, options),
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
    scheduleDerivedRebuild: () => jsonp("scheduleDerivedRebuild"),
    backfillHistoricalPrices: (months = 12, symbols = "", scope = "") => jsonp("backfillHistoricalPrices", { months, symbols, scope }),
    addTransaction: (data) => jsonp("addTransaction", data),
    deleteTransaction: (id) => jsonp("deleteTransaction", { id }),
    listUsers: () => jsonp("listUsers"),
    addUser: (email, role, displayName = "") => jsonp("addUser", { email, role, displayName }),
    updateUser: (email, fields = {}) => jsonp("updateUser", Object.assign({ email }, fields)),
    removeUser: (email) => jsonp("removeUser", { email })
  };
})();
