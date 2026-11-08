"""AC5 Medium detection. The *medium* (what the document is for) is separate from the PDF's technical type.

detect_medium() proposes with evidence; the user confirms or changes it at the checkpoint (`Medium:` line).
applicability() says which inventory categories make sense for a medium - and why the others do not.
"""
from __future__ import annotations

MEDIA = ["web-ui", "presentation", "publication-print", "marketing", "mixed"]

# Components that exist only where something is clicked, toggled or dismissed. Used by validate (print DS must
# not carry them) and by applicability().
WEB_ONLY_NAMES = {"toast", "snackbar", "tabs", "switch", "toggle", "tooltip", "dialog", "modal", "popover",
                  "dropdown", "spinner", "skeleton", "accordion"}
WEB_MEDIA = {"web-ui", "mixed"}

_LABEL = {"web-ui": "web / app UI", "presentation": "presentation", "publication-print": "publication / print",
          "marketing": "marketing", "mixed": "mixed"}

# category -> media where it applies.  Interaction categories first (web only), then static-page ones.
_W = {"web-ui"}
_P = {"publication-print"}
_S = {"presentation"}
_M = {"marketing"}
_CATEGORIES = [
    ("color-palette", {"web-ui", "presentation", "publication-print", "marketing"}),
    ("typography", {"web-ui", "presentation", "publication-print", "marketing"}),
    ("spacing", {"web-ui", "presentation", "publication-print", "marketing"}),
    ("radii", {"web-ui", "presentation", "publication-print", "marketing"}),
    ("borders-rules", {"web-ui", "presentation", "publication-print", "marketing"}),
    ("iconography", {"web-ui", "presentation", "publication-print", "marketing"}),
    ("imagery-treatment", {"web-ui", "presentation", "publication-print", "marketing"}),
    # interaction: only where there is a runtime
    ("button", _W | _M), ("input", _W), ("form-controls", _W), ("toast", _W), ("tabs", _W), ("switch", _W),
    ("dialog", _W), ("tooltip", _W), ("navigation", _W), ("hover-states", _W | _M), ("motion", _W | _M | _S),
    ("elevation-as-interaction", _W),
    # static page
    ("page-geometry", _P | _S | _M), ("grid", _P | _S | _M), ("running-header", _P), ("running-footer", _P),
    ("folio", _P), ("callout", _P | _M), ("table", _P | _S | _W), ("side-tab", _P), ("list-markers", _P | _S),
    ("photo-frame", _P | _M), ("caption", _P | _M), ("banner", _P | _M), ("cover", _P | _M),
    ("pull-quote", _P | _M | _S),
    # presentation / marketing
    ("slide-layout", _S), ("title-slide", _S), ("section-divider", _S), ("big-quote", _S), ("chart", _S | _W),
    ("hero", _M | _W), ("cta", _M),
]
CATEGORIES = [c for c, _ in _CATEGORIES]
_WHERE = dict(_CATEGORIES)

_INTERACTIVE = {"button", "input", "form-controls", "toast", "tabs", "switch", "dialog", "tooltip", "navigation",
                "hover-states", "motion", "elevation-as-interaction"}


def _reason(cat, medium):
    label = _LABEL[medium]
    if cat in _INTERACTIVE:
        return ("%s has no runtime: nothing is clicked, toggled, hovered or dismissed, so %s "
                "components or tokens would be invented" % (label, cat))
    if cat in ("running-header", "running-footer", "folio", "side-tab", "cover", "photo-frame", "caption"):
        return "pagination device of a printed publication; a %s has no pages to run it across" % label
    if cat in ("slide-layout", "title-slide", "section-divider", "big-quote"):
        return "slide device; a %s is not read slide by slide" % label
    if cat in ("hero", "cta"):
        return "campaign device; not evidenced in a %s" % label
    return "not evidenced for a %s document" % label


def applicability(medium):
    """-> {"medium", "applicable": [category], "not_applicable": [{"category", "reason"}]}"""
    if medium not in MEDIA:
        raise ValueError("unknown medium %r (one of %s)" % (medium, ", ".join(MEDIA)))
    if medium == "mixed":
        return {"medium": medium, "applicable": list(CATEGORIES), "not_applicable": []}
    app = [c for c in CATEGORIES if medium in _WHERE[c]]
    na = [{"category": c, "reason": _reason(c, medium)} for c in CATEGORIES if medium not in _WHERE[c]]
    return {"medium": medium, "applicable": app, "not_applicable": na}


def applicability_multi(media):
    """Several confirmed media: a category is applicable if ANY medium needs it."""
    media = [m for m in media if m in MEDIA]
    if not media:
        raise ValueError("no valid medium")
    if len(media) == 1:
        return applicability(media[0])
    parts = [applicability(m) for m in media]
    if any(p["medium"] == "mixed" for p in parts):
        return applicability("mixed")
    app = [c for c in CATEGORIES if any(c in p["applicable"] for p in parts)]
    na = [{"category": c, "reason": _reason(c, media[0])} for c in CATEGORIES if c not in app]
    return {"medium": "+".join(media), "applicable": app, "not_applicable": na}


def _dominant_page(probe):
    sizes = probe.get("page_sizes") or [{"w": 595.0, "h": 842.0, "count": 1}]
    return sizes[0]["w"], sizes[0]["h"]


