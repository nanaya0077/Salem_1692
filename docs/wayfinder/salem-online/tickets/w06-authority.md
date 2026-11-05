---
id: W-06
title: 服务端权威状态与按玩家投影
type: wayfinder:grilling
status: closed
parent: MAP-1
blockedBy: []
assignee: lead
created: 2026-11-05
---

## Question

服务端权威状态怎么切分与投影？每个客户端能拿到哪些字段？断线重连的快照包含什么、如何防重放与防冒领座位？如何用自动化测试证明零泄漏（12 人视角快照 diff、网络负载扫描）？

## 建议（可被推翻）

单一权威房间状态 + 按 viewerId 的纯函数投影；客户端只拿公共态 + 自己的私密态；重连用一次性 seat token + 全量投影快照；泄漏测试作为 CI 门禁。

## Answer

**结论：单一权威房间状态 + 按 viewerId 的纯函数投影；客户端只拿公共态 + 自己的私密态。**

- 状态：服务端 `RoomState` 含牌堆、手牌、试炼、身份、夜晚目标；客户端永远拿不到完整状态。
- 投影：`project(state, viewerId) → {public, self, seats}`；`seats` 只含公开计数、已揭示试炼、蓝牌、连接态；禁用键 `deck/hand/identity/witchIds/nightTarget` 不得出现在他人投影。
- 重连：一次性 `seatToken`（服务端哈希存储，重连后轮换）+ `lastVersion`；返回全量投影 + 之后事件；旧 token 失效。
- 防重放：命令带 `commandId` 与 `roomVersion`；服务端幂等去重，拒绝过期版本。
- 泄漏门禁：12 个 viewer 的 golden snapshot diff + 序列化 payload 禁用键扫描 + 网络帧扫描；CI 阻断。
- 传输：Colyseus WebSocket；房间 actor 串行处理命令；MVP 单进程内存，Redis 仅二期 presence。
- 落地：见 [SPEC.md](../SPEC.md) §4、§6。
