"""AC19 How the instances of a cluster are used together on a page, measured from their boxes.

Per cluster: overlap between instances, which one is drawn on top, rotation, spacing to the nearest neighbour, distance
to the page edge, where it is anchored (margin / bleed / column / free), vertical position, how many per page, and
which other clusters share its pages. A measurement, never a rule: Claude writes the rule from these and tags it
`inferred`.
"""
from __future__ import annotations

import statistics
from collections import defaultdict

from .pdfio import open_pdf

MAX_PER_PAGE = 60        # pairs are measured on at most this many boxes per page (the first ones in reading order)


def _gap(a, b):
    dx = max(0.0, max(a[0], b[0]) - min(a[2], b[2]))
    dy = max(0.0, max(a[1], b[1]) - min(a[3], b[3]))
    return (dx * dx + dy * dy) ** 0.5


def _inter(a, b):
    w = min(a[2], b[2]) - max(a[0], b[0])
    h = min(a[3], b[3]) - max(a[1], b[1])
    return w * h if w > 0 and h > 0 else 0.0


def _area(b):
    return max(0.0, b[2] - b[0]) * max(0.0, b[3] - b[1])


def _stats(vals, ndigits=1):
    if not vals:
        return {"min": None, "median": None, "max": None}
    return {"min": round(min(vals), ndigits), "median": round(statistics.median(vals), ndigits),
            "max": round(max(vals), ndigits)}


def _ostats(vals):
    if not vals:
        return {"min": 0, "median": 0, "max": 0}
    return {"min": round(min(vals), 3) if min(vals) else 0, "median": round(statistics.median(vals), 3) if statistics.median(vals) else 0,
            "max": round(max(vals), 3) if max(vals) else 0}


def measure_usage(path, clusters, structure=None, progress=None):
    clusters = [c for c in clusters or [] if c.get("boxes")]
    if not clusters:
        return {}
    with open_pdf(path) as pdf:
        psize = {n + 1: (pdf.page_rect(n).width, pdf.page_rect(n).height) for n in range(pdf.pages)}
    frame = cols = None
    if structure:
        for e in structure.get("elements", []):
            if e["type"] == "page-frame" and frame is None:
                frame = e["value"]
        cols = [e["value"] for e in structure.get("elements", []) if e["type"] == "columns" and e["value"]["count"] >= 2]
    page_clusters = defaultdict(set)
    for c in clusters:
        if not c.get("parent"):
            for p in c["pages"]:
                page_clusters[p].add(c["id"])
    byid = {c["id"]: c for c in clusters}
    out = {}
    for n, c in enumerate(clusters):
        by_page = defaultdict(list)
        for b in c["boxes"]:
            by_page[b[0]].append({"bbox": b[1:5], "z": b[5], "rot": b[6]})
        overlaps, later, earlier, nbr, edges, rots, counts = [], 0, 0, [], [], [], []
        best = None                                           # (overlap, page, bbox) of the most overlapping pair
        for page, items in by_page.items():
            counts.append(len(items))
            items = sorted(items, key=lambda i: (round(i["bbox"][1] / 10.0), i["bbox"][0]))[:MAX_PER_PAGE]
            pw, ph = psize.get(page, (595.0, 842.0))
            for i, a in enumerate(items):
                b = a["bbox"]
                edges.append(max(0.0, min(b[0], b[1], pw - b[2], ph - b[3])))
                rots.append(a["rot"])
                near = None
                for j, o in enumerate(items):
                    if i == j:
                        continue
                    ov = _inter(b, o["bbox"])
                    if ov > 0:
                        if j > i:
                            frac = ov / max(1e-6, min(_area(b), _area(o["bbox"])))
                            overlaps.append(frac)
                            if o["z"] > a["z"]:
                                later += 1
                            elif o["z"] < a["z"]:
                                earlier += 1
                            if best is None or frac > best[0]:
                                best = (frac, page, [min(b[0], o["bbox"][0]), min(b[1], o["bbox"][1]),
                                                     max(b[2], o["bbox"][2]), max(b[3], o["bbox"][3])])
                    else:
                        g = _gap(b, o["bbox"])
                        if near is None or g < near:
                            near = g
                        if j > i:
                            overlaps.append(0.0)
                if near is not None:
                    nbr.append(near)
        pos = defaultdict(int)
        near_edge = margin_hits = col_hits = total = 0
        for b in c["boxes"]:
            page = b[0]
            pw, ph = psize.get(page, (595.0, 842.0))
            x0, y0, x1, y1 = b[1:5]
            total += 1
            cy = (y0 + y1) / 2.0 / ph
            pos["top" if cy < 1 / 3.0 else "bottom" if cy > 2 / 3.0 else "middle"] += 1
            if min(x0, y0, pw - x1, ph - y1) <= 1.5:
                near_edge += 1
            elif frame and (abs(x0 - frame["left"]) <= 3 or abs(pw - x1 - frame["right"]) <= 3
                            or abs(y0 - frame["top"]) <= 3 or abs(ph - y1 - frame["bottom"]) <= 3):
                margin_hits += 1
            elif frame and cols:
                n_c, gap = cols[0]["count"], cols[0]["gap"]
                colw = (pw - frame["left"] - frame["right"] - gap * (n_c - 1)) / float(n_c)
                if any(abs(x0 - (frame["left"] + k * (colw + gap))) <= 3 for k in range(n_c)):
                    col_hits += 1
        if total and near_edge >= 0.5 * total:
            anchor = "bleed"
        elif total and margin_hits >= 0.5 * total:
            anchor = "margin"
        elif total and col_hits >= 0.5 * total:
            anchor = "column"
        else:
            anchor = "free"
        co = []
        mine = set(c["pages"])
        counts_with = defaultdict(int)
        for p in mine:
            for oid in page_clusters.get(p, ()):
                if oid != c["id"]:
                    counts_with[oid] += 1
        for oid, w in counts_with.items():
            if w / float(len(mine)) >= 0.5 and len(mine) >= 2:
                co.append({"id": oid, "with": w, "of": len(mine)})
        kind_rank = {"composite": 0, "shape": 1, "rule": 2, "text-band": 3}
        co.sort(key=lambda e: (-e["with"], kind_rank.get(byid[e["id"]]["kind"], 4), e["id"]))
        multi = None
        if best and best[0] > 0:
            multi = {"page": best[1], "bbox": [round(v, 1) for v in best[2]]}
        elif any(r for r in rots):
            for b in c["boxes"]:
                if b[6]:
                    multi = {"page": b[0], "bbox": b[1:5]}
                    break
        z = "none"
        if later or earlier:
            z = "later-on-top" if later >= earlier else "earlier-on-top"
        out[c["id"]] = {
            "status": "observed", "overlap": _ostats(overlaps), "z_order": z,
            "rotation": {"min": min(rots) if rots else 0, "max": max(rots) if rots else 0},
            "neighbour_distance": _stats(nbr), "edge_distance": _stats(edges), "anchor": anchor,
            "position": max(pos.items(), key=lambda t: (t[1], t[0]))[0] if pos else "middle",
            "per_page": {"min": min(counts), "max": max(counts)}, "co_occurs": co[:8], "multi_sample": multi}
        if progress and n % 50 == 0:
            progress(n + 1, len(clusters))
    return out
