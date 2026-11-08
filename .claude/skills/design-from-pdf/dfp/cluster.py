"""AC4/AC16 Pattern analysis: the same element used N times becomes ONE candidate with N page refs.

Measured only. Two layers:
  primitives  shape | rule | text-band      a geometric / typographic repeat (same size and path shape, same running band)
  composites  kind `composite`              an anchor shape plus the things that belong to it (shadow, badge, text,
                                            inner shapes, images, rules). Compounds cluster on a scale-normalised
                                            signature, so a bubble of 90 pt and one of 130 pt are ONE cluster;
                                            absolute size, fill and edge side are variants (A15).
The checkpoint review decides what a cluster *is* (post-it, speech bubble, folio). Fragments (the primitives that make a
composite up) stay listed, nested under it via `parent`, and are not components of their own.
"""
from __future__ import annotations

import math
from collections import defaultdict

from .pdfio import open_pdf, select_pages
from .probe import family_of, strip_subset
from .util import int_hex, rgb_hex

BAND = 0.08                 # top / bottom 8% of the page = header / footer band
_KIND_ORDER = {"composite": -1, "shape": 0, "rule": 1, "text-band": 2}
SHADOW_SIZE = 0.10          # size within +-10 %
SHADOW_IOU = 0.8
SHADOW_OFFSET = 6.0         # pt
BADGE_AREA = 0.35           # badge area <= 35 % of the anchor
BADGE_INSIDE = 0.5          # >= 50 % of its bbox inside the anchor bbox
INSIDE = 0.9                # >= 90 % of a bbox inside = member
PARENT_SHARE = 0.8          # a primitive cluster is a fragment when >= 80 % of its occurrences are members


def _bbox(r):
    return [round(r.x0, 1), round(r.y0, 1), round(r.x1, 1), round(r.y1, 1)]


def _area(b):
    return max(0.0, b[2] - b[0]) * max(0.0, b[3] - b[1])


def _inter(a, b):
    w = min(a[2], b[2]) - max(a[0], b[0])
    h = min(a[3], b[3]) - max(a[1], b[1])
    return w * h if w > 0 and h > 0 else 0.0


def _union(boxes):
    return [min(b[0] for b in boxes), min(b[1] for b in boxes), max(b[2] for b in boxes), max(b[3] for b in boxes)]


def _pick_samples(occs, key_fn, limit=5):
    """<= limit samples: first one per distinct variant, then per distinct page, then in order."""
    chosen, seen_v, seen_p = [], set(), set()
    for o in occs:
        v = key_fn(o)
        if v not in seen_v:
            seen_v.add(v)
            seen_p.add(o["page"])
            chosen.append(o)
    for o in occs:
        if len(chosen) >= limit:
            break
        if o not in chosen and o["page"] not in seen_p:
            seen_p.add(o["page"])
            chosen.append(o)
    for o in occs:
        if len(chosen) >= limit:
            break
        if o not in chosen:
            chosen.append(o)
    return [{"page": o["page"], "bbox": o["bbox"]} for o in chosen[:limit]]


def _variants(occs):
    counts = defaultdict(lambda: defaultdict(int))
    for o in occs:
        for attr, val in o["attrs"].items():
            if val is not None:
                counts[attr][val] += 1
    out = []
    for attr in sorted(counts):
        for val, c in sorted(counts[attr].items(), key=lambda t: (-t[1], str(t[0]))):
            out.append({"attr": attr, "value": val, "count": c})
    return out


