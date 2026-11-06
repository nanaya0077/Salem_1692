# 合并评审：头像/座位资料线（issue #1–#5）

- 评审对象：`feat/seat-profile-lead`（head `40c6a3d`），合并目标 `origin/main`（`d0976ae`）。
- 两侧 merge-base：`769186f`。
- 试算：`git merge-tree --write-tree origin/main feat/seat-profile-lead` → tree `549800a`，6 个文件冲突。
- 本次评审只读：没有执行 commit / merge / push / checkout / stash / reset / clean / rebase / cherry-pick，没有改动任何源码、测试、配置。本文是唯一写入的文件。

---

## 结论速览

| # | 问题 | 结论 |
|---|---|---|
| 1 | `feat/seat-profile-lead` 是否本线最全最新 | **是**。13 个提交、逐票 merge、`review-fixes` 是其祖先、`40c6a3d`（02:55）全仓库最晚、已推 origin。`review-fixes → lead` 那 20 行**必要**，但带来一处必须顺手删的重复注释。 |
| 2 | `origin/main` 的 `9af776a` 与本线关系、保留哪份 | **同一 spec 的第二次落地，不是本线的祖先**。服务端/测试取本线；`avatar-normalize.js` 二选一，取本线（有消费者），main 那份是死代码。 |
| 3 | 6 个冲突的性质与取舍 | 3 个 content（`server.mjs`、`app.js`、`sw.js`）、3 个 add/add（`profile.mjs`、`avatar-normalize.js`、`package.json`）。只有 `app.js` 必须 hunk 级并集，其余可直接整份取一侧。 |
| 4 | `integrate/seat-profile` 是否废弃 | **废弃**。它是 spec-7 线的旧快照，比 `ab6214e`（#16 修复）和 origin/main 各落后一段；其 `packages/rules` 改动就是 `54ac3c6` 同一个提交，不是独立工作。 |
| 5 | `profile-state.js` vs `profile-store.js` 谁被继承 | **`profile-store.js` 胜出**：`feat/profile-overlay` → `1123fa7` → `3242e4d` → `28bab1c` → `40c6a3d`。`profile-state.js` 只活在 `ticket/4`、`ticket/5`、`feat/seat-profile` 三条互不续接的支上，没有任何后续分支 import 它。 |

---

## Standards 轴

仓库**没有** `CODING_STANDARDS.md`，也**没有** `CONTRIBUTING.md`。可作为标准的只有：`AGENTS.md`（领域词以 `GLOSSARY.md` 为准）、`README.md` 的测试清单（事实上就是验收基线）、以及 `apps/server/test/` 里既有测试的写法。

符合的部分：

- 领域词进了 `GLOSSARY.md`（`40c6a3d` 前一笔新增「个人资料 (Profile)」「补传 (Re-upload)」两条），符合 `AGENTS.md`「写票、提方案、起测试名都用里面的词」。
- 测试命名与结构沿用既有先例：`node:test` + `node:assert/strict` + 中文测试名，与 `packages/rules` 一致。
- `apps/server/test/profile.mjs` 自起服务器（随机空闲端口 + spawn `src/server.mjs`），不依赖外部先起 8103。这比 main 侧那版（`BASE` 默认 `http://127.0.0.1:8103`，需人工先起服务）更接近仓库其它测试的自足基线。
- `sw.js` 升了 `VERSION`（`salem-v2` → `salem-v3`），符合该文件自身的注释要求。
- `README.md` 测试清单同步补了三行（`profile.mjs`、`cd apps/web && npm test`、`scripts/verify-avatars.mjs`）。

不合规/需要处理的：

