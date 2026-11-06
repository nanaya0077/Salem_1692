# 规格 #7 验收记录：开局发牌确认与由达成者选择揭示身份卡

- 验收日期：2026-11-06
- 被验对象：集成分支 `spec-7-int`（实施票 #8–#14 全部合并后的状态）
- 验收环境：本地 `node apps/server/src/server.mjs` + Chromium（ego-browser），视口 390×844 @2x（手机竖屏），
  服务端与页面均按 12 人局上限的布局约束检查。

## 一、验收范围

规格 #7 的八张实施票全部落地后，这条链路端到端可用：

1. 大厅「准备 → 开局」后进入**发牌相位**，每人先选角色（4–7 人二选一，8 人以上直接定角）。
2. 身份卡逐张翻开确认，**全员确认或 20 秒到点**才进入黎明；确认前抽牌/出牌/结束回合一律被拒。
3. 开局座位重编号、踢人、掉线时，座位号与头像表**原子重发**，不再出现身份错位（票 #16 的回归）。
4. 红卡达到门槛后**挂起**：由打出达到门槛那张牌的玩家选择翻开目标哪一张身份卡；只有丹福斯对普通玩家的第 6 点可以放弃。
5. 挂起期抽牌/出牌/结束回合被拒；超时、托管、机器人当选择者时按规则包 `defaultRevealIndex` 取第一张兜底，事件带 `auto`。
6. 零泄漏：非选择者只能看到 `{ chooserId, targetId }`，未揭示身份卡的类型与数量都不出现在他人投影里。

## 二、怎么验的

- 机跑：`npm --prefix packages/rules test`（52）、`npm --prefix apps/web test`（55）、`npm --prefix apps/server test`（8 个端到端脚本）。
- 人验（浏览器实拍 + 截面测量，脚本留在 `C:/Users/49934/ego/salem-15/`）：
  - `accept-4.mjs` / `accept-9-12.mjs`：4 / 9 / 12 人局发牌屏。
  - `accept-reconnect.mjs`：两真人 + 两机器人，一人重连（已确认 / 未确认各一次）。
  - `accept-reveal.mjs`：两真人 + 两机器人，脚本自动打红卡凑门槛，一局手动选位置、一局等超时。

## 三、结果

### 发牌屏（390×844）

| 人数 | 角色 | 候选 | 自己身份卡 | 牌堆 | 座位行 | 面板 |
| --- | --- | --- | --- | --- | --- | --- |
| 4 | 阿比盖尔·威廉姆斯 / 玛丽·沃伦 二选一 | 2 张，选定后显示「…已选定」 | 5 张 | 46 | 3 行 | 面板 774px（`92dvh` 上限），内容 880px，面板内滚动 |
| 9 | 托马斯·丹福斯（无候选，8 人以上直接定角） | 无 | 4 张 | 31 | 8 行 | 内容 1178px，滚到底后确认按钮 740–787px 在视口内可点 |
| 12 | 约翰·普罗克特（直接定角） | 无 | 3 张 | 22 | 11 行 | 内容 1328px，滚到底后确认按钮可点 |

- 卡片条：4 人局 `scrollWidth 426 / clientWidth 316`（横向卡片条，露出 3 张 78px 卡）；12 人局无横向溢出。
- 页面本身不滚：`document.documentElement.scrollHeight === window.innerHeight === 844`；
  溢出全部发生在 `.deal-panel` 内部（CSS 已是 `max-height: 92dvh; overflow-y: auto`）。
- 逐张翻牌：`已看 0 / 5` → 点开 5 张 → `已看 5 / 5`，确认按钮从 disabled 变为可点，点后文案变「已确认」并进入黎明。
- 聊天条在发牌相位不再隐藏：`#chatBar` 高 59px（785–844），被整屏 `#dealOverlay`（0–844）盖住，
  页面不出现第二层滚动（`document.documentElement.scrollHeight === 844`、`bodyOverflowX 0`）。
- 截图：`shots/a-4p-deal-roles.png`、`shots/d-9p-deal.png`、`shots/g-12p-deal.png`、`shots/p-deal-chat-390.png`。

