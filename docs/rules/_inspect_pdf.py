import fitz
p="docs/rules/salem_rulebook.pdf"
d=fitz.open(p)
print("pages", d.page_count)
for i,page in enumerate(d):
    imgs=page.get_images(full=True)
    txt=page.get_text("text")[:60].replace("\n"," ")
    print(i+1, "size", tuple(round(x) for x in page.rect[2:]), "imgs", len(imgs), "text", repr(txt))
