"""AC14 Output fidelity: does the produced design system reflect the source PDF?

Layer 1 token_fidelity   deterministic: every kept approved colour/type/space/radius/border token is in tokens/*.css
                         with the approved value (user edits win; dropped items are not required).
Layer 2 verify_ds        for each component that declares `source_clusters` in _ds_manifest.json: screenshot its
                         card with the system browser, crop the PDF region, write a PDF | design-system sheet for
                         Claude to LOOK at, plus a colour_drift tripwire. Fonts are substituted, so judge structure,
                         colour, proportion and spacing - not glyph shapes.
Layer 3 the verdict      Claude writes _analysis/verify.md; `validate` rejects missing, unresolved or undisclosed.
No browser / no network / a render error is a disclosed degrade (`visual: skipped` + reason), never silent.
"""
from __future__ import annotations

import functools
import http.server
import json
import math
import os
import re
import shutil
import subprocess
import tempfile
import threading
import time
from pathlib import Path

from . import render, scaffold

CHECKED = ("COL", "TYP", "SPC", "RAD", "BRD", "STR")
_DEF = re.compile(r"(--[\w-]+)\s*:\s*([^;]+);")
_COMMENT = re.compile(r"/\*.*?\*/", re.S)


# ----------------------------------------------------------------------------- layer 1
def _norm(v):
    return re.sub(r"\s+", "", str(v)).strip("'\"").lower()


def _css_tokens(ds):
    found = {}
    tdir = Path(ds) / "tokens"
    if tdir.is_dir():
        for f in sorted(tdir.glob("*.css")):
            for name, val in _DEF.findall(_COMMENT.sub("", f.read_text(encoding="utf-8", errors="replace"))):
                found[name] = val.strip()
    return found


def token_fidelity(ds):
    ap = Path(ds) / "_analysis" / "approved.json"
    if not ap.is_file():
        raise FileNotFoundError("no _analysis/approved.json: nothing to compare the tokens against")
    plan = scaffold.build_plan(json.loads(ap.read_text(encoding="utf-8")))
    found = _css_tokens(ds)
    checked = matched = 0
    mismatches, missing = [], []
    for rec in plan["tokens"]:
        if rec["category"] not in CHECKED:
            continue
        checked += 1
        got = found.get(rec["token"])
        if got is None:
            if rec["id"] not in missing:
                missing.append(rec["id"])
        elif _norm(got) == _norm(rec["value"]):
            matched += 1
        else:
            mismatches.append({"id": rec["id"], "token": rec["token"], "expected": rec["value"], "found": got})
    return {"checked": checked, "matched": matched, "mismatches": mismatches, "missing": missing}


# ----------------------------------------------------------------------------- layer 2 helpers
def _label_font(size=13):
    from PIL import ImageFont
    try:
        return ImageFont.load_default(size)
    except TypeError:                                  # Pillow < 10.1
        return ImageFont.load_default()


def compose_pair(pdf_png, ds_png, out_path, label):
    """PDF crop (left) | rendered component (right) under a label band. Large panes are scaled down to 900 px wide."""
    from PIL import Image, ImageDraw

    def load(p):
        im = Image.open(str(p)).convert("RGB")
        if im.width > 900:
            im = im.resize((900, max(1, int(im.height * 900.0 / im.width))))
        return im

    a, b = load(pdf_png), load(ds_png)
    band, gutter = 26, 10
    sheet = Image.new("RGB", (a.width + gutter + b.width, band + max(a.height, b.height)), (255, 255, 255))
    sheet.paste(a, (0, band))
    sheet.paste(b, (a.width + gutter, band))
    d = ImageDraw.Draw(sheet)
    d.rectangle([a.width, band, a.width + gutter - 1, sheet.height], fill=(210, 210, 210))
    d.text((6, 5), str(label), fill=(0, 0, 0), font=_label_font())
    out = Path(out_path)
    out.parent.mkdir(parents=True, exist_ok=True)
    sheet.save(str(out))
    return out


def _lab(rgb):
    def lin(c):
        c = c / 255.0
        return c / 12.92 if c <= 0.04045 else ((c + 0.055) / 1.055) ** 2.4
    r, g, b = (lin(c) for c in rgb)
    x = (0.4124 * r + 0.3576 * g + 0.1805 * b) / 0.95047
    y = 0.2126 * r + 0.7152 * g + 0.0722 * b
    z = (0.0193 * r + 0.1192 * g + 0.9505 * b) / 1.08883

    def f(t):
        return t ** (1 / 3.0) if t > 0.008856 else 7.787 * t + 16 / 116.0
    fx, fy, fz = f(x), f(y), f(z)
    return (116 * fy - 16, 500 * (fx - fy), 200 * (fy - fz))


def _palette(path, k=6):
    from PIL import Image
    im = Image.open(str(path)).convert("RGB")
    im.thumbnail((96, 96))
    q = im.quantize(colors=k, method=Image.Quantize.MEDIANCUT if hasattr(Image, "Quantize") else 0)
    pal = q.getpalette() or []
    out, total = [], float(im.width * im.height)
    for count, idx in q.getcolors() or []:
        out.append((count / total, _lab(tuple(pal[idx * 3: idx * 3 + 3]))))
    return out


