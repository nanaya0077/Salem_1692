# Railway 部署 runbook

托管形态的两条定案见 `docs/adr/0003-single-replica-ephemeral-rooms.md`（单副本、重启清房）与 `docs/adr/0004-dockerfile-manual-deploy.md`（Dockerfile 构建、手动发布）。本文只写怎么操作。

平台事实（构建器、Node 版本解析顺序、健康检查、计费、区域）见 `docs/research/railway-deploy-facts.md`。

本文里的 **Deploy / Redeploy / Restart 都是人工动作**：本机的 Railway CLI 未授权（`railway whoami` 报 grant invalid），命令行与脚本只能做事后验证。

2026-11-06 的首次上线与回滚是用**面板等价路径**做的：在已登录的 dashboard 页面里直接调 `https://backboard.railway.com/graphql/v2`（`fetch` 带 `credentials: "include"`，即复用面板自身的会话），对应三个 mutation——`serviceInstanceDeployV2(environmentId, serviceId, commitSha)` 发布、`deploymentRedeploy(id)` 回滚、`deploymentRestart(id)` 重启。面板上的等价点击是：服务节点右键 → `Latest deploy`；部署卡片 `⋮` → `Redeploy` / `Restart`。两条路效果相同，下面每一步都同时写清「点哪里」和「验什么」，每处留了「证据位」。

## 现状（2026-11-06 建好并核对）

| 项 | 面板 / API 实际值 |
| --- | --- |
| 项目 | `Salem_1692` / `7987a6ab-36bd-4f5e-a10e-49b308fddf1f` |
| 服务 | `salem-online` / `bb45b318-2ee6-4448-9063-fd6f36e8d47c` |
| 环境 | `production` / `2dcec8b2-89bb-4258-a198-46f12a54f21a` |
| 构建 | `builder: DOCKERFILE`、`dockerfilePath: /Dockerfile` |
| 构建 commit | 线上现役 `9ff599f`（挂起揭示抽屉线收口，部署 `59b1e5d3-…`，2026-11-08）；此前为 `122dd10`（`5975c6f7-…`）；同一环境里还留着 `9c5ab94`（`136e2e77-…`）、`644d661`（`2540b2aa-…`）、`7f24a3e`（`f2f9eef0-…`）、`33b9e5e`（`4e2cfb93-…`）、`49057d3`（`97f2772a-…`）、`e720751`（`e68d9de2-…`）、`3c751ae`（`cd594cc1-…`）与 `4686b6d`（`c0cbd48c-…`）等可回滚部署 |
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
2. Railway → 项目 `Salem_1692` → 服务 `salem-online` 的 **Deployments** 页。**这一页没有全局 `Deploy` 按钮**（2026-11-06 逐个查过 DOM），入口在左栏服务节点上：右键 `salem-online` → **`Latest deploy`**，它按 `main` 最新提交发一版；或者对任一行 `⋮` → `Redeploy` 重发那一份已构建好的镜像。没有新提交、只想让进程重来时用 `Restart`。
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

**证据位 E1（发布）· 已回填 2026-11-06**：
- 发布对象 `main` @ `3c751ae`（PR #23 squash 合并后的提交）。
- 部署 id `5bc7089f-3818-4632-a6c5-f80d1f6b3277`，`createdAt 2026-11-06T02:57:21.113Z`，`BUILDING → DEPLOYING → SUCCESS`；`meta.commitHash 3c751aeb364c7daee623ed0a0457156d30b15d6b`、`imageDigest sha256:c613880105a1…`、`builder DOCKERFILE`、`dockerfilePath /Dockerfile`。
- 验证：`/health` 返回 `{"ok":true,"rooms":0,"uptime":18.98}`（与 18 秒前的发布对齐）；`deploy-smoke.mjs` **9/9 通过**（首页 8581 bytes、建房 `598TNQ`、`wss://` 握手 101）；`/reconnect.js` 200（2764 bytes，含 `ROOM_GONE_MESSAGE`）、`/sw.js` 报 `salem-v2`、首页含 `id="reopenBtn"` —— 三项一起证明线上跑的就是 #19 之后的代码，不是缓存里的旧前端。

