# 揭示身份卡由“打出最后一张的玩家”阻断式选择，对外只用位置号

`salem-1692-card-and-rules-facts.md:70` 写的是“达到门槛后，由**打出达到门槛那张牌的玩家**选择目标一张未揭示试炼牌翻开”，而实现一直是取第一张未揭示的（`chooseDefaultTrialId`，票 #12 里已删除）。选择必须发生在结算之前，因为翻牌会连带触发死亡、警长转移、丽贝卡抽牌、安妮计数、阿比盖尔弃红卡。因此 `GameState` 增加挂起态 `pendingReveal`：`playCard` 在达门槛处停下并写入 `{ targetId, chooserId, cause, canDecline, useAbigail }`，等选择者的命令才继续——服务端只调一个入口 `resolvePendingReveal(state, chooserId, { kind: "reveal", trialIndex } | { kind: "decline" })`。只有 1 张未揭示且不可放弃时自动揭示不弹窗；**可放弃优先于省掉选位置**：丹福斯把目标压到正好 6 点、目标只剩一张时仍进挂起，`slots` 只有一个 `"hidden"`，放弃或翻开都由他决定。回合计时继续跑，超时、托管、机器人用 `defaultRevealIndex` 取第一张兜底。`canDecline` 只对“丹福斯对普通玩家的第 6 点”为 true（`thresholdFor === 6 && accusationTotal === 6`）。

对外用**位置号**而不是卡 id，因为 `TrialCard.id` 形如 `witch-0`（`setup.ts:42`），把 id 发给选择者等于直接把类型报给他。`pendingReveal` 只下发给选择者，形如 `{ targetId, chooserId, slots: ["hidden" | "revealed"], canDecline }`（原因只留在内部状态与事件里），并纳入 SPEC §4 的零泄漏禁用键扫描；测试用“遍历所有 viewer、比对真实未揭示卡 id”的扫描而不是点对点字符串比较。挂起期间 `canPlayCard`、`drawTwo`、`endTurn`、`samuelTake`、`titubaReorder` 一律返回 `reveal-pending`。

**Considered Options**

- 客户端预选后随出牌提交：省掉挂起态，但诅咒/替罪羊路径、超时兜底、以及“翻牌前不能继续抽牌”都无处安放。
- 维持自动翻第一张：等于把规则里最关键的决策权交给座位顺序。

**Consequences**

- `autoTakeTurn`（`apps/server/src/server.mjs:347`）入口必须加挂起拦截，否则超时会先抽两张再翻牌；这一步归票 #13，本票不动服务端。
- 已知偏差：传染与自首仍自动揭示第一张；两者要接选择时复用同一挂起态即可。
