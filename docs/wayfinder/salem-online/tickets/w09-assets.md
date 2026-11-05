---
id: W-09
title: 中文素材清点与样张提取
type: wayfinder:task
status: closed
parent: MAP-1
blockedBy: []
assignee: lead
created: 2026-11-05
---

## Question

现有中文版素材在哪、能否落到 `assets/source/`？需要清点：卡面、身份牌、试炼牌、图标、牌背、字体；并从规则书 PDF 提取内嵌卡图做样张与清单。

## Notes

- 这是 task：先有素材，W-10 才能做“复用还是重绘”的决策。
- 代理可先跑 PDF 图片提取，产出 `docs/research/asset-manifest.md`；中文素材由用户放到 `assets/source/`。

## Answer

已完成清点，结论落在 [docs/research/asset-manifest.md](../../../research/asset-manifest.md)。

- **仓库里没有中文卡面/身份牌/试炼牌素材**；只有英文规则书、32 张 176×264 英文卡面扫描、18 张 384×583 卡面插画（无效果文字）。
- 已生成三张样张：[基础牌](contact-sheet-cards.png)、[身份牌](contact-sheet-identities.png)、[试炼牌](contact-sheet-trials.png)；机器清单在 [asset-manifest.json](asset-manifest.json)。
- 已建立 `assets/source/README.md` 投放约定；用户若有中文实体卡扫描，按英文名命名放入即可。
- 缺口：中文卡面、牌背、UI 图标、可商用中文字体、高分辨率源文件；扫描图不能直接上手机。
- 建议 W-10 默认走“自绘中文卡面”：以 384×583 插画为构图参考，输出 750×1136 / 1125×1704 两套，保留 SVG 源；MVP 只做 15 种基础牌 + 15 张身份牌 + 3 种试炼牌 + 4 种牌背 + 8 个图标。
