# 事件音效与环境音的来源、许可与体积/响度裁决

> 状态：research 完成（票 R3 / deck #32）。回答「本仓可用的 CC0/免费可商用事件音效与环境音从哪来、怎么登记授权、怎么控制体积与响度」。
> 基线：2026-11-08 抓取的官方许可页与 MDN 文档；载体是本仓现有的零构建原生 ESM H5/PWA（`apps/web/`）。仓内**目前零音频**：全仓 `*.mp3/*.ogg/*.wav/*.m4a/*.aac/*.webm` 无命中、`apps/web/` 无 `AudioContext` 用法，`README.md:92` 写明「正式美术、音效、埋点与上线合规未做」。
> 证据等级：**A** = 标准/站点官方条款原文（许可页、FAQ、WebKit 官方博客、MDN 的规范引用）；**B** = MDN 文档；**C** = 多方一致、代码事实或可直接推导的算术；**D** = 未取到一手来源，本仓为实现做的裁决，必须写进测试或运行时兜底。**本仓无任何音频素材，所以本篇所有「候选」都还没有下载动作，许可结论一律指「该渠道的默认条款」，具体条目必须在下载时逐条登记。**
>
> **与既有笔记的关系**：`motion-tech.md` 已经把浏览器侧技术事实定成裁决（手势解锁顺序、AAC/MP3 取舍、audio sprite、解码内存、`sw.js` 三处闸门、`prefers-reduced-sound` 不存在），`motion-references.md` 已把「声音不能承载信息、禁止 per-seat 音效与按角色不同的音效」定成设计约束，`asset-manifest.md` 只清点图片与卡面（全文**无一条音频**，第 5 节「缺口」第 7 条只提到图片授权）。**三篇都没回答：素材从哪来、许可怎么留证、响度与首批采购预算怎么定。本篇只补这三块，不重复它们的技术结论，只引用。**

## 0. 结论

