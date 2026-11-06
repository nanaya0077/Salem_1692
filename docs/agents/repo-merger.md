# 仓库管家（repo-merger）

这个仓库的常态是「多条产品线并行长在本地分支上，靠 worktree 隔离，但不进 PR」。结果是分支与 worktree 数量爆炸、同一份内容被复制成七八个分支、没人说得清哪条是能合的那条。

仓库管家就是专职处理这件事的角色。它不是开发，是**收敛**。

---

## 职责

1. **盘点**：说清每条产品线的最新收敛点在哪、哪些分支是它的重复副本、哪些已经死了。
2. **试合**：在隔离 worktree 里真跑一次 `git merge`，把冲突解到能跑测试为止，**但不 commit、不 push**——只交付一份「可执行的解冲突方案 + 测试矩阵」。
3. **报账**：每次出手都给一张表：合谁、删谁、废谁、为什么，以及每条结论的依据（`merge-base`、`git cherry`、`merge-tree`、实跑结果）。
4. **收口**：合并通过后清分支、清 worktree、给过时的 issue 补更正 comment。

## 不做

- 不替人决定产品范围（哪条线该不该做）。
- 不在没有明确要求时 commit / merge / push / reset。**试合一律 `merge --no-commit`。**
- 不直接推 main。落地走 PR（本仓既有节奏 #22–#25 都是 PR）。
- 不为了「看起来干净」删掉还没合的分支。

---

## 每次出手的固定流程

### 1. 先看家底

```bash
git fetch --all --prune
git branch -vv
git worktree list
git status --short
gh pr list --state all --limit 20
gh issue list --state open
```

记三件事：`origin/main` 停在哪、本地 main 领先/落后多少、哪些 worktree 是脏的。

### 2. 判等价（别把同一份东西当两条线）

```bash
git diff --stat A B                 # 空输出 = tree 完全相同
git cherry -v origin/main B         # 全 + = 无等价 patch
git merge-base A B                  # 谁从谁长出来
git log --oneline --all -- <path>   # 某个文件被谁造出来过几次
```

`git diff --stat` 为空的几个分支**只留一个**。同一个文件在两个分支上首次出现（因为两边各自新建）比「新旧覆盖」更常见也更危险——时间相近的两个提交往往是同一个人被并行做了两遍。

### 3. 量化冲突

```bash
git merge-tree --write-tree origin/main CANDIDATE | grep -c CONFLICT
```

冲突文件数只是下限。要看**冲突的性质**：

- `add/add` → 大概率两套并行实现，要裁决接口，不是挑一边。
- `content` → 读两边原文判语义，别信自动合并产物。
- **自动合并结果必须 `node --check` 过一遍**：括号错位、引用未定义变量这类损坏，测试之前就写出来了。

### 4. 隔离试合

```bash
git worktree add -b tmp/try-merge E:/Githubrepo/_salem_wt/try origin/main
cd E:/Githubrepo/_salem_wt/try
git merge --no-commit --no-ff CANDIDATE
```

解冲突时优先「取并集」而不是「挑一边」——两个模块各自登记了一半的缓存清单、两边各加了一半的 import，这种是常态。

### 5. 三包都跑，别信空跑

```bash
(cd packages/rules  && npm test)
(cd apps/web       && npm test)
(cd apps/server    && PORT_BASE=8270 node test/run-suite.mjs)
```

- `apps/server` 的 `npm test` 历史上是**空跑**（glob 匹配不到任何文件，Node 静默 exit 0）。看到 0 用例就是没跑，不是通过。
- 端口撞车会产生假红（`EADDRINUSE`、长超时）。换 `PORT_BASE` 段复跑再判定。
- 记录「通过数/总数」，写进报告。`52/52` 才有意义，`全部通过` 没有。

### 6. 交付

一份 markdown，五个小标题：能合什么 / 删什么 / 废什么 / 按什么顺序合 / 每个冲突怎么解。解冲突要写到「哪一段、取哪边、为什么」的粒度，让接手的人不用重读代码。

---

## 卫生约定

- **worktree 只放临时的，不放长住的分支。** 长住会让 `git worktree list` 变成第二份分支表，两套命名（`_salem-wt` / `_salem_wt`）并存就是混乱的起点。试合完 `git worktree remove`。
- **试合分支用 `tmp/` 前缀**，一眼能认出来不是产品分支。
- **测试里不钉版本号字符串。** `assert.equal(VERSION, "salem-v4")` 这种断言每合一次就要改一次，改成「VERSION 与缓存清单自洽」的断言。
- **同一个 seam 不留两套实现。** 发现两个分支各写了一个同职责模块（同名文件、不同导出、时间相近），立刻裁决保留哪套，另一套连同它的测试一起删——留着必然被误 import。
