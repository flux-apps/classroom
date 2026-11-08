"""AC22 The analysis pipeline: probe -> extract -> cluster -> structure -> coverage -> usage -> inventory -> renders,
crops, overlays -> analysis.md. Every stage walks the document one page at a time and keeps only small dicts (bbox,
attributes) between pages, so memory does not grow with the page count (A16); pixmaps are freed per page.
"""
from __future__ import annotations

import time
from pathlib import Path

from . import (adapt, analysis_md, cluster, coverage, extract, inventory, medium, probe, render, structure,
               usage)
from .util import peak_memory_mb

STAGES = 9


def _counter(say, label, total):
    """Progress callback: a `page k/T` line every page (<= 30 pages) or about every 5 %."""
    step = 1 if total <= 30 else max(1, total // 20)

    def tick(k, t=None):
        t = t or total
        if k == t or k % step == 0:
            say("      %s: page %d/%d" % (label, k, t))
    return tick


def overlay_boxes(clusters, inventory_doc, structure_doc, coverage_doc, page_sizes):
    """{page: [{id, kind, bbox, variant}]} for the overlay PNGs: CMP rows, STR elements, actionable UNC regions."""
    cmp_of = (inventory_doc or {}).get("cmp_of") or {}
    out = {}

    def put(page, **box):
        out.setdefault(page, []).append(box)
    for c in clusters or []:
        cid = cmp_of.get(c["id"])
        if not cid:
            continue
        for b in c.get("boxes", []):
            put(b[0], id=cid, kind="CMP", bbox=b[1:5], variant=None)
    for e in (structure_doc or {}).get("elements", []):
        if e["type"] == "page-frame":
            v = e["value"]
            for p in e["pages"]:
                w, h = page_sizes.get(p, (595.0, 842.0))
                put(p, id=e["id"], kind="STR", bbox=[v["left"], v["top"], w - v["right"], h - v["bottom"]], variant=None)
        for b in e.get("boxes", []):
            put(b[0], id=e["id"], kind="STR", bbox=b[1:5], variant=None)
    for u in (coverage_doc or {}).get("unclaimed", []):
        if u["tier"] == "actionable":
            put(u["page"], id=u["id"], kind="UNC", bbox=u["bbox"], variant=None)
    return out


def analyze(pdf, an_dir, dpi=96, say=lambda msg: None, targets=None, threshold=0.001):
    """Run the whole analysis; returns the model (plain dicts) and the paths written under `an_dir` (renders, crops,
    overlays). Raises pdfio.PdfBlocked for an encrypted or unreadable PDF. The JSON/markdown files are written by the caller."""
    t0 = time.time()
    pdf = Path(pdf)
    an = Path(an_dir)
    targets = list(targets or medium.DEFAULT_TARGETS)
    say("[1/%d] probe" % STAGES)
    pr = probe.probe_pdf(pdf)
    total = pr["pages"]
    say("[2/%d] extract colours, type, strokes, radii" % STAGES)
    ext = extract.extract_pdf(pdf)
    say("[3/%d] cluster repeated elements, composites included" % STAGES)
    cl = cluster.cluster_patterns(pdf, progress=_counter(say, "cluster", total))
    say("[4/%d] structure: frame, columns, rhythm, roles, templates" % STAGES)
    st = structure.detect_structure(pdf, clusters=cl, progress=_counter(say, "structure", total))
    say("[5/%d] coverage and unclaimed regions" % STAGES)
    cov = coverage.compute_coverage(pdf, cl, st, threshold=threshold, progress=_counter(say, "coverage", total))
    say("[6/%d] usage: overlap, rotation, spacing, anchoring" % STAGES)
    use = usage.measure_usage(pdf, cl, st)
    say("[7/%d] medium, adaptations and inventory" % STAGES)
    med = medium.detect_medium(pr, ext, cl)
    inv = inventory.build_inventory(pr, ext, cl, med, structure=st, coverage=cov, usage=use, targets=targets)
    say("[8/%d] render pages, crops and overlays" % STAGES)
    an.mkdir(parents=True, exist_ok=True)
    renders = render.render_pages(pdf, an / "renders", dpi=dpi, progress=_counter(say, "render", total))
    jobs = []
    top = {c["id"]: c for c in cl if c["id"] in (inv.get("cmp_of") or {})}
    for c in top.values():
        s = c["samples"][0]
        x0, y0, x1, y1 = s["bbox"]
        pad = 6
        jobs.append((c["id"], s["page"], (x0 - pad, y0 - pad, x1 + pad, y1 + pad), an / "crops" / ("%s.png" % c["id"])))
    for u in cov.get("unclaimed", []):
        if u["tier"] == "actionable":
            x0, y0, x1, y1 = u["bbox"]
            jobs.append((u["id"], u["page"], (x0 - 6, y0 - 6, x1 + 6, y1 + 6), an / "crops" / ("unc-%s.png" % u["id"].split("-")[1])))
    done = {str(p) for p in render.crop_many(pdf, [(j[1], j[2], j[3]) for j in jobs])}
    for cid, _, _, out in jobs:
        if cid in top:
            top[cid]["crop"] = "crops/%s.png" % cid if str(out) in done else None
    sizes = {}
    from .pdfio import open_pdf
    with open_pdf(pdf) as d:
        for n in range(d.pages):
            r = d.page_rect(n)
            sizes[n + 1] = (r.width, r.height)
    boxes = overlay_boxes(cl, inv, st, cov, sizes)
    overlays = render.render_overlays(pdf, an / "renders", boxes, progress=_counter(say, "overlay", total))
    model = {"probe": pr, "extract": ext, "clusters": cl, "structure": st, "coverage": cov, "usage": use, "medium": med,
             "inventory": inv, "targets": targets, "threshold": threshold, "renders": len(renders),
             "crops": len(done), "overlays": len(overlays)}
    model["elapsed_s"] = round(time.time() - t0, 1)
    model["peak_memory_mb"] = peak_memory_mb()
    return model


def needs_you(inv):
    items = inv.get("items", [])
    unc = len([i for i in items if i["id"].startswith("UNC-")])
    cmp_ = len([i for i in items if i["id"].startswith("CMP-")])
    low = len([i for i in items if i.get("status") == "inferred" and i.get("confidence") == "low"])
    return unc, cmp_, low


def render_md(model, pdf_name):
    return analysis_md.render_analysis_md(model["probe"], model["medium"], model["inventory"], pdf_name, model={
        "targets": model["targets"], "threshold": model["threshold"], "coverage": model["coverage"]})
