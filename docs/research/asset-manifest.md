# 素材清点与样张（W-09）

> 2026-11-05。结论先行：**仓库里没有官方中文版卡面/角色卡/身份卡素材**；现有可用的是英文规则书、英文卡面扫描与一套 384×583 的卡面插画。W-10 已按英文构图生成中文样张 `assets/cards/zh/`；正式素材仍可把中文扫描放到 `assets/source/` 替换。

## 1. 已找到的素材

| 类别 | 位置 | 数量 | 规格 | 用途 | 备注 |
|---|---|---:|---|---|---|
| 第二版规则书 | docs/rules/salem_rulebook.pdf | 11 页 | PDF，241×510 / 482×510 | 规则事实、版式参考 | 文本层已抽到 docs/rules/rulebook.txt |
| 第 15 版规则书 | docs/rules/salem_15th.pdf | 24 页 | PDF | 边界补充 | 文本层 docs/rules/salem_15th.txt |
| 规则书内嵌图 | docs/rules/_pdf_images/ | 17 | 多种 | 封面、插图、配件图 | **没有卡牌正面/牌表**；只有封面与场景插图 |
| 英文卡面扫描 | docs/rules/_ugh_cards/ | 32 | 176×264 JPG | 卡名、效果文字、构图参考 | 15 张基础牌 + 15 张角色卡 + Bless/Shilling；清晰度低，不能直接上手机 |
| 英文卡面插画 | docs/rules/_card_faces/ | 18 | 384×583 PNG | 构图与插画参考 | 15 张基础牌 + Constable/NotAWitch/Witch；只有标题与插画，没有效果文字 |
| 卡面样张 | docs/research/contact-sheet-cards.png | 1 | 1172×1122 | 15 张基础牌总览 | 由 _ugh_cards 生成 |
| 身份样张 | docs/research/contact-sheet-identities.png | 1 | 1172×1122 | 15 张角色卡总览 | 由 _ugh_cards 生成 |
| 身份样张 | docs/research/contact-sheet-trials.png | 1 | 708×382 | 3 张身份卡总览 | 由 _card_faces 生成 |
| 机器清单 | docs/research/asset-manifest.json | 1 | JSON | 尺寸、字节数、SHA-256 | 32 个 jpg |

## 2. 基础牌 15 种

| 中文工作名 | 英文 | 数量 | 颜色 | 文件 |
|---|---|---:|---|---|
| 指控 | Accusation | 35 | 红 | _ugh_cards/Accusation.jpg |
| 证据 | Evidence | 5 | 红 | _ugh_cards/Evidence.jpg |
| 目击 | Witness | 1 | 红 | _ugh_cards/Witness.jpg |
| 辩护 | Alibi | 3 | 绿 | _ugh_cards/Alibi.jpg |
| 拘留 | Stocks | 3 | 绿 | _ugh_cards/Stocks.jpg |
| 嫁祸 | Scapegoat / Scapegoat | 2 | 绿 | _ugh_cards/SECRET.jpg |
| 纵火 | Arson | 1 | 绿 | _ugh_cards/Arson.jpg |
| 诅咒 | Curse | 1 | 绿 | _ugh_cards/Curse.jpg |
| 抢劫 | Robbery | 1 | 绿 | _ugh_cards/Robbery.jpg |
| 避难 | Asylum | 1 | 蓝 | _ugh_cards/Asylum.jpg |
| 黑猫 | Black Cat | 1 | 蓝 | _ugh_cards/Black Cat.jpg |
| 情侣 | Matchmaker | 2 | 蓝 | _ugh_cards/Matchmaker.jpg |
| 信徒 | Piety | 1 | 蓝 | _ugh_cards/Piety.jpg |
| 传染 | Conspiracy | 1 | 黑 | _ugh_cards/Conspiracy.jpg |
| 夜晚 | Night | 1 | 黑 | _ugh_cards/Night.jpg |

> 基础牌合计 **59** 张；Bless、Shilling 是扩展/促销，不计入。中文名已按中文版对照页（https://andyventure.com/boardgame-salem-1692/）定稿，机器可读版本见 `assets/cards/cards.zh.json`。

## 3. 角色卡 15 张

