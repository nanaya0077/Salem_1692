# 移动 Web 动效与音频的一手事实（翻牌 / 音效技术前置研究）

> 状态：research 完成。为「给翻牌、座位、夜晚结算加动效与声音」这个方向提供实现前的浏览器事实与性能边界。
> 基线：2026-11-08 的现行标准与 MDN 文档；目标载体是本仓现有的零构建原生 ESM H5/PWA（`apps/web/`，无打包、无音频资产、无 `requestAnimationFrame`）。
> 证据等级：**A** = 标准/官方文档原文（W3C/WHATWG/CSSWG、WebKit 官方博客、Chrome 官方文档）；**B** = MDN 文档（含其 Baseline 声明）；**C** = 多方一致、代码事实或可直接推导的算术；**D** = 未取到一手来源，本仓为实现做的裁决，必须写进测试或运行时兜底。
>
> **与既有笔记的关系**：`salem-online-realtime-platform-facts.md` 只覆盖 12 人实时承载与载体选择，`salem-1692-card-and-rules-facts.md` 只覆盖卡牌结算，`avatar-upload-mobile-web-facts.md` 只覆盖选图/编码/体积，`asset-manifest.md` 只清点美术素材，`railway-deploy-facts.md` 只覆盖部署。**五篇都不涉及动效性能、合成器属性、reduced-motion、Web Audio 与 Service Worker 版本节奏，故另起本篇。**

## 0. 结论

1. **常驻微交互留给 CSS，只动 `transform` 与 `opacity`。** 现有 `.trial-card` 的翻牌与 `.reveal-banner` 的入场已经在这个约束内（`apps/web/styles.css:211-252`）；新增动效继续只改这两类属性，不碰 `width/height/top/left/margin/box-shadow/filter`（证据 A/B：web.dev 明说「只有 `transform` 和 `opacity` 能只由合成器处理」）。
2. **需要「可取消、可合并、要跟状态对齐」的动效走 WAAPI，不靠切 class。** `el.animate()` 拿到 `Animation` 句柄，重复触发前先 `el.getAnimations().forEach(a => a.cancel())`；终态用 `commitStyles()` 落地再 `cancel()`，不要长时间挂 `fill: "forwards"`（证据 B）。
3. **位置/尺寸变化（插牌、换座位、牌堆数量）才需要 FLIP，而且本仓大多数场景不需要。** 先把高成本属性变化重映射成一次 `transform`/`opacity` 过场；手牌是 flex 流，插一张牌只做「新卡入场」即可，不必算全长 FLIP（证据 C）。
4. **不上 View Transitions API。** 它做同文档快照过渡、同一文档同时只有一个活跃过渡，本仓界面由 WebSocket 广播驱动 `innerHTML` 全量重绘（`apps/web/app.js:679-766`），过渡会被下一次同步直接打断；且它 Baseline 2025 才跨浏览器可用（证据 B；Firefox 2025-10 才补齐）。
5. **`will-change` 不写进样式表常驻。** MDN 原文把它定义为「last resort」，过量使用会长期保留优化、增加内存与渲染复杂度；web.dev 也说每建一层都要内存并上传 GPU 纹理，合成阶段要压在 4–5 ms（证据 A/B）。牌桌一次最多翻 3–12 张小牌，不值得常驻提层。
6. **帧预算判据写死：60fps = 16.7ms/帧，30fps = 33.3ms/帧（算术 C）；RAIL 建议把样式+布局+绘制+合成压在 10ms 内（B）。** 验收不看 Lighthouse 分数，改看两条可复现指标：动画期间 rAF 间隔的 p90，以及 `PerformanceObserver({type:"longtask"})` 里 >50ms 任务的条数（证据 A/B：web.dev「任何超过 50 毫秒的任务都是长任务」）。
7. **并发动画数量没有标准答案，本仓裁决（D）：同屏「大位移/大面积」动效 ≤1 个；小面积 `transform`/`opacity` 动效同帧 ≤12 个；同一时刻不叠两个以上 3D 变换容器。** 依据是层内存与合成预算，不是标准条文。
8. **`prefers-reduced-motion` 的语义是「减少/替换非必要运动」，不是「禁止一切」。** CSS 用 `@media (prefers-reduced-motion: reduce)` 把位移/缩放/3D 翻转换成透明度交叉或瞬时到位；JS 动效必须 `matchMedia("(prefers-reduced-motion: reduce)")` 判断并监听 `change`（用户在运行中改设置要生效）。**不要用 `animationend`/`transitionend` 承载状态机**——reduced-motion 把动画设为 `none` 后这些事件永不到达（证据 B）。
9. **iOS 的音频解锁必须发生在真实手势的同步路径里。** WebKit 明确：手势要求指 `touchend`/`click`/`doubleclick`/`keydown` 处理器**直接**导致的调用；`canplaythrough` 回调里再 `play()` 不算。所以流程是「click 里先同步 `new AudioContext()` + `resume()`，再去 `await` 拉文件」（证据 A）。
10. **格式选择只认 AAC(.m4a) / MP3。** 单声道 22.05kHz、64–96kbps 足够做牌桌音效；**不要赌 Ogg/Opus 在 iOS 各版本可播**（证据 C/D，见开放问题 3）。体积算术：64kbps≈8KB/s，96kbps≈12KB/s（C）。
11. **audio sprite 一次解码常驻，代价不在文件而在内存。** 所有 ≤1s 音效打成一个 sprite，用 `AudioBufferSourceNode.start(when, offset, duration)` 取片段（证据 A）。解码后是 float32：22.05k 单声道 1 秒 ≈ 86KB、10 秒 ≈ 844KB；44.1k 立体声 1 秒是 353KB。故 sprite 总长 ≤12s、环境垫用 8–12s 循环（C + D）。
12. **淡入淡出用 `GainNode` 的自动化曲线，不改「音量属性」。** `AudioBufferSourceNode` 没有 `volume`；用 `linearRampToValueAtTime` / `setTargetAtTime`，循环用 `source.loop = true`（证据 A/B）。
13. **PWA 侧：新增任何脚本/样式/音频都要过三处闸门。** `sw.js` 的 `VERSION`（`apps/web/sw.js:10`）、`SHELL` 预缓存清单（`:11-25`）、`cacheable` 硬编码白名单（`:59-61`）必须一起改；**音频绝不进 `SHELL`**——`cache.addAll()` 遇到非 2xx 会整体 `TypeError`，安装失败则新版永不激活，用户永远停在旧码（证据 A + 代码事实 C）。
14. **声音只能是增强，不能承载信息。** iOS 静音开关/静音模式会压制输出，网页没有可靠 API 检测；`navigator.vibrate` 在 iOS 不存在且需要 sticky user activation（MDN 标 "Limited availability"）。夜晚、翻牌、点名这些信息必须有视觉等价物（证据 B/C）。

