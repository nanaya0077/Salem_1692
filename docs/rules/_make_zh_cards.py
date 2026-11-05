# -*- coding: utf-8 -*-
"""Generate Chinese card faces from the English scans in docs/rules/_ugh_cards.

The source scans are 176x264 (or 341x527 for trial cards). We keep the original
art and decorative frame, cover the English title/rules area with a parchment
label plate, and draw Chinese text on top. This is a localization sample, not a
final print asset: production should redraw the frame and type at vector quality.
"""
from pathlib import Path
from PIL import Image, ImageDraw, ImageFont, ImageOps
import json, math

ROOT = Path(__file__).resolve().parents[2]
SRC_BASE = ROOT / "docs/rules/_ugh_cards"
SRC_TRIAL = ROOT / "docs/rules/_card_faces"
OUT = ROOT / "assets/cards/zh"
OUT.mkdir(parents=True, exist_ok=True)

FONT_BOLD = "C:/Windows/Fonts/msyhbd.ttc"
FONT_BODY = "C:/Windows/Fonts/msyh.ttc"
W, H = 750, 1136

TYPE_COLORS = {
    "red": (150, 42, 34),
    "green": (54, 92, 54),
    "blue": (52, 78, 112),
    "black": (38, 34, 42),
    "identity": (120, 74, 34),
    "trial": (110, 82, 38),
}

BASE = [
    ("Accusation.jpg", "accusation", "指控", "对另一玩家打出，+1 点指控。", "红卡", "red"),
    ("Alibi.jpg", "alibi", "辩护", "弃掉目标面前最多 3 张指控（或 1 张证据）。", "绿卡", "green"),
    ("Arson.jpg", "arson", "纵火", "目标弃掉整手牌；莎拉·古德免疫。", "绿卡", "green"),
    ("Asylum.jpg", "asylum", "避难", "持有者夜晚不会被杀。", "蓝卡", "blue"),
    ("Black Cat.jpg", "black-cat", "黑猫", "每次传染被抽到，持有者失去一张身份卡，由抽到传染者选。", "蓝卡", "blue"),
    ("Conspiracy.jpg", "conspiracy", "传染", "立即结算：翻黑猫持有者一张身份卡；所有存活玩家同时从左邻取一张身份卡，查看后洗混放回。", "黑卡", "black"),
    ("Curse.jpg", "curse", "诅咒", "弃掉目标面前一张蓝卡。", "绿卡", "green"),
    ("Evidence.jpg", "evidence", "证据", "对另一玩家打出，+3 点指控。", "红卡", "red"),
    ("Matchmaker.jpg", "matchmaker", "情侣", "两名持有者绑定；一人死亡，另一人同死。", "蓝卡", "blue"),
    ("Night.jpg", "night", "夜晚", "立即进入夜晚：女巫选杀、警长锤子、自首、结算。", "黑卡", "black"),
    ("Piety.jpg", "piety", "信徒", "其他玩家不能对你打出红卡。", "蓝卡", "blue"),
    ("Robbery.jpg", "robbery", "抢劫", "把来源整手牌交给另一名玩家。", "绿卡", "green"),
    ("SECRET.jpg", "scapegoat", "嫁祸", "把来源面前所有出牌移到另一名玩家面前。", "绿卡", "green"),
    ("Stocks.jpg", "stocks", "拘留", "目标下一个回合跳过；可叠加。", "绿卡", "green"),
    ("Witness.jpg", "witness", "目击", "对另一玩家打出，+7 点指控。", "红卡", "red"),
]