def colour_drift(a_png, b_png):
    """Palette distance (mean CIE76 delta-E of each image's dominant colours to the other's nearest). 0 = same.
    A tripwire for Claude, not a verdict."""
    pa, pb = _palette(a_png), _palette(b_png)

    def one_way(x, y):
        return sum(w * min(math.dist(c, d) for _, d in y) for w, c in x)
    return round((one_way(pa, pb) + one_way(pb, pa)) / 2.0, 2)


def find_browser(env=None):
    """DFP_BROWSER if it exists, else a system Edge/Chrome/Chromium; None when there is none. Never raises."""
    env = os.environ if env is None else env
    try:
        explicit = (env.get("DFP_BROWSER") or "").strip()
        if explicit and Path(explicit).is_file():
            return explicit
        if (env.get("DFP_NO_BROWSER_SEARCH") or "").strip() in ("1", "true", "yes"):
            return None
        cands = []
        for var in ("ProgramFiles", "ProgramFiles(x86)", "LOCALAPPDATA"):
            base = env.get(var)
            if base:
                cands += [Path(base) / "Microsoft" / "Edge" / "Application" / "msedge.exe",
                          Path(base) / "Google" / "Chrome" / "Application" / "chrome.exe"]
        cands += [Path("/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"),
                  Path("/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge")]
        for c in cands:
            if c.is_file():
                return str(c)
        for name in ("msedge", "microsoft-edge", "google-chrome", "chrome", "chromium", "chromium-browser"):
            w = shutil.which(name)
            if w:
                return w
    except Exception:
        return None
    return None


def browser_shooter(browser):
    """shoot(url, out_png, size): headless screenshot of `url`; raises OSError when nothing usable was produced.
    A blank first frame (React/Babel/fonts still loading from a CDN) is retried once with a longer time budget."""
    def once(url, out, size, budget):
        with tempfile.TemporaryDirectory() as prof:
            cmd = [browser, "--headless=new", "--disable-gpu", "--hide-scrollbars", "--no-first-run",
                   "--no-default-browser-check", "--user-data-dir=%s" % prof,
                   "--window-size=%d,%d" % (size[0], size[1]), "--virtual-time-budget=%d" % budget,
                   "--screenshot=%s" % out, url]
            try:
                r = subprocess.run(cmd, capture_output=True, text=True, timeout=180)
            except subprocess.TimeoutExpired:
                raise OSError("browser timed out after 180 s")
        if not out.is_file():
            raise OSError("browser produced no screenshot (exit %s): %s" % (r.returncode, (r.stderr or "")[-200:].strip()))
        from PIL import Image
        with Image.open(str(out)) as im:
            lo, hi = im.convert("L").getextrema()
        return lo != hi

    def shoot(url, out_png, size):
        out = Path(out_png)
        out.parent.mkdir(parents=True, exist_ok=True)
        if out.is_file():
            out.unlink()
        if once(url, out, size, 20000):
            return
        out.unlink()
        if once(url, out, size, 60000):
            return
        raise OSError("blank render: the card drew nothing twice (React/Babel come from a CDN - is the network "
                      "reachable? does the card load _ds_preview.js and its components?)")
    return shoot


class _Quiet(http.server.SimpleHTTPRequestHandler):
    def log_message(self, *a):
        pass


def _serve(ds):
    handler = functools.partial(_Quiet, directory=str(ds))
    srv = http.server.ThreadingHTTPServer(("127.0.0.1", 0), handler)
    threading.Thread(target=srv.serve_forever, daemon=True).start()
    return srv


# ----------------------------------------------------------------------------- layer 2
def _load_clusters(ds):
    p = Path(ds) / "_analysis" / "clusters.json"
    if not p.is_file():
        return {}
    data = json.loads(p.read_text(encoding="utf-8"))
    if isinstance(data, dict):
        data = data.get("clusters", [])
    return {c["id"]: c for c in data if isinstance(c, dict) and "id" in c}


def _card_for(ds, comp):
    sp = comp.get("sourcePath")
    if not sp:
        return None
    d = (Path(ds) / sp).parent
    exact = d / (Path(sp).stem + ".card.html")
    if exact.is_file():
        return exact
    cards = sorted(d.glob("*.card.html"))
    return cards[0] if cards else None


def _viewport(card):
    try:
        first = card.read_text(encoding="utf-8", errors="replace").split("\n", 1)[0]
    except OSError:
        first = ""
    m = re.search(r'viewport="(\d+)x(\d+)"', first)
    return (int(m.group(1)), int(m.group(2))) if m else (700, 400)


def _safe(name):
    return re.sub(r"[^A-Za-z0-9_.-]+", "_", name) or "component"


def _load_usage(ds):
    p = Path(ds) / "_analysis" / "usage.json"
    if p.is_file():
        try:
            return json.loads(p.read_text(encoding="utf-8"))
        except ValueError:
            return {}
    return {}


