"""Shared test fixtures for design-from-pdf. Depends only on pymupdf + stdlib — never on `dfp`.

Synthetic PDFs have KNOWN ground truth (documented per builder) so extraction tests assert exact values.
`mod()` imports `dfp` modules lazily so a missing module fails one test, not the whole file.
"""
import importlib
import json
import os
import subprocess
import sys
import unittest
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parent.parent          # tests/ lives at the project root
SKILL_DIR = REPO_ROOT / ".claude" / "skills" / "design-from-pdf"   # production output only

INK = "#231F20"
GREEN = "#8DC63F"
RED = "#D2232A"
YELLOW = "#F8C703"
TINT = "#EBF4DE"


def mod(name):
    return importlib.import_module(name)


def rgb(hexstr):
    h = hexstr.lstrip("#")
    return tuple(int(h[i:i + 2], 16) / 255 for i in (0, 2, 4))


def _pm():
    return importlib.import_module("pymupdf")


# --------------------------------------------------------------------------- PDF builders
def _draw_textbook_page(page, n, extra_yellow=False, big_rect=False):
    """Ground truth per page: heading 24pt Helvetica-Bold INK; 3 body lines 10.5pt Helvetica INK at 14pt
    leading; a 120x50 rounded callout fill GREEN (x shifts per page); 2 red dots r=4; one 1.5pt INK rule;
    footer 8pt text 'UNIDAD 1 - pagina N' at y=810 (page h=842)."""
    pm = _pm()
    page.insert_text((50, 70), "Heading %d" % n, fontsize=24, fontname="hebo", color=rgb(INK))
    for i in range(3):
        page.insert_text((50, 120 + 14 * i), "Body line %d on page %d" % (i, n), fontsize=10.5,
                         fontname="helv", color=rgb(INK))
    sh = page.new_shape()
    sh.draw_rect(pm.Rect(200 + 20 * n, 300, 320 + 20 * n, 350), radius=0.2)
    sh.finish(fill=rgb(GREEN), color=None)
    if extra_yellow:
        sh.draw_rect(pm.Rect(60, 500, 180, 550), radius=0.2)
        sh.finish(fill=rgb(YELLOW), color=None)
    for k in range(2):
        sh.draw_circle(pm.Point(80 + 30 * k, 400 + 10 * n), 4)
        sh.finish(fill=rgb(RED), color=None)
    sh.draw_line(pm.Point(50, 600), pm.Point(545, 600))
    sh.finish(width=1.5, color=rgb(INK))
    if big_rect:
        sh.draw_rect(pm.Rect(50, 650, 350, 850 - 50))
        sh.finish(fill=rgb(TINT), color=None)
    sh.commit()
    page.insert_text((50, 810), "UNIDAD 1 - pagina %d" % n, fontsize=8, fontname="helv", color=rgb(INK))


def make_vector_pdf(path, pages=3):
    """3 pages 595x842, text+vector, one bookmark. Callout cluster: 120x50 rounded GREEN on every page
    (+ one YELLOW on page 3 = same geometry, variant colour). Red dots: 2 per page. Big TINT rect: page 1 only."""
    pm = _pm()
    doc = pm.open()
    for n in range(1, pages + 1):
        page = doc.new_page(width=595, height=842)
        _draw_textbook_page(page, n, extra_yellow=(n == 3), big_rect=(n == 1))
    doc.set_toc([[1, "Inicio", 1]])
    doc.set_metadata({"producer": "DFP fixtures", "creator": "DFP creator"})
    doc.save(str(path))
    doc.close()
    return Path(path)


def make_raster_pdf(path, pages=2):
    """Pages are ONE full-page PNG each (the vector textbook rendered at 72dpi). No text layer, no bookmarks.
    Dominant raster colours include GREEN and RED."""
    pm = _pm()
    src = pm.open()
    for n in range(1, pages + 1):
        _draw_textbook_page(src.new_page(width=595, height=842), n)
    out = pm.open()
    for p in src:
        png = p.get_pixmap(dpi=72).tobytes("png")
        page = out.new_page(width=595, height=842)
        page.insert_image(page.rect, stream=png)
    out.save(str(path))
    return Path(path)


def make_mixed_pdf(path):
    """Page 1 vector+text, page 2 full-page raster."""
    pm = _pm()
    doc = pm.open()
    _draw_textbook_page(doc.new_page(width=595, height=842), 1)
    tmp = pm.open()
    _draw_textbook_page(tmp.new_page(width=595, height=842), 2)
    png = tmp[0].get_pixmap(dpi=72).tobytes("png")
    page = doc.new_page(width=595, height=842)
    page.insert_image(page.rect, stream=png)
    doc.save(str(path))
    return Path(path)


def make_deck_pdf(path):
    """3 landscape 16:9 pages 960x540, big sparse type (44pt title, 20pt subtitle), brand rect, no footer/toc."""
    pm = _pm()
    doc = pm.open()
    for n in range(1, 4):
        page = doc.new_page(width=960, height=540)
        page.insert_text((80, 200), "Quarterly Review %d" % n, fontsize=44, fontname="hebo", color=rgb(INK))
        page.insert_text((80, 260), "Subtitle", fontsize=20, fontname="helv", color=rgb(INK))
        sh = page.new_shape()
        sh.draw_rect(pm.Rect(0, 480, 960, 540))
        sh.finish(fill=rgb("#2F5C93"), color=None)
        sh.commit()
    doc.save(str(path))
    return Path(path)


