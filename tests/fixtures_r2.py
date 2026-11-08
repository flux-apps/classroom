"""Round-2 fixtures (spec DRAFT 5, AC16-AC22). Depends on pymupdf/Pillow + stdlib + tests.fixtures — never on `dfp`.

Every builder documents its GROUND TRUTH; tests assert those numbers, not implementation details.
Geometry notes shared by the composite fixtures:
  bubble(d)  = shadow circle (offset +3,+3, black @30 %) + anchor circle d x d + badge circle r=7 near the top-left
               corner (inside the anchor bbox) + one 10 pt text line inside the anchor.  Composite bbox = (d+3) x (d+3).
  "overlap" in the spec/tests = intersection area / area of the smaller bbox.
"""
import io
import json
import re
import unittest
from pathlib import Path

from tests import fixtures as fx
from tests.fixtures import INK, GREEN, TINT, rgb, _pm

BLUE = "#2F5C93"
MAGENTA = "#EC008C"
ORANGE = "#D96629"
PURPLE = "#8E278F"
TEAL = "#005F7E"
WHO = "2026-11-07 Tester"


# --------------------------------------------------------------------------- builders
def _bubble(page, x0, y0, d, fill=BLUE, text="Hola"):
    pm = _pm()
    sh = page.new_shape()
    sh.draw_circle(pm.Point(x0 + 3 + d / 2.0, y0 + 3 + d / 2.0), d / 2.0)
    sh.finish(fill=(0, 0, 0), fill_opacity=0.3, color=None)                 # shadow, drawn first
    sh.draw_circle(pm.Point(x0 + d / 2.0, y0 + d / 2.0), d / 2.0)
    sh.finish(fill=rgb(fill), color=None)                                   # anchor
    sh.draw_circle(pm.Point(x0 + 14, y0 + 14), 7)
    sh.finish(fill=rgb(ORANGE), color=None)                                 # badge
    sh.commit()
    page.insert_text((x0 + d * 0.3, y0 + d * 0.6), text, fontsize=10, fontname="helv", color=(1, 1, 1))


def _callout(page, x, y, n):
    pm = _pm()
    sh = page.new_shape()
    sh.draw_rect(pm.Rect(x, y, x + 120, y + 50), radius=0.2)
    sh.finish(fill=rgb(GREEN), color=None)
    sh.commit()
    page.insert_text((x + 14, y + 30), "Nota %d" % n, fontsize=10, fontname="helv", color=rgb(INK))


def _furniture(page, n):
    page.insert_text((50, 70), "Unidad %d" % n, fontsize=24, fontname="hebo", color=rgb(INK))
    for i in range(3):
        page.insert_text((50, 120 + 14 * i), "Linea de texto %d en la pagina %d" % (i, n), fontsize=10.5,
                         fontname="helv", color=rgb(INK))
    page.insert_text((50, 810), "UNIDAD 1 - pagina %d" % n, fontsize=8, fontname="helv", color=rgb(INK))


def make_composite_pdf(path):
    """3 pages 595x842. GROUND TRUTH
    bubbles: 6 in total = 3 x d90 (p1 x2 at x0=60,190 gap 37 pt; p3 x1 at 60) + 3 x d130 (p2 x2 at x0=100 and 206.4,
             overlap 0.20 of the composite bbox, B drawn after A; p3 x1 at 250). Fills BLUE x4, MAGENTA x2.
             One composite cluster, 2 size variants (90x90|130x130 -> variants attr `size`), absorbed shadow/badge/text.
    callout: green 120x50 rounded + text, one per page at (420,650) = a second composite cluster, 3 occurrences,
             on the same 3 pages as the bubbles (co-occurrence 3/3).
    unclaimed: p1 purple box (300,520)-(400,620) = 10 000 pt2 (2.0 % of 595x842), speck (100,700) 6x6 = 36 pt2.
    furniture: heading 24 bold, 3 body lines 10.5, footer 8 pt per page (claimed by structure / text bands)."""
    pm = _pm()
    doc = pm.open()
    for n in (1, 2, 3):
        pg = doc.new_page(width=595, height=842)
        _furniture(pg, n)
        _callout(pg, 420, 650, n)
        if n == 1:
            _bubble(pg, 60, 300, 90, BLUE, "Hola 1")
            _bubble(pg, 190, 300, 90, BLUE, "Hola 2")
            sh = pg.new_shape()
            sh.draw_rect(pm.Rect(300, 520, 400, 620))
            sh.finish(fill=rgb(PURPLE), color=None)
            sh.draw_rect(pm.Rect(100, 700, 106, 706))
            sh.finish(fill=rgb(ORANGE), color=None)
            sh.commit()
        elif n == 2:
            _bubble(pg, 100, 300, 130, BLUE, "Hola 3")
            _bubble(pg, 206.4, 300, 130, MAGENTA, "Hola 4")
        else:
            _bubble(pg, 60, 300, 90, BLUE, "Hola 5")
            _bubble(pg, 250, 300, 130, MAGENTA, "Hola 6")
    doc.save(str(path))
    doc.close()
    return Path(path)