### 断线重连（发牌相位）

| 角色 | 重连后相位 | 开牌屏 | 已看计数 | 确认按钮 | 回到的对局状态 |
| --- | --- | --- | --- | --- | --- |
| 已确认的一方 | deal | 仍打开 | — | 「已确认」，disabled | `private.acknowledged true`、`deal.acked [0,1,2]` |
| 未确认的一方 | deal | 仍打开 | 已看 0 / 5 | disabled，提示「先在下面选一个角色，选定后不可更改。」 | `acknowledged false`，重新选角后可继续翻牌确认 |

两侧都确认后相位进 action，开牌屏关闭，日志尾部为 `roleChosen / blackCatPlaced / gameStarted / turnStarted`。
截图：`shots/i-reconnect-unacked.png`。

### 挂起式揭示（390×844，两真人 + 两机器人）

- 选择者：位置条 5 个位置（`#1..#5`），全部可点；`stripOverflowX 0`、`document.documentElement.scrollHeight === 844`、
  `bodyOverflowX 0`；位置条位于视口 61–204px。选择者投影里的 `pendingReveal` 是
  `{ chooserId, targetId, slots: 全 hidden, canDecline: false }`。
- 非选择者：显示「等待 乙 选择揭示位置 / 选好位置后目标那张会立刻翻开；这期间抽牌、出牌与结束回合都不可用。」，
  抽牌、出牌、结束回合按钮全部禁用；这条公开信号是消息顶层的 `revealWait: { chooserId, targetId }`。
- 手动选位置：点击位置后位置条消失，日志尾依次为「乙 打出 「指控」 → 机器人1 / 机器人1 面前 +1 点（指控），共 7 点 /
  机器人1 由 乙 选择翻开了一张身份卡（平民）/ 机器人1 弃掉 7 张指控」。
- 超时兜底：不点任何位置，回合计时到期后自动翻第一张，事件带 `auto: true`，日志句尾为
  「（超时或托管，自动取了第一个位置。）」——事件字段与界面文案一致。
- 截图：`shots/k-reveal-chooser-390.png`、`shots/l-reveal-waiting-390.png`、`shots/n-reveal-auto-390.png`。

### 零泄漏（`apps/server/test/reveal.mjs`）

- 非选择者的 `revealWait` 键正好是 `chooserId`、`targetId`。
- 非选择者的消息 JSON 里不出现 `pendingReveal` / `trialIndex` / `trialId`。
- 未揭示身份卡的 `kind === null`、`id` 以 `hidden-` 开头（自己的座位除外）。
- 角色候选 `roleOptions` 对所有人可见：规格 Implementation Decision 15 明确「候选一律公开」。

## 四、已知偏差（规格里已登记）

1. **传染（Conspiracy）与自首（Confess）仍直接翻第一张**，不经过挂起，因此也不带 `auto`。
2. **4–7 人二选一固定启用**，没有开关；8 人以上直接定角。
3. **放弃只对丹福斯 + 普通玩家的正好 6 点开放**，其他角色与门槛没有放弃权。
4. 客户端不保留「翻到第几张」的本地进度：未确认者重连后要从 `已看 0 / N` 重新点，服务端不记录已看位置。

## 五、怎么复跑

```bash
npm --prefix packages/rules test
npm --prefix apps/web test
npm --prefix apps/server test      # 自己起停服务、错开 8190/8191 端口，跑 8 个端到端脚本
```

服务端脚本也可以单独跑，但必须自己先起服务，并把 `PORT` 与 `BASE` 设成同一个端口：

```bash
PORT=8190 SALEM_FAKE_CLOCK=1 DAWN_MS=4000 node apps/server/src/server.mjs &
PORT=8190 SALEM_FAKE_CLOCK=1 DAWN_MS=4000 BASE=http://127.0.0.1:8190 node apps/server/test/reveal.mjs
```

`SALEM_FAKE_CLOCK=1` 是 `{ type: "clock", advance }` 与 20 秒发牌兜底的测试钩子；不开它就只能等真实时间。
