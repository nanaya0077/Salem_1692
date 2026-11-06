# spec-7 产品线合并评审（发牌 / 挂起揭示）

评审对象：spec-7 产品线（issue #7、#9–#14，#15 验收）的合并收敛点。
评审方式：只读取证（`git log/show/diff/merge-tree/rev-list/for-each-ref` + `gh issue view` + 在 worktree 里跑只读测试），未改动任何源码、测试、配置。
评审依据：`AGENTS.md`、`GLOSSARY.md`、`docs/agents/issue-tracker.md`、ADR-0002（main）、issue #7 / #15 正文、`code-review` skill 的两轴方法（Standards / Spec 分开报告，不合并排序）。
取证时间：2026-11-06。远端 `origin/main` = `d0976ae9`（tree `3692f478`）。

---

## 0. 结论先行

1. **合并源 = `spec-7-int`（= `ticket-14` 的 tree）**，但它**不是** `main` 的超集，必须连同 `E:/Githubrepo/salem-int` 那批未提交改动一起算。理由见 §2、§4。
2. **不要合并本地 `main`**。本地 `main` 上有 #10 / #12 的**另一套实现**（`83fc045`、`d401c6a`，patch-id 与线内提交不同，不是 cherry-pick），`git merge-tree main spec-7-int` 直接给 **13 个冲突**；Lead 给的"只冲突 2 个文件"只对 `origin/main` 成立。
3. 对 `origin/main` 的冲突只有 **2 个文件**（`apps/web/app.js`、`apps/web/sw.js`），但 `app.js` 的 `case "error"` 段**自动合并结果是坏的**（括号不配对、theirs 支路引用未定义的 `outcome`）——必须整段手写，不能接受 merge-tree 输出。见 §3。
4. **功能实现基本满足 #7，文档/术语层不满足**：`docs/adr` 在分支线上不存在（ADR-0001 全仓不存在，ADR-0002 只在 `main`），`GLOSSARY.md` 缺 4 个本线新增术语，`SPEC.md` §5 还写着"当前 32 条测试"且没有挂起揭示段。→ #7 在文档回写前不能关。

---

## 1. 事实底稿

### 1.1 提交与 tree

| ref | commit | tree | 与 `spec-7-int` 关系 |
| --- | --- | --- | --- |
| `spec-7-int` | `d94e4ae` | `2c96819c` | 本体 |
| `ticket-14` | `49d4ea9` | `2c96819c` | tree 完全相同，仅差 merge commit |
| `spec-7-deal-and-reveal` | `ab6214e` | `77d8c31c` | 严格祖先（11 落后 / 0 领先） |
| `ticket-10` | `1760a1f` | — | 祖先（10/0） |
| `ticket-11` | `e1f9d28` | — | 祖先（3/0） |
| `ticket-12` | `257d011` | — | 祖先（10/0） |
| `ticket-13` | `cd351df` | — | 祖先（6/0） |
| `main`（本地） | `d401c6a` | `46a730a8` | 11 落后 / **2 领先**（`83fc045`、`d401c6a`） |
| `origin/main` | `d0976ae9` | `3692f478` | **17 独有 / 4 独有** |

- `merge-base(main, spec-7-int)` = `ab6214e`；`merge-base(origin/main, spec-7-int)` = `9af776a`。
- `spec-7-int` 独有 17 个提交（其中 `9fa1acb`/`d0f407f`/`c865f94`/`97fd841` 是头像与座位名的 web 修复，`main` 也收了）。
- 规模（`git diff --stat origin/main...spec-7-int`）：**36 files changed, +3084 / −164**。
- 本线新增文件（相对 `origin/main`，18 个 `A`）：`apps/server/test/{deal,resync,reveal}.mjs`、`apps/server/test/lib/deal.mjs`、`apps/web/{deal-view,reveal-view,table-view}.js`、`apps/web/test/{deal-shell,deal-view,reveal-shell,reveal-view,seat-identity,table-view,trial-face,trial-tone,wording}.test.js`、`apps/web/_shots/game-12-seat-roles.png`、`packages/rules/test/pending-reveal.test.ts`。

### 1.2 本地 `main` 上的另一套实现（关键）