def make_tab_pdf(path):
    """4 pages. A 40x140 TEAL side tab at y=300 with 90-degree text: left edge (x 0-40) on p1,p3, right edge (x 555-595)
    on p2,p4. GROUND TRUTH: one composite cluster, n=4, variants side {left:2,right:2}, rotation 90, anchor bleed."""
    pm = _pm()
    doc = pm.open()
    for n in (1, 2, 3, 4):
        pg = doc.new_page(width=595, height=842)
        x0 = 0 if n % 2 else 555
        sh = pg.new_shape()
        sh.draw_rect(pm.Rect(x0, 300, x0 + 40, 440))
        sh.finish(fill=rgb(TEAL), color=None)
        sh.commit()
        pg.insert_text((x0 + 26, 420), "Agencia", fontsize=11, rotate=90, fontname="helv", color=(1, 1, 1))
    doc.save(str(path))
    doc.close()
    return Path(path)


def make_many_rules_pdf(path, n=180):
    """2 pages, each with n horizontal rules at y=20+4i (never touching). Rule i: length 30+10*(i%30), width
    0.5+0.5*(i//30). GROUND TRUTH: n distinct rule clusters of 2 occurrences (30 lengths x 6 widths = 180 combos)."""
    pm = _pm()
    doc = pm.open()
    for _ in (1, 2):
        pg = doc.new_page(width=595, height=842)
        sh = pg.new_shape()
        for i in range(n):
            y = 20 + 4 * i
            sh.draw_line(pm.Point(50, y), pm.Point(50 + 30 + 10 * (i % 30), y))
            sh.finish(width=0.5 + 0.5 * (i // 30), color=rgb(INK))
        sh.commit()
    doc.save(str(path))
    doc.close()
    return Path(path)


_WORDS = "lorem ipsum dolor sit amet consectetur adipiscing elit sed do eiusmod tempor incididunt ut labore et dolore".split()


def _fit(i, width, size=10):
    pm = _pm()
    s, k = "", i
    while True:
        cand = (s + " " + _WORDS[k % len(_WORDS)]).strip()
        if pm.get_text_length(cand, fontname="helv", fontsize=size) > width:
            return s
        s, k = cand, k + 1


def make_structure_pdf(path):
    """5 pages 595x842. GROUND TRUTH (vector, so every value is `observed`)
    p1: heading 24 bold (baseline 84), rule x50-545 at y=92, subheading 14 bold, 40 body lines 10 pt at 14 pt leading,
        single column starting x=50, caption 8 pt italic at baseline 780.
    p2,p3: same furniture with heading 20 bold; body in TWO columns starting x=50 and x=315, each line <= 230 pt wide
        (so column 1 ends ~280, gutter ~35), 30 lines per column.
    p4: one full-bleed image (the whole page), no text.
    p5: heading 24 bold 'Tabla 1', a table grid: 6 horizontal rules y=200..400 step 40, 4 vertical rules x=50,215,380,545
        (5 rows x 3 columns), header row filled TINT, cell text 10 pt.
    Page frame (p1-p3): left 50 +-3, right 50 +-3, top 55-70, bottom 52-68.
    Text roles: heading-1 24, heading-2 20, heading-3 14, body 10, caption 8 italic.
    Templates: pages [[1],[2,3],[4],[5]]."""
    from PIL import Image
    pm = _pm()
    doc = pm.open()
    for n in (1, 2, 3):
        pg = doc.new_page(width=595, height=842)
        size = 24 if n == 1 else 20
        pg.insert_text((50, 84), "Capitulo %d" % n, fontsize=size, fontname="hebo", color=rgb(INK))
        sh = pg.new_shape()
        sh.draw_line(pm.Point(50, 92), pm.Point(545, 92))
        sh.finish(width=0.75, color=rgb(INK))
        sh.commit()
        pg.insert_text((50, 120), "Seccion %d" % n, fontsize=14, fontname="hebo", color=rgb(INK))
        if n == 1:
            for i in range(40):
                pg.insert_text((50, 150 + 14 * i), _fit(i, 480), fontsize=10, fontname="helv", color=rgb(INK))
        else:
            for i in range(30):
                pg.insert_text((50, 150 + 14 * i), _fit(i, 230), fontsize=10, fontname="helv", color=rgb(INK))
                pg.insert_text((315, 150 + 14 * i), _fit(i + 5, 230), fontsize=10, fontname="helv", color=rgb(INK))
        pg.insert_text((50, 780), "Fig. %d" % n, fontsize=8, fontname="heit", color=rgb(INK))
    pg = doc.new_page(width=595, height=842)
    buf = io.BytesIO()
    Image.linear_gradient("L").resize((60, 84)).convert("RGB").save(buf, "PNG")
    pg.insert_image(pg.rect, stream=buf.getvalue())
    pg = doc.new_page(width=595, height=842)
    pg.insert_text((50, 84), "Tabla 1", fontsize=24, fontname="hebo", color=rgb(INK))
    sh = pg.new_shape()
    sh.draw_rect(pm.Rect(50, 200, 545, 240))
    sh.finish(fill=rgb(TINT), color=None)
    for k in range(6):
        sh.draw_line(pm.Point(50, 200 + 40 * k), pm.Point(545, 200 + 40 * k))
        sh.finish(width=0.75, color=rgb(INK))
    for x in (50, 215, 380, 545):
        sh.draw_line(pm.Point(x, 200), pm.Point(x, 400))
        sh.finish(width=0.75, color=rgb(INK))
    sh.commit()
    for r in range(5):
        for c, x in enumerate((55, 220, 385)):
            pg.insert_text((x, 225 + 40 * r), "r%dc%d" % (r, c), fontsize=10, fontname="helv", color=rgb(INK))
    doc.save(str(path))
    doc.close()
    return Path(path)


def make_sparse_pdf(path):
    """1 page, two text lines in two UNIQUE styles (Helvetica 10 'Alpha unique' at (50,100); Times 13 'Beta unique' at
    (300,400)). GROUND TRUTH: no cluster, no text role (a style needs >= 2 lines) => 2 unclaimed text regions."""
    pm = _pm()
    doc = pm.open()
    pg = doc.new_page(width=595, height=842)
    pg.insert_text((50, 100), "Alpha unique", fontsize=10, fontname="helv", color=rgb(INK))
    pg.insert_text((300, 400), "Beta unique", fontsize=13, fontname="tiro", color=rgb(INK))
    doc.save(str(path))
    doc.close()
    return Path(path)


def make_flood_pdf(path, n=30):
    """1 page with n text lines, every one in a UNIQUE style (Helvetica, size 8.0 + 0.6*i). GROUND TRUTH: no cluster, no
    text role (a style needs >= 2 lines), n unclaimed text regions each >= 0.1 % of the page => n actionable UNC rows."""
    pm = _pm()
    doc = pm.open()
    pg = doc.new_page(width=595, height=842)
    for i in range(n):
        col, row = divmod(i, 15)
        pg.insert_text((40 + 280 * col, 60 + 50 * row), "Unclaimed sample %d" % i, fontsize=8 + 0.6 * i,
                       fontname="helv", color=rgb(INK))
    doc.save(str(path))
    doc.close()
    return Path(path)


# --------------------------------------------------------------------------- analysis.md helpers (text level)
ROW_RE = re.compile(r"^- \[(?P<k>[ xX])\]\s+(?P<id>[A-Z]{1,3}-\d{3})\s*\|", re.M)


def rows(text, prefix):
    out = []
    for l in text.splitlines():
        m = ROW_RE.match(l)
        if m and m.group("id").startswith(prefix + "-"):
            out.append(l)
    return out


def header(text, name):
    m = re.search(r"^%s:[ \t]*(.*)$" % re.escape(name), text, re.M)
    return m.group(1).strip() if m else None


def set_header(text, name, value):
    if re.search(r"^%s:" % re.escape(name), text, re.M):
        return re.sub(r"^%s:.*$" % re.escape(name), "%s: %s" % (name, value), text, count=1, flags=re.M)
    return re.sub(r"^(Medium:.*)$", r"\1\n%s: %s" % (name, value), text, count=1, flags=re.M)


def vision_lines(text):
    return [l for l in text.splitlines() if l.startswith("|") and "renders/overlay-" in l]


def resolve_checkpoint(text, who=WHO, keep_unc=False, keep_vision=False, keep_unnamed=False):
    """Turn a freshly analysed analysis.md into an approvable one. Tolerant: absent sections are no-ops, so round-1
    flows can use it too. Approve; untick every UNC row; vision pending -> `none missed`; name `(unnamed)` CMP rows."""
    text = re.sub(r"^Approved:.*$", "Approved: " + who, text, count=1, flags=re.M)
    out, k = [], 0
    for line in text.splitlines():
        m = ROW_RE.match(line)
        if m and m.group("id").startswith("UNC-") and not keep_unc:
            line = re.sub(r"^- \[[xX]\]", "- [ ]", line, count=1)
        elif m and m.group("id").startswith("CMP-") and "(unnamed)" in line and not keep_unnamed:
            k += 1
            line = line.replace("(unnamed)", "thing-%d" % k)
        elif line.startswith("|") and "renders/overlay-" in line and not keep_vision:
            cells = line.split("|")
            if len(cells) > 4:
                cells[3] = " none missed "
                line = "|".join(cells)
        out.append(line)
    return "\n".join(out) + ("\n" if text.endswith("\n") else "")


class R2Case(unittest.TestCase):
    """Base: analyse `build(tmp/x.pdf)` once per class into self.ds; helpers to edit analysis.md and run the gate."""
    build = None                 # staticmethod-like: callable(path) -> Path
    ds = None

    @classmethod
    def setUpClass(cls):
        import tempfile
        cls.tmp = tempfile.TemporaryDirectory()
        cls.pdf = cls.build(Path(cls.tmp.name) / "src.pdf")
        cls.ds = Path(cls.tmp.name) / "ds"
        cls.proc = fx.run_cli("analyze", cls.pdf, "--ds", cls.ds)
        if cls.proc.returncode != 0:
            raise AssertionError("analyze failed rc=%s\n%s\n%s" % (cls.proc.returncode, cls.proc.stdout, cls.proc.stderr))
        cls.a = cls.ds / "_analysis"
        cls.text0 = (cls.a / "analysis.md").read_text(encoding="utf-8")

    @classmethod
    def tearDownClass(cls):
        cls.tmp.cleanup()

    def gate_text(self, text):
        """Write `text` as analysis.md, run the gate, restore. -> (returncode, parsed JSON)."""
        am = self.a / "analysis.md"
        try:
            am.write_text(text, encoding="utf-8")
            r = fx.run_cli("gate", self.ds)
            try:
                data = json.loads(r.stdout)
            except ValueError:
                data = {}
            return r.returncode, data
        finally:
            am.write_text(self.text0, encoding="utf-8")
            (self.a / "approved.json").unlink(missing_ok=True)

    def approvable(self, **kw):
        return resolve_checkpoint(self.text0, **kw)

    @staticmethod
    def reasons(data):
        return [p["reason"] for p in data.get("problems", [])]
