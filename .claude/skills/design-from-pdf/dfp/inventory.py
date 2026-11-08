"""AC6 Inventory: machine-measured items by category, each tagged observed | estimated | inferred with evidence.

Exact vector values are `observed`, raster samples and derived geometry `estimated`; only judgement (a type scale
fitted to the sizes) is `inferred`, and carries a confidence and its reasoning. Semantic naming of components is
left to the checkpoint review: CMP items are geometric candidates, not names.
"""
from __future__ import annotations

from . import adapt, fontmap
from .util import color_name, evidence, fmt_num

CATEGORIES = ["COL", "TYP", "SPC", "RAD", "BRD", "SHD", "ICN", "IMG", "CMP", "MOT"]
EXTRA_CATEGORIES = ["STR", "UNC", "ADP"]                  # round 2: structure, unclaimed regions, adaptations
CATEGORY_TITLES = {"COL": "Colors", "TYP": "Typography", "SPC": "Spacing", "RAD": "Radii", "BRD": "Borders",
                   "SHD": "Shadows", "ICN": "Iconography", "IMG": "Imagery", "CMP": "Components", "MOT": "Motion",
                   "STR": "Structure", "UNC": "Unclaimed", "ADP": "Adaptations"}
MAX_COLORS = 40
MAX_TYPE = 24


class _Builder:
    def __init__(self):
        self.items = []
        self.counts = {c: 0 for c in CATEGORIES + EXTRA_CATEGORIES}
        self.omitted = {}

    def add(self, cat, label, value, status, ev, **extra):
        self.counts[cat] += 1
        item = {"id": "%s-%03d" % (cat, self.counts[cat]), "category": cat, "label": label,
                "value": str(value), "status": status, "evidence": ev}
        item.update(extra)
        self.items.append(item)
        return item


def infer_scale(sizes):
    """Fit a geometric type scale to the distinct sizes (+-2% per step); None when irregular or < 3 sizes."""
    s = sorted({round(float(x), 2) for x in sizes if x and x > 0})
    if len(s) < 3:
        return None
    rho = (s[-1] / s[0]) ** (1.0 / (len(s) - 1))
    if rho <= 1.0:
        return None
    for a, b in zip(s, s[1:]):
        if abs((b / a) / rho - 1.0) > 0.02:
            return None
    return {"ratio": round(rho, 3), "base": s[0], "steps": len(s), "sizes": s,
            "confidence": "high" if len(s) >= 5 else "medium"}


def _colors(b, ext, method_status):
    merged = {}
    for c in ext.get("colors", []):
        m = merged.setdefault(c["hex"].upper(), {"hex": c["hex"].upper(), "count": 0, "pages": set(), "roles": [],
                                                 "exact": False})
        m["count"] += c["count"]
        m["pages"].update(c["pages"])
        if c["role"] not in m["roles"]:
            m["roles"].append(c["role"])
        m["exact"] = m["exact"] or c["method"] == "exact"
    ranked = sorted(merged.values(), key=lambda m: (-m["count"], m["hex"]))
    if len(ranked) > MAX_COLORS:
        b.omitted["COL"] = len(ranked) - MAX_COLORS
    used = {}
    for m in ranked[:MAX_COLORS]:
        base = color_name(m["hex"])
        used[base] = used.get(base, 0) + 1
        label = base if used[base] == 1 else "%s %d" % (base, used[base])
        roles = "/".join(r for r in m["roles"] if r != "sampled")
        b.add("COL", label, m["hex"], "observed" if m["exact"] else "estimated",
              evidence(m["pages"], m["count"], roles or "sampled from render"),
              roles=m["roles"])


