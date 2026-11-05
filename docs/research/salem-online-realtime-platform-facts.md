# 12 人实时房间与移动端承载事实（W-02）

> 研究票：W-02 / MAP-1《女巫镇》手机端在线版
> 日期：2026-11-05
> 范围：只查事实与淘汰理由，不替产品选平台；选平台是 W-03。
> 读法：标“事实”的句子带官方文档链接；标“算术”的是按公开数字做的估算，不是厂商承诺。

## 0. 一句话结论

- 12 人、回合制、隐藏信息的《女巫镇》，瓶颈不在“12 人并发”，而在**服务端权威状态 + 按玩家投影 + 断线恢复**。消息频率和状态体积都很小，普通 1 vCPU / 1 GB 的 Node 进程就能承载很多房。
- 房间服务器最贴合的是 **Colyseus**：内建 room/state sync、`maxClients`、`StateView` 按客户端过滤、`allowReconnection()` 保座。代价是多进程要 Redis Presence/Driver，且 `StateView` 每个客户端多一次序列化。
- **不要用 WebRTC mesh 做 12 人语音**。mesh 每个客户端要上传 11 路；12 人语音应使用 SFU（LiveKit 自建/Cloud）或托管语音（声网 Agora、腾讯 TRTC）。
- 首发载体事实指向 **H5 / PWA（微信内可打开）**；微信小程序不是不能做，但 **wss 域名必须 ICP 备案、最多 5 个 WebSocket、主包/分包各 2 MB、live-pusher 需要特定类目审核**，把“小程序 + 内置语音”变成高不确定组合。
- Cloudflare Durable Objects 在技术上能扛 12 人房，但 **Cloudflare China Network 只对 Enterprise 客户单独订阅、每个主域必须 ICP、IPv6 强制**；且 DO 不提供状态同步/投影，首发不做首选。

---

## 1. 12 人房到底有多大负载（算术）

### 1.1 消息频率

《女巫镇》是回合制，不是 20 Hz 动作游戏。按最坏情况估：

| 场景 | 估算 | 说明 |
|---|---|---|
| 白天出牌 | 12 人 × 1 次动作 / 5 秒 ≈ **2.4 条/秒** | 每次动作一条 `playCard` / `draw` 消息 |
| 夜晚 | 12 人 × 1 次动作 / 60 秒 ≈ **0.2 条/秒** | 夜晚是时序引导，不是同时高频 |
| 心跳 | 12 人 / 15 秒 ≈ **0.8 条/秒** | 应用层 ping；WebSocket 本身也有 ping |
| 合计峰值 | **< 5 条/秒/房** | 不含广播放大 |

> 结论：单房消息吞吐可以忽略。真正要算的是**广播放大**：一次公开事件要发给 12 人；一次私密事件只发给 1 人。按 5 条/秒 × 12 = 60 条/秒的出站消息，Node 完全无压力。

### 1.2 状态体积

按 12 人、每人 3 张身份卡、约 5 张手牌、若干蓝卡/红卡/状态估：

| 对象 | 估算 |
|---|---|
| 单玩家公开状态 | 0.3–0.8 KB JSON |
| 单玩家私密状态（身份 + 身份卡 + 手牌） | 1–2 KB JSON |
| 牌堆/弃牌/场牌/计时 | 2–5 KB JSON |
| 全量快照（含所有私密） | **< 20 KB** |
| 单次增量事件 | **< 1 KB** |

> 结论：全量快照 < 20 KB，12 人各发一份也不到 240 KB；增量事件 < 1 KB。**不需要**做复杂的二进制协议；JSON + gzip/MessagePack 足够。真正要防的是把不该发的私密字段发出去。

### 1.3 服务器容量