历史记录（供以后判断「线上是不是新版」参考）：本次发布之前，线上那份部署的构建 commit 是 `4686b6d`，早于 #19，首页缺「重新开房」按钮、也没有 `/reconnect.js`。所以「重启后旧房码失效」只能在**发布一次之后**验，否则验到的是没有终态提示的旧前端。判断线上版本的廉价探针：`/reconnect.js` 是否 200、`/sw.js` 里的 `salem-vN`、首页是否含 `id="reopenBtn"`；要判「发牌确认线与座位资料线在不在」，再加 `/deal-view.js`、`/reveal-view.js`、`/table-view.js`、`/profile-store.js`、`/avatar-normalize.js` 五个是否 200（`e720751` 之前它们全是 404）；要判「线下模式在不在」，看首页有没有 `id="offlineMode"`、`/sw.js` 是否 `salem-v8` 及以上。

## 回滚一次

1. 打开 **Deployments** 页，找到上一个成功过的部署（列表按时间倒序，就在当前 active 那条的下面）。它的状态徽标会显示 `REMOVED`——**这是正常的，不代表镜像没了**：被新部署顶下来的旧部署仍留在历史里、仍能重发（2026-11-06 的回滚就是对一个 `REMOVED` 部署做的，成功）。
2. 该行右侧 `⋮` → `Redeploy`。它重发的是那一份**已经构建好的镜像**，不走构建、不改仓库历史。
3. 等它切 active，按发布第 5 步同样验证：`/health` 的 `uptime` 归零、`deploy-smoke.mjs` 通过、首页能开房。

不要用 revert commit 的方式回滚：那会再走一遍构建，且把仓库历史搞乱。

**证据位 E2（回滚）· 已回填 2026-11-06**：
- 回滚目标：上一次成功部署 `e6a5ff4b-f391-47d2-bb2f-160a499f66f9`（commit `4686b6d`，即 #19 之前那一版），`⋮` → `Redeploy`。
- 结果：新部署 id `c0cbd48c-49ad-4c53-9d44-8d6ad5e1ff3c`，`createdAt 2026-11-06T03:01:34.121Z`，`INITIALIZING → BUILDING → DEPLOYING → SUCCESS`，`meta.commitHash 4686b6da54e5d118ca001a71407b1c5cd2e5f9b0`。
- 回滚后旧版可用：`deploy-smoke.mjs` **9/9 通过**；且三个版本探针同时翻回旧值——`/reconnect.js` **404**、`/sw.js` **salem-v1**、首页**无** `reopenBtn`。这既证明旧版能正常开房，也证明回滚靠的是旧镜像，没有动仓库历史。
- 收回：验完立刻用发布同一套动作把 `3c751ae` 发回去，得到部署 `cd594cc1-9780-42f4-a3b3-34fbc3aae60f`（SUCCESS，`commitHash 3c751aeb…`），三个探针全部翻回新版，`/health {"ok":true,"rooms":0,"uptime":20.55}`，冒烟 9/9。

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

**证据位 E3（线上重启）· 已回填 2026-11-06**：
- 造房：浏览器打开默认域名，昵称「阿比盖尔」建房 → 房码 `RJJDTJ`（页面显示「在座 1/12 · 你是房主 · 已准备」），页面保持打开。
- 重启当前 active 部署 `5bc7089f-…`（`deploymentRestart`，面板等价点击：部署卡片 `⋮` → `Restart`）→ `{"data":{"deploymentRestart":true}}`。
- 约 5 秒后那个旧房码页面自行回到落地页，房码错误位置显示「**房间已失效，请重新开房。**」，下方出现「重新开房」按钮，昵称仍在输入框里、没有停在"重连中"、也没有报「无法连接服务器」。
- 点「重新开房」→ 直接开新房，房码 `5Y4E99`，同一昵称在座 1/12、房主、已准备 —— 终态确实是可结束的结束，不是死页。
- 后端侧同一条因果链：重启后 `/api/rooms/RJJDTJ` 返回 404（房间随进程消失），再 join 得到 `{"type":"error","message":"房间不存在或已结束","reason":"room-not-found"}`。