## 1. 本仓现状（代码事实，证据 C）

- **零音频**：`apps/web/` 下没有 `AudioContext`、`new Audio`、`navigator.vibrate`、`requestAnimationFrame`、`element.animate()` 的任何使用（全目录 grep 无命中）。
- **已有两处动效**：
  - 身份卡 3D 翻牌：`.trial-card .trial-inner { transform-style: preserve-3d; transition: transform .6s ...; }`，双面靠 `backface-visibility: hidden` 换面（`apps/web/styles.css:211-219`）；`flip-in` 只在「本次渲染第一次见到的已揭示卡」上加一次，避免整排重播（`apps/web/app.js:545`，样式 `styles.css:220-225`）。
  - 揭示横幅入场：`animation: reveal-banner-in .28s ease both`（`styles.css:232-252`），固定居桌面正中（`:232-240`）。
- **已有 reduced-motion 兜底**：两处 `@media (prefers-reduced-motion: reduce)` 分别关掉翻牌 `transition`/`animation` 与横幅入场（`styles.css:226-229`、`:250-252`）。没有依赖 `animationend`/`transitionend` 的控制流，这是对的，别破坏。
- **布局是单屏固定高度**：`.game { height: 100dvh; overflow: hidden; }`（`styles.css:133`），桌面、手牌、行动条都是 flex 段；动效不要改这些段的尺寸，否则会推挤整屏。
- **两处 `backdrop-filter`**：顶栏 `blur(8px)`（`styles.css:137`）、模态背板 `blur(6px)`（`:339`）。这是持续的绘制成本，动画元素不要跑到它们背后。
- **渲染模型是全量重绘**：`renderGame()` 每次同步都重写 `#opponents` / `#hand` / `#selfPanel` / `#actionBar` 的 `innerHTML`（`app.js:679-766`），发牌区同样整段重写（`app.js:645-654`）。
- **SW 是 cache-first**：导航 network-first 并回写 `/`，其余命中 `/assets/`、`/icons/` 与白名单的走 cache-first（`apps/web/sw.js:39-75`）。