def _type(b, ext):
    styles = [s for s in ext.get("text_styles", []) if s["count"] >= 3]
    if not styles:
        return
    merged = {}
    for s in styles:
        k = (s["family"], s["weight"], s["italic"], s["size"])
        m = merged.setdefault(k, {"s": s, "count": 0, "pages": set(), "lh": []})
        m["count"] += s["count"]
        m["pages"].update(s["pages"])
        if s.get("line_height"):
            m["lh"].append(s["line_height"])
    ranked = sorted(merged.values(), key=lambda m: (-m["count"], m["s"]["size"]))
    if len(ranked) > MAX_TYPE:
        b.omitted["TYP"] = len(ranked) - MAX_TYPE
    ranked = ranked[:MAX_TYPE]
    body = ranked[0]["s"]["size"]
    larger = sorted({m["s"]["size"] for m in ranked if m["s"]["size"] > body}, reverse=True)
    smaller = sorted({m["s"]["size"] for m in ranked if m["s"]["size"] < body}, reverse=True)
    for m in ranked:
        s = m["s"]
        if s["size"] == body:
            role = "body"
        elif s["size"] > body:
            i = larger.index(s["size"])
            role = "display" if (s["size"] >= 1.8 * body and i == 0) else "heading-%d" % (i + 1)
        else:
            role = "small-%d" % (smaller.index(s["size"]) + 1)
        value = "%s %spt %d" % (s["family"], fmt_num(s["size"]), s["weight"])
        if s["italic"]:
            value += " italic"
        lh = sorted(m["lh"])[len(m["lh"]) // 2] if m["lh"] else None
        if lh:
            value += " / %spt" % fmt_num(lh)
        label = "%s %s %d%s" % (role, s["family"], s["weight"], " italic" if s["italic"] else "")
        b.add("TYP", label, value, "observed", evidence(m["pages"], m["count"], "chars, color %s" % s["color"]),
              family=s["family"])
    scale = infer_scale([m["s"]["size"] for m in ranked])
    if scale:
        b.add("TYP", "type scale", "ratio %s base %spt" % (fmt_num(scale["ratio"]), fmt_num(scale["base"])), "inferred",
              "sizes %s" % ", ".join(fmt_num(x) for x in scale["sizes"]), confidence=scale["confidence"],
              reasoning="the %d distinct sizes step by a constant ratio of %s (each step within 2%%)" % (
                  scale["steps"], fmt_num(scale["ratio"])))


def _spacing(b, probe, ext, with_margins=True):
    sizes = probe.get("page_sizes") or []
    if sizes:
        sz = sizes[0]
        extra = "" if len(sizes) == 1 else " (+%d other size%s)" % (len(sizes) - 1, "" if len(sizes) == 2 else "s")
        pages = list(range(1, probe.get("pages", 1) + 1))
        b.add("SPC", "page size", "%spt %spt" % (fmt_num(sz["w"]), fmt_num(sz["h"])), "observed",
              evidence(pages, None, "%d page%s of this size%s" % (sz["count"], "" if sz["count"] == 1 else "s", extra)))
    tb = [t for t in ext.get("text_bounds", []) if sizes and abs(t["w"] - sizes[0]["w"]) < 2]
    if with_margins and len(tb) >= 1:
        def med(vals):
            vals = sorted(vals)
            return vals[len(vals) // 2]
        left = med([t["bbox"][0] for t in tb])
        top = med([t["bbox"][1] for t in tb])
        right = med([t["w"] - t["bbox"][2] for t in tb])
        bottom = med([t["h"] - t["bbox"][3] for t in tb])
        b.add("SPC", "page margins", "top %spt, right %spt, bottom %spt, left %spt" % tuple(
            fmt_num(max(0, v)) for v in (top, right, bottom, left)), "estimated",
            evidence([t["page"] for t in tb], None, "median distance from page edge to outermost text"))


def _radii(b, ext):
    for r in ext.get("radii", [])[:8]:
        b.add("RAD", "radius %s" % fmt_num(r["radius"]), "%spt" % fmt_num(r["radius"]), "estimated",
              evidence(r["pages"], r["count"], "rounded-rectangle corner estimated from the path"))


def _borders(b, ext):
    for s in ext.get("strokes", [])[:8]:
        b.add("BRD", "rule %s" % fmt_num(s["width"]), "%spt" % fmt_num(s["width"]), "observed",
              evidence(s["pages"], s["count"], "stroke width"))


def _effects(b, ext):
    for o in ext.get("opacities", [])[:6]:
        b.add("SHD", "opacity %s" % fmt_num(o["opacity"]), fmt_num(o["opacity"]), "observed",
              evidence(o["pages"], o["count"], "fill/stroke opacity"))


def _icons_images(b, probe):
    for f in probe.get("fonts", []):
        if fontmap.substitute(f["family"])["kind"] == "symbol":
            b.add("ICN", "glyph font %s" % f["family"], f["name"], "observed",
                  evidence(f["pages"], None, "symbol/ornament font; crop glyphs as brand marks, do not ship the font"))
    if probe.get("image_count"):
        b.add("IMG", "content images", "%d images" % probe["image_count"], "observed",
              evidence(probe.get("image_pages", []), probe["image_count"], "photos/illustrations; never shipped, "
                                                                         "imagery treatment only"))


def _is_noise(c):
    """Specks and hairline stubs repeat everywhere (table ticks, bullets drawn as paths); they are not candidates."""
    if c["kind"] == "shape":
        return max(c.get("size", [0, 0])) < 4
    if c["kind"] == "rule":
        return c.get("length", 0) < 20
    return False


def _variants_text(c):
    by = {}
    for v in c.get("variants", []):
        by.setdefault(v["attr"], []).append("%s x%d" % (v["value"], v["count"]))
    return " · ".join("%s %s" % (attr, ", ".join(vals[:6]) + (" ..." if len(vals) > 6 else "")) for attr, vals in sorted(by.items()))


def _measured_text(u, cmp_of):
    if not u:
        return None
    ov, rot, nb = u.get("overlap", {}), u.get("rotation", {}), u.get("neighbour_distance", {})
    parts = []
    if ov.get("max"):
        parts.append("overlap %d-%d %% (median %d %%), %s" % (round(100 * ov["min"]), round(100 * ov["max"]),
                                                              round(100 * ov["median"]), u.get("z_order", "none").replace("-", " ")))
    else:
        parts.append("overlap 0 %")
    parts.append("rotation %s°" % (fmt_num(rot["min"]) if rot.get("min") == rot.get("max") else "%s..%s" % (fmt_num(rot["min"]), fmt_num(rot["max"]))))
    if nb.get("min") is not None:
        parts.append("nearest neighbour %s-%spt" % (fmt_num(nb["min"]), fmt_num(nb["max"])))
    parts.append("anchor %s" % u.get("anchor", "free"))
    pp = u.get("per_page", {})
    if pp:
        parts.append("%s per page" % (pp["min"] if pp["min"] == pp["max"] else "%s-%s" % (pp["min"], pp["max"])))
    co = ["%s (%d/%d)" % (cmp_of[e["id"]], e["with"], e["of"]) for e in u.get("co_occurs", []) if e["id"] in cmp_of][:4]
    if co:
        parts.append("co-occurs: " + ", ".join(co))
    return " · ".join(parts)


def _components(b, clusters, usage=None):
    top = [c for c in clusters if not c.get("parent") and not _is_noise(c)]
    cmp_of = {c["id"]: "CMP-%03d" % (n + 1) for n, c in enumerate(top)}
    for c in top:
        v = _variants_text(c)
        item = b.add("CMP", "(unnamed)", "(unnamed)", "observed",
                     evidence(c["pages"], c["occurrences"], None), cluster=c["id"], kind=c["kind"], variants=v)
        if c["kind"] == "composite":
            item["members"] = " + ".join(dict.fromkeys(m["role"] for m in c.get("members", [])))
            item["absorbed"] = list(c.get("absorbed", []))
        else:
            if c["kind"] == "shape":
                item["shape"] = "%sx%spt shape" % tuple(fmt_num(x) for x in c.get("size", [0, 0]))
            elif c["kind"] == "rule":
                item["shape"] = "%s rule %spt, ~%spt long" % ("horizontal" if c.get("orientation") == "h" else "vertical",
                                                          fmt_num(c.get("width", 0)), fmt_num(c.get("length", 0)))
            else:
                st = c.get("style", {})
                item["shape"] = "%s text band %s %spt" % (c.get("band"), st.get("family", "?"), fmt_num(st.get("size", 0)))
        m = _measured_text((usage or {}).get(c["id"]), cmp_of)
        if m:
            item["measured"] = m
    return cmp_of


def _fmt_str(e):
    t, v = e["type"], e["value"]
    if t == "page-frame":
        return "top %spt, right %spt, bottom %spt, left %spt" % tuple(fmt_num(v[k]) for k in ("top", "right", "bottom", "left"))
    if t == "columns":
        return "%d column%s%s" % (v["count"], "" if v["count"] == 1 else "s", ", gutter %spt" % fmt_num(v["gap"]) if v["count"] > 1 else "")
    if t == "rhythm":
        return "%s %spt on %spt leading" % (v["style"], fmt_num(v["size"]), fmt_num(v["leading"]))
    if t == "text-role":
        return "%s %spt%s%s" % (v["family"], fmt_num(v["size"]), " bold" if v["bold"] else "", " italic" if v["italic"] else "")
    if t == "divider":
        return "%s rule at %spt, %spt long, %spt" % ("horizontal" if v["orientation"] == "h" else "vertical", fmt_num(v["position"]),
                                                    fmt_num(v["length"]), fmt_num(v["width"]))
    if t == "section-block":
        return "filled %s at %s pt" % (v["fill"], ",".join(fmt_num(x) for x in v["bbox"]))
    if t == "photo-frame":
        return "image aspect %s, %s" % (fmt_num(v["aspect"]), "bleeds off the page" if v["bleed"] else "inside the frame")
    if t == "table-grid":
        return "%d rows x %d columns%s" % (v["rows"], v["columns"], ", header row" if v["header_row"] else "")
    return str(v)


def _structure(b, structure):
    for e in structure.get("elements", []):
        ev = e.get("evidence", "")
        item = b.add("STR", e["label"], _fmt_str(e), e["status"], evidence(e["pages"], None, ev[:44]), type=e["type"])
        item["id"] = e["id"]                                      # structure ids are STR-NNN already
        if e.get("sample"):
            item["sample"] = e["sample"]


def _unclaimed(b, coverage):
    actionable, dismissed = [], []
    for u in coverage.get("unclaimed", []):
        x = [fmt_num(v) for v in u["bbox"]]
        if u["tier"] == "actionable":
            item = b.add("UNC", "(unnamed)", "p.%d bbox %s · %s %%" % (u["page"], ",".join(x), fmt_num(u["area_pct"])),
                         "unassigned", "crop: crops/unc-%s.png" % u["id"].split("-")[1], kinds=u["kinds"])
            item["id"] = u["id"]
            item["page"], item["bbox"] = u["page"], u["bbox"]
            actionable.append(item)
        else:
            dismissed.append({"id": u["id"], "page": u["page"], "bbox": u["bbox"], "area_pct": u["area_pct"]})
    return actionable, dismissed


def build_inventory(probe, ext, clusters, medium, structure=None, coverage=None, usage=None, targets=None):
    b = _Builder()
    r2 = structure is not None or coverage is not None
    has_frame = bool(structure) and any(e["type"] == "page-frame" for e in structure.get("elements", []))
    _colors(b, ext, None)
    _type(b, ext)
    _spacing(b, probe, ext, with_margins=not has_frame)
    _radii(b, ext)
    _borders(b, ext)
    _effects(b, ext)
    _icons_images(b, probe)
    cmp_of = _components(b, clusters, usage)
    dismissed, templates = [], []
    if structure is not None:
        _structure(b, structure)
        templates = structure.get("templates", [])
    if coverage is not None:
        _, dismissed = _unclaimed(b, coverage)
    proposed = medium.get("proposed", []) if isinstance(medium, dict) else []
    if r2 and targets:
        base = [dict(i) for i in b.items]
        for a in adapt.derive_adaptations(proposed, targets, base):
            ev = a.pop("evidence")
            item = b.add("ADP", a["label"], a["value"], "inferred", ev, confidence=a["confidence"], reasoning=a["reasoning"],
                         target=a["target"], adapted_from=a["adapted_from"])
            item["id"] = a["id"]
            item["category"] = a["category"]
    order = CATEGORIES + EXTRA_CATEGORIES
    b.items.sort(key=lambda i: (order.index(i["id"].split("-")[0]), i["id"]))
    return {"items": b.items, "omitted": b.omitted, "unknown": ext.get("unknown", []), "medium": proposed,
            "dismissed": dismissed, "templates": templates, "cmp_of": cmp_of}
