# 规格 #51 验收记录：传染阶段（抽到即弃 + 左邻取牌 + 完整演出）

- 验收日期：2026-11-08
- 被验对象：`main` @ `9ab9ee6`（实施票 #52 / #54 / #55 / #56 / #57 / #58 / #60 / #61 全部合并后的状态）
- 验收环境：本地 `node apps/server/src/server.mjs`（`SALEM_TEST_CONSPIRACY=1` 把传染卡压到牌堆顶，好稳定复现）；
  浏览器 Chromium（ego-browser），`Emulation.setDeviceMetricsOverride` 390×844、`deviceScaleFactor` 1。
  **没有物理设备**，所以「真机」一栏是设备指标覆盖 + 桌面浏览器合成，不做真机 30fps 判定（仍在 #35 名下）。

## 一、验收范围

传染阶段这条链路端到端可用：

1. **规则包**：抽到传染卡即弃（不进手牌）；黑猫先由持有者选揭示一张（免疫角色跳过），再全员同时从左邻取一张；
   无黑猫 / 左邻已死 / 左邻全揭示都有跳过语义；未提交按位置号最小兜底；提交可改判；非自己回合也能抽到并进阶段。
2. **服务端**：4 / 9 / 12 人局都能跑完；20 秒一步的计时与到点兜底、断线重连、机器人代选、事件日志、
   牌张守恒（每座位身份卡数不变、总张数不变）。
3. **客户端**：抽屉面板在 390×844 上 4 / 9 / 12 人都不溢出；选牌可选可改；提交后转等待态；
   完整演出（压暗 + 印章 + 换牌三拍）；`reduced` 与 `off` 两档降级。
4. **零泄漏**：投影里只有位置号，没有 `kind`、没有别人的选择、没有已揭示卡的类型。

## 二、怎么验的

- 机跑：
  - `npm --prefix packages/rules test` → 69（其中 `conspiracy-phase.test.ts` 14 条、`soak.test.ts` 48 seed 牌张守恒）
  - `npm --prefix apps/web test` → 185
  - `cd apps/server && PORT_BASE=8500 node test/run-suite.mjs` → 10 个脚本全过
- 人数回归：`fullgame_bots.mjs` 本轮参数化（`PLAYERS` 环境变量，4–12，默认 12），并加了「这一局是否出现过传染阶段」
  与「投影是否泄漏」两项统计：
  - `BASE=http://127.0.0.1:8490 PLAYERS=4 GAMES=3 node apps/server/test/fullgame_bots.mjs`
  - `PLAYERS=9 GAMES=3`、`PLAYERS=12 GAMES=3`
- 浏览器实拍（脚本留在 `C:/Users/49934/ego/salem-accept53/r01.mjs`）：
  建房 → 加机器人到指定人数 → 开局 → 发牌确认 → 轮到自己时抽 2 张 → 传染 cat 步 → 选一张 → 提交 → 结算 → 切 `reduced` / `off`。

## 三、结果

### 机跑

| 套件 | 结果 | 备注 |
| --- | --- | --- |
| packages/rules | 69 / 69 | 含传染 14 条：cat/pick 子步、免疫跳过、改判、死人禁投、越界兜底、聚合计数、投影零泄漏、翻出最后一张女巫即终局 |
| apps/web | 185 / 185 | 含 `conspiracy-ui.test.js` 17 条与 `conspiracy-motion.test.js` 14 条 |
| apps/server | 10 / 10 脚本 | fast-clock 7 + fake-clock 1（`conspiracy.mjs`）+ real-clock 2 |

### 人数回归（每档 3 局）

| 人数 | 局数 | 通过 | 传染阶段出现 | 投影泄漏 | 单局耗时 | 意外错误 |
| --- | --- | --- | --- | --- | --- | --- |
| 4 | 3 | 3 | 3/3（4 座位都看到） | 0 | 1907–2900ms | 0 |
| 9 | 3 | 3 | 3/3（9 座位都看到） | 0 | 3990–24463ms | 0 |
| 12 | 3 | 3 | 3/3（12 座位都看到） | 0 | 3727–26593ms | 0 |