class _Grid:
    def __init__(self, cell=64.0):
        self.c = cell
        self.d = {}

    def add(self, i, b):
        c = self.c
        for cx in range(int(b[0] // c), int(b[2] // c) + 1):
            for cy in range(int(b[1] // c), int(b[3] // c) + 1):
                self.d.setdefault((cx, cy), []).append(i)

    def query(self, b):
        c, out = self.c, set()
        for cx in range(int(b[0] // c), int(b[2] // c) + 1):
            for cy in range(int(b[1] // c), int(b[3] // c) + 1):
                out.update(self.d.get((cx, cy), ()))
        return out


# --------------------------------------------------------------------------- page model
def page_model(pdf, pno, page_no):
    """Plain-dict view of one page: shapes, rules, text lines, images (all with bbox and draw order)."""
    prect = pdf.page_rect(pno)
    pw, ph = prect.width, prect.height
    shapes, rules = [], []
    for seq, d in enumerate(pdf.drawings(pno)):
        kind, r = d.get("type"), d.get("rect")
        if r is None or kind not in ("f", "s", "fs"):
            continue
        w, h = r.width, r.height
        if r.x1 <= 0 or r.y1 <= 0 or r.x0 >= pw or r.y0 >= ph:      # printer's marks outside the page are not on the page
            continue
        fill = rgb_hex(d["fill"]) if kind in ("f", "fs") and d.get("fill") is not None else None
        stroke = rgb_hex(d["color"]) if kind in ("s", "fs") and d.get("color") is not None else None
        width = round(float(d["width"]), 2) if d.get("width") else None
        if min(w, h) < 0.6:                                  # zero thickness: a rule, never a shape
            if stroke is None:
                continue
            rules.append({"page": page_no, "bbox": _bbox(r), "length": max(w, h), "z": seq,
                          "orient": "h" if w >= h else "v", "attrs": {"stroke": stroke, "stroke_width": width}})
            continue
        if w * h < 4 or (w >= 0.95 * pw and h >= 0.95 * ph):  # specks and full-page backgrounds
            continue
        opacity = d.get("fill_opacity")
        sig = "".join(it[0] for it in d.get("items", []))
        shapes.append({"page": page_no, "bbox": _bbox(r), "w": w, "h": h, "sig": sig, "z": seq,
                       "opacity": opacity if opacity is not None else 1.0,
                       "attrs": {"fill": fill, "stroke": stroke, "stroke_width": width,
                                 "opacity": round(opacity, 2) if opacity is not None and opacity < 0.999 else None}})
    lines = []
    for b in pdf.text_dict(pno).get("blocks", []):
        if b.get("type", 0) != 0:
            continue
        for ln in b.get("lines", []):
            spans = [s for s in ln.get("spans", []) if s.get("text", "").strip()]
            if not spans:
                continue
            dom = max(spans, key=lambda s: len(s["text"].strip()))
            dx, dy = ln.get("dir", (1.0, 0.0))
            lines.append({"bbox": [round(v, 1) for v in ln["bbox"]], "dom": dom, "spans": spans,
                          "rot": int(round(math.degrees(math.atan2(-dy, dx)))),
                          "text": "".join(s["text"] for s in spans).strip()})
    images = []
    for im in pdf.image_info(pno):
        bb = im.get("bbox")
        if bb:
            images.append([round(float(v), 1) for v in bb])
    return {"pw": pw, "ph": ph, "shapes": shapes, "rules": rules, "lines": lines, "images": images}


def is_block(bbox, pw, ph):
    """A section block (A18): a filled rect >= 20 % of the page area, or a band >= 80 % of the page width and >= 20 pt tall."""
    w, h = bbox[2] - bbox[0], bbox[3] - bbox[1]
    return w * h >= 0.2 * pw * ph or (w >= 0.8 * pw and h >= 20)


# --------------------------------------------------------------------------- composites (A15)
def _ops_class(sig):
    if sig and set(sig) == {"c"}:
        return "ellipse"
    if sig == "re":
        return "rect"
    if "c" in sig and "l" in sig:
        return "rrect"
    return "path"


def _compounds(m):
    """-> (compounds, member_of) for one page model.  compound: {anchor, members: [(role, bbox)], text: [line idx],
    shapes: {idx}, rules: {idx}}; member_of: {("shape", idx): compound index} for primitives that belong to one."""
    pw, ph = m["pw"], m["ph"]
    S, R, L, IM = m["shapes"], m["rules"], m["lines"], m["images"]
    if not S:
        return [], {}
    n = len(S)
    bbs = [s["bbox"] for s in S]
    area = [_area(b) for b in bbs]
    block = [is_block(bbs[i], pw, ph) for i in range(n)]
    grid = _Grid()
    for i in range(n):
        grid.add(i, bbs[i])

    # pre-pass: translucent twins of an opaque shape are its shadow, whatever the area order
    shadow_of = {}
    for i in range(n):
        if S[i]["opacity"] >= 0.999 or block[i]:
            continue
        best = None
        for j in grid.query(bbs[i]):
            if j == i or S[j]["opacity"] < 0.999 or block[j]:
                continue
            a, b = bbs[i], bbs[j]
            wi, hi, wj, hj = a[2] - a[0], a[3] - a[1], b[2] - b[0], b[3] - b[1]
            if abs(wi - wj) > SHADOW_SIZE * wj or abs(hi - hj) > SHADOW_SIZE * hj:
                continue
            inter = _inter(a, b)
            iou = inter / (area[i] + area[j] - inter) if inter else 0.0
            off = max(abs(a[0] - b[0]), abs(a[1] - b[1]))
            if iou >= SHADOW_IOU and off <= SHADOW_OFFSET and (best is None or iou > best[0]):
                best = (iou, j)
        if best:
            shadow_of[i] = best[1]

    # text lines belong to the smallest shape that contains their centre (blocks and shadows excluded)
    text_owner = {}
    for k, ln in enumerate(L):
        b = ln["bbox"]
        cx, cy = (b[0] + b[2]) / 2.0, (b[1] + b[3]) / 2.0
        best = None
        for i in grid.query([cx, cy, cx, cy]):
            if block[i] or i in shadow_of or min(bbs[i][2] - bbs[i][0], bbs[i][3] - bbs[i][1]) < 3:
                continue
            bb = bbs[i]
            if bb[0] <= cx <= bb[2] and bb[1] <= cy <= bb[3]:
                if best is None or (area[i], -S[i]["z"]) < (area[best], -S[best]["z"]):
                    best = i
        if best is not None:
            text_owner[k] = best
    capable = set(text_owner.values())

    order = sorted((i for i in range(n) if i not in shadow_of and not block[i]), key=lambda i: (-round(area[i], 1), -S[i]["z"]))
    roots, role_of, parent_of = set(), {}, {}
    processed = []
    for p in order:
        pb, ap = bbs[p], area[p]
        cands = []
        for a in grid.query(pb):
            if a not in roots or area[a] < ap:
                continue
            ab, aa = bbs[a], area[a]
            inter = _inter(pb, ab)
            inside = inter / ap if ap else 0.0
            role = None
            wi, hi, wj, hj = pb[2] - pb[0], pb[3] - pb[1], ab[2] - ab[0], ab[3] - ab[1]
            if abs(wi - wj) <= SHADOW_SIZE * wj and abs(hi - hj) <= SHADOW_SIZE * hj:
                iou = inter / (ap + aa - inter) if inter else 0.0
                off = max(abs(pb[0] - ab[0]), abs(pb[1] - ab[1]))
                if iou >= SHADOW_IOU and off <= SHADOW_OFFSET:
                    role = "shadow" if off > 0.5 else "shape"
            if role is None and p not in capable:
                if inside >= INSIDE:
                    role = "shape"
                    if ap <= BADGE_AREA * aa and wj > 0 and hj > 0:        # a small member sitting in a corner is a badge
                        nx = ((pb[0] + pb[2]) / 2.0 - ab[0]) / wj
                        ny = ((pb[1] + pb[3]) / 2.0 - ab[1]) / hj
                        if abs(nx - 0.5) >= 0.3 and abs(ny - 0.5) >= 0.3:
                            role = "badge"
                elif ap <= BADGE_AREA * aa and inside >= BADGE_INSIDE:
                    role = "badge"
            if role:
                cands.append((a, role))
        if cands:
            before = [c for c in cands if S[c[0]]["z"] < S[p]["z"]]
            pool = before or cands
            a, role = max(pool, key=lambda c: S[c[0]]["z"]) if before else min(pool, key=lambda c: area[c[0]])
            parent_of[p], role_of[p] = a, role
        else:
            roots.add(p)
        processed.append(p)
    for i, j in shadow_of.items():                        # pre-pass shadows follow their twin's root
        r = parent_of.get(j, j)
        if r in roots or j in roots:
            parent_of[i], role_of[i] = r, "shadow"

    comps = {}

    def comp(a):
        return comps.setdefault(a, {"anchor": a, "members": [("shape", bbs[a])], "text": [], "shapes": {a}, "rules": set()})

    for p, a in parent_of.items():
        if a not in roots:
            continue
        c = comp(a)
        c["members"].append((role_of[p], bbs[p]))
        c["shapes"].add(p)
    for k, i in text_owner.items():
        a = i if i in roots else parent_of.get(i)
        if a in roots:
            c = comp(a)
            c["members"].append(("text", L[k]["bbox"]))
            c["text"].append(k)
    for i, b in enumerate(IM):
        cx, cy = (b[0] + b[2]) / 2.0, (b[1] + b[3]) / 2.0
        ia = _area(b)
        soft = None                                          # an image slightly larger than an anchor, around it, is its shadow
        for a in grid.query(b):
            if (a in roots and ia > 0 and area[a] > 0 and area[a] * 1.02 < ia <= 2.2 * area[a]
                    and _inter(bbs[a], b) >= 0.85 * area[a]):
                if soft is None or area[a] < area[soft]:
                    soft = a
        if soft is not None:
            comp(soft)["members"].append(("shadow", b))
            continue
        best = None
        for a in grid.query([cx, cy, cx, cy]):
            if a in roots and bbs[a][0] <= cx <= bbs[a][2] and bbs[a][1] <= cy <= bbs[a][3] and _area(b) < area[a] * 0.98:
                if best is None or area[a] < area[best]:
                    best = a
        if best is not None:
            comp(best)["members"].append(("image", b))
    for k, r in enumerate(R):
        b = r["bbox"]
        cx, cy = (b[0] + b[2]) / 2.0, (b[1] + b[3]) / 2.0
        best = None
        for a in grid.query([cx, cy, cx, cy]):
            if a in roots and bbs[a][0] <= cx <= bbs[a][2] and bbs[a][1] <= cy <= bbs[a][3]:
                if best is None or area[a] < area[best]:
                    best = a
        if best is not None:
            c = comp(best)
            c["members"].append(("rule", b))
            c["rules"].add(k)
    out, member_of = [], {}
    for a in sorted(comps):
        c = comps[a]
        if len(c["members"]) < 2:
            continue
        idx = len(out)
        out.append(c)
        for i in c["shapes"]:
            member_of[("shape", i)] = idx
        for k in c["rules"]:
            member_of[("rule", k)] = idx
    return out, member_of


def _occurrence(m, c, page_no):
    S, L = m["shapes"], m["lines"]
    a = S[c["anchor"]]
    box = _union([mb for _, mb in c["members"]])
    ab = a["bbox"]
    aw, ah = max(ab[2] - ab[0], 0.1), max(ab[3] - ab[1], 0.1)

    def rel(mb):                                 # members are described in units of the anchor: scale drops out (A15)
        return [(mb[0] - ab[0]) / aw, (mb[1] - ab[1]) / ah, (mb[2] - ab[0]) / aw, (mb[3] - ab[1]) / ah]
    mem = []
    text_boxes = [mb for r, mb in c["members"] if r == "text"]
    for role, mb in c["members"]:
        if role != "text":
            mem.append((role, rel(mb)))
    if text_boxes:
        mem.append(("text", rel(_union(text_boxes))))
    rots = [L[k]["rot"] for k in c["text"]]
    rot = max(rots, key=abs) if rots else 0
    side = None
    pw, ph = m["pw"], m["ph"]
    if ab[0] <= 1.5:
        side = "left"
    elif ab[2] >= pw - 1.5:
        side = "right"
    elif ab[1] <= 1.5:
        side = "top"
    elif ab[3] >= ph - 1.5:
        side = "bottom"
    return {"page": page_no, "bbox": [round(v, 1) for v in box], "z": a["z"], "rot": rot, "members": mem,
            "aspect": aw / ah, "cls": _ops_class(a["sig"]), "w": ab[2] - ab[0], "h": ab[3] - ab[1],
            "attrs": {"size": "%dx%d" % (round(ab[2] - ab[0]), round(ab[3] - ab[1])), "fill": a["attrs"]["fill"],
                      "stroke": a["attrs"]["stroke"], "side": side}}


SIZE_RATIO = 2.0            # scale is a variant, but a 14 pt badge and a 100 pt bubble are not one component


def _similar(a, b, tol, need):
    if abs(a["aspect"] - b["aspect"]) > tol * max(a["aspect"], b["aspect"]):
        return False
    da, db = max(a["w"], a["h"]), max(b["w"], b["h"])
    if da > 0 and db > 0 and max(da / db, db / da) > SIZE_RATIO:
        return False
    ma = [x for x in a["members"] if x[0] != "text"]
    mb = [x for x in b["members"] if x[0] != "text"]
    ta = [x for x in a["members"] if x[0] == "text"]
    tb = [x for x in b["members"] if x[0] == "text"]
    if bool(ta) != bool(tb):
        return False
    used, hit = set(), 0
    for role, nb in ma:
        for j, (r2, nb2) in enumerate(mb):
            if j in used or r2 != role:
                continue
            if max(abs(nb[k] - nb2[k]) for k in range(4)) <= tol:
                used.add(j)
                hit += 1
                break
    total = len(ma) + len(mb)                    # text is content, not structure: its presence counts, its box does not
    return total == 0 or (2.0 * hit / total) >= need - 1e-9


def _cluster_compounds(occs, tol, need):
    buckets = defaultdict(list)
    for o in occs:
        buckets[(o["cls"], tuple(sorted({r for r, _ in o["members"] if r != "text"})), bool(any(r == "text" for r, _ in o["members"])))].append(o)
    groups = []
    for key, items in buckets.items():
        reps = []
        for o in items:
            for g in reps:
                if _similar(g[0], o, tol, need):
                    g.append(o)
                    break
            else:
                reps.append([o])
        groups.extend(reps)
    return groups


# --------------------------------------------------------------------------- clustering
def cluster_model(path, pages=None, min_occurrences=2, tolerance=0.15, structure_match=0.8, progress=None):
    shapes, rules, bands = defaultdict(list), defaultdict(list), defaultdict(list)
    comps_occ = []
    with open_pdf(path) as pdf:
        sel = select_pages(pdf.pages, pages)
        for page_no in sel:
            pno = page_no - 1
            m = page_model(pdf, pno, page_no)
            pw, ph = m["pw"], m["ph"]
            comps, member_of = _compounds(m)
            cidx = {}
            for ci, c in enumerate(comps):
                o = _occurrence(m, c, page_no)
                o["_ci"] = len(comps_occ)
                comps_occ.append(o)
                cidx[ci] = o
            for i, s in enumerate(m["shapes"]):
                s = dict(s)
                s["comp"] = cidx[member_of[("shape", i)]]["_ci"] if ("shape", i) in member_of else None
                key = (int(round(s["w"])), int(round(s["h"])), s["sig"])
                shapes[key].append(s)
            for k, r in enumerate(m["rules"]):
                r = dict(r)
                r["comp"] = cidx[member_of[("rule", k)]]["_ci"] if ("rule", k) in member_of else None
                key = (r["orient"], int(round(r["length"] / 10.0)) * 10, round(r["attrs"]["stroke_width"] or 0, 1))
                rules[key].append(r)
            for ln in m["lines"]:
                x0, y0, x1, y1 = ln["bbox"]
                mid = (y0 + y1) / 2.0
                band = "header" if mid <= BAND * ph else "footer" if mid >= (1 - BAND) * ph else None
                if band is None:
                    continue
                dom = ln["dom"]
                name = strip_subset(dom.get("font", ""))
                size = round(float(dom.get("size", 0)) * 2) / 2.0
                cx = (x0 + x1) / 2.0
                align = "left" if cx < pw / 3.0 else "right" if cx > 2 * pw / 3.0 else "center"
                flags = dom.get("flags", 0)
                key = (band, family_of(name), size, bool(flags & 16), bool(flags & 2))
                bands[key].append({"page": page_no, "bbox": [round(x0, 1), round(y0, 1), round(x1, 1), round(y1, 1)],
                                   "name": name, "size": size, "text": ln["text"],
                                   "attrs": {"color": int_hex(dom.get("color", 0)), "align": align}, "z": 0, "rot": 0})
            if progress:
                progress(page_no, len(sel))

    found = []
    comp_of_occ = {}                                    # compound occurrence index -> found index
    for g in _cluster_compounds(comps_occ, tolerance, structure_match):
        if len(g) < min_occurrences:
            continue
        rep = g[0]
        occs = [{"page": o["page"], "bbox": o["bbox"], "attrs": o["attrs"], "z": o["z"], "rot": o["rot"]} for o in g]
        found.append({"kind": "composite", "occs": occs, "extra": {
            "size": [round(rep["w"], 1), round(rep["h"], 1)],
            "members": [{"role": r, "rel": [round(v, 3) for v in nb]} for r, nb in rep["members"]],
            "absorbed": []}, "sample_key": lambda o: o["attrs"]["fill"], "_src": g})
        for o in g:
            comp_of_occ[o["_ci"]] = len(found) - 1
    for key, occs in shapes.items():
        if len(occs) < min_occurrences:
            continue
        found.append({"kind": "shape", "occs": occs, "extra": {"size": [round(occs[0]["w"], 1), round(occs[0]["h"], 1)],
                                                                 "ops": occs[0]["sig"] if len(occs[0]["sig"]) <= 40 else
                                                                 occs[0]["sig"][:37] + "..."},
                      "sample_key": lambda o: o["attrs"]["fill"]})
    for key, occs in rules.items():
        if len(occs) < min_occurrences:
            continue
        found.append({"kind": "rule", "occs": occs, "extra": {"orientation": key[0], "length": round(occs[0]["length"], 1),
                                                                "width": key[2]},
                      "sample_key": lambda o: o["attrs"]["stroke"]})
    for key, occs in bands.items():
        if len(occs) < min_occurrences:
            continue
        found.append({"kind": "text-band", "occs": occs, "extra": {
            "band": key[0], "style": {"family": key[1], "size": key[2], "bold": key[3], "italic": key[4]},
            "text_samples": [o["text"][:40] for o in occs[:3]]}, "sample_key": lambda o: o["attrs"]["color"]})

    order = sorted(range(len(found)), key=lambda i: (
        -len(found[i]["occs"]), -len({o["page"] for o in found[i]["occs"]}), _KIND_ORDER[found[i]["kind"]],
        found[i]["occs"][0]["page"], found[i]["occs"][0]["bbox"][1], found[i]["occs"][0]["bbox"][0]))
    new_id = {old: "CL-%03d" % (n + 1) for n, old in enumerate(order)}
    comp_cluster = {ci: new_id[fi] for ci, fi in comp_of_occ.items()}
    out = []
    for old in order:
        c = found[old]
        occs = c["occs"]
        entry = {"id": new_id[old], "kind": c["kind"], "occurrences": len(occs),
                 "pages": sorted({o["page"] for o in occs}), "variants": _variants(occs),
                 "samples": _pick_samples(occs, c["sample_key"]), "crop": None}
        entry.update(c["extra"])
        entry["boxes"] = [[o["page"]] + [round(v, 1) for v in o["bbox"]] + [o.get("z", 0), o.get("rot", 0)] for o in occs]
        if c["kind"] in ("shape", "rule"):
            share = defaultdict(int)
            for o in occs:
                cl = comp_cluster.get(o.get("comp"))
                if cl:
                    share[cl] += 1
            if share:
                top, cnt = max(share.items(), key=lambda t: (t[1], t[0]))
                if cnt >= PARENT_SHARE * len(occs):
                    entry["parent"] = top
        out.append(entry)
    byid = {c["id"]: c for c in out}
    for c in out:
        if c.get("parent"):
            byid[c["parent"]]["absorbed"].append(c["id"])
    return out


def cluster_patterns(path, pages=None, min_occurrences=2, tolerance=0.15, structure_match=0.8, progress=None):
    """All repeated elements, no cap. `tolerance` (+-15 %) and `structure_match` (>= 0.8) apply to the scale-normalised
    signature of a composite; see the module docstring."""
    return cluster_model(path, pages, min_occurrences, tolerance, structure_match, progress)
