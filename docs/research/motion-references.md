# 动效参考：隐藏身份/社交推理与卡牌游戏如何用动效组织信息与仪式

> 状态：研究笔记（wayfinder R2 / deck #31，team task-2）。**不改变任何实现**，只回答「同类产品怎么用动效组织信息与仪式，哪些能搬进本仓、哪些不能」。
> 基线：2026-11-08。一手来源为官方 wiki（Blood on the Clocktower、Town of Salem 2）、官方应用仓库 README（ThePandemoniumInstitute/botc-release）、MDN 与 Nielsen Norman Group；二手来源标为 C。
> 证据等级：**A** = 官方文档/规范/官方仓库原文；**B** = MDN、Nielsen Norman Group、Material Design 等权威设计文档；**C** = 社区 wiki、媒体报道等二手来源，但给出了具体数值；**D** = 未取到一手来源，本仓裁决（若付诸实现，须写进测试或兜底）。
> **与既有笔记的关系**：`docs/research/` 下已有笔记只覆盖规则（`salem-1692-card-and-rules-facts.md`）、平台与实时（`salem-online-realtime-platform-facts.md`）、资产与上传（`asset-manifest.md`、`avatar-upload-mobile-web-facts.md`），**没有一篇覆盖动效语言（时长、节奏、阻塞、揭示仪式、信息隐藏下的演出）**，故另起本篇。本篇只做参考与裁决，不替代 SPEC 的验收条目。

---

## 0. 结论

1. **五类事件分层成立，且量级彼此差一个数量级**：交互反馈 90–140ms、状态变化 250–400ms、公开事件演出 0.8–1.5s、阶段转场 300–375ms、终局揭晓 2–5s（可掐断）。超出所在量级就是「拖」，低于量级就是「没看见」。（证据 B，见 §1.1）
2. **阻塞是稀缺资源**：只有「不可逆 + 全桌共享」的时刻值得阻塞输入。单次阻塞上限约 2s；整段不可跳过的流程（夜间结算、死亡回顾）必须给**相位时钟**与**明确的可中断/跳过出口**，因为超过 10s 人不看进度就不安。（证据 B：NN/g 三档；证据 C：ToS2 每个相位都顶栏挂时钟）
3. **「所有人同时知道该知道的」= 先服务端算完，再同一时刻广播，且每人只收到自己的投影**。演出参数（播不播、播什么、播多长）应当由**服务端下发的可见性**决定，而不是客户端自己决定——Among Us 的 Confirm Ejects 开关证明「揭示多少」是可以被显式策略化的。（证据 C/A，见 §1.3）
4. **夜间的动效本身就是情报**。BOTC 说书人手册明确要求夜里**在不同区域随机走动、轻声敲肩、向下指确认选择**，因为脚步与声响会泄露「谁被唤醒了、谁被点了」。映射到本仓：任何「只在某人身上出现/只持续某人可见时长」的动效，都是泄露通道。（证据 A，见 §1.3）
5. **移动端克制有硬指标**：只动 `transform` / `opacity`（合成层，不触发 layout 与 paint），60fps 预算 16.7ms/帧；本仓验收目标是低端机 30fps，因此**时长可以不变、粒子/滤镜/大面积模糊必须砍**。（证据 B：MDN 渲染瀑布）
6. **reduced-motion 必须是一等功能，且已被现有测试锁定**：`apps/web/styles.css:226-229` 与 `:250-252` 关掉翻牌与横幅动画，`apps/web/test/reveal-banner.test.js:78-79` 断言这两段契约存在。新增任何演出沿用同一模式。（证据 A：MDN 的 `prefers-reduced-motion` 自 2020-01 起广泛可用）
7. **首批只配三段骨架**：翻牌/揭示/死亡、夜晚→黎明、全局交互反馈。击杀动画、慢镜、逐具尸体全屏回顾、per-seat 音效一律进第二批或直接不做。（本仓裁决，见 §3）

---

## 可借鉴

### 1.1 事件分类与时量：每类「多长、多重」

