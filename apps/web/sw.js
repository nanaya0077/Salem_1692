// 缓存对 app.js 是 cache-first，改客户端脚本时必须同步升版本号，
// 否则已装过旧版的浏览器会一直跑旧脚本，线上等于没修。
// salem-v6：合入头像/座位资料线——avatar-normalize.js 与 profile-store.js 也进缓存清单，
// 与 reconnect/table-view/deal-view/reveal-view 一并同版本发布。
// salem-v7：角色卡信息面（index.html 的 #roleModal 与 app.js 的技能行）进壳。
// salem-v11：座位卡与结算面板不再显示「曾为女巫」。
// salem-v10：翻身份卡的横幅挪到桌面正中空白区，不压轮次条与手牌。
// salem-v9：身份卡改双面 3D 翻牌，翻身份卡的全桌横幅进壳。
// salem-v8：建房页的「线下模式」勾选项与大厅里的状态提示进壳。
// salem-v20：传染阶段的完整演出——压暗与印章、换牌三拍、私密 peek 与 sfx.conspiracy.start。
// salem-v19：传染面板倒计时最后 5 秒变金（.conspiracy-clock.warn）。
// salem-v21：抽屉外壳 drawer-shell.js 进壳，传染改用槽位写入（#63）。
// salem-v17：终局四段揭晓与指控成立金色脉冲；均非阻塞，终局可点击落终态。
// salem-v22：挂起揭示迁到共享抽屉（两步选定、放弃、等待与时钟），旧的顶部 revealBar 已删。
// salem-v23：起因与两个数字改由挂起态自带（#68），标题按起因分支，选择者与等待者同形。
// salem-v24：自动代翻后抽屉留 900ms 说清「超时或托管，自动取了第一个位置」（#64 口径）。
const VERSION = "salem-v24";
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
  "/conspiracy-view.js",
    "/drawer-shell.js",
  "/motion-events.js",
  "/motion-level.js",
  "/motion.js",
  "/render-patch.js",
  "/audio.js",
  "/manifest.webmanifest",
  "/icons/icon-192.png",
  "/icons/icon-512.png",
  "/assets/cards/cards.zh.json",
  "/assets/fx/conspiracy-seal.svg",
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
      "/table-view.js", "/deal-view.js", "/reveal-view.js", "/conspiracy-view.js",
    "/drawer-shell.js", "/motion-events.js",
      "/motion-level.js", "/motion.js", "/render-patch.js", "/audio.js",
      "/manifest.webmanifest"].includes(url.pathname);
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

