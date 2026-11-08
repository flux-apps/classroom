"""AC17 Page structure, measured: page frame, columns, baseline rhythm, text roles, dividers, section blocks, photo
frames, table grids, and the page templates that group pages by what they share.

Everything is measured on vector pages (`observed`); raster pages carry no measurable geometry and are left out
(nothing is called observed that was not measured). A text style needs >= 2 lines to become a role.
"""
from __future__ import annotations

import statistics
from collections import defaultdict

from .cluster import is_block, page_model
from .pdfio import open_pdf, select_pages
from .probe import family_of, page_type, parse_style, strip_subset
from .util import compact_pages

MIN_BODY_LINES = 8          # lines a page needs before it can be said to have columns
RULE_MIN = 0.15             # a divider is at least 15 % of the page width


def text_style_key(line):
    d = line["dom"]
    name = strip_subset(d.get("font", ""))
    ps = parse_style(name)
    bold = ps["weight"] >= 600 or bool(d.get("flags", 0) & 16)
    italic = ps["italic"] or bool(d.get("flags", 0) & 2)
    return (family_of(name), round(float(d.get("size", 0)) * 2) / 2.0, bool(bold), bool(italic))


def _rule_like(page):
    """Zero-thickness rules plus very thin filled shapes, as (orient, pos, a0, a1, width, bbox)."""
    out = []
    for r in page["rules"]:
        b = r["bbox"]
        out.append((r["orient"], (b[1] + b[3]) / 2.0 if r["orient"] == "h" else (b[0] + b[2]) / 2.0,
                    b[0] if r["orient"] == "h" else b[1], b[2] if r["orient"] == "h" else b[3],
                    r["attrs"]["stroke_width"] or 0, b))
    for s in page["shapes"]:
        b = s["bbox"]
        w, h = b[2] - b[0], b[3] - b[1]
        if min(w, h) <= 2 and max(w, h) >= 40:
            orient = "h" if w >= h else "v"
            out.append((orient, (b[1] + b[3]) / 2.0 if orient == "h" else (b[0] + b[2]) / 2.0,
                        b[0] if orient == "h" else b[1], b[2] if orient == "h" else b[3], round(min(w, h), 2), b))
    return out


def _tables(page):
    """-> [{bbox, rows, columns, header_row}] for grids drawn as rules."""
    rl = _rule_like(page)
    hs = [r for r in rl if r[0] == "h" and r[3] - r[2] >= 0.3 * page["pw"]]
    vs = [r for r in rl if r[0] == "v"]
    out, used = [], set()
    for i, h in enumerate(hs):
        if i in used:
            continue
        group = [j for j, g in enumerate(hs) if j not in used and abs(g[2] - h[2]) <= 3 and abs(g[3] - h[3]) <= 3]
        if len(group) < 3:
            continue
        y0, y1 = min(hs[j][1] for j in group), max(hs[j][1] for j in group)
        cols = [v for v in vs if v[2] >= y0 - 3 and v[3] <= y1 + 3 and v[3] - v[2] >= 0.6 * (y1 - y0) and h[2] - 3 <= v[1] <= h[3] + 3]
        xs = sorted({round(v[1] / 3.0) for v in cols})
        if len(xs) < 2:
            continue
        for j in group:
            used.add(j)
        ys = sorted(hs[j][1] for j in group)
        header = False
        for s in page["shapes"]:
            b = s["bbox"]
            if (s["attrs"]["fill"] and abs(b[1] - ys[0]) <= 3 and abs(b[3] - ys[1]) <= 3 and (b[2] - b[0]) >= 0.9 * (h[3] - h[2])
                    and s["attrs"]["fill"].upper() not in ("#FFFFFF",)):
                header = True
                break
        out.append({"bbox": [h[2], y0, h[3], y1], "rows": len(group) - 1, "columns": len(xs) - 1, "header_row": header})
    return out


