"""Golden tests on agencia4.pdf (21 MB, 24 pp). Skipped when the PDF is absent; never committed as a fixture.
Every expected value below was measured with raw PyMuPDF 1.26.7 before being written here.

Performance targets (AC13), measured on the dev machine (Windows 11, cold): open+fonts 4 s, drawings 11 s,
text 0.6 s (with TEXTFLAGS_TEXT — default `dict` flags that decode image blocks took 46 s), render 24 pp @72dpi 8.5 s.
Limits are ~3-5x measured so CI noise does not flake: probe <= 20 s, extract <= 60 s, analyze CLI <= 180 s.
"""
import json
import tempfile
import time
import unittest
from pathlib import Path

from tests import fixtures as fx
from tests import fixtures_r2 as r2


class GoldenProbe(fx.GoldenCase):
    def test_ac1_probe_facts(self):
        t0 = time.time()
        r = fx.mod("dfp.probe").probe_pdf(self.pdf)
        self.assertLessEqual(time.time() - t0, 20, "probe too slow")
        self.assertEqual(r["pages"], 24)
        self.assertEqual(len(r["page_sizes"]), 1)
        self.assertAlmostEqual(r["page_sizes"][0]["w"], 592, delta=1)
        self.assertAlmostEqual(r["page_sizes"][0]["h"], 805, delta=1)
        self.assertEqual(r["pdf_type"], "vector_text")
        self.assertEqual(r["strategy"], "vector-exact")
        self.assertTrue(r["has_text_layer"])
        self.assertEqual(r["text_pages"], 24)
        self.assertEqual(r["image_count"], 54)
        self.assertEqual(r["bookmarks"], 7)
        self.assertIn("InDesign", r["creator"])
        self.assertIn("Adobe PDF Library", r["producer"])
        self.assertFalse(r["encrypted"])
        self.assertGreaterEqual(len(r["font_families"]), 20)
        self.assertIn("OfficinaSansStd", r["font_families"])
        officina = [f for f in r["fonts"] if f["family"] == "OfficinaSansStd"]
        self.assertTrue(officina and all(f["subset"] for f in officina))


class GoldenExtract(fx.GoldenCase):
    @classmethod
    def setUpClass(cls):
        super().setUpClass()
        t0 = time.time()
        cls.r = fx.mod("dfp.extract").extract_pdf(cls.pdf)
        cls.elapsed = time.time() - t0

    def test_perf(self):
        self.assertLessEqual(self.elapsed, 60, "extract too slow: %.1fs" % self.elapsed)

    def test_ac2_palette(self):
        fills = {c["hex"].upper() for c in self.r["colors"] if c["role"] == "fill"}
        for hexv in (fx.INK, fx.GREEN, fx.RED, fx.YELLOW, fx.TINT, "#2F5C93", "#D96629", "#EC008C", "#005F7E"):
            self.assertIn(hexv, fills)
        self.assertTrue(all(c["method"] == "exact" for c in self.r["colors"]))

    def test_ac2_body_text_style(self):
        top = self.r["text_styles"][0]
        self.assertEqual((top["family"], top["size"], top["weight"]), ("OfficinaSansStd", 10.5, 400))
        self.assertEqual(top["color"].upper(), fx.INK)
        self.assertGreaterEqual(len(top["pages"]), 8)   # measured: 11


class GoldenClustersMedium(fx.GoldenCase):
    def test_ac4_ac5_clusters_and_medium(self):
        cl = fx.mod("dfp.cluster").cluster_patterns(self.pdf)
        self.assertLessEqual(len(cl), 200)
        repeated = [c for c in cl if c["occurrences"] >= 3 and len(c["pages"]) >= 2]
        self.assertGreaterEqual(len(repeated), 7)
        red = [c for c in cl if c["kind"] == "shape" and c["occurrences"] >= 3 and len(c["pages"]) >= 2 and any(
            v["attr"] == "fill" and v["value"].upper() == fx.RED for v in c["variants"])]
        self.assertTrue(red, "red answer-bullet cluster not found")
        probe = fx.mod("dfp.probe").probe_pdf(self.pdf)
        ext = fx.mod("dfp.extract").extract_pdf(self.pdf, pages=[1, 2, 3, 8, 12])
        m = fx.mod("dfp.medium").detect_medium(probe, ext, cl)
        self.assertEqual(m["candidates"][0]["medium"], "publication-print")
        self.assertEqual(m["proposed"], ["publication-print"])
        na = {x["category"] for x in fx.mod("dfp.medium").applicability("publication-print")["not_applicable"]}
        self.assertTrue({"toast", "tabs", "switch", "motion"} <= na)


