# 探索地图 #70 验收记录：前端缺陷清零与核心 UX 打磨

- 验收日期：2026-11-12
- 地图与子票：#70（子票 #76 / #72 / #74 / #73 / #75 / #71）
- 被验提交：`8a9703d`（#76 纯函数）、`f38ad2d`（#72 服务端协议与中文拒单）、`cd83138`（#74 样式与降级修复）、`979ff79`（#73 接线一）、`59f5d84`（#75 接线二，`sw.js` `salem-v26`）
- 验收环境：本地 `PORT=8890 node apps/server/src/server.mjs` + Chromium 390×844 竖屏视口

---

## 一、验收范围

### 1. 五项前端缺陷清零
1. **玛莎·科里（Martha Corey）复制能力可达**：按座位号递减方向复制右邻第一个存活非玛莎角色（塞缪尔·帕里斯 / 蒂图巴 / 威尔·格里格斯 / 阿比盖尔·威廉姆斯），开放对应主动/被动技能按钮，并在自身面板与角色弹窗显示 `（复制：XXX）`。
2. **自身面板（`#selfPanel`）状态与揭示目标高亮补齐**：渲染 `miniCards(my)` 展示自己面前的黑猫、信徒、避难、情侣与拘留；当自己是被揭示目标时为 `#selfPanel` 点亮 `.reveal-target` 金边。
3. **动效降级选择器修复**：`apps/web/styles.css` 中传染阶段与挂起揭示压暗层补齐 `[data-motion="reduced|off"]` 选择器，与 `document.documentElement.dataset.motion` 严格对齐。
4. **阶段名、死因码、能力名与规则拒单全中文化**：`PHASE_LABELS.conspiracy = "传染"`；死亡横幅与日志将 `witch-revealed`、`all-trials-revealed`、`night-kill`、`saved` 等转为中文标签，能力发动显示角色中文名，服务端与客户端拒单提示全部中文化（同时保留 `error.reason` 机器码）。
5. **出牌与目标座位预校验**：本回合已行动或场上无合法目标时禁用「打出」按钮；选目标时仅高亮合法座位（过滤「信徒」免红卡、无蓝卡打「诅咒」、重复「情侣」、无红卡打普通「辩护」），双目标牌已选来源标注 `.source-picked` 蓝框，点击非法座位给出具体中文原因提示。

### 2. 三项核心 UX 升级
1. **390px 顶栏保留牌堆/弃牌计数 + 全桌可见回合倒计时**：移除 `max-width: 430px` 下的 `.pile-stats { display: none; }`；服务端 `publicRoom` 公开 `turnDeadline`，非当前回合玩家也能在 `#turnBadge` 看到 `轮到 X · Ns`（最后 10 秒脉冲与音效仅对当前行动者本人触发）。
2. **终局「返回房间大厅」原房再来一局**：`#overOverlay` 提供主按钮 `#backLobby`「返回房间大厅」（发送 `{ type: "return-lobby" }` 重置回原房 `lobby` 相位，保留座位/昵称/头像/令牌）与次按钮 `#leaveOverBtn`「离开房间」。
3. **局内快捷语芯片 + 对局信息未读角标 + 弹窗 `Escape` 统一收口**：`#chatBar` 旁提供 6 条高频快捷语芯片一键发送；`#logDrawer` 关闭时收到新聊天在 `#logBtn` 显示 `.has-unread` 红点，点开即清除；`Escape` 统一关闭 `profileModal`、`roleModal`、`cardModal`、`powerOverlay`、`logDrawer` 与 `quickChat`。

---

## 二、测试套件回归结果

| 套件 | 命令 | 结果 |
| --- | --- | --- |
| `packages/rules` | `node --test --test-isolation=none packages/rules/test/*.test.ts` | **70 / 70 通过**（含 48 seed soak 牌张守恒与零泄漏） |
| `apps/web` | `node --test --test-isolation=none apps/web/test/*.test.*` | **215 / 215 通过**（含新增纯函数、样式与接线单测） |
| `apps/server` | 10 个端到端脚本（`smoke` / `lifecycle` / `profile` / `bots_add` / `deal` / `reveal` / `offline` / `conspiracy` / `resync` / `fullgame_bots`） | **10 / 10 通过**（12 人整局 `conspiracy=12/12`、`return-lobby` 验证通过、`unexpected errors=0`） |

