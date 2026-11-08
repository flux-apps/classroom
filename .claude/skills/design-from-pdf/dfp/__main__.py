"""dfp command line.  python -m dfp <command> ...   (normally via dfp.sh)

  probe <pdf>                          facts about the PDF (JSON)
  analyze <pdf> --ds <dir> [--force]   probe + extract + cluster + structure + coverage + usage + inventory + renders,
                                       crops, overlays -> <dir>/_analysis/ (no page limit, no sampling)
  render <ds> [--pages 7,8]            re-render the overlay PNGs
  gate <ds>                            approval gate: analysis.md -> approved.json
  scaffold <ds>                        tokens, styles.css, provenance, manifest skeleton, preview runtime
  validate <ds>                        structural checks on the finished design system
  verify <ds> --pdf <pdf>              token fidelity + PDF | design-system pairs
  crop <pdf> --page N --bbox x0,y0,x1,y1 --out <png>   copy a brand mark out of the PDF (never redrawn; <= 512 px)

Exit codes: 0 ok | 2 usage | 3 blocked (encrypted/unreadable PDF, deps, missing runtime) | 4 gate not satisfied |
5 validation / token mismatch.  JSON goes to stdout; progress and reasons to stderr.
"""
from __future__ import annotations

import argparse
import hashlib
import json
import sys
from pathlib import Path


def _setup_streams():
    for s in (sys.stdout, sys.stderr):
        try:
            s.reconfigure(errors="backslashreplace")
        except Exception:
            pass


def _out(obj):
    sys.stdout.write(json.dumps(obj, indent=2, ensure_ascii=True) + "\n")
    sys.stdout.flush()


def _err(msg):
    sys.stderr.write(msg + "\n")
    sys.stderr.flush()


def _write(path, text):
    path = Path(path)
    path.parent.mkdir(parents=True, exist_ok=True)
    with open(str(path), "w", encoding="utf-8", newline="\n") as fh:
        fh.write(text)


def _write_json(path, obj):
    _write(path, json.dumps(obj, indent=2, ensure_ascii=False) + "\n")


def _sha(text):
    return hashlib.sha256(text.encode("utf-8")).hexdigest()


# ----------------------------------------------------------------------------- commands
def cmd_probe(a):
    from .probe import PdfBlocked, probe_pdf
    try:
        _out(probe_pdf(a.pdf))
    except PdfBlocked as e:
        _err("blocked: %s" % e)
        _out({"ok": False, "blocked": e.code, "message": e.message})
        return 3
    return 0


