# 候选分支可合并性验证（测试矩阵）

- 执行时间：2026-11-06 11:44–11:58（Asia/Shanghai）
- 执行者：test-runner
- 机器：Windows，Node v24.14.1，npm 11.11.0
- 约束：只读仓库（除本文件），未做 commit / merge / push / checkout / stash / reset / clean，未改任何源码或测试；仅在 `apps/server` 下装过一次 `ws` 依赖。

## 1. 结论：能不能合

| 站点 | 分支 | HEAD | 三包结论 | 判断 |
| --- | --- | --- | --- | --- |
| 1 基线 | origin/main | d0976ae | web **1 红**、rules 绿、server 入口空跑 | 基线本身不是绿的，不能当"对照全绿"用 |
| 2 候选 | spec-7-int | 8b88ab1 | server 8/8、web 55/55、rules 52/52 | **可合**，且它把 server 测试入口修成真跑 |
| 3 候选 | feat/seat-profile-lead | 40c6a3d | server 5/5（隔离）、web 45/45、rules 32/32 | **可合**，同时修掉基线的那 1 红 |
| 4 候选 | feat/review-fixes | 28bab1c | server 5/5（隔离）、web 44/44、rules 32/32 | **可合**，是 3 号分支的收尾版 |

三个候选分支都**没有发现自身逻辑回归**：在没有端口污染的隔离环境里，每个能自动跑的脚本和用例全部通过。

但有一条硬问题必须在合并决策里算进去：

> **`apps/server` 的 `npm test` 在基线、feat/seat-profile-lead、feat/review-fixes 上都是空跑（0 用例，exit 0）。**
> 三个分支的 `package.json` 都是 `node --test test/*.test.mjs`，而 `test/` 下只有 `*.mjs`、没有 `*.test.mjs`；Node 24 对零匹配的 glob 不报错，直接 0 用例成功退出。
> 也就是说，"server 包测试通过" 这几个字在 1/3/4 号站点**不成立**——只能说"无自动回归覆盖"。只有 spec-7-int 把入口换成了 `node test/run-suite.mjs`，server 才真正跑起来（8 个脚本）。

## 2. 口径说明（为什么有两套结果）

测试入口按任务给的定义跑（官方口径），另外做了一套隔离补跑：

- **官方口径**：进包目录直接 `npm test`，结果可复现但受"用哪个端口"和"依赖装没装"影响。
- **隔离补跑**：`apps/server` 的历史脚本全是"先起服务再连端口"的端到端脚本（`smoke.mjs`/`lifecycle.mjs`/`bots_add.mjs`/`fullgame_bots.mjs`/`bots.mjs`），默认连 8080 / 8101 / 8102。本机这些端口**当时被别的进程占着**（`Get-NetTCPConnection` 显示 8080/8101/8102/8120/8190/8191 处于 LISTEN；首跑 spec-7-int 直接撞 `Error: listen EADDRINUSE: address already in use 0.0.0.0:8190`，脚本于是连到了别人的服务器）。
  因此补跑统一做法：用该站点自己的 `src/server.mjs` 起服务在专属端口，脚本用 `BASE` 指过去，并把 `DAWN_MS` 调成 4000 让黎明阶段在脚本的 8 秒超时内到达。

端口分配：基线 8290/8292、spec-7-int 8270/8272、feat/seat-profile-lead 8300、feat/review-fixes 8310。

## 3. 站点状态（可复现锚点）

```
E:/Githubrepo/_salem_wt/baseline        d0976ae  (detached, origin/main)   status: clean
E:/Githubrepo/salem-int                 8b88ab1  spec-7-int                status: clean
E:/Githubrepo/_salem-wt/integration     40c6a3d  feat/seat-profile-lead    status: clean
E:/Githubrepo/_salem-wt/t6              28bab1c  feat/review-fixes         status: clean
```

关于 `E:/Githubrepo/salem-int`（站点 2）：开跑时 HEAD 为 `d94e4ae`，工作树有未提交改动——11 个已跟踪文件 `M`（`GLOSSARY.md`、`README.md`、`apps/server/package.json`、`apps/server/src/server.mjs`、`apps/server/test/{deal,fullgame_bots,reveal}.mjs`、`apps/web/{app,reveal-view}.js`、`packages/rules/src/engine.ts`、`packages/rules/test/pending-reveal.test.ts`），2 个未跟踪（`apps/server/test/run-suite.mjs`、`docs/acceptance/`）。全程未 stash、未回滚。测试期间该工作树被外部推进到 `8b88ab1`（新增 37b3e0b、0b6c0e3、8b88ab1 三个提交）并变 clean，因此**下表的 spec-7-int 结果是按 `8b88ab1` 重跑的**。