| 类别 | 观察到的事实（来源） | 时长量级 | 本仓推断 |
|---|---|---|---|
| 交互反馈（按压、选中、禁用） | 0.1s 是「感觉系统即时响应/直接操作」的上限，超过这个值就开始失去直接操作感（证据 B：NN/g《Response Times: The 3 Important Limits》）；元素进场 225ms、离场 195ms（证据 B：Material Design《Duration & easing》） | 90–225ms | 90–140ms，跟随手指，不给弹跳 |
| 状态变化（选中目标、卡被清空、座位状态） | 同类产品把「状态更新」压在一个转场内完成，靠颜色/位移而不是新图层（推断自 §1.1 的 300ms 转场与合成层事实） | 250–400ms | 250–350ms，只动 transform/opacity |
| 公开事件演出（揭示一张身份卡、指控成立） | 死亡/揭示在同类产品里是**独立的一次停顿**：ToS2 夜间结算后进入 Results（此阶段谁都不能说话、不能用能力），再进「谁死了、怎么死的」逐条回顾（证据 C）；BOTC 官方 App 脚本 JSON 里 `reveal: replace-character` 明确发生在「**right before the character reveal**」，即终局有独立的角色揭晓时刻（证据 A） | 0.8–1.5s/条 | 0.8–1.2s/条，串行、可跳 |
| 阶段转场（夜晚→黎明、日→夜） | 移动端转场通常 300ms；大而复杂的全屏转场 375ms；**超过 400ms 会显得太慢**（证据 B：Material）；平板约为移动端 +30%，可穿戴 −30% | 300–375ms | 300ms 常规、375ms 全屏；**不要**做 2s 拉幕 |
| 终局揭晓 | BOTC：宣布胜负要「**dramatic pause**，先拿到全场注意力再以权威语气开口」，并鼓励庆祝（证据 A，Storyteller Advice）；官方 App 脚本里终局有独立的角色揭晓时机（证据 A） | 2–5s 总 | 停顿 0.8–1.2s + 揭示 2–3s，总 ≤5s，可跳过 |

**节奏上的两条硬事实**，直接影响实现方式：

- 软件可以「太快」：列表滚动太快时用户无法停在目标项。**动画必须按真实时钟定时，不能跟着机器执行速度走**（证据 B：NN/g）。→ 本仓结论：动效用 CSS 的固定 `ms` 时长，**不要**用 `requestAnimationFrame` 数帧数推进逻辑帧——低端机跑不满 60fps 时，按帧计步的演出会在真实时间里变长，节奏全乱。
- 同一句话的另一面：常用转场要短，只给**不可重复、不可逆**的时刻（揭示、终局）留长时长（证据 B：Material「快到不让人等，慢到能被看懂」）。

### 1.2 节奏与阻塞：什么时候可以挡住玩家

- **三档响应界**：0.1s 直接操作感 / 1.0s 思路流不断 / 10s 注意力还在；超过 1s 必须有「在忙」的指示，超过 10s 必须有**百分比进度 + 明确的可中断出口**；2–10s 的操作上真进度条属过度（证据 B：NN/g）。
- **同类产品用「短而固定窗口 + 顶部时钟」组织长流程**（证据 C：Town of Salem 2《Game Phases》）：Night 37s（Rapid 10s）、Results（禁止发言与用能力）、Day 1 15s、Discussion 45s（Rapid 15s）、Voting 30s（Rapid 9s）、Defense 20s（仅被告可说话）、Last Words 约 7s；屏幕顶部中间常驻**相位时钟**。观察到的规律：**没人被要求等一个「尽头看不见」的演出**，所有等待都有秒数。
- **失败案例（可直接引用的反面教材）**：Hearthstone 每回合 75 秒，绳燃尽就是剩余时间的可视化；玩家明知无力回天仍会「恶意烧绳」，让胜负「姗姗来迟」，「耽误的时间都是两个人的」，从观众角度更愿看快节奏（证据 C：网易号「暴雪编辑部」2017-10-18）。教训不是「不要倒计时」，而是**长时限 + 没有一个能把整桌往前推的出口 = 一个人的思考时间变成十个人的等待**。
- **反拖延的两个官方姿态**（证据 A：BOTC Storyteller Advice）：①「结果已定时**你可以提前结束游戏**，没必要把流程走完」；②节奏的**设计目标**是「让游戏撑到最后一天」，因为只剩三四人时最戏剧化。→ 本仓推断：演出预算应随局内人数/剩余牌堆**收敛**，末局越短越该快，而不是越到最后越长。
- **跳过权的三种形态**（本仓推断，D）：整段可跳（第一次点任意处即跳过）／分段不可跳但有可见时钟（相位时钟）／同屏最多一个阻塞层（同时只允许一个全屏演出，其余排队）。