1. **`apps/web/profile-store.js:34-50` 两段 JSDoc 摞在一起**。`L34-41` 是旧注释（「按字符（码位）取」），`L42-50` 是 `40c6a3d` 新增的注释（「优先按字素簇取」），中间没有删除动作，于是同一函数头上挂着两段互相矛盾的说明，而实现走的是 `firstGrapheme`。合并前删掉 `L34-41` 那一段。这是本次评审唯一要求动代码的地方。
2. **`apps/web/package.json` 的 `scripts.test` 是个陷阱**。main 侧是 `node --test test/*.test.js`，本线是 `node --test test/*.test.mjs`。合并后 `apps/web/test/` 里会同时存在 `.test.js`（main 的 `reconnect.test.js`）与 `.test.mjs`（本线的 `avatar-normalize.test.mjs`、`profile-store.test.mjs`）。任一字面量照抄都会让另一侧的测试**静默不跑**——不是报错，是不执行。
3. **`scripts/verify-avatars.mjs` 需要本机 Chrome 才会跑通**，但它被写进了 README 的测试清单。文件头已注明「不新增 npm 依赖，也不进 npm test」，这是可接受的；只是文档读者要能看出这一条不是 CI 必过项。
4. 没有发现 `console.log` 残留、没有发现跳过/独占测试（`.skip`/`.only`）、没有新增依赖。

代码坏味道（Fowler 基线，非阻塞）：同一职责两套模块名（`profile-state.js` / `profile-store.js`）、同一职责两份实现（两条线的 `avatar-normalize.js`）、main 上有一份无人 import 的模块（死代码）。

---

## Spec 轴

票面：`#1` 母票（OPEN），`#2`–`#5` 全部 CLOSED。

逐票对照：

- **#2 服务端 profile 消息与头像校验**：9 条判据在两侧实现里都能找到对应（改名双写、提示恰好一条、头像单独广播、welcome 全量、96KB 上限、magic bytes、1 秒硬闸、改不到别人、room/projection 无 `data:image`）。本线 `profile.mjs` 的 12 个 step **覆盖了全部 9 条**，另外多测了「没变化的写入不占闸」「越权 seatId 只改自己」「移除后重连 welcome 里消失」「零泄漏」。判据满足。
- **#3 头像归一化纯函数模块**：判据全部满足，但**导出面与票面记录不一致**（详见 Q2）。
- **#4 个人资料弹层与三处入口**：9 条判据逐条有对应实现（共用一个弹层、提交式、`accept=image/*` 且无 `capture`、降档重试一次、移除同步清两侧、换设备幂等补传、配额写满只降级）。`profile-store.js` 的 250 行测试覆盖了配额降级与补传幂等这两个最容易漏的分支。
- **#5 所有展示面换成头像**：六条判据由 `881fc1c`（七处展示面 + 同帧回落）+ `ec21cc9`（`initialOf` 纯函数）+ `40c6a3d`（字素簇）覆盖，`scripts/verify-avatars.mjs` 是唯一真起浏览器逐面点数的地方。判据满足。

Spec 轴上的**实质问题只有一个**：`#3` 和 `#5` 的正文把交付写成了另一条线上的提交号与导出面。

- `#3`「落地情况」写明导出 `cropRect` / `AVATAR_TIERS` / `tierAt` / `encodingPlan` / `dataUrlMime` / `matchesMime` / `isTargetDataUrl` / `withinBudget` / `budgetVerdict`，测试 16 条，提交 `9af776a`（首版）+ `97fd841`（评审收敛）。
- `#5`「实施结果」写明提交 `c865f94`（`avatarChip(seatId,name)` 七处展示面 + `S.avatarUrls` blob 缓存）+ `d0f407f`（字素簇首字）。

这两段描述的是 **9af776a 那条线的实现**，不是本线。本线的对应物是 `37c068c`（`avatar-normalize.js`，另一套导出面）与 `881fc1c`/`ec21cc9`/`40c6a3d`。所以合并完成后必须给 `#3` 补一条更正 comment（导出面、测试文件名、提交号），否则下一轮读票的人会去 grep 不存在的函数名。这不是代码缺陷，是记录缺陷，但它会让整个后续排查走错方向。

