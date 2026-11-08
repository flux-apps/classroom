"""Round 2 via the real CLI: S1 terminal summary, S3 overlays, progress, scale (AC22), no row cap, raster degrade.

Pinned CLI behaviour
  analyze <pdf> --ds <dir> [--force] [--dpi N]      (--max-pages is REMOVED: unknown option => argparse exit 2)
    stderr: one line per phase `[i/N] ...` with a page counter `page k/T` while pages are processed, then a final
            summary block of <= 8 lines starting with `analyze:` (mockups §1): `analyze:` line, a `CMP .. STR .. TPL ..
            UNC .. coverage ..` line, `vision pass: 0/T pages`, `needs you:` and `next:` lines, and `elapsed <time>`.
    stdout JSON: ok, analysis, pdf_type, strategy, medium_proposed, items, clusters, structure, templates,
            unc_actionable, unc_auto, coverage_pct (null when n/a), elapsed_s, peak_memory_mb (null when the platform
            cannot measure it - never an estimate).
    writes also structure.json, coverage.json, usage.json and renders/overlay-NNN.png (long edge >= 1600 px, legend strip
    appended below the page).
  render <ds> [--pages 7,8]     re-render the overlay PNGs (only those pages when given)
  render.render_overlays(pdf, out_dir, boxes, pages=None, long_edge=1600) -> [Path overlay-NNN.png]
    boxes = {page: [{"id": "CMP-007", "kind": "CMP|STR|UNC", "bbox": [x0,y0,x1,y1], "variant": None|"v2"}]};
    CMP solid, STR dash-dot, UNC dashed (meaning is line style + printed id, colour is a bonus).
"""
import json
import os
import re
import tempfile
import time
import unittest
from pathlib import Path

from tests import fixtures as fx
from tests import fixtures_r2 as r2


class Summary(r2.R2Case):
    build = staticmethod(r2.make_composite_pdf)

    def _summary(self):
        lines = [l for l in self.proc.stderr.splitlines() if l.strip()]
        i = max(k for k, l in enumerate(lines) if l.startswith("analyze:"))
        return lines[i:]

    def test_terminal_summary_is_short_and_complete(self):
        s = self._summary()
        self.assertLessEqual(len(s), 8, s)
        text = "\n".join(s)
        for needle in ("CMP", "STR", "TPL", "UNC", "coverage", "vision pass: 0/3", "needs you:", "next:"):
            self.assertIn(needle, text)

    def test_progress_phases_page_counter_and_elapsed(self):
        err = self.proc.stderr
        self.assertGreaterEqual(len(re.findall(r"(?m)^\[\d+/\d+\]", err)), 5)
        self.assertRegex(err, r"page 3/3")
        self.assertRegex(err, r"(?i)elapsed \d")

    def test_json_report(self):
        d = json.loads(self.proc.stdout)
        for k in ("ok", "clusters", "structure", "templates", "unc_actionable", "unc_auto", "coverage_pct",
                  "elapsed_s", "peak_memory_mb"):
            self.assertIn(k, d)
        self.assertEqual((d["unc_actionable"], d["unc_auto"]), (1, 1))
        self.assertGreater(d["coverage_pct"], 50)

    def test_new_artifacts_and_no_sampling(self):
        for name in ("structure.json", "coverage.json", "usage.json"):
            self.assertTrue((self.a / name).is_file(), name)
        self.assertNotIn("sampled_pages", json.loads((self.a / "probe.json").read_text()))

    def test_overlays_are_large_and_carry_a_legend_strip(self):
        from PIL import Image
        for n in (1, 2, 3):
            with Image.open(self.a / "renders" / ("overlay-%03d.png" % n)) as im:
                w, h = im.size
            self.assertGreaterEqual(max(w, h), 1600)
            self.assertGreater(h / float(w), 842 / 595.0 + 0.02, "legend strip missing")

    def test_max_pages_option_is_gone(self):
        r = fx.run_cli("analyze", self.pdf, "--ds", Path(self.tmp.name) / "other", "--max-pages", "2")
        self.assertEqual(r.returncode, 2, r.stderr)