1. **首批全部走 CC0，能免署名就不用要点名的渠道。** Kenney 的音频包在包页上直接标 `Creative Commons CC0`（`interface-sounds` 100 个文件、`ui-audio` 50 个文件、`rpg-audio` 50 个文件），CC0 的语义是「可以商用、可以改、不需要署名」（A；OGA FAQ 的 CC0 摘要原文同义）。**本仓首批 7 条素材建议 5 条 Kenney + 2 条 Freesound CC0。**
2. **Zapsplat 直接排除。** 它的免费 Basic 授权要求「必须给 ZapSplat 署名」，并且明文禁止「Redistribute our sounds in any form (e.g., sound libraries, file sharing, apps, social networks …)」以及「禁止用于训练 AI/ML 模型」；把 mp3 明文挂在 `/assets/` 下任何人可单独下载，与「不得再分发」存在解释冲突 → **高风险，非首选**（A，官方 Standard License 页）。
3. **Pixabay 不是 CC0，不能写「CC0」。** 它用的是自己的 Content License：免署名、可商用、可修改，但禁止「standalone 转售/分发」（原样再分发）；许可摘要页与 `legally binding` 的 `/service/terms/` 才是依据（A）。**只作为 Freesound 拿不到时的备选，且必须读条款页留档。**
4. **绝不抓预览音频。** OpenGameArt FAQ 原文：「A submission's preview images or preview audio clips may not fall under the same license as the submission's assets … Unless otherwise noted, assume the previews are 'All rights reserved'.」→ 只下条目附带的 zip/原始文件（A）。
5. **格式只做 MP3 单一容器。** MDN：MP3 全平台支持且专利已过期（EU 2012、US 2017-04-16）；AAC 在 Chromium 构建里缺席、Firefox 靠系统解码；Ogg/Vorbis 在 Safari 不支持，Opus 在 Safari 只有 CAF 容器可用（A/B）。→ **不产出 Ogg/WebM 作为主格式**，不为「省几 KB」赌 iOS（这条与 `motion-tech.md` 结论 10 一致，本篇不重开）。
6. **首批素材包：7 条，总预算 ≤500 KB。** 6 条短音效（各 ≤120 ms，mono 22.05 kHz/64–96 kbps，合计 ≈150 KB）+ 1 条夜晚环境垫（8–12 s 循环，stereo 44.1 kHz/128 kbps，≈150–200 KB）。音量/体积两头上限与 `motion-tech.md:134` 的裁决对齐（音效 ≤150 KB、环境垫 ≤400 KB），本篇只是把它落到「买哪几条、每条多少」的采购粒度（C/D）。
7. **响度分两套目标，别用同一个数。** 短音效（<1 s）测不出稳定的 integrated LUFS，**按峰值归一化到 −1 dBFS**；环境垫按 integrated ≈ **−23 LUFS**（EBU R128 的广播基准）、true peak ≤ −2 dBTP。R128 官方页本轮被 Cloudflare 拦（403），**数值按 C 级处理并列入开放问题**；可执行的是「环境垫比短音效低 12–18 dB」这条相对关系（D）。
8. **防刺耳/防削波靠三件小事**：短音效起音 3–5 ms 淡入、结尾 10–30 ms 淡出（避免波形截断的「啪」）、入库统一归一化后用 `GainNode` 做播放侧主音量；iOS 静音开关会掐掉声音且无法检测，所以**声音永远只是增强**（A/B，`motion-tech.md:24`、`:181`）。
9. **自动播放只有一个正确顺序**：在真实手势（`touchend`/`click`/`doubleclick`/`keydown`）的处理器里**先同步** `new AudioContext()` + `resume()`，**再** `await fetch(audio)`；WebKit 明确要求调用的 JavaScript「直接」由手势处理器导致，`canplaythrough` 回调里再 `play()` 不算（A，webkit.org/blog/6784；`motion-tech.md:19`、`:180`）。
10. **「静音开关能不能用 AudioSession 绕过」= 未确认。** Safari 16.4 起支持 AudioSession Web API 的子集（A，WebKit 发布说明原文 "Support for a subset of the AudioSession Web API"），MDN 也给出 `navigator.audioSession.type = "playback"` 的用法，但**没有任何官方文档承诺它能压过 iOS 硬件静音开关**；MDN 的 AudioSession 页还标着 Experimental / not Baseline。→ 本仓按「可能被静音开关吞掉」设计，不做依赖。
11. **音频绝不进 `SHELL`。** `cache.addAll()` 任一响应非 2xx 就整批抛 `TypeError`，`install` 失败 ⇒ 新版永不激活、用户永远旧码（A，MDN；`apps/web/sw.js:27-29`）。音频放 `/assets/audio/` 走 cache-on-demand（`sw.js:59-63` 的 `/assets/` 前缀已覆盖，**不需要改 `cacheable` 白名单**）。
12. **体积参照物**：现有 `SHELL` 十一个文本资源合计 ≈160 KB，图标 ≈26 KB，即首装 ≈186 KB；`assets/cards/zh` 已占 ≈43 MB（按需缓存，不在首装）。→ 首批 500 KB 音频若进 `SHELL` 等于把首装体积翻三倍多，进一步印证结论 11；按需加载下它对首屏的代价是 0，代价转移到「第一次播放要联网」。
13. **授权证据 = 一条素材一行登记 + 页面原文快照。** 最少字段见「## 授权登记模板」；Freesound 侧可以直接用站方的 attribution list 页导出（`https://freesound.org/home/attribution/`，A），Kenney/OGA 侧保存「包页截图 + 条目页许可徽标 + zip 内的 license 文件」。**没有登记行的素材不许进仓库。**

## 1. 来源与许可（以官方条款页为准）

### 1.1 渠道对照

