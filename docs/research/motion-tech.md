# 移动 Web 动效与音频技术事实（R1 / #41）

> 状态：research 完成。约束本仓现状调研时的形态：**零构建、原生 ESM、service worker 预缓存、移动优先 390×844、深色羊皮纸 UI**。
> 证据等级：**A** = 规范/MDN 或浏览器官方文档原文；**B** = 官方兼容数据（MDN browser-compat-data）；**C** = 多方实现一致的工程共识；**D** = 本票为《女巫镇》做的裁决，落地时必须写进测试。
> 每条只写「可执行结论 + 来源」，不复述教程。

## 0 一句话结论

**动画全部走 CSS transition / WAAPI + transform/opacity，用 WAAPI 统一时间轴；View Transitions 只在相位切换用且必须可 `skipTransition`；触觉在 iOS 完全不可用、只能当增强；音频只能在用户手势里解锁、用 audio sprite 控体积；改任何被缓存资源都必须升 `sw.js` 的 `VERSION`。**

## 1 动画技术选型

### 1.1 CSS transition / animation
- 结论：定长、单元素、无编排需求（按钮按下、选中态、卡片翻转）一律用 CSS。浏览器可以直接把它交给合成器，不进主线程。
- 反例：`animation-delay` 只能表达固定相对顺序，碰到「上一条播完再决定下一条」的队列就得回到 JS。
- 来源：[MDN CSS animations](https://developer.mozilla.org/en-US/docs/Web/CSS/CSS_animations/Using_CSS_animations)

### 1.2 Web Animations API（`element.animate`）
- 结论：需要**统一时间轴、可暂停/可取消/可倍速、跑完要读终态**时用它。它返回 `Animation` 对象，`pause()` / `cancel()` / `finish()` / `playbackRate` / `finished` 都是协议的一部分，这正是「所有演出可跳过」要求的落点。
- 结论：`commitStyles()` 可以把动画终态写回 inline style，配合 `cancel()` 一起用，避免动画结束后元素跳回起点。
- 来源：[MDN Using the Web Animations API](https://developer.mozilla.org/en-US/docs/Web/API/Web_Animations_API/Using_the_Web_Animations_API)

### 1.3 FLIP（First–Last–Invert–Play）
- 结论：元素**位置/尺寸发生变化但仍是同一个 DOM 节点**时（座位卡换位、手牌增删、桌面上卡片挪位）用 FLIP：读 First 的 `getBoundingClientRect()` → 改 DOM → 读 Last → 用 `transform: translate(dx,dy) scale(...)` 把它「倒回」原位 → 下一帧去掉 transform 让浏览器补间。
- 结论：关键是**批量读、批量写**，不要 read-write-read-write 交替，否则每步都强制同步布局。
- 属技术而非规范，来源：[aerotwist: FLIP your animations](https://aerotwist.com/blog/flip-your-animations/)

### 1.4 View Transitions API
- 结论（B）：同文档（SPA）视图过渡已达基线——`document.startViewTransition()` 在 **Chrome/Edge 111+、Firefox 144+、Safari 18+（含 iOS Safari）** 可用，可作为相位切换的快照过渡手段，且 `drop` 掉旧快照的过渡动画比手写 FLIP 省事。
- 结论（B）：**不能依赖** `viewTransition.transitionRoot`（element-scoped，仅 Chrome 147+，Firefox/Safari 明确 `false`）与 `waitUntil`（仅 Chrome 144+）。
- 结论（B）：`ViewTransition.types` 与 `:active-view-transition-type()` 在 Chrome 125+ / Firefox 147+ / Safari 18.2+ 才齐，给不同过渡配样式前要特性检测。
- 结论（C）：过渡进行中页面会有一层快照 overlay，**屏幕阅读器会同时看到新旧两份内容**，这是它的固有代价；对局内高频状态变化不要用它，只在相位切换用。
- 来源：[MDN View Transition API](https://developer.mozilla.org/en-US/docs/Web/API/View_Transition_API)、[MDN browser-compat-data · ViewTransition.json](https://github.com/mdn/browser-compat-data/blob/main/api/ViewTransition.json)

### 1.5 裁决（D）
- 单元素微交互 → CSS；需要编排/可跳过/可回滚 → WAAPI；同节点位移 → FLIP；相位切换 → View Transitions（带 `if (!document.startViewTransition) { 直接渲染; }` 兜底 + 首次进入不算过渡）。
- **不引入任何第三方动画库**（地图 #27 已否决），也不引入 three.js 之类渲染引擎。

## 2 性能边界

### 2.1 只动合成器属性
- 结论：只动 `transform` 与 `opacity` 才是「合成器独占」的动画；动 `width/height/top/left/margin/padding/border-width/box-shadow/filter` 会触发布局或重绘，帧预算立刻吃紧。
- 结论：`filter: blur()` 在移动端尤其贵，宁可预烘焙成图。
- 来源：[MDN CSS transform](https://developer.mozilla.org/en-US/docs/Web/CSS/transform)、[High Performance Animations](https://web.dev/articles/animations-guide)

### 2.2 `will-change`
- 结论：`will-change: transform` 要在**动画开始前加、结束后立刻移除**，长期挂在多个元素上会让合成器保留大量图层，移动端显存直接爆掉。
- 结论：一屏同时 `will-change` 的元素控制在个位数。
- 来源：[MDN will-change](https://developer.mozilla.org/en-US/docs/Web/CSS/will-change)

### 2.3 主线程长任务
- 结论：单次任务 >50ms 即 Long Task，会掉帧；用 `PerformanceObserver({entryTypes:['longtask']})` 量它。
- 结论：`renderGame()` 每次全量替换 innerHTML 本身就是一次大重排，动画必须**在渲染完成之后**用 `requestAnimationFrame` 起，否则首帧就撞上渲染。
- 来源：[MDN Long Tasks API](https://developer.mozilla.org/en-US/docs/Web/API/PerformanceLongTaskTiming)、[MDN PerformanceObserver](https://developer.mozilla.org/en-US/docs/Web/API/PerformanceObserver)

### 2.4 30fps 判据
- 结论（D）：低端 Android 上以「连续 120 帧窗口内 ≥80% 帧间隔 ≤33.4ms」为 30fps 通过线；量法用 `requestAnimationFrame` 时间戳差值统计，不靠人眼看。

## 3 无障碍

- 结论：`@media (prefers-reduced-motion: reduce)` 必须关掉**位移/缩放/视差**，允许保留纯 `opacity` 淡入淡出（不引起前庭反应）。
- 结论：动画不能是唯一的信息通道——翻牌结果必须同时有文字横幅与日志（本仓 `#revealBanner` + `revealLogText` 已是此模式）。
- 结论：`aria-live="polite"` 只给一次性结果播报，不要给每帧变化的状态，否则读屏器会被淹。
- 来源：[MDN prefers-reduced-motion](https://developer.mozilla.org/en-US/docs/Web/CSS/@media/prefers-reduced-motion)

## 4 平台差异（iOS Safari / Android Chrome）

- 结论：iOS 上所有浏览器共用 WebKit；`100vh` 行为不稳定，用 `dvh`（Safari 15.4+）。
- 结论：iOS 上 `background-attachment: fixed` 会掉帧，改用 `fixed` 定位层。
- 结论：iOS 对合成层的纹理尺寸有上限，超大元素加 `transform` 会糊或直接不合成。
- 结论：Android Chrome 的 `will-change` 更宽容，但低端机的 GPU 内存同样紧张。
- 来源：[MDN Browser compatibility](https://developer.mozilla.org/en-US/docs/Web/API)、[WebKit blog: Motion](https://webkit.org/blog/)

## 5 触觉（Vibration API）

- 结论（A）：**Safari / iOS Safari 从未实现 `navigator.vibrate`**；MDN 对本特性标注「Limited availability — 非 Baseline，因为最常用的浏览器里有不支持者」。→ iOS 上触觉**完全不可用**，只能当纯增强，必须 `typeof navigator.vibrate === "function"` 检测后静默跳过。
- 结论（A）：`navigator.vibrate(pattern)` 的数组参数是「振-停-振」交替的毫秒序列；`0` / 空数组 / 全零可取消。
- 结论（C）：Android 上振动由系统/浏览器策略限制，页面在后台或用户开了省电模式时会被吞掉，不能当必达信号。
- 来源：[MDN Vibration API](https://developer.mozilla.org/en-US/docs/Web/API/Vibration_API)

## 6 音频

### 6.1 解锁
- 结论（A）：`AudioContext` 在没有用户手势时创建会处于 `suspended`；必须在**用户手势的同步调用栈内** `resume()`，异步 `await` 之后再 `resume()` 会被判定为无手势。
- 结论（A）：iOS Safari 更严，首个 `AudioBufferSourceNode.start()` 也要在同一个手势栈里。
- 结论（D）：本仓把「首次任意 pointerdown/keydown」作为统一解锁点，解锁前所有音效请求进队列丢弃（不补播，避免一次性炸响）。
- 来源：[MDN AudioContext](https://developer.mozilla.org/en-US/docs/Web/API/AudioContext)、[Chrome autoplay policy](https://developer.chrome.com/blog/autoplay)

### 6.2 格式与体积
- 结论（B）：跨 iOS/Android 都稳的只有 **AAC（.m4a）与 MP3**；Ogg Vorbis 在 iOS 不支持，Opus 在 Safari 需 18+ 且容器受限。
- 结论（D）：短音效统一 **单声道 44.1kHz AAC 96kbps**，0.2s 的音效约 3KB；音效包总预算 **≤300KB**。
- 结论（D）：不做 BGM（地图 #27 已定），环境垫用 15–30s 可循环片段，体积 ≤120KB。

### 6.3 audio sprite
- 结论：把多个短音效拼成一张 sprite，用 `AudioBufferSourceNode.start(when, offset, duration)` 切片播放，能把 N 次请求压成 1 次、解码一次复用。
- 结论：代价是**整张 sprite 必须一次解码进内存**（未压缩 PCM：44.1k×单声道×秒数×2 字节），30s 的 sprite ≈ 2.6MB 内存；只在音效总数 >8 且总时长 <20s 时才划算。
- 结论（D）：本仓音效总数预计 6–10 个、总时长 <6s，**值得做 sprite**；环境垫单独一个文件循环播，不拼进去。
- 来源：[MDN AudioBufferSourceNode.start](https://developer.mozilla.org/en-US/docs/Web/API/AudioBufferSourceNode/start)、[MDN Web Audio API best practices](https://developer.mozilla.org/en-US/docs/Web/API/Web_Audio_API/Best_practices)

### 6.4 响度
- 结论（C）：短音效统一归一化到 **-16 LUFS 左右**、峰值 ≤-1 dBTP；否则翻牌音效会盖过对话与提示。
- 结论（D）：游戏内三档「全开/减弱/关」中，减弱 = 音效 ×0.4 + 环境垫 ×0.25，关 = 全部 `gain=0` 且停止调度。

## 7 PWA 缓存与版本

- 结论（A）：service worker 的 `install` 阶段 `cache.addAll()` 预缓存列表一旦命中旧缓存就永远发旧文件，**唯一可靠的失效手段是改 cache key（本仓即 `VERSION` 常量）并 `activate` 时删旧 cache**。
- 结论（D）：本仓 `sw.js` 的 `VERSION` 是手动递增的 `salem-vN`，**任何被 SHELL 预缓存的文件改动都必须升 N**，包括纯 CSS；`apps/web/test/deal-shell.test.js` 与 `reveal-shell.test.js` 已对字面量做断言，升版本必须同步改测试。
- 结论（D）：音频文件体积大，**不进 SHELL 预缓存**，改为首次播放时 `fetch` + `Cache.put` 懒缓存，避免安装阶段拖慢。
- 来源：[MDN Service Worker API](https://developer.mozilla.org/en-US/docs/Web/API/Service_Worker_API)、[MDN CacheStorage](https://developer.mozilla.org/en-US/docs/Web/API/CacheStorage)

## 8 对本仓的直接裁决（可执行结论汇总）

| 主题 | 裁决 | 依据 |
| --- | --- | --- |
| 动画引擎 | CSS transition 为主，WAAPI 做编排与「可跳过」，禁止第三方库 | §1.1 §1.2 §1.5 |
| 相位切换 | 可用 View Transitions，必须特性检测 + 可 `skipTransition` + 首次进入不算 | §1.4 |
| 可动属性 | 只允许 `transform` / `opacity`；`filter` 需预烘焙 | §2.1 |
| `will-change` | 动画前加、`finished` 后移除，同屏 ≤8 个 | §2.2 |
| 起播时机 | 必须等本轮 `renderGame()` 完成，在 `requestAnimationFrame` 内起 | §2.3 |
| 帧率判据 | 120 帧窗口内 ≥80% 帧间隔 ≤33.4ms | §2.4 |
| 降级 | `prefers-reduced-motion: reduce` 关位移/缩放，保留 opacity | §3 |
| 触觉 | iOS 不可用；仅 `navigator.vibrate` 存在时触发，失败静默 | §5 |
| 音频解锁 | 首个 pointerdown/keydown 同步栈内 `resume()`；解锁前请求丢弃不补播 | §6.1 |
| 音频格式 | AAC 单声道 44.1k 96kbps；音效包 ≤300KB；不做 BGM | §6.2 |
| audio sprite | 音效 6–10 个、总长 <6s 时做 sprite；环境垫独立文件 | §6.3 |
| 响度 | -16 LUFS、峰值 ≤-1 dBTP；减弱档 ×0.4 | §6.4 |
| 缓存 | 改任何 SHELL 文件必升 `sw.js` 的 `VERSION`；音频走懒缓存 | §7 |

## 9 未决与移交

- 具体事件→时长/曲线表属 G1（#29），本票不代定。
- 低端机阈值与实测数据属 G5（#36），本票只给判据与量法。
- 素材来源与授权属 R3（#32），本票只给格式与体积预算。