`run-suite` 里那一局 12 人：`duration=4433ms winner=witches log=337 conspiracy=12/12 errors=0`。

### 客户端（390×844）

| 人数 | 房间 | cat 步卡片 | 抽屉位置 | 倒计时 | 副标 |
| --- | --- | --- | --- | --- | --- |
| 4 | FZFQDE | 5 张（`#1`–`#5`） | top 543 / bottom 832，宽 366 | 20 秒 → 19 秒 | 「机器人1 就在你面前，先翻开一张。」 |
| 9 | EJ2NCF | 4 张 | top 518 / bottom 832 | 20 秒 | 「验收9 就在你面前，先翻开一张。」 |
| 12 | JERKLE | 3 张 | top 475 / bottom 832 | 20 秒 | 「机器人10 就在你面前，先翻开一张。」 |

- 三种人数 `document.documentElement.scrollHeight` 都不超过 844（页面本身不滚），溢出只在面板内。
- 选中一张后卡片金边、底部提示「已选 #1，提交前可以改。」、按钮文案「选定（第 1 张）」，再点同一张可取消。
- 提交后聚合计数正确且**不带选择内容**：4 人 `已提交 3/4`、9 人 `8/9`、12 人 `11/12`。
- 结算后：`phase` 回 `action`、`projection.conspiracy` 为 `null`、抽屉 `hidden`、`#conspiracyVeil` / `#conspiracySeal` 的 `.on` 都撤掉、
  公开日志各出现 4 / 9 / 12 条 `conspiracySwap`（一人一条，正好等于人数）。
- 演出：进场时 `veil.className === "conspiracy-veil on"`、`seal.className === "conspiracy-seal on"`（印章 opacity .92），
  换牌两张背面卡在约 980ms 内走完 curl → fly → drop 并清空。
- 降级：`data-level="reduced"` 时压暗层过渡 **0.18s**；`data-level="off"` 时 **0s**、换牌层直接不显示。

### 截图

- `docs/acceptance/shots/conspiracy-accept-4p-cat.png`、`-9p-cat.png`、`-12p-cat.png`：三档人数的选牌面板 + 压暗层 + 印章。
- `conspiracy-accept-4p-picked.png`：选中态（金边、底部提示、按钮文案）。
- `conspiracy-accept-12p-after.png`：结算后回到白天，压暗层与印章已撤、手牌与座位恢复。
- `conspiracy-accept-reduced.png` / `-off.png`：两档降级。

## 四、已知偏差与没能做的

1. **真机未测**：上面所有数字都来自设备指标覆盖，不是物理手机。30fps 判据、触感可感性仍在 #35 名下。
2. **等待态只捕捉到一瞬**：机器人是即时提交，玩家一提交就凑满结算，所以「已提交，等待其他玩家」的完整等待画面
   在实拍里只有几百毫秒；文案本身由 `apps/web/test/conspiracy-ui.test.js` 的等待态断言覆盖。
3. **中央阶段大字仍是英文 `conspiracy`**：改前就是英文（`deal` / `dawn` / `night` 同理），本轮没有动它，属全局阶段标题的既有口径。
4. **首批 7 条音效未重生成**：合成脚本 `scripts/build-audio.mjs` 已入库，但只有本轮新增的 `sfx.conspiracy.start` 是脚本产物，
   其余仍是旧二进制（`--force` 会改听感，需先试听），已在 `docs/research/audio-credits.md` 如实注明。
5. **牌张守恒只在规则层证**：`soak.test.ts` 的 48 seed 断言牌张守恒；服务端这一层没有独立的「59 张」计数断言，
   靠「每座位身份卡数不变」与终局可收敛间接保证。