| 中文工作名 | 英文 | 文件 |
|---|---|---|
| 阿比盖尔·威廉姆斯 | Abigail Williams | _ugh_cards/Abigail Williams.jpg |
| 安妮·普特南 | Anne Putnam | _ugh_cards/Anne Putnam.jpg |
| 科顿·马瑟 | Cotton Mather | _ugh_cards/Cotton Mather.jpg |
| 乔治·伯勒斯 | George Burroughs | _ugh_cards/George Burroughs.jpg |
| 贾尔斯·科里 | Giles Corey | _ugh_cards/Giles Corey.jpg |
| 约翰·普罗克特 | John Proctor | _ugh_cards/John Proctor.jpg |
| 玛莎·科里 | Martha Corey | _ugh_cards/Martha Corey.jpg |
| 玛丽·沃伦 | Mary Warren | _ugh_cards/Mary Warren.jpg |
| 丽贝卡·诺斯 | Rebecca Nurse | _ugh_cards/Rebecca Nurse.jpg |
| 塞缪尔·帕里斯 | Samuel Parris | _ugh_cards/Samuel Parris.jpg |
| 莎拉·古德 | Sarah Good | _ugh_cards/Sarah Good.jpg |
| 托马斯·丹福斯 | Thomas Danforth | _ugh_cards/Thomas Danforth.jpg |
| 蒂图巴 | Tituba | _ugh_cards/Tituba.jpg |
| 威尔·格里格斯 | Will Griggs | _ugh_cards/Will Griggs.jpg |
| 威廉·菲普斯 | William Phipps | _ugh_cards/William Phipps.jpg |

## 4. 身份卡

| 中文工作名 | 英文 | 文件 | 规格 |
|---|---|---|---|
| 警长 | Constable | _card_faces/Constable.png | 384×583 |
| 平民 | Not a Witch | _card_faces/NotAWitch.png | 384×583 |
| 女巫 | Witch | _card_faces/Witch.png | 384×583 |

## 5. 缺口

1. **没有中文卡面**：仓库内没有任何中文卡牌、角色卡、身份卡的扫描或矢量文件。
2. **没有牌背**：基础牌、角色卡、身份卡、黑卡都没有可用的牌背素材。
3. **没有 UI 图标**：夜晚、锤子、自首、指控点数、跳过回合、断线、房主等图标需要自绘或买图标集。
4. **没有可商用字体**：现有 PDF 内嵌字体不能直接抽取再分发；需要选开源中文字体（如思源宋体/思源黑体）并做子集化。
5. **扫描清晰度不足**：_ugh_cards 只有 176×264，大约相当于 1× 手机卡面；直接放大会糊。_card_faces 384×583 只适合做构图参考，文字仍要重排。
6. **规则书插图不能当卡面**：17 张内嵌图是封面/场景/配件，不是卡牌正面。
7. **素材授权**：现有扫描来自公开仓库/规则书，正式发行前需要确认授权；W-10 应把“自绘”作为默认路线。

## 6. 建议

- **默认路线**：自绘中文卡面。用 _card_faces 的 384×583 构图做参考，重画卡框、色带、标题与效果文字；输出 2× / 3× 两套（750×1136、1125×1704），同时保留 SVG 源。
- **备选路线**：用户把中文版实体卡扫描或官方素材放到 assets/source/，按“卡牌英文名.png”命名；W-10 只做裁切、去底、压缩与版权确认。
- **MVP 最小集**：15 种基础牌 + 15 张角色卡 + 3 种身份卡 + 4 种牌背 + 8 个 UI 图标；先不做 Bless/Shilling。
- **验收**：在 390×844 竖屏上，卡面文字最小 12px 可读；卡面资源总量控制在 8 MB 以内（WebP/AVIF 优先）。

## 7. 产物

- docs/research/contact-sheet-cards.png
- docs/research/contact-sheet-identities.png
- docs/research/contact-sheet-trials.png
- docs/research/asset-manifest.json
- docs/rules/_make_contact_sheets.py（可重跑）
- assets/source/README.md（中文素材投放约定）
- assets/cards/zh/（33 张中文样张 + 4 张牌背 + contact sheet + manifest）
- assets/cards/cards.zh.json（客户端渲染用卡牌数据，唯一数据源）
