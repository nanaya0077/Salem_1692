# 《女巫镇》在线版 · 开工规格

> 对应 MAP-1 与 W-03…W-12。规则事实见 [W-01 研究笔记](../../research/salem-1692-card-and-rules-facts.md)，平台事实见 [W-02 研究笔记](../../research/salem-online-realtime-platform-facts.md)。本文件只定“怎么做”，不重复卡表。
> **当前规则基线：中文旧版**（andyventure 对照页）；女巫数与每人身份卡数在开局前可配。

## 1. 产品边界

- 朋友房优先：4–12 人，6 位房码 + 链接，游客昵称即开，不做公共匹配。
- 首发载体：移动浏览器 H5，竖屏；PWA 只做安装/全屏/离线壳，不做应用商店首发。
- 单局 20–40 分钟；回合与夜晚都有计时与超时默认动作。
- 语音：外置语音（微信/Discord）+ 局内结构化快捷语 + 房内文字；MVP 不内建语音，但协议预留语音通道。
- 夜晚：全屏夜幕 + 分段私密面板；服务端编排，客户端不自行推进。
- 不做（MVP）：公共匹配、账号体系、单人教学/bot、观战/回放、内建语音、小程序、内购。

### 1.1 规则与开局配置

- 默认配比按中文旧版：4–9 人每人 5 张身份卡，10–12 人每人 3 张；女巫数默认 4:1、5:1、6:2、7:2、8:2、9:1、10:2、11:2、12:2；警长 1。注意 9 人是 1 女巫（第二版对照为 2），这是两版差异点。
- 开局前可覆盖 `witchCount` 与 `identityCardsPerPlayer`；总身份卡数 = 人数 × 每人数量，必须 ≥ 女巫数 + 1。
- 校验范围：人数 4–12；女巫数 1–人数-1；每人身份卡数 2–8；人数 × 每人数量必须够女巫 + 警长。
- **信徒**：其他玩家不能对你打出红卡；嫁祸、医生等“移动红卡”的效果不受限。
- **莎拉·古德**：对你打出的抢劫/纵火无效，并立刻丢弃该卡；作为抢劫去向时正常收牌。
- 规则引擎实现见 `packages/rules`，测试命令 `cd packages/rules && node --test test/*.test.ts`。

## 2. 运行时架构

- 客户端：TypeScript + React + Vite；移动优先 CSS，不引入重型 UI 框架；PWA manifest + service worker（仅壳与静态资源）。
- 服务端：Node 22 + TypeScript + Colyseus（房间 actor + WebSocket）；MVP 单进程内存态，Redis 只用于多实例 presence（二期）。
- 规则核心：`packages/rules`，纯 TypeScript、无 IO、无 React；导出 `GameState`、`Command`、`Event`、`reduce`、`project`。
- 传输：WebSocket JSON；消息带 `schemaVersion`、`roomVersion`、`commandId`；服务端按 `commandId` 幂等。
- 客户端只拿投影：公共态 + 自己的私密态；任何“全量房间态”不广播。

## 3. 卡牌渲染（关键决策）

**卡面文字不烧进图片。** 服务端只下发 `cardId`；客户端用 `assets/cards/cards.zh.json` 取标题、类型、点数、效果文本，用 DOM/SVG 渲染卡框与文字，只把插画/纹理当图片层。

- 手牌：只显示标题、类型点、点数/“点开”，不显示 7px 小字；点击打开全屏卡牌详情。
- 详情：标题 ≥26px、正文 ≥18px（390px 宽设备），随设备宽度与 DPR 缩放；底部“打出”按钮，关闭后回到牌桌选目标。
- 卡牌 PNG（750×1136 / 1125×1704）只作为社交分享、打印样张、离线回退；不作为对局内文字载体。
- 数据文件：`assets/cards/cards.zh.json`（33 张：15 基础卡 + 15 角色卡 + 3 身份卡），字段含 `id/name/kind/color/typeLabel/points/target/text/image/printImage`。
- 正式美术：插画重绘或授权复用；卡框、类型条、点数、文字层全部矢量化/数据化；中英双语从第一天走 i18n。
- 字号下限：正文 18px、标题 26px；低于此值视为可读性缺陷，不做“缩小塞进卡面”。

## 4. 状态与投影

```ts
type RoomState = {
  version: number;
  phase: Phase;
  players: PlayerState[];       // 含 seatId, alive, accusations, trials, blue, hand
  deck: CardId[];               // 仅服务端
  discard: CardId[];
  night: NightState | null;
  winner: "town" | "witches" | null;
};

type Projection = {
  version: number;
  public: PublicView;           // 牌堆数、弃牌数、当前玩家、公开身份卡、日志
  self: SelfView;               // 自己的手牌、身份卡、角色、私密提示
  seats: SeatView[];            // 他人：指控数、已揭示身份卡、蓝卡、连接态
};
```

