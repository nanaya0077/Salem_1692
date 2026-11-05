# 女巫镇 · Salem 1692 在线版

4–12 人实时在线桌游，移动浏览器竖屏优先。规则基线是中文旧版（[andyventure 对照页](https://andyventure.com/boardgame-salem-1692/)），服务端权威、按玩家投影，客户端拿不到牌堆、他人手牌与未揭示身份卡。

## 快速开始

要求 Node 24+（直接运行 `.ts` 规则引擎与 `.mjs` 服务端）。

```bash
npm install --prefix apps/server
node apps/server/src/server.mjs
```

打开 http://127.0.0.1:8080 ，输入昵称创建房间，把 6 位房码发给朋友；4–12 人全部准备后房主开局。

常用环境变量：

| 变量 | 默认 | 说明 |
| --- | --- | --- |
| `PORT` | `8080` | HTTP 与 WebSocket 端口 |
| `TURN_MS` | `90000` | 白天回合计时 |
| `NIGHT_MS` | `30000` | 夜晚计时 |
| `DAWN_MS` | `45000` | 黎明计时 |
| `GRACE_MS` | `60000` | 掉线托管宽限 |

短计时联调：

```bash
PORT=8101 TURN_MS=8000 NIGHT_MS=10000 DAWN_MS=10000 node apps/server/src/server.mjs
CODE=房码 BOTS=3 BASE=http://127.0.0.1:8101 node apps/server/test/bots.mjs
```

## 已实现

- **规则引擎** `packages/rules`：15 张基础卡、15 个角色、3 种身份；红卡 7 点门槛（乔治 8、托马斯 6/对乔治 7）、蓝卡常驻、绿牌弃置、黑牌立即结算；夜晚杀/木槌/自首/庇护；传染换牌、情侣连锁、拘留跳回合、诅咒弃蓝卡、嫁祸整组转移、抢劫换手；贾尔斯补抽、阿比盖尔弃红卡、科顿证据 1 点、威尔辩护当目击、莎拉·古德免疫、玛丽连锁免疫、威廉暗自首、塞缪尔取牌、蒂图巴重排、玛莎复制右邻。
- **开局配置**：人数 4–12、女巫数、每人身份卡数可配；官方总数 20/25/30/35/32/35/30/33/36，9 人 35 张按前 8 人 4 张、末位 3 张发。
- **服务端** `apps/server`：Node HTTP + `ws`；房间码、准备、开局、踢人、房主转移、断线重连、掉线托管、回合计时；房主可在大厅一键加机器人（自动准备、自动黎明/夜晚投票，轮到时优先打合法红卡、否则抽两张结束），方便单人测试；服务端权威状态，按座位投影。
- **客户端** `apps/web`：原生 HTML/CSS/ES Module，无构建步骤；创建/加入、大厅配置、竖屏牌桌、手牌详情、选目标/来源、夜晚与黎明全屏面板、终局揭示、事件日志、房内聊天、PWA 安装。
- **素材**：`assets/cards/cards.zh.json` 为卡牌文字与图片映射；`assets/cards/zh/` 为 33 张中文卡面 PNG（普通与 @1125 打印版）；卡面文字由 DOM 渲染，不烧进图片。
- **原型**：`prototype/table.html` 是 12 人环形牌桌交互原型，保留用于对照。

## 测试

```bash
cd packages/rules && node --test test/*.test.ts
cd packages/rules && SOAK_SEEDS=300 node --test test/soak.test.ts
node --check apps/web/app.js
node apps/server/test/smoke.mjs
node apps/server/test/lifecycle.mjs
node apps/server/test/profile.mjs
cd apps/web && npm test
node scripts/verify-avatars.mjs
BASE=http://127.0.0.1:8080 node apps/server/test/bots_add.mjs
BASE=http://127.0.0.1:8080 GAMES=3 node apps/server/test/fullgame_bots.mjs
```

当前规则测试 32 条全过，含 12 人 48 seed 随机对局 soak（牌张守恒、投影零泄漏、能到终局；可用 `SOAK_SEEDS=300` 扩压）；`smoke.mjs` 会自建 4 人房走完创建、加入、准备、开局、黎明、抽牌；`lifecycle.mjs` 覆盖大厅踢人、对局中断线 token 重连、房主转移；`bots_add.mjs` 验证房主加 3 个机器人后可开局、机器人自动过回合；`fullgame_bots.mjs` 用 12 个 WebSocket 客户端自动建房、准备、抽牌/出牌、黎明/夜晚投票直到终局，逐局输出房间、耗时、胜方与错误汇总，`GAMES` 控制局数；`profile.mjs` 走座位级个人资料的协议层（改名双写、头像校验与广播、welcome 全量头像、1 秒硬闸、投影零泄漏）；`apps/web` 下的 `npm test` 是头像归一化与个人资料存储的纯函数单测；`verify-avatars.mjs` 起真浏览器把七处展示面带图跑一遍（需要本机有 Chrome）。

## 目录

```text
packages/rules/   纯 TS 规则引擎与测试
apps/server/      Node HTTP + WebSocket 服务端、冒烟与 bot 脚本
apps/web/         移动端 H5/PWA 客户端
assets/cards/     中文卡牌数据与 PNG
docs/rules/       规则书 PDF、抽取文本、卡面参考
docs/research/    规则与平台研究笔记
docs/wayfinder/   MAP-1 路线图、工单与 SPEC
prototype/        12 人环形牌桌原型与截图
```

## 文档

- 路线图：[docs/wayfinder/salem-online/MAP.md](docs/wayfinder/salem-online/MAP.md)
- 开工规格：[docs/wayfinder/salem-online/SPEC.md](docs/wayfinder/salem-online/SPEC.md)
- 领域词表：[GLOSSARY.md](GLOSSARY.md)
- 规则事实：[docs/research/salem-1692-card-and-rules-facts.md](docs/research/salem-1692-card-and-rules-facts.md)
- 平台事实：[docs/research/salem-online-realtime-platform-facts.md](docs/research/salem-online-realtime-platform-facts.md)

## 尚缺

- 12 人 soak 与 6–8 人 10 局完整验收；低端机帧率与真机 Safari/Chrome 回归。
- 夜晚若干边缘局面（多女巫同时死亡、传染与夜晚同回合）需要更多回归用例。
- 语音仍是外置方案；局内只有文字与快捷语。
- 正式美术、音效、埋点与上线合规未做；卡面插画来自公开素材，正式发布前需重绘或取得授权。