| 票 | 分支线提交 | 本地 `main` 提交 | 差异要点 |
| --- | --- | --- | --- |
| #10 发牌 | `1760a1f`：全内联 `apps/server/src/server.mjs`(+201) + 端到端 `apps/server/test/deal.mjs`(284) + `test/lib/deal.mjs` | `83fc045`：新增 `apps/server/src/deal-room.mjs`(+94)、`server.mjs`(+100)、`deal.test.mjs`(128)、`deal_timeout.mjs`(71)，走 `node --test` | 同一需求两套结构：模块化 vs 内联 |
| #12 挂起揭示 | `257d011`：只在 `packages/rules`，新增 `test/pending-reveal.test.ts`(292)，**无文档** | `d401c6a`：`engine.ts`(+231)、`setup.ts`、`types.ts`、`rules.test.ts`(+295)、`soak.test.ts`，并**改 `GLOSSARY.md`(+6)、新增 `docs/adr/0002-pending-reveal.md`、改 `docs/wayfinder/salem-online/SPEC.md`(+11)** | 语义同向，API 与原因字符串不同 |

规则层 API 差异（合并时必须裁决，不能两边都留）：

| 项 | `main`（ADR-0002 口径） | `spec-7-int` |
| --- | --- | --- |
| 挂起期拒绝理由 | `"reveal-pending"` | `"pending-reveal"` |
| 默认位置选择 | 导出 `defaultRevealIndex(state)` | 无（`#13` 在服务端内联 `findIndex`） |
| 命令入口 | `revealPendingTrial` / `declinePendingReveal` / `resolvePendingReveal` | 只有 `resolvePendingReveal(state, actorId, command, options)` |
| 事件 | `revealRequested` | 无同名事件 |
| 只剩一张时 | 可放弃优先：丹福斯 6 点即使只剩一张也进挂起 | 直接揭示（`hidden.length === 1` 短路）→ 与 ADR-0002 冲突 |

`salem-int` 的未提交改动正是往 `main`/ADR-0002 口径收敛（见 §4），所以"最全版本"实际是 **`spec-7-int` + 这批未提交改动**，且必须两份一起算。

### 1.3 文档现状

- `docs/adr/0001-deal-phase.md` **在任何 ref 上都不存在**（#7 正文称"两条 ADR 已落盘"，实际只有 ADR-0002，且只在 `main`）。
- `spec-7-int` 的 `docs/adr/` 目录为空（相对 `origin/main` 少 `0003`、`0004`，因为它从 `9af776a` 分叉于这两条 ADR 之前）。
- `spec-7-int:docs/wayfinder/salem-online/SPEC.md` §5 写"当前 32 条"，且**没有**挂起揭示 / 发牌相位段落；`main` 的同一文件已写"当前 47 条"并加 §5 挂起揭示。实测：规则包 **52**、web **55** → 同一指标三处数字互不相同。
- `spec-7-int:GLOSSARY.md` 有「身份卡 / 女巫 / 平民 / 警长 / 开局配置 / 传染 / 夜晚 / 指控 / 自首 / 发牌相位 (Deal Phase) / 角色候选 (Role Option)」，**缺**「发牌确认 / 挂起揭示 / 位置号 / 可放弃」；`main` 的 GLOSSARY 有前四项（措辞不同），无「发牌相位 / 角色候选」。
- 开放 issue 只剩 `#6`（Railway 部署，needs-triage）、`#7`、`#15`、`#1`；`#9`–`#14` 全 CLOSED。

---

## 2. 必答 1：各分支相对 `spec-7-int` 是否子集 / 超集