def _needs_multi(usage):
    """Overlap or rotation evidence means the instances interact: a second pair shows several of them together."""
    if not usage or not usage.get("multi_sample"):
        return False
    ov = (usage.get("overlap") or {}).get("max") or 0
    rot = usage.get("rotation") or {}
    return bool(ov > 0 or rot.get("min") or rot.get("max"))


def verify_ds(ds, pdf, shoot=None):
    ds = Path(ds).resolve()                      # relative paths are resolved once, before the browser or any write
    pdf = Path(pdf).resolve()
    t_all = time.time()
    vdir = ds / "_analysis" / "verify"
    vdir.mkdir(parents=True, exist_ok=True)
    rep = {"tokens": token_fidelity(ds), "visual": "skipped", "pairs": [], "unpaired": [], "problems": [],
           "timing": {"per_card": [], "total_seconds": 0.0}}
    clusters = _load_clusters(ds)
    usage_json = _load_usage(ds)
    mp = ds / "_ds_manifest.json"
    comps = json.loads(mp.read_text(encoding="utf-8")).get("components", []) if mp.is_file() else []

    work = []
    for c in comps:
        name = c.get("name", "?")
        wanted = list(c.get("source_clusters") or [])
        if not wanted:
            rep["unpaired"].append(name)
            continue
        sample, use = None, None
        for cid in wanted:
            cl = clusters.get(cid)
            if cl and cl.get("samples"):
                sample = (cid, cl["samples"][0])
                use = cl.get("usage") or usage_json.get(cid)
                break
            rep["problems"].append("%s: source cluster %s not found in clusters.json" % (name, cid))
        card = _card_for(ds, c)
        if sample is None:
            rep["unpaired"].append(name)
        elif card is None:
            rep["unpaired"].append(name)
            rep["problems"].append("%s: no *.card.html next to %s" % (name, c.get("sourcePath")))
        else:
            work.append((name, wanted, sample[1], card, use))

    def finish():
        rep["timing"]["total_seconds"] = round(time.time() - t_all, 2)
        (vdir / "report.json").write_text(json.dumps(rep, indent=2, ensure_ascii=False) + "\n", encoding="utf-8")
        return rep

    if shoot is None:
        rep["reason"] = "no browser available (install Edge/Chrome or set DFP_BROWSER); token check still ran"
        return finish()
    if not work:
        rep["reason"] = "no component has a resolvable source_clusters entry plus a card to render"
        return finish()

    pairs, srv = [], _serve(ds)
    try:
        port = srv.server_address[1]
        shot_cache = {}

        def shot(card):
            rel = card.relative_to(ds).as_posix()
            if rel not in shot_cache:
                png = vdir / ("card-%s.png" % _safe(rel.replace("/", "_")))
                shoot("http://127.0.0.1:%d/%s" % (port, rel), png, _viewport(card))
                shot_cache[rel] = png
            return shot_cache[rel]
        comp_card = ds / "guidelines" / "composition.card.html"
        for name, wanted, sample, card, use in work:
            t0 = time.time()
            safe = _safe(name)
            ds_card = shot(card)
            x0, y0, x1, y1 = sample["bbox"]
            pad = 6
            crop_png = vdir / ("%s.pdf.png" % safe)
            render.crop(pdf, sample["page"], (x0 - pad, y0 - pad, x1 + pad, y1 + pad), crop_png)
            ds_png = vdir / ("%s.ds.png" % safe)
            shutil.copyfile(str(ds_card), str(ds_png))
            sheet = compose_pair(crop_png, ds_png, vdir / ("%s.png" % safe),
                                 "%s: PDF p.%d (%s) | design system" % (name, sample["page"], ", ".join(wanted)))
            pairs.append({"component": name, "source_clusters": wanted, "sheet": sheet.name, "kind": "single",
                          "colour_drift": float(colour_drift(crop_png, ds_png))})
            if _needs_multi(use):
                ms = use["multi_sample"]
                bx0, by0, bx1, by1 = ms["bbox"]
                mcrop = vdir / ("%s.multi.pdf.png" % safe)
                render.crop(pdf, ms["page"], (bx0 - pad, by0 - pad, bx1 + pad, by1 + pad), mcrop)
                mds = vdir / ("%s.multi.ds.png" % safe)
                shutil.copyfile(str(shot(comp_card) if comp_card.is_file() else ds_card), str(mds))
                msheet = compose_pair(mcrop, mds, vdir / ("%s-multi.png" % safe),
                                      "%s (multi-instance): PDF p.%d | design system" % (name, ms["page"]))
                pairs.append({"component": name, "source_clusters": wanted, "sheet": msheet.name, "kind": "multi-instance",
                              "colour_drift": float(colour_drift(mcrop, mds))})
            rep["timing"]["per_card"].append({"component": name, "seconds": round(time.time() - t0, 2)})
    except Exception as exc:
        rep["reason"] = "visual check failed: %s" % exc
        return finish()
    finally:
        srv.shutdown()
        srv.server_close()
    rep["pairs"] = pairs
    rep["visual"] = "performed"
    return finish()
