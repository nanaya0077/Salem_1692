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
| `apps/web` | 209 / 209 |
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

### 补充矩阵（注入法，2026-11-08 晚）

前面几节是「真机凑对局」取证。为了把 12 人、诅咒、嫁祸、放弃、等待者这些随机凑不稳的态补齐，
另跑了一轮**注入矩阵**：真实房间拿投影，再经页面自己的消息通道注入 `pendingReveal` / `revealWait` / 已提交 pick，
逐态量尺寸并截图（脚本 `.tmp-ego/accept64.mjs`，未跟踪）。参数在 #68 收口后补了 `accusationTotal`。

| 状态 | 抽屉 top | 高 | 4 人卡数 | 9 人卡数 | 12 人卡数 | 卡宽 |
| --- | --- | --- | --- | --- | --- | --- |
| 选择者（未选） | 543 | 289 | 5 | 4 | 3 | 60px |
| 已选（真实点击） | 543 | 289 | 5 | 4 | 3 | 60px |
| 已提交 | 593 | 239 | 卡片收起 | 卡片收起 | 卡片收起 | — |
| 等待者 | 593 | 239 | 0 | 0 | 0 | — |
| 可放弃（6 点） | 543 | 289 | 5 | — | — | 60px |
| 时钟告警（剩 4–5 秒） | 543 | 289 | 5 | 4 | 3 | 60px |

- 所有态 `docW 390 / docH 844`、抽屉宽 366 / left 12 / bottom 832，无整页横向溢出；12 人座位行只在自身容器内横滚。
- 三起因标题实测：指控「机器人1 · 指控 7 点（门槛 7）」；诅咒「机器人1 · 诅咒揭示」；嫁祸「机器人1 · 嫁祸揭示」。
- 放弃态（6 点）标题「机器人1 · 指控 7 点（门槛 6）」，脚部同时有「放弃」「选定」。
- 告警：`left=4–5 秒` 时 `#revealClock.warn` 为真，文案「4 秒 / 5 秒」。
- 截图（`docs/acceptance/shots/`）：`{4,9,12}p-{choose,picked,submitted,waiter,warn}.png`、
  `4p-{decline,curse,scapegoat,auto-log,reduced,motion-off,target-ring}.png`，共 22 张。
- 另有真机实拍（非注入）：`reveal-drawer-{4p-chooser,9p-chooser,4p-reduced,4p-off,chooser,picked}.png`
  与 `reveal-drawer-auto-afterglow.png`（#69 复现的收尾态，见第四节第 1 条）。

### 自动代翻收尾的实际可见性（探针，#69 修复后）

`#69` 把 `handle()` 的顺序改成 `announceReveals()` 先于 `render()`：投影到达时先认领那条 `auto:true` 的翻牌并 arm 收尾窗口，
随后 `render()` 走收尾分支，抽屉不关；`note` 换成「超时或托管，自动取了第一个位置。」、`sub` 换成「已自动翻开一张，等待结算。」、
卡片与「放弃」收起、主按钮改「等待结算」且 disabled、整条 `pointer-events:none`。
实测（先注入挂起让抽屉打开，再注入带 `auto:true` 的 `trialRevealed`）：

| 距注入 | drawer.hidden | note | pointerEvents | 剩余收尾窗口 |
| --- | --- | --- | --- | --- |
| 0ms | false | 「超时或托管，自动取了第一个位置。」 | `none` | 900ms |
| 152ms | false | 同上 | `none` | 748ms |
| 459ms | false | 同上 | `none` | 440ms |
| 1064ms | true | 同上（随后随抽屉一起收起） | `''` | 已过期 |

修复前同一探针整段窗口量到 `hidden === true`（`render()` 先关抽屉、`armRevealAfterglow()` 后到，收尾分支又不重开）；
`TURN_MS='20000'` 的真实超时路径当时偶发能量到 `open: true`，即缺陷依赖调用时序。现在顺序固定，两条路径走同一段代码。
截图：`docs/acceptance/shots/4p-auto-afterglow.png`（窗口内整条抽屉在屏、卡片已收、脚注完整）。


### 真实对局补拍（第二批，2026-11-08 晚）

第一批没拍到的 12 人 / 诅咒 / 嫁祸 / 放弃 / 等待者，这一批用**真实房间、真实协议**再拍：
页面自己坐一个座位（`__salem.ws.send` 发 action），其余座位由脚本 WebSocket 客户端驱动
（`Client` 走 create/join/ready/start、发牌选角、黎明与夜晚投票、出牌），全程不注入投影。
驱动脚本是一次性本地脚本（`.tmp-ego/real-run.mjs`，未入库、已随临时目录清理；做法就是页面 + 若干
`Client` 各坐一席，按 `projection` 驱动，可参考 `apps/server/test/reveal.mjs` 复写）；
服务端真实时钟（`TURN_MS/DAWN_MS/NIGHT_MS=600000`），390×844 视口，截图前只把 `#toast` 暂时隐藏。