def _inside(box, b):
    cx, cy = (b[0] + b[2]) / 2.0, (b[1] + b[3]) / 2.0
    return box[0] <= cx <= box[2] and box[1] <= cy <= box[3]


def detect_structure(path, pages=None, clusters=None, progress=None):
    comp_boxes = defaultdict(list)
    for c in clusters or []:
        if c.get("kind") == "composite" and not c.get("parent"):
            for b in c.get("boxes", []):
                comp_boxes[b[0]].append(b[1:5])
    per = {}
    with open_pdf(path) as pdf:
        sel = select_pages(pdf.pages, pages)
        all_raster = all(page_type(pdf, p - 1) == "raster" for p in sel)     # scans carry no measurable geometry
        for page_no in sel:
            pno = page_no - 1
            if all_raster:
                per[page_no] = None
                continue
            m = page_model(pdf, pno, page_no)
            m["tables"] = _tables(m)
            m["page"] = page_no
            # lines that are text of a composite (a bubble's caption) are not running text
            m["free"] = [ln for ln in m["lines"] if not any(_inside(b, ln["bbox"]) for b in comp_boxes.get(page_no, ()))]
            per[page_no] = m
            if progress:
                progress(page_no, len(sel))
    vector = [p for p in sorted(per) if per[p] is not None]
    elements = []

    def add(typ, label, value, pages_, evidence, **extra):
        e = {"type": typ, "label": label, "value": value, "status": "observed", "pages": sorted(pages_),
             "evidence": evidence}
        e.update(extra)
        elements.append(e)

    if not vector:
        return {"elements": [], "templates": [], "raster_pages": sorted(per)}

    # ---- text roles (document level)
    style_lines = defaultdict(list)
    for p in vector:
        for ln in per[p]["free"]:
            style_lines[text_style_key(ln)].append((p, ln))
    styles = {k: v for k, v in style_lines.items() if len(v) >= 2}
    body_key = None
    if styles:
        body_key = max(styles, key=lambda k: (sum(len(l["text"]) for _, l in styles[k]), -abs(k[1] - 10.5)))
    roles = {}
    if body_key:
        def lines_of(k):
            return len(styles[k])
        larger = sorted((k for k in styles if k[1] > body_key[1] + 0.2), key=lambda k: (-k[1], -lines_of(k)))
        same = sorted((k for k in styles if abs(k[1] - body_key[1]) <= 0.2 and k != body_key), key=lambda k: -lines_of(k))
        smaller = sorted((k for k in styles if k[1] < body_key[1] - 0.2), key=lambda k: (-k[1], -lines_of(k)))

        def name_group(keys, namer):
            sizes, used = [], {}
            for k in keys:
                if k[1] not in sizes:
                    sizes.append(k[1])
                base = namer(sizes.index(k[1]))
                n = used.get(base, 0)
                used[base] = n + 1
                roles[k] = base if n == 0 else "%s-%s" % (base, chr(ord("a") + n))      # variants of one size: -b, -c, ...
        name_group(larger, lambda i: "heading-%d" % (i + 1))
        roles[body_key] = "body"
        for n, k in enumerate(same):
            roles[k] = "body-%s" % chr(ord("b") + n) if n < 25 else "body-%d" % (n + 2)
        name_group(smaller, lambda i: "caption" if i == 0 else "small-%d" % (i + 1))
    # ---- page frame (median extents over text pages)
    ext = {"top": [], "right": [], "bottom": [], "left": []}
    fpages = []
    for p in vector:
        m = per[p]
        boxes = [ln["bbox"] for ln in m["free"]] + [r[5] for r in _rule_like(m) if r[0] == "h"]
        if not boxes:
            continue
        fpages.append(p)
        ext["left"].append(min(b[0] for b in boxes))
        ext["top"].append(min(b[1] for b in boxes))
        ext["right"].append(m["pw"] - max(b[2] for b in boxes))
        ext["bottom"].append(m["ph"] - max(b[3] for b in boxes))
    frame = None
    if fpages:
        frame = {k: round(statistics.median(v), 1) for k, v in ext.items()}
        add("page-frame", "page-frame", frame, fpages, "median text/rule extent, %d page%s"
            % (len(fpages), "" if len(fpages) == 1 else "s"))
    # ---- columns per page
    body_size = body_key[1] if body_key else None
    colinfo = {}
    for p in vector:
        m = per[p]
        tbl = [t["bbox"] for t in m["tables"]]
        lines = [ln for ln in m["free"] if body_size and abs(text_style_key(ln)[1] - body_size) <= 0.6
                 and not any(_inside(t, ln["bbox"]) for t in tbl) and ln["rot"] == 0]
        if len(lines) < MIN_BODY_LINES:
            continue
        starts = sorted(ln["bbox"][0] for ln in lines)
        groups = []
        for x in starts:
            if groups and x - groups[-1][-1] <= 6:
                groups[-1].append(x)
            else:
                groups.append([x])
        cols = [g for g in groups if len(g) >= max(3, 0.25 * len(lines))]
        if not cols:
            continue
        xs = [statistics.median(g) for g in cols]
        gaps = []
        for i in range(len(xs) - 1):
            right = max(ln["bbox"][2] for ln in lines if xs[i] - 6 <= ln["bbox"][0] < xs[i + 1] - 6)
            gaps.append(xs[i + 1] - right)
        colinfo[p] = (len(cols), round(statistics.mean(gaps), 1) if gaps else 0.0)
    cgroups = defaultdict(list)
    for p, (n, gap) in colinfo.items():
        cgroups[(n, int(round(gap / 4.0)) if n > 1 else 0)].append((p, gap))
    for (n, _), items in sorted(cgroups.items(), key=lambda kv: min(p for p, _ in kv[1])):
        pg = [p for p, _ in items]
        gap = round(statistics.median(g for _, g in items), 1)
        add("columns", "%d column%s" % (n, "" if n == 1 else "s"), {"count": n, "gap": gap}, pg,
            "%d of %d pages; text starts clustered at %d x position%s%s" % (
                len(pg), len(vector), n, "" if n == 1 else "s", ", gutter %spt" % gap if n > 1 else ""))
    # ---- baseline rhythm of the body style
    if body_key:
        gaps, pg = [], set()
        for p, ln in styles[body_key]:
            pass
        bypage = defaultdict(list)
        for p, ln in styles[body_key]:
            bypage[p].append(ln)
        size = body_key[1]
        for p, lns in bypage.items():
            lns = sorted(lns, key=lambda l: (round(l["bbox"][0] / 6.0), l["dom"]["origin"][1]))
            for a, b in zip(lns, lns[1:]):
                if abs(a["bbox"][0] - b["bbox"][0]) > 3:
                    continue
                gap = b["dom"]["origin"][1] - a["dom"]["origin"][1]
                if 0.8 * size <= gap <= 2.5 * size:
                    gaps.append(round(gap, 2))
                    pg.add(p)
        if gaps:
            leading = round(statistics.median(gaps), 2)
            add("rhythm", "body rhythm", {"style": "body", "size": size, "leading": leading}, pg,
                "median baseline distance of %d consecutive body lines" % len(gaps))
    # ---- text roles elements
    for k, name in sorted(roles.items(), key=lambda kv: ({"h": 0, "b": 1, "c": 2, "s": 3}[kv[1][0]], -kv[0][1])):
        lns = styles[k]
        sample = max((l["text"] for _, l in lns), key=len)[:40]
        add("text-role", name, {"size": k[1], "bold": k[2], "italic": k[3], "family": k[0]}, {p for p, _ in lns},
            "%d lines in %s %spt%s%s" % (len(lns), k[0], k[1], " bold" if k[2] else "", " italic" if k[3] else ""),
            sample=sample)
    # ---- dividers (rules that repeat in place on >= 2 pages, outside table grids)
    divs = defaultdict(list)
    for p in vector:
        m = per[p]
        tbl = [t["bbox"] for t in m["tables"]]
        for orient, pos, a0, a1, width, b in _rule_like(m):
            span = (a1 - a0) / (m["pw"] if orient == "h" else m["ph"])
            if span < RULE_MIN or any(t[0] - 2 <= b[0] and b[2] <= t[2] + 2 and t[1] - 2 <= b[1] and b[3] <= t[3] + 2 for t in tbl):
                continue
            divs[(orient, int(round(pos / 3.0)), int(round(a0 / 6.0)), int(round(a1 / 6.0)))].append((p, pos, a0, a1, width, b))
    for key, items in sorted(divs.items(), key=lambda kv: (min(i[0] for i in kv[1]), kv[0])):
        pg = {i[0] for i in items}
        if len(pg) < 2:
            continue
        it = items[0]
        add("divider", "divider", {"orientation": key[0], "position": round(it[1], 1), "length": round(it[3] - it[2], 1),
                                   "width": it[4]}, pg, "rule on %d pages at the same position" % len(pg),
            boxes=[[i[0]] + list(i[5]) for i in items])
    # ---- section blocks
    blocks = defaultdict(list)
    for p in vector:
        m = per[p]
        for s in m["shapes"]:
            b = s["bbox"]
            if s["attrs"]["fill"] and is_block(b, m["pw"], m["ph"]) and min(b[2] - b[0], b[3] - b[1]) > 2:
                blocks[(s["attrs"]["fill"], int(round(b[0] / 10.0)), int(round(b[1] / 10.0)), int(round(b[2] / 10.0)),
                        int(round(b[3] / 10.0)))].append((p, b))
    for key, items in sorted(blocks.items(), key=lambda kv: (min(i[0] for i in kv[1]), kv[0])):
        pg = {i[0] for i in items}
        b = items[0][1]
        wide = (b[2] - b[0]) >= 0.8 * per[items[0][0]]["pw"]
        add("section-block", "band" if wide and (b[3] - b[1]) < 0.2 * per[items[0][0]]["ph"] else "panel",
            {"fill": key[0], "bbox": [round(v, 1) for v in b]}, pg, "filled %s block on %d page%s" % (
                key[0], len(pg), "" if len(pg) == 1 else "s"), boxes=[[i[0]] + list(i[1]) for i in items])
    # ---- photo frames
    photos = defaultdict(list)
    for p in vector:
        m = per[p]
        for b in m["images"]:
            w, h = b[2] - b[0], b[3] - b[1]
            if w * h < 0.03 * m["pw"] * m["ph"]:
                continue
            bleed = b[0] <= 1.5 or b[1] <= 1.5 or b[2] >= m["pw"] - 1.5 or b[3] >= m["ph"] - 1.5
            photos[(bleed, round((w / h) / 0.05) if h else 0)].append((p, b, w / h if h else 0.0))
    for key, items in sorted(photos.items(), key=lambda kv: (min(i[0] for i in kv[1]), kv[0])):
        pg = {i[0] for i in items}
        add("photo-frame", "photo-frame", {"bleed": bool(key[0]), "aspect": round(items[0][2], 3)}, pg,
            "%d image%s, %s" % (len(items), "" if len(items) == 1 else "s", "bleeding off the page" if key[0] else "inside the frame"),
            boxes=[[i[0]] + list(i[1]) for i in items])
    # ---- table grids
    tbls = defaultdict(list)
    for p in vector:
        for t in per[p]["tables"]:
            tbls[(t["rows"], t["columns"], t["header_row"])].append((p, t))
    for key, items in sorted(tbls.items(), key=lambda kv: (min(i[0] for i in kv[1]), kv[0])):
        pg = {i[0] for i in items}
        add("table-grid", "table-grid", {"rows": key[0], "columns": key[1], "header_row": key[2]}, pg,
            "grid of %d rows x %d columns drawn as rules%s" % (key[0], key[1], ", filled header row" if key[2] else ""),
            boxes=[[i[0]] + list(i[1]["bbox"]) for i in items])
    for n, e in enumerate(elements, start=1):
        e["id"] = "STR-%03d" % n
    # ---- templates
    templates = _templates(per, vector, elements, colinfo, frame, clusters)
    return {"elements": elements, "templates": templates, "raster_pages": [p for p in sorted(per) if per[p] is None]}