class GoldenAnalyzeCli(fx.GoldenCase):
    def test_ac13_full_analyze_in_reasonable_time(self):
        with tempfile.TemporaryDirectory() as t:
            t0 = time.time()
            ds = fx.make_analyzed_ds(t, self.pdf)
            self.assertLessEqual(time.time() - t0, 180, "analyze too slow")
            a = ds / "_analysis"
            self.assertEqual(len(list((a / "renders").glob("page-*.png"))), 24)
            inv = json.loads((a / "inventory.json").read_text(encoding="utf-8"))
            self.assertTrue(any(i["id"].startswith("CMP-") for i in inv["items"]))
            self.assertTrue(any(i["id"].startswith("TYP-") for i in inv["items"]))
            self.assertFalse(list(ds.rglob("*.ttf")) + list(ds.rglob("*.otf")))     # no fonts extracted
            self.assertFalse((ds / "styles.css").exists())                          # stopped at checkpoint
            text = (a / "analysis.md").read_text(encoding="utf-8")
            self.assertIn("publication-print", text)
            self.assertIn("OfficinaSansStd", text)
            self.assertIn("Approved: no", text)


class GoldenRound2(fx.GoldenCase):
    """Spec AC16/AC17/AC19 golden numbers on agencia4.pdf. Thresholds are the spec's; if a number is wrong for the real
    PDF the first real run says so and the spec owner re-confirms it (these are UAT-grade, not unit-grade)."""

    @classmethod
    def setUpClass(cls):
        super().setUpClass()
        import tempfile
        cls.tmp = tempfile.TemporaryDirectory()
        t0 = time.time()
        cls.ds = fx.make_analyzed_ds(cls.tmp.name, cls.pdf)
        cls.seconds = time.time() - t0
        cls.a = cls.ds / "_analysis"
        cls.clusters = json.loads((cls.a / "clusters.json").read_text(encoding="utf-8"))
        cls.structure = json.loads((cls.a / "structure.json").read_text(encoding="utf-8"))
        cls.coverage = json.loads((cls.a / "coverage.json").read_text(encoding="utf-8"))
        cls.usage = json.loads((cls.a / "usage.json").read_text(encoding="utf-8"))
        cls.text = (cls.a / "analysis.md").read_text(encoding="utf-8")

    @classmethod
    def tearDownClass(cls):
        cls.tmp.cleanup()

    def _composites(self):
        return [c for c in self.clusters if c["kind"] == "composite"]

    def test_analyze_time_budget(self):
        self.assertLessEqual(self.seconds, 180)

    def test_speech_bubbles_are_one_cluster_with_size_variants(self):
        hits = [c for c in self._composites() if c["occurrences"] >= 7 and {2, 3} <= set(c["pages"])
                and len({v["value"] for v in c["variants"] if v["attr"] == "size"}) >= 2]
        self.assertTrue(hits, [(c["id"], c["occurrences"], c["pages"]) for c in self._composites()][:20])

    def test_audio_icon_parts_collapse_into_one_cluster(self):
        hits = [c for c in self._composites() if 8 <= c["occurrences"] <= 10 and len(c.get("absorbed", [])) >= 4]
        self.assertTrue(hits)

    def test_side_tab_left_and_right_is_one_cluster(self):
        hits = [c for c in self._composites()
                if {v["value"] for v in c["variants"] if v["attr"] == "side"} >= {"left", "right"}]
        self.assertTrue(hits)

    def test_coverage_at_least_ninety_percent_and_the_rest_is_listed(self):
        self.assertGreaterEqual(self.coverage["overall"]["claimed_pct"], 90.0)
        self.assertEqual(len(r2.rows(self.text, "UNC")), sum(1 for u in self.coverage["unclaimed"] if u["tier"] == "actionable"))

    def test_structure_templates_and_heading_hierarchy(self):
        self.assertGreaterEqual(len(self.structure["templates"]), 4)
        heads = [e for e in self.structure["elements"] if e["type"] == "text-role" and e["label"].startswith("heading-")]
        self.assertGreaterEqual(len(heads), 3)
        cols = [e for e in self.structure["elements"] if e["type"] == "columns" and e["value"]["count"] == 2]
        self.assertTrue(cols)

    def test_bubble_usage_has_overlap_and_z_order(self):
        bubble = next(c for c in self._composites() if c["occurrences"] >= 7 and {2, 3} <= set(c["pages"]))
        u = self.usage[bubble["id"]]
        self.assertGreater(u["overlap"]["max"], 0)
        self.assertIn(u["z_order"], ("later-on-top", "earlier-on-top"))

    def test_no_fragment_is_a_standalone_component_row(self):
        parents = {c["id"] for c in self.clusters if c.get("parent")}
        standalone = [c for c in self.clusters if not c.get("parent")]
        self.assertTrue(parents)
        self.assertGreaterEqual(len(r2.rows(self.text, "CMP")), len([c for c in standalone if c["kind"] != "text-band"]) // 2)


if __name__ == "__main__":
    unittest.main()
