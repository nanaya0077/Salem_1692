# 房间只活在单进程内存里：部署固定单副本，重启即终结所有对局

房间状态是 `apps/server/src/server.mjs` 里的 `rooms` Map，全仓没有任何把房间写盘的调用，房间空了就 `rooms.delete(room.code)`（`apps/server/src/server.mjs:665`），进程退出时随堆一起消失。房码在这个 Map 内唯一，没有 Redis，也没有按房码路由的入口。Railway 官方明确不支持 sticky session，多副本会把同一局的不同玩家连到不同进程，各自看到一半的局内状态。

因此托管形态定死：**永久单副本**，不做横向扩容；**进程重启 = 该进程上所有对局作废**，这是明示的产品行为而不是事故——试玩版不为未验证的玩法预付持久化成本。

这条因果链的末端是「房间已失效」：进程重启后旧房码在服务端已经查不到，客户端补发 join 拿到 `{ reason: "room-not-found" }`（`apps/server/src/server.mjs:559`），前端据此进终态——停止重连、清存档、回落地页，并显示「房间已失效，请重新开房。」（文案 `apps/web/reconnect.js:20`，判定 `apps/web/reconnect.js:38-55`，落点 `apps/web/app.js:785-808`）。没有「单副本 + 内存态」就没有这个终态；反过来，有了这个终态，重启才是可接受的产品行为而不是故障。两者的验收要一起看。

**Considered Options**

- 多副本 + sticky session：Railway 不支持 sticky session，直接排除；即便支持，也还需要房码路由表。
- 房间快照落盘 + 重启恢复：要额外处理快照版本兼容、恢复时的揭示挂起态、以及"重启瞬间这一局算不算继续"的产品判定，是独立一整张规格。
- 外部房间目录（Redis / Postgres）：换存储层，收益只在真正需要扩容或多区域时才兑现。

**Consequences**

- Free 档与任何会休眠、会停机的档位都不可用：进程一停，房间全没。
- 每次发布都是一次"全员掉线"，必须挑低峰手动触发（见 `docs/adr/0004-dockerfile-manual-deploy.md`，操作步骤见 `docs/ops/railway-deploy.md`）。
- `/health` 虽然带 `rooms` 计数，但只要进程活着就恒定 200（`apps/server/src/server.mjs:932-935`）：上线成功的判据只回答"进程起没起来"，回答不了"有没有人在玩"。
- 将来要扩容时，第一件事不是加副本，而是把 `rooms` 换到进程外。