IDENTITIES = [
    ("Abigail Williams.jpg", "abigail-williams", "阿比盖尔·威廉姆斯", "你打出最后一张指控使身份卡翻开时，可弃掉自己面前所有红卡。"),
    ("Anne Putnam.jpg", "anne-putnam", "安妮·普特南", "回合结束，每翻开一张身份卡抽 2 张。"),
    ("Cotton Mather.jpg", "cotton-mather", "科顿·马瑟", "打在你面前的证据只算 1 点。"),
    ("George Burroughs.jpg", "george-burroughs", "乔治·伯勒斯", "需要 8 点指控才失去身份卡。"),
    ("Giles Corey.jpg", "giles-corey", "贾尔斯·科里", "回合抽两张都是红卡时，展示并补抽第三张。"),
    ("John Proctor.jpg", "john-proctor", "约翰·普罗克特", "玩家死亡时，从其手牌选至多 3 张，其余弃掉。"),
    ("Martha Corey.jpg", "martha-corey", "玛莎·科里", "复制右邻第一个存活玩家的能力。"),
    ("Mary Warren.jpg", "mary-warren", "玛丽·沃伦", "免疫情侣与黑猫的负面效果。"),
    ("Rebecca Nurse.jpg", "rebecca-nurse", "丽贝卡·诺斯", "其他玩家因指控翻牌时，你抽 1 张。"),
    ("Samuel Parris.jpg", "samuel-parris", "塞缪尔·帕里斯", "每局两次，花回合从弃牌堆拿至多 2 张非黑卡。"),
    ("Sarah Good.jpg", "sarah-good", "莎拉·古德", "对你打出的抢劫和纵火无效，并立刻丢弃。"),
    ("Thomas Danforth.jpg", "thomas-danforth", "托马斯·丹福斯", "第 6（或 7）点指控时可翻对方一张身份卡。"),
    ("Tituba.jpg", "tituba", "蒂图巴", "每局一次，回合开始前重排牌堆（两倍沙漏）。"),
    ("Will Griggs.jpg", "will-griggs", "威尔·格里格斯", "可把辩护当目击使用，+7。"),
    ("William Phipps.jpg", "william-phipps", "威廉·菲普斯", "每局一次，自首但不翻身份卡。"),
]

TRIALS = [
    ("Constable.png", "constable", "警长", "翻开后成为警长；夜晚可放锤子。"),
    ("NotAWitch.png", "not-a-witch", "平民", "平民身份卡。"),
    ("Witch.png", "witch", "女巫", "翻开即暴露；死亡时揭示其余女巫牌。"),
]


def font(path, size):
    return ImageFont.truetype(path, size)


def wrap(draw, text, f, max_w):
    lines, line = [], ""
    for ch in text:
        if ch == "\n":
            lines.append(line); line = ""; continue
        test = line + ch
        if draw.textlength(test, font=f) <= max_w or not line:
            line = test
        else:
            lines.append(line); line = ch
    if line:
        lines.append(line)
    return lines


def plate(draw, y, h, color):
    x0, x1 = 34, W - 34
    draw.rounded_rectangle([x0, y, x1, y + h], radius=18, fill=(240, 228, 200, 255), outline=(96, 58, 30, 255), width=3)
    # colored rule on the left edge
    draw.rounded_rectangle([x0, y, x0 + 10, y + h], radius=5, fill=color)


def type_pill(draw, text, color, y):
    f = font(FONT_BOLD, 26)
    tw = draw.textlength(text, font=f)
    x = 54
    draw.rounded_rectangle([x, y + 10, x + tw + 30, y + 48], radius=15, fill=color)
    draw.text((x + 15, y + 16), text, font=f, fill=(255, 248, 232))