**证据位 E4（发布 `e720751`：两条产品线合并后的首次上线）· 已回填 2026-11-06**：
- 发布对象 `main` @ `e720751`（`spec-7` 发牌确认/挂起揭示线与座位级个人资料线合并后的提交）。
- 调用 `serviceInstanceDeployV2(commitSha: "e7207512e9426a0034f76660d9bff1eaeeea2d73", environmentId: "2dcec8b2-89bb-4258-a198-46f12a54f21a", serviceId: "bb45b318-2ee6-4448-9063-fd6f36e8d47c")`（面板会话直调 GraphQL）→ 返回部署 `e68d9de2-66da-48a2-914d-aedbf7b5c3b4`；`createdAt 2026-11-06T05:31:11.591Z`、`updatedAt 05:31:42.831Z`（构建 31 秒）后为 `SUCCESS`；`meta.commitHash e7207512e942…`、`imageDigest sha256:5fb1ac6d…`、`builder DOCKERFILE`、`healthcheckPath /health`、`numReplicas 1`、`asia-southeast1-eqsg3a` 全部与「现状」表一致。
- 版本探针（发布前 → 发布后）：`/deal-view.js` 404 → **200 / 1971 bytes**、`/reveal-view.js` 404 → **200 / 2117 bytes**、`/table-view.js` 404 → **200 / 1985 bytes**、`/profile-store.js` 404 → **200 / 4844 bytes**、`/avatar-normalize.js` 404 → **200 / 3356 bytes**、`/sw.js` `salem-v2` → **`salem-v6`**（2211 bytes）；首页 8581 → **11269 bytes**，`reopenBtn` 仍在。前五条 404 一起证明这次之前线上确实没有这两条产品线。
- 验证：`/health` 返回 `{"ok":true,"rooms":0,"uptime":314.19}`；`deploy-smoke.mjs` **9/9 通过**（建房 `2Q5DWF`、`wss://` 握手 101）。
- 真浏览器实拍（390×844，`docs/acceptance/shots/live-deal-e720751.png`、`live-dawn-e720751.png`）：落地页填昵称 → 建房 `EKSX2Q` → 加 3 个机器人（4/12）→ 开始游戏；「发牌确认」面板渲染出标题「选择你的角色（选定后不可更改）」、两张候选（`data-role="william-phipps"` / `mary-warren`）、「已看 0 / 5」五张待翻身份卡与三个机器人的「已确认」，17 秒倒计时在走；选威廉·菲普斯 →「进入黎明」通过，黎明屏出现「你是女巫：选择把黑猫放到谁面前」。
- 发布前线上只有一间 `phase: over`、房主已断开（`connected: false`）的废房 `PQ6PBY`，这次发布没有打断进行中的对局。

**证据位 E5（发布 `49057d3`：角色卡浮层与开局锁资料）· 已回填 2026-11-06**：
- 发布对象 `main` @ `49057d3`（`feat(web): 角色卡浮层显示技能效果，开局后锁定个人资料`）。
- 调用 `serviceInstanceDeployV2(commitSha: "49057d33cfe567be67b91932380220acc59f67b8", …)` → 部署 `97f2772a-6ac0-4219-9eae-1068c658ccc4`；`createdAt 2026-11-06T05:56:39.992Z`、`updatedAt 05:57:10.501Z`（构建 31 秒）后 `SUCCESS`。
- 版本探针（发布前 → 发布后）：`/sw.js` `salem-v6` → **`salem-v7`**；首页 11269 → **12895 bytes**，新增 `id="roleModal"`、`id="roleImage"`、`id="roleText"`，且 `#selfPanel` 的 title 从「编辑个人资料」改成「查看你的角色卡」；`/app.js` 74510 bytes，含 `function openRoleInfo`、`function selfAbilityLine` 与锁定文案「对局进行中不能改昵称与头像」。
- 验证：`/health` 返回 `{"ok":true,"rooms":0,"uptime":88.89}`；`deploy-smoke.mjs` **9/9 通过**（建房 `Q9G2U2`、`wss://` 握手 101）；角色卡牌面 `assets/cards/zh/{mary-warren,thomas-danforth,abigail-williams,cotton-mather,john-proctor}.png` 五个全 200（471–492 KB），说明浮层图片路径在线上可达。
- 本地真浏览器实拍（390×844，房间 `3755DV`，`docs/acceptance/shots/live-role-info-self.png`、`live-role-info-role.png`）：自己面板在「玛丽·沃伦 · 指控 2 点」下方多出技能行「免疫情侣与黑猫的负面效果。」；点自己面板空白处弹出「你的角色卡 / 玛丽·沃伦 / 技能 / 你 · 存活 · 指控 2 点 · 身份卡 已揭示 0 / 5」并带牌面；点对手座位弹出「机器人1 的角色卡 / 托马斯·丹福斯 / 第 6（或 7）点指控时可翻对方一张身份卡。」；点自己身份卡只开卡详情，`#roleModal` 与 `#profileModal` 都不开——两弹窗互相抢的问题消失。

