---
id: W-07
title: 规则引擎与同时结算模型
type: wayfinder:grilling
status: closed
parent: MAP-1
blockedBy: []
assignee: lead
created: 2026-11-05
---

## Question

规则引擎用什么结算模型：事件溯源 reducer + 显式阶段（抽牌 → 即时黑牌 → 出牌 → 指控 → 揭牌 → 死亡 → 胜负）？阴谋的同时换牌、媒人连锁死亡、玛莎继承约翰、斯托克斯叠加、蒂图巴调序怎么落？RNG 与回放怎么定？

## 建议（可被推翻）

纯 TS 规则核心（无 IO）+ 命令 / 事件日志 + 种子化 RNG + 显式同时结算屏障；所有随机在服务端；回放用事件日志。

## Answer

**结论：纯 TS 规则核心（无 IO）+ 命令/事件日志 + 种子化 RNG + 显式同时结算屏障。**

- 包：`packages/rules`；导出 `GameState`、`Command`、`Event`、`reduce`、`project`；不依赖 React/网络/数据库。
- 阶段：`turnStart → drawChoice → draw2 → resolveImmediate → playCards → accusation → trialReveal → death → winCheck → turnEnd`。
- 同时结算：阴谋先收集所有存活玩家换牌选择，再原子应用；媒人连锁死亡入队列依次结算；玛莎在回合开始快照右邻能力；枷锁可叠加；蒂图巴调序生成置换事件。
- 卡牌效果：`Effect` 联合类型（加指控、弃蓝牌、移动面前牌、转移手牌、跳过回合、绑定、夜免、红卡免疫、莎拉·古德无效、翻身份卡…）；卡面文本只进 UI。
- RNG：服务端种子；每次洗牌/抽牌记录 `seed` 与 `drawIndex`；回放用事件日志，不重跑随机。
- 裁决：沿用 W-01 的 10 条 D 级结论；冲突以中文旧版为准（信徒红卡免疫、莎拉·古德抢劫/纵火免疫），第二版/第 15 版只作差异参考，卡面 OCR 只作佐证。
- 测试：逐张牌场景、59 张配比、开局配置矩阵、信徒红卡免疫、莎拉·古德免疫、George/Thomas 阈值、死亡/胜负、夜晚救杀、回放确定性。
- 落地：见 [SPEC.md](../SPEC.md) §5。