def make(src, out_slug, title, body, type_label, type_key, trial=False):
    img = Image.open(src).convert("RGB")
    img = ImageOps.fit(img, (W, H), Image.LANCZOS, centering=(0.5, 0.45))
    draw = ImageDraw.Draw(img, "RGBA")
    color = TYPE_COLORS[type_key]

    if trial:
        py, ph = 850, 250
        plate(draw, py, ph, color)
        type_pill(draw, "身份卡", color, py)
        tf = font(FONT_BOLD, 68)
        draw.text((W // 2, py + 58), title, font=tf, fill=(58, 30, 20), anchor="mm")
        bf = font(FONT_BODY, 34)
        lines = wrap(draw, body, bf, 620)
        yy = py + 132
        for line in lines[:3]:
            draw.text((W // 2, yy), line, font=bf, fill=(80, 54, 38), anchor="mm")
            yy += 42
    else:
        py, ph = (540 if type_key != "identity" else 650), (540 if type_key != "identity" else 430)
        plate(draw, py, ph, color)
        type_pill(draw, type_label, color, py)
        tf = font(FONT_BOLD, 64 if type_key != "identity" else 60)
        draw.text((W // 2, py + 86), title, font=tf, fill=(54, 28, 18), anchor="mm")
        # divider
        draw.line([(90, py + 136), (W - 90, py + 136)], fill=(120, 70, 40, 180), width=3)
        bf = font(FONT_BODY, 38 if type_key != "identity" else 36)
        lines = wrap(draw, body, bf, 610)
        yy = py + 174
        for line in lines[:7]:
            draw.text((W // 2, yy), line, font=bf, fill=(76, 48, 32), anchor="mm")
            yy += 46 if type_key != "identity" else 44

    out = OUT / (out_slug + ".png")
    img.save(out, "PNG", optimize=True)
    # 1.5x print export
    big = img.resize((1125, 1704), Image.LANCZOS)
    big.save(OUT / (out_slug + "@1125.png"), "PNG", optimize=True)
    return out


def make_backs():
    backs = [
        ("back-base", "基础牌背", (54, 32, 24), (198, 158, 66)),
        ("back-identity", "角色卡背", (70, 28, 26), (218, 178, 96)),
        ("back-trial", "身份卡背", (38, 32, 26), (198, 158, 66)),
        ("back-night", "夜晚牌背", (18, 22, 32), (186, 190, 210)),
    ]
    for slug, label, bg, fg in backs:
        img = Image.new("RGB", (W, H), bg)
        draw = ImageDraw.Draw(img, "RGBA")
        # concentric geometry
        cx, cy = W // 2, H // 2
        for r in range(90, 430, 34):
            draw.ellipse([cx - r, cy - r, cx + r, cy + r], outline=(fg[0], fg[1], fg[2], 46), width=2)
        draw.line([(cx, 100), (cx, H - 100)], fill=(fg[0], fg[1], fg[2], 30), width=2)
        draw.line([(100, cy), (W - 100, cy)], fill=(fg[0], fg[1], fg[2], 30), width=2)
        f1 = font(FONT_BOLD, 64); f2 = font(FONT_BODY, 24); f3 = font(FONT_BOLD, 30)
        draw.text((cx, cy - 40), "女巫镇", font=f1, fill=fg, anchor="mm")
        draw.text((cx, cy + 30), "SALEM 1692", font=f2, fill=fg, anchor="mm")
        draw.text((cx, cy + 92), label, font=f3, fill=fg, anchor="mm")
        img.save(OUT / (slug + ".png"), "PNG", optimize=True)
        img.resize((1125, 1704), Image.LANCZOS).save(OUT / (slug + "@1125.png"), "PNG", optimize=True)


def contact_sheet(paths):
    cols, thumb_w, thumb_h, pad, label_h = 6, 190, 288, 14, 32
    rows = math.ceil(len(paths) / cols)
    sheet = Image.new("RGB", (cols * (thumb_w + pad) + pad, rows * (thumb_h + label_h + pad) + pad), (28, 24, 20))
    d = ImageDraw.Draw(sheet)
    f = font(FONT_BODY, 16)
    for i, p in enumerate(paths):
        im = Image.open(p).convert("RGB").resize((thumb_w, thumb_h), Image.LANCZOS)
        x = pad + (i % cols) * (thumb_w + pad)
        y = pad + (i // cols) * (thumb_h + label_h + pad)
        sheet.paste(im, (x, y))
        d.text((x + 4, y + thumb_h + 6), p.stem, font=f, fill=(238, 226, 198))
    sheet.save(OUT / "contact-sheet.png", "PNG", optimize=True)


def main():
    made = []
    for src, slug, title, body, label, key in BASE:
        made.append(make(SRC_BASE / src, slug, title, body, label, key))
    for src, slug, title, body in IDENTITIES:
        made.append(make(SRC_BASE / src, slug, title, body, "角色卡", "identity"))
    for src, slug, title, body in TRIALS:
        made.append(make(SRC_TRIAL / src, slug, title, body, "身份卡", "trial", trial=True))
    make_backs()
    contact_sheet(made)
    manifest = {
        "source": "docs/rules/_ugh_cards + docs/rules/_card_faces",
        "size": [W, H],
        "print_size": [1125, 1704],
        "cards": [
            {"slug": slug, "name": name, "type": "base", "source": src}
            for src, slug, name, _ in [(b[0], b[1], b[2], b[3]) for b in BASE]
        ] + [
            {"slug": slug, "name": name, "type": "identity", "source": src}
            for src, slug, name, _ in IDENTITIES
        ] + [
            {"slug": slug, "name": name, "type": "trial", "source": src}
            for src, slug, name, _ in TRIALS
        ],
    }
    (OUT / "manifest.json").write_text(json.dumps(manifest, ensure_ascii=False, indent=2), encoding="utf-8")
    print("made", len(made), "cards ->", OUT)


if __name__ == "__main__":
    main()