def _templates(per, vector, elements, colinfo, frame, clusters):
    divider_ids = defaultdict(set)
    for e in elements:
        if e["type"] in ("divider", "section-block"):
            for p in e["pages"]:
                divider_ids[p].add(e["id"])
    table_pages = {p for e in elements if e["type"] == "table-grid" for p in e["pages"]}
    photo_bleed = defaultdict(set)
    for e in elements:
        if e["type"] == "photo-frame":
            for p in e["pages"]:
                photo_bleed[p].add(bool(e["value"]["bleed"]))
    bands = defaultdict(set)
    for c in clusters or []:
        if c.get("kind") == "text-band":
            for p in c.get("pages", []):
                bands[p].add(c["id"])
    groups = defaultdict(list)
    for p in vector:
        sig = (colinfo.get(p, (0, 0))[0], p in table_pages, tuple(sorted(photo_bleed.get(p, ()))),
               tuple(sorted(divider_ids.get(p, ()))), tuple(sorted(bands.get(p, ()))))
        groups[sig].append(p)
    place = defaultdict(list)                                 # page -> [(cluster id, centre y)]
    for c in clusters or []:
        if c.get("parent") or c.get("kind") == "rule":
            continue
        if c.get("kind") == "shape" and max(c.get("size", [0, 0])) < 4:
            continue
        for b in c.get("boxes", []):
            place[b[0]].append((c["id"], (b[2] + b[4]) / 2.0))
    out = []
    for sig, pg in sorted(groups.items(), key=lambda kv: kv[1][0]):
        m = per[pg[0]]
        ph = m["ph"]
        if sig[2] and True in sig[2] and not sig[0] and not sig[1]:
            zones = [{"name": "full-bleed", "y0": 0.0, "y1": round(ph, 1)}]
        else:
            top = frame["top"] if frame else round(0.08 * ph, 1)
            bot = ph - (frame["bottom"] if frame else 0.08 * ph)
            body = "body" if sig[0] <= 1 else "body (%d col)" % sig[0]
            zones = [{"name": "header-band", "y0": 0.0, "y1": round(top, 1)},
                     {"name": body, "y0": round(top, 1), "y1": round(bot, 1)},
                     {"name": "footer-band", "y0": round(bot, 1), "y1": round(ph, 1)}]
        comps = {}
        for p in pg:
            for cid, cy in place.get(p, ()):
                z = next((z for z in zones if z["y0"] <= cy < z["y1"]), zones[-1])
                lst = comps.setdefault(z["name"], [])
                if cid not in lst:
                    lst.append(cid)
        out.append({"id": "TPL-%03d" % (len(out) + 1), "pages": pg, "n": len(pg), "zones": zones, "components": comps,
                    "columns": sig[0], "label": "pages %s" % compact_pages(pg)})
    return out


def to_tokens(result):
    """Structure -> layout tokens in pt: margins, column gap, body leading."""
    tok = {}
    for e in result.get("elements", []):
        if e["type"] == "page-frame" and "--page-margin-top" not in tok:
            v = e["value"]
            for side in ("top", "right", "bottom", "left"):
                tok["--page-margin-" + side] = float(v[side])
    cols = [e for e in result.get("elements", []) if e["type"] == "columns" and e["value"]["count"] >= 2]
    if cols:
        best = max(cols, key=lambda e: len(e["pages"]))
        tok["--col-gap"] = float(best["value"]["gap"])
    for e in result.get("elements", []):
        if e["type"] == "rhythm" and e["value"].get("style") == "body":
            tok["--leading-body"] = float(e["value"]["leading"])
            break
    return tok
