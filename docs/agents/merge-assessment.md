# 合并评估：这个仓库到底做到哪了，哪些能合

评估日期 2026-11-06。基线 `origin/main` @ `d0976ae`。工作树 15 个本地分支 + 4 个远端分支 + 14 个 worktree。

---

## 一、项目实际已开发的四块内容

| 线 | 内容 | 状态 | 落在哪 |
|---|---|---|---|
| 基础局 | 规则引擎、服务端、前端牌桌、12 人 bot 压测 | **已在 main** | `4cc53d3`、`769186f` |
| 部署线 | Railway 容器化、房间失效终态、重连、发布/回滚证据 | **已在 main**（PR #22–#25） | `4686b6d`、`3c751ae`、`bd396a6`、`d0976ae` |
| spec-7 线 | 开局发牌确认（20 秒兜底）、挂起式揭示与位置号、达成者选身份卡、界面卡片条 | **全绿待合**，未进 PR | 本地 `spec-7-int` @`8b88ab1` |
| 头像/资料线 | 座位昵称与头像、个人资料弹层、七处展示面头像、头像归一化与本地存储 | **全绿待合**，已推远端未开 PR | `feat/seat-profile-lead` @`40c6a3d` |

一条主线结论：**除部署线外，全部工作都还是本地孤岛**——GitHub 上 4 个 PR 全已合，没有任何 open PR。两条产品线的活都在本地分支里，从没走过评审。

---

## 二、分支处置表

### 立刻合并（唯一两个合并源）

| 分支 | 提交 | 依据 |
|---|---|---|
| `spec-7-int` | `8b88ab1` | 线内最全；`ticket-14` 与其 tree 相同，其余全是它的祖先。server 8/8、web 55/55、rules 52/52 全绿 |
| `feat/seat-profile-lead` | `40c6a3d` | 线内最全最新（13 提交、全仓最晚、已推 origin）；13 个头像相关分支里只有它含字素簇修复 |

### 合完即删（同一份内容的重复副本）

| 分支 | 与谁重复 |
|---|---|
| `spec-7-deal-and-reveal` @`ab6214e` | `spec-7-int` 的祖先 |
| `feat/review-fixes` @`28bab1c` | `seat-profile-lead` 的祖先，只差 `profile-store.js` 20 行 + 测试 7 行（那 20 行已被 lead 吸收） |
| `feat/seat-profile` @`ed68c44` | 祖先 |
| `feat/avatars-surfaces` @`881fc1c` | 祖先 |
| `feat/profile-overlay` @`59a044a` | 祖先 |
| `feat/profile-server` @`522d5ee` | 祖先 |
| `feat/avatar-normalize` @`37c068c` | 源头提交（115 行纯决策模块 + 213 行测试），已被后续全吸收 |
| `ticket/4-profile-modal` @`e349b14` | 被 `profile-overlay` 的 `profile-store.js` 取代（52 行 `profile-state.js` → 163 行 store） |
| `ticket/5-avatars` @`f889ddd` | 与 `feat/seat-profile` tree 完全相同 |

### 直接废弃（合回去会回滚线上）

| 分支 | 原因 |
|---|---|
| `integrate/seat-profile` @`4d3969d` | 缺 `ab6214e`（#16 座位重发修复）与 main 上四个部署提交，合回会回滚 `reconnect.js`、`docs/`、`deploy-smoke.mjs`；它的 `packages/rules` 改动就是 `54ac3c6` 同一提交，无独立贡献 |

### 不要用

