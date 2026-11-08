"""AC1 Probe: what is this PDF, technically? Facts only; the medium (web/print/deck...) is a separate proposal."""
from __future__ import annotations

import re

import pymupdf

from .pdfio import PdfBlocked, open_pdf          # noqa: F401  (PdfBlocked is part of this module's API)

_SUBSET = re.compile(r"^[A-Z]{6}\+")


def is_subset_name(name):
    return bool(_SUBSET.match(name or ""))


def strip_subset(name):
    return _SUBSET.sub("", name or "")


def family_of(raw):
    """'ABCDEF+OfficinaSansStd-Book' -> 'OfficinaSansStd'; 'Arial,Bold' -> 'Arial'."""
    n = strip_subset(raw).strip()
    fam = re.split(r"[-,]", n, maxsplit=1)[0].strip()
    return fam or n


_WEIGHT_WORDS = (
    ("extrabold", 800), ("ultrabold", 800), ("semibold", 600), ("demibold", 600), ("extralight", 200),
    ("ultralight", 200), ("xbold", 800), ("xlight", 200), ("thin", 100), ("light", 300), ("medium", 500),
    ("heavy", 800), ("black", 900), ("bold", 700), ("demi", 600), ("regular", 400), ("book", 400),
    ("roman", 400),
)
_WEIGHT_ABBR = {"lt": 300, "md": 500, "hv": 800, "bd": 700, "blk": 900, "bk": 400, "rg": 400, "sb": 600}


def parse_style(name):
    """Style facts read from a PostScript font name: weight (100-900), italic, width."""
    n = strip_subset(name)
    parts = re.split(r"[-,]", n, maxsplit=1)
    style = parts[1] if len(parts) > 1 else ""
    low = style.lower()
    tokens = [t.lower() for t in re.findall(r"[A-Z][a-z]*|[a-z]+|\d+", style)]
    weight = 400
    for word, w in _WEIGHT_WORDS:
        if word in low:
            weight = w
            break
    else:
        for t in tokens:
            if t in _WEIGHT_ABBR:
                weight = _WEIGHT_ABBR[t]
                break
    italic = "ital" in low or "obl" in low or "it" in tokens or "slanted" in low
    if "semi" in tokens and ("cn" in tokens or "cond" in low):
        width = "semi-condensed"
    elif "cond" in low or "cn" in tokens or "narrow" in low:
        width = "condensed"
    elif "expanded" in low or "extended" in low or "wide" in low:
        width = "expanded"
    else:
        width = "normal"
    return {"weight": weight, "italic": bool(italic), "width": width}


def page_type(pdf, pno):
    """'raster' = one image covers the page and there is (almost) no text layer; otherwise 'vector_text'."""
    rect = pdf.page_rect(pno)
    area = rect.width * rect.height
    cov = 0.0
    if area > 0:
        for im in pdf.image_info(pno):
            r = pymupdf.Rect(im["bbox"]) & rect
            if not r.is_empty:
                cov = max(cov, r.get_area() / area)
    if cov >= 0.85 and pdf.text_chars(pno) < 20:
        return "raster"
    return "vector_text"


def probe_pdf(path):
    with open_pdf(path) as pdf:
        doc = pdf.doc
        n = pdf.pages
        sizes, order = {}, []
        for i in range(n):
            r = pdf.page_rect(i)
            k = (round(r.width, 1), round(r.height, 1))
            if k not in sizes:
                sizes[k] = 0
                order.append(k)
            sizes[k] += 1
        page_sizes = [{"w": k[0], "h": k[1], "count": sizes[k]}
                      for k in sorted(order, key=lambda k: (-sizes[k], order.index(k)))]

        page_types, text_pages, xrefs, image_pages = [], 0, set(), []
        fonts = {}
        for i in range(n):
            page_types.append(page_type(pdf, i))
            if pdf.text_chars(i) > 0:
                text_pages += 1
            imgs = doc[i].get_images(full=True)
            if imgs:
                image_pages.append(i + 1)
            for im in imgs:
                xrefs.add(im[0])
            for f in doc.get_page_fonts(i):
                raw = f[3] or ""
                if not raw:
                    continue
                name = strip_subset(raw)
                e = fonts.setdefault(name, {"name": name, "raw": raw, "family": family_of(raw), "subset": False,
                                            "embedded": False, "type": f[2], "pages": set()})
                e["subset"] = e["subset"] or is_subset_name(raw)
                e["embedded"] = e["embedded"] or (f[1] not in ("n/a", ""))
                e["pages"].add(i + 1)
        font_list = sorted(fonts.values(), key=lambda e: (-len(e["pages"]), e["name"]))
        for e in font_list:
            e["pages"] = sorted(e["pages"])

        kinds = set(page_types)
        if kinds == {"vector_text"}:
            pdf_type, strategy = "vector_text", "vector-exact"
        elif kinds == {"raster"}:
            pdf_type, strategy = "raster", "raster-sampled"
        else:
            pdf_type, strategy = "mixed", "hybrid"
        vector_ratio = round(page_types.count("vector_text") / float(n), 3)
        meta = doc.metadata or {}
        return {
            "pages": n,
            "page_sizes": page_sizes,
            "fonts": font_list,
            "font_families": sorted({e["family"] for e in font_list}),
            "has_text_layer": text_pages > 0,
            "text_pages": text_pages,
            "image_count": len(xrefs),
            "image_pages": image_pages,
            "vector_ratio": vector_ratio,
            "page_types": page_types,
            "pdf_type": pdf_type,
            "strategy": strategy,
            "producer": meta.get("producer") or "",
            "creator": meta.get("creator") or "",
            "title": meta.get("title") or "",
            "pdf_format": meta.get("format") or "",
            "bookmarks": len(doc.get_toc()),
            "encrypted": bool(doc.is_encrypted),
        }