### 1.3 信息隐藏下的演出：怎么让「所有人同时知道该知道的」

- **服务端先算完，再同一时刻广播**：ToS2 的 Results 一次性结算所有夜间行为，每个玩家收到**自己的**反馈，死者收到「You Died!」通知，之后才进入全桌统一的死亡回顾；此时不能说话、不能使用能力（证据 C）。
- **揭示是有策略开关的**：Among Us 的 Confirm Ejects 开着时，丢出演出会额外显示「他是不是内鬼 + 剩余内鬼人数」，关掉时只显示「某人被丢出」；同一段丢出动画在开/关两种设置下**内容不同**——开时船员从熔岩里伸手求救、内鬼只竖大拇指，关时直接掉进熔岩、没有任何角色相关动作（证据 C：wiki3.jp 攻略 wiki）。这是「演出参数随揭示策略变化」最干净的实例。
- **死亡不重复产生信息**：BOTC「死人不能再死一次；若死人被攻击，全桌**不会**知道他昨夜死了」（证据 A：States）。→ 重复事件必须去重，否则全桌会误以为发生了新事。
- **自身状态变化是必然送达的私密信息，与「能力给的情报」不是一类**：角色/阵营变更「**at the earliest opportunity, in secret**」，用「YOU ARE」信息牌告知，且不受醉酒/中毒影响（证据 A：States）。→ 本仓投影必须区分「规则事实」与「游戏情报」。
- **权威可以给假情报，但规则解释永远真话**：「不要告诉玩家他中毒/醉酒了，照常唤醒他、照常让他做选择」，同时「关于规则的信息永远给正确的」（证据 A：States）。
- **夜间的动作本身会泄露**（最关键的一条，证据 A：Storyteller Advice）：夜里**不必要的走动**会让玩家怀疑恶魔坐那片；**敲肩要轻**，否则邻座听见就怀疑被敲的人；玩家指完目标后说书人要**走到他跟前向下指**做确认，避免误听误选；说书人要在「投票、宣布最后提名 3…2…1」这类重要节点**走进圈里**，用位置和动作作为「重要事件来了」的信号。
  - 【观察】这三句说的都是线下动作，但机制是通用的：**时长、音效、位置、焦点移动都是信息通道**。
  - 【推断】本仓若让「女巫的夜间面板」比「平民的」多 2 秒，或让被选中的座位闪一下，就等价于说书人踩着同一块地板走路。

### 1.4 移动端克制：小屏、低端机、单手

- **渲染瀑布**：改几何属性（`left`、`width`、`margin`、`font-size`）会触发重算样式 + layout + paint；只改 `transform` / `opacity` 且在独立图层上的属性走**合成**，连 repaint 都不触发；60fps 下每帧只有 16.7ms 预算（证据 B：MDN《Animation performance and frame rate》）。
- **时长随面积/距离调整**：大距离、大面积变化用更长时长，离屏元素可以更短（证据 B：Material）。→ 本仓推断：不在视口内、或滚动到屏外的事件**不要播演出**，只在事件日志留一条。
- **绕过动效偏好**：`prefers-reduced-motion` 自 2020-01 起广泛可用，语义是「用户要求最小化非必要动效」；缩放、平移大对象是前庭障碍的触发源，规范做法是**用淡入淡出替代位移动画**而不是直接删掉信息（证据 A：MDN）。→ 本仓现有 CSS 选了「直接 `animation: none`」，信息仍在文案里，可行；但**新增的任何「靠动画才能看见的信息」在 reduced-motion 下必须另有静态通道**。
- 单手/小屏：一手来源未取到（D）。本仓裁决：演出只占屏中上 40% 或屏底，不要求精确点击；主操作放屏底 1/3；横幅文字按 SPEC 下限 18px 计，最多两行，超过则改成「摘要 + 事件日志可回看」。

---

## 不可借鉴

> 以下每条都是同类产品**真实存在**的做法（除标注外均有来源），但对本仓是负资产。判断依据是 §1 的事实与其推论。

