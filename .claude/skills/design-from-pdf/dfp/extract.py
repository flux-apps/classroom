"""AC2 Extraction: colours, type, strokes, radii, opacities. Vector pages are exact; raster pages are sampled and
every raster-derived value is marked `estimated`. What cannot be measured is named in `unknown`, never invented."""
from __future__ import annotations

import statistics
from collections import defaultdict

from .pdfio import open_pdf, select_pages
from .probe import family_of, page_type, parse_style, strip_subset
from .util import int_hex, rgb_hex

RASTER_SAMPLE_PAGES = 8
RASTER_DPI = 72


def _round_size(x):
    return round(float(x), 1)


def _corner_radius(d):
    """Radius of a rounded rectangle drawn as 4 curves + straight edges; None for anything else."""
    ops = [it[0] for it in d.get("items", [])]
    if ops.count("c") != 4 or ops.count("l") < 2 or len(ops) > 9 or any(o not in ("l", "c") for o in ops):
        return None
    rect = d["rect"]
    w, h = rect.width, rect.height
    if min(w, h) < 3:
        return None
    hs, vs = [], []
    for it in d["items"]:
        if it[0] != "l":
            continue
        p1, p2 = it[1], it[2]
        if abs(p2.y - p1.y) < 0.05:
            hs.append(abs(p2.x - p1.x))
        elif abs(p2.x - p1.x) < 0.05:
            vs.append(abs(p2.y - p1.y))
    cands = []
    if hs:
        cands.append((w - max(hs)) / 2.0)
    if vs:
        cands.append((h - max(vs)) / 2.0)
    cands = [c for c in cands if c > 0.2]
    return min(cands) if cands else None


class _Acc:
    def __init__(self):
        self.colors = {}
        self.styles = {}
        self.strokes = defaultdict(lambda: {"count": 0, "pages": set()})
        self.radii = defaultdict(lambda: {"count": 0, "pages": set()})
        self.opacities = defaultdict(lambda: {"count": 0, "pages": set()})
        self.line_gaps = defaultdict(list)
        self.text_bounds = []

    def color(self, hexv, role, page, count=1, area=0.0, method="exact"):
        e = self.colors.setdefault((hexv, role), {"hex": hexv, "role": role, "count": 0, "area": 0.0,
                                                  "pages": set(), "method": method})
        e["count"] += count
        e["area"] += area
        e["pages"].add(page)


def _vector_page(pdf, pno, page_no, acc):
    for d in pdf.drawings(pno):
        kind = d.get("type")
        rect = d.get("rect")
        area = (rect.width * rect.height) if rect is not None else 0.0
        fill, stroke = d.get("fill"), d.get("color")
        if kind in ("f", "fs") and fill is not None:
            acc.color(rgb_hex(fill), "fill", page_no, area=area)
        if kind in ("s", "fs") and stroke is not None:
            acc.color(rgb_hex(stroke), "stroke", page_no, area=area)
            w = d.get("width")
            if w:
                e = acc.strokes[round(float(w), 2)]
                e["count"] += 1
                e["pages"].add(page_no)
        for key in ("fill_opacity", "stroke_opacity"):
            o = d.get(key)
            if o is not None and o < 0.999:
                e = acc.opacities[round(float(o), 2)]
                e["count"] += 1
                e["pages"].add(page_no)
        r = _corner_radius(d) if kind in ("f", "fs", "s") else None
        if r is not None:
            e = acc.radii[round(r * 2) / 2.0]
            e["count"] += 1
            e["pages"].add(page_no)

    td = pdf.text_dict(pno)
    lines_by_style = defaultdict(list)
    x0s, y0s, x1s, y1s = [], [], [], []
    for b in td.get("blocks", []):
        if b.get("type", 0) != 0:
            continue
        for ln in b.get("lines", []):
            spans = [s for s in ln.get("spans", []) if s.get("text", "").strip()]
            if not spans:
                continue
            bx = ln["bbox"]
            x0s.append(bx[0]); y0s.append(bx[1]); x1s.append(bx[2]); y1s.append(bx[3])
            dom = max(spans, key=lambda s: len(s["text"].strip()))
            for s in spans:
                chars = len(s["text"].strip())
                name = strip_subset(s.get("font", ""))
                color = int_hex(s.get("color", 0))
                acc.color(color, "text", page_no, count=chars,
                          area=(s["bbox"][2] - s["bbox"][0]) * (s["bbox"][3] - s["bbox"][1]))
                key = (name, _round_size(s.get("size", 0)), color)
                e = acc.styles.setdefault(key, {"name": name, "size": key[1], "color": color, "flags": s.get("flags", 0),
                                                "count": 0, "pages": set()})
                e["count"] += chars
                e["pages"].add(page_no)
            dn = strip_subset(dom.get("font", ""))
            lines_by_style[(dn, _round_size(dom.get("size", 0)))].append((ln["bbox"][0], dom["origin"][1]))
    for style, items in lines_by_style.items():
        items.sort(key=lambda t: t[1])
        size = style[1]
        for (xa, ya), (xb, yb) in zip(items, items[1:]):
            gap = yb - ya
            if 0.8 * size <= gap <= 2.5 * size and abs(xb - xa) <= 3 * size:
                acc.line_gaps[style].append(round(gap, 2))
    if x0s:
        r = pdf.page_rect(pno)
        acc.text_bounds.append({"page": page_no, "w": round(r.width, 1), "h": round(r.height, 1),
                                "bbox": [round(min(x0s), 1), round(min(y0s), 1), round(max(x1s), 1), round(max(y1s), 1)]})


