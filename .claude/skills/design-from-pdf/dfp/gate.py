"""AC7/AC16a/AC21 The approval gate: a pure function of files. Writes approved.json only when every condition holds.

`NOT_APPROVED` (and a missing analysis) short-circuit; every other check collects into `problems[]` so one pass over
analysis.md fixes everything. `reason` is the first problem, so callers that read one reason still work.
Order: MALFORMED_ROW NO_MEDIUM BAD_MEDIUM BAD_TARGET UNKNOWN_ID BAD_ADAPTATION UNRESOLVED_UNC VISION_PENDING
UNIDENTIFIED_CMP INVALID_FOR_TARGETS.
"""
from __future__ import annotations

import datetime
import json
import re
from pathlib import Path

from . import analysis_md
from . import medium as medium_mod
from .medium import MEDIA, TARGETS
from .util import slugify

_HEX = re.compile(r"^#[0-9A-Fa-f]{6}$")
_LEN = re.compile(r"^-?\d+(\.\d+)?(pt|px|mm|cm|in|em|rem|%)$")
SHOW = 5


def _problem(reason, message, **extra):
    p = {"reason": reason, "message": message}
    p.update(extra)
    return p


def _result(problems, **extra):
    r = {"ok": not problems, "reason": problems[0]["reason"] if problems else None,
         "message": problems[0]["message"] if problems else "approved", "problems": problems}
    r.update(extra)
    return r


def guess_category(value):
    v = str(value).strip()
    if _HEX.match(v):
        return "COL"
    if _LEN.match(v):
        return "SPC"
    return None


def _ids_msg(ids, n=SHOW):
    shown = ", ".join(ids[:n])
    return "%s%s" % (shown, " ... (first %d shown; full list in analysis.md)" % n if len(ids) > n else "")


def _unnamed(row):
    return "(unnamed)" in (row["label"], row["value"]) or not row["label"].strip()


def _is_found_vision(row):
    return "found: vision" in row["evidence"]


