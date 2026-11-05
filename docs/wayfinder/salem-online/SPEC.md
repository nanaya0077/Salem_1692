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

- 默认配比按中文旧版：女巫数 4:1、5:1、6:2、7:2、8:2、9:1、10:2、11:2、12:2；警长 1。注意 9 人是 1 女巫（第二版对照为 2），这是两版差异点。
- 身份卡总数按官方表：20/25/30/35/32/35/30/33/36（4–12 人），**9 人 35 张无法均分**，实现为前 8 人 4 张、末位 3 张；8 人 32 张每人 4 张。`GameConfig.identityCardTotal` 是权威总数，`identityCardsPerPlayer` 只作展示与显式覆盖。
- 开局前可覆盖 `witchCount` 与 `identityCardsPerPlayer`；显式覆盖时总数 = 人数 × 每人数量，否则沿用默认 `identityCardTotal`。总身份卡数必须 ≥ 女巫数 + 1。
- 校验范围：人数 4–12；女巫数 1–人数-1；每人身份卡数 2–8；人数 × 每人数量必须够女巫 + 警长。
- 阴谋边界：存活玩家把最后一张身份卡传给左邻、而自己的左邻已死时，会没有任何身份卡。规则书未覆盖此状态；实现按“无身份出局”（`playerDied cause:"no-trials"`）处理，避免永远无法再被指控的不死状态。
- **信徒**：其他玩家不能对你打出红卡；嫁祸、医生等“移动红卡”的效果不受限。
- **莎拉·古德**：对你打出的抢劫/纵火无效，并立刻丢弃该卡；作为抢劫去向时正常收牌。
- 规则引擎实现见 `packages/rules`，测试命令 `cd packages/rules && node --test test/*.test.ts`。

## 2. 运行时架构