顺带：#5 票面自己写了「票里写的 `Array.from(name)[0]` 兑现不了 AC（🇨🇳→🇨、👨‍👩‍👧→👨），实测必须按字素簇」。这条自述与本线 `40c6a3d` 的做法一致，可以互证。

---

## Q1 `feat/seat-profile-lead` 是否本线最全最新？那 20 行是否必要？

**是最全最新**，四条独立证据：

1. 提交数 13（距 `769186f`），比 `feat/seat-profile` 的 10 多，且包含 `#2`/`#3`/`#4`/`#5` 四个 merge 提交（`94b5d61`/`093afb4`/`1123fa7`/`3242e4d`），是把五张票串成一条可验证链的唯一分支。
2. `feat/review-fixes` 是它的祖先（`git merge-base --is-ancestor feat/review-fixes feat/seat-profile-lead` 成立），即双轴评审收敛（`28bab1c`）已在其中。
3. `40c6a3d`（02:55）是全仓库该话题最晚的提交；`feat/seat-profile` 停在 01:38，`integrate/seat-profile` 停在 02:31。
4. 相对 `feat/seat-profile` 是严格超集加一处替换：`profile-store.js`（163 行）替代 `profile-state.js`（52 行），多出 `scripts/verify-avatars.mjs`（461 行 E2E），其余文件都是本线更新。

**那 20 行逐行说明**（`feat/review-fixes` → `feat/seat-profile-lead`，`apps/web/profile-store.js` +20/−1、`apps/web/test/profile-store.test.mjs` +7）：

- `profile-store.js:42-50`（+9 行）：新增 JSDoc —— 说明「优先按字素簇取，组合 emoji 是一个整字素簇，按码位取只会拿到其中一段」，并注明无 `Intl.Segmenter` 的环境退回码位取。
- `profile-store.js:34-41`（应删除但被保留）：旧 JSDoc，说明「按字符（码位）取」。**这 9 行是本次唯一的代码清理项。**
- `profile-store.js` 函数体 −1/+1：`if (!text) return Array.from(DEFAULT_NAME)[0];` → `return firstGrapheme(text || DEFAULT_NAME);`。空值回落语义不变，取字逻辑下沉。
- `profile-store.js:56-64`（+8 行）：新增 `firstGrapheme(text)` —— 有 `Intl.Segmenter` 时用 `{ granularity: "grapheme" }` 取 `segments[Symbol.iterator]().next().value.segment`，否则 `Array.from(text)[0]`。
- `test/profile-store.test.mjs`（+7 行）：新增一条组合 emoji 用例，断言 `👨‍👩‍👧` / `🇨🇳` / `👍🏽` 三种序列的首字是整个字素簇。

**必要性判定：必要，不能省。** 依据是 `#5` 的判据「用 emoji 当昵称时首字圆牌显示完整的那个 emoji，不出现乱码方块」和 `#5` 正文的实测结论（`Array.from(name)[0]` 对 ZWJ 序列与国旗序列都只取到一段）。少了这 20 行，该判据在 `👨‍👩‍👧`、`🇨🇳`、`👍🏽` 三类昵称上是**真失败**（`👍🏽` 还会丢掉肤色修饰符），不是风格问题。

另外说明一笔：`28bab1c`（`review-fixes` 本体）不是 20 行，是 106+/124−，五项修复——重连改名双写、硬闸只被真写入消耗、base64 串长前置校验、去掉 EXIF 二次旋转、PNG 兜底提示。这五项每一项都对应一条会出现在玩家面前的错误行为，必须随本线一起进。

---

## Q2 `origin/main` 的 `9af776a` 与本线什么关系？合并保留哪一份？

**关系：同一 spec 的第二次落地，不是本线的祖先，也不是本线的前身。**