1. **逐具尸体的全屏回顾**（证据 C：ToS2「Who Died and How?」对每个死者重复一遍，白天发生的谋杀也触发）。本仓 4–12 人、一夜可能多人同时死：8 条 × 1.5s ≈ 12s 的不可跳过时长，直接越过了 NN/g 的 10 秒注意力界。→ 改：一条汇总卡（「昨夜 N 人死亡」+ 名单）+ 事件日志逐条可查。
2. **把长时限做成强视觉压迫**（证据 C：Hearthstone 的烧绳子 75 秒）。本仓 `TURN_MS=90000` 已经够长，再叠一个从头到尾的倒计时，会把「等」的焦虑放大十倍。→ 改：只在**最后 10 秒**出现倒计时，其余时间只显示静态剩余时间或干脆不显示。
3. **击杀动画 / 慢镜**（证据 C：ToS2 的 Kill Animations 按角色播不同动画；Among Us 的 Airship 丢出带一段慢镜）。低端机 30fps 预算 + 移动 Web 图层数量有限，且慢镜本质是**拉长不可跳过时长**。→ 不做；死亡用 §3.1 的统一横幅。
4. **每张地图/每个角色一套专属演出**（证据 C：Among Us 四张地图四种丢出演出）。内容生产成本与回归面按角色数乘算，本仓二期还有教学 bot、观战回放；一次性美术只做一套「揭示」和一套「死亡」，靠文案区分。→ 不做多套。
5. **per-seat 的音效/高亮/滚动定位**（反面教训来自证据 A：BOTC 要求夜里随机走动、轻声敲肩，因为声响与位置会泄露）。任何「只在某个人身上发生」的可见/可听效果都是泄露通道。→ 不做；夜间所有步骤共用同一容器、同一时长。
6. **不可跳过的整屏入场演出**（如 2s 拉幕式夜幕）。每夜触发一次、10 个夜晚就是 20s，且重连后还会重播。→ 改：375ms 交叉叠化，重连直接落到当前步骤，不重播。
7. **用动画表达随机性**（转盘、洗牌抛卡）。它不解决任何信息问题，只增加时长与掉帧风险；本仓发牌结果由服务端一次性给出（投影），演出只负责「揭示」。→ 不做。

---

## 本仓映射

### 3.1 骨架一：翻牌 / 揭示 / 死亡

**现状（代码事实）**：`apps/web/styles.css:212` `.trial-card .trial-inner` 用 `transition: transform .6s cubic-bezier(.2,.7,.3,1)`；`:219` `.trial-card.revealed .trial-inner { transform: rotateY(180deg) }`；`:221` `.trial-card.flip-in .trial-inner { animation: trial-flip .6s ... both }`，`:222-225` 的 `@keyframes trial-flip` 从 `rotateY(0deg)` 到 `rotateY(180deg)`；`:226-229` 在 `prefers-reduced-motion: reduce` 下把 transition 与 animation 都设为 `none`。全桌公开事件用 `.reveal-banner`（`:232-240`，固定屏中 `top:40%`、`z-index:60`）配 `reveal-banner-in .28s ease both`（`:239`），`:246-249` 的 keyframes 是「淡入 + 上移 8% + 从 .96 放大回 1」，`:250-252` 在 reduced-motion 下关掉动画。注释写明两条设计意图：翻牌**只给本次渲染第一次见到的已揭示卡**播一次（否则每次重绘整排都会重播）；翻身份卡是全桌公开事件，横幅要递给在场每个人而不是藏在日志抽屉里。`apps/web/test/reveal-banner.test.js:78-79` 已把「存在 `@keyframes trial-flip`」「存在 `prefers-reduced-motion`」写成契约断言。

**建议**：

- **翻牌 600ms 保留**（一次性、可被 reduced-motion 关闭、只动 transform，符合 §1.4）。不要因为「想更快」压到 300ms——翻转是**不可逆揭示**，属于该慢的一类。
- **横幅 0.28s 偏急**：元素级进场 225ms 是「小元素」的基准，全屏公开事件在 300–375ms 更符合 Material 的量级（证据 B）。建议改成 `入 300ms → 停留 600ms → 出 180ms`，单条总时长 ≈1.08s，落在 §1.1 的 0.8–1.2s 内。
- **死亡走两步，而不是一步**：先给当事人一条私密提示（对应 ToS2 的「You Died!」，证据 C），再对全桌广播统一横幅；遗言（GLOSSARY：最多 3 句）用**同一横幅排队**逐句出，不并发、不叠加。
- **终局**：先「宣布胜负」（一次 dramatic pause 的停顿 ≈800–1200ms，证据 A），再逐张翻身份卡；不要一次全翻。这正好落到 BOTC 官方 App 的 `reveal` 时机语义上（证据 A）。
- **契约**：把「横幅完整周期 ≤1.2s」「reduced-motion 下动画时长 0」写进 `apps/web/test/reveal-banner.test.js` 的 CSS 断言，与本仓「D 级裁决须写进测试」的惯例一致。

