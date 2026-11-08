"""AC11 / D10: embedded fonts are never extracted or redistributed. Every family maps to the nearest Google Fonts
match and is flagged as a substitution; symbol/ornament fonts map to nothing (their glyphs are brand marks to crop).
"""
from __future__ import annotations

import re
from urllib.parse import quote_plus

# family (as returned by probe.family_of) -> (kind, google font, confidence, why)
KNOWN = {
    "OfficinaSansStd": ("sans", "Fira Sans", "medium", "Officina Sans is a humanist sans with a typewriter-derived skeleton; Fira Sans is the closest open match"),
    "OfficinaSerifStd": ("serif", "Source Serif 4", "low", "Officina Serif is a slab-leaning text serif; no exact open match"),
    "MyriadPro": ("sans", "Source Sans 3", "high", "Myriad and Source Sans are both Adobe-lineage humanist sans designs"),
    "UniversLTStd": ("sans", "Inter", "medium", "Univers is a neo-grotesque; Inter is the nearest open neo-grotesque"),
    "HelveticaNeueLTStd": ("sans", "Inter", "medium", "Helvetica Neue is a neo-grotesque; Inter is the nearest open match"),
    "Helvetica": ("sans", "Arimo", "high", "Arimo is metric-compatible with Helvetica/Arial"),
    "Arial": ("sans", "Arimo", "high", "Arimo is metric-compatible with Arial"),
    "ArialMT": ("sans", "Arimo", "high", "Arimo is metric-compatible with Arial"),
    "Times": ("serif", "Tinos", "high", "Tinos is metric-compatible with Times New Roman"),
    "TimesNewRoman": ("serif", "Tinos", "high", "Tinos is metric-compatible with Times New Roman"),
    "Courier": ("mono", "Cousine", "high", "Cousine is metric-compatible with Courier New"),
    "BemboStd": ("serif", "EB Garamond", "medium", "Bembo is an old-style Aldine serif; EB Garamond is the closest open old-style"),
    "VectoraLTStd": ("serif", "Source Serif 4", "low", "Vectora is a Dutch-style text serif; no exact open match"),
    "OceanSansStd": ("sans", "Nunito Sans", "low", "Ocean Sans is a friendly humanist sans; approximate"),
    "TektonPro": ("script", "Architects Daughter", "low", "Tekton is hand-lettered capitals-style print; approximate handwriting"),
    "KorasHand": ("script", "Patrick Hand", "low", "handwriting face; approximate"),
    "HandfontPND": ("script", "Patrick Hand", "low", "handwriting face; approximate"),
    "Trixie": ("script", "Special Elite", "low", "typewriter-distressed face; approximate"),
    "ZiptyDoStd": ("display", "Fredoka", "low", "rounded display face; approximate"),
    "SpumoniLPStd": ("display", "Pacifico", "low", "display script; approximate"),
    "RaleighLTStd": ("display", "Playfair Display", "low", "decorative serif display; approximate"),
    "NeographikMT": ("display", "Poppins", "low", "geometric display; approximate"),
}

_FALLBACK = {"sans": "Open Sans", "serif": "Source Serif 4", "mono": "Roboto Mono", "script": "Caveat",
             "display": "Poppins"}
_GENERIC = {"sans": "sans-serif", "serif": "serif", "mono": "monospace", "script": "cursive",
            "display": "sans-serif", "symbol": "sans-serif"}

_SYMBOL = re.compile(r"(dingbat|wingding|webding|symbol|ornament|decoration|bullets?)", re.I)


def _guess_kind(family, hints):
    hints = hints or {}
    low = family.lower()
    if _SYMBOL.search(family) or re.search(r"[a-z]Pi$", family):
        return "symbol"
    if hints.get("monospaced") or re.search(r"(mono|courier|consolas|typewriter|code)", low):
        return "mono"
    if re.search(r"(script|hand|brush|marker|callig)", low):
        return "script"
    if hints.get("serifed") or re.search(r"(serif(?!.*sans)|roman|garamond|times|georgia|bembo|bodoni|caslon|palatino)", low):
        return "serif"
    return "sans"


def substitute(family, style_hints=None):
    """-> {family, kind, google_font|None, generic, substituted: True, confidence, reason}"""
    fam = family.strip()
    if fam in KNOWN:
        kind, gf, conf, why = KNOWN[fam]
        return {"family": fam, "kind": kind, "google_font": gf, "generic": _GENERIC[kind], "substituted": True,
                "confidence": conf, "reason": "%s (original is not redistributed)" % why}
    kind = _guess_kind(fam, style_hints)
    if kind == "symbol":
        return {"family": fam, "kind": "symbol", "google_font": None, "generic": _GENERIC["symbol"],
                "substituted": True, "confidence": "high",
                "reason": "symbol/ornament font: not redistributable and has no text equivalent; crop the glyph "
                          "as a brand mark instead"}
    return {"family": fam, "kind": kind, "google_font": _FALLBACK[kind], "generic": _GENERIC[kind],
            "substituted": True, "confidence": "low",
            "reason": "unknown family: generic %s fallback chosen by name/flags; confirm against the page renders" % kind}


_W = lambda lo, hi: set(range(lo, hi + 1, 100))        # noqa: E731
# (weights, has italic) actually served by Google Fonts; a request outside this fails the whole @import
AVAILABLE = {
    "Fira Sans": (_W(100, 900), True), "Source Sans 3": (_W(200, 900), True), "Source Serif 4": (_W(200, 900), True),
    "Inter": (_W(100, 900), True), "Open Sans": (_W(300, 800), True), "Arimo": (_W(400, 700), True),
    "Tinos": ({400, 700}, True), "Cousine": ({400, 700}, True), "EB Garamond": (_W(400, 800), True),
    "Nunito Sans": (_W(200, 900), True), "Playfair Display": (_W(400, 900), True), "Poppins": (_W(100, 900), True),
    "Roboto Mono": (_W(100, 700), True), "Caveat": (_W(400, 700), False), "Fredoka": (_W(300, 700), False),
    "Architects Daughter": ({400}, False), "Patrick Hand": ({400}, False), "Special Elite": ({400}, False),
    "Pacifico": ({400}, False),
}


def clamp_variant(font, weight, italic):
    """Nearest (weight, italic) the family really offers; unknown families are passed through unchanged."""
    if font not in AVAILABLE:
        return int(weight), bool(italic)
    ws, has_italic = AVAILABLE[font]
    w = min(ws, key=lambda x: (abs(x - int(weight)), x))
    return w, bool(italic) and has_italic


def google_import(font, variants=((400, False),)):
    """CSS `@import` line for a Google Fonts family (css2 API). variants: iterable of (weight, italic)."""
    vs = sorted({clamp_variant(font, w, i) for w, i in variants}, key=lambda t: (t[1], t[0])) or [(400, False)]
    name = quote_plus(font)
    if any(i for _, i in vs):
        spec = "%s:ital,wght@%s" % (name, ";".join("%d,%d" % (1 if i else 0, w) for w, i in vs))
    else:
        spec = "%s:wght@%s" % (name, ";".join(str(w) for w, _ in vs))
    return "@import url('https://fonts.googleapis.com/css2?family=%s&display=swap');" % spec