## 2. 四条动效路径：CSS / WAAPI / FLIP / View Transitions

### 2.1 适用面与控制力对照

| 方案 | 适合 | 可控性 | 取消/合并 | 本仓结论 |
|---|---|---|---|---|
| CSS transition | 常驻微交互：按下、高亮、颜色/透明度切换 | 只能靠切 class/内联值，读不到进度 | 过渡会「重定向」到新目标值，不能取消 | 用 |
| CSS @keyframes | 固定编排的一次性过场（现有翻牌、横幅） | 同上，`animationend` 是唯一回调 | `animation: none` 即取消，重播需强制 reflow | 用（仅一条路径的过场） |
| WAAPI | 需要读进度、播放速率、暂停/反向、按状态中途取消 | `Animation` 句柄：`play/pause/reverse/finish/cancel`、`playbackRate`、`currentTime`、`finished` promise | 句柄在手，天然可取消；`cancel()` 会让 `finished` 以 `AbortError` 拒绝，要 catch | 队列与可打断动效用它 |
| FLIP | 元素「同一身份、位置尺寸变了」的过渡 | 只是把布局变化重映射为 transform 的技术 | 与 WAAPI 同 | 少量用 |
| View Transitions | 页面/视图整体切换 | 由浏览器拍快照，样式通过 `::view-transition-*` 控制 | 同一刻只有一个活跃过渡，新调用会跳过旧的，不能当队列 | 不用 |

