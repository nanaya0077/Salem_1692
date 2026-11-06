# Railway 部署 runbook

托管形态的两条定案见 `docs/adr/0003-single-replica-ephemeral-rooms.md`（单副本、重启清房）与 `docs/adr/0004-dockerfile-manual-deploy.md`（Dockerfile 构建、手动发布）。本文只写怎么操作。

平台事实（构建器、Node 版本解析顺序、健康检查、计费、区域）见 `docs/research/railway-deploy-facts.md`。

本文里的 **Deploy / Redeploy / Restart 都是面板上的人工动作**：本机的 Railway CLI 未授权（`railway whoami` 报 grant invalid），命令行与脚本只能做事后验证，不能代为触发。所以每一处需要点击的步骤都留了「证据位」，由执行人点完、验完再回填。

## 现状（2026-11-06 建好并核对）

| 项 | 面板 / API 实际值 |
| --- | --- |
| 项目 | `Salem_1692` / `7987a6ab-36bd-4f5e-a10e-49b308fddf1f` |
| 服务 | `salem-online` / `bb45b318-2ee6-4448-9063-fd6f36e8d47c` |
| 环境 | `production` / `2dcec8b2-89bb-4258-a198-46f12a54f21a` |
| 构建 | `builder: DOCKERFILE`、`dockerfilePath: /Dockerfile` |
| 构建 commit | `4686b6d`（仓根 Dockerfile 与部署冒烟脚本那张票） |
| 副本 | `numReplicas: 1` |
| 区域 | `multiRegionConfig: { asia-southeast1-eqsg3a: { numReplicas: 1 } }`（Singapore 单区） |
| 健康检查 | `healthcheckPath: /health`，`healthcheckTimeout: 300` 秒 |
| 变量 | 无自定义变量；应用读平台注入的 `PORT` |
| 域名 | https://salem-online-production.up.railway.app，`targetPort: 8080` |
| Auto Deploy | 已关闭（只有人点 Deploy 才发布） |

两处容易被面板误导：老字段 `region` 读出来一直是 `null`，真正生效的是 `multiRegionConfig`；改完区域必须重新部署一次才会落到新区域。域名 `targetPort` 是 8080，与 Dockerfile 的 `EXPOSE 8080` 和应用默认 `PORT` 8080 一致。

从本机（上海，2026-11-06）连续 `GET /health` 5 次，`time_total` 0.75–0.83 秒（含 TLS 握手），与新加坡单区相符。

## 一次性建服务

1. Railway 新建空项目，命名 `Salem_1692`，环境 `production`。
2. 连 GitHub 仓库 `nanaya0077/Salem_1692`，分支 `main`。
3. **关闭** `Auto Deploy`（Settings → Source）。这一步是纪律，不是建议：开着它，任何一次 merge 都会打断正在进行的对局。
4. 区域选 Singapore `asia-southeast1-eqsg3a`；副本数保持 1。
5. 健康检查路径填 `/health`，超时用默认 300 秒。
6. 构建方式不用手填命令：仓根有 `Dockerfile` 时平台必定用它，面板随后显示 `builder: DOCKERFILE` 与 `dockerfilePath: /Dockerfile`。不要在这个服务上设 Root Directory（它是仓根），否则 `apps/server/src/server.mjs:27` 读不到 `apps/web` 与 `assets`。
7. 生成默认域名 `*.up.railway.app`，`targetPort` 填 **8080**。自定义域名要同时加 CNAME 与 TXT，暂不做。
8. 变量一个都不加。应用读 `PORT`（平台注入），四个节奏参数留空即默认值。

## 发布一次（每次上线照此执行）

前置：要发的提交已经在 `main` 上（其他分支先 PR 合入）。

1. 发布前留基线：`curl -s https://salem-online-production.up.railway.app/health`，记下 `uptime` 与 `rooms`。
2. Railway → 项目 `Salem_1692` → 服务 `salem-online` 的 **Deployments** 页 → 右上 `Deploy`（手动），确认要发的是 `main` 的最新提交。
3. 盯构建日志到镜像构建完成。构建期 `npm ci --prefix apps/server` 失败，通常是锁文件没跟着改。
4. 部署日志出现 `salem server listening http://0.0.0.0:<port>`，且健康检查拿到 2xx，本次部署才切 active。
5. 验证（三条都要）：

   ```bash
   curl -s https://salem-online-production.up.railway.app/health
   # 期望 {"ok":true,"rooms":0,"uptime":<刚归零的秒数>}

   $env:BASE="https://salem-online-production.up.railway.app"; node apps/server/test/deploy-smoke.mjs
   # 期望最后一行 "冒烟通过"
   ```

   再用浏览器打开默认域名，建房拿到 6 位房码，Network 里 `wss://<域名>/ws` 是 101。