| 渠道 | 许可名称 | 商用 | 修改 | 署名 | 留证方式 | 本仓结论 |
|---|---|---|---|---|---|---|
| Kenney | CC0 1.0（每个资产包页的 License 字段直接链到 `creativecommons.org/publicdomain/zero/1.0/`） | 允许 | 允许 | **不要求** | 包页 URL + 下载日期 + 包内 license 文件 | **首选** |
| Freesound | CC0 / CC-BY / CC-BY-NC 三档（按声音分别标） | CC0 允许；CC-BY 允许；NC 不可商用 | 允许 | CC0 不要求；CC-BY 要求 | 站方 attribution list 导出 + 声音页 URL | **CC0 首选备选，只取 CC0** |
| OpenGameArt | CC0 / CC-BY 3.0/4.0 / CC-BY-SA 3.0/4.0 / OGA-BY 3.0/4.0 / GPL 2.0/3.0 | 允许（多许可时择一遵守） | 允许 | CC0 不要求；CC-BY 要求且须标明是否修改 | 条目页许可徽标 + 作者 + 链接 | **可用，只取 CC0 条目** |
| Pixabay | Pixabay Content License（**不是 CC0**） | 允许 | 允许 | **不要求** | 许可摘要页 + `/service/terms/` 原文快照 | **备选，需读条款** |
| Zapsplat | Zapsplat Standard License（Basic 免费 / Premium 付费） | 允许（Basic 也允许商用） | 允许 | **Basic 必须署名 ZapSplat**，Premium 免 | 许可页 URL + 署名位置记录 | **排除（再分发与 AI 训练条款冲突）** |

### 1.2 逐条依据（原文要点）

- **Kenney**：`https://kenney.nl/assets/interface-sounds`（Files 100×、License = Creative Commons CC0、Released 2020）；`https://kenney.nl/assets/ui-audio`（Files 50×、License = CC0、Released 2012，页面自述「Download this package (50 assets) for free, CC0 licensed!」）；`https://kenney.nl/assets/rpg-audio`（Files 50×、CC0、Released 2014）。无署名要求（A）。
  - 坑：站方页脚仍是「Copyright © 2010 - 2026 · All rights reserved」，且页面 meta 带 `robots=noai, noimageai` 与 `tdm-reservation=1`——这限制的是**站点内容/文本的抓取与训练**，不改变资产 zip 的 CC0 状态；但意味着**不要脚本批量抓 kenney.nl 页面**，人工点下载（A/C）。
  - 下载流程是 JS 弹窗「跳过捐赠 → 签名链接」，本质上是人工操作，正好符合「人下载、人登记」的流程（C）。
- **Freesound**（`https://freesound.org/help/faq/`）：三档许可 CC0 / CC-BY / CC-BY-NC（旧的 Sampling+ 已停用）。CC0 原文：「you can do pretty much what you want with the sound. You could even sell the sound … but you can't claim you are the author!」；CC-BY 必须提到原始创作者。站方提供 attribution list 页导出已下载声音的署名清单。**下载必须登录（CC0 也要登录）** → 只能人工下载并登记，不能脚本抓（A）。
- **OpenGameArt**（`https://opengameart.org/content/faq`）：CC0 摘要「may be copied, modified, distributed, performed or otherwise used in anyway without asking, crediting or notifying the creating artist … commercial use is ok.」；CC-BY 要求「state that you have used the work and credit the original artist」并提供标题/作者/版权声明/许可声明/来源链接，**必须标明是否修改**；多许可并列时**只须遵守其中一个**，已获许可不可撤销；商用/闭源明确允许（"Short answer: Yes"）。预览音频条款见结论 4（A）。
  - 实测一条 CC0 候选：`https://opengameart.org/content/rpg-sound-pack`（作者 artisticdude，2011-05-19，95 个 WAV，zip `rpg_sound_pack.zip` 12.5 MB，Art Type = Sound Effect）。**该页的许可徽标本次未取到 → 许可「未确认」**，若采用必须回到条目页读 License 字段再登记（C）。