- WAAPI 被设计成 CSS Animations/Transitions 的底层实现，MDN 称之为「最有性能的 Web 动效方式之一，让浏览器自己做内部优化」（证据 B，[MDN: Using the WAAPI](https://developer.mozilla.org/en-US/docs/Web/API/Web_Animations_API/Using_the_Web_Animations_API)）。
- `commitStyles()` + `cancel()` 是「落地终态但不留 filling 动画」的正规写法（同上，「Persisting animation styles」一节，证据 B）：留着 `fill: "forwards"` 会一直压着样式优先级，也让合成层不释放。
- FLIP 的定位是「当你没法只动 transform/opacity 时，用它把昂贵属性的变化重映射成 transform/opacity 变化」（web.dev 原文即把 FLIP 作为该建议的兜底，证据 A，[web.dev: compositor-only properties](https://web.dev/articles/stick-to-compositor-only-properties-and-manage-layer-count)；技术原文见 [aerotwist: FLIP Your Animations](https://aerotwist.com/blog/flip-your-animations/)，证据 C）。
- View Transitions：MDN 页面标 **Baseline 2025 / 2025 年 10 月起跨最新浏览器可用**（证据 B，[MDN: startViewTransition](https://developer.mozilla.org/en-US/docs/Web/API/Document/startViewTransition)），规范是 [CSS View Transitions Level 1](https://drafts.csswg.org/css-view-transitions-1/)。`startViewTransition()` 先给当前页拍快照，再在回调里改 DOM，然后播放伪元素动画（证据 B）。它的代价是**整页快照**与**单活跃过渡**，与本仓「每次广播都可能重绘」的模型冲突。

### 2.2 本仓的裁决（D）

- 一条动效如果「必须能被下一个状态打断」，就用 WAAPI 并保存句柄；如果「一定会跑完且不需要读进度」，就用 CSS。
- 不要在同一个元素上同时用 CSS class 过场与 WAAPI 动画：一个在样式层、一个在动画层，优先级与取消语义会互相踩。
- 牌桌上的「翻身份卡」已有 CSS 实现且能自动被 reduced-motion 关掉，**保持现状**；新增的「夜晚结算序列」（多人同时动作）适合用 WAAPI 串一个可取消的队列。

## 3. 合成器友好属性与 `will-change` 的代价

- **只有 `transform` 与 `opacity` 可以只由合成器处理**：web.dev 原文「Today only two properties: `transform` and `opacity`」，其余属性会引入 layout 或 paint（证据 A，同链接）。前提是元素位于**自己的合成层**。
- 会触发布局/绘制的常见属性：`width/height/top/left/margin/padding`（布局）、`box-shadow`/`border-radius`（绘制）、`filter`/`backdrop-filter`（绘制，且可能每帧重算）、`background-position`（绘制）。本仓 `filter: grayscale(.6)` 的死亡座位（`styles.css:163`）属于绘制成本，别在它上面做像素级动画。
- `will-change`：
  - 「把它当最后一招来救已有的性能问题，别拿它预防问题」（MDN 原文：*"Use the `will-change` property as a last resort ... Don't use it to anticipate performance problems."*）。
  - 「不要给太多元素加」「用脚本在变化前后开关，而不是常驻样式表」——常驻会让浏览器长期保留优化。
  - 可能改变视觉：`will-change: opacity` 会**提前**创建层叠上下文（stacking context），`will-change: transform` 会创建包含块，影响 `position: fixed` 后代。
  - 证据 B，[MDN: will-change](https://developer.mozilla.org/en-US/docs/Web/CSS/Reference/Properties/will-change)。
- 层不是免费：每层都要内存、要把纹理传到 GPU；web.dev 明确「不要无谓提升元素」，并给出合成阶段 4–5 ms 的目标（证据 A）。
- **本仓用法（D）**：只在「一次会持续 >300ms 且肉眼可见」「元素在动之前有 1 帧余量」时才在动画前加 `will-change: transform`，`animation.finished`/`transitionend`（或 setTimeout 兜底）后移除；不做 `* { will-change: transform }` 这类全局提层。

## 4. 主线程、帧预算与并发（30/60fps 判据）

- **长任务定义**：web.dev 原文「任何耗时超过 50 毫秒的任务都是长任务」，长任务期间浏览器无法响应用户输入（证据 A，[web.dev: 优化耗时长任务](https://web.dev/articles/optimize-long-tasks)）。
- **帧预算**：60Hz 屏幕每帧 16.7ms、30Hz 33.3ms（算术 C）；RAIL 建议留 10ms 给「样式→布局→绘制→合成」这一整段（证据 B，[web.dev: RAIL](https://web.dev/articles/rail)）。
- **本仓的主线程风险点**：`renderGame()` 每次广播都整段重写 4 个容器的 `innerHTML` 并重新解码/布局图片（`app.js:679-766`），12 人房一次公开事件就是一次全量重建。这在低端 Android 上很容易越过 50ms；再叠加 rAF 驱动的 JS 动效就会直接掉帧。
- **判据（D，写进验收）**：
  1. 动画期间用 rAF 采样帧间隔，**p90 ≤ 25ms** 视为 60fps 可用；p90 在 25–40ms 之间按 30fps 交付；>40ms 视为不可用。
  2. 同一次动画期间 `longtask` 条目数为 0；出现即回退到「无动画 + 状态直出」。
  3. 只在目标机型（中低端 Android 一台、iPhone SE2 级别一台）上验收，不用桌面模拟器结论。
- **并发数量**：规范没有上限。可执行的本仓规则见结论 7；依据是层内存与合成时间，不是标准条文（D）。翻 12 张小牌（60×90 CSS px）本身的纹理很小，真正的成本在 `box-shadow`、圆角裁剪与 3D 变换叠加，不在像素数量（C）。
- **不要在动画期间读布局**：`getBoundingClientRect()` 会强制同步布局；要在动画开始前一次性读完缓存。

## 5. `prefers-reduced-motion` 的语义与实现注意

- 语义（MDN 原文）：「用于检测用户是否在设备上启用了**把非必要运动降到最低**的设置；该设置向浏览器传达：用户偏好一个**移除、减少或替换**基于运动的动画的界面」，触发不适的是「缩放、平移大物体」这类前庭刺激（证据 B，[MDN: prefers-reduced-motion](https://developer.mozilla.org/en-US/docs/Web/CSS/Reference/At-rules/@media/prefers-reduced-motion)）。规范定义在 [Media Queries Level 5](https://drafts.csswg.org/mediaqueries-5/#prefers-reduced-motion)；取值只有 `no-preference` / `reduce`，且 `@media (prefers-reduced-motion)` 等价于 `: reduce`（证据 B）。
- Baseline：2020 年 1 月起跨浏览器可用（MDN 页面声明，证据 B）。iOS「设置 > 辅助功能 > 动态效果」与 Android 9+「移除动画」都会驱动它（同上）。
- 实现注意：
  1. **「减少」不等于「消失」**：优先把位移动画降级成透明度变化（MDN 示例就是把 `scale` 脉冲换成 `opacity` 溶解），其次才是瞬时到位。
  2. **不要用事件驱动状态机**：`transition: none` / `animation: none` 之后 `transitionend`/`animationend` 不会触发，控制流会挂住。本仓当前没有这类监听（grep 无命中），保持这个约束。
  3. **JS 路径要自己判**：`window.matchMedia("(prefers-reduced-motion: reduce)")`，并 `addEventListener("change", ...)`；WAAPI 分支不能只靠 CSS 兜底。
  4. **只影响「非必要」运动**：加载中/连接状态这类必要反馈可以用静态提示，但不能因为 reduced-motion 就什么都不显示。
  5. **不存在 `prefers-reduced-sound`**：声音必须有自己的开关（见 §7.4）。

## 6. iOS Safari 与 Android Chrome 的关键差异

| 维度 | iOS Safari（含主屏 PWA） | Android Chrome | 证据 |
|---|---|---|---|
| 媒体自动播放 | 必须用户手势；iOS 10 起无音轨/静音 `<video>` 可自动播 | 同规则，另有 Media Engagement Index 允许名单 | A（[WebKit 2016](https://webkit.org/blog/6784/new-video-policies-for-ios/)）/ B（[MDN Autoplay](https://developer.mozilla.org/en-US/docs/Web/Media/Guides/Autoplay)） |
| 手势的定义 | 必须由 `touchend`/`click`/`doubleclick`/`keydown` 处理器**直接**导致；`canplaythrough` 回调里调 `play()` 不算 | 同类 user activation 规则 | A（WebKit 原文） |
| Web Audio | 上下文在手势前创建为 `suspended`，必须在手势里 `resume()`；来电/切后台会中断 | 同（Chrome 66 起的自动播放策略） | B（MDN AudioContext / Autoplay 指南） |
| 静音开关 | 硬件静音开关会压制输出，网页无法可靠检测当前是否静音 | 无此硬件概念 | C/D（社区一致，无规范） |
| Vibration API | **不支持** | 支持，但需要 sticky user activation；静音/DND 下可能不震 | B（[MDN: vibrate](https://developer.mozilla.org/en-US/docs/Web/API/Navigator/vibrate) 标 "Limited availability"，页面明确「Sticky user activation is required」） |
| Visual Viewport / 全屏 | `100dvh` 可用；主屏模式没有浏览器 UI，安全区靠 `env(safe-area-inset-*)`（本仓已用） | 同 | C |
| View Transitions | Safari 18 起同文档可用（Baseline 2025 覆盖） | Chrome 111 起 | B |
| PWA 主屏 | 无 `beforeinstallprompt`；`manifest.display` 生效但安装入口在分享菜单 | 有安装提示与 `beforeinstallprompt` | C |

- 主屏（standalone）模式**不解除**音频手势限制；它只是没有地址栏。音频策略与普通 Safari 标签页一致（C）。
- iOS 主屏模式下的音频会话中断（来电、锁屏）不会给网页明显事件；回来后要检查 `ctx.state !== "running"` 再 `resume()`（D，需真机验证）。
- Android Chrome 的 `backdrop-filter` 与 `filter` 在低端 GPU 上更贵；本仓顶栏 `blur(8px)` 是常驻成本（C）。

## 7. Web Audio：解锁、状态、格式、sprite、淡入淡出

### 7.1 解锁与状态机

- 规则（证据 A/B）：
  - 在用户手势**之前**创建的 `AudioContext` 处于 `suspended`；在手势里调用 `resume()`（返回 Promise）才能进入 `running`。
  - WebKit 对手势的要求是「直接由处理器导致」，所以**先同步 `resume()`，再 `await` 拉音频文件**；反过来会丢手势（A，WebKit 原文同上）。
  - 状态只有 `suspended` / `running` / `closed`（标准值）；Safari 历史上还出现过非标准的中断态，稳妥判断是 `if (ctx.state !== "running") await ctx.resume()`（C）。
  - 页面 `visibilitychange` → 隐藏时 `suspend()`，可见时**不要**自动 `resume()`（无手势可能被拒），等下一次真实点击再恢复（D）。
- 本仓的天然手势点：建房/加入房间按钮、发牌页的「点开」、行动按钮。建议只在**第一次真实点击**时创建并解锁，之后复用同一个 context。

### 7.2 解码与内存

- `decodeAudioData()` 把整段音频解成 PCM `AudioBuffer`：内存 = 采样率 × 声道数 × 时长 × 4 字节（float32）（算术 C）。
  - 44.1k 立体声 1 秒 = 352.8KB；22.05k 单声道 1 秒 = 86.1KB；22.05k 单声道 10 秒 = 844KB。
  - 对比压缩体积：64kbps 的 10 秒文件只有 ~80KB，但解码后 ~844KB——**内存是压缩体积的 10 倍量级**，这是 sprite 设计的主要约束。
- 解码在主线程之外由浏览器完成，但 `decodeAudioData` 的 Promise 解析时机不可控；首帧音效建议「解锁时预解码全部 ≤1s 音效」，环境垫按需再解码（D）。

### 7.3 格式、码率与体积

- 跨 iOS/Android 最稳的是 **AAC（.m4a）与 MP3**；Ogg/Vorbis 在 Safari 上长期不可用，Opus 的容器支持随版本变化，**不要把它写进硬依赖**（C/D，见开放问题 3）。来源：[MDN 音频编解码器指南](https://developer.mozilla.org/en-US/docs/Web/Media/Guides/Formats/Audio_codecs)（B，编解码器支持随浏览器而异）。
- 牌桌音效的参数裁决（D）：单声道、22.05kHz、AAC 64–96kbps；单条 ≤120ms；总音效预算 ≤150KB；环境垫 8–12s 循环、≤400KB。
- 算术（C）：64kbps ≈ 8KB/s，96kbps ≈ 12KB/s，128kbps ≈ 16KB/s。8 秒环境垫 @64kbps ≈ 64KB。

### 7.4 audio sprite

- 做法：把若干 ≤1s 音效首尾相接成一个文件，播放时用 `AudioBufferSourceNode.start(when, offset, duration)` 指定起点与时长（证据 A，[MDN: AudioBufferSourceNode.start](https://developer.mozilla.org/en-US/docs/Web/API/AudioBufferSourceNode/start)）。
- 收益：一次请求、一次解码、一份 PCM；缺点：整段 PCM 常驻内存，且没法只解码其中一条。
- 本仓裁决（D）：一个 sprite 装「翻牌、出牌、抽牌、点击、错误」五条 ≤1s 音效，22.05k 单声道，总长 ≤6s（≈529KB 内存）；环境垫单独一个文件，不进 sprite。

### 7.5 淡入淡出与循环

- `AudioBufferSourceNode` **没有** `volume` 属性；音量与淡变全部走 `GainNode`（证据 A/B）。
- 淡入：`gain.gain.setValueAtTime(0, now); gain.gain.linearRampToValueAtTime(1, now + 0.4)`；淡出反向。避免「爆音」的常见做法是从一个极小值（如 0.0001）指数逼近，而不是 0。
- 循环：`source.loop = true`（A）；切换场景用两条 source 交叉淡化——旧的淡出 0.6s 后 `stop()`，新的同时淡入（D）。
- 环境垫要「无缝」，循环点必须在素材里处理（人工试听），不能靠代码猜（D）。

### 7.6 未做（明确不做）

- 不做 `<audio>` 元素播放音效：多实例、延迟不可控、播放语义比 `AudioBufferSourceNode` 差（D）。
- 不做音频可视化（AnalyserNode）：与玩法无关，且每帧 FFT 是主线程成本（D）。

## 8. PWA：`VERSION` 与预缓存清单的风险

- 现行机制（代码事实 C）：
  - `const VERSION = "salem-v11"`（`apps/web/sw.js:10`），`SHELL` 里 13 个文件（`:11-25`）。
  - `install`：`caches.open(VERSION).then(c => c.addAll(SHELL)).then(() => self.skipWaiting())`（`:27-29`）。
  - `activate`：删掉所有非当前 `VERSION` 的缓存并 `clients.claim()`（`:31-37`）。
  - `fetch`：导航 network-first 并回写 `/`；`/assets/`、`/icons/` 与白名单走 cache-first（`:39-75`）。
- 一手依据（A）：`Cache.addAll()` 在任一响应非 2xx（或跨源 no-cors 导致 status 0）时抛 `TypeError`，整批不落地（[MDN: Cache.addAll](https://developer.mozilla.org/en-US/docs/Web/API/Cache/addAll)）。`install` 里 `waitUntil` 的 Promise 拒绝 ⇒ 安装失败 ⇒ **旧 SW 继续服务、新版本永不激活**。
- 因此（D）：
  1. 音频、大图、任何非必需资源**不进 `SHELL`**；它们依赖 `/assets/` 前缀的 cache-on-demand（`sw.js:59`）。
  2. 新增 `motion.js` / `audio.js` 这类模块必须同时改三处：`VERSION`、`SHELL`、`:59-61` 的 `cacheable` 白名单。漏白名单 → 在线可用、离线 404；漏 `VERSION` → 已装客户端永远跑旧码。
  3. `SHELL` 里不要出现重复 URL：同一批 `addAll` 内部互相覆盖会失败（MDN 同页注记）。
  4. 升 `VERSION` 会清掉旧缓存，包括按需缓存的 `/assets/` 音频与卡面 JSON；升版后第一次播放要联网，属于可接受代价。
- **版本撕裂（本仓特有，证据 C/D）**：导航是 network-first（`sw.js:46-57`），而脚本是 cache-first（`:64-75`）。部署瞬间的一次加载可能拿到「新 `index.html` + 旧缓存里的 `app.js`」——新增 DOM 节点而旧脚本没有对应处理器。`skipWaiting` + `clients.claim` 只保证下一次导航拿新码，不保证当前这次一致。缓解：HTML 变更保持向后兼容（新节点默认隐藏、旧脚本忽略未知节点），并在 `controllerchange` 时提示/自动 reload。

## 9. 本仓会踩的坑（按出现概率排序）

1. **`innerHTML` 全量重绘会杀掉 WAAPI 句柄。** `renderGame()` 每次同步重建 `#opponents`/`#hand`/`#selfPanel`（`app.js:679-766`），旧节点上的 `Animation` 变成 detached，`finished` 永不解析，`getAnimations()` 也查不到。动效必须「渲染后按状态差异触发」（`flip-in` 的 `fresh` 判断就是现成范式，`app.js:545`），不能「先起动画等 DOM 自己变」。
2. **FLIP 的「变化前坐标」在重绘后取不到。** 必须先 `getBoundingClientRect()` 存进 `S`，再触发重绘，再在下一帧读新坐标。本仓没有这个缓存层，直接写 FLIP 会拿到同一份布局两次。
3. **reduced-motion 下别依赖动画结束事件。** 现有兜底把 `transition`/`animation` 设为 `none`（`styles.css:226-229`、`:250-252`），事件不会触发。新动效沿用「终态由类保证、动画只是过场」的约定——现有 `.trial-card.revealed .trial-inner { transform: rotateY(180deg) }`（`:219`）正是这个写法，不要改成「动画结束再加 `revealed`」。
4. **`VERSION` + `SHELL` + `cacheable` 三处漏改。** 典型症状：开发机正常、已装 PWA 的用户永远旧界面；或离线打开时新模块 404。见 §8。
5. **把音频塞进 `SHELL` 会让整个 PWA 装不上。** `cache.addAll` 任一 404 即整体 `TypeError`（证据 A），安装失败后用户停在旧版本，且没有任何提示。
6. **`backdrop-filter` 上方/背后不要叠动画。** 顶栏 `blur(8px)`（`styles.css:137`）与模态背板 `blur(6px)`（`:339`）每帧都要重新模糊其背后内容；把翻牌或环境光效放到它们下面，等于每帧多做一次模糊。
7. **3D 与裁剪不能放同一节点。** `.trial-card` 有 `overflow: hidden`（`styles.css:207`），`preserve-3d` 在子层 `.trial-inner`（`:212-215`）——这个分层是必要的；把 `transform-style: preserve-3d` 与 `overflow: hidden` 写在同一元素会被强制扁平化（C，需真机复核 Safari 表现）。`-webkit-backface-visibility` 已带（`:216`），新增 3D 元素照抄。
8. **`filter: grayscale(.6)` 的死亡座位（`styles.css:163`）不是廉价元素。** 在它上面叠加 `opacity` 动画可以，但别叠加 `box-shadow`/`transform` 的连续变化，否则每帧重绘。
9. **iOS 解锁顺序写反。** 在 `click` 处理器里先 `await fetch(audio)` 再 `resume()`，Safari 会认为手势已消费而拒绝启动（证据 A）。必须先同步创建/恢复，再异步加载。
10. **把震动/声音当信息通道。** `navigator.vibrate` 在 iOS 不存在（B）、在 Android 需要 sticky activation；iOS 静音开关会掐掉声音且无法检测。夜晚提示、翻牌结果必须有视觉呈现。
11. **固定时长定时器与动画时长脱钩。** 横幅自动收起用的是固定 `setTimeout`（`app.js:1033`；toast 同理 `app.js:98` 的 3200ms），一旦把入场动画从 0.28s 拉长或改成 WAAPI，收起时机就会与动画错位；要么绑定 `animation.finished`，要么把时长抽成常量。
12. **后台回来不重试 `resume()`。** 房间 TTL 是 2 小时，长时间挂机后 `AudioContext` 常已中断；不检查 `ctx.state` 就会出现「后面所有音效静音」。

## 开放问题

1. 本仓 3D 翻牌在中低端 Android 与 iPhone SE2 级别的真实帧率分布（需要真机 Performance 面板采样，文档无法回答）。
2. iOS 硬件静音开关对 Web Audio 的确切行为（不同 iOS 版本、主屏模式）——只有社区一致报告，没有规范条文。
3. 当前 iOS Safari 版本对 Ogg/Opus（及各容器）的解码边界；决定能否用单一 Opus 资源省体积。
4. 目标机群（尤其微信内嵌浏览器、国内 Android WebView）首次 `AudioContext.resume()` 的成功率与延迟。
5. `AudioContext` 在 iOS 主屏模式下被来电/锁屏打断后的恢复行为，是否需要「重新解锁」UI。
6. 环境垫循环点的无缝性只能人工试听验收，无法用文档或自动化判定。
7. View Transitions 的跨文档变体（Level 2）在 iOS 的落地时间，若落地是否值得用于「建房页 → 牌桌」的唯一一次跳转。

## 来源

- web.dev：只使用合成器属性并管理层数量（「只有 `transform` 与 `opacity`」、层的内存与合成 4–5ms 目标、FLIP 作兜底）：https://web.dev/articles/stick-to-compositor-only-properties-and-manage-layer-count
- web.dev：优化耗时较长的任务（「任何超过 50 毫秒的任务都是长任务」）：https://web.dev/articles/optimize-long-tasks
- web.dev：RAIL 模型（每帧 10ms 预算）：https://web.dev/articles/rail
- MDN：Using the Web Animations API（WAAPI 是 CSS 动画/过渡的底层、`commitStyles` 持久化）：https://developer.mozilla.org/en-US/docs/Web/API/Web_Animations_API/Using_the_Web_Animations_API
- MDN：`Document.startViewTransition()`（同文档过渡、Baseline 2025）：https://developer.mozilla.org/en-US/docs/Web/API/Document/startViewTransition
- CSS View Transitions Level 1（W3C 草案）：https://drafts.csswg.org/css-view-transitions-1/
- MDN：`will-change`（「last resort」、过量代价、层叠上下文副作用）：https://developer.mozilla.org/en-US/docs/Web/CSS/Reference/Properties/will-change
- MDN：`prefers-reduced-motion`（语义原文、取值、各平台设置入口、Baseline 2020）：https://developer.mozilla.org/en-US/docs/Web/CSS/Reference/At-rules/@media/prefers-reduced-motion
- Media Queries Level 5（`prefers-reduced-motion` 规范）：https://drafts.csswg.org/mediaqueries-5/#prefers-reduced-motion
- MDN：Autoplay guide（自动播放可用条件、`Navigator.getAutoplayPolicy`、Web Audio 分支）：https://developer.mozilla.org/en-US/docs/Web/Media/Guides/Autoplay
- WebKit：New `<video>` Policies for iOS（手势必须是 `touchend`/`click`/`doubleclick`/`keydown` 直接导致）：https://webkit.org/blog/6784/new-video-policies-for-ios/
- Chrome：Autoplay policy（Chrome 66 起的音频/上下文策略，MDN 同页引用）：https://developer.chrome.com/blog/autoplay/
- MDN：`Navigator.vibrate()`（"Limited availability"、sticky user activation、静音/DND 不震）：https://developer.mozilla.org/en-US/docs/Web/API/Navigator/vibrate
- MDN：`Cache.addAll()`（任一非 2xx 抛 `TypeError`、同批重复 URL 失败、install 示例）：https://developer.mozilla.org/en-US/docs/Web/API/Cache/addAll
- MDN：`AudioBufferSourceNode.start()`（`when`/`offset`/`duration` 语义，audio sprite 的依据）：https://developer.mozilla.org/en-US/docs/Web/API/AudioBufferSourceNode/start
- MDN：音频编解码器指南（编解码器支持随浏览器而异）：https://developer.mozilla.org/en-US/docs/Web/Media/Guides/Formats/Audio_codecs
- aerotwist：FLIP Your Animations（FLIP 技术原文，证据 C）：https://aerotwist.com/blog/flip-your-animations/
