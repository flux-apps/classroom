"""AC16 Coverage: how much of the page the clusters and the structure account for, and what is left over (A17, A18).

Per page, on a 1 pt = 1 px Pillow mask:
  denominator = UNION of drawing bboxes and text-line bboxes (full-page backgrounds >= 95 % of the page excluded),
                minus the UNION of embedded image blocks
  claimed     = the part of the denominator inside a cluster occurrence bbox or a structural element
                (a text style that is a text role, a divider, a section block, a table grid)
  claimed_pct = 100 * (1 - unclaimed / denominator); a page with denominator 0 reports None (photo-only page, raster
                PDF), never 100.
An unclaimed region is a proximity group (gap <= 4 pt) of unclaimed items; its tier is its area over the page area
against `threshold` (default 0.001): >= threshold is `actionable` (a UNC row for the user), below is `auto`.
"""
from __future__ import annotations

import math
from collections import defaultdict

from PIL import Image, ImageChops, ImageDraw

from .cluster import _Grid, page_model
from .pdfio import open_pdf, select_pages
from .structure import text_style_key

DENOMINATOR = ("union of drawing bboxes and text-line bboxes on each page (full-page backgrounds excluded), "
               "minus the union of embedded image blocks")
GAP = 4.0


def _px(b, w, h):
    x0, y0 = max(0, int(math.floor(b[0]))), max(0, int(math.floor(b[1])))
    x1, y1 = min(w, int(math.ceil(b[2]))), min(h, int(math.ceil(b[3])))
    if x1 <= x0:
        x1 = min(w, x0 + 1)
        x0 = x1 - 1 if x1 - 1 >= 0 else x0
    if y1 <= y0:
        y1 = min(h, y0 + 1)
        y0 = y1 - 1 if y1 - 1 >= 0 else y0
    return x0, y0, x1, y1


def _paint(mask, boxes, w, h):
    d = ImageDraw.Draw(mask)
    for b in boxes:
        x0, y0, x1, y1 = _px(b, w, h)
        d.rectangle([x0, y0, x1 - 1, y1 - 1], fill=255)


def _count(mask):
    return mask.histogram()[255]


def _contains(outer, b, tol=1.0):
    return outer[0] - tol <= b[0] and outer[1] - tol <= b[1] and outer[2] + tol >= b[2] and outer[3] + tol >= b[3]


def _gap(a, b):
    dx = max(0.0, max(a[0], b[0]) - min(a[2], b[2]))
    dy = max(0.0, max(a[1], b[1]) - min(a[3], b[3]))
    return (dx * dx + dy * dy) ** 0.5