- **Pixabay**（`https://pixabay.com/service/license-summary/`，正文以 `/service/terms/` 为准）：允许「Use Content without having to attribute the author」、允许修改；Prohibited Uses 含「standalone 转售/分发（未施加创作努力、基本保持原样）」「含可识别商标/logo 的内容用于商品或服务」「不道德/违法/误导性使用」「作为商标/商号/服务标记」。有 `/sound-effects/` 与 `/music/` 频道（A）。
- **Zapsplat**（`https://www.zapsplat.com/license-type/standard-license/`，Last updated: 8th May 2026）：Basic 免费用户可用于「unlimited number of personal, commercial, and broadcast projects worldwide, in perpetuity」，但**只能下 mp3**、有下载限额、**必须署名**——原文「You must provide clear credit to 'ZapSplat' wherever reasonably possible in your project (e.g., in end credits, descriptions, acknowledgements, or documentation).」；Premium 免署名、mp3+wav。禁止项含分享/转让、**「Redistribute our sounds in any form (e.g., sound libraries, file sharing, apps, social networks, …)」**、把音乐重混成独立作品分发、实体产品需单独 merchandising 许可（$200）、**禁止用于训练 AI/ML 模型**（A）。

### 1.3 一条可执行的筛选规则

> 只接受「B 级以下不碰」的渠道：**许可页上能读到 CC0 字样**或（Pixabay）能读到完整 Content License 且不含再分发限制。任何需要「我理解它应该允许」的判断，一律换成「未确认，不用」。

## 2. 技术参数（引用与补充，不重开 `motion-tech.md`）

### 2.1 容器与码率（MDN 音频编解码器指南，B）

| 编码 | 容器 | 码率 | 采样率 | 延迟 | 浏览器 | 本仓 |
|---|---|---|---|---|---|---|
| MP3 | MP4/ADTS/MPEG/3GP | MPEG-1 32–320 kbps | 32/44.1/48 kHz | ≥100 ms | 全平台；专利 EU 2012 / US 2017 已过期 | **唯一主格式** |
| AAC | MP4/ADTS/3GP | 最高 512 kbps；stereo 推荐 ≥96 kbps@48 kHz | 8–96 kHz | 20–405 ms | Chromium 构建无、Firefox 靠系统 | 不用（多一份编码无收益） |
| Opus | WebM/MP4/Ogg | 6–510 kbps；stereo 推荐 ≥96 kbps@48 kHz | 有效 8–48 kHz | **5–66.5 ms**（最低） | Safari 仅 CAF 容器 | 不用 |
| Vorbis | WebM/Ogg | 45–500 kbps；stereo 推荐 ≥192 kbps@48 kHz | 8–192 kHz | ≥100 ms | **Safari 不支持** | 不用 |

- 通用规律（MDN 同页表）：声道数只影响方向感、不影响质量，但每声道显著增大体积；采样率越高体积越大；lossy 可压 80–95%；joint stereo 能小幅减小体积。
- **体积算术（C）**：64 kbps ≈ 8 KB/s，96 kbps ≈ 12 KB/s，128 kbps ≈ 16 KB/s。示例：120 ms @64 kbps ≈ 1 KB；10 s @128 kbps ≈ 160 KB。

### 2.2 采样率/声道裁决（D）

- 短音效：**mono、22.05 kHz、64–96 kbps MP3**。牌桌音效没有空间感需求，mono 省一半体积；22.05 kHz 的奈奎斯特上限 11 kHz，牌桌类「咔哒/翻纸/低鼓」足够。
- 环境垫：**stereo、44.1 kHz、128 kbps MP3**。环境垫的价值全在宽度与低频，mono 会明显发扁。
- 不为兼容性产出第二套格式：MP3 已被全平台覆盖，第二份只会让登记表与缓存都多一份（C）。

### 2.3 audio sprite 的利弊（依据 MDN `AudioBufferSourceNode.start()`，A）

- 签名 `start(when, offset, duration)`：`offset` 是进入 buffer 的秒数，`duration` 是**源内容**秒数、与 `playbackRate` 无关；「You can only call this function once during the lifetime of an `AudioBufferSourceNode`」→ **每次播放都要新建 source node**，这是 sprite 方案的实现成本。
- 利：一次请求、一次解码、一份 PCM 常驻；多音效并发时没有额外网络往返。
- 弊：整段 PCM 常驻（float32：22.05 kHz mono 1 s ≈ 86 KB，10 s ≈ 844 KB）；没法只解码其中一条；单条替换要重打整包。
- 本仓裁决沿用 `motion-tech.md:141`：**一个 sprite 装 ≤6 s 的短音效，环境垫单独一个文件**。