| 场景 | 座位与视角 | 挂起数据 | 实拍 |
| --- | --- | --- | --- |
| 12 人指控 | 12 人；页面是选择者 | `cause=accusation`，7 点 / 门槛 7，3 张卡 | `shots/12p-real-choose.png` |
| 4 人等待者 | 4 人；选择者是脚本，页面等待 | `cause=accusation`，7 / 7，5 张 | `shots/4p-real-waiter.png` |
| 4 人放弃 | 4 人；页面是丹福斯，正好第 6 点 | `canDecline=true`，6 / 6，5 张 | `shots/4p-real-decline.png` |
| 4 人诅咒 | 4 人；丹福斯是脚本，页面等待 | `cause=curse`，6 / 6 | `shots/4p-real-curse.png` |
| 4 人嫁祸 | 4 人；页面是丹福斯（选择者） | `cause=scapegoat`，6 / 6，5 张（其中 1 张此前已揭示） | `shots/4p-real-scapegoat.png` |

怎么凑出来的：

- **指控**：脚本把目标压到「门槛前一格」（普通目标 7 点门槛压到 6；乔治 8 点压到 7），再由页面那一席补最后一张红卡——谁补最后一张，谁就是选择者。12 人局 3 张卡、7 点门槛，第一把即成。
- **放弃**：丹福斯把普通玩家压到正好第 6 点才满足 `canDeclineReveal`；4 人局页面在两张候选里选丹福斯，重开几次即可命中。
- **诅咒**：非丹福斯的红卡在 6 点不触发（他们的门槛是 7 / 8），所以先把目标堆到 6 点、贴一张 `piety`，再由丹福斯打出 `curse` 并显式 `blueCardId:"piety"`。丹福斯席位由脚本在发牌时优先拾取（4 人局 8 个候选位，七个角色必都出现）。
- **嫁祸**：先把 `target` 堆到 6 点（非丹福斯门槛 7/8，不会触发），再由丹福斯对另一个「0 点第三方」打出 `scapegoat`——规则只看搬运后 `target` 的总数，不要求 `source` 本来有点数；这一条要两张 `scapegoat` 恰好一张在丹福斯手里，本批第 12 次重开才成。

实拍目检：五条都是同一条抽屉（宽 366、贴底、`note` 与「选定」完整；等待态无卡、选择者有卡），
标题与起因文案与注入矩阵一致；12 人 3 张卡居中；放弃态脚部同时有「放弃」「选定」；
嫁祸态 5 个槽里 1 张已揭示的卡保持不可选、其余 4 张可点。
真实对局里抽屉几何与注入矩阵同构（同一套 CSS），本批不再另量尺寸。

## 四、已知偏差与没能做到的

1. ~~**自动代翻「留屏 900ms」视觉上不成立**~~：**已修（#69）**。顺序改为 `announceReveals()` 先于 `render()`，
   探针四拍都量到抽屉在屏（见上节表）；此前「两次测量不一致」的时序依赖也一并消失。
   实拍补了 `shots/4p-auto-afterglow.png`（注入路径）与 `shots/reveal-drawer-auto-afterglow.png`（真实超时路径）。
2. **「已提交，等待结算」这一帧真实对局里拍不到**。挂起揭示是单人决策：提交即结算，服务端下一条投影里
   `pendingReveal` 已经没了，抽屉直接关（实测提交后 50ms `#revealDrawer.hidden === true`）。
   `submitted` 分支的副标题与按钮改成「已提交，等待结算。」/「已提交」是把这个瞬间的文案写对；
   注入法可在屏上量到并拍下 `shots/4p-submitted.png`。
   断言在 `reveal-drawer.test.js`「交出去之后不再教人怎么选」。
3. ~~**诅咒与嫁祸没有实拍**~~：**两张都已真机拍到**。诅咒见 `shots/4p-real-curse.png`（丹福斯是脚本，页面等待）；
   嫁祸见 `shots/4p-real-scapegoat.png`（页面本人是丹福斯/选择者，5 张卡里有 1 张此前已揭示，正好带出「已揭示槽不算可选」的真实形态）。
   凑法见上节；注入图 `shots/4p-scapegoat.png` 与 `4p-curse.png` 保留作标题口径对照。
4. **12 人已补真机**：`shots/12p-real-choose.png`，页面是选择者、目标 7 点、3 张卡居中。
   12 人整局 `conspiracy=12/12` 仍作阶段与投影的回归。
5. **「放弃」已补真机**：`shots/4p-real-decline.png`，页面丹福斯、`canDecline=true`、脚部「放弃」「选定」并列。
6. **等待者已补真机**：`shots/4p-real-waiter.png`，选择者是脚本，页面看等待句与等待环。
7. 真机 30fps 与触感可感性仍归 #35。

### 自动代翻收尾的复现方法

回合时限默认 90 秒，等自然超时太久。服务端 `TURN_MS` 可用环境变量覆盖：

```powershell
cd apps\server
$env:PORT='8700'; $env:TURN_MS='20000'; node src/server.mjs
```

触发挂起后什么都不点，20 秒后规则层会带 `auto: true` 翻开第 1 张，抽屉随后保留 900ms
（reduced 700ms）——`shots/reveal-drawer-auto-afterglow.png` 就是这么拍到的。