- `git merge-base --is-ancestor 9af776a feat/seat-profile-lead` → 不成立。两侧共同祖先是 `769186f`。
- 时间上 `9af776a`（00:51）比本线的 `#3` 提交 `37c068c`（00:50）晚一分钟，两者是**并行**的两份，不是先后关系。
- `9af776a` 只交付了服务端协议（`server.mjs` +116）、服务端测试（`profile.mjs` +245）、归一化模块（`avatar-normalize.js` +98）、其单测（+122）、`apps/web/package.json`（+9）。**它没有碰 `app.js`、`index.html`、`styles.css`、`sw.js`**——也就是说 main 上这套东西一个界面入口都没有，`grep` `avatar-normalize|profile-store|initialOf|profileModal|type: "profile"` 在 main 的 `app.js` 里零命中，圆牌仍是 `esc(seat.name.slice(0, 1))`。它是「服务端与决策层先行、客户端未接」的半套。
- 相反，两条线的服务端实现语义逐条相同（同一条 `#2` spec 的两次落地），说明确实同源；差异只在写法：本线多了 4 处座位构造的 `avatar: null` 初始化，main 侧多了 `broadcastRename` 与 `applySeatName` 返回 `{before, after}`。

**保留哪一份：以本线为唯一来源，main 侧只作参考。**

| 文件 | 取哪侧 | 依据 |
|---|---|---|
| `apps/server/src/server.mjs` | 本线 | 语义等价，但本线有 `avatar: null` 初始化（座位字段形状一致）；main 侧无任何客户端消费者。 |
| `apps/server/test/profile.mjs` | 本线（399 行） | 12 个 step 是 main 侧（245 行）的严格超集，且自起服务器。main 侧缺「硬闸消耗、越权、移除、零泄漏、重连改名」五项。 |
| `apps/web/avatar-normalize.js` | **本线（115 行）** | main 侧（98 行）**没有任何 import 方**，仅有自己的单测；本线版被 `app.js` 与 `profile-store.js` 使用。API 不兼容（见下）。 |
| `apps/web/test/avatar-normalize.test.js` | **删除** | 它钉的是 main 那套导出面，模块被替换后必然红。本线的 `test/avatar-normalize.test.mjs`（213 行）替代它。 |
| `apps/web/package.json` | 取并集 | 见 Q3-5。 |

两套 API 不兼容的具体表现（这是唯一必须「整份替换」而不是合并的地方）：

- main：`cropRect` 返回 `{ x, y, size }`；`AVATAR_TIERS` 是 `[{name:"normal",edge:256,quality:0.82},{name:"reduced",edge:160,quality:0.7}]`；另有 `tierAt`、`encodingPlan`、`dataUrlMime`、`matchesMime`、`isTargetDataUrl`、`withinBudget`、`budgetVerdict`。
- 本线：`squareCropRect` 返回 `{ sx, sy, size }`（非法尺寸返回 `{sx:0,sy:0,size:0}`）；`AVATAR_REGULAR_TIER`/`AVATAR_DOWNSCALED_TIER`/`AVATAR_BUDGET_BYTES`(40KB)/`AVATAR_TARGET_MIME_PREFIXES`/`tierFor(reduced)`。

同名文件、同名概念、不同函数名与不同返回字段。任何「两边都留」的方案都会让 `app.js` 里的 import 名对不上。

**随之而来的后果（必须记录）**：`#3` 票面认可的导出面是 main 那一套。取本线等于**推翻票面记录**。处理方式二选一，合并时必须选一个并留痕：
1. 合并后给 `#3` 补一条更正 comment（推荐，成本一行）；
2. 或者合并前先改本线的导出名去对齐 main —— 这要动 `app.js`、`profile-store.js` 与两份测试，收益为零。

---

## Q3 六个冲突逐个说明

试算结果：`git merge-tree --write-tree origin/main feat/seat-profile-lead` = tree `549800a`，冲突 6 个。