**证据位 E6（发布 `33b9e5e`：建房可开线下模式）· 已回填 2026-11-06**：
- 发布对象 `main` @ `33b9e5e`（`feat: 建房可开「线下模式」，全程不设倒计时`）。
- 调用 `serviceInstanceDeployV2(commitSha: "33b9e5e487309bc1883a5bc0a8ba4a46281593b0", …)` → 部署 `4e2cfb93-11a5-4e9a-989b-123fe8411a41`。
- 版本探针（发布前 → 发布后）：`/sw.js` `salem-v7` → **`salem-v8`**（2550 bytes）；首页 12895 → **12268 bytes**，含 `id="offlineMode"`（文案「线下模式面对面打牌，不设任何倒计时」）与 `id="offlineBadge"`；`/app.js` 75234 bytes，含「 · 不限时」与从 `S.room` 读 offline 的写法；`/deal-view.js`、`/reveal-view.js`、`/table-view.js`、`/profile-store.js`、`/avatar-normalize.js`、`/reconnect.js` 六个仍全 200。
- 验证：`/health` 返回 `{"ok":true,"rooms":0,"uptime":13.97}`；`deploy-smoke.mjs` **9/9 通过**（建房 `KJYBRS`、`wss://` 握手 101）。
- 线上真浏览器实拍（390×844，`docs/acceptance/shots/live-offline-landing.png`、`live-offline-lobby.png`、`live-offline-turn.png`）：落地页勾上「线下模式」→ 建房 `9X64RB`（`room.offline === true`）→ 大厅出现「线下模式 · 全程不限时」→ 加 3 个机器人开局 → 发牌屏「发牌 · 不限时」、`#dealTimer` 写「不限时」→ 选角色并确认后进白天，回合徽标「轮到 你 · 不限时」，`#dawnTimer` 与 `#nightTimer` 同为「不限时」。
- 本地补充证据（`PORT=8087`，房间 `W2TKSL`）：黎明相位停留 20 秒以上原地不动、`private.dawn.deadline` 缺失；对照的普通房 45 秒兜底照旧；服务端 `offline.mjs` 四段推时钟同样证明线下房不会自己往下走。

**证据位 E7（发布 `644d661`：身份卡双面翻牌 + 翻牌全桌横幅）· 已回填 2026-11-06**：
- 发布对象 `main` @ `644d661`（`fix(web): 翻牌横幅挪到桌面正中空白区，不再压轮次条与座位`）；上一提交 `7f24a3e`（`feat(web): 翻身份卡时全桌弹结果横幅，身份卡改双面 3D 翻牌`）已先发过一次。
- 两次部署：`7f24a3e` → `f2f9eef0-f832-4018-8095-741db227a14a`（`/sw.js` 变 `salem-v9`）；`644d661` → `2540b2aa-5e4d-4bf2-94f1-a99ec3c9e0f1`（`/sw.js` 变 `salem-v10`）。两次都是轮询第 4 次、约 24–32 秒转成功。
- 版本探针：`/sw.js` `salem-v8` → `salem-v9` → **`salem-v10`**；首页 12268 → **13008 bytes**，含 `id="revealBanner"` 与 `id="offlineMode"`；`/app.js` 含 `function announceReveals` 与 `flip-in`；`/styles.css` 含 `preserve-3d` 与 `@keyframes trial-flip`。
- 验证：`/health` 返回 ok；`deploy-smoke.mjs` **9/9 通过**（建房 `5KWGJD`）。
- 线上真浏览器实拍：`docs/acceptance/shots/live-v9-trial-flip.png` 用临时 demo 条证明 3D 生效（`rotateY(0deg)` 显示牌背 / `90deg` 收成一条线 / `180deg` 显示女巫牌面）；`docs/acceptance/shots/live-v10-reveal-banner.png` 是 390×844 上的最终落位——横幅 236×69、`top` 303、`bottom` 372，落在桌面正中 1692 装饰区，与顶栏 `#turnBadge`（16–47）无重叠（脚本判定 `overlap: false`），内容为小牌面 + 「机器人2 翻开了 机器人1 的身份卡」+ 金色「女巫」。
- 这一版之前横幅曾贴 `top: 14px`（`salem-v9`），在 390 宽下会盖住「轮到谁 · 剩余秒数」，因此有了 `644d661` 这次纯样式修正；代价是 sw 壳必须再升一版，否则离线壳仍发旧 `styles.css`。
- 验证时踩到的坑：`getComputedStyle` 在刚加 class 的同一帧读到的是 transition 起点（identity matrix），要验终态得用静止带 class 的元素或 `transition: none`；ego 浏览器进程长时间运行后会僵死（`PageNavigationTimeoutError` / `PageEvaluationTimeoutError`），要 `Get-Process -Name ego | Stop-Process -Force` 杀光全部 ego 进程让它自动重启。