### 3.2 骨架二：夜晚 → 黎明

**现状（规格与代码事实）**：SPEC 的阶段是 `lobby→dawn→action→night→gameOver`；`NIGHT_MS=30000`、`DAWN_MS=45000`；夜晚是**全屏夜幕 + 分段私密面板**，由服务端编排，客户端不自行推进。

**建议**：

- **步骤表由服务端下发**，客户端只负责渲染顺序，不硬编码「女巫→警长→…」。这正是 BOTC 官方 App 的建模方式：自定义剧本 JSON 里 `"firstNight": ["dusk","minioninfo","demoninfo","poisoner","...","dawn"]`、`"otherNight": [...]`，`dusk` 与 `dawn` 是**表项本身**（证据 A：botc-release README）。本仓的「夜晚」天然对应「黄昏开场、黎明收尾」的可枚举序列。
- **所有夜间步骤共用同一容器、同一进场时长**（例如统一 240ms 淡入），**不因角色不同而变**——这是 §1.3 那条「时长即情报」的直接推论。若确实需要长面板（女巫要看牌堆），给一个**统一上限**而不是按角色给不同时长。
- **夜晚→黎明**：375ms 全屏交叉叠化（Material 的全屏复杂转场上限，证据 B）+ 顶部相位时钟；**不做**拉幕、不做粒子上浮。保留现有 `.reveal-banner` 的「只播第一次见到」策略，重连时直接落到当前步骤，不重播。
- **黎明面板**（GLOSSARY：仅开局一次，女巫睁眼互认、投黑猫）是**唯一的「同时揭示」窗口**，适合用一次性、稍长的演出（≤1.5s），因为它是不可重复的仪式。
- **禁止清单**：夜间任何 per-seat 高亮、滚动到某人、按角色不同的音效/时长/动效曲线。

### 3.3 骨架三：全局交互反馈

- **保留** `.btn` 的 `transition: transform .12s ease, filter .12s ease` 与 `:active` 的 `translateY(1px)`（`apps/web/styles.css:72-77` 区间）——这在 NN/g 的「0.1s 直接操作」档内（证据 B）。
- **补「在忙」与「不可点」**：任何 >1s 的操作（提交目标、确认发牌）必须有进行中指示，否则用户会重复点（证据 B：超过 1s 需要「在忙」指示）。禁用的按钮保持位置不变，只降不透明度，避免布局跳动。
- **反馈不要用弹窗**：成功/失败用屏底 180–240ms 的就地提示；需要人确认的才用弹窗。
- **事件日志是动效的兜底通道**：所有演出都必须能同时在事件日志里被回看（这也是 §1.4 reduced-motion 的静态等价物）。

### 3.4 事件优先级建议

**首批（P0，三段骨架内，本期就该有）**

| 事件 | 时长 | 阻塞？ | 备注 |
|---|---|---|---|
| 按钮按压 / 选中 | 90–140ms | 否 | 已有 |
| 翻身份卡 | 600ms | 否（单卡级） | 已有，保留 |
| 全桌揭示/死亡横幅 | 入 300 / 停 600 / 出 180ms | 是（≤1.1s/条） | 改造现有 280ms |
| 私密「你死了」提示 | 300ms | 否 | 新增，对应 ToS2 |
| 夜晚步骤切换 | 240ms 统一 | 否 | 统一容器 |
| 夜晚→黎明 | 375ms 叠化 | 是 | 加相位时钟 |
| Toast 反馈 | 180–240ms | 否 | 新增 |
| reduced-motion 覆盖 | — | — | 全部沿用现有 `@media` 模式 |

**第二批（P1）**：终局的「停顿 + 逐张揭晓」；指控成立（GLOSSARY：红卡点数到门槛 → 揭示目标一张未揭示身份卡）的演出；自首公开翻牌的演出；投票结果汇总；回合最后 10s 的倒计时（只在这 10s 出现）。

**不做 / P2**：击杀动画、慢镜、逐具尸体全屏回顾、多套地图/角色专属演出、per-seat 音效、随机性动画（转盘/洗牌）。

---

## 开放问题

