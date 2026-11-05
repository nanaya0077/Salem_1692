---
id: MAP-1
title: 《女巫镇》手机端在线版路线图
label: wayfinder:map
status: closed
created: 2026-11-05
updated: 2026-11-05
tracker: local-markdown
---

# 《女巫镇》手机端在线版路线图

## Destination

一张能直接开工的《女巫镇》手机端在线版规格：4–12 人实时房局的规则引擎、服务端权威状态与隐藏信息投影、移动端牌桌交互、语音与沟通、素材与本地化、MVP 范围与验收标准都已定；关键交互有一个可点的竖屏原型验证。做到这里，工程团队不再需要问“做成什么样”，只需要按图施工。

## Notes

- 规则基线：`docs/rules/salem_rulebook.pdf`（Salem 1692, 2nd Edition）与 `docs/rules/rulebook.txt`（文本层）。中文规则介绍：https://andyventure.com/boardgame-salem-1692/
- 硬约束：
  - 服务端权威；任何客户端不得收到他人的身份卡、手牌、角色卡。
  - 4–12 人同房实时对局；竖屏手机优先；断线可恢复。
  - 单局 20–40 分钟；回合与夜晚都要有明确计时与超时裁决。
- 产品取向（已确认，1A2B3A4B）：H5/PWA 首发；外置语音 + 局内快捷语；全屏夜幕；朋友房 4–12 人、6–8 人优先验收、12 人压测。
- 开工规格见 `SPEC.md`；卡面数据见 `assets/cards/cards.zh.json`；卡面文字不烧进图片，客户端按设备 DPR 渲染，点开放大再打出。
- 本图只产出决策与规格，不产出完整实现；实现在图外开工。
- 每张票按 `wayfinder:<type>` 处理：research 走 `/research`，grilling 走 `/grilling` + `/domain-modeling`，prototype 走 `/prototype`，task 是解锁决策的前置动作。
- 术语见根目录 `GLOSSARY.md`；一句“身份卡/角色卡/夜晚”不再另作解释。

## Decisions so far

- [W-03 首发载体与分享 / 登录路径](tickets/w03-platform.md)：H5/PWA + 6 位房码 + 游客昵称 + seatToken；小程序/原生壳二期。
- [W-04 语音与局内沟通模型](tickets/w04-voice.md)：外置语音 + 结构化快捷语 + 房内文字；协议预留 voice 字段，MVP 不建语音。
- [W-05 夜晚与隐藏信息的数字化体验](tickets/w05-night.md)：全屏夜幕 + 分段私密面板；20/15/10 秒计时与超时默认动作；断线不补看。
- [W-06 服务端权威状态与按玩家投影](tickets/w06-authority.md)：单一权威 + `project(state, viewerId)`；seatToken 轮换；commandId 幂等；12 viewer 泄漏门禁。
- [W-07 规则引擎与同时结算模型](tickets/w07-rules-engine.md)：纯 TS reducer + 命令/事件日志 + 种子 RNG + 同时结算屏障；阶段与效果联合类型已定。
- [W-10 美术素材与本地化方案](tickets/w10-art.md)：卡面文字不烧图；`cards.zh.json` 唯一数据源；手牌只标题+点数，点开 18px/26px。
- [W-11 房间生命周期、人数弹性与断线重连](tickets/w11-room-lifecycle.md)：6 位房码；4–12 人；60 秒宽限 + 只自动抽牌/结束回合的托管；重连回原座位。
- [W-12 MVP 范围与验收标准](tickets/w12-mvp.md)：朋友房 4–12 全开；6–8 人 10 局验收 + 12 人 20 局 soak；零泄漏/重连 <5s/p95 <300ms/30fps。
- [W-01 补齐《女巫镇》全卡表与结算边界](tickets/w01-card-facts.md)：基础 59 张（红 41/绿 11/蓝 5/黑 2）+ 15 张角色卡；默认中文旧版；女巫数/每人身份卡数开局可配；阵营按 everHadWitch，红卡不跨次累计；10 条数字化裁决已落笔记。
- [W-02 12 人实时房间与移动端承载的事实边界](tickets/w02-realtime-facts.md)：12 人房瓶颈不在吞吐，在服务端投影与断线恢复；Colyseus 最贴合，语音必须 SFU/托管，大陆首发事实指向 H5/PWA。
- [W-09 中文素材清点与样张提取](tickets/w09-assets.md)：仓库内没有中文卡面；现有 176×264 英文扫描 + 384×583 插画只能做参考；W-10 默认自绘中文卡面，用户可把中文扫描放 `assets/source/`。
- [W-08 12 人竖屏牌桌原型](tickets/w08-table-prototype.md)：环形优先，4 人自动三角、12 人全环；手牌/身份卡常驻首屏；点选牌再点目标；夜晚全屏四步；卡带与列表为降级备选，原型见 `prototype/table.html`。

## Not yet specified

- 公共匹配、账号体系与跨设备进度：朋友房跑通后再决定是否做。
- 新手教学与单人 bot 局：取决于 MVP 是否把“第一次玩”当转化门槛。
- 观战、回放、直播：涉及剧透与隐藏信息，等核心投影模型定了再看。
- 音频氛围与动效规范：夜幕音效、翻牌节奏、手机震动反馈。
- 埋点、运营与数据看板：留到有真实对局数据。
- 低端机性能与 12 人网络指标：等原型与压测数据。
- 平衡性变体（困难传染等）：女巫数已可配置；其余变体留二期。
- 反作弊中服务端管不住的部分（屏幕共享、同桌串通）：等产品形态定了再评估。
- 上线发行与合规（备案、版号、支付）：本图到开工规格为止。

## Out of scope

- 商业化与支付：本图不设计内购、广告、订阅。
- 赛事、直播与社区运营。
- 实体桌游的生产与印刷。

## Answer

路线图已完成：W-01–W-12 全部收口，产物是 `SPEC.md`、可点原型 `prototype/table.html`、卡面数据 `assets/cards/cards.zh.json` 与中文卡面样张。下一步按 `SPEC.md` §8 开工顺序实现，不再需要新的产品决策。
