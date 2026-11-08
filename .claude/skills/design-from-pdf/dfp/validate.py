"""AC8-AC11, AC14 structural validation of a produced design system. Structure only: whether a card or a verdict is
*right* stays with the checkpoint reviewer. Returns a list of violations {code, path, message}; [] = clean."""
from __future__ import annotations

import json
import re
from pathlib import Path

from .medium import WEB_MEDIA, WEB_ONLY_NAMES

README_SECTIONS = ["Sources", "Index", "Components", "Intentional additions", "Content fundamentals",
                   "Visual foundations", "Iconography", "Layout & composition rules", "Substitutions & gaps"]
FONT_EXT = {".ttf", ".otf", ".woff", ".woff2", ".pfb", ".eot", ".ttc"}
IMG_EXT = {".png", ".jpg", ".jpeg", ".gif", ".webp", ".bmp", ".tif", ".tiff"}
MAX_MARK_PX = 512

_IMPORT = re.compile(r"@import\s+(?:url\(\s*)?['\"]?([^'\")\s;]+)['\"]?\s*\)?[^;]*;")
_TOKEN_DEF = re.compile(r"(--[\w-]+)\s*:")
_COMMENT = re.compile(r"/\*.*?\*/", re.S)


def _v(code, path, message):
    return {"code": code, "path": str(path), "message": message}


def _read(p):
    return Path(p).read_text(encoding="utf-8", errors="replace")


def _rel(ds, p):
    try:
        return Path(p).relative_to(ds).as_posix()
    except ValueError:
        return str(p)


def _headings(text):
    """[(level, title, start_line_index)]"""
    out = []
    for i, ln in enumerate(text.splitlines()):
        m = re.match(r"^(#{1,6})\s+(.*?)\s*#*\s*$", ln)
        if m:
            out.append((len(m.group(1)), m.group(2), i))
    return out


def _section(text, name):
    """Body of the first heading whose title contains `name` (case-insensitive) up to the next heading of equal or
    higher level; None when absent."""
    lines = text.splitlines()
    hs = _headings(text)
    for idx, (lvl, title, start) in enumerate(hs):
        if name.lower() in title.lower():
            end = len(lines)
            for lvl2, _, s2 in hs[idx + 1:]:
                if lvl2 <= lvl:
                    end = s2
                    break
            return "\n".join(lines[start + 1:end])
    return None


def _css_imports(css_path):
    text = _COMMENT.sub("", _read(css_path))
    return _IMPORT.findall(text)


def _is_remote(target):
    return re.match(r"^[a-z][a-z0-9+.-]*:", target) is not None or target.startswith("//")


def _check_styles(ds, out):
    styles = ds / "styles.css"
    if not styles.is_file():
        out.append(_v("STYLES_MISSING", "styles.css", "styles.css is missing"))
        return
    stripped = _COMMENT.sub("", _read(styles))
    bad = [ln.strip() for ln in stripped.splitlines() if ln.strip() and not ln.strip().startswith("@import")]
    if bad:
        out.append(_v("STYLES_NOT_IMPORT_ONLY", "styles.css", "styles.css must contain @import lines only; found: %s" % bad[0][:60]))
    seen, queue = set(), [styles]
    while queue:
        cur = queue.pop()
        if cur in seen:
            continue
        seen.add(cur)
        for target in _css_imports(cur):
            if _is_remote(target):
                continue
            tgt = (cur.parent / target.split("?")[0]).resolve()
            if not tgt.is_file():
                out.append(_v("IMPORT_UNRESOLVED", _rel(ds, cur), "@import target not found: %s" % target))
            elif tgt.suffix == ".css":
                queue.append(tgt)


def _check_cards(ds, out):
    files = set(ds.rglob("*.card.html")) | set((ds / "guidelines").rglob("*.html"))
    for f in sorted(files):
        if "_analysis" in f.relative_to(ds).parts:
            continue
        first = _read(f).lstrip("﻿").split("\n", 1)[0]
        ok = (re.match(r"^<!--\s*@dsCard\b", first) and re.search(r'\bgroup="[^"]+"', first)
              and re.search(r'\bviewport="\d+x\d+"', first))
        if not ok:
            out.append(_v("CARD_NO_DSCARD", _rel(ds, f), 'line 1 must be <!-- @dsCard group="..." viewport="WxH" ... -->'))


