// 缓存对 app.js 是 cache-first，改客户端脚本时必须同步升版本号，
// 否则已装过旧版的浏览器会一直跑旧脚本，线上等于没修。
// salem-v6：合入头像/座位资料线——avatar-normalize.js 与 profile-store.js 也进缓存清单，
// 与 reconnect/table-view/deal-view/reveal-view 一并同版本发布。
// salem-v7：角色卡信息面（index.html 的 #roleModal 与 app.js 的技能行）进壳。
// salem-v8：建房页的「线下模式」勾选项与大厅里的状态提示进壳。
const VERSION = "salem-v8";
const SHELL = [
  "/",
  "/styles.css",
  "/app.js",
  "/avatar-normalize.js",
  "/profile-store.js",
  "/reconnect.js",
  "/table-view.js",
  "/deal-view.js",
  "/reveal-view.js",
  "/manifest.webmanifest",
  "/icons/icon-192.png",
  "/icons/icon-512.png",
  "/assets/cards/cards.zh.json",
];

self.addEventListener("install", (event) => {
  event.waitUntil(caches.open(VERSION).then((cache) => cache.addAll(SHELL)).then(() => self.skipWaiting()));
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((key) => key !== VERSION).map((key) => caches.delete(key))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener("fetch", (event) => {
  const request = event.request;
  if (request.method !== "GET") return;
  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return;
  if (url.pathname.startsWith("/api/") || url.pathname === "/health") return;

  if (request.mode === "navigate") {
    event.respondWith(
      fetch(request)
        .then((response) => {
          const copy = response.clone();
          caches.open(VERSION).then((cache) => cache.put("/", copy));
          return response;
        })
        .catch(() => caches.match("/"))
    );
    return;
  }

  const cacheable = url.pathname.startsWith("/assets/") || url.pathname.startsWith("/icons/") ||
    ["/styles.css", "/app.js", "/avatar-normalize.js", "/profile-store.js", "/reconnect.js",
      "/table-view.js", "/deal-view.js", "/reveal-view.js", "/manifest.webmanifest"].includes(url.pathname);
  if (!cacheable) return;

  event.respondWith(
    caches.match(request).then((cached) => {
      if (cached) return cached;
      return fetch(request).then((response) => {
        if (response.ok) {
          const copy = response.clone();
          caches.open(VERSION).then((cache) => cache.put(request, copy));
        }
        return response;
      });
    })
  );
});