## 3. 响度：目标值与防刺耳

### 3.1 为什么短音效和环境垫不能用同一个数

- LUFS（integrated）是**对一段时间内能量做统计**的量，测量算法来自 ITU-R BS.1770（K-weighting + 门限）；一条 80 ms 的「咔哒」算出来的 integrated LUFS 没有意义，它几乎完全由起音与静音比决定。
- 所以：**短音效按峰值归一化，环境垫按 LUFS + true peak**。这是工程惯例（D/C）。

### 3.2 本仓目标（写进素材入库验收）

| 类型 | 指标 | 目标 | 证据 |
|---|---|---|---|
| 短音效（≤120 ms） | 峰值（sample peak） | **−1 dBFS**（不高于 −0.5 dBFS） | D（防削波的安全余量） |
| 短音效 | 起音/收尾 | 淡入 3–5 ms、淡出 10–30 ms | D（截断波形会「啪」） |
| 环境垫（8–12 s 循环） | integrated | **≈ −23 LUFS** | C（EBU R128 广播基准；官方页 403 未取到原文，见开放问题 2） |
| 环境垫 | true peak | **≤ −2 dBTP** | C（R128 同名指标；同上） |
| 相对关系 | 环境垫 vs 短音效 | 环境垫比音效**低 12–18 dB** | D（保证音效可闻、垫子不抢） |

- 播放侧再叠一层：`GainNode` 主音量（缺省 0.6）+ 独立「声音」开关（`motion-tech.md:94`：**不存在 `prefers-reduced-sound`**，声音必须有自己的开关）；环境垫与音效挂在不同 GainNode 分支，便于分别调。
- 刺耳除了电平，还有频谱：2–5 kHz 是手机小喇叭最敏感也最容易「尖」的区间。人工试听时优先在**手机外放**上过一遍，而不是耳机（D）。

## 4. 自动播放与静音（只补与素材相关的部分）

- 允许自动播放的条件（MDN，B）：静音或 `volume=0`、用户与该站交互过、站点被 allowlist、Permissions Policy 授权，四者**至少一个**。Web Audio 的 `start()` 同样受管，在用户输入事件之外启动即被拦。
- `Navigator.getAutoplayPolicy()` 返回 `"allowed"` / `"allowed-muted"` / `"disallowed"`，可按 `"audiocontext"` 查询；**策略会随交互变化且无变更通知**，在页面加载时查一次即可，不要当稳定信号。
- 被拒的信号是 `play()` 的 Promise 以 `error.name === "NotAllowedError"` 拒绝 → 此时显示播放按钮/「点一下开启声音」，而不是静默失败。
- iOS：`playsinline` 才允许内联播放；`AudioSession`（Safari 16.4 起支持子集）可声明 `type`，但**不能证明能绕过静音开关**（结论 10）。
- 页面可见性（MDN，Baseline 2015）：`visibilitychange` / `document.hidden`；隐藏时暂停环境垫，可见时**不要自动恢复**（无手势可能被拒），等下一次真实点击。注意「Tabs which are playing audio are considered foreground and aren't throttled.」——持续播环境音会让后台标签不被节流（耗电），这也支持「隐藏即暂停」。
- 素材层面唯一需要配合的：**每条音效的第一帧不要是满幅瞬态**（手机喇叭上会破），以及环境垫的循环点必须人工试听（`motion-tech.md:148`）。

## 5. PWA 体积与缓存

