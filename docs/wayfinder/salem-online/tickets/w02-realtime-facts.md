---
id: W-02
title: 12 人实时房间与移动端承载的事实边界
type: wayfinder:research
status: closed
parent: MAP-1
blockedBy: []
assignee: lead
created: 2026-11-05
---

## Question

在 12 人、隐藏信息、断线重连、中国大陆移动网络与微信内打开的约束下，房间服务器、语音与客户端载体各有哪些硬限制？

- 房间服务器：Colyseus（state sync / 按客户端过滤 / reconnect）、自建 Node WebSocket、Cloudflare Durable Objects，各自在 12 人房局下的能力与代价。
- 语音：LiveKit、声网 Agora、腾讯 TRTC 在 12 人房局的移动端限制与计费方式。
- 客户端：移动浏览器 H5 / PWA、微信内 H5、微信小程序、Capacitor / Flutter 壳，在 WebSocket、音频自动播放、分享、后台与包体上的差异。

## Notes

- 每条结论带官方文档 URL；给 12 人房、隐藏信息、断线重连、部署复杂度、中国大陆可达性、成本档位的对比表。
- 产出：`docs/research/salem-online-realtime-platform-facts.md`。
- 本票只查事实与淘汰理由，不替产品选平台；选平台是 W-03。

## Answer

事实与算术已写入 [docs/research/salem-online-realtime-platform-facts.md](../../research/salem-online-realtime-platform-facts.md)。

- **12 人房不是吞吐问题**：峰值 < 5 条消息/秒/房，全量快照 < 20 KB；Colyseus 官方 1 vCPU/1 GB 约 1,000–2,000 CCU，折合 83–166 个满员房（简单游戏基线），按 1/3 余量先压 25–50 房。
- **房间服务器**：Colyseus 最贴合（`maxClients`、`StateView` 按客户端过滤、`allowReconnection` 保座、Redis 多进程）；自建 ws/Socket.IO 能力够但要自己写状态/投影/重连，且 Redis adapter 不支持 connection state recovery；Cloudflare DO 在大陆首发被 Enterprise + ICP + 无中国节点淘汰。
- **语音**：12 人不能用 WebRTC mesh（每人 11 路上行、66 条连接）；用 SFU/托管。12×30 分钟 = 360 参与者分钟/局；Agora 10,000 免费分钟 ≈ 27 局/月，TRTC 625 元/月 11 万分钟 ≈ 305 局/月。
- **客户端**：首发事实指向 H5/PWA（微信内可打开）；小程序硬约束是 wss + ICP、5 条 WebSocket、主包/分包各 2 MB、live-pusher 类目不含桌游。
- **断线**：保座 60–120 秒、服务端计时、私有快照 + seq + 幂等 actionId；移动端切后台是常态。

本票只给事实与淘汰理由，平台选型留给 W-03。