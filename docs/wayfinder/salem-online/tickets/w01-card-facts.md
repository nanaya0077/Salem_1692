---
id: W-01
title: 补齐《女巫镇》全卡表与结算边界
type: wayfinder:research
status: closed
parent: MAP-1
blockedBy: []
assignee: lead
created: 2026-11-05
---

## Question

第二版的完整牌表和结算边界到底是什么？逐张列出绿 / 蓝 / 红 / 黑牌与 15 张身份牌的能力，给出 4–12 人试炼牌配比、回合 / 夜晚 / 黎明流程、所有同时结算与死亡触发链（阴谋换牌、媒人连锁、玛丽·沃伦、斯托克斯叠加、蒂图巴调序、多张女巫牌、最后两人蓝牌失效），并标出规则书没写清、数字化必须自行裁决的点。

## Notes

- 现有 `docs/rules/rulebook.txt` 只有流程，卡表在 PDF 的图片层，文字层缺失。
- 产出：`docs/research/salem-1692-card-and-rules-facts.md`（逐条引用来源；区分“规则书原文”与“社区裁决”）。
- 本票只查事实；怎么数字化是 W-05 / W-07 的事。
- 产出已落盘；卡牌数量待 W-09 用中文实体素材复核。
## Answer

已完成，证据与裁决落在 [docs/research/salem-1692-card-and-rules-facts.md](../../../research/salem-1692-card-and-rules-facts.md)。

- 基础牌 **59 张**：红 41（Accusation 35 / Evidence 5 / Witness 1）、绿 11（Alibi 3 / Stocks 3 / Scapegoat 2 / Arson 1 / Curse 1 / Robbery 1）、蓝 5（Asylum 1 / Black Cat 1 / Matchmaker 2 / Piety 1）、黑 2（Conspiracy 1 / Night 1）；Bless/Shilling 属扩展，不入基础。
- 身份牌 **15 张**，逐张能力、触发时点与数字边界已列；Thomas Danforth 卡面经放大复核为“第六（或第七）张”，此前 OCR 的 TENTH 是误读。
- 4–12 人试炼牌配比、回合状态机、翻牌 / 死亡 / 胜负原语、夜晚流程、信息可见性、10 条 D 级裁决（第二版对照）已写入笔记。
- 关键结论：阵营按 **everHadWitch** 判定；红牌不跨次累计；Curse 按规则书弃蓝牌；Alibi 按 3 **张**红牌；替罪羊移动红牌后立刻检查门槛；认罪只免疫夜杀；多女巫按第二版一张揭示即死；媒人按“目标先死、搭档晚半秒”判胜负；Giles 的补抽 MVP 只对回合抽两张生效。
- 下游 W-05 / W-06 / W-07 / W-08 / W-09 / W-12 的输入已列在笔记第 10 节。

## Post-Answer update（2026-11-05）

规则基线已切到**中文旧版**：信徒=其他玩家不能对你打出红卡；莎拉·古德=对你打出的抢劫/纵火无效并立刻丢弃；4–9 人默认每人 5 张身份卡、10–12 人每人 3 张，女巫数与每人身份卡数开局可配。第二版内容保留为差异参考；实现以 `docs/research/salem-1692-card-and-rules-facts.md` §0.1 与 `packages/rules` 为准。
