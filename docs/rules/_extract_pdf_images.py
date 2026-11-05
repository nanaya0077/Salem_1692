import fitz, os, json
p="docs/rules/salem_rulebook.pdf"
d=fitz.open(p)
os.makedirs("docs/rules/_pdf_images", exist_ok=True)
seen={}
rows=[]
for i,page in enumerate(d):
    for img in page.get_images(full=True):
        xref=img[0]
        if xref in seen: continue
        info=d.extract_image(xref)
        ext=info["ext"]; w=info["width"]; h=info["height"]
        fn=f"docs/rules/_pdf_images/x{xref}.{ext}"
        open(fn,"wb").write(info["image"])
        seen[xref]=fn
        rows.append((xref,w,h,ext,i+1,fn))
for r in rows:
    print(r)
print("total", len(rows))