1. **官方 App 的实际动效时长取不到证**：`botc-release` 仓库 README 只有脚本格式，没有任何动画时长说明；GDC 场次页（`dev.schedule.gdconf.com`）两次抓取都是 Cloudflare 403，GDC 2025《VFX Storytelling: How "Hearthstone" Breathes Life into Hundreds of Cards》与 Steven Medway 的讲者页**只验证到存在，正文未读**。若要更硬的一手来源，需要实机录屏逐帧量时长。
2. **C 级数值的可信度**：ToS2 的 15/37/45/30/20/7 秒、Among Us 的 Confirm Ejects 行为，来源是官方 wiki 与社区 wiki，数值具体但非一手产品文档；建议后续用商店页描述或录屏抽样核对，再决定是否把它们写进本仓的时长表当作基准。
3. **30fps 下 600ms 翻牌是否掉帧**：SPEC 的验收条目是低端机 30fps，但翻牌用了 `preserve-3d` + `rotateY`，低端机合成层可能吃紧。这条必须在真机回归里测（依赖 SPEC 的真机验收项），不能靠桌面浏览器下结论。
4. **夜晚分段时长的「统一」到什么粒度**：统一上限会不会让女巫面板显得太赶？这是可玩性 vs 防泄露的取舍，需要一次内测拍板，而不是研究能定的。
5. **无障碍的等价通道**：横幅用 `aria-live="assertive"` 还是 `"polite"`，台词的播报顺序与队列，都未定；动效研究只给出「必须有静态等价物」，具体策略需要单独一张票。
6. **相位时钟的形态**：ToS2 是顶栏常驻（证据 C），本仓是竖屏小屏、顶栏已有阶段名与人数，加时钟会不会挤压 18px 的字号下限？需要一次 390px 宽的布局验证。

---

## 来源

- Nielsen Norman Group，《Response Times: The 3 Important Limits》（Jakob Nielsen，1993，2014 加注）：https://www.nngroup.com/articles/response-times-3-important-limits/
- Material Design 1，《Duration & easing》：https://m1.material.io/motion/duration-easing.html （M3 对应页 https://m3.material.io/styles/motion/easing-and-duration/applying-easing-and-duration 正文由 JS 渲染，未取到）
- MDN，《`prefers-reduced-motion`》：https://developer.mozilla.org/en-US/docs/Web/CSS/Reference/At-rules/@media/prefers-reduced-motion
- MDN，《Animation performance and frame rate》：https://developer.mozilla.org/en-US/docs/Web/Performance/Guides/Animation_performance_and_frame_rate
- Blood on the Clocktower 官方 wiki，《Storyteller Advice》（末次编辑 2024-11-26）：https://wiki.bloodontheclocktower.com/Storyteller_Advice
- Blood on the Clocktower 官方 wiki，《States》（末次编辑 2023-03-23）：https://wiki.bloodontheclocktower.com/States
- The Official Blood on the Clocktower App 发布仓库与 README（含 `firstNight`/`otherNight` 脚本格式、`special` 能力、`reveal` 时机）：https://github.com/ThePandemoniumInstitute/botc-release ；https://raw.githubusercontent.com/ThePandemoniumInstitute/botc-release/main/README.md
- Town of Salem 2 官方 wiki，《Game Phases (ToS2)》（末次编辑 2026-06-24，CC BY-SA）：https://townofsalem.wiki.gg/wiki/Game_Phases_(ToS2)
- Among Us 攻略 wiki（wiki3.jp），《Ejection》（Confirm Ejects 与各地图丢出演出）：https://wiki3.jp/among_us/page/46
- 网易号「暴雪编辑部」，《炉石传说蛋疼的75秒！你怎么看待如今环境的烧绳子现象？》（2017-10-18）：https://m.163.com/dy/article/D123DKS60526FQH9.html
- GDC 2025 场次（**仅验证到存在，正文未读，403**）：《VFX Storytelling: How "Hearthstone" Breathes Life into Hundreds of Cards》https://dev.schedule.gdconf.com/session/vfx-storytelling-how-hearthstone-breathes-life-into-hundreds-of-cards/908026 ；Steven Medway 讲者页 https://dev.schedule.gdconf.com/speaker/medway-steven/73650
- 本仓代码：`apps/web/styles.css`（:72-77、:212-229、:232-252）、`apps/web/test/reveal-banner.test.js`（:78-79）、`docs/wayfinder/salem-online/SPEC.md`、`GLOSSARY.md`、`README.md`