发布即全员掉线：正在进行的对局会随旧进程消失，尽量挑没有对局的时段。

**证据位 E1（发布）**：待用户执行 · 由 Lead 回填。回填内容 = 部署 id、Deployments 页的 commit 哈希、上面两条命令的原始输出。

⚠️ 线上当前那份部署的构建 commit 是 `4686b6d`，**早于 #19 的终态提示**。证据：把线上首页与本机 `apps/web/index.html` 逐行比对，只差「重新开房」按钮那一行（`<button id="reopenBtn" …>重新开房</button>`），`apps/web/reconnect.js` 在线上也还不存在。所以「重启后旧房码失效」这一步必须在**发布一次之后**验，否则验到的是没有终态提示的旧前端。

## 回滚一次

1. 打开 **Deployments** 页，找到上一个状态为 Success 的部署（列表里按时间倒序，排在当前 active 之上那一条）。
2. 该行右侧 `⋮` → `Redeploy`。它重发的是那一份**已经构建好的镜像**，不走构建、不改仓库历史。
3. 等它切 active，按发布第 5 步同样验证：`/health` 的 `uptime` 归零、`deploy-smoke.mjs` 通过、首页能开房。

不要用 revert commit 的方式回滚：那会再走一遍构建，且把仓库历史搞乱。

**证据位 E2（回滚）**：待用户执行 · 由 Lead 回填。回填内容 = 回滚目标的部署 id 与 commit、回滚后 `/health` 与冒烟输出。

## 重启后旧房码失效（#19 的验收动作）

这一步验的是「单副本 + 内存态」的因果链（见 `docs/adr/0003-single-replica-ephemeral-rooms.md`），不是新的功能。

线上操作：

1. 先造一个房：打开默认域名，建房，记下 6 位房码，**页面别关**（关掉页面等于主动离房，房间会被回收，验不出重启的效果）。
2. 服务页 → `⋮` → `Restart`（或直接再做一次 Redeploy），等 `/health` 的 `uptime` 归零。
3. 回到那个还停在旧房码上的页面：不应停在"重连中"，而应回到落地页，房码错误提示的位置显示「**房间已失效，请重新开房。**」，下面多出「重新开房」按钮；点它能开新房。

对应的服务端事实可以单独查，不必依赖浏览器：

```bash
curl -s -o NUL -w "%{http_code}\n" https://salem-online-production.up.railway.app/api/rooms/<旧房码>
# 期望 404
```

本机已按同一路径实测过一次（2026-11-06，`PORT=8143` 起服务、建房 `UM5TA5`、杀进程重启）：

```text
before restart /api/rooms/UM5TA5 -> 200 ；/health {"ok":true,"rooms":1,"uptime":5.10}
after  restart /api/rooms/UM5TA5 -> 404 ；/health {"ok":true,"rooms":0,"uptime":2.03}
旧房码 join -> {"type":"error","message":"房间不存在或已结束","reason":"room-not-found"}
```

`room-not-found` 在客户端就是终态：`errorOutcome()` 把 `room-not-found` 判成 `room-gone`，落点 `enterRoomGone()` 停止重连、清存档、回落地页并显示提示文案（文案常量 `ROOM_GONE_MESSAGE`；判定与落点分别在 `apps/web/reconnect.js` 与 `apps/web/app.js`）。`apps/web/test/reconnect.test.js` 覆盖这一条：`cd apps/web && node --test test/reconnect.test.js`，14 条全过。

**证据位 E3（线上重启）**：待用户执行 · 由 Lead 回填。回填内容 = 重启前后 `/health` 的 `uptime`、旧房码 404 的响应、页面截图或文案。

## 看日志与排障