- 实测（C）：`SHELL` 十一个文本资源 ≈159.8 KB（`index.html` 13.9 + `styles.css` 28.9 + `app.js` 78.5 + 其余脚本 24.5 + `manifest` 0.8 + `cards.zh.json` 13.2）；`icons/` ≈25.9 KB；`assets/cards/zh/` ≈43.2 MB（按需）。
- 机制（代码事实 C，`apps/web/sw.js:10-75`）：`install` 全量 `addAll(SHELL)` 后 `skipWaiting`；`activate` 删旧版本缓存；`fetch` 里 `/assets/` 与 `/icons/` 前缀走 cache-first，未命中才拉并 `response.ok` 后写入。
- 结论（D，沿用 `motion-tech.md:164`）：
  1. 音频放 `apps/web/assets/audio/`，**只靠 `/assets/` 前缀的 cache-on-demand**，不进 `SHELL`，也不改 `cacheable` 白名单。
  2. 首次进牌桌时拉 sprite（≈150 KB），**进入第一次夜晚相位时**才拉环境垫（≈200 KB）——而不是首屏预取。
  3. 音频改版用**内容化文件名**（`flip.v2.mp3`）而不是升 `VERSION`：升 `VERSION` 会清空包括卡面 JSON 在内的全部按需缓存，代价远大于改个文件名（C）。
  4. 若新增 `audio.js` 模块，仍要同时改三处：`VERSION`（`:10`）、`SHELL`（`:11-25`）、`cacheable` 白名单（`:59-61`）——漏 `VERSION` 会让已装用户永远跑旧码。
- 断网兜底：音频拉取失败必须**静默降级**（没有声音 ≠ 出错弹窗），因为声音不承载信息（`motion-references.md` 的禁止清单）。

## 候选清单

> 下表是**采购清单**，不是已入库素材。许可一栏写的是「渠道默认条款」；具体条目的许可必须在下载当天回到条目页核对并登记，任何无法读到许可徽标的记为「未确认」。体积按 §2.1 的算术估算，实际以文件为准。

| # | 事件（领域词） | 需求规格 | 首选来源（链接） | 许可 | 时长 | 体积 | 用途/备注 |
|---|---|---|---|---|---|---|---|
| 1 | 翻牌（身份卡揭示） | mono 22.05k，峰值 −1 dBFS，3–5 ms 淡入 | Kenney `Interface Sounds`（https://kenney.nl/assets/interface-sounds）中的轻点击/卡片类 | **CC0**（A） | ≈80–120 ms | ≈1–2 KB | 与现有 `.trial-card` 3D 翻牌（`styles.css:211-219`）同步触发的唯一一次「纸/木轻响」；**不按座位区分音高** |
| 2 | 出牌（打出角色卡） | 同上，比 #1 稍厚（低频多一点） | Kenney `Interface Sounds` / `UI Audio`（https://kenney.nl/assets/ui-audio，50×CC0） | **CC0**（A） | ≈100–150 ms | ≈2 KB | 与「点击确认」区分开；同一回合连续出牌要能做 10 ms 内抖动避免叠成机枪声（D） |
| 3 | 死亡 / 淘汰 | mono，低频 thud + 短尾音 | Kenney `RPG Audio`（https://kenney.nl/assets/rpg-audio，50×CC0）中的 impact/foley 类；或 OpenGameArt 的 CC0 音效条目（条目页许可**未确认**） | Kenney **CC0**（A） | ≈200–400 ms | ≈3–6 KB | 全局一次，不 per-seat（`motion-references.md:75`、`:105` 的泄露禁令） |
| 4 | 计时告警（发牌确认 20 秒到点等） | mono，清亮 beep，单发 | Kenney `Interface Sounds` 的 error/confirmation 类 | **CC0**（A） | ≈80–150 ms | ≈1–2 KB | 单发、不循环；与视觉倒计时并存，声音只是增强 |
| 5 | 夜晚环境垫 | **stereo** 44.1k 128 kbps，8–12 s 无缝循环 | Freesound **CC0**（搜索页按 License 勾 CC0，https://freesound.org/help/faq/）；备选 Pixabay `/sound-effects/`（自有许可，A） | Freesound **CC0**（A）；Pixabay 需读条款（A） | 8–12 s | ≈128–192 KB | 进入第一次夜晚相位时按需拉；淡入 0.4 s / 淡出 0.6 s 走 `GainNode`（`motion-tech.md:146-147`） |
| 6 | 黎明转场 | 单发 1–2 s 的「上扬」音（chime / 微弱钟声） | Kenney 音频包中的 chime/confirmation 类；或 Freesound CC0 的 bell/chime | Kenney **CC0**（A） | ≈1–2 s | ≈8–16 KB | 与环境垫交叉淡化（垫子淡出 0.6 s），不要用「渐强鼓点」这类叙事性音乐 |
| 7 | 全局交互反馈（按钮/错误） | mono，极短 | Kenney `UI Audio`（50×CC0） | **CC0**（A） | ≈50–120 ms | ≈1 KB | 与 #1/#2 共用 sprite，避免三条音乐感互撞 |

