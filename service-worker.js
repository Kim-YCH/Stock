// StockLab PWA 殼層快取。
//
// 目的：讓每日回訪的靜態殼層（HTML/CSS/JS/icon）近乎瞬間呈現，而不必每次都對
// GitHub Pages 重新做條件式往返。**只快取同源靜態資源**，後端 JSONP（script.google.com，
// 跨來源）完全不攔——資料新鮮度不受影響。
//
// 策略：
// - index.html / 導覽請求：network-first（部署後一定拿到新版；離線才回快取）。
// - 帶 ?v= 版本戳的 js/css/icon：cache-first（版本一改就是新 URL，天然 immutable）。
//
// 發版檢查清單：改版時把 CACHE_VERSION 一起 bump（與 APP_VERSION 對齊），
// 讓 activate 清掉舊快取、避免卡舊殼層。
const CACHE_VERSION = "v11.21";
const CACHE_NAME = "stocklab-shell-" + CACHE_VERSION;
const SHELL_ASSETS = [
  "./",
  "./index.html",
  "./css/style.css?v=11.21",
  "./js/config.js?v=11.21",
  "./js/api.js?v=11.21",
  "./js/indicator-explain.js?v=11.21",
  "./js/app.js?v=11.21",
  "./icons/favicon.svg",
  "./manifest.json"
];

self.addEventListener("install", event => {
  event.waitUntil(
    caches.open(CACHE_NAME)
      // 個別資源失敗不阻擋安裝（例如某個 icon 尚未部署）。
      .then(cache => Promise.allSettled(SHELL_ASSETS.map(url => cache.add(url))))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener("activate", event => {
  event.waitUntil(
    caches.keys()
      .then(keys => Promise.all(keys.filter(key => key !== CACHE_NAME).map(key => caches.delete(key))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener("fetch", event => {
  const request = event.request;
  if (request.method !== "GET") return;

  let url;
  try { url = new URL(request.url); } catch (err) { return; }

  // 跨來源（後端 JSONP script.google.com / googleusercontent）一律不攔，交給瀏覽器原生處理。
  if (url.origin !== self.location.origin) return;

  // 本機開發（localhost / 127.0.0.1）不走 SW 快取，一律直連網路——
  // 開發時 ?v= 版本戳不會每次改，否則改了檔會一直被舊快取蓋住。正式站不受影響。
  if (url.hostname === "localhost" || url.hostname === "127.0.0.1") return;

  const isNavigation = request.mode === "navigate" ||
    url.pathname.endsWith("/") ||
    url.pathname.endsWith("index.html");

  if (isNavigation) {
    // network-first，但網路「慢而不死」時（lie-fi）不能無限等——跟 3 秒逾時賽跑，
    // 逾時就先用快取殼層讓使用者看到畫面，網路真的回來時仍在背景把快取更新成最新版。
    event.respondWith(
      (() => {
        const networkFetch = fetch(request).then(response => {
          const copy = response.clone();
          caches.open(CACHE_NAME).then(cache => cache.put(request, copy)).catch(() => {});
          return response;
        });
        // 網路請求本身仍在背景繼續跑，即使逾時分支先回應了也會更新快取；
        // 這裡吞掉「已經逾時、沒人等它」情境下的 rejection，避免變成 unhandled rejection。
        networkFetch.catch(() => {});
        const timeout = new Promise(resolve => {
          setTimeout(() => resolve(null), 3000);
        });
        return Promise.race([networkFetch, timeout]).then(response => {
          if (response) return response;
          return caches.match(request).then(hit => hit || caches.match("./index.html"));
        }).catch(() => caches.match(request).then(hit => hit || caches.match("./index.html")));
      })()
    );
    return;
  }

  // 靜態資源：cache-first，未命中才抓網路並補進快取。
  event.respondWith(
    caches.match(request).then(hit => hit || fetch(request).then(response => {
      const copy = response.clone();
      caches.open(CACHE_NAME).then(cache => cache.put(request, copy)).catch(() => {});
      return response;
    }))
  );
});