def _components(ds):
    root = ds / "components"
    if not root.is_dir():
        return []
    return sorted(p for p in root.rglob("*") if p.suffix in (".jsx", ".tsx") and ".stories." not in p.name)


def _medium(ds):
    """Media the design system serves: the confirmed source medium plus the enabled targets (None = unknown)."""
    ap = ds / "_analysis" / "approved.json"
    if not ap.is_file():
        return None
    try:
        data = json.loads(_read(ap))
    except ValueError:
        return None
    return set(data.get("medium", [])) | set(data.get("targets") or [])


def _check_components(ds, out, medium):
    comps = _components(ds)
    manifest = None
    mp = ds / "_ds_manifest.json"
    if mp.is_file():
        try:
            manifest = json.loads(_read(mp))
        except ValueError:
            out.append(_v("MANIFEST_MISSING_COMPONENT", "_ds_manifest.json", "manifest is not valid JSON"))
    elif comps:
        out.append(_v("MANIFEST_MISSING", "_ds_manifest.json", "components exist but _ds_manifest.json is missing"))
    listed = {}
    for c in (manifest or {}).get("components", []):
        listed[c.get("name")] = c
        if c.get("sourcePath"):
            listed[Path(c["sourcePath"]).stem] = c
    for p in comps:
        rel = _rel(ds, p)
        stem = p.stem
        pm = p.parent / (stem + ".prompt.md")
        if pm.is_file():
            usage = _section(_read(pm), "Usage & composition")
            if usage is None or not usage.strip():
                out.append(_v("COMPONENT_NO_USAGE", _rel(ds, pm), "%s.prompt.md needs a non-empty `## Usage & composition` "
                              "section (overlap, rotation, anchor, max per page, evidence; or the measured-nothing fallback)" % stem))
        if not p.with_suffix(".d.ts").is_file():
            out.append(_v("COMPONENT_NO_DTS", rel, "missing sibling %s.d.ts (props contract)" % stem))
        if not (p.parent / (stem + ".prompt.md")).is_file():
            out.append(_v("COMPONENT_NO_PROMPT", rel, "missing sibling %s.prompt.md" % stem))
        if stem not in listed:
            out.append(_v("MANIFEST_MISSING_COMPONENT", rel, "%s is not listed in _ds_manifest.json" % stem))
        if medium is not None and not (medium & WEB_MEDIA) and stem.lower() in WEB_ONLY_NAMES:
            out.append(_v("WEB_ONLY_COMPONENT_FOR_PRINT", rel, "%s is an interactive web component; the confirmed medium (%s) "
                          "has no runtime for it" % (stem, ", ".join(sorted(medium)))))
    if comps:
        cc = ds / "guidelines" / "composition.card.html"
        first = (_read(cc).lstrip("﻿").splitlines() or [""])[0] if cc.is_file() else ""
        if not re.match(r"^<!--\s*@dsCard", first):
            out.append(_v("COMPOSITION_CARD_MISSING", "guidelines/composition.card.html",
                          "a design system with components needs guidelines/composition.card.html (line 1 `<!-- @dsCard ... -->`) "
                          "showing the multi-instance rules"))
    if medium is not None and not (medium & WEB_MEDIA):
        if (ds / "tokens" / "motion.css").is_file():
            out.append(_v("WEB_ONLY_ARTIFACT", "tokens/motion.css", "motion tokens do not belong to %s" % ", ".join(sorted(medium))))
        for d in ("store", "host"):
            if (ds / d).exists():
                out.append(_v("WEB_ONLY_ARTIFACT", d + "/", "%s/ is a web-extension artifact; not for %s" % (d, ", ".join(sorted(medium)))))


def _check_ip(ds, out):
    from PIL import Image

    for f in sorted(ds.rglob("*")):
        if not f.is_file():
            continue
        parts = f.relative_to(ds).parts
        if "_analysis" in parts or ".git" in parts:
            continue
        ext = f.suffix.lower()
        if ext in FONT_EXT:
            out.append(_v("FONT_BINARY_SHIPPED", _rel(ds, f), "font binaries are never redistributed; use a Google Fonts substitute"))
        elif ext in IMG_EXT:
            try:
                with Image.open(str(f)) as im:
                    big = max(im.size) > MAX_MARK_PX
            except Exception:
                continue
            if big:
                out.append(_v("CONTENT_IMAGE_SHIPPED", _rel(ds, f), "raster larger than %d px looks like content imagery, "
                              "not a brand mark; crop the mark or drop the image" % MAX_MARK_PX))