- **子集（真祖先，零独有改动）**：`spec-7-deal-and-reveal`（11/0）、`ticket-10`（10/0）、`ticket-11`（3/0）、`ticket-12`（10/0）、`ticket-13`（6/0）。逐条核对 `git rev-list --left-right --count` 领先侧全为 0，`ticket-11` 自身还含一个 `Merge branch 'spec-7-int' into ticket-11`（`e1f9d28`），仍是祖先。
- **等价快照**：`ticket-14`（`49d4ea9`）与 `spec-7-int` tree 完全相同（`2c96819c`），差别只是 `d94e4ae` 那个 merge commit 与提交图。
- **既非子集也非超集**：`main` / `origin/main`。`main` 独有 `d401c6a`(#12 另一套 + ADR-0002 + GLOSSARY/SPEC 回写) 与 `83fc045`(#10 另一套 + `deal-room.mjs`)；`spec-7-int` 独有 11 个提交（#9、#10、#11、#12、#13、#14 及 4 个 web 修复）。相对 `origin/main`，`spec-7-int` 独有 17 个提交、独有 18 个新文件。
- 逐条列出各自的独有改动（相对 `merge-base`）：

**`spec-7-int` 独有（#10–#14 全链）**
- `#9` 规则：`packages/rules/src/setup.ts` deal 相位与 `roleOptions.splice(0, 2)`；`engine.ts` `chooseRole`。
- `#10` 服务端：`server.mjs` 内联 `dealAcks` / `dealDeadline` / `DEAL_MS` 兜底 / `ack` 命令；`test/deal.mjs`（片一~片五）。
- `#11` 界面：`apps/web/deal-view.js`、身份卡卡片条、`index.html` deal 屏、`sw.js` 缓存清单。
- `#12` 规则：`pendingReveal` 挂起态、`resolvePendingReveal`、`TrialSlot`、位置号投影、`test/pending-reveal.test.ts`。
- `#13` 服务端：`autoTurn(room, reason)` 单一入口、`resolveAutoReveal`、`handleAction` 前置 `reveal`/`decline`、机器人选择者即时代翻；`test/reveal.mjs`（三片）。
- `#14` 界面：`index.html:92 #revealBar`、`styles.css` `.reveal-bar` / `.reveal-slots`（`overflow-x: auto`）/ `.reveal-slot`、`reveal-view.js`。
- web 修复 4 个：座位原子重发（`ab6214e`）、座位显示角色名并统一称「警长」（`9fa1acb`）、首字按字素簇取（`d0f407f`）、全站标人位置显示头像（`c865f94`）及 `avatar-normalize` 收敛（`97fd841`）。

**`main` 独有**
- `docs/adr/0002-pending-reveal.md`（ADR，15 行）、`GLOSSARY.md` 四个新术语 + 「开局配置 4–7 人二选一」、`SPEC.md` §5 挂起揭示段与"当前 47 条"。
- `engine.ts` 的 `defaultRevealIndex` / `revealPendingTrial` / `declinePendingReveal`、理由 `reveal-pending`、事件 `revealRequested`。
- `apps/server/src/deal-room.mjs`、`deal.test.mjs`、`deal_timeout.mjs`（另一套发牌实现与 `node --test` 风格测试）。

---

## 3. 必答 2：`spec-7-int` 是否该线最全版本

**是（按功能），但要加限定**：

- 唯一同时含 #9 规则 + #10 服务端发牌 + #11 界面发牌 + #12 规则挂起 + #13 服务端揭示 + #14 界面位置条的分支；其余线内分支全是它的祖先或同 tree，没有任何分支比它多一行代码。
- **限定 1**：它不是 `main` 的超集 —— 文档（ADR/GLOSSARY/SPEC）与规则层 API 的最终口径都在 `main`，合并时要按 §1.2 表收敛。
- **限定 2**：真正"最全"的状态还在 `E:/Githubrepo/salem-int` 工作区（未提交）：`engine.ts` 加了 `defaultRevealIndex`、理由改 `reveal-pending`、可放弃优先；`server.mjs` 挂起期不重设回合倒计时。这些是线内提交版本**没有**的语义修正（见 §4、§7）。
- **限定 3**：`main` 上的 `deal-room.mjs` 那套发牌实现在合并后应**丢弃**（`#13` 的 `autoTurn` 依赖内联版），只把 `deal_timeout.mjs` 的用例思路并入 `deal.mjs`。

---

## 4. 必答 3：`apps/web/app.js` 与 `apps/web/sw.js` 的冲突段与解决原则

命令：`git merge-tree --write-tree origin/main spec-7-int` → exit 1，tree `aebeda00`，仅这两文件冲突（`index.html`、`styles.css` 自动合并干净，`styles.css` 无冲突标记；合并后 `index.html` 只有一处 `<script type="module" src="/app.js">`，无重复脚本标签）。

### 4.1 `apps/web/app.js`

| 段 | ours（`origin/main`） | theirs（`spec-7-int`） | 解决原则（判断依据） |
| --- | --- | --- | --- |
| 1–15 顶部 import | 多行：`{KICKED_MESSAGE, RECONNECT_DELAY_MS, REPLACED_MESSAGE, ROOM_GONE_MESSAGE, closeOutcome, errorOutcome, rejoinPlan}` from `./reconnect.js` | 单行：`./table-view.js`、`./deal-view.js`、`./reveal-view.js` 的具名导入 | 取**并集**，一个来源一条 import，按路径字典序；两边都没有同名符号冲突 |
| 311–316 `case "welcome"` | 直接赋值 `S.seatId = msg.seatId; S.rejoining = false` | 调 `adoptIdentity(msg.seatId, msg.avatars)` | 以 `adoptIdentity` 为准（它是 #11/#14 引入的统一身份落地入口，座位号与头像表必须原子生效，见 `ab6214e`），把 ours 的 `rejoining` 复位并进该分支，不允许两套赋值并存 |
| 349–366 `case "error"` | `errorOutcome({reason, rejoining})` 状态机 + `room-gone` 终态 + `join-failed` 时 `resetRoomState` | 内联 `room-not-found` / `no-seat` → `clearSession` / `resetAvatars` / `render` | **保留 ours 的状态机**，把 theirs 的两个 reason 作为 `errorOutcome` 的输入分支；theirs 的副作用（清会话、清头像、重渲染）下沉到状态机对应分支。判据：`room-gone` 是新的协议**终态**，丢掉它会让重连退化成死循环 |
| 367–371（自动合并产物） | — | — | **已损坏**：括号不配对，且 theirs 支路引用了未定义的 `outcome`。→ 不接受 `merge-tree` 的输出，整段 `case "error"` 手写重放并用 `chrome`/`node --test apps/web/test/reveal-shell.test.js` 守住 |

### 4.2 `apps/web/sw.js`

| 段 | ours | theirs | 解决原则 |
| --- | --- | --- | --- |
| 1–7 `VERSION` | `"salem-v2"` + 缓存说明注释 | `"salem-v4"` | 取**新值**（`salem-v5`），版本号必须高于两边任何已发布值，否则旧 SW 不换壳 |
| 12–18 `SHELL` | 含 `/reconnect.js` | 含 `/table-view.js`、`/deal-view.js`、`/reveal-view.js` | 取**并集**：`/reconnect.js` + 三个 view 模块都要进预缓存 |
| 58–62 `cacheable` / 运行时缓存列表 | 同上，含 `/reconnect.js` | 同上，含三个 view | 取并集，与 `SHELL` 保持同集合；漏一个模块会让离线首屏拿到 404 空壳 |

### 4.3 合并顺序与禁止项

1. 目标分支先对齐 `origin/main`（本地 `main` 当前 ahead 8 / behind 4，其中两个是重复实现）。
2. 再合 `spec-7-int` + §5 的未提交改动（作为独立提交先落地）。
3. **反向合并（先合 `main` 再合远端）会产生 13 个冲突**：`apps/server/src/server.mjs`、`apps/server/test/{bots,bots_add,fullgame_bots,lifecycle,profile,resync,smoke}.mjs`、`packages/rules/src/{engine.ts,types.ts}`、`packages/rules/test/{rules,soak}.test.ts`（`setup.ts` 自动合并）。这些不是文本冲突而是**两套实现冲突**，只能按"保留线内内联实现 + 丢弃 `deal-room.mjs` + 手工把 `main` 的测试断言迁过来"处理。
4. `merge-tree` 只用于**发现**冲突范围，不作为提交依据；`app.js` 的冲突段必须以人工重写后的 diff 复核。

---

## 5. 必答 4：`salem-int` 未提交改动怎么处置 + #15 验收进度

`git status`（worktree `E:/Githubrepo/salem-int`，HEAD = `spec-7-int`）：
`M` `GLOSSARY.md`、`README.md`、`apps/server/package.json`、`apps/server/src/server.mjs`、`apps/server/test/{deal,fullgame_bots,reveal}.mjs`、`apps/web/{app.js,reveal-view.js}`、`packages/rules/src/engine.ts`、`packages/rules/test/pending-reveal.test.ts`；`??` `apps/server/test/run-suite.mjs`、`docs/acceptance/`（`deal-and-reveal.md` 6731B + 7 张 390×844@2x 实拍：`a-4p-deal-roles`、`d-9p-deal`、`g-12p-deal`、`i-reconnect-unacked`、`k-reveal-chooser-390`、`l-reveal-waiting-390`、`n-reveal-auto-390`）。

### 5.1 处置建议：**不要丢弃、不要留在工作区，另开分支提交，拆 3 个提交**

| 提交 | 内容 | 理由 |
| --- | --- | --- |
| ① 规则层对齐 ADR-0002 | `engine.ts`：5 处 `reason` 改 `reveal-pending`（`canPlayCard`/`drawTwo`/`endTurn`/`samuelTake`/`titubaReorder`）、`triggerReveal` 改为"可放弃优先"（`const canDecline = canDeclineReveal(...); if (hidden.length === 1 && !canDecline)` 才直接揭示）、新增 `export function defaultRevealIndex(state: GameState): number`；`pending-reveal.test.ts` 补"丹福斯 6 点遇只剩一张仍进挂起"用例并改断言 | 这是**语义修正**，不是风格调整：线内提交版本与 `main` 的 ADR-0002 结论相反，丢弃会让合并后再次分叉 |
| ② 服务端跟随 | `server.mjs`：import `defaultRevealIndex` 替换内联 `findIndex`；`armTurnTimer` 记 `room.turnActorId`，挂起期同座位不重设倒计时（防白拿一轮）；`deal.mjs`/`fullgame_bots.mjs`/`reveal.mjs` 断言同步；新增 `test/run-suite.mjs`，`package.json` 的 `test` 指向它 | `#13` 的自动揭示入口依赖服务端取"第一张未揭示"，两套算法并存必然漂移 |
| ③ 文档与验收证据 | `GLOSSARY.md`（发牌确认）、`README.md`、`docs/acceptance/deal-and-reveal.md` + 7 张截图 | 这是 #15 的验收产物，不提交就等于验收证据不可复现 |

补充理由：worktree 里未提交的改动最容易被后续 `checkout` / `clean` 抹掉（即便本次评审禁用这些命令，其他人不受限）；且这批改动混进 `ticket-14` 历史会污染"tree 相同"这条已核对的事实。

### 5.2 #15 验收进度

- issue 侧：8 个验收 checkbox **全未勾**，无评论，进度区空 → 账面上仍是 0%。
- 证据侧：`docs/acceptance/deal-and-reveal.md` 已逐条覆盖 8 条（4 人 5 张身份卡 + 2 候选、9 人 4 张末位 3 张、12 人 3 张无候选、390px 下 `scrollWidth 426 / clientWidth 316` 可横滑、未确认者重连回开牌屏、达门槛由出牌者选、超时/机器人取第一张、四条已知偏差、零泄漏扫描），另有 7 张实拍。
- **缺口**：
  1. 证据未回填 issue（无提交号 / 截图链接 / 结论），未勾选 checkbox；
  2. 四条"已知偏差"没有对应 follow-up 票号（谁认领、什么时候修都不明）；
  3. 证据文件自称"规则 52 条 / web 54 条 / 8 个脚本"，实测 web 是 **55**，属记录漂移；
  4. 服务端套件存在**可复现性瑕疵**（见 §8）：同一份代码两跑一红一绿，issue 关闭前应定位。
- 判断：**#15 具备关闭条件的技术内容，但流程上没关**；建议先把 ①②③ 落成分支提交，再把 issue 的 8 个 checkbox 勾上并附提交号与截图路径，偏差各开票。

---

## 6. 必答 5：该线是否满足 issue #7 规格

对照 #7 正文逐条（证据为 `spec-7-int` + `salem-int` 未提交改动）：

| #7 要求 | 判定 | 证据 |
| --- | --- | --- |
| 相位链 `deal → dawn → action → night → gameOver` | 满足 | `server.mjs:584-585` 复位 `dealAcks/dealDeadline`、`855-856` 进入 deal 并设 `DEAL_MS` 截止；`deal.mjs` 片一~片五 |
| 4–7 人两张候选、8+ 一张 | 满足 | `setup.ts:89-107`（`roleOptions = roleDeck.splice(0, 2)`）；`deal.mjs` 片二 |
| 20 秒兜底进黎明 | 满足 | `server.mjs:40` `DEAL_MS` 默认 20000 + `856` 截止；`deal.mjs` 片三（假时钟推进 20 秒） |
| 挂起态字段 `{targetId, chooserId, cause, canDecline}` | 满足 | `packages/rules/src/types.ts` + `engine.ts` `triggerReveal` |
| 只在指控 / 诅咒 / 替罪羊触发 | 满足 | `pending-reveal.test.ts` 覆盖嫁祸、诅咒路径 |
| 位置号寻址；`PendingRevealView = {chooserId, targetId, slots: ("hidden"\|"revealed")[], canDecline}` | 满足 | `types.ts:109` `TrialSlot`、`types.ts:112-118`；`engine.ts:992-1002` 仅在 `chooserId === viewerId` 时挂 `pendingReveal` |
| 挂起期拒抽牌 / 出牌 / 结束回合，但计时照跑 | 满足 | `engine.ts` 5 处 `reveal-pending`（未提交后）；`server.mjs` `armTurnTimer` 不重设同座位倒计时（未提交后） |
| 超时 / 托管 / 机器人取第一张未揭示 | 满足 | `#13` `autoTurn` + `resolveAutoReveal` + `applyResult` 尾部机器人即时代翻；`reveal.mjs` 三片 |
| 丹福斯 6 点可放弃 | **仅未提交改动后满足** | 线内提交版是"只剩一张直接揭示"，与 ADR-0002 相反；未提交版 `hidden.length === 1 && !canDecline` 才短路 |
| 日志「X 由 Y 选择翻开了一张身份卡（女巫）」 | 满足 | `apps/web/reveal-view.js:62` 字符串与规格一致；自动代翻补一句「取了第一个位置」 |
| 卡片条 56–64px | 满足 | `styles.css` `.trial-card { width: 60px }`；位置条 `.reveal-slots`（`styles.css:338`）`overflow-x: auto`，#14 记录 56px/格 |
| 术语「身份卡」「点数」「警长」 | 满足 | `apps/web/test/wording.test.js:34,41` 断言下发资源无「治安官」 |
| **规格文档回写** | **不满足** | `SPEC.md` §5 仍写"当前 32 条"、无挂起揭示与发牌相位段；`GLOSSARY.md` 缺「发牌确认 / 挂起揭示 / 位置号 / 可放弃」；`docs/adr/0001-deal-phase.md` 全仓不存在；ADR-0002 只在 `main` |
| **规格自身裁决** | **不满足** | #7 Decision 9「目标只剩一张未揭示时直接揭示」与 Decision 8/23 + ADR-0002「可放弃优先」冲突，未在规格里改判 |

**结论**：功能面 13/13 满足（其中 1 条依赖未提交改动），文档面 2 条不满足 → **#7 不能现在关闭**；先回写 `SPEC.md`/`GLOSSARY.md`、补 `ADR-0001-deal-phase.md`、把决策 9 改判，再关。

---

## 7. 轴线 A：Standards（仓库自身标准 + smell 基线）

**Standards 判定：不通过（文档债为主，实现风格基本合格）。**

1. `AGENTS.md` 要求"领域词以 `GLOSSARY.md` 为准"：本线新增四个概念（发牌确认 / 挂起揭示 / 位置号 / 可放弃）**均未入表**；`salem-int` 只补了「发牌确认 (Deal Ack)」，且与 `main` 的措辞不同 → 合并时必须择一，不能两套并存。
2. `AGENTS.md` 称 ADR 在 `docs/adr/`：#7 无 ADR（`0001` 不存在）；`spec-7-int` 上整个目录为空，ADR-0002 只在 `main` → 分支线的架构决策没有落盘。
3. 测试数字三处不一致：`SPEC.md` 32（`spec-7-int`）/ 47（`main`）/ 实测 52；web 证据写 54 / 实测 55。
4. 服务端测试约定：仓库用"起服务 + 端到端脚本"，`run-suite.mjs` 符合约定，但**缺 per-script 超时**、失败后不重启服务、`srv.kill()` 不等待退出 → 一次偶发失败会拖住整链（实测见 §8）。
5. 命名一致性：`reveal-pending` 与 `pending-reveal` 两套 reason 字符串并存于仓库不同 ref；ADR-0002 是唯一书面依据 → 统一为 `reveal-pending`。
6. 格式瑕疵：`apps/server/test/deal.mjs` 新增断言缩进 0 格，与上下文 4 格不一致（顺手修）。
7. 重复实现（最大 smell）：`main` 的 `deal-room.mjs` 与线内内联发牌、`main` 的 `defaultRevealIndex` 与 `#13` 内联 `findIndex`、两套 `#12` 规则 → 合并后必须只剩一套。
8. 结构 smell（不在本次合并且解决，记为技术债）：`apps/web/app.js` 单个 `handle()` 巨型 switch（冲突段 366 行内联 error 处理）；`apps/server/src/server.mjs` 660+ 行单文件，发牌/揭示/重连/托管全内联，无模块边界。

## 8. 轴线 B：Spec（对照 originating issue）

**Spec 判定：功能满足 #7（13/13，其中 1 条依赖未提交改动），#15 证据齐但 issue 未回填。**

- #12 / #13 / #14 的"结果"段自述（51 pass、`reveal.mjs` exit 0、`autoTakeTurn` 已无残留）与代码核对一致：`#13` 的 `autoTurn` 单一入口、`handleAction` 前置 `reveal`/`decline`、`no-pending-reveal` 幂等，均可在 `server.mjs` 与 `reveal.mjs` 中找到对应断言。
- #14 自述"自动代翻那句与其余人数、断线重连的实拍留到 #15" → 已由 `docs/acceptance/` 的 `l-reveal-waiting-390`、`n-reveal-auto-390`、`i-reconnect-unacked` 补齐。
- #7 的两个内部矛盾（Decision 9 vs 8/23；`canDecline` 只对"丹福斯对普通玩家的第 6 点"成立但正文未写此边界）需要在规格里改判，代码已按 ADR-0002 实现。
- #15 的 8 条验收在 `docs/acceptance/deal-and-reveal.md` 有对应证据，issue 侧 0/8 勾选 → 文档与看板脱节。

---

## 9. 实测记录（可复跑，均为只读）

| 命令（cwd） | 结果 |
| --- | --- |
| `node --test test/*.test.ts`（`salem-int/packages/rules`） | **52 pass / 0 fail**，777ms（含 48 seed soak） |
| `node --test test/*.test.js`（`salem-int/apps/web`） | **55 pass / 0 fail**，266ms |
| `node test/run-suite.mjs`（`salem-int/apps/server`，`PORT_BASE=8310`） | **exit 1**：`fake-clock bots_add.mjs` 在 `turn advances` 超时（`bots_add.mjs:34` 抛，调用点 `bots_add.mjs:70`）；其余 7 脚本通过 |
| 同上，`PORT_BASE=8340` | **8 个脚本全绿，exit 0** |
| `bots_add.mjs` 单独对 `SALEM_FAKE_CLOCK=1 DAWN_MS=4000` 的新服务连跑 6 次 | **6/6 通过** |

判读：`bots_add.mjs` 的最后一跳（`bots_add.mjs:70` 等回合推进）在"共享服务 + 前序脚本已介入"的条件下不稳定；`run-suite.mjs` 没有 per-script 超时，一旦红就拖住后续脚本。这条不影响 #7 语义，但影响"全绿"的可信度，#15 关闭前应定位（建议：给每个脚本加独立超时 + 脚本之间重启服务，或让 `bots_add` 只在机器人回合起手时断言）。
注意：早前一次 `node --test test/*.test.ts` 得 0 个用例，是因为命令里先 `cd` 到仓库根（无测试文件），不是测试缺失；真实数字为 52。

---

## 10. 需要 Lead 拍板的四件事

1. **合并源**：`spec-7-int` + `salem-int` 未提交改动（先按 §5.1 拆 3 个提交落到独立分支）。
2. **本地 `main` 是否重置到 `origin/main`**：不重置就会以"两套实现"的 13 个冲突去合，且把 `deal-room.mjs` 带进主干。
3. **reason 字符串定哪个**：`reveal-pending`（跟 ADR-0002 与 `main`）还是 `pending-reveal`（跟已合并的 #12/#13 文本与已发测试断言）。建议 `reveal-pending`，一次性改完测试与前端文案。
4. **#7 Decision 9 与 ADR-0002 的冲突**由谁裁决并回写 `SPEC.md`，同时补 `ADR-0001-deal-phase.md`。

---

## 11. 评审范围声明

- 只读命令：`git log/show/diff/merge-tree/rev-list/for-each-ref/grep`、`gh issue view`、`node --test`、`node test/run-suite.mjs`（自起服务，未写入仓库）。
- 本文件是唯一写入物；未改动任何源码、测试、配置、分支、工作区状态。
- `merge-tree` 的自动合并产物仅作冲突定位，未落盘为提交。