**证据位 E8（发布 `9c5ab94`：不再显示曾为女巫）· 已回填 2026-11-06**：
- 发布对象 `main` @ `9c5ab94`（`feat(web): 不再显示某人是否曾为女巫`）；调用 `serviceInstanceDeployV2` → 部署 `136e2e77-971c-425d-b443-3502be07498d`，轮询第 5 次约 36 秒转成功。
- 版本探针：`/sw.js` `salem-v10` → **`salem-v11`**；`/app.js` 71052 bytes，**不含**「曾为女巫」、**不含** `everWitch`；`/styles.css` **不含** `.over-role.witch`。
- 验证：`/health` 返回 `{"ok":true,"rooms":0,"uptime":14.76}`；`deploy-smoke.mjs` 全部通过。
- 依据：`docs/research/salem-1692-card-and-rules-facts.md:301` 记「第二版死亡时公开；第 15 版不公开；服务器始终知道」，本仓库按第 15 版，故只在展示层撤掉，服务端与规则层照旧用该字段判定阵营、黑猫与黎明投票。

**证据位 E9（发布 `9ff599f`：挂起揭示抽屉线收口）· 已回填 2026-11-08**：
- 发布对象 `main` @ `9ff599fe16bbcb66fcf8cf17d38c9a1dbbbf4bf7`（#63 抽共享抽屉壳、#65 三起因接入、#68 投影补数字、#69 代翻收尾、#64 验收与真实对局实拍之后的提交）；Auto Deploy 仍关闭，走面板会话直调 `serviceInstanceDeployV2`。
- 调用 `serviceInstanceDeployV2(environmentId: "2dcec8b2-89bb-4258-a198-46f12a54f21a", serviceId: "bb45b318-2ee6-4448-9063-fd6f36e8d47c", commitSha: "9ff599fe16bbcb66fcf8cf17d38c9a1dbbbf4bf7")` → 部署 `59b1e5d3-5ba7-4e4e-8047-280242452ca9`；`BUILDING @13:56:27Z` → `SUCCESS @13:56:34Z`（构建缓存命中，约 7 秒）。
- 版本探针（发布前 → 发布后）：`/sw.js` `salem-v20` → **`salem-v25`**；首页 13.0 KB 级 → **16486 bytes**；`/reveal-view.js` 200（7638 bytes，旧版 2117 bytes）、`/drawer-shell.js` 200（4038 bytes）、`/conspiracy-view.js` 200（4975 bytes）、`/app.js` 200（103809 bytes）；`/reveal-drawer.js` 404 是正常的——抽屉壳文件叫 `drawer-shell.js`，`app.js` 以模块方式 import，页面里不会出现额外 `<script src>`。
- 验证：`/health` 返回 `{"ok":true,"rooms":0,"uptime":10.21}`；`deploy-smoke.mjs` **9/9 通过**（建房 `29CKBT`、`wss://` 握手 101、不存在房码 404）。
- 真浏览器（390×844，线上）：落地页 → 建房 `MPSD64`（在座 1/12、房主、已准备，开局配置面板「女巫数 1 / 每人身份卡 5」正常）；同页 DOM 探针 `#revealDrawer` 1 个、`#revealVeil` 1 个（class `reveal-veil`）、顶部旧 `#revealBar` **0 个**、抽屉 `hidden: true`——顶栏已被抽屉取代、压暗层已随壳上线。
- 说明：本条证据的文档提交发生在部署之后，纯文档改动、不会再触发部署；线上镜像对应 `9ff599f`，与本文其余证据的「构建 commit」一致。

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
| 手动发布一次，公网首页与开房可用 | 已通过 2026-11-06 | 证据位 E1：部署 `5bc7089f-…` / commit `3c751ae` / 冒烟 9/9 / 三个版本探针确认线上是新前端 |
| 回滚到上一次部署后旧版仍可用 | 已通过 2026-11-06 | 证据位 E2：回滚部署 `c0cbd48c-…` / commit `4686b6d` / 冒烟 9/9 / 探针翻回旧值；验完已发回 `cd594cc1-…` |
| 线上重启后旧房码页面出现「房间已失效，请重新开房」 | 已通过 2026-11-06（线上，非仅本机） | 证据位 E3：房码 `RJJDTJ` 重启后 5 秒转终态、点「重新开房」开出 `5Y4E99`；后端 `/api/rooms/RJJDTJ` → 404；`apps/web/test/reconnect.test.js` 14 条 |
| 文档的一次性配置项与面板实际值逐项一致 | 已对齐 | 「现状」表逐行，含项目/服务/环境 id、构建器与 Dockerfile 路径、副本、区域、健康检查、变量、域名 targetPort、Auto Deploy；另修正「Deployments 页有 Deploy 按钮」这一处与面板不符的描述 |
| README 有一句指向运维文档 | 已加 | `README.md` 文档段 |
| 冒烟脚本对公网跑通 | 已通过 | 2026-11-06 共跑 4 次（发布后、回滚后、复位后）：每次 9 项全 ok |
| 发牌确认线与座位资料线已上线 | 已通过 2026-11-06 | 证据位 E4：部署 `e68d9de2-…` / commit `e720751` / 五个前端模块从 404 变 200、`/sw.js` 变 `salem-v6`、冒烟 9/9、真浏览器发牌屏出角色候选 |
| 角色卡浮层与开局锁资料已上线 | 已通过 2026-11-06 | 证据位 E5：部署 `97f2772a-…` / commit `49057d3` / `/sw.js` 变 `salem-v7`、首页含 `id="roleModal"`、五个角色牌面 200、冒烟 9/9、真浏览器技能行与三种点击实测 |
| 线下模式已上线（建房勾选后全程无倒计时） | 已通过 2026-11-06 | 证据位 E6：部署 `4e2cfb93-…` / commit `33b9e5e` / `/sw.js` 变 `salem-v8`、首页含 `id="offlineMode"`、冒烟 9/9、真浏览器从建房到白天全程「不限时」 |
| 身份卡双面翻牌与翻牌全桌横幅已上线 | 已通过 2026-11-06 | 证据位 E7：部署 `2540b2aa-…` / commit `644d661` / `/sw.js` 变 `salem-v10`、首页含 `id="revealBanner"`、冒烟 9/9、真浏览器验证 3D 三态与横幅落在桌面正中且不压顶栏 |
| 界面不再显示曾为女巫 | 已通过 2026-11-06 | 证据位 E8：部署 `136e2e77-…` / commit `9c5ab94` / `/sw.js` 变 `salem-v11`、线上 `/app.js` 与 `/styles.css` 均查不到该字段与对应样式、冒烟通过 |
| 挂起揭示抽屉线已上线（指控/嫁祸/诅咒共用底部抽屉） | 已通过 2026-11-08 | 证据位 E9：部署 `59b1e5d3-…` / commit `9ff599f` / `/sw.js` 变 `salem-v25`、`/drawer-shell.js` 与 `/reveal-view.js` 200、线上 DOM 有 `#revealDrawer`/`#revealVeil` 且无旧 `#revealBar`、冒烟 9/9、浏览器建房 `MPSD64` |