Colyseus 官方 FAQ 给的基线：**1 vCPU / 1 GB 的简单游戏约 1,000–2,000 CCU**，每个连接约 2–5 KB；状态越大、patch 越频繁，CCU 越低（[FAQ](https://docs.colyseus.io/faq.md)）。

算术：1,000–2,000 CCU ÷ 12 人 ≈ **83–166 个满员房**。这是简单游戏基线；《女巫镇》有 12 份 `StateView` 投影和夜晚时序，按 **1/3 余量**规划更稳，即单进程先按 **25–50 个满员房**压测，再往上加。

### 1.4 语音带宽（算术）

Opus 语音按 24–32 kbps/路估（不含 IP/UDP 开销）：

| 拓扑 | 每客户端上行 | 每客户端下行 | 连接数 | 结论 |
|---|---|---|---|---|
| Mesh（12 人全互联） | 11 路 × 24–32 kbps ≈ **264–352 kbps** | 同样约 264–352 kbps | 66 条 | 移动端上行、CPU、NAT 都吃紧；不推荐 |
| SFU（LiveKit / Agora / TRTC） | **1 路 ≈ 24–32 kbps** | 11 路 ≈ **264–352 kbps** | 每客户端 1 条到 SFU | 上行省 11 倍；服务端每房出站约 12 × 11 × 32 kbps ≈ **4.2 Mbps** |

> 结论：12 人语音的瓶颈在**服务端出站带宽和按分钟计费**，不在客户端上行。Mesh 只适合 ≤4 人语音或文字。

---

## 2. 房间服务器：三家事实与淘汰理由

### 2.1 Colyseus（Node.js / TypeScript）

**能力事实**

- `Room` 是单房实例；`maxClients` 默认 `Infinity`，设为 12 后房满自动 lock（[Rooms](https://docs.colyseus.io/room.md)）。
- 关键配置：`patchRate` 默认 **50 ms（20 次/秒）**、`maxMessagesPerSecond` 默认无限、`seatReservationTimeout` 默认 **15 秒**（同上）。
- `StateView`（0.16+）按客户端过滤字段：把 `Schema` 实例 `.add()` 到 `client.view`，带 `.view()` 的字段只对该客户端可见；官方明确说它“不是为大数据集优化”，但适合 per-client private fields（[State View](https://docs.colyseus.io/state/view.md)）。
- 断线：`onDrop()` 里 `allowReconnection(client, 30)` 保座 30 秒；SDK 自动指数退避重试；页面刷新/App 重启后要用存下来的 `reconnectionToken` 调 `client.reconnect()`（[Reconnection](https://docs.colyseus.io/room/reconnection.md)）。
- WS 传输默认：`pingInterval` **3000 ms**、`pingMaxRetries` **2**、`maxPayload` **4096 B**；WebRTC 信令的 SDP 可能超过 4 KB，官方建议加到 16 KB（[WS Transport](https://docs.colyseus.io/server/transport/ws.md)、[WebRTC Plugin](https://docs.colyseus.io/room/plugins/webrtc.md)）。
- 多进程：每个 Room 只属于一个进程；扩缩容要 `RedisPresence` + `RedisDriver`，并给每个进程配独立 `publicAddress`（[Scalability](https://docs.colyseus.io/scalability.md)）。
- 内建 WebRTC 插件**只做信令**，媒体是 **mesh** 直连，不是 SFU（[WebRTC Plugin](https://docs.colyseus.io/room/plugins/webrtc.md)）。

**对 12 人隐藏信息房的意义**

- `StateView` 正好对应“每人只看到自己的身份卡/身份/手牌”，不用自己造过滤层。
- 每个客户端多一次编码步骤；12 人 × 20 Hz 的 patch 需要实测 CPU，但回合制可以把 `patchRate` 调到 100–200 ms，或公开事件走 message、状态只走关键变更。
- 断线保座 + token 重连是内建能力，不用从零写。
- 多进程要 Redis；首发单进程/单机足够，超过 50 房再上 Redis。

**淘汰理由**：没有硬淘汰点。唯一要接受的是“多进程要 Redis、StateView 有额外序列化、内建 WebRTC 只是 mesh”。

### 2.2 自建 Node WebSocket（ws）或 Socket.IO

**能力事实**

- Socket.IO 的 room 是服务端概念，客户端看不到自己加入了哪些 room；加入/离开/按 room 广播是内建（[Rooms](https://socket.io/docs/v4/rooms/)）。
- 断线恢复：`connectionStateRecovery` 可存 `maxDisconnectionDuration` 内的 session/room/data 和漏掉的包；`socket.recovered` 表示是否恢复成功；官方明确“恢复不总是成功”，仍要处理全量同步（[Connection state recovery](https://socket.io/docs/v4/connection-state-recovery)）。
- **Redis adapter 不支持 connection state recovery**（适配器功能表里该项为 ❌）（[Redis adapter](https://socket.io/docs/v4/redis-adapter)）。
- 多节点：要么 sticky session，要么禁用 HTTP long-polling 只走 WebSocket；否则同一 session 的请求会落到不同进程（[Using multiple nodes](https://socket.io/docs/v4/using-multiple-nodes)）。

**对 12 人房的意义**

- 12 人房用 Socket.IO 绰绰有余；但**状态同步、按玩家投影、快照/增量、重连补偿都要自己写**。
- 如果多节点 + Redis adapter，恰好失去 connection state recovery；对隐藏信息游戏，重连必须自己做“私有快照 + 事件序号”，不能依赖 `socket.recovered`。
- 适合“团队已经非常熟 Socket.IO、想完全自控协议”的路线；否则 Colyseus 省掉一层。

**淘汰理由**：不是能力不够，是**重复造轮子**；且 Redis adapter 下 recovery 不可用，使它的卖点之一在 12 人房场景打折。

### 2.3 Cloudflare Durable Objects（DO）

**能力事实**

- 每个 DO 实例**单线程**，软限制 **1,000 请求/秒**；WebSocket 消息最大 **32 MiB**（接收）；每次请求/消息 CPU 默认 **30 秒**；SQLite 版单对象存储 10 GB，KV 版 50 GB（[Limits](https://developers.cloudflare.com/durable-objects/platform/limits/)）。
- DO 可作 WebSocket 服务器，官方说“每实例可连接数千客户端”；支持 **WebSocket Hibernation**，空闲时不占内存/时长（[Use WebSockets](https://developers.cloudflare.com/durable-objects/best-practices/websockets/)）。
- DO 不提供 Colyseus 式的 schema/state sync/per-client view；状态、投影、重连、心跳全部自己实现。
- **中国大陆可达性**：Cloudflare China Network 是 Enterprise 计划的单独订阅，数据中⼼由 JD Cloud 运营；每个主域必须有 **ICP 备案/许可证**，且 IPv6 强制（[China Network](https://developers.cloudflare.com/china-network/)）。没有中国节点的普通 DO 从大陆访问要经过跨境网络。

**对 12 人房的意义**

- 1,000 请求/秒对 12 人房是天文数字；DO 的单线程也不是瓶颈。
- 真正的问题是：**没有状态同步/投影内建**，且**大陆访问与 ICP/Enterprise 门槛**。如果首发只面向海外/港澳台，DO 很省运维；如果面向大陆微信用户，首发不选。

**淘汰理由**：首发大陆 + 微信场景下，**Enterprise + ICP + 无中国节点**三条叠加，淘汰；不是技术扛不住 12 人。

### 2.4 三家对比表

| 维度 | Colyseus | 自建 ws / Socket.IO | Cloudflare DO |
|---|---|---|---|
| 12 人房吞吐 | 远超所需 | 远超所需 | 远超所需 |
| 状态同步 | 内建 schema + patch | 自己写 | 自己写 |
| 按玩家投影 | `StateView` 内建 | 自己写 | 自己写 |
| 断线重连 | `allowReconnection` + token | 自己写；Redis adapter 下 recovery 不可用 | 自己写 + hibernation |
| 多进程/扩容 | Redis Presence/Driver | Redis adapter + sticky/websocket-only | 每房一个 DO，天然分布式 |
| 大陆部署 | 自建香港/大陆节点（需 ICP） | 同左 | Cloudflare China 需 Enterprise + ICP |
| 运维复杂度 | 中 | 中高 | 低（海外） |
| 成本档 | 1 台小 VM 起 | 1 台小 VM 起 | 按请求/时长/存储，海外低 |
| 结论 | **首选候选** | 备选（团队熟） | 海外备选；大陆首发淘汰 |

---

## 3. 隐藏信息：必须“投影”，不能“过滤”

### 3.1 硬规则

- **身份卡堆、夜晚行动、女巫互认、黑猫位置永远不进公共状态**。服务端只保存全量；每个客户端只收到一个投影。
- 公共投影：玩家列表、公开身份、场牌、弃牌、红卡计数、当前阶段、计时、合法动作。
- 私有投影：自己的身份、自己的身份卡、自己的手牌、自己的蓝卡、女巫队友（仅女巫）、夜晚可选目标（仅当前角色）。
- 死亡揭示：只把“被揭示的那张身份卡”发给所有人；不要为了“动画效果”提前把整叠牌发下去。
- 女巫聊天：单独 channel，服务端校验发送者身份；不要用公共广播 + 客户端隐藏。

### 3.2 三种实现

| 方案 | 做法 | 风险 |
|---|---|---|
| Colyseus `StateView` | `client.view.add(player)`；私密字段 `.view()` | 每个客户端多一次序列化；要测 12 份 view 的 CPU |
| 自建投影 | 每 tick/事件生成 `publicState` + `privateState[playerId]` | 容易漏字段；要有 schema 白名单 |
| DO/自建 | 每个连接只发它该看的 JSON | 同上；没有框架兜底 |

### 3.3 验收测试（必须做）

1. **抓包测试**：用 3 个客户端分别以平民/女巫/警长身份进入，抓 WebSocket 帧，断言平民的帧里不出现“其他玩家的身份卡”“女巫队友”“黑猫位置”。
2. **Schema 白名单**：服务端序列化前跑一遍 `assertNoHiddenFields(view)`；字段名黑名单：`trialDeck`、`witchTeammates`、`blackCatOwner`、`nightKillTarget`。
3. **属性测试**：随机 1,000 局，任意时刻任意客户端的投影中，未揭示的身份卡数量 = 总牌数 − 已揭示数；不能多也不能少。
4. **重连测试**：断线 30 秒后重连，收到的私有快照必须与断线前一致；不能把断线期间其他玩家的私密行动补发给他。

---

## 4. 断线重连：移动端是常态，不是异常

### 4.1 事实

- 移动浏览器/微信 WebView 在切后台、锁屏、切网时，页面会被挂起或节流；Page Visibility API 只能告诉你“可见/隐藏”，不能保证连接还活着（[Page Visibility](https://developer.mozilla.org/en-US/docs/Web/API/Page_Visibility_API)）。
- Screen Wake Lock 可防熄屏，但**只在 HTTPS 安全上下文**可用，且页面隐藏时会被系统释放；2025 年 3 月起才达到 Baseline（[Screen Wake Lock](https://developer.mozilla.org/en-US/docs/Web/API/Screen_Wake_Lock_API)）。
- 浏览器会阻止“有声音的自动播放”，必须在用户手势里解锁音频（[Autoplay guide](https://developer.mozilla.org/en-US/docs/Web/Media/Guides/Autoplay)）。
- Colyseus 默认 ping 3 秒、2 次重试，约 9 秒判死；对移动网络可以放宽到 5 秒 × 3 次，但不要超过 20 秒才判死（否则占着座位）。
- TRTC 对异常掉线用户 **90 秒**后清理出房，且等待时长计入计费（[基本概念](https://cloud.tencent.com/document/product/647/46351)）。这是语音房的清理，不是游戏房的托管宽限；两者要分开设计。

### 4.2 设计约束

- **保座 60–120 秒**：`allowReconnection(client, 90)` 之类的量级；超时后标记“托管/弃权”，不要立刻踢出牌局。
- **计时继续**：回合计时由服务端时钟驱动，不依赖客户端 `setTimeout`；断线玩家的倒计时照走，回来看到剩余时间。
- **重连 token 存本地**：`localStorage`/Capacitor Preferences；页面刷新后先 `reconnect()`，失败再重新 `joinById()`（需要房号 + 座位密码/邀请 token）。
- **快照 + 事件序号**：每次私有事件带 `seq`；重连时客户端发 `lastSeq`，服务端回“全量私有快照 + seq 之后的事件”；事件必须幂等（`actionId` 去重）。
- **心跳与后台**：服务端 15–20 秒没收到任何帧就标记可疑；客户端回前台立即发 `resume`，不要等下一次心跳。
- **音频解锁**：在“创建房间/加入房间/开始游戏”的点击回调里初始化 AudioContext/播放一段静音，后续语音/音效才不会被拦。

### 4.3 反面模式

- 用客户端时间做回合倒计时：切后台就停，回来发现“超时”但没操作。
- 断线即踢：12 人局里一个人地铁进隧道，整局少一个，体验直接崩。
- 重连时广播“某某回来了”给所有人：暴露了断线期间的身份/行动痕迹；只发公共“已回来”，私密状态单独发。

---

## 5. 语音：SFU 或托管，不要 mesh

### 5.1 四家事实

| 方案 | 形态 | 12 人房能力 | 计费 | 大陆/微信 | 结论 |
|---|---|---|---|---|---|
| LiveKit | 开源 SFU，可自建或 Cloud | 免费 Build 计划并发 **100 participants**；每参与者最多订阅 100 路音频（[Quotas](https://docs.livekit.io/deploy/admin/quotas-and-limits.md)） | 按参与者分钟 + 流量计费（[Billing](https://docs.livekit.io/deploy/admin/billing.md)） | 自建可放香港/大陆；Cloud 区域需实测 | 首选自建/可控方案 |
| Agora 声网 | 托管 RTC，SDRTN | 产品定位 1 对 1 到数千并发；12 人不是上限（[产品页](https://docs.agora.io/en/voice-calling/overview/product-overview?platform=all)） | **$0.59 / 1,000 分钟**，每月前 **10,000** 合并 RTC 分钟免费（[Pricing](https://www.agora.io/en/pricing/)，价格会变） | 国内节点成熟 | 托管首选之一 |
| 腾讯 TRTC | 托管 RTC | 12 人房常规；异常掉线 90 秒清理 | 入门版免费开通但**无赠送时长**；基础版 **625 元/月**赠 **11 万分钟**（[计费](https://cloud.tencent.com/document/product/647/17157)） | 国内/微信生态最顺 | 国内首发首选 |
| WebRTC mesh | 浏览器 P2P | 12 人 = 11 路上行/人 | 只付服务器信令 | 依赖 NAT/STUN/TURN | **淘汰** |

### 5.2 成本算术（按 12 人 × 30 分钟/局）

- 每局参与者分钟 = 12 × 30 = **360 分钟**。
- Agora 免费 10,000 分钟/月 ÷ 360 ≈ **27 局/月**；超出按 $0.59/1,000 分钟 ≈ **$0.21/局**（12 人 × 30 分钟 × $0.00059）。
- TRTC 基础版 110,000 分钟/月 ÷ 360 ≈ **305 局/月**；625 元/月摊到 305 局 ≈ **2.05 元/局**。
- LiveKit Cloud 免费 100 并发参与者 ÷ 12 ≈ **8 个满员房同时在线**；分钟/流量另计，具体看当前 pricing。
- 自建 LiveKit：一台 2–4 vCPU 的香港/大陆节点 + TURN/带宽；12 人房出站约 4.2 Mbps（见 §1.4），100 房满员约 420 Mbps，带宽成本要单算。

> 注意：以上是“参与者分钟”口径的算术，厂商可能把“上行/下行”或“订阅路数”另行计费；签约前用官网计价器复核。

### 5.3 为什么 mesh 在 12 人房不成立

- 每个客户端 11 条 `RTCPeerConnection`，12 人共 66 条；移动端 CPU、电量、NAT 穿透、信令风暴都放大。
- 上行 264–352 kbps 看似不高，但移动网络的上行抖动/丢包比下行差，11 路同时抖，音频会互相拖累。
- Colyseus 内建 WebRTC 插件明确是 **signaling only + mesh**；它适合 ≤4 人语音或视频，不适合 12 人。
- 结论：**12 人语音必须 SFU 或托管**；如果首发不做内置语音，就外置语音 + 房内文字/快捷语，协议预留 `voiceRoomId` 字段即可。

### 5.4 微信小程序的语音硬门槛

- `live-pusher` 组件只对特定类目开放：社交/直播、教育/在线视频课程、医疗、金融等；需要先过类目审核，再在后台自助开通（[live-pusher](https://developers.weixin.qq.com/miniprogram/dev/component/live-pusher.md)）。
- 桌游不属于表内类目；走“社交/直播”需要相应资质和审核，存在**无法开通**的风险。不要把它当成默认能力。
- 小程序内普通音效可以用 `wx.createInnerAudioContext()`，但那是播放音频，不是实时语音（[InnerAudioContext](https://developers.weixin.qq.com/miniprogram/dev/api/media/audio/wx.createInnerAudioContext.md)）。
- 结论：**小程序首发不做内置语音**；要做，先用 TRTC/Agora 的小程序 SDK 做类目/权限预审，再排期。

---

## 6. 客户端载体：五种形态的硬差异

### 6.1 对比表

| 维度 | H5 / PWA | 微信内 H5 | 微信小程序 | Capacitor 壳 | Flutter 原生 |
|---|---|---|---|---|---|
| 安装 | 无 | 无 | 微信内 | 应用商店 | 应用商店 |
| 实时连接 | WebSocket | WebSocket | `wx.connectSocket`，最多 **5** 条 | WebSocket | WebSocket |
| 域名要求 | HTTPS/WSS | HTTPS/WSS + 微信 JS-SDK 签名 | **wss + ICP 备案 + 后台白名单**，不能 IP/localhost/父域 | 同 H5 | 同原生 |
| 音频自动播放 | 需手势解锁 | 需手势解锁 | InnerAudioContext | 同 H5 | 原生可控 |
| 后台保活 | 会被挂起 | 会被挂起 | 微信托管，切后台可能断 | 可用原生插件 | 原生可控 |
| 分享 | 链接 | JS-SDK 卡片 | `onShareAppMessage` 原生 | 系统分享 | 系统分享 |
| 包体 | 浏览器缓存 | 浏览器缓存 | 主包/分包各 **2 MB**，总 **30 MB**（服务商 20 MB） | 壳 + Web 资源 | 原生包 |
| 开发成本 | 低 | 低 | 中（重写 UI） | 中 | 高 |
| 适合 | 首发/原型/分享 | 首发/拉人 | 微信流量/留存 | 要上架 + 复用 Web | 性能/原生体验 |

### 6.2 逐条事实

**H5 / PWA**

- 无安装、链接即玩，最适合“朋友房 + 分享”。
- WebSocket 原生支持；但切后台会被挂起，必须按 §4 做重连。
- Screen Wake Lock 需要 HTTPS，且页面隐藏会被释放；老 iOS 不支持，需要“屏幕常亮”降级提示。
- 音频必须用户手势解锁；不要做“进房自动开麦”。

**微信内 H5**

- 分享卡片需要微信 JS-SDK 的签名与安全域名配置；没有签名只能复制链接。
- 微信 WebView 的 `getUserMedia`/WebRTC 支持随客户端版本和平台差异大，**不能作为首发语音的可靠前提**；语音走 SFU SDK 也要真机矩阵验证。
- 域名要 HTTPS，且实际访问受微信/运营商网络影响；大陆服务器建议 ICP。

**微信小程序**

- 只能与后台配置过的域名通信，**只支持 https/wss**，域名必须 **ICP 备案**，不能用 IP、localhost、父域名；端口配置也很严格（[网络](https://developers.weixin.qq.com/miniprogram/dev/framework/ability/network.md)）。
- 1.7.0+ 最多同时 **5 个 WebSocket**；低于 1.7.0 同时只能 1 个（[wx.connectSocket](https://developers.weixin.qq.com/miniprogram/dev/api/network/websocket/wx.connectSocket.md)）。
- 分包：整个小程序所有分包不超过 **30 MB**（服务商代开发 20 MB），单个分包/主包不超过 **2 MB**（[分包加载](https://developers.weixin.qq.com/miniprogram/dev/framework/subpackages.md)）。卡牌美术必须放 CDN/分包，主包只放壳和首屏。
- 没有 DOM，牌桌 UI 要用 WXML/Canvas/Skyline 重写；不能直接复用 H5 组件。
- 转发是原生能力（`onShareAppMessage`），拉人比 H5 顺；但语音受 §5.4 类目限制。

**Capacitor / Flutter 壳**

- Capacitor：把 H5 包进原生 WebView，可复用大部分 Web 代码，接原生插件做 keep-awake、分享、后台音频；要过应用商店审核。
- Flutter：原生 UI + 原生 WebSocket/WebRTC 插件，体验/后台控制最好，但等于重写一套客户端；12 人牌桌的动画/手势用 Flutter 更稳。
- 如果首发目标是“微信里点开就玩”，壳不是首发；壳是后续要 app 图标/推送/应用商店曝光时再做。

---

## 7. 中国大陆 + 微信的硬约束清单

1. **ICP 备案**：小程序服务器域名必须 ICP；Cloudflare China Network 每个主域也要 ICP（[微信网络](https://developers.weixin.qq.com/miniprogram/dev/framework/ability/network.md)、[Cloudflare ICP](https://developers.cloudflare.com/china-network/concepts/icp/)）。
2. **wss + 白名单**：小程序只能连配置过的 wss 域名；不能 IP、localhost、父域；端口规则严格。
3. **5 条 WebSocket**：小程序同时最多 5 条；游戏主连接 + 语音 + 监控要算进去，别开一堆。
4. **包体**：主包/分包各 2 MB，总 30 MB；卡牌素材必须 CDN/分包，首包只放牌桌壳。
5. **语音类目**：live-pusher 只对特定类目开放；桌游不在表内，需预审。
6. **Cloudflare China**：Enterprise 单独订阅 + ICP + IPv6；普通 Cloudflare 全球网络从大陆访问不稳定（[China Network](https://developers.cloudflare.com/china-network/)）。
7. **支付/商业化**：本图 Out of scope；但 ICP/版号/支付合规会反向影响上线时间，W-12 要留 buffer。

---

## 8. 淘汰理由（只列被事实淘汰的）

| 方案 | 淘汰理由 | 不是淘汰理由 |
|---|---|---|
| WebRTC mesh 12 人语音 | 11 路上行/人、66 条连接、移动端 NAT/电量/抖动；Colyseus 插件明确 mesh | “WebRTC 不能用”——SFU 可用 |
| Cloudflare DO 作为大陆首发房服务器 | China Network 需 Enterprise + ICP + IPv6；普通 DO 无中国节点；无状态同步/投影 | “DO 扛不住 12 人”——1,000 req/s 远超 |
| 小程序 + 内置 live-pusher 语音 | live-pusher 类目表不含桌游；需类目审核；审核不通过就没有语音 | “小程序不能做游戏”——不做内置语音可以 |
| Socket.IO + Redis adapter 依赖 recovery | Redis adapter 明确不支持 connection state recovery；多节点还要 sticky/websocket-only | “Socket.IO 不能做 12 人”——能，只是要自己写状态层 |

---

## 9. 对下游票的输入

**W-03（首发载体/分享/登录）**

- 事实指向：H5（微信内可打开）+ 6 位房号/邀请链接；小程序作为二期拉新，不在首发做内置语音。
- 登录：游客昵称 + 本地 token 起步；微信授权登录放二期，避免首发被 appid/审核卡住。
- 分享：H5 用链接 + 复制房号；小程序用 `onShareAppMessage`。

**W-04（语音）**

- 首发建议 B：外置语音 + 房内文字/快捷语，协议预留 `voiceRoomId`/`voiceProvider`；不要把 mesh 写进架构。
- 若要做内置：优先 TRTC（国内/微信生态）或 LiveKit 自建（可控/可迁移）；Agora 作为海外/备选。
- 小程序语音先做类目预审，不通过就不排期。

**W-06（服务端权威/投影）**

- 服务端唯一状态源；每个客户端一个 view；身份卡堆/夜晚目标/女巫队友/黑猫位置永不进公共投影。
- 快照 + `seq` + 幂等 `actionId`；重连回“私有快照 + 漏掉的事件”。
- 验收：抓包白名单、属性测试、重连一致性。

**W-11（房间生命周期/重连）**

- 保座 60–120 秒；超时转托管/弃权；回合计时服务端驱动。
- 12 人房满员 lock；少人开局按规则书人数配比（4–12 人表）。
- 断线检测 15–20 秒；回前台立即 resume；不要等心跳。

**W-12（MVP 验收）**

- 12 人房压测目标：单进程 25–50 个满员房，P95 动作广播 < 200 ms，重连成功率 > 99%（同网/弱网分开统计）。
- 语音若首发不做，验收项写“外置语音 + 快捷语可用”，不写“内置语音”。

---

## 10. 未决与必须实测

1. **真机矩阵**：iOS Safari、Android Chrome、微信 iOS/Android、低端 Android（2–4 GB RAM）；测切后台 30 秒/2 分钟/锁屏后的 WebSocket 存活率与重连耗时。
2. **Colyseus StateView 12 份投影的 CPU**：单进程 25/50 个满员房的 patch 耗时、内存、出站带宽；对比 `patchRate` 50/100/200 ms。
3. **微信小程序类目预审**：桌游 + live-pusher 是否能过；不能过就确认“无内置语音”的小程序版本。
4. **语音厂商大陆实测**：TRTC/Agora/LiveKit 在移动 4G/5G/弱网下的 MOS、首帧、断线重连；按 12 人房 30 分钟实测计费。
5. **ICP 时间**：域名备案/小程序备案的实际周期；W-12 的上线 buffer 要按实测填。
6. **微信 H5 的 getUserMedia**：iOS/Android 微信 WebView 是否允许麦克风；不允许就确认“H5 不做内置语音”。

---

## 11. 来源

- Colyseus Rooms: https://docs.colyseus.io/room.md
- Colyseus State View: https://docs.colyseus.io/state/view.md
- Colyseus Reconnection: https://docs.colyseus.io/room/reconnection.md
- Colyseus WebSocket Transport: https://docs.colyseus.io/server/transport/ws.md
- Colyseus WebRTC Plugin: https://docs.colyseus.io/room/plugins/webrtc.md
- Colyseus FAQ: https://docs.colyseus.io/faq.md
- Colyseus Scalability: https://docs.colyseus.io/scalability.md
- Socket.IO Rooms: https://socket.io/docs/v4/rooms/
- Socket.IO Connection state recovery: https://socket.io/docs/v4/connection-state-recovery
- Socket.IO Redis adapter: https://socket.io/docs/v4/redis-adapter
- Socket.IO Using multiple nodes: https://socket.io/docs/v4/using-multiple-nodes
- Cloudflare Durable Objects Limits: https://developers.cloudflare.com/durable-objects/platform/limits/
- Cloudflare Durable Objects WebSockets: https://developers.cloudflare.com/durable-objects/best-practices/websockets/
- Cloudflare China Network: https://developers.cloudflare.com/china-network/
- Cloudflare China ICP: https://developers.cloudflare.com/china-network/concepts/icp/
- LiveKit Quotas: https://docs.livekit.io/deploy/admin/quotas-and-limits.md
- LiveKit Billing: https://docs.livekit.io/deploy/admin/billing.md
- LiveKit Transport: https://docs.livekit.io/transport.md
- Agora Product Overview: https://docs.agora.io/en/voice-calling/overview/product-overview?platform=all
- Agora Pricing: https://www.agora.io/en/pricing/
- TRTC 计费概述: https://cloud.tencent.com/document/product/647/17157
- TRTC 基本概念: https://cloud.tencent.com/document/product/647/46351
- 微信小程序网络: https://developers.weixin.qq.com/miniprogram/dev/framework/ability/network.md
- 微信小程序 WebSocket: https://developers.weixin.qq.com/miniprogram/dev/api/network/websocket/wx.connectSocket.md
- 微信小程序分包: https://developers.weixin.qq.com/miniprogram/dev/framework/subpackages.md
- 微信小程序 live-pusher: https://developers.weixin.qq.com/miniprogram/dev/component/live-pusher.md
- 微信小程序 InnerAudioContext: https://developers.weixin.qq.com/miniprogram/dev/api/media/audio/wx.createInnerAudioContext.md
- MDN Screen Wake Lock: https://developer.mozilla.org/en-US/docs/Web/API/Screen_Wake_Lock_API
- MDN Page Visibility: https://developer.mozilla.org/en-US/docs/Web/API/Page_Visibility_API
- MDN Autoplay: https://developer.mozilla.org/en-US/docs/Web/Media/Guides/Autoplay