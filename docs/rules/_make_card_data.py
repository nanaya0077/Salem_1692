# -*- coding: utf-8 -*-
"""Export the canonical Chinese card data used by the client renderer.

The PNGs under assets/cards/zh are a localization/export fallback. Gameplay
should render the card frame and text in the browser (DOM/SVG), using only the
art crop as an image layer, so text stays sharp at every device pixel ratio.
"""
from pathlib import Path
import importlib.util, json

HERE = Path(__file__).resolve().parent
spec = importlib.util.spec_from_file_location("cards", HERE / "_make_zh_cards.py")
cards = importlib.util.module_from_spec(spec)
spec.loader.exec_module(cards)

ROOT = HERE.parents[1]
OUT = ROOT / "assets/cards/cards.zh.json"

TARGET = {
    "accusation": "other", "evidence": "other", "witness": "other",
    "alibi": "other", "stocks": "other", "arson": "other", "curse": "other",
    "asylum": "other", "matchmaker": "other", "piety": "other", "blackcat": "other",
    "scapegoat": "two", "robbery": "two", "conspiracy": "none", "night": "none",
}
ID = {"black-cat": "blackcat", "not-a-witch": "not-a-witch"}
ALIGN = {"constable": "constable", "not-a-witch": "not-witch", "witch": "witch"}

rows = []
for src, slug, name, text, label, color in cards.BASE:
    cid = ID.get(slug, slug)
    rows.append({
        "id": cid, "name": name, "kind": "base", "color": color,
        "typeLabel": label, "points": {"accusation": 1, "evidence": 3, "witness": 7}.get(cid, 0),
        "target": TARGET[cid], "text": text,
        "image": f"assets/cards/zh/{slug}.png",
        "printImage": f"assets/cards/zh/{slug}@1125.png",
    })
for src, slug, name, text in cards.IDENTITIES:
    rows.append({
        "id": slug, "name": name, "kind": "identity", "color": "identity",
        "typeLabel": "角色卡", "points": 0, "target": "none", "text": text,
        "image": f"assets/cards/zh/{slug}.png",
        "printImage": f"assets/cards/zh/{slug}@1125.png",
    })
for src, slug, name, text in cards.TRIALS:
    rows.append({
        "id": slug, "name": name, "kind": "trial", "color": "trial",
        "typeLabel": "身份卡", "points": 0, "target": "none", "text": text,
        "alignment": ALIGN[slug],
        "image": f"assets/cards/zh/{slug}.png",
        "printImage": f"assets/cards/zh/{slug}@1125.png",
    })

data = {
    "version": 1,
    "locale": "zh-CN",
    "source": "docs/rules/_ugh_cards + docs/rules/_card_faces",
    "note": "卡名、类型名与效果文本均按中文旧版（andyventure 对照页）。信徒=其他玩家不能对你打出红卡；莎拉·古德=对你打出的抢劫/纵火无效并立刻丢弃。默认配比 4–9 人每人 5 张身份卡、10–12 人每人 3 张；女巫数与每人身份卡数可在开局前配置。PNG 是本地化样张/导出回退；正式对局由客户端用 DOM/SVG 渲染卡框与文字，只把插画当图片层。",
    "edition": {"rules": "zh-old", "customizable": ["witchCount", "identityCardsPerPlayer"], "constableCount": 1},
    "render": {"mode": "client-dom", "handShowsText": False, "tapToZoom": True,
               "minBodyPx": 18, "minTitlePx": 26, "imageLayer": "art-crop"},
    "cards": rows,
}
OUT.write_text(json.dumps(data, ensure_ascii=False, indent=2), encoding="utf-8")
print("wrote", OUT, len(rows), "cards")
