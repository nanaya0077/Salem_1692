# 挂起揭示抽屉：三起因 × 4/9/12 人 + 降级（验收记录）

票：#64。实现：#63（抽壳）、#65（三起因接入）、#68（起因与两个数字由挂起态自带）。

## 一、验收范围

- 390×844 下 4 / 9 / 12 人的抽屉几何、卡宽、是否溢出。
- 选择者 / 等待者 / 放弃 / 提交后 / 超时自动代翻五态。
- 三种起因（指控 / 诅咒 / 嫁祸）的标题口径。
- reduced-motion 与 motion off。
- 最后 5 秒时钟告警与 note 文案。
- 三包测试与 4/9/12 人整局压测。

## 二、怎么验的

```powershell
# 规则包
cd packages\rules; node --test test/*.test.ts

# web（含 drawer-shell / reveal-drawer / conspiracy-ui 等）
cd apps\web; npm test

# 服务端（10 个脚本，含 4/9/12 人整局）
cd apps\server; $env:PORT_BASE='8630'; node test/run-suite.mjs

# 人数回归（各 1 局）
$env:PLAYERS='4';  node test/fullgame_bots.mjs
$env:PLAYERS='9';  node test/fullgame_bots.mjs
$env:PLAYERS='12'; node test/fullgame_bots.mjs
```

人数回归用 `BASE` 指到同一个服务实例（脚本默认连 8080）：

```powershell
$env:BASE='http://127.0.0.1:8700'
$env:PLAYERS='4';  node test/fullgame_bots.mjs   # 同理 9 / 12
```

真机取证：`cd apps\server; $env:PORT='8700'; node src/server.mjs`，ego（ego-lite）以
`Emulation.setDeviceMetricsOverride { width: 390, height: 844, deviceScaleFactor: 1, mobile: true }`
开页，建房 → 加机器人到指定人数 → 开局 → 发牌确认（4–7 人先选角色，8 人以上没有候选）→
循环「抽牌 / 出指控卡对机器人1 / 结束回合」直到 7 点触发挂起，再读 `#revealDrawer` 的槽位与
`getBoundingClientRect()`。脚本 `C:\Users\49934\ego\salem-reveal-drawer\c64.mjs`。

## 三、结果

### 测试

| 包 | 结果 |
| --- | --- |
| `packages/rules` | 70 / 70 |
| `apps/web` | 208 / 208 |
| `apps/server` | 10 / 10 脚本（12 人整局 `conspiracy=12/12`、`errors=0`） |

人数回归（`fullgame_bots.mjs`，各 1 局，对 8700 实例）：

| 人数 | 结果 | 时长 | 传染 | 泄漏 | 意外错误 |
| --- | --- | --- | --- | --- | --- |
| 4 | `ok`，女巫胜 | 2787ms | 1/1 局，4/4 座位可见 | 0 | 0 |
| 9 | `ok`，女巫胜 | 44338ms | 1/1 局，9/9 座位可见 | 0 | 0 |
| 12 | `ok`，女巫胜 | 6367ms | 1/1 局，12/12 座位可见 | 0 | 0 |

### 抽屉几何（指控，目标机器人1 满 7 点）

| 人数 | 身份卡数 | 卡宽 | 抽屉 top / bottom / 宽 / 高 | 页面滚动 | veil | 目标描边 |
| --- | --- | --- | --- | --- | --- | --- |
| 4 | 5 | 60px | 543 / 832 / 366 / 289 | 无 | `on`，`brightness(0.6) saturate(0.8)` | 座位 1 |
| 9 | 4 | 60px | 543 / 832 / 366 / 289 | 无 | 同上 | 座位 1 |
| 12 | 见「已知偏差」 | — | — | — | — | — |

槽位固定 13 个（`head/kicker/clock/title/sub/body/cards/waiting/waitText/note/foot/decline/submit`）。

### 标题口径（#68 收口为 A 之后）

| 起因 | 标题 | 点数与门槛 |
| --- | --- | --- |
| 指控 | `机器人1 · 指控 7 点（门槛 7）` | 写 |
| 诅咒 | `机器人1 · 诅咒揭示` | 数据里有，不写（避免被读成「还差多少点就能指控」） |
| 嫁祸 | `机器人1 · 嫁祸揭示` | 同上 |

其余槽位：`clock` 读回合剩余（实测「87 秒」，不是另起 20 秒）；`sub`「选择要揭示的身份卡：选中后再点「选定」，选定前可以改。」；
`note`「超时或托管会自动取第一个未揭示位置。」；未选中时 `submit` 文案「选定」且 disabled。

### 降级（静态帧看不出差异，只有计算样式能证明）

| 档位 | veil `transition-duration` | 抽屉进场 | 等待环 |
| --- | --- | --- | --- |
| full | 0.26s | `drawer-in` | `spin` |
| reduced | 0.18s | 无 | 无 |
| off | 0s | 无 | 无 |

### 自动代翻收尾

规则层在 `trialRevealed` 上写 `auto: true` 时，客户端不立刻关抽屉：留 900ms（reduced 700ms），
把 `note` 换成「超时或托管，自动取了第一个位置。」，并把 `#revealDrawer` 设成 `pointer-events:none`
让点击穿透回牌桌；`resetRoomState` 清截止时间与定时器。断言见
`apps/web/test/reveal-drawer.test.js`「自动代翻后抽屉留一会儿把话说清」。

### 截图

- `shots/reveal-drawer-4p-chooser.png`（4 人，5 张卡，桌面压暗，机器人1 金边）
- `shots/reveal-drawer-9p-chooser.png`（9 人，4 张卡）
- `shots/reveal-drawer-4p-reduced.png` / `reveal-drawer-4p-off.png`（同帧三档对照）
- `shots/reveal-drawer-chooser.png` / `reveal-drawer-picked.png` / `reveal-drawer-submitted.png`
  （#65 的四态：未选 / 已选「选定（第 1 张）」/ 已提交等待）

## 四、已知偏差与没能做到的

1. **诅咒与嫁祸没有真机实拍**。两者都要手牌里正好有 `curse` / `scapegoat`，靠对局随机凑不稳；
   覆盖率由 `packages/rules/test/pending-reveal.test.ts`「投影里的起因与门槛：三种起因都给数字」
   与 `apps/web/test/reveal-drawer.test.js`「标题数据恒给、文案按起因分支」承担，两点都有断言。
2. **12 人真实对局未拍到**。8 人以上没有角色候选，脚本已适配；但 11 个机器人的回合轮转使得凑到
   7 点指控要跑十几分钟——本轮试了三次、每次 10 分钟，都没等到挂起（脚本输出 `count 12 attempt N no reveal`）。
   12 人的布局差异只有「3 张卡」这一项，而卡宽由 `flex: 0 0 60px` 固定、抽屉高度不随卡数变化
   （`#67` 原型在同一结构上量到 top 475、3 张卡），另有 `#revealDrawer .conspiracy-card { flex: 0 0 60px }`
   的静态断言兜底；人数侧另有上表 12 人整局 `conspiracy=12/12` 证明阶段与投影都对。
3. **「放弃」按钮**只在「丹福斯把普通玩家压到正好第 6 点」时出现，本轮对局没凑出；显隐由
   `canDecline` 决定，`drawer-shell` 侧有「传染没有『放弃』、挂起揭示有」的槽位断言。
4. **等待者视角**需要两个真人同局，本轮只有 1 真人 + 机器人；`revealWaitModel` 的文案与同形标题
   有单测。
5. 真机 30fps 与触感可感性仍归 #35。
