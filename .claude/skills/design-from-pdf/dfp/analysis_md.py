"""AC7/AC16/AC21 The checkpoint document. analysis.md is the contract between the analyse and build phases.

Row grammar (one item per line; cells separated by ` | `; a literal pipe inside a cell is written `\\|`):

    - [x] COL-001 | `#231F20` | ink | observed | p.1-24, n=18234

`[ ]` drops the item; editing the value cell overrides the measurement; `U-NNN` rows are user additions. A row may be
followed by indented continuation lines (`  - key: value`): `members:` / `absorbed:` / `variants:` / `measured:` (tool
output), `usage [tag] (edited):` (the rule Claude or the user wrote), `merge: CMP-007` and `split: CL-044` (user edits).
Header lines (at line start): `Medium:`, `Target media:`, `Unclaimed threshold:`, `Approved: <date> <name>` (`Approved: no` =
pending), `Inferred: keep|drop`. The vision pass is a table of `| page | renders/overlay-NNN.png | result | added ids |`.
Sections, in decision order: Needs you, Contents, Coverage, Vision pass, Probe, Medium and targets, Not applicable,
Structure, Page templates, Inventory, Components, Adaptations, Unclaimed, Usage, User additions, Inferred items, Checkpoint.
"""
from __future__ import annotations

import re

from . import medium as medium_mod
from .inventory import CATEGORIES, CATEGORY_TITLES
from .util import compact_pages, dual_units, fmt_num

PENDING = {"", "no", "pending", "tbd", "-", "n/a", "na", "none", "false", "todo"}
ROW = re.compile(r"^- \[(?P<k>[ xX])\]\s*(?P<rest>.*)$")
ID = re.compile(r"^[A-Z]{1,3}-\d{3}$")
DATE = re.compile(r"^\d{4}-\d{2}-\d{2}$")
CONT = re.compile(r"^\s{2,}-\s+(?P<key>[a-z]+)(?P<tag>\s*\[[^\]]*\])?(?P<edited>\s*\(edited\))?\s*:\s*(?P<val>.*)$")
IDS = re.compile(r"[A-Z]{1,3}-\d{3}")
TPL = re.compile(r"^###\s+(TPL-\d{3})\b", re.M)
INLINE_MAX = 70


def _esc(text):
    return str(text).replace("\r", " ").replace("\n", " ").replace("|", "\\|")


def _cell_value(v):
    return "`%s`" % _esc(str(v).replace("`", "'"))


def _short(text, n=INLINE_MAX):
    text = str(text)
    return text if len(text) <= n else text[:n - 3].rstrip() + "..."


def row_line(item, keep=True):
    return "- [%s] %s | %s | %s | %s | %s" % ("x" if keep else " ", item["id"], _cell_value(item["value"]),
                                              _esc(item["label"]), _esc(item["status"]), _esc(item["evidence"]))


def _pct(v):
    return "n/a" if v is None else "%s %%" % fmt_num(v)


def _rows_of(items, cat):
    return [i for i in items if i["id"].split("-")[0] == cat]


def _cmp_rows(items, cluster_cmp):
    out = []
    for i in _rows_of(items, "CMP"):
        i = dict(i)
        i["evidence"] = _short(i["evidence"], 90)
        out.append(row_line(i))
        if i.get("members"):
            line = "  - members: %s" % i["members"]
            if i.get("absorbed"):
                line += "; absorbed: " + ", ".join(i["absorbed"])
            out.append(line)
        elif i.get("shape"):
            out.append("  - shape: %s" % i["shape"])
        if i.get("variants"):
            out.append("  - variants: %s" % i["variants"])
        if i.get("measured"):
            out.append("  - measured: %s" % i["measured"])
        out.append("  - crop: crops/%s.png" % i["cluster"])
    return out