1. **`apps/server/src/server.mjs` — content**
   两侧都在 `769186f` 的同几个位置加了 profile 相关代码（`handleMessage` 的 `profile` 分支、`welcome` 的 `avatars`、`joinRoom` 的重连改名、座位构造）。冲突块数不多但位置重叠。
   取舍：**整份取本线**。依据：语义等价（`#2` 九条判据两边都有）、本线多座位字段初始化、main 侧无客户端消费者。**风险点已排除**：`git log origin/main -- apps/server/src/server.mjs` 只有 `9af776a` 与 `8c12ac7`，即 main 上这个文件除 `9af776a` 外没有别的改动（`3c751ae` 的 room-gone 只改了前端），所以取本线不会丢 main 的任何东西。

2. **`apps/server/test/profile.mjs` — add/add**
   两侧各自新建同名测试文件，内容不同（245 行 vs 399 行）。
   取舍：**整份取本线**。依据见 Q2 表格：本线是超集。

3. **`apps/web/app.js` — content**
   **这是 6 个里唯一必须 hunk 级并集、不能整份取一侧的。**
   main 侧在这个文件上的全部改动来自 `3c751ae`（+153/−35）：房间失效终态与重连——`import ./reconnect.js` 的 `closeOutcome`/`errorOutcome`/`rejoinPlan`、`resetRoomState`、`enterRoomGone`、`landingSubmit`、`createRoom`、`reopenBtn`。
   本线侧是 `#4`/`#5` 的 380 行：profile 弹层、七处展示面的 `avatarChip`、`initialOf` 回落、`profile-store` 接线。
   **两边改的是同一批函数区域**（`connect` 的 open/close 处理、回到落地页的路径），所以是真正的语义冲突，不是排版冲突。
   取舍原则：**两块都要，按 hunk 分区**。main 侧只保留 `3c751ae` 引入的 room-gone / 重连 / landingSubmit 块；本线侧保留 profile 弹层与七处展示面。任何「取一侧」的做法都会静默丢掉一项已上线的能力——取本线会删掉 #19/#23 的房间失效终态，取 main 会删掉整个头像线与弹层。

4. **`apps/web/avatar-normalize.js` — add/add**
   两套不兼容 API（见 Q2）。
   取舍：**整份取本线**，并同时删除 main 侧 `apps/web/test/avatar-normalize.test.js`。依据：main 那份零 import 方，是死代码；本线那份有两个消费者。

5. **`apps/web/package.json` — add/add**
   main：`"test": "node --test test/*.test.js"`；本线：`"node --test test/*.test.mjs"`，另有 `@salem/web` 包名与空的 `dependencies`。
   取舍原则：**取并集，而并集不能用任何单一后缀字面量表达**。合并后 `test/` 里会同时有 `.test.js`（main 的 `reconnect.test.js`）与 `.test.mjs`（本线的两份）。照抄任一侧都会让另一侧**不执行且不报错**——这比冲突本身更危险，因为 CI 会绿。
   可行做法（择一，不改代码只改这一个字段）：`node --test test/`（跑目录），或覆盖两种后缀的 glob。同时保留 `@salem/web` 与空 `dependencies`（`#3` 判据要求「零新增依赖」）。

6. **`apps/web/sw.js` — content**
   main：`VERSION = "salem-v2"`，缓存清单含 `/reconnect.js`，不含 avatar 模块。本线：`VERSION = "salem-v3"`，含 `/avatar-normalize.js`、`/profile-store.js`，**不含 `/reconnect.js`**。
   取舍：**以本线 `salem-v3` 为基，补回 `/reconnect.js`，版本号升到 `salem-v4`**。依据：`sw.js` 自身注释要求「改脚本必须升版本号」；合并后要缓存的文件是三项，任漏一项都会让老客户端拿到 404 的模块——`/reconnect.js` 漏了，房间失效终态在缓存命中时会直接抛错。

---

## Q4 `integrate/seat-profile` 是否废弃？其 `packages/rules` 改动是否与 spec-7 线重复？