- `project(state, viewerId)` 是纯函数；禁止把 `deck`、他人 `hand`、未揭示 `trials`、`witchIds`、`nightTarget` 放进任何非本人投影。
- 重连：`seatToken`（一次性、服务端哈希存储）+ `lastVersion`；返回全量投影 + 之后的事件；旧 token 轮换。
- 防冒领：token 绑定 `seatId` 与房间；命令带 `commandId`，服务端拒绝重复/过期命令。
- 零泄漏门禁：12 个 viewer 的 golden snapshot diff；对序列化 payload 做禁用键扫描（`witchIds`、`deck`、`hand`、`nightTarget`、`identity` 他人）；CI 失败即阻断。

## 5. 规则引擎

- 模型：命令 → 事件 → reducer；事件日志即回放；RNG 用服务端种子，事件记录 `seed`/`drawIndex`。
- 阶段：`turnStart → drawChoice → draw2 → resolveImmediate → playCards → accusation → trialReveal → death → winCheck → turnEnd`。
- 同时结算屏障：传染换牌先收集所有存活玩家选择，再原子应用；情侣连锁死亡入队列，依次结算；玛莎在回合开始快照右邻能力；拘留可叠加；蒂图巴调序生成置换事件。
- 卡牌效果用 `Effect` 联合类型（`addAccusation`、`discardBlue`、`moveFront`、`transferHand`、`skipTurn`、`bind`、`nightImmune`、`blockRedAgainstPiety`、`nullifyAgainstSarahGood`、`revealTrial`…），文本只用于 UI。
- 裁决以中文旧版为准；第二版/第 15 版只作差异参考，卡面 OCR 只作佐证。
- 开局配置是纯函数：`resolveConfig(input)` 产出 `witchCount / identityCardsPerPlayer / constableCount`，`buildIdentityDeck` + 种子洗牌发牌；非法配置在开局前拒绝，不进入房间。
- 测试：配置矩阵（4–12 人、女巫数、每人身份卡数、非法总数）、信徒红卡免疫、莎拉·古德纵火/抢劫免疫、红卡不跨次累计、乔治/托马斯阈值、死亡/胜负、夜晚救杀、回放确定性。

## 6. 房间生命周期

- 创建：房主生成 6 位房码（去掉 0/O/1/I），房间 TTL 2 小时；链接 `/r/CODE`。
- 加入：昵称 + 头像；4–12 人；准备状态；房主可踢人、开局；人数不足/超员拒绝开局。
- 开局：所有在座玩家准备；服务端洗牌、发角色卡/身份卡/手牌；座位顺序固定。
- 掉线：60 秒宽限；超时托管，只自动“抽 2 张/结束回合”，不代做指控、自首、锤子、夜晚击杀等关键决策；重连回原座位。
- 房主离开：自动转给最早加入的在线玩家；无人则房间进入 5 分钟保留。
- 中途退出：按死亡处理但不揭示身份；MVP 不做观战；提前结束需全员投票。
- 清理：结束/空闲 30 分钟销毁；事件日志保留 24 小时用于复盘（不含隐私）。

## 7. MVP 与验收

- 范围：朋友房 4–12；完整基础 59 张 + 15 角色 + 3 身份；中文旧版规则；女巫数/每人身份卡数开局可配；H5 竖屏；游客；外置语音 + 快捷语；全屏夜晚；服务端权威；断线重连。
- 优先验收：6–8 人完整局 10 局无阻断；12 人 soak 20 局；零隐藏信息泄漏；重连 <5 秒；p95 操作延迟 <300ms；低端机 30fps；单局 20–40 分钟。
- 发布门禁：规则一致性测试 100%；12 人压测通过；投影泄漏扫描通过；iOS Safari/Android Chrome 各一台真机走通。
- 二期：公共匹配、账号、教学/bot、观战/回放、内建语音、小程序、商业化。

## 8. 建议开工顺序

1. `packages/rules`：状态机 + 卡牌效果 + 开局配置 + 59 张场景测试（不依赖 UI）；当前已落配置/信徒/莎拉·古德与 9 条测试。
2. 服务端房间 + 投影 + seat token + 泄漏门禁。
3. 客户端牌桌 + 卡牌详情（先接 `cards.zh.json`，不接正式美术）。
4. 夜晚全屏流程 + 计时/托管。
5. 房间生命周期 + 断线重连 + 12 人压测。
6. 美术替换、音效、埋点、上线合规。