---

## 三、390×844 浏览器实拍与截面量测

### 1. 顶栏几何与整页滚动检查（390×844）

| 指标 | 实测值 | 结论 |
| --- | --- | --- |
| 视口与文档尺寸 | `innerWidth=390, innerHeight=844, scrollWidth=390, scrollHeight=844` | 整页零横向/纵向溢出 |
| `.game-top` | `width=390, height=47` | 单行顶栏 |
| `#turnBadge` | `left=10, right=93, width=83`（`轮到 你 · 16s` / 等待态 `轮到 机器人1 · 72s`） | 全员可见倒计时 |
| `.pile-stats` | `display=flex, left=180, right=254, width=74`（`牌堆 6 弃牌 11`） | 390px 下清晰可见且不碰撞 |
| `.top-actions` | `left=258, right=378, width=120`（`✦` + `对局信息` 含未读红点） | 与 `.pile-stats` 间距充足 |

### 2. 动效三档（`[data-motion]`）计算样式实测

| 档位 | `documentElement.dataset.motion` | `#conspiracyVeil` `transition-duration` | `#revealVeil` `transition-duration` | `#conspiracySwap` `display` |
| --- | --- | --- | --- | --- |
| `full` | `"full"` | `0.26s` | `0.26s` | `block` |
| `reduced` | `"reduced"` | `0.18s` | `0.18s` | `block` |
| `off` | `"off"` | `0s` | `0s` | `none` |

### 3. 功能与交互探针实测

| 检查项 | 实测输出 |
| --- | --- |
| 玛莎·科里复制右邻（塞缪尔·帕里斯） | `#selfPanel .self-role` = `"玛莎·科里（复制：塞缪尔·帕里斯） · 指控 3 点"`；`#actionBar` 出现 `"萨缪尔：从弃牌堆拿牌"` |
| 自身面板蓝/绿卡与揭示金边 | `#selfPanel .mini-cards` = `["黑猫", "信徒", "拘留"]`；自己作为揭示目标时 `#selfPanel.classList.contains("reveal-target") === true` |
| 传染阶段中文标签 | `#phaseText` = `"传染"`，`#turnBadge` = `"传染"` |
| 红卡目标过滤与信徒拦截 | 座位 1 有「信徒」时 `.selectable === false`，座位 2、3 `.selectable === true`；点击座位 1 弹出 `"目标面前有「信徒」，不能对其打出红卡"` |
| 双目标牌（「抢劫」）来源与目标区分 | 选座位 1 为来源后，座位 1 `.source-picked === true, .selectable === false`，座位 2、3 `.selectable === true` |
| 事件日志中文死因与能力名 | `["玛莎玩家 使用能力：塞缪尔·帕里斯。", "机器人2 死亡（女巫身份暴露）。", "夜晚结束：机器人3 被救下（平安获救）。"]` |
| 快捷语与未读红点、`Escape` 关闭 | 收到聊天后 `#logBtn.has-unread === true`，点开抽屉后清零，`Escape` 关闭抽屉；点「快捷」展开 6 条芯片，点击芯片立即发送并自动收起 |
| 终局「返回房间大厅」原房重开 | 点击 `#backLobby` 发送 `return-lobby`，房间 `MGZ8WW` 直接回到 `lobby` 相位，4 个座位全部保留，房主「开始游戏」立即可点 |

### 4. 归档实拍截图

- [`docs/acceptance/shots/ux70-table-martha-quickchat.png`](shots/ux70-table-martha-quickchat.png)：390×844 牌桌实拍（顶栏倒计时 + 牌堆/弃牌计数 + 对局信息未读红点 + 双目标牌「来源 机器人1」蓝框与目标金框 + 玛莎·科里复制塞缪尔提示与操作按钮 + 自身面板「黑猫/信徒/拘留」标记 + 底部快捷语芯片栏）。
- [`docs/acceptance/shots/ux70-gameover-return-lobby.png`](shots/ux70-gameover-return-lobby.png)：390×844 终局遮罩实拍（「返回房间大厅」与「离开房间」双按钮）。
- [`docs/acceptance/shots/ux70-returned-lobby.png`](shots/ux70-returned-lobby.png)：点击「返回房间大厅」后原房（`MGZ8WW`）回到大厅相位、4 名成员全部保留且可立即开下一局。
