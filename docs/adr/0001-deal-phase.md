# 开局在 `dawn` 之前插入 `deal` 相位

开局必须让每个人**私下**看完自己的身份卡、并在 4–7 人局里从两张角色卡中选一张，之后才允许任何人行动：`rulebook.txt:40` 要求 "Discreetly look at your Tryal Cards"，`salem_15th.txt:51` 规定 7 人及以下发两张角色卡选一张、另一张回盒。原先 `createGame` 发完牌直接进 `action`，12 人局里先手玩家已经开始计时，慢的人还没看完牌。因此把 `deal` 加进 `Phase`（`deal → dawn → action → night → gameOver`），全员 ack 或 `DEAL_MS`（20 秒）超时才推进；规则层只认相位，“谁确认过”放在房间层，照 `room.dawnVotes` 的写法。

**Considered Options**

- 纯客户端浮层：服务端零改动，但开局不同步、断线回来无法补看，且与“服务端权威、客户端不自行推进”的既有约定冲突。
- 复用 `dawn`：`dawn` 只等女巫（`submitDawn` 对非女巫直接拒绝），把它扩成全员门槛会让女巫互认和发牌确认两件事挤在一个相位里。
- 客户端预选角色随出牌提交：只对“出牌触发”成立，对开局选角色与超时兜底都不成立。

**Consequences**

- `Phase` 联合类型新增一个值，`apps/web` 的 `PHASE_LABEL`、服务端 `sync`/计时、机器人 `scheduleBots` 都要跟着加分支。
- 4–7 人局采纳第 15 版变体（中文旧版未写此条），未选中的角色卡移出本局，不进弃牌堆。
- 角色卡一律公开（`PublicPlayer.role` 本来就有值，是 UI 没画），与乔治·伯勒斯 8 点、丹福斯 6 点的门槛可解释性直接相关。