- 运行日志在服务 → Logs；客户端连不上的第一件事是看有没有 `salem server listening` 行、有没有进程崩溃栈。
- `GET /health` 只回答"进程活着"：它带 `rooms` 计数（`apps/server/src/server.mjs:932-935`），但房间为 0 也一样返回 200。
- `GET /api/rooms` 与 `GET /api/rooms/{code}`（`apps/server/src/server.mjs:937`、`:942`）可以确认房间表当前有几个房；房码不存在返回 404。
- WS 连不上先在浏览器控制台看握手 URL 用的是 `ws://` 还是 `wss://`；协议由 `connect()` 里的 `location.protocol` 推导（`apps/web/app.js:121`），页面走 https 就必须是 `wss://`。

## 变量

除平台注入的 `PORT` 外**不写任何变量**。四个节奏参数（`NIGHT_MS` 30000、`DAWN_MS` 45000、`TURN_MS` 90000、`GRACE_MS` 60000，见 `apps/server/src/server.mjs:32-35`）留空即用默认值；要调手感时在 Variables 面板加，改完会自动重新部署——同样意味着全员掉线。

## 成本

工作区是 Pro 档，每月含 $20 用量，超出按账期末计费。设用量告警，不设硬性停机上限：硬上限触发会停掉进程，对进行中的对局等同掉线。

## 验收清单（对应 #21）

跑冒烟的两种姿势：

```bash
# 公网
$env:BASE="https://salem-online-production.up.railway.app"; node apps/server/test/deploy-smoke.mjs

# 本机（另开一个终端起服务）
$env:PORT="8137"; node apps/server/src/server.mjs
$env:BASE="http://127.0.0.1:8137"; node apps/server/test/deploy-smoke.mjs
```

| 验收项 | 状态 | 证据 |
| --- | --- | --- |
| 手动发布一次，公网首页与开房可用 | 待用户执行 · 由 Lead 回填 | 证据位 E1；公网冒烟已在 2026-11-06 跑通（见下） |
| 回滚到上一次部署后旧版仍可用 | 待用户执行 · 由 Lead 回填 | 证据位 E2 |
| 线上重启后旧房码页面出现「房间已失效，请重新开房」 | 链路已在本机实测；线上要等发布一次后再验 | 证据位 E3；上节实测输出 + `apps/web/test/reconnect.test.js`。线上现役部署早于 #19，见 E1 下的⚠️ |
| 文档的一次性配置项与面板实际值逐项一致 | 已对齐 | 「现状」表逐行，含项目/服务/环境 id、构建器与 Dockerfile 路径、副本、区域、健康检查、变量、域名 targetPort、Auto Deploy |
| README 有一句指向运维文档 | 已加 | `README.md` 文档段 |
| 冒烟脚本对公网跑通 | 已通过 | 2026-11-06 对 https://salem-online-production.up.railway.app 跑 `deploy-smoke.mjs`，9 项全 ok |

公网冒烟实测输出（2026-11-06，`/health` 报 `uptime` 约 28532 秒，即当时这份部署已连续运行约 7.9 小时）：

```text
ok   GET /health 2xx  status 200
ok   /health 返回 ok 与房间数  {"ok":true,"rooms":1,"uptime":28531.701348427}
ok   GET / 返回页面  status 200, 8507 bytes
ok   GET /api/rooms 可解析  status 200
ok   WS 握手成功  wss://salem-online-production.up.railway.app/ws
ok   建房拿到房码  SXDNMX
ok   按房码查房  status 200
ok   房间出现在列表里
ok   不存在的房码返回 404  status 404

冒烟通过  (https://salem-online-production.up.railway.app)
```

本机同一脚本（`PORT=8137`，全新进程 `uptime` 2.1 秒）同样 9 项全 ok；另外本机 `apps/server/test/smoke.mjs` 也过：建房 → 4 人准备 → 开局 → 黎明 → 抽牌全通，无报错。两边的 `status 200, NNNN bytes` 数值不必对上——那是脚本里 `indexHtml.length`（字符串长度）：线上跑的是缺「重新开房」按钮那一行的旧版本，本机跑的是当前分支。

只有 1 个副本在跑这一条由「现状」表的 `numReplicas: 1` 与 `multiRegionConfig` 共同保证；冒烟脚本查不出副本数，判据只能看面板。