**废弃。**

- 它是 `9af776a` 之后的一条旁支：merge-base 与 origin/main 是 `9af776a`，即 main 上 `4686b6d`(Dockerfile)、`3c751ae`(房间失效终态)、`bd396a6`、`d0976ae` 四个提交它都没有。把它合回 main 会**删掉** `apps/web/reconnect.js`(85 行)、`docs/adr/` 若干、`scripts/deploy-smoke.mjs`(79 行) 与 README/文档的整段内容——diff 里那些「减号」不是冲突，是回滚。
- 它也比 spec-7 线落后一个提交：`ab6214e`（`#16` 座位重编号后原子重发座位号与头像，02:35）不在它的历史里（`ab6214e` 不是 `4d3969d` 的祖先）。也就是说 `#16` 的修复它没有。
- 它内部的 `#4` 工作是**重放**而非原创：`a12eb1a`「抽出个人资料纯存储模块」与 `79a6424`「个人资料弹层与三处入口」，提交信息与本线的 `686fc00`/`59a044a` 一字不差，只是 SHA 不同（rebase/重放）。它的 `profile-store.js` 是 133 行旧版，还 `import { isTargetDataUrl }` 绑着 main 那套 API；本线是 163 行新版。

**`packages/rules` 那部分：与 spec-7 线重复，而且是同一个提交。** `integrate/seat-profile` 里的规则层改动就是 `54ac3c6`「规则层：开局发牌相位与角色二选一 (#9)」，它在 `spec-7-deal-and-reveal` 的历史里也能看到（`ab6214e` 的祖先链）。所以这一块不是 `integrate` 的独立贡献，是 spec-7 线工作的搭车。从 `integrate` 取任何东西都是负收益——要规则层就从 spec-7 线取。

**结论：`integrate/seat-profile` 不进入合并路径，也不再作为对照物。** 需要 spec-7 线的内容时，直接对 `spec-7-deal-and-reveal` / `spec-7-int` 评审。

---

## Q5 `ticket/4-profile-modal` 的 `profile-state.js` 与 `feat/profile-overlay` 的 `profile-store.js`，哪套被继承？

**`profile-store.js` 被继承，`profile-state.js` 是死支。**

被继承的证据（git 图，不靠提交信息）：

```
686fc00（抽出纯存储模块）→ 1123fa7(merge #4) → 3242e4d(merge #5) → 28bab1c(review-fixes) → 40c6a3d
```

这条链上 `apps/web/profile-store.js` 一路存在并被 `app.js` import。反过来，`profile-state.js` 只出现在三处：`ticket/4-profile-modal`、`ticket/5-avatars`、`feat/seat-profile`——后两者 tree 完全相同（`git diff` 无输出），是同一份快照；三条支都没有后继分支 import 它。

职责对比（不是「谁更好」，是「谁被继续维护」）：

| | `profile-state.js`（52 行） | `profile-store.js`（163 行） |
|---|---|---|
| 导出 | `PROFILE_NAME_MAX`、`PROFILE_DEFAULT_NAME`、`sanitizeProfileName`、`buildProfileMessage`、`shouldPushStoredAvatar` | `NAME_KEY`、`AVATAR_KEY`、`NAME_MAX`、`DEFAULT_NAME`、`cleanName`、`initialOf`、`createProfileStore` |
| 形态 | 一组决策函数（消息怎么拼、要不要补传） | 一个注入 `storage` 的 store（读、写、配额降级、补传幂等、移除清本地） |
| 覆盖的判据 | `#4` 的部分（提交式、补传幂等） | `#4` 全部九条 + 配额降级 + 移除同步 |
| 路径依赖 | 无 | `import` `avatar-normalize.js` 的目标格式白名单 |

所以 `profile-store.js` 不只是「名字不同」，它把 `#4` 里最容易出错的两块（写满配额时只降级不阻断改名、换设备幂等补传一次）做成了可注入 storage 的对象，250 行测试才能把这俩分支钉住。合并后 `profile-state.js` 及其测试不应出现在 main 上。

**顺带一个判断**：`#4` 在 `integrate/seat-profile` 里还有第三份（133 行，绑旧 API）。三份同名模块同时存在，是这个仓库当前最需要收敛的重复——合并只留 `profile-store.js`（163 行）那一份，另外两份随 `integrate` 与 `ticket/*` 一起不进 main。

---

## 给执行者的合并动作清单

不写代码，只写顺序与取舍依据：

1. 以 `feat/seat-profile-lead`（`40c6a3d`）为合并源，向 `origin/main`（`d0976ae`）合并。
2. `apps/server/src/server.mjs`、`apps/server/test/profile.mjs`、`apps/web/avatar-normalize.js`：整份取本线。
3. 删除 `apps/web/test/avatar-normalize.test.js`（main 侧，钉旧导出面）。
4. `apps/web/app.js`：hunk 级并集——main 的 room-gone / 重连 / `landingSubmit` 与 本线的 profile 弹层 / 七处展示面都要在。**合完必须单独打开落地页并按一次断线重连确认房间失效提示还在。**
5. `apps/web/sw.js`：`salem-v4`，缓存清单 = `/reconnect.js` + `/avatar-normalize.js` + `/profile-store.js`。
6. `apps/web/package.json`：`scripts.test` 改成能同时跑 `.test.js` 与 `.test.mjs` 的写法（跑目录或双后缀 glob），保留 `@salem/web` 与空 `dependencies`。
7. 清理 `apps/web/profile-store.js:34-41` 那段陈旧 JSDoc。
8. 合完按 README 清单跑：`node apps/server/test/profile.mjs`、`cd apps/web && npm test`、`node --check apps/web/app.js`、`node apps/server/test/smoke.mjs`、`node apps/server/test/lifecycle.mjs`、`node scripts/verify-avatars.mjs`（需本机 Chrome）。
9. 给 `#3` 补一条更正 comment：导出面以本线为准，测试文件是 `test/avatar-normalize.test.mjs`，`test/avatar-normalize.test.js` 已删。
10. `#1` 母票仍 OPEN，四条子票全 CLOSED，合完后按 `docs/agents/issue-tracker.md` 收口 `#1`。

---

## 遗留风险与未决

1. **`#16` 的修复会在下一次合并里二次冲突**。`ab6214e`（座位重编号后原子重发座位号与头像）只存在于 `spec-7-deal-and-reveal` 及其后继，本线没有。本线先合的话，spec-7 线再合时 `app.js` 会第二次撞在同一区域，届时还要处理 `spec-7-int` 的 `app.js:107` 自带的那份 `initialOf`（与 `profile-store.js` 的同名函数重复定义）。
   建议：本线先合，随后立即在 spec-7 线把 `app.js:107` 的本地 `initialOf` 换成从 `profile-store.js` import，再合 spec-7 线。
2. **`avatar-normalize.js` 的 API 换血没有票面背书**（见 Q2）。补 `#3` comment 是必做项，不是可选项。
3. **`.test.js` / `.test.mjs` 双后缀**是本仓库第一次出现，`package.json` 的 glob 一旦写错，测试会绿着漏跑。合完请人工确认新侧两份测试确实被执行（`node --test` 的输出里能看到用例名）。
4. **`scripts/verify-avatars.mjs` 依赖本机 Chrome**，CI 上不跑。它验证的是 `#5` 七处展示面这部分最不容易被单测覆盖的判据，长期应视作「发布前手工跑一次」的检查项，而不是可选项。
5. 本文只评审 `#1`–`#5` 这条线。`integrate/seat-profile` 里的 `packages/rules` 改动与 `spec-7` 线的关系，按 Q4 已判定为同一提交，规则层本身未做代码评审。
