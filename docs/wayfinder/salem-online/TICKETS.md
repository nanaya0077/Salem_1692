# 票板（派生视图）

> 以各票 front matter 为准；本文件只是给人看的视图，不存决策。

| ID | 票名 | 类型 | 状态 | 阻塞于 | 认领 |
|---|---|---|---|---|---|
| [W-01](tickets/w01-card-facts.md) | 补齐《女巫镇》全卡表与结算边界 | research | closed | — | lead |
| [W-02](tickets/w02-realtime-facts.md) | 12 人实时房间与移动端承载的事实边界 | research | closed | — | lead |
| [W-03](tickets/w03-platform.md) | 首发载体与分享 / 登录路径 | grilling | closed | — | lead |
| [W-04](tickets/w04-voice.md) | 语音与局内沟通模型 | grilling | closed | — | lead |
| [W-05](tickets/w05-night.md) | 夜晚与隐藏信息的数字化体验 | grilling | closed | — | lead |
| [W-06](tickets/w06-authority.md) | 服务端权威状态与按玩家投影 | grilling | closed | — | lead |
| [W-07](tickets/w07-rules-engine.md) | 规则引擎与同时结算模型 | grilling | closed | — | lead |
| [W-08](tickets/w08-table-prototype.md) | 12 人竖屏牌桌原型 | prototype | closed | — | lead |
| [W-09](tickets/w09-assets.md) | 中文素材清点与样张提取 | task | closed | — | lead |
| [W-10](tickets/w10-art.md) | 美术素材与本地化方案 | grilling | closed | — | lead |
| [W-11](tickets/w11-room-lifecycle.md) | 房间生命周期、人数弹性与断线重连 | grilling | closed | — | lead |
| [W-12](tickets/w12-mvp.md) | MVP 范围与验收标准 | grilling | closed | — | lead |

## 波次（并行 / 串行，均已收口）

- **第 1 波（并行）**：W-01 全卡表；W-02 实时承载；W-04 语音；W-05 夜晚；W-09 素材清点。彼此不连 blockedBy。
- **第 2 波（并行）**：W-03（等 W-02）；W-07（等 W-01）；W-10（等 W-09）；W-11（等 W-02）。四条互不等待，只各等第 1 波对应前置。
- **第 3 波（并行）**：W-06（等 W-02、W-03、W-05）；W-08（等 W-03、W-05）。两条互不等待。
- **第 4 波**：W-12（等 W-03、W-04、W-05、W-06、W-07、W-08、W-10、W-11），是唯一汇合点。
- 当前全部票 closed；原依赖链已满足。实现阶段按 `SPEC.md` §8 的串行顺序：rules → server/projection → client table → night → lifecycle/soak → art。