## 4. 三包结果

### 站点 1：origin/main 基线（d0976ae）

- `apps/server`：官方入口 `npm test` → **tests 0 / pass 0 / fail 0**（空跑，exit 0）。
  补跑实际脚本（隔离端口 + `DAWN_MS=4000`）：**6/6 通过** —— `deploy-smoke.mjs`、`fullgame_bots.mjs`、`profile.mjs`、`smoke.mjs`、`lifecycle.mjs`、`bots_add.mjs` 全部 exit 0。
- `apps/web`：**tests 15 / pass 14 / fail 1**（exit 1）。
- `packages/rules`：**tests 32 / pass 32 / fail 0**。

### 站点 2：spec-7-int（8b88ab1）

- `apps/server`：`npm test`（= `node test/run-suite.mjs`）→ **8/8 通过**，exit 0。
  `ok fake-clock smoke.mjs / lifecycle.mjs / profile.mjs / bots_add.mjs / deal.mjs / reveal.mjs`，`ok real-clock resync.mjs / fullgame_bots.mjs`。
- `apps/web`：**tests 55 / pass 55 / fail 0**。
- `packages/rules`：**tests 52 / pass 52 / fail 0**（含新增 `pending-reveal.test.ts`）。

### 站点 3：feat/seat-profile-lead（40c6a3d）

- `apps/server`：官方入口 `npm test` → **tests 0**（空跑）。
  隔离端口 8300 补跑：`smoke.mjs`、`lifecycle.mjs`、`bots_add.mjs`、`fullgame_bots.mjs` 全 exit 0；`profile.mjs`（自带服务器）exit 0（15 项通过）→ **5/5 通过**。
- `apps/web`：**tests 45 / pass 45 / fail 0**（测试已改为 `*.test.mjs`）。
- `packages/rules`：**tests 32 / pass 32 / fail 0**。

### 站点 4：feat/review-fixes（28bab1c）

- `apps/server`：官方入口 `npm test` → **tests 0**（空跑）。
  隔离端口 8310 补跑：`smoke.mjs`、`lifecycle.mjs`、`bots_add.mjs`、`fullgame_bots.mjs` 全 exit 0；`profile.mjs` exit 0 → **5/5 通过**。
- `apps/web`：**tests 44 / pass 44 / fail 0**。
- `packages/rules`：**tests 32 / pass 32 / fail 0**。

## 5. 失败清单与归因

### 5.1 基线自身红（唯一一个真正的代码/测试错配）

- 用例：`apps/web/test/avatar-normalize.test.js`（整文件，Node 记为 1 fail，内部 12 个断言未执行）
- 首行错误：
  ```
  SyntaxError: The requested module '../avatar-normalize.js' does not provide an export named 'AVATAR_BUDGET_BYTES'
  ```
- 归因：**基线 main 自身问题**。`apps/web/avatar-normalize.js` 还是旧 API（导出 `cropRect`/`AVATAR_TIERS`/`tierAt`/`encodingPlan`/`withinBudget`/`budgetVerdict(bytes,budget,tierIndex)`），而测试文件用的是新 API（`AVATAR_BUDGET_BYTES`/`squareCropRect`/`tierFor`/`encodingCandidates`/`isTargetAvatarDataUrl`/`budgetVerdict(bytes,budget,reduced)`）。测试比实现新，属于未合并实现被测试先行。
- 对合并的意义：feat/seat-profile-lead 与 feat/review-fixes 都带新实现并删掉了这个孤儿 `.test.js`，web 因此转绿（45/45、44/44）。**合并这两个分支是修复基线红灯，不是引入红灯。**

### 5.2 环境前提类失败（不是分支问题，已用隔离复跑证伪）

| 站点 | 首次跑失败 | 首行错误 | 归因 | 隔离复跑 |
| --- | --- | --- | --- | --- |
| 基线 | `bots_add.mjs` | `Error: timeout waiting for dawn` | 连到 8080 别人的服务；且 daemon 时长 45s 远超脚本 8s 超时 | 通过 |
| 基线 | `lifecycle.mjs` | `Error: connect ECONNREFUSED 127.0.0.1:8102` | 需外部服务在 8102 | 通过 |
| 基线 | `smoke.mjs` | `Error: connect ECONNREFUSED 127.0.0.1:8101` | 需外部服务在 8101 | 通过 |
| 基线 | `bots.mjs` | `CODE required` | 需人工房间码（`CODE` 环境变量），脚本设计如此 | 未跑（见 §6） |
| spec-7-int | `reveal.mjs`（fake-clock 组） | `Error: timeout waiting for 座位 0 确认发牌` | 首跑日志头部有 `EADDRINUSE 0.0.0.0:8190`，端口被占导致连到别人的服务 | `PORT_BASE=8270` 后通过 |
| feat/seat-profile-lead | `fullgame_bots.mjs` | `[game 1] FAIL ... error=timeout waiting for 终局`（180s） | 同上端口污染 + CPU 争抢 | 隔离后 5.4s 通过 |
| feat/seat-profile-lead | `bots_add/lifecycle/smoke` | 同基线（timeout dawn / ECONNREFUSED） | 外部服务缺失 | 全部通过 |