def make_encrypted_pdf(path, pw="secret"):
    pm = _pm()
    doc = pm.open()
    doc.new_page().insert_text((50, 70), "hidden", fontsize=12)
    doc.save(str(path), encryption=pm.PDF_ENCRYPT_AES_256, user_pw=pw, owner_pw=pw)
    return Path(path)


# --------------------------------------------------------------------------- golden PDF
def golden_pdf():
    env = os.environ.get("DFP_GOLDEN_PDF")
    if env and Path(env).is_file():
        return Path(env)
    for pattern in (".tlk/features/*/examples/agencia4.pdf", ".tlk/archive/features/*/examples/agencia4.pdf"):
        hits = sorted(REPO_ROOT.glob(pattern))
        if hits:
            return hits[0]
    return None


class GoldenCase(unittest.TestCase):
    pdf = None

    @classmethod
    def setUpClass(cls):
        cls.pdf = golden_pdf()
        if cls.pdf is None:
            raise unittest.SkipTest("agencia4.pdf not present (set DFP_GOLDEN_PDF to enable golden tests)")


# --------------------------------------------------------------------------- CLI helper
def run_cli(*args, cwd=None, env=None, timeout=600):
    e = dict(os.environ)
    e["PYTHONPATH"] = str(SKILL_DIR) + os.pathsep + e.get("PYTHONPATH", "")   # `dfp` is not on the root path
    e.update(env or {})
    return subprocess.run([sys.executable, "-m", "dfp", *map(str, args)], cwd=str(cwd or SKILL_DIR),
                          capture_output=True, text=True, env=e, timeout=timeout)


# --------------------------------------------------------------------------- design-system fixtures
README_SECTIONS = ["Sources", "Index", "Components", "Intentional additions", "Content fundamentals",
                   "Visual foundations", "Iconography", "Layout & composition rules", "Substitutions & gaps"]


def _w(root, rel, text):
    p = Path(root) / rel
    p.parent.mkdir(parents=True, exist_ok=True)
    p.write_text(text, encoding="utf-8")
    return p


def make_valid_ds(root, medium=("publication-print",)):
    """A minimal design system that satisfies EVERY validator rule (zero violations expected)."""
    root = Path(root)
    _w(root, "styles.css", "@import url('./tokens/colors.css');\n")
    _w(root, "tokens/colors.css", ":root {\n  --color-ink: #231F20;\n}\n")
    _w(root, "provenance.json", json.dumps({
        "--color-ink": {"id": "COL-001", "status": "observed", "evidence": "p.1-3", "source": "pdf"}}))
    _w(root, "guidelines/colors.card.html",
       '<!-- @dsCard group="Colors" viewport="700x150" name="Ink" subtitle="text ink" -->\n<div></div>\n')
    _w(root, "components/page/Folio.jsx", "export function Folio(props) { return null; }\n")
    _w(root, "components/page/Folio.d.ts", "export interface FolioProps {}\n")
    _w(root, "components/page/Folio.prompt.md",
       "Running footer.\n\n## Usage & composition\n- Overlap: none. Rotation: 0. Anchor: margin. Max per page: 1.\n"
       "- Evidence: p.1-3 (observed); rules are inferred, confidence high\n")
    _w(root, "guidelines/composition.card.html",
       '<!-- @dsCard group="Guidelines" viewport="700x300" name="Composition" subtitle="multi-instance rules" -->\n<div></div>\n')
    _w(root, "components/page/page.card.html",
       '<!-- @dsCard group="Components" viewport="700x150" name="Page" -->\n<div></div>\n')
    _w(root, "_ds_manifest.json", json.dumps({"namespace": "DS_test", "components": [
        {"name": "Folio", "sourcePath": "components/page/Folio.jsx"}]}))
    _w(root, "readme.md", "# Test Design System\n\n" + "\n\n".join("## " + s + "\n\ntext" for s in README_SECTIONS) + "\n")
    _w(root, "SKILL.md", "---\nname: test-design\ndescription: test\n---\nRead readme.md\n")
    _w(root, "assets/logo.svg", "<svg xmlns='http://www.w3.org/2000/svg' width='10' height='10'/>")
    _w(root, "_analysis/.gitignore", "renders/\nverify/\n")
    _w(root, "_analysis/verify.md", "# Verification\n\nVisual: performed\n\n- Folio | match | footer rule and folio number agree with crop\n")
    _w(root, "_analysis/approved.json", json.dumps({"approved_by": "t", "approved_at": "2026-11-05",
                                                    "medium": list(medium),
                                                    "targets": list(medium), "items": []}))
    return root


def make_analyzed_ds(tmp, pdf):
    """Run the real `analyze` CLI into tmp/ds and return the ds path."""
    ds = Path(tmp) / "ds"
    r = run_cli("analyze", pdf, "--ds", ds)
    if r.returncode != 0:
        raise AssertionError("analyze failed rc=%s\n%s\n%s" % (r.returncode, r.stdout, r.stderr))
    return ds