def render_analysis_md(probe, medium, inventory, pdf_name, model=None):
    model = model or {}
    items = inventory.get("items", [])
    proposed = medium.get("proposed") or []
    targets = list(model.get("targets") or medium_mod.DEFAULT_TARGETS)
    threshold = model.get("threshold", 0.001)
    coverage = model.get("coverage")
    pages_n = probe.get("pages") or 0
    raster = probe.get("pdf_type") == "raster"
    cmp_rows = _rows_of(items, "CMP")
    unc_rows = _rows_of(items, "UNC")
    str_rows = _rows_of(items, "STR")
    adp_rows = _rows_of(items, "ADP")
    dismissed = inventory.get("dismissed") or []
    templates = inventory.get("templates") or []
    low_conf = [i for i in items if i.get("status") == "inferred" and i.get("confidence") == "low"]
    vision_pages = list(range(1, pages_n + 1)) if model else []
    L = []
    L.append("# Pattern analysis - %s" % pdf_name)
    L.append("")
    L.append("Review this file, edit it, then set `Approved:`. Nothing is built until it carries one.")
    L.append("")
    L.append("Medium: %s" % ", ".join(proposed))
    L.append("Target media: %s" % ", ".join(targets))
    L.append("Layout: %s" % model.get("layout", "single pages"))
    L.append("Language: %s" % model.get("language", "unknown (note the document language here)"))
    L.append("Cluster tolerance: size +-15 %, structure >= 0.8")
    L.append("Unclaimed threshold: %s %%" % fmt_num(round(threshold * 100, 4)))
    L.append("Approved: no")
    L.append("Inferred: keep")
    L.append("")
    if raster:
        L.append("> PDF type: raster. No vector layer: STR rows and `measured:` lines are `estimated` or `unknown`.")
        L.append("> The vision pass carries the rest. Coverage is n/a; Needs you lists every item for review.")
    else:
        L.append("> PDF type: %s (strategy `%s`). All measured values are `observed`; rows tagged `inferred` are judgement." % (
            probe.get("pdf_type"), probe.get("strategy")))
    L.append("")

    L.append("## Needs you")
    L.append("")
    L.append("| What | Count | Where | How to resolve |")
    L.append("|---|---|---|---|")
    L.append("| Unclaimed regions (UNC) | %d | Unclaimed | name it, `merge: CMP-nnn`, or untick |" % len(unc_rows))
    L.append("| Unidentified components | %d | Components | give a name, or untick |" % len(cmp_rows))
    L.append("| Low-confidence inferences | %d | Inferred items | edit or untick |" % len(low_conf))
    L.append("| Vision pass pages pending | %d | Vision pass | view each overlay, record the result |" % len(vision_pages))
    L.append("| Targets enabled | %d | header | edit `Target media:` |" % len(targets))
    L.append("")

    L.append("## Contents")
    L.append("")
    cats = ", ".join("%s %d" % (CATEGORY_TITLES[c], len(_rows_of(items, c))) for c in CATEGORIES if c != "CMP")
    L.append("Coverage (%d pages) · Vision pass (%d) · Probe · Medium and targets · Not applicable · Structure (%d) · "
             "Page templates (%d) · Inventory (%s) · Components (%d) · Adaptations (%d) · Unclaimed (%d + %d auto) · Usage · "
             "User additions · Inferred items · Checkpoint" % (
                 len((coverage or {}).get("pages", [])), len(vision_pages), len(str_rows), len(templates), cats,
                 len(cmp_rows), len(adp_rows), len(unc_rows), len(dismissed)))
    L.append("")

    L.append("## Coverage")
    L.append("")
    if coverage and coverage["overall"]["claimed_pct"] is not None:
        o = coverage["overall"]
        L.append("Overall: %s of non-photo area claimed by clusters and structure · unclaimed %s in %d regions" % (
            _pct(o["claimed_pct"]), _pct(o["unclaimed_pct"]), o["unclaimed_regions"]))
    else:
        L.append("Overall: n/a - no vector area to measure, nothing is claimed or unclaimed (claimed 0 %).")
    L.append("Denominator: %s." % (coverage or {}).get("denominator", "union of drawing and text bboxes on each page, minus embedded image blocks"))
    L.append("")
    L.append("| Page | Drawing | Text | Image | Unclaimed regions | Vision pass |")
    L.append("|---|---|---|---|---|---|")
    for p in (coverage or {}).get("pages", []):
        low = " LOW" if p["drawing_pct"] is not None and p["drawing_pct"] < 85 else ""
        L.append("| %d | %s | %s | %s | %d | pending |" % (p["page"], _pct(p["drawing_pct"]) + low, _pct(p["text_pct"]), p["image"],
                                                        p["unclaimed_regions"]))
    if not (coverage or {}).get("pages"):
        L.append("| - | none | none | none | 0 | none |")
    L.append("")

    L.append("## Vision pass")
    L.append("")
    L.append("Tools propose, vision completes: view every overlay and record the result. Alt text for each overlay is its file name.")
    L.append("Result: `none missed`, or `added: CMP-nnn, ...` after adding rows with `found: vision`. `pending` and `failed (render)` block approval.")
    L.append("")
    L.append("| Page | Overlay | Result | Added ids |")
    L.append("|---|---|---|---|")
    for p in vision_pages:
        L.append("| %d | renders/overlay-%03d.png | pending | none |" % (p, p))
    if not vision_pages:
        L.append("| - | none | none | none |")
    L.append("")

    L.append("## Probe")
    L.append("")
    sizes = ", ".join("%s x %s pt (%d pages)" % (fmt_num(s["w"]), fmt_num(s["h"]), s["count"])
                      for s in probe.get("page_sizes", []))
    fams = probe.get("font_families") or []
    subset = sum(1 for f in probe.get("fonts", []) if f.get("subset"))
    L.append("| Fact | Value |")
    L.append("|---|---|")
    for k, v in (
        ("Source", pdf_name),
        ("Pages", "%s (%s)" % (probe.get("pages"), sizes)),
        ("PDF type", "%s -> strategy `%s`" % (probe.get("pdf_type"), probe.get("strategy"))),
        ("Page types", "vector ratio %s" % probe.get("vector_ratio")),
        ("Text layer", "yes, %s pages" % probe.get("text_pages") if probe.get("has_text_layer") else "none (raster)"),
        ("Images", "%s embedded" % probe.get("image_count")),
        ("Producer / creator", "%s / %s" % (probe.get("producer") or "?", probe.get("creator") or "?")),
        ("Bookmarks", probe.get("bookmarks")),
        ("Font families", "%d (%d subset-embedded): %s" % (len(fams), subset, ", ".join(fams) or "none")),
    ):
        L.append("| %s | %s |" % (k, str(v).replace("|", "/")))
    L.append("")

    L.append("## Medium and targets")
    L.append("")
    L.append("Proposed from evidence; change the `Medium:` line above to override (`web-ui`, `presentation`, "
             "`publication-print`, `marketing`, `mixed`). `Target media:` lists the media this design system must also serve.")
    L.append("")
    for c in medium.get("candidates", []):
        L.append("- %s, score %s: %s" % (c["medium"], c["score"], "; ".join(c["evidence"]) or "no evidence"))
    L.append("")
    L.append("Unit conversion: 1pt = 1.333px · 1rem = 16px")
    L.append("")
    L.append("| Target | Enabled | What it adds |")
    L.append("|---|---|---|")
    for t in medium_mod.TARGETS:
        n_adp = len([a for a in adp_rows if a.get("target") == t])
        L.append("| %s | %s | %s |" % (t, "yes" if t in targets else "no", ("%d adaptations" % n_adp) if n_adp else "observed rows only"))
    L.append("")

    L.append("## Not applicable")
    L.append("")
    try:
        groups = medium_mod.na_groups(proposed, targets)
    except ValueError:
        groups = []
    if groups:
        for g in groups:
            L.append("- %s: %s" % (g["reason"], ", ".join(g["categories"])))
    else:
        L.append("none")
    L.append("")

    L.append("## Structure (%d)" % len(str_rows))
    L.append("")
    if str_rows:
        for i in str_rows:
            L.append(row_line(i))
    else:
        L.append("none")
    L.append("")

    L.append("## Page templates (%d)" % len(templates))
    L.append("")
    cmp_of = inventory.get("cmp_of") or {}
    if templates:
        for t in templates:
            L.append("### %s %s n=%d" % (t["id"], t.get("label", "pages " + compact_pages(t["pages"])), t["n"]))
            L.append("  zones:    " + " · ".join("%s (%s-%spt)" % (z["name"], fmt_num(z["y0"]), fmt_num(z["y1"])) for z in t["zones"]))
            for zone, ids in t.get("components", {}).items():
                names = [cmp_of.get(c, c) for c in ids[:12]]
                L.append("  %s: %s%s" % (zone.split(" ")[0], ", ".join(names), " ..." if len(ids) > 12 else ""))
    else:
        L.append("none")
    L.append("")

    L.append("## Inventory")
    L.append("")
    L.append("Row format: `- [x] ID | value | label | status | evidence`. Untick to drop, edit the value to override, "
             "add your own rows under *User additions* with ids `U-001`, `U-002`, ...")
    L.append("")
    for cat in CATEGORIES:
        if cat == "CMP":
            continue
        L.append("### %s" % CATEGORY_TITLES[cat])
        L.append("")
        rows = _rows_of(items, cat)
        if not rows:
            L.append("_none found_")
        for i in rows:
            L.append(row_line(i))
        L.append("")
    omitted = inventory.get("omitted") or {}
    if omitted:
        L.append("Not listed (lowest count): %s" % ", ".join("%s: %d more" % (k, v) for k, v in sorted(omitted.items())))
        L.append("")
    unknown = inventory.get("unknown") or []
    if unknown:
        L.append("Could not be measured from this PDF: %s. These are left unknown, not guessed." % ", ".join(unknown))
        L.append("")

    L.append("## Components (%d)" % len(cmp_rows))
    L.append("")
    if cmp_rows:
        L.append("Give each row a name (label and value cell); unticking a row also drops the fragments listed under `absorbed:`. "
                 "Write `split: CL-nnn` under a row to keep one fragment as its own component.")
        L.append("")
        kinds = [("composite", "composites/"), ("shape", "shapes/"), ("rule", "rules/"), ("text-band", "text-bands/")]
        by_kind = {}
        for i in cmp_rows:
            by_kind.setdefault(i.get("kind", "shape"), []).append(i)
        for kind, title in kinds:
            rows = by_kind.get(kind)
            if not rows:
                continue
            L.append("#### %s (%d rows)" % (title, len(rows)))
            L.append("")
            for line in _cmp_rows(rows, cmp_of):
                L.append(line)
            L.append("")
    else:
        L.append("none")
        L.append("")

    L.append("## Adaptations (%d)" % len(adp_rows))
    L.append("")
    if adp_rows:
        L.append("Derived for the enabled target media from the measured palette, type and page geometry; all `inferred`. "
                 "Add semantic ones as `ADP-nnn` rows (status `inferred`, evidence `adapted-from: <ids>`).")
        L.append("")
        for i in adp_rows:
            i = dict(i)
            i["evidence"] = _short("adapted-from: %s; confidence: %s" % (", ".join(i.get("adapted_from", [])), i.get("confidence", "low")), 80)
            L.append(row_line(i))
    else:
        L.append("none")
    L.append("")

    L.append("## Unclaimed (%d actionable, %d auto-dismissed)" % (len(unc_rows), len(dismissed)))
    L.append("")
    if unc_rows:
        L.append("Resolve by editing the row: replace `(unnamed)` with a name, write `merge: CMP-007` under it, or untick to dismiss.")
        L.append("")
        for i in unc_rows:
            L.append(row_line(i))
        L.append("")
    else:
        L.append("none actionable")
        L.append("")
    L.append("### Auto-dismissed (below %s %%)" % fmt_num(round(threshold * 100, 4)))
    L.append("")
    if dismissed:
        L.append("| id | page | bbox | area |")
        L.append("|---|---|---|---|")
        for d in dismissed[:60]:
            L.append("| %s | %d | %s | %s %% |" % (d["id"], d["page"], ",".join(fmt_num(v) for v in d["bbox"]), fmt_num(d["area_pct"])))
        if len(dismissed) > 60:
            L.append("| ...%d more | | | |" % (len(dismissed) - 60))
    else:
        L.append("none")
    L.append("")

    L.append("## Usage")
    L.append("")
    co_rows = [i for i in cmp_rows if i.get("measured") and "co-occurs" in i["measured"]]
    if co_rows:
        L.append("| Component | Measured together with |")
        L.append("|---|---|")
        for i in co_rows[:80]:
            L.append("| %s | %s |" % (i["id"], i["measured"].split("co-occurs: ", 1)[1]))
    else:
        L.append("none")
    L.append("")

    L.append("## User additions")
    L.append("")
    L.append("Add your own rows here as `- [x] U-001 | value | label | user | note`, or inferred ones as "
             "`- [x] U-002 | value | label | inferred | confidence medium; reasoning: ...`.")
    L.append("")
    L.append("none")
    L.append("")

    L.append("## Inferred items")
    L.append("")
    inferred = [i for i in items if i["status"] == "inferred"]
    if inferred:
        L.append("Judgement calls, not measurements. Untick them above, or set `Inferred: drop` in the header to "
                 "discard them all.")
        L.append("")
        for i in inferred:
            L.append("- %s (confidence %s) - %s = %s. Reasoning: %s" % (
                i["id"], i.get("confidence", "?"), i["label"], _short(i["value"], 80), _short(i.get("reasoning", ""), 120)))
    else:
        L.append("none")
    L.append("")
    L.append("## Checkpoint")
    L.append("")
    L.append("Approve by replacing `no` on the approval line at the top with today's date and your name. Then run the "
             "skill again on the design-system directory: the build honours every tick, edit and addition above.")
    L.append("")
    return "\n".join(L)


