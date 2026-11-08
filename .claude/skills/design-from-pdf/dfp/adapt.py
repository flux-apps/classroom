"""AC18 Tool-derived adaptations: token- and structure-level only, deterministic, always `inferred` and citing the
source rows they come from. Semantic adaptations (side tab -> tabs, callout -> alert) need a name for the source
element, so Claude writes them at the checkpoint as ADP rows; the gate checks they cite `adapted-from:`.
"""
from __future__ import annotations

import re

from .medium import TARGETS


def _first(items, cat, pred=None):
    for i in items:
        if i.get("category") == cat and (pred is None or pred(i)):
            return i
    return None


def _body_type(items):
    typ = [i for i in items if i.get("category") == "TYP"]
    for i in typ:
        if str(i.get("label", "")).lower().startswith("body"):
            return i
    for i in typ:
        if "scale" not in str(i.get("label", "")).lower():
            return i
    return typ[0] if typ else None


def _ids(*items):
    return list(dict.fromkeys(i["id"] for i in items if i))


def _adp(n, category, label, value, confidence, reasoning, target, sources):
    return {"id": "ADP-%03d" % n, "category": category, "label": label, "value": value, "status": "inferred",
            "confidence": confidence, "reasoning": reasoning, "target": target, "adapted_from": list(sources),
            "evidence": "adapted-from: %s; confidence: %s; %s" % (", ".join(sources), confidence, reasoning)}


def derive_adaptations(source, targets, items):
    src = source if isinstance(source, str) else (list(source)[0] if source else "")
    targets = [t for t in TARGETS if t in (targets or [])]
    cols = [i for i in items if i.get("category") == "COL"]
    ink = _first(items, "COL", lambda i: str(i.get("label", "")).lower() in ("ink", "dark-grey", "black")) or (cols[0] if cols else None)
    accent = next((c for c in cols if c is not ink), ink)
    body = _body_type(items)
    page = _first(items, "SPC", lambda i: "page" in str(i.get("label", "")).lower() or "slide" in str(i.get("label", "")).lower())
    out = []

    def add(category, label, value, conf, why, target, sources):
        sources = [s for s in sources if s]
        if not sources:
            return
        out.append(_adp(len(out) + 1, category, label, value, conf, why, target, sources))

    if "web-ui" in targets and src != "web-ui":
        base = _ids(accent, body)
        add("button", "button", "filled %s, text %s" % (
            accent["value"] if accent else "accent", ink["value"] if ink else "ink"), "medium",
            "a primary action needs a filled accent surface; the palette and body type carry over", "web-ui", base)
        add("input", "input", "1pt %s border, body type" % (ink["value"] if ink else "ink"), "medium",
            "a text field reuses the ink colour for its rule and the body type for its text", "web-ui", _ids(ink, body))
        add("hover-states", "hover-states", "accent tint on hover", "low",
            "no pointer exists in the source; states are derived from the palette only", "web-ui", _ids(accent, ink))
    if "presentation" in targets and src != "presentation":
        add("slide-layout", "slide-layout", "16:9, frame margins, larger type", "low",
            "the page geometry and type scale are re-read for a landscape slide", "presentation", _ids(page, body, ink))
        add("title-slide", "title-slide", "largest heading on an accent band", "low",
            "the heading style and the accent colour carry over to a title slide", "presentation", _ids(body, accent))
    if "publication-print" in targets and src != "publication-print":
        add("page-geometry", "page-geometry", "@page from source size, 3mm bleed",
            "medium", "a printed target needs a page box; the source page size is the baseline", "publication-print",
            _ids(page, body))
    return out