def _check_readme(ds, out):
    rp = ds / "readme.md"
    if not rp.is_file():
        out.append(_v("README_SECTION_MISSING", "readme.md", "readme.md is missing"))
        return None
    text = _read(rp)
    titles = [t.lower() for _, t, _ in _headings(text)]
    for name in README_SECTIONS:
        if not any(name.lower() in t for t in titles):
            out.append(_v("README_SECTION_MISSING", "readme.md", "missing section: %s" % name))
    return text


def _check_provenance(ds, out, readme):
    tokens = {}
    tdir = ds / "tokens"
    if tdir.is_dir():
        for f in sorted(tdir.glob("*.css")):
            for t in _TOKEN_DEF.findall(_COMMENT.sub("", _read(f))):
                tokens.setdefault(t, f.name)
    prov, pp = {}, ds / "provenance.json"
    if pp.is_file():
        try:
            prov = json.loads(_read(pp))
        except ValueError:
            prov = {}
    for t, fname in sorted(tokens.items()):
        if t not in prov:
            out.append(_v("PROVENANCE_MISSING", "provenance.json", "no provenance for %s (defined in tokens/%s)" % (t, fname)))
    inferred = {e.get("id") for e in prov.values() if isinstance(e, dict) and e.get("status") == "inferred"}
    ap = ds / "_analysis" / "approved.json"
    if ap.is_file():
        try:
            for it in json.loads(_read(ap)).get("items", []):
                if it.get("keep") and it.get("status") == "inferred":
                    inferred.add(it.get("id"))
        except ValueError:
            pass
    inferred.discard(None)
    if inferred and readme is not None:
        section = _section(readme, "Intentional additions") or ""
        for iid in sorted(inferred):
            if iid not in section:
                out.append(_v("INFERRED_NOT_LISTED", "readme.md", "inferred item %s is not listed under Intentional additions" % iid))


def _check_analysis(ds, out, readme):
    a = ds / "_analysis"
    if a.is_dir():
        gi = a / ".gitignore"
        lines = [l.strip() for l in _read(gi).splitlines()] if gi.is_file() else []
        for need in ("renders/", "verify/"):
            if need not in lines:
                out.append(_v("ANALYSIS_NOT_IGNORED", "_analysis/.gitignore", "must ignore %s" % need))
    vp = a / "verify.md"
    if not vp.is_file():
        out.append(_v("VERIFY_MISSING", "_analysis/verify.md", "no verification record: run `dfp.sh verify`, look at every "
                      "pair and write one verdict per component"))
        return
    text = _read(vp)
    m = re.search(r"^Visual:\s*(\w+)", text, re.M | re.I)
    if not m:
        out.append(_v("VERIFY_MISSING", "_analysis/verify.md", "verify.md has no `Visual: performed|skipped (reason)` line"))
        return
    rows = re.findall(r"^\s*-\s*([^|\n]+?)\s*\|\s*(match|fixed|drift|skipped)\s*\|", text, re.M | re.I)
    for name, verdict in rows:
        if verdict.lower() == "drift":
            out.append(_v("VERIFY_UNRESOLVED", "_analysis/verify.md", "%s is still `drift`: fix it, re-verify, or list it under "
                          "Substitutions & gaps and mark it fixed/match with a note" % name))
    skipped = m.group(1).lower() == "skipped" or any(v.lower() == "skipped" for _, v in rows)
    if skipped:
        gaps = _section(readme or "", "Substitutions & gaps") or ""
        if not re.search(r"verif|visual", gaps, re.I):
            out.append(_v("VERIFY_SKIP_NOT_DISCLOSED", "readme.md", "the visual check was skipped but Substitutions & gaps "
                          "does not say so"))


def validate_ds(ds_dir):
    ds = Path(ds_dir)
    out = []
    medium = _medium(ds)
    _check_styles(ds, out)
    _check_cards(ds, out)
    _check_components(ds, out, medium)
    _check_ip(ds, out)
    readme = _check_readme(ds, out)
    _check_provenance(ds, out, readme)
    if not (ds / "SKILL.md").is_file():
        out.append(_v("SKILL_MD_MISSING", "SKILL.md", "SKILL.md is missing: the design system must double as an Agent Skill"))
    _check_analysis(ds, out, readme)
    return out
