from PIL import Image, ImageDraw, ImageFont
from pathlib import Path
import hashlib, json

root = Path(r"E:/Githubrepo/女巫镇")
card_dir = root / "docs/rules/_ugh_cards"
out_dir = root / "docs/research"
out_dir.mkdir(parents=True, exist_ok=True)

cards = ["Accusation","Evidence","Witness","Alibi","Stocks","SECRET","Arson","Curse","Robbery","Asylum","Black Cat","Matchmaker","Piety","Conspiracy","Night"]
identities = ["Abigail Williams","Anne Putnam","Cotton Mather","George Burroughs","Giles Corey","John Proctor","Martha Corey","Mary Warren","Rebecca Nurse","Samuel Parris","Sarah Good","Thomas Danforth","Tituba","Will Griggs","William Phipps"]
trials = ["Constable","NotAWitch","Witch"]

face_dir = root / "docs/rules/_card_faces"

def load(name):
    p = card_dir / f"{name}.jpg"
    if not p.exists():
        p = face_dir / f"{name}.png"
    return Image.open(p).convert("RGB")

def sheet(names, out_name, cols=5, tw=220, th=330):
    rows = (len(names)+cols-1)//cols
    label_h = 28
    pad = 12
    W = cols*(tw+pad)+pad
    H = rows*(th+label_h+pad)+pad
    canvas = Image.new("RGB",(W,H),(245,241,232))
    d = ImageDraw.Draw(canvas)
    try:
        font = ImageFont.truetype("C:/Windows/Fonts/arial.ttf", 14)
    except Exception:
        font = ImageFont.load_default()
    for i,n in enumerate(names):
        im = load(n)
        im.thumbnail((tw,th), Image.LANCZOS)
        x = pad + (i%cols)*(tw+pad) + (tw-im.width)//2
        y = pad + (i//cols)*(th+label_h+pad)
        canvas.paste(im,(x,y))
        label = n
        bb = d.textbbox((0,0),label,font=font)
        d.text((pad+(i%cols)*(tw+pad)+(tw-(bb[2]-bb[0]))//2, y+th+4), label, fill=(30,25,20), font=font)
    canvas.save(out_dir/out_name, optimize=True)
    print(out_name, canvas.size)

sheet(cards,"contact-sheet-cards.png")
sheet(identities,"contact-sheet-identities.png")
sheet(trials,"contact-sheet-trials.png",cols=3,tw=220,th=330)

files=[]
for p in sorted(card_dir.glob("*.jpg")):
    im=Image.open(p)
    files.append({"file":str(p.relative_to(root)).replace("\\","/"),"w":im.width,"h":im.height,"bytes":p.stat().st_size,"sha256":hashlib.sha256(p.read_bytes()).hexdigest()})
(out_dir/"asset-manifest.json").write_text(json.dumps({"cards":files,"count":len(files)},ensure_ascii=False,indent=2),encoding="utf-8")
print("manifest",len(files))