def detect_medium(probe, extract, clusters):
    w, h = _dominant_page(probe)
    pages = max(1, probe.get("pages", 1))
    aspect = (w / h) if h else 1.0
    ev = {m: [] for m in ("web-ui", "presentation", "publication-print", "marketing")}
    sc = {m: 0.0 for m in ev}

    def add(m, pts, text):
        sc[m] += pts
        ev[m].append(text)

    if 1.25 <= aspect <= 1.85:
        add("presentation", 0.5, "landscape %.2f:1 pages (%d x %d pt)" % (aspect, round(w), round(h)))
    if 1.3 <= (1 / aspect) <= 1.5:
        add("publication-print", 0.35, "portrait %d x %d pt (ratio 1:%.2f, A4/Letter-like)" % (round(w), round(h), 1 / aspect))
    if aspect > 1.85 or (1 / aspect) > 1.7:
        add("web-ui", 0.3, "unusual page proportion %d x %d pt (screen capture / long page)" % (round(w), round(h)))

    styles = extract.get("text_styles") or []
    if styles:
        body = styles[0]["size"]
        if body <= 12.5:
            add("publication-print", 0.25, "body text %g pt (continuous reading size)" % body)
        elif body >= 18:
            add("presentation", 0.3, "large body type %g pt (projected reading size)" % body)
        else:
            add("web-ui", 0.1, "body text %g pt (screen reading size)" % body)

    bands = [c for c in clusters if c.get("kind") == "text-band"]
    foot = [c for c in bands if c.get("band") == "footer" and len(c.get("pages", [])) >= max(2, pages // 2)]
    if foot:
        add("publication-print", 0.2, "running footer repeated on %d of %d pages" % (len(foot[0]["pages"]), pages))
    elif bands:
        add("publication-print", 0.1, "running header/footer bands repeated")
    if probe.get("bookmarks", 0) >= 1:
        add("publication-print", 0.1, "%d bookmarks (table of contents)" % probe["bookmarks"])
    if probe.get("image_count", 0) >= pages and styles and sum(s["count"] for s in styles) / float(pages) < 600:
        add("marketing", 0.35, "image-heavy, sparse text (%d images / %d pages)" % (probe["image_count"], pages))
    if not any(sc.values()):
        add("web-ui", 0.05, "no strong signal; defaulting to the least assumptive medium")

    cands = [{"medium": m, "score": round(min(1.0, sc[m]), 2), "evidence": ev[m]} for m in sc]
    cands.sort(key=lambda c: (-c["score"], MEDIA.index(c["medium"])))
    top = cands[0]
    proposed = [top["medium"]]
    second = cands[1]
    if second["score"] >= 0.35 and second["score"] >= top["score"] - 0.15:
        proposed.append(second["medium"])
    return {"candidates": cands, "proposed": proposed}


# --------------------------------------------------------------------------- round 2: targets (AC18)
TARGETS = ["web-ui", "presentation", "publication-print", "marketing"]
DEFAULT_TARGETS = ["web-ui", "presentation", "publication-print"]            # D18: all pre-enabled except marketing

_CLASS_REASON = {
    "interactive": "no enabled medium has a runtime: nothing is clicked, toggled, hovered or dismissed, so these "
                   "components and tokens would be invented",
    "pagination": "pagination device of a printed publication; no enabled medium is paginated print",
    "slide": "slide device; no enabled medium is read slide by slide",
    "campaign": "campaign device; not evidenced in the source and no marketing medium enabled",
    "other": "not evidenced for the enabled media",
}
_PAGINATION = ("running-header", "running-footer", "folio", "side-tab", "cover", "photo-frame", "caption")
_SLIDE = ("slide-layout", "title-slide", "section-divider", "big-quote")
_CAMPAIGN = ("hero", "cta")


def _na_class(cat):
    if cat in _INTERACTIVE:
        return "interactive"
    if cat in _PAGINATION:
        return "pagination"
    if cat in _SLIDE:
        return "slide"
    if cat in _CAMPAIGN:
        return "campaign"
    return "other"


def _media_list(source):
    if source is None:
        return []
    if isinstance(source, str):
        return [source]
    return [m for m in source]


def applicability_for(source, targets):
    """Categories that make sense for the source medium plus the chosen target media (D18, D24).

    applicable = categories of (targets U {source}); observed source rows are therefore always kept, and web-only
    categories are N/A only when NO enabled target (and not the source) is web-ui. -> {"applicable", "not_applicable"}"""
    targets = list(targets or [])
    bad = [t for t in targets if t not in TARGETS]
    if bad:
        raise ValueError("unknown target %s (valid: %s)" % (", ".join('"%s"' % b for b in bad), ", ".join(TARGETS)))
    media = [m for m in _media_list(source) if m in MEDIA] + [t for t in targets]
    if "mixed" in media:
        return {"applicable": list(CATEGORIES), "not_applicable": []}
    app = [c for c in CATEGORIES if any(m in _WHERE[c] for m in media)]
    na = [{"category": c, "reason": _CLASS_REASON[_na_class(c)]} for c in CATEGORIES if c not in app]
    return {"applicable": app, "not_applicable": na}


def na_groups(source, targets):
    """Not-applicable categories grouped by reason (<= 5 groups): [{"reason", "categories": [...]}]."""
    na = applicability_for(source, targets)["not_applicable"]
    groups = {}
    for x in na:
        groups.setdefault(x["reason"], []).append(x["category"])
    order = [_CLASS_REASON[k] for k in ("interactive", "pagination", "slide", "campaign", "other")]
    return [{"reason": r, "categories": groups[r]} for r in order if r in groups]