| 分支 | 原因 |
|---|---|
| 本地 `main` @`d401c6a` | ahead 8 / behind 4，是两条线的**早期拼装版**：`git merge-tree main spec-7-int` 出 **13 个冲突**（对 `origin/main` 只有 2 个）。8 个领先提交里 5 个已被 `spec-7-int` 包含，剩下 `d401c6a`(#12)、`83fc045`(#10) 是另一套实现（patch-id 不同）。**先 `git reset --hard origin/main`** |

### 远端

`origin/docs/rollback-note`、`origin/docs/spec-17-evidence`、`origin/integrate/spec-17-railway` 都已合入 main，可删；`origin/feat/seat-profile-lead` 是头像线的正式落点，保留待开 PR。

---

## 三、合并顺序（已实测）

### 第 0 步：把本地 main 归位

```bash
git checkout main && git reset --hard origin/main
```

保留的本地改动：`README.md` 的 2 行修改、未跟踪的 `docs/adr/0001-deal-phase.md`——先 stash 或另存，归位后再决定。

### 第 1 步：spec-7-int → main（**已在隔离 worktree 里完整演过一遍，全绿**）

为什么是它先：三条候选里只有它把 `apps/server` 的测试入口修成真跑（`test/run-suite.mjs` 起服务按组跑，替代原来匹配不到任何文件的 `test/*.test.mjs` glob），而且它顺手把基线自身的红测试修好了。

隔离验证结果（`E:/Githubrepo/_salem_wt/lead-dryrun`，基线 `origin/main` + `spec-7-int@8b88ab1`，未 commit）：

| 包 | 结果 |
|---|---|
| `packages/rules` | **52 / 52** |
| `apps/web` | **69 / 69** |
| `apps/server` | **8 / 8**（`PORT_BASE=8270`，含 resync 座位重发、12 人整局压测） |

冲突只有 2 个文件、6 段，解法已落地：

**`apps/web/sw.js`** —— 两侧各自只登记了一半模块：main 有 `/reconnect.js`，spec-7 有 `/table-view.js`、`/deal-view.js`、`/reveal-view.js`。合并后四个都要在，所以 `VERSION` 从 `salem-v2`/`salem-v4` 一起升到 **`salem-v5`**（四个模块必须同版本发布，否则老客户端拿半套脚本直接白屏），`SHELL` 与 `cacheable` 取并集。

**`apps/web/app.js`** 三段：

1. 头部 import 取并集（`reconnect.js` 的 `errorOutcome`/`closeOutcome`/`rejoinPlan`/三个常量 + 三个视图模块）。
2. `case "welcome"` 用 `adoptIdentity(msg.seatId, msg.avatars)` 再 `S.rejoining = false`——`adoptIdentity` 内部已写 `S.seatId` 与头像表，不比原来多写一遍少。
3. `case "error"` **必须手写**：Git 的自动合并产物在 367–371 行已损坏（括号不配对、`outcome` 未定义）。正确语义以 `apps/web/reconnect.js` 的 `errorOutcome()` 为准——只有 `room-not-found` 分 `room-gone`/`join-failed`，`no-seat` 走 `transient`（注释写明：那个码只从 action 与踢人目标校验发出，房间还在）。spec-7 侧那份把 `no-seat` 也判房间失效的内联清态是重复实现，丢弃。

连带两处测试断言：`apps/web/test/deal-shell.test.js:33`、`apps/web/test/reveal-shell.test.js:46` 把 `VERSION` 钉死成 `"salem-v4"`，跟着改成 `"salem-v5"`。

> 脆点：这两处断言把版本号当字符串钉死，**以后每次合并都要记得改**。建议改成「VERSION 与 SHELL 内容自洽」的断言（例如断言 VERSION 不在历史值集合里、且 SHELL 覆盖 `apps/web/*.js` 全部模块）。

### 第 2 步：feat/seat-profile-lead → main

它从 `769186f` 长出来，比 spec-7 线的基线（`9af776a`）**老一个提交**，所以 6 个冲突免不了：

| 文件 | 冲突性质 | 取法 |
|---|---|---|
| `apps/server/src/server.mjs` | content | 取本线整份。它的 `checkAvatar` 是三道路径校验（前缀 + magic bytes + 解码后体积），比 `9af776a` 的 `parseAvatar` 严；`#16` 那部分已被 spec-7 线带走，不会丢 |
| `apps/server/test/profile.mjs` | add/add | 取本线整份 |
| `apps/web/avatar-normalize.js` | add/add | 取本线整份，**并删 `apps/web/test/avatar-normalize.test.js`** |
| `apps/web/package.json` | add/add | test glob 必须**同时**跑 `.test.js` 与 `.test.mjs`，照抄任一侧都会静默漏跑一半用例 |
| `apps/web/app.js` | content | 三方融合（见下） |
| `apps/web/sw.js` | content | 在本步基础上再升版本，补 `/profile-store.js` |

关于 `avatar-normalize.js`——**这是两条互不兼容的实现，不是新旧关系**：

- `9af776a`（main）版 98 行：`cropRect`/`AVATAR_TIERS`/`tierAt`/`encodingPlan`/`dataUrlMime`/`matchesMime`/`isTargetDataUrl`/`withinBudget`/`budgetVerdict(bytes, budget, tierIndex)`，**全仓零 import 方，只有它自己的测试在引用**，`app.js` 根本没接线。而且这份测试本身是红的（`SyntaxError: ... does not provide an export named 'AVATAR_BUDGET_BYTES'` ——测试用新 API、实现是旧 API）。
- `37c068c`（feat 线）版 115 行：`squareCropRect`/`AVATAR_REGULAR_TIER`/`AVATAR_DOWNSCALED_TIER`/`AVATAR_BUDGET_BYTES`/`AVATAR_TARGET_MIME_PREFIXES`/`tierFor`/`encodingCandidates`/`isTargetAvatarDataUrl`/`budgetVerdict(bytes, budget, reduced)`/`estimateDataUrlBytes`，**216 行测试全绿，`app.js` 全面接线**。

两个提交时间只差 **114 秒**（`37c068c` 00:50:03、`9af776a` 00:51:57），是同一份规格被并行做了两遍。合并取 feat 线那套，main 那套连同测试一起删。注意两边都导出 `budgetVerdict` 但**参数签名不同**，混用会静默算错。

`app.js` 三方融合的两个硬点：

1. **头像数据结构不一致**：spec-7 线用 `S.avatars = new Map()`（配 `avatarSrc`/`avatarUrls`/`releaseAvatar`/`resetAvatars`/`setAvatar` 五个函数），profile 线用 `S.avatars = {}` 普通对象 + `profileStore`。必须二选一——建议统一到 profile 线的对象形式（它配 `msg.avatars` 投影，且 `profileStore.maybeReupload` 依赖它），把 spec-7 那五个函数改成对象读写。
2. `initialOf` 重复定义：spec-7 线自己在 `app.js` 里定义了一份（因为它的基线还没有 `profile-store.js`），合并后要从 `profile-store.js` 导入、删掉本地那份。字素簇版本（`firstGrapheme`）是修 `#5`「emoji 首字完整」判据的必要实现，别丢。

### 第 3 步：清理

- 删第二节里「合完即删」的 9 个分支 + 3 个远端分支。
- **14 个 worktree 是这次混乱的真正来源**（`E:/Githubrepo/_salem-wt/`、`_salem_wt/`、`salem-int`、`salem-wt-10..14` 两套命名并存），合并完统一 `git worktree remove`，只留主工作区。
- `apps/web/test/avatar-normalize.test.js` 删除后，`#3` 票面记载的导出名/测试文件名/提交号全部过时，要补一条更正 comment，否则后人会去 grep 不存在的函数。

### 第 4 步：落地方式（已按仓主指令直推 main，原建议为 PR）

这个仓库的既有节奏是 PR（#22–#25），本可两条线各开一个 PR。实际执行时仓主明确要求「合并后 push」，且 `main` 没有分支保护，因此直接 ff 到 `main` 再 push，保留完整 merge 历史——squash 会把 spec-7 线 24 个提交压成一个，丢掉逐票记录。测试矩阵：

```
server 8/8 (PORT_BASE=8280) · web 69/69 · rules 52/52
```

`#7` 关单前还差文档面：`SPEC.md` 仍写「32 条」且无挂起揭示段、`GLOSSARY` 缺 4 个术语、`#7` Decision 9 与 `ADR-0002` 冲突未改判。
`#15` 的验收证据已齐（8 条含 7 张实拍），但 issue 侧 0/8 勾选，且 `run-suite.mjs` 存在**顺序敏感**现象（连跑时 `bots_add` 偶发 `turn advances` 超时），关单前应定位。

---

## 四、三个已确认的既有缺陷（与合并无关，别记在合并账上）

1. **`apps/server` 的 `npm test` 是空跑**：脚本写 `node --test test/*.test.mjs`，而 `test/` 下没有一个文件叫 `*.test.mjs`。Node 24 对空匹配静默 exit 0——**看起来绿，其实一个用例都没跑**。`spec-7-int` 的 `run-suite.mjs` 修的就是这个。
2. **基线红**：`origin/main` 的 `apps/web/test/avatar-normalize.test.js` 报 `SyntaxError`（见上）。已合 spec-7-int 后会顺带变绿。
3. **`resync.mjs` 曾经红过**：`AssertionError: 房主 在踢人后没收到 resync`，在 `spec-7-int` 的纯净检出上同样复现，属分支自身缺陷；`8b88ab1` 前后三个提交已修，最新检出 8/8 全绿。

另注：暴力跑 server 脚本时若本机 8080/8101/8102/8190 被占，会得到 `EADDRINUSE` 或 180s 超时的假红——一律用 `PORT_BASE` 换段复跑再判断。

---

## 五、评估依据

- 三份并行只读评审：`docs/agents/merge-review-spec7.md`、`merge-review-profile.md`、`merge-review-tests.md`
- 隔离 worktree 实合：`E:/Githubrepo/_salem_wt/lead-dryrun`（`origin/main` + `spec-7-int@8b88ab1`，冲突已解、三包全绿，随后在该分支 commit 为 `fb81db6` 并 ff 进 `main`）
- `git merge-tree` 冲突量化、`git cherry` 等价性判定、`git diff --stat` 逐分支比对

---

## 六、执行结果（2026-11-06）

1. 本地 `main` 已从 `d401c6a` 归位到 `origin/main@d0976ae`。那 8 个独有提交的内容分别已被 `spec-7-int` 与 `feat/seat-profile-lead` 覆盖，不需要再抢救。
2. `spec-7-int@8b88ab1` 已合入 `main`，merge commit `fb81db6`，已推送：`d0976ae..fb81db6  main -> main`。
3. 合并后实测：`packages/rules` 52/52、`apps/web` 69/69、`apps/server` 8/8（`node apps/server/test/run-suite.mjs`，`PORT_BASE=8280`）。冲突只在 `apps/web/app.js` 与 `apps/web/sw.js` 各 3 段，取法见 commit message 与上文第 1 步。
4. `docs/adr/0001-deal-phase.md` 与 `docs/adr/0002-pending-reveal.md` 此前只存在于被弃的拼装提交 `d401c6a` 里（`origin/main` 上 ADR 编号从 0003 起，有洞）。两份已取出并随本次一并入库。
5. 尚未做：第 2 步（`feat/seat-profile-lead`）——卡在 `avatar-normalize.js` 两套 API 的取舍；第 3 步分支与 worktree 清理。