- **首批包合计**：7 条，短音效 sprite ≤6 s（≈529 KB 解码内存，`motion-tech.md:141`）+ 1 条环境垫；**磁盘 ≤500 KB**，与 `motion-tech.md:134` 的 ≤150 KB / ≤400 KB 两头上限相容（C/D）。
- **明确不做**：按角色/按座位不同的音效（泄露信息，`motion-references.md:105`）；语音/人声素材（版权与洗稿风险最高）；音乐（BGM 与玩法无关，且情绪化音乐会压过「信息靠视觉」的设计）。

## 授权登记模板

> 位置建议：`docs/research/audio-credits.md`（人类可读）+ `apps/web/assets/audio/LICENSES/`（放包内 license 文件与包页快照）。**任何素材进仓库前必须先有登记行**；删素材时登记行保留并标「已移除」。

```md
## 素材授权登记表

| 文件（仓库相对路径） | 来源 | 许可 | 署名要求 | 署名文本（若需） | 获取日期 | 许可证据 |
|---|---|---|---|---|---|---|
| apps/web/assets/audio/flip.mp3 | https://kenney.nl/assets/interface-sounds | CC0 1.0 | 无 | — | 2026-11-08 | 包页 License 字段截图；zip 内 License 文件 |
| apps/web/assets/audio/night-pad.mp3 | https://freesound.org/s/<id>/ | CC0 1.0 | 无 | — | 2026-11-08 | 声音页许可徽标 + 站方 attribution list 导出 |
```

字段说明（够用即可，别加无意义字段）：

- **文件**：仓库相对路径，与仓库内真实文件名一致（含内容化版本号，如 `flip.v2.mp3`）。
- **来源**：条目页 URL（不是搜索页、不是首页），以便日后复核许可。
- **许可**：写**许可全名**（`CC0 1.0` / `CC BY 3.0` / `Pixabay Content License`），不写「免费」。
- **署名要求 + 署名文本**：CC0 填「无」；CC-BY 必须把作者、标题、许可链接、**是否修改**写全（OGA FAQ 要求）。
- **获取日期**：下载当天日期（YYYY-MM-DD），用于在条款变更时界定「当时拿到的许可」。
- **许可证据**：一句话说明证据落在哪里（页面快照/截图文件名、zip 内 license 文件路径、attribution list 导出文件名）。

## 开放问题

1. **Freesound 的具体 CC0 候选未定**：需要人工登录、按 CC0 筛选、试听后挑选，本篇只给规则不给 id（本次未做下载动作）。
2. **EBU R128 的原文未取到**：`tech.ebu.ch/publications/r128` 与镜像均被 Cloudflare 拦（403），`docs/r/r128.pdf` 是二进制 PDF，`web_fetch` 取不到正文；`en.wikipedia.org` 本轮连接失败。→ −23 LUFS / −1 dBTP 按 C 级写，需人工用 PDF 阅读器确认一次。
3. **ITU-R BS.1770 的测量定义**同样未取原文（只用于解释「为什么短音效用不了 LUFS」），不影响结论 7 的可执行性。
4. **iOS 静音开关是否可被 `audioSession.type = "playback"` 绕过 = 未确认**，需真机（不同 iOS 版本 + 主屏模式）验证；在确认前不得把声音做成信息通道。
5. **Kenney 其它音频包的许可未逐包核验**（如 Impact Sounds、Casino Audio 只从站内分类看到，未打开包页）→ 用到时必须逐包确认 License 字段，本篇按「未确认」处理。
6. **OpenGameArt 的 `rpg-sound-pack` 许可徽标未取到**（95 个 WAV / 12.5 MB，作者 artisticdude，2011-05-19）：页面抓取成功但许可字段不在返回片段内 → 若采用必须回条目页读 License 再登记。
7. **微信内嵌浏览器（WebView）的音频策略**：`salem-online-realtime-platform-facts.md:238` 已记录 H5/小程序差异，但「内嵌浏览器里 AudioContext 解锁是否同样需要手势」未实测。
8. **朗度归一化工具链未定**：本仓是零构建仓库，没有 `ffmpeg`/`loudnorm` 流水线；若要把「入库归一化」变成可重复步骤，需要一份脚本或手工操作记录（触发点是「第一次真下载素材」时）。