- 客户端：原生 HTML/CSS/ES Module（`apps/web`），无构建步骤、无 React/Vite；移动优先 CSS；PWA manifest + service worker（壳与静态资源缓存）。
- 服务端：Node 24（直接运行 `.mjs` 与 `.ts`，靠原生类型剥离）+ `ws` WebSocket，单进程内存态；HTTP 同时托管 `apps/web` 与 `/assets/*`，没有 Colyseus/Redis。
- 规则核心：`packages/rules`，纯 TypeScript、无 IO、无 UI；导出 `GameState`、`createGame`、`drawTwo`、`playCard`、`endTurn`、`resolveNight`、`project`、`samuelTake`、`titubaReorder` 等命令函数。命令返回新状态，不原地改旧状态。
- 传输：WebSocket JSON；客户端消息含 `type/commandId`，服务端按 `commandId` 去重；状态以 `projection` 全量投影下发，事件以 `events` 增量广播。
- 客户端只拿投影：公共态 + 自己的私密态；`project(state, viewerId)` 不序列化牌堆、他人手牌、未揭示身份卡、夜晚目标。

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
  phase: Phase;
  currentPlayerId: number;
  actionTaken: boolean;
  deckCount: number;
  discardCount: number;
  discard: CardId[];            // 公开弃牌堆；塞缪尔能力需要
  deckOrder: CardId[] | null;   // 仅蒂图巴本人且能力未用时非 null
  winner: Winner;
  winnerReason: string | null;
  log: GameEvent[];
  self: SelfView;               // 自己的手牌、身份卡、角色、已用能力
  seats: PublicPlayer[];        // 他人：指控数、已揭示身份卡、蓝卡、公开角色
  night: { active: boolean; targetKnown: boolean } | null;
};
```

- `project(state, viewerId)` 是纯函数；禁止把 `deck`、他人 `hand`、未揭示 `trials`、`witchIds`、`nightTarget` 放进任何非本人投影。
- 重连：`seatToken`（一次性、服务端哈希存储）+ `lastVersion`；返回全量投影 + 之后的事件；旧 token 轮换。
- 防冒领：token 绑定 `seatId` 与房间；命令带 `commandId`，服务端拒绝重复/过期命令。
- 零泄漏门禁：12 个 viewer 的 golden snapshot diff；对序列化 payload 做禁用键扫描（`witchIds`、`deck`、`hand`、`nightTarget`、`identity` 他人）；CI 失败即阻断。

## 5. 规则引擎

- 模型：命令 → 新状态 + 事件；命令函数返回 `{ok:true,state,events}` 或 `{ok:false,reason}`，旧状态不被原地修改；RNG 用服务端种子（`seed`），事件日志记录抽牌顺序。
- 阶段：大厅 `lobby` → 黎明 `dawn` → 白天 `action` → 夜晚 `night` → 结束 `gameOver`；白天内部有抽牌、出牌、结算、推进回合。
- 同时结算：传染先生成全体左邻换牌事件，再按座位顺序应用；情侣连锁死亡入队列；玛莎在回合开始读取右手边角色；拘留可叠加；蒂图巴调序生成新牌堆顺序。
- 卡牌效果在 `playCard` 内分支实现：`addAccusation`、蓝卡弃置、嫁祸整组转移、抢劫换手、纵火、拘留、情侣绑定、夜晚免疫、信徒红卡免疫、莎拉·古德纵火/抢劫无效、诅咒弃蓝卡后立即翻牌。
- 裁决以中文旧版为准；第二版/第 15 版只作差异参考，卡面 OCR 只作佐证。
- 开局配置：`resolveConfig(input)` 产出 `witchCount / identityCardsPerPlayer / identityCardTotal / constableCount`；`createGame` 按 `identityCardTotal` 发身份卡（不整除时前若干人各多 1 张），非法配置在开局前拒绝。
- 已实现角色能力：阿比盖尔（可选弃红卡）、贾尔斯·科里（两红补抽）、科顿·马瑟（证据 1 点）、乔治·伯勒斯（8 点门槛）、托马斯·丹佛斯（6/7 点门槛）、威尔·格里格斯（辩护当目击）、莎拉·古德（免疫纵火/抢劫）、玛丽·沃伦（夜晚连锁免疫）、威廉·菲普斯（暗自首免疫）、塞缪尔·帕里斯（弃牌堆取牌）、蒂图巴（重排牌堆）、玛莎·科里（复制右邻）。
- 测试：`cd packages/rules && node --test test/*.test.ts`，当前 32 条，覆盖配置矩阵、发牌守恒、红卡门槛、贾尔斯、阿比盖尔、威廉、信徒、莎拉·古德、嫁祸/抢劫、拘留、诅咒、情侣去重、辩护选牌、威尔、夜晚救杀、传染、丽贝卡抽牌归属、阴谋零身份卡出局、投影泄漏，以及 12 人 48 seed 随机对局 soak（59 张守恒、夜晚在途牌、死者牌区清空、投影零泄漏）。

## 6. 房间生命周期

- 创建：房主生成 6 位房码（去掉 0/O/1/I），房间 TTL 2 小时；暂无 `/r/CODE` 路由，链接用首页 + 房码。
- 加入：昵称；4–12 人；准备状态；房主可踢人、开局；人数不足/超员拒绝开局。
- 测试机器人：房主在大厅点“＋ 机器人”添加，最多补到 12 座；机器人自动准备、自动黎明/夜晚投票、轮到它时先尝试打出一张合法红卡，打不出则抽两张并结束回合；暂不用角色主动技能，仅用于单人联调。
- 开局：所有在座玩家准备且在线；服务端洗牌、发角色卡/身份卡/手牌；`normalizeSeatIds` 按加入时间重排座位，避免大厅离开造成索引错位。
- 掉线：默认 60 秒宽限（`GRACE_MS`）；超时托管，只自动“抽 2 张/结束回合”，不代做指控、自首、锤子、夜晚击杀等关键决策；重连凭 `sessionStorage` token 回原座位。
- 房主离开：自动转给最早加入的在线玩家。
- 自动化：`apps/server/test/lifecycle.mjs` 覆盖大厅踢人、对局中断线 token 回原座位、房主转移；`apps/server/test/bots_add.mjs` 覆盖房主加 3 个机器人、开局与机器人自动过回合；`apps/server/test/fullgame_bots.mjs` 覆盖 12 人整局自动压测（12 个 WebSocket 客户端、自动建房/准备/抽牌/出牌/黎明/夜晚，直到终局），逐局输出耗时、胜方与错误汇总，`GAMES=3` 可连跑多局。
- 回合计时：默认 90 秒（`TURN_MS`）；夜晚 30 秒、黎明 45 秒，可环境变量覆盖。
- 中途退出：座位保留为断线托管，不按死亡处理；MVP 不做观战；提前结束需全员投票（未实现）。
- 清理：结束/空闲 30 分钟销毁；事件日志未持久化。

## 7. MVP 与验收

- 范围：朋友房 4–12；完整基础 59 张 + 15 角色 + 3 身份；中文旧版规则；女巫数/每人身份卡数开局可配；H5 竖屏；游客；外置语音 + 快捷语；全屏夜晚；服务端权威；断线重连。
- 已跑通：4 人协议冒烟、4 人真实浏览器对局、12 人建房/开局/牌桌、夜晚到终局、投影零泄漏测试、塞缪尔取牌 UI、威廉/阿比盖尔能力。
- 待验收：6–8 人完整局 10 局无阻断；12 人 soak 20 局；重连 <5 秒；p95 操作延迟 <300ms；低端机 30fps；iOS Safari/Android Chrome 真机。
- 发布门禁：规则一致性测试 100%；12 人压测通过；投影泄漏扫描通过；真机走通。
- 二期：公共匹配、账号、教学/bot、观战/回放、内建语音、小程序、商业化。

## 8. 建议开工顺序

1. `packages/rules`：状态机 + 卡牌效果 + 开局配置 + 场景测试；已完成 32 条（含 12 人 48 seed soak）。
2. 服务端房间 + 投影 + seat token + 泄漏门禁；已完成基础。
3. 客户端牌桌 + 卡牌详情；已完成。
4. 夜晚全屏流程 + 计时/托管；已完成基础，待夜间残局与托管边界回归。
5. 房间生命周期 + 断线重连 + 12 人压测；重连、12 人开局与规则层 soak 已跑通，长时服务端 soak 待做。
6. 美术替换、音效、埋点、上线合规。
