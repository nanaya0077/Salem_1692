# assets/cards/

《女巫镇》在线版的卡牌数据与中文样张。

## 文件

- `cards.zh.json`：客户端渲染的唯一数据源。服务端只下发 `cardId`，客户端按 `name/typeLabel/points/target/text` 用 DOM/SVG 渲染卡框与文字；卡面 PNG 只作分享、打印与离线回退。
- `zh/`：33 张中文样张（15 基础卡 + 15 角色卡 + 3 身份卡）+ 4 张牌背 + `contact-sheet.png` + `manifest.json`；每张另有 `@1125` 打印版。
- `zh/manifest.json`：生成清单，记录 slug、中文名、类型与英文源图。

## 命名与规则基线

- 卡名与类型名按中文版对照页（https://andyventure.com/boardgame-salem-1692/）：指控/证据/目击/辩护/拘留/嫁祸/纵火/诅咒/抢劫/避难/黑猫/情侣/信徒/传染/夜晚；红卡/绿卡/蓝卡/黑卡；角色卡/身份卡。
- 效果文本与默认配比按中文旧版（andyventure 对照页）：信徒=其他玩家不能对你打出红卡；莎拉·古德=对你打出的抢劫/纵火无效并立刻丢弃；4–9 人每人 5 张身份卡、10–12 人每人 3 张，女巫数与每人身份卡数可在开局前配置。
- `cards.zh.json` 的 `edition.rules` 为 `zh-old`；规则引擎 `packages/rules` 与测试是行为基准，不要只改卡面文字。
- 生成脚本：`docs/rules/_make_zh_cards.py`（图片）与 `docs/rules/_make_card_data.py`（JSON）。改数据后两个都重跑。