class Overlays(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.tmp = tempfile.TemporaryDirectory()
        cls.pdf = fx.make_vector_pdf(Path(cls.tmp.name) / "v.pdf")

    @classmethod
    def tearDownClass(cls):
        cls.tmp.cleanup()

    def _render(self, name, boxes):
        return fx.mod("dfp.render").render_overlays(self.pdf, Path(self.tmp.name) / name, boxes, pages=[1])[0]

    def test_names_sizes_and_line_style_difference(self):
        from PIL import Image, ImageChops
        box = [100, 100, 300, 300]
        none = self._render("n", {})
        cmp_ = self._render("c", {1: [{"id": "CMP-001", "kind": "CMP", "bbox": box, "variant": None}]})
        unc = self._render("u", {1: [{"id": "UNC-001", "kind": "UNC", "bbox": box, "variant": None}]})
        strr = self._render("s", {1: [{"id": "STR-001", "kind": "STR", "bbox": box, "variant": None}]})
        self.assertEqual((none.name, cmp_.name), ("overlay-001.png", "overlay-001.png"))
        ims = [Image.open(p).convert("RGB") for p in (none, cmp_, unc, strr)]
        self.assertEqual({im.size for im in ims}, {ims[0].size})
        for other in ims[1:]:
            self.assertIsNotNone(ImageChops.difference(ims[0], other).getbbox())
        for a, b in ((1, 2), (1, 3), (2, 3)):                      # solid vs dashed vs dash-dot are three different drawings
            self.assertIsNotNone(ImageChops.difference(ims[a], ims[b]).getbbox(), (a, b))


class RenderCommand(r2.R2Case):
    build = staticmethod(r2.make_composite_pdf)

    def test_render_pages_rewrites_only_the_named_overlays(self):
        files = {n: self.a / "renders" / ("overlay-%03d.png" % n) for n in (1, 2, 3)}
        before = {n: p.stat().st_mtime_ns for n, p in files.items()}
        time.sleep(0.05)
        r = fx.run_cli("render", self.ds, "--pages", "2")
        self.assertEqual(r.returncode, 0, r.stderr)
        after = {n: p.stat().st_mtime_ns for n, p in files.items()}
        self.assertGreater(after[2], before[2])
        self.assertEqual((after[1], after[3]), (before[1], before[3]))


class ManyRows(r2.R2Case):
    build = staticmethod(r2.make_many_rules_pdf)

    def test_every_cluster_is_listed_no_row_cap(self):
        self.assertGreaterEqual(len(r2.rows(self.text0, "CMP")), 180)
        self.assertRegex(self.text0, r"(?m)^## Components \((\d{3,})\)")
        self.assertRegex(self.text0, r"(?m)^## Contents")


class RasterDegrade(r2.R2Case):
    build = staticmethod(fx.make_raster_pdf)

    def test_zero_clusters_is_a_state_not_an_error(self):
        self.assertIn("CMP 0", self.proc.stderr)
        self.assertEqual(r2.rows(self.text0, "CMP"), [])
        self.assertRegex(self.text0, r"(?m)^> PDF type: raster")

    def test_nothing_is_called_observed_or_covered(self):
        for l in r2.rows(self.text0, "STR"):
            self.assertNotIn("| observed |", l)
        self.assertIsNone(json.loads(self.proc.stdout)["coverage_pct"])
        self.assertEqual(len(r2.vision_lines(self.text0)), 2)


@unittest.skipIf(os.environ.get("DFP_SKIP_SCALE"), "DFP_SKIP_SCALE set")
class Scale(unittest.TestCase):
    """AC22 / D25: no page cap, no sampling, memory flat in the page count."""

    def _run(self, t, pages):
        pdf = fx.make_vector_pdf(Path(t) / ("p%d.pdf" % pages), pages=pages)
        ds = Path(t) / ("ds%d" % pages)
        r = fx.run_cli("analyze", pdf, "--ds", ds, timeout=1800)
        self.assertEqual(r.returncode, 0, r.stderr[-800:])
        return ds, json.loads(r.stdout)

    def test_300_pages_complete_with_flat_memory(self):
        with tempfile.TemporaryDirectory() as t:
            ds24, d24 = self._run(t, 24)
            ds300, d300 = self._run(t, 300)
            a = ds300 / "_analysis"
            self.assertTrue((a / "renders" / "page-300.png").is_file())
            self.assertTrue((a / "renders" / "overlay-300.png").is_file())
            probe = json.loads((a / "probe.json").read_text())
            self.assertEqual(probe["pages"], 300)
            self.assertNotIn("sampled_pages", probe)
            self.assertIn(300, max(json.loads((a / "clusters.json").read_text()), key=lambda c: len(c["pages"]))["pages"])
            if d24.get("peak_memory_mb") is None or d300.get("peak_memory_mb") is None:
                self.skipTest("peak memory not measurable on this platform (reported as null, never estimated)")
            self.assertLessEqual(d300["peak_memory_mb"], 2.0 * d24["peak_memory_mb"],
                                 (d24["peak_memory_mb"], d300["peak_memory_mb"]))


if __name__ == "__main__":
    unittest.main()