def check_gate(ds_dir):
    a = Path(ds_dir).resolve() / "_analysis"
    am, inv_path = a / "analysis.md", a / "inventory.json"
    if not am.is_file():
        return _result([_problem("NO_ANALYSIS", "no analysis.md: run `dfp.sh analyze` first")])
    if not inv_path.is_file():
        return _result([_problem("NO_ANALYSIS", "no inventory.json next to analysis.md: re-run `dfp.sh analyze`")])
    parsed = analysis_md.parse_analysis_md(am.read_text(encoding="utf-8"))
    if not parsed["approved"]:
        return _result([_problem("NOT_APPROVED", "Approved is \"no\" · analysis.md still says `Approved: no` · "
                                                 "the user approves by writing a date and name")])
    problems = []
    if parsed["errors"]:
        e = parsed["errors"][0]
        problems.append(_problem("MALFORMED_ROW", "%d malformed row(s); first: line %d (after %s): %s · keep "
                                 "`- [x] ID | value | label | status | evidence`" % (
                                     len(parsed["errors"]), e["line"], e.get("after") or "the top", e["message"]),
                                 errors=parsed["errors"]))
    if not parsed["medium"]:
        problems.append(_problem("NO_MEDIUM", "the `Medium:` line is empty; name at least one of: " + ", ".join(MEDIA)))
    bad = [m for m in parsed["medium"] if m not in MEDIA]
    if bad:
        problems.append(_problem("BAD_MEDIUM", "unknown medium %s (one of %s)" % (", ".join(bad), ", ".join(MEDIA))))
    if parsed["targets_present"]:
        targets = parsed["targets"]
    else:
        targets = [m for m in parsed["medium"] if m in TARGETS]                 # a round-1 file: the source medium alone
    bad_t = [t for t in targets if t not in TARGETS]
    if bad_t or (parsed["targets_present"] and not targets):
        what = ("unknown " + ", ".join('"%s"' % t for t in bad_t)) if bad_t else "no target named"
        problems.append(_problem("BAD_TARGET", "Target media: %s · line %s · valid: %s" % (
            what, parsed.get("targets_line") or "?", ", ".join(TARGETS))))
        targets = [t for t in targets if t in TARGETS]
    inv_doc = json.loads(inv_path.read_text(encoding="utf-8"))
    inv = {i["id"]: i for i in inv_doc.get("items", [])}
    rows = {r["id"]: r for r in parsed["items"]}

    def new_ok(row):
        i = row["id"]
        if i.startswith("U-") or i.startswith("ADP-"):
            return True
        return i.startswith("CMP-") and _is_found_vision(row)
    unknown = [i for i, r in rows.items() if i not in inv and not new_ok(r)]
    if unknown:
        problems.append(_problem("UNKNOWN_ID", "ids not in inventory.json (new rows may only be U-NNN, ADP-NNN citing `adapted-from:`, "
                                 "or CMP-NNN with `found: vision`): " + _ids_msg(sorted(unknown)), ids=sorted(unknown)))
    bad_adp = []
    for i, r in rows.items():
        if i.startswith("ADP-") and (r["status"].strip().lower() != "inferred" or "adapted-from:" not in r["evidence"]):
            bad_adp.append(i)
    if bad_adp:
        problems.append(_problem("BAD_ADAPTATION", "adaptation rows must be status `inferred` and cite `adapted-from: <ids>` in the "
                                 "evidence: " + _ids_msg(sorted(bad_adp)), ids=sorted(bad_adp)))
    # unclaimed regions: named, merged, or unticked
    unresolved = []
    for i, r in rows.items():
        if i.startswith("UNC-") and r["keep"] and _unnamed(r) and not r.get("merge"):
            unresolved.append(i)
    for i, r in rows.items():
        if i.startswith("UNC-") and r["keep"] and r.get("merge") and r["merge"] not in rows and r["merge"] not in inv:
            unresolved.append(i)
    unresolved = sorted(set(unresolved))
    if unresolved:
        problems.append(_problem("UNRESOLVED_UNC", "%d UNC rows are still unassigned: %s · Unclaimed · name, merge or untick each" % (
            len(unresolved), _ids_msg(unresolved)), ids=unresolved))
    pending = [v["page"] for v in parsed["vision"] if v["result"].strip().lower().startswith(("pending", "failed")) or not v["result"].strip()]
    if pending:
        problems.append(_problem("VISION_PENDING", "vision pass pending on pages %s · Vision pass · view renders/overlay-NNN.png and "
                                 "record the result (or run `render --pages ...`)" % ", ".join(str(p) for p in pending[:20])
                                 + (" ..." if len(pending) > 20 else ""), pages=pending))
    unnamed = sorted(i for i, r in rows.items() if i.startswith("CMP-") and r["keep"] and _unnamed(r))
    if unnamed:
        problems.append(_problem("UNIDENTIFIED_CMP", "%d components have no name: %s · Components · give a name or untick" % (
            len(unnamed), _ids_msg(unnamed)), ids=unnamed))

    # ---- build the approved item list
    drop_inferred = parsed["inferred_policy"] == "drop"
    items = []
    for iid, base in inv.items():
        row = rows.get(iid)
        item = dict(base)
        item["original_value"] = base["value"]
        if row is None:                                   # line deleted = dropped
            item.update(keep=False, edited=False, removed=True)
        else:
            item.update(keep=row["keep"], value=row["value"], label=row["label"], evidence=row["evidence"])
            item["edited"] = str(row["value"]).strip() != str(base["value"]).strip()
            for k in ("usage", "merge", "split"):
                if row.get(k):
                    item[k] = row[k]
        if drop_inferred and base.get("status") == "inferred":
            item["keep"] = False
        if iid.startswith("ADP-") and base.get("target") and base["target"] not in targets:
            item["keep"] = False                          # an adaptation follows its target
        if iid.startswith("UNC-") and row is not None and row.get("merge"):
            item["merged_into"] = row["merge"]
        items.append(item)
    for iid, row in rows.items():
        if iid in inv:
            continue
        if iid.startswith("ADP-"):
            m = re.search(r"confidence[:\s]+(low|medium|high)", row["evidence"], re.I)
            src = re.search(r"adapted-from:\s*([A-Z0-9, -]+?)(?:;|$)", row["evidence"])
            item = {"id": iid, "category": slugify(row["label"]) or "adaptation", "label": row["label"], "value": row["value"],
                    "status": "inferred", "evidence": row["evidence"], "keep": row["keep"], "edited": False,
                    "original_value": None, "confidence": m.group(1).lower() if m else "low", "reasoning": row["evidence"],
                    "adapted_from": analysis_md.IDS.findall(src.group(1)) if src else [], "target": None}
        elif iid.startswith("CMP-"):
            item = {"id": iid, "category": "CMP", "label": row["label"], "value": row["value"], "status": "observed",
                    "evidence": row["evidence"], "keep": row["keep"], "edited": False, "original_value": None,
                    "found": "vision", "cluster": None}
        else:
            cat = guess_category(row["value"])
            item = {"id": iid, "category": cat, "label": row["label"], "value": row["value"], "status": "user",
                    "evidence": row["evidence"], "keep": row["keep"], "edited": False, "original_value": None}
            if str(row["status"]).strip().lower() == "inferred":     # an inferred addition made during the review
                m = re.search(r"confidence[:\s]+(low|medium|high)", row["evidence"], re.I)
                item.update(status="inferred", confidence=m.group(1).lower() if m else "low", reasoning=row["evidence"])
        for k in ("usage", "merge", "split"):
            if row.get(k):
                item[k] = row[k]
        items.append(item)
    by = {i["id"]: i for i in items}
    # ---- targets vs the rows that survive (observed source rows are evidence and are never judged here, D24)
    try:
        app = medium_mod.applicability_for([m for m in parsed["medium"] if m in MEDIA], targets)
    except ValueError:
        app = None
    if app is not None:
        applicable = set(app["applicable"])
        invalid = []
        for i in items:
            if not i["keep"] or i["status"] not in ("inferred", "user"):
                continue
            if not (i["id"].startswith("ADP-") or i["id"].startswith("CMP-")):
                continue
            cat = i["category"] if i["id"].startswith("ADP-") else slugify(i["label"])
            if cat in medium_mod.CATEGORIES and cat not in applicable:
                invalid.append((i["id"], i["label"]))
        if invalid:
            problems.append(_problem("INVALID_FOR_TARGETS", "%s · enabled targets: %s · add a web target to Target media or untick %s" % (
                "; ".join('component "%s" (%s) needs a target that has it' % (lab, iid) for iid, lab in invalid[:SHOW]),
                ", ".join(targets) or "none", ", ".join(i for i, _ in invalid[:SHOW])), ids=[i for i, _ in invalid]))
    # ---- fragments follow their parent
    fragments = []
    for iid, it in by.items():
        cmp_inv = inv.get(iid)
        if not cmp_inv or not cmp_inv.get("absorbed"):
            continue
        split = set(it.get("split") or [])
        for fid in cmp_inv["absorbed"]:
            standalone = fid in split
            fragments.append({"id": fid, "parent": iid, "keep": bool(it["keep"] or standalone), "standalone": standalone})
    if problems:
        return _result(problems)
    approved = {
        "approved_by": parsed["approved_by"] or "unknown",
        "approved_at": parsed["approved_at"] or datetime.date.today().isoformat(),
        "medium": parsed["medium"],
        "targets": targets,
        "items": items,
        "fragments": fragments,
    }
    out = a / "approved.json"
    out.write_text(json.dumps(approved, indent=2, ensure_ascii=False) + "\n", encoding="utf-8")
    kept = sum(1 for i in items if i["keep"])
    return _result([], approved_json=str(out), medium=parsed["medium"], targets=targets, kept=kept, dropped=len(items) - kept)