def split_cells(rest):
    return [c.strip().replace("\\|", "|") for c in re.split(r"(?<!\\)\|", rest)]


def _targets(text):
    m = re.search(r"^Target media:[ \t]*(.*)$", text, re.M)
    if not m:
        return None
    return [t for t in re.split(r"[,\s]+", m.group(1).strip().lower()) if t]


def parse_analysis_md(text):
    out = {"medium": [], "approved": False, "approved_by": None, "approved_at": None, "inferred_policy": "keep",
           "items": [], "errors": [], "targets": [], "targets_present": False, "targets_line": None,
           "unclaimed_threshold": 0.001, "templates": [], "vision": []}
    m = re.search(r"^Medium:[ \t]*(.*)$", text, re.M)
    if m:
        out["medium"] = [t for t in re.split(r"[,\s]+", m.group(1).strip().lower()) if t]
    tg = _targets(text)
    if tg is not None:
        out["targets"], out["targets_present"] = tg, True
        out["targets_line"] = next((n for n, l in enumerate(text.splitlines(), start=1) if l.startswith("Target media:")), None)
    m = re.search(r"^Unclaimed threshold:[ \t]*([\d.]+)", text, re.M)
    if m:
        try:
            out["unclaimed_threshold"] = float(m.group(1)) / 100.0
        except ValueError:
            pass
    m = re.search(r"^Approved:[ \t]*(.*)$", text, re.M)
    if m:
        val = m.group(1).strip()
        if val.lower() not in PENDING:
            out["approved"] = True
            parts = val.split(None, 1)
            if parts and DATE.match(parts[0]):
                out["approved_at"] = parts[0]
                out["approved_by"] = parts[1].strip() if len(parts) > 1 else None
            else:
                out["approved_by"] = val
    m = re.search(r"^Inferred:[ \t]*(keep|drop)\b", text, re.M | re.I)
    if m:
        out["inferred_policy"] = m.group(1).lower()
    out["templates"] = TPL.findall(text)
    seen = set()
    last, bad_row = None, False
    for n, line in enumerate(text.splitlines(), start=1):
        if line.startswith("|") and "renders/overlay-" in line:
            cells = [c.strip() for c in line.strip().strip("|").split("|")]
            if len(cells) >= 3 and cells[0].isdigit():
                added = IDS.findall(cells[3]) if len(cells) > 3 else []
                out["vision"].append({"page": int(cells[0]), "result": cells[2], "added": added})
            continue
        c = CONT.match(line)
        if c and last is not None and not bad_row:
            key, val = c.group("key"), c.group("val").strip()
            if key == "members":
                last["members"] = re.split(r";\s*absorbed:", val)[0].strip()
                if "absorbed:" in val:
                    last["absorbed"] = re.findall(r"CL-\d{3}", val.split("absorbed:", 1)[1])
            elif key == "absorbed":
                last["absorbed"] = re.findall(r"CL-\d{3}", val)
            elif key == "split":
                last["split"] = re.findall(r"CL-\d{3}", val)
            elif key == "merge":
                mm = IDS.search(val)
                last["merge"] = mm.group(0) if mm else val
            elif key == "usage":
                tag = (c.group("tag") or "").strip()[1:-1].strip() if c.group("tag") else ""
                last["usage"] = {"tag": tag, "text": val, "edited": bool(c.group("edited"))}
            else:
                last[key] = val
            continue
        r = ROW.match(line)
        if not r:
            continue
        cells = split_cells(r.group("rest"))
        bad = None
        if len(cells) < 5:
            bad = "expected 5 cells (id | value | label | status | evidence), found %d" % len(cells)
        elif not ID.match(cells[0]):
            bad = "bad id %r" % cells[0]
        elif cells[0] in seen:
            bad = "duplicate id %s" % cells[0]
        if bad:
            out["errors"].append({"code": "MALFORMED_ROW", "line": n, "message": bad, "text": line.strip()[:120],
                                  "after": last["id"] if last else None})
            bad_row = True
            continue
        seen.add(cells[0])
        value = cells[1]
        if len(value) >= 2 and value.startswith("`") and value.endswith("`"):
            value = value[1:-1]
        bad_row = False
        last = {"id": cells[0], "keep": r.group("k") in "xX", "value": value, "label": cells[2],
                "status": cells[3], "evidence": " | ".join(cells[4:]), "line": n}
        out["items"].append(last)
    return out
