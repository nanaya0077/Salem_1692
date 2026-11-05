---
id: W-10
title: 美术素材与本地化方案
type: wayfinder:grilling
status: closed
parent: MAP-1
blockedBy: []
assignee: lead
created: 2026-11-05
---

## Question

正式素材用“复用中文版扫描 / 卡图”还是“按现有画风重绘矢量卡”？文字与卡框如何模板化以支持中英双语与不同人数？哪些必须重绘（小字、图标、牌背）？

## 建议（可被推翻）

混合：角色插画与牌背复用（若授权与分辨率允许），卡框 / 图标 / 文字层矢量化重绘；卡面文本数据化，中英双语从第一天走 i18n。

## Answer

**结论：卡面文字不烧进图片；客户端按设备 DPR 实时渲染卡框与文字，PNG 只做导出/回退。**

- 数据：`assets/cards/cards.zh.json` 为唯一卡面数据源（33 张：15 基础 + 15 身份 + 3 试炼），字段含 `id/name/kind/color/typeLabel/points/target/text/image/printImage`。
- 渲染：服务端只下发 `cardId`；客户端用 DOM/SVG 画卡框、类型条、点数、标题与正文，插画/纹理作图片层；手牌只显示标题 + 点数/“点开”。
- 可读性：点击手牌打开全屏详情，正文 ≥18px、标题 ≥26px；底部“打出”，关闭后再点目标。字号不随卡面缩小，不再出现 7px 小字。
- 素材：插画重绘或授权复用；卡框/图标/牌背矢量化；输出 WebP/AVIF，提供 2x/3x；当前 750×1136 PNG 仅样张/分享/打印回退。
- i18n：`cards.zh.json` / `cards.en.json` 同结构；文本自动换行，预留 1.3× 膨胀。
- 字体：Noto Serif SC + Noto Sans SC，OFL 授权，按字符集子集化。
- 版权：现有英文扫描与插画仅研究/原型使用；商用前确认授权或全部重绘。
- 落地：见 [SPEC.md](../SPEC.md) §3；原型 `prototype/table.html` 已实现“点开→放大→打出”。