def compute_coverage(path, clusters, structure=None, pages=None, threshold=0.001, progress=None):
    claim_boxes = defaultdict(list)
    for c in clusters or []:
        for b in c.get("boxes", []):
            claim_boxes[b[0]].append(b[1:5])
    role_styles, str_boxes = set(), defaultdict(list)
    for e in (structure or {}).get("elements", []):
        if e["type"] == "text-role":
            v = e["value"]
            role_styles.add((v["family"], v["size"], bool(v["bold"]), bool(v["italic"])))
        for b in e.get("boxes", []):
            if e["type"] in ("divider", "section-block", "table-grid"):
                str_boxes[b[0]].append(b[1:5])
    pages_out, unclaimed = [], []
    tot_d = tot_u = 0
    with open_pdf(path) as pdf:
        sel = select_pages(pdf.pages, pages)
        for page_no in sel:
            m = page_model(pdf, page_no - 1, page_no)
            pw, ph = m["pw"], m["ph"]
            W, H = max(1, int(math.ceil(pw))), max(1, int(math.ceil(ph)))
            page_area = pw * ph
            items = []                                                  # (bbox, kind)
            for s in m["shapes"]:
                items.append((s["bbox"], "drawing"))
            for r in m["rules"]:
                items.append((r["bbox"], "drawing"))
            for ln in m["lines"]:
                items.append((ln["bbox"], "text", text_style_key(ln)))
            items = [it if len(it) == 3 else (it[0], it[1], None) for it in items]
            images = [b for b in m["images"] if (b[2] - b[0]) * (b[3] - b[1]) > 0]
            photos = any((b[2] - b[0]) * (b[3] - b[1]) >= 0.03 * page_area for b in images)

            img_mask = Image.new("L", (W, H), 0)
            _paint(img_mask, images, W, H)
            d_all = Image.new("L", (W, H), 0)
            d_draw = Image.new("L", (W, H), 0)
            d_text = Image.new("L", (W, H), 0)
            _paint(d_draw, [b for b, k, _ in items if k == "drawing"], W, H)
            _paint(d_text, [b for b, k, _ in items if k == "text"], W, H)
            d_draw = ImageChops.subtract(d_draw, img_mask)
            d_text = ImageChops.subtract(d_text, img_mask)
            d_all = ImageChops.lighter(d_draw, d_text)
            den = _count(d_all)

            claims = list(claim_boxes.get(page_no, [])) + list(str_boxes.get(page_no, []))
            c_mask = Image.new("L", (W, H), 0)
            _paint(c_mask, claims, W, H)
            role_boxes = [b for b, k, st in items if k == "text" and st in role_styles]
            _paint(c_mask, role_boxes, W, H)
            u_all = ImageChops.subtract(d_all, c_mask)
            u_draw = ImageChops.subtract(d_draw, c_mask)
            u_text = ImageChops.subtract(d_text, c_mask)
            un = _count(u_all)

            grid = _Grid()
            allc = claims + role_boxes
            for i, b in enumerate(allc):
                grid.add(i, b)
            cand = []
            for b, kind, st in items:
                if any(_contains(allc[i], b) for i in grid.query(b)):
                    continue
                x0, y0, x1, y1 = _px(b, W, H)
                u = _count(u_all.crop((x0, y0, x1, y1)))
                area = max(1, (x1 - x0) * (y1 - y0))
                if u >= 20 or u >= 0.5 * area:
                    cand.append((b, kind, u))
            # proximity groups (gap <= 4 pt)
            parent = list(range(len(cand)))

            def find(i):
                while parent[i] != i:
                    parent[i] = parent[parent[i]]
                    i = parent[i]
                return i
            g2 = _Grid(32.0)
            for i, (b, _, _) in enumerate(cand):
                g2.add(i, [b[0] - GAP, b[1] - GAP, b[2] + GAP, b[3] + GAP])
            for i, (b, _, _) in enumerate(cand):
                for j in g2.query([b[0] - GAP, b[1] - GAP, b[2] + GAP, b[3] + GAP]):
                    if j > i and _gap(b, cand[j][0]) <= GAP:
                        parent[find(j)] = find(i)
            groups = defaultdict(list)
            for i in range(len(cand)):
                groups[find(i)].append(cand[i])
            regions = []
            for members in groups.values():
                ub = [min(b[0] for b, _, _ in members), min(b[1] for b, _, _ in members),
                      max(b[2] for b, _, _ in members), max(b[3] for b, _, _ in members)]
                x0, y0, x1, y1 = _px(ub, W, H)
                rm = Image.new("L", (x1 - x0, y1 - y0), 0)
                for b, _, _ in members:
                    bx0, by0, bx1, by1 = _px(b, W, H)
                    rm.paste(u_all.crop((bx0, by0, bx1, by1)), (bx0 - x0, by0 - y0), u_all.crop((bx0, by0, bx1, by1)))
                area = _count(rm)
                if area <= 0:
                    continue
                ratio = area / page_area if page_area else 0.0
                regions.append({"page": page_no, "bbox": [round(v, 1) for v in ub], "area_pt2": area,
                                "area_pct": round(100.0 * ratio, 3),
                                "tier": "actionable" if ratio >= threshold else "auto",
                                "kinds": sorted({k for _, k, _ in members})})
            regions.sort(key=lambda r: (r["bbox"][1], r["bbox"][0]))
            unclaimed.extend(regions)
            dd, dt = _count(d_draw), _count(d_text)
            pages_out.append({
                "page": page_no,
                "drawing_pct": round(100.0 * (1 - _count(u_draw) / float(dd)), 1) if dd else None,
                "text_pct": round(100.0 * (1 - _count(u_text) / float(dt)), 1) if dt else None,
                "image": "photos" if photos else "n/a", "denominator_pt2": den, "unclaimed_pt2": un,
                "claimed_pct": round(100.0 * (1 - un / float(den)), 2) if den else None,
                "unclaimed_regions": len(regions)})
            tot_d += den
            tot_u += un
            if progress:
                progress(page_no, len(sel))
    unclaimed.sort(key=lambda r: (0 if r["tier"] == "actionable" else 1, r["page"], r["bbox"][1], r["bbox"][0]))
    for n, r in enumerate(unclaimed, start=1):
        r["id"] = "UNC-%03d" % n
    unclaimed = [dict(id=r["id"], **{k: v for k, v in r.items() if k != "id"}) for r in unclaimed]
    overall = {"claimed_pct": round(100.0 * (1 - tot_u / float(tot_d)), 2) if tot_d else None,
               "unclaimed_pct": round(100.0 * tot_u / float(tot_d), 2) if tot_d else None,
               "unclaimed_regions": len(unclaimed)}
    return {"denominator": DENOMINATOR, "overall": overall, "pages": pages_out, "unclaimed": unclaimed,
            "threshold": threshold}