## 9. 来源

- Kenney：Interface Sounds（100×，License = CC0，2020）：https://kenney.nl/assets/interface-sounds
- Kenney：UI Audio（50×，License = CC0，2012）：https://kenney.nl/assets/ui-audio
- Kenney：RPG Audio（50×，License = CC0，2014）：https://kenney.nl/assets/rpg-audio
- Creative Commons CC0 1.0 法律文本（Kenney 包页 License 字段指向）：https://creativecommons.org/publicdomain/zero/1.0/
- Freesound：FAQ（三档许可、CC0 原文、attribution list）：https://freesound.org/help/faq/
- Freesound：attribution list（已下载声音的署名清单导出）：https://freesound.org/home/attribution/
- OpenGameArt：FAQ（CC0/CC-BY 摘要、多许可择一、预览音频可能 All rights reserved）：https://opengameart.org/content/faq
- OpenGameArt：RPG Sound Pack（95 WAV / 12.5 MB，许可**未确认**）：https://opengameart.org/content/rpg-sound-pack
- Pixabay：Content License Summary（免署名、可修改、禁止 standalone 再分发）：https://pixabay.com/service/license-summary/
- Pixabay：Terms of Service（legally binding 全文）：https://pixabay.com/service/terms/
- Zapsplat：Standard License（Basic 必须署名、禁止再分发、禁止 AI 训练；2026-05-08 更新）：https://www.zapsplat.com/license-type/standard-license/
- MDN：音频编解码器指南（MP3/AAC/Opus/Vorbis 的容器、码率、采样率、延迟、支持面、专利状态）：https://developer.mozilla.org/en-US/docs/Web/Media/Guides/Formats/Audio_codecs
- MDN：Autoplay guide（四条件、Web Audio 受管、`getAutoplayPolicy`、`NotAllowedError`）：https://developer.mozilla.org/en-US/docs/Web/Media/Guides/Autoplay
- WebKit：New `<video>` Policies for iOS（手势必须由处理器直接导致）：https://webkit.org/blog/6784/new-video-policies-for-ios/
- WebKit：Features in Safari 16.4（AudioSession Web API 子集、Lockdown 禁用 CacheStorage）：https://webkit.org/blog/13966/webkit-features-in-safari-16-4/
- W3C：Audio Session（Editor's Draft，各 `type` 语义、exclusive 类型、`AudioContext` 默认 ambient）：https://w3c.github.io/audio-session/
- MDN：AudioSession（Experimental，`type`/`state`/`statechange`）：https://developer.mozilla.org/en-US/docs/Web/API/AudioSession
- MDN：Page Visibility API（Baseline 2015、隐藏时暂停、播放音频的标签不被节流）：https://developer.mozilla.org/en-US/docs/Web/API/Page_Visibility_API
- MDN：`AudioBufferSourceNode.start()`（`offset`/`duration` 语义、只能调用一次）：https://developer.mozilla.org/en-US/docs/Web/API/AudioBufferSourceNode/start
- MDN：`AudioContext.resume()`（返回 Promise、以 `state` 判断是否需解锁）：https://developer.mozilla.org/en-US/docs/Web/API/AudioContext/resume