公网冒烟实测输出（2026-11-06，发布 `3c751ae` 之后立刻跑，`/health` 报 `uptime` 约 19 秒，与发布时刻对齐）：

```text
ok   GET /health 2xx  status 200
ok   /health 返回 ok 与房间数  {"ok":true,"rooms":0,"uptime":18.98}
ok   GET / 返回页面  status 200, 8581 bytes
ok   GET /api/rooms 可解析  status 200
ok   WS 握手成功  wss://salem-online-production.up.railway.app/ws
ok   建房拿到房码  598TNQ
ok   按房码查房  status 200
ok   房间出现在列表里
ok   不存在的房码返回 404  status 404

冒烟通过  (https://salem-online-production.up.railway.app)
```

同一脚本随后在回滚版（`4686b6d`）与复位版（`3c751ae`）上各跑一次，同样 9 项 ok，只是首页 `indexHtml.length` 随版本在 8507（旧）与 8581（新）之间变——两侧数值对不上是正常的，那只是字符串长度，不是错误。

本机同一脚本（`PORT=8137`，全新进程 `uptime` 2.1 秒）同样 9 项全 ok；另外本机 `apps/server/test/smoke.mjs` 也过：建房 → 4 人准备 → 开局 → 黎明 → 抽牌全通，无报错。

只有 1 个副本在跑这一条由「现状」表的 `numReplicas: 1` 与 `multiRegionConfig` 共同保证；冒烟脚本查不出副本数，判据只能看面板。