def _rgb_dist(a, b):
    return max(abs(x - y) for x, y in zip(a, b))


def _seg_dist(p, a, b):
    ab = [y - x for x, y in zip(a, b)]
    ap = [y - x for x, y in zip(a, p)]
    den = float(sum(v * v for v in ab)) or 1.0
    t = max(0.0, min(1.0, sum(x * y for x, y in zip(ab, ap)) / den))
    q = [x + t * v for x, v in zip(a, ab)]
    return max(abs(x - y) for x, y in zip(p, q))


def _sample_raster(pdf, page_nos, acc):
    """Histogram the rendered page: bucket near colours, keep the dominant exact colour of each bucket, drop
    anti-aliasing blends that lie between two stronger colours."""
    from PIL import Image

    buckets = {}
    total_px = 0
    for page_no in page_nos:
        pix = pdf.page(page_no - 1).get_pixmap(dpi=RASTER_DPI, alpha=False)
        im = Image.frombytes("RGB", (pix.width, pix.height), pix.samples)
        total_px += pix.width * pix.height
        for count, rgb in im.getcolors(maxcolors=pix.width * pix.height) or []:
            k = (rgb[0] >> 3, rgb[1] >> 3, rgb[2] >> 3)
            b = buckets.setdefault(k, {"n": 0, "best": (0, rgb)})
            b["n"] += count
            if count > b["best"][0]:
                b["best"] = (count, rgb)
    thr = max(8, int(0.00004 * total_px))
    cands = sorted(((b["n"], b["best"][1]) for b in buckets.values() if b["n"] >= thr), key=lambda t: -t[0])
    kept = []
    for n, rgb in cands:
        if any(_rgb_dist(rgb, k[1]) < 40 for k in kept):
            continue
        if any(_seg_dist(rgb, a[1], b[1]) < 14 for i, a in enumerate(kept) for b in kept[i + 1:]):
            continue
        kept.append((n, rgb))
        if len(kept) >= 24:
            break
    for n, rgb in kept:
        hexv = "#%02X%02X%02X" % rgb
        acc.color(hexv, "sampled", page_nos[0], count=n, area=round(n / float(max(total_px, 1)), 4), method="estimated")
        for p in page_nos[1:]:
            acc.colors[(hexv, "sampled")]["pages"].add(p)


def _flag_weight(flags, parsed):
    """Name carries the style; the PDF font flags are only a fallback when the name says nothing."""
    if parsed["weight"] == 400 and flags & 16:
        return 700
    return parsed["weight"]


def extract_pdf(path, pages=None):
    with open_pdf(path) as pdf:
        selected = select_pages(pdf.pages, pages)
        acc = _Acc()
        ptypes = {}
        raster_pages = []
        for page_no in selected:
            pno = page_no - 1
            ptypes[page_no] = page_type(pdf, pno)
            if ptypes[page_no] == "vector_text":
                _vector_page(pdf, pno, page_no, acc)
            else:
                raster_pages.append(page_no)
        if raster_pages:
            step = max(1, len(raster_pages) // RASTER_SAMPLE_PAGES)
            _sample_raster(pdf, raster_pages[::step][:RASTER_SAMPLE_PAGES], acc)

    colors = []
    for e in acc.colors.values():
        colors.append({"hex": e["hex"], "role": e["role"], "count": e["count"], "area": round(e["area"], 1),
                       "pages": sorted(e["pages"]), "method": e["method"]})
    colors.sort(key=lambda c: (-c["count"], c["hex"], c["role"]))

    styles = []
    for (name, size, color), e in acc.styles.items():
        parsed = parse_style(name)
        gaps = acc.line_gaps.get((name, size))
        styles.append({
            "family": family_of(name), "name": name, "weight": _flag_weight(e["flags"], parsed),
            "italic": parsed["italic"] or bool(e["flags"] & 2), "width": parsed["width"], "size": size,
            "color": color, "line_height": round(statistics.median(gaps), 1) if gaps else None,
            "count": e["count"], "pages": sorted(e["pages"]), "method": "exact"})
    styles.sort(key=lambda s: (-s["count"], s["size"], s["name"]))

    unknown = []
    if len(raster_pages) < len(selected):
        unknown += ["shadows", "gradients"]
    if raster_pages:
        if len(raster_pages) == len(selected):
            unknown += ["text_styles", "line_height", "font_names", "shadows", "gradients"]
        else:
            unknown += ["raster_pages_text_styles"]
    seen = set()
    unknown = [u for u in unknown if not (u in seen or seen.add(u))]
    return {
        "pages": selected,
        "page_types": [ptypes[p] for p in selected],
        "colors": colors,
        "text_styles": styles,
        "strokes": sorted(({"width": w, "count": e["count"], "pages": sorted(e["pages"])}
                           for w, e in acc.strokes.items()), key=lambda s: (-s["count"], s["width"])),
        "radii": sorted(({"radius": r, "count": e["count"], "method": "estimated", "pages": sorted(e["pages"])}
                         for r, e in acc.radii.items()), key=lambda s: (-s["count"], s["radius"])),
        "opacities": sorted(({"opacity": o, "count": e["count"], "pages": sorted(e["pages"])}
                             for o, e in acc.opacities.items()), key=lambda s: (-s["count"], s["opacity"])),
        "text_bounds": acc.text_bounds,
        "unknown": unknown,
    }