def _clock(sec):
    sec = int(round(sec))
    return "%02d:%02d" % (sec // 60, sec % 60)


def _pending_approval(text):
    from .analysis_md import parse_analysis_md
    return parse_analysis_md(text)["approved"]


def cmd_analyze(a):
    import os
    import time
    from . import analysis_md, pipeline
    from .pdfio import PdfBlocked
    from .scaffold import ensure_analysis_gitignore

    t0 = time.time()
    pdf = Path(a.pdf).resolve()
    ds = Path(a.ds).resolve()
    an = ds / "_analysis"
    am_path, stamp = an / "analysis.md", an / ".analysis.sha256"
    backup = False
    if am_path.is_file():
        current = am_path.read_text(encoding="utf-8")
        edited = (not stamp.is_file()) or stamp.read_text(encoding="utf-8").strip() != _sha(current)
        approved = _pending_approval(current)
        if (edited or approved) and not a.force:
            _err("analyze REFUSED (exit 2): %s has %s" % (am_path, "an approval line set" if approved and not edited else
                                                           "been edited" + (" and carries an approval" if approved else "")))
            _err("re-run with --force to overwrite; your file would be saved as analysis.prev.md first")
            return 2
        backup = (edited or approved)

    def say(msg):
        _err(msg)

    try:
        model = pipeline.analyze(pdf, an, dpi=a.dpi, say=say, threshold=a.threshold / 100.0)
    except PdfBlocked as e:
        _err("analyze FAILED (exit 3): probe: %s" % e)
        _err("no analysis.md written")
        _out({"ok": False, "blocked": e.code, "message": e.message})
        return 3
    say("[9/%d] write analysis.md" % pipeline.STAGES)
    if backup:
        shutil_copy = __import__("shutil").copyfile
        shutil_copy(str(am_path), str(an / "analysis.prev.md"))
    pr, inv, cov, st = model["probe"], model["inventory"], model["coverage"], model["structure"]
    _write_json(an / "probe.json", pr)
    _write_json(an / "extract.json", model["extract"])
    _write_json(an / "clusters.json", model["clusters"])
    _write_json(an / "medium.json", model["medium"])
    _write_json(an / "structure.json", st)
    _write_json(an / "coverage.json", cov)
    _write_json(an / "usage.json", model["usage"])
    _write_json(an / "inventory.json", inv)
    _write_json(an / "meta.json", {"pdf": str(pdf), "dpi": a.dpi, "targets": model["targets"], "threshold": model["threshold"]})
    text = pipeline.render_md(model, pdf.name)
    tmp = an / "analysis.md.tmp"
    _write(tmp, text)
    os.replace(str(tmp), str(am_path))                       # written once, atomically, when complete
    _write(stamp, _sha(text) + "\n")
    _write(an / ".gitignore", "renders/\nverify/\n")
    ensure_analysis_gitignore(ds)
    stale = an / "approved.json"
    if stale.is_file():
        stale.unlink()                                       # a new analysis invalidates an old approval
    unc, cmp_n, low = pipeline.needs_you(inv)
    cmps = [i for i in inv["items"] if i["id"].startswith("CMP-")]
    occ = sum(c["occurrences"] for c in model["clusters"] if not c.get("parent"))
    cp = cov["overall"]["claimed_pct"]
    elapsed = time.time() - t0
    unc_auto = len(inv.get("dismissed", []))
    proposed = ",".join(model["medium"]["proposed"])
    lines = ["analyze: %s · %d pp · %s · medium %s · targets %s" % (pdf.name, pr["pages"], pr["pdf_type"], proposed,
                                                                  ",".join(model["targets"])),
             ("CMP %d (n=%d occ.) · STR %d · TPL %d · UNC %d actionable / %d auto-dismissed · coverage %s" % (
                 len(cmps), occ, len([i for i in inv["items"] if i["id"].startswith("STR-")]), len(inv.get("templates", [])), unc, unc_auto,
                 "%s %%" % cp if cp is not None else "n/a")),
             "vision pass: 0/%d pages" % pr["pages"],
             "needs you: %d UNC · %d unidentified CMP · %d low-confidence -> %s" % (unc, cmp_n, low, am_path),
             "next: edit it, set `Approved:`, run the skill again"]
    if pr["pdf_type"] == "raster":
        lines.insert(3, "note: raster input, no measured values; structure and measures are `estimated` or `unknown`")
    lines.append("elapsed %s" % _clock(elapsed))
    for ln in lines:
        _err(ln)
    _out({"ok": True, "analysis": str(am_path), "pdf_type": pr["pdf_type"], "strategy": pr["strategy"],
          "medium_proposed": model["medium"]["proposed"], "items": len(inv["items"]), "clusters": len(model["clusters"]),
          "structure": len(st["elements"]), "templates": len(st["templates"]), "unc_actionable": unc, "unc_auto": unc_auto,
          "coverage_pct": cp, "renders": model["renders"], "crops": model["crops"], "overlays": model["overlays"],
          "elapsed_s": round(elapsed, 1), "peak_memory_mb": model["peak_memory_mb"]})
    return 0


def cmd_render(a):
    import json as _json
    from . import pipeline, render
    from .pdfio import PdfBlocked
    ds = Path(a.ds).resolve()
    an = ds / "_analysis"
    meta_path = an / "meta.json"
    if not meta_path.is_file() and not a.pdf:
        _err("blocked: no _analysis/meta.json: run `dfp.sh analyze` first (or pass --pdf)")
        _out({"ok": False, "blocked": "NO_ANALYSIS", "message": "no _analysis/meta.json"})
        return 3
    pdf = Path(a.pdf).resolve() if a.pdf else Path(_json.loads(meta_path.read_text(encoding="utf-8"))["pdf"])
    try:
        pages = [int(p) for p in a.pages.split(",") if p.strip()] if a.pages else None
    except ValueError:
        _err("usage: --pages needs page numbers like 7,8")
        return 2

    def load(name, default):
        p = an / name
        return _json.loads(p.read_text(encoding="utf-8")) if p.is_file() else default
    clusters, inv, st, cov = load("clusters.json", []), load("inventory.json", {}), load("structure.json", {}), load("coverage.json", {})
    from .pdfio import open_pdf
    try:
        with open_pdf(pdf) as d:
            sizes = {n + 1: (d.page_rect(n).width, d.page_rect(n).height) for n in range(d.pages)}
        boxes = pipeline.overlay_boxes(clusters, inv, st, cov, sizes)
        paths = render.render_overlays(pdf, an / "renders", boxes, pages=pages)
    except PdfBlocked as e:
        _err("blocked: %s" % e)
        return 3
    _out({"ok": True, "overlays": [str(p) for p in paths]})
    return 0


def cmd_gate(a):
    from .gate import check_gate
    r = check_gate(Path(a.ds).resolve())
    _out(r)
    if not r["ok"]:
        for p in r["problems"]:
            _err("%s: %s" % (p["reason"], p["message"]))
        if len(r["problems"]) > 1:
            _err("gate: FAIL (%d problems)" % len(r["problems"]))
        return 4
    _err("gate: pass")
    return 0


def cmd_scaffold(a):
    from .scaffold import Blocked, scaffold
    try:
        r = scaffold(Path(a.ds).resolve(), a.preview_js)
    except FileNotFoundError as e:
        _err("gate: NOT_APPROVED - %s" % e)
        _out({"ok": False, "reason": "NOT_APPROVED", "message": str(e)})
        return 4
    except Blocked as e:
        _err(str(e))
        _out({"ok": False, "blocked": "PREVIEW_RUNTIME", "message": str(e)})
        return 3
    _out(r)
    for w in r["warnings"]:
        _err("warning: " + w)
    return 0


def cmd_validate(a):
    from .validate import validate_ds
    v = validate_ds(Path(a.ds).resolve())
    _out({"ok": not v, "violations": v})
    for x in v:
        _err("%s %s: %s" % (x["code"], x["path"], x["message"]))
    return 5 if v else 0


def cmd_verify(a):
    from . import verify
    pdf = Path(a.pdf).resolve()
    if not pdf.is_file():
        _err("blocked: PDF not found: %s" % pdf)
        _out({"ok": False, "blocked": "PDF_MISSING", "message": "PDF not found: %s" % pdf})
        return 3
    shoot = None
    browser = verify.find_browser()
    if browser:
        shoot = verify.browser_shooter(browser)
    try:
        rep = verify.verify_ds(Path(a.ds).resolve(), pdf, shoot=shoot)
    except FileNotFoundError as e:
        _err("gate: %s" % e)
        _out({"ok": False, "reason": "NOT_APPROVED", "message": str(e)})
        return 4
    _out(rep)
    t = rep["tokens"]
    if rep["visual"] == "skipped":
        _err("visual check skipped: %s" % rep.get("reason", ""))
    if t["mismatches"] or t["missing"]:
        _err("token fidelity: %d mismatched, %d missing" % (len(t["mismatches"]), len(t["missing"])))
        return 5
    return 0


def cmd_crop(a):
    from . import render
    from .pdfio import PdfBlocked
    try:
        x0, y0, x1, y1 = [float(v) for v in a.bbox.split(",")]
    except ValueError:
        _err("usage: --bbox needs four numbers x0,y0,x1,y1 (PDF points)")
        return 2
    longest = max(x1 - x0, y1 - y0)
    if longest <= 0:
        _err("usage: empty --bbox")
        return 2
    dpi = max(36, min(300, int(512 * 72 / longest)))          # brand marks only: longest side <= 512 px
    try:
        out = render.crop(Path(a.pdf).resolve(), a.page, (x0, y0, x1, y1), Path(a.out).resolve(), dpi=dpi)
    except PdfBlocked as e:
        _err("blocked: %s" % e)
        return 3
    except ValueError as e:
        _err("usage: %s" % e)
        return 2
    from PIL import Image
    with Image.open(str(out)) as im:
        size = list(im.size)
    _out({"ok": True, "path": str(out), "size": size, "dpi": dpi})
    return 0


def main(argv=None):
    _setup_streams()
    ap = argparse.ArgumentParser(prog="dfp", description="PDF facts for the design-from-pdf skill")
    sub = ap.add_subparsers(dest="cmd", metavar="command")
    sub.required = True
    p = sub.add_parser("probe")
    p.add_argument("pdf")
    p.set_defaults(fn=cmd_probe)
    p = sub.add_parser("analyze")
    p.add_argument("pdf")
    p.add_argument("--ds", default="design-system", help="design-system directory (default ./design-system)")
    p.add_argument("--force", action="store_true", help="overwrite an analysis.md that was edited")
    p.add_argument("--dpi", type=int, default=96, help="page render resolution")
    p.add_argument("--threshold", type=float, default=0.1, help="Unclaimed threshold, percent of the page (default 0.1)")
    p.set_defaults(fn=cmd_analyze)
    p = sub.add_parser("render", help="re-render the overlay PNGs (only the named pages when given)")
    p.add_argument("ds")
    p.add_argument("--pages", default=None, help="comma-separated 1-based pages, e.g. 7,8")
    p.add_argument("--pdf", default=None, help="source PDF (default: the one analyze recorded)")
    p.set_defaults(fn=cmd_render)
    for name, fn in (("gate", cmd_gate), ("scaffold", cmd_scaffold), ("validate", cmd_validate), ("verify", cmd_verify)):
        p = sub.add_parser(name)
        p.add_argument("ds")
        if name == "scaffold":
            p.add_argument("--preview-js", default=None, help="ds-preview.js to copy (default: bundled, or $DFP_PREVIEW_JS)")
        if name == "verify":
            p.add_argument("--pdf", required=True)
        p.set_defaults(fn=fn)
    p = sub.add_parser("crop")
    p.add_argument("pdf")
    p.add_argument("--page", type=int, required=True, help="1-based page")
    p.add_argument("--bbox", required=True, help="x0,y0,x1,y1 in PDF points (from clusters.json samples)")
    p.add_argument("--out", required=True)
    p.set_defaults(fn=cmd_crop)
    args = ap.parse_args(argv)
    return args.fn(args)


if __name__ == "__main__":
    sys.exit(main())