### 5.3 依赖类

只有 `apps/server` 需要 `ws`。基线 `apps/server` 未装依赖时 `node --test test/*.mjs` 直接 `ERR_MODULE_NOT_FOUND: Cannot find package 'ws'`；跑 `npm install --no-package-lock --no-audit --no-fund`（仅装依赖，未生成 lockfile、`git status` 保持干净）后消失。其余站点 `apps/server/node_modules` 已存在。

## 6. 未能覆盖的部分（如实声明）

- `apps/server/test/bots.mjs`（四个站点都存在）：需 `CODE=<房间码>` 才能跑，属于人工介入脚本。四站点均**未执行**，不计入通过率。
- 未做**合并后联合验证**（禁止 merge）：integration 与 t6 的差异只通过 `git diff` 判断。
  `git -C E:/Githubrepo/女巫镇 diff --stat feat/seat-profile-lead..feat/review-fixes` 结果只有两个文件：
  ```
  apps/web/profile-store.js            | 20 +-------------------
  apps/web/test/profile-store.test.mjs |  7 -------
  2 files changed, 1 insertion(+), 26 deletions(-)
  ```
  即 feat/review-fixes = feat/seat-profile-lead 再减 26 行（profile-store 精简 + 测试同步）。两者相对 origin/main 的改动文件集合完全相同，**同时合并必然冲突**，应当择一或顺序合并后重跑。
- spec-7-int 与 integration/t6 的改动面几乎不重叠（前者偏 `packages/rules` + 发牌/揭示 + 测试基建 `run-suite.mjs`，后者偏 `apps/web` 头像/座位档案）。唯一共触：`.dockerignore`、`Dockerfile`、`GLOSSARY.md`、`README.md`、`apps/server/package.json`、`apps/server/src/server.mjs`、`apps/web/{app,index.html,reconnect.js,styles.css,sw.js}`。这些是合并冲突的高风险文件，需要在合并后重跑全套。

## 7. 建议的合并顺序

1. **先合 spec-7-int**：它是唯一让 `apps/server` 测试真正跑起来的改动（`run-suite.mjs` + 假时钟注入 + 端口错开）。先把它落地，后面的分支才有可执行的 server 回归网。
2. **再合 feat/seat-profile-lead**（或直接合 feat/review-fixes，二选一）：web 由 14/15 红转 44~45 全绿。
3. 合并后**必须重跑**（顺序不能省）：
   ```
   cd apps/server && npm test
   cd apps/web && npm test
   cd packages/rules && npm test
   ```
   若 `apps/server` 仍是 `node --test test/*.test.mjs`，看到的 0 用例不是通过，是没跑（见 §1）。

## 8. 复现命令

```bash
# 站点 1：新建基线 worktree（只加不清）
git -C E:/Githubrepo/女巫镇 worktree add E:/Githubrepo/_salem_wt/baseline origin/main

# 每站点锚点
git -C <SITE> rev-parse --short HEAD && git -C <SITE> status --short

# 三包官方入口
cd <SITE>/apps/server   && npm test
cd <SITE>/apps/web      && npm test
cd <SITE>/packages/rules && npm test

# server 端到端脚本：隔离端口补跑（示例：站点 3，端口 8300）
cd <SITE>/apps/server
PORT=8300 DAWN_MS=4000 node src/server.mjs &          # 等 /health 200
BASE=http://127.0.0.1:8300 node test/smoke.mjs
BASE=http://127.0.0.1:8300 node test/lifecycle.mjs
BASE=http://127.0.0.1:8300 node test/bots_add.mjs
BASE=http://127.0.0.1:8300 node test/fullgame_bots.mjs
node test/profile.mjs                                  # 自带服务器

# spec-7-int 的 server 套件（可换端口基址避开占用）
cd <SITE>/apps/server && PORT_BASE=8270 npm test
```
