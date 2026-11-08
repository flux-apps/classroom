"""Round 2 / AC16 composites + no cap (dfp.cluster), AC16/AC16a coverage + unclaimed tiers (dfp.coverage).

Pinned API
  cluster.cluster_patterns(path, pages=None, min_occurrences=2, tolerance=0.15, structure_match=0.8) -> [cluster]
      no `max_clusters`. Primitive kinds shape|rule|text-band as in round 1, plus kind `composite`:
      composite: members[{role: shape|shadow|badge|text|image|rule, ...}], absorbed[CL ids]; variants may carry
      attr `size` ("WxH" in whole pt) and, for edge-anchored compounds, `side` (left|right|top|bottom).
      An absorbed primitive cluster carries parent=<composite CL id> (and is still listed, nested).
  coverage.compute_coverage(path, clusters, structure=None, pages=None, threshold=0.001) -> {
      denominator: str, overall: {claimed_pct|None, unclaimed_pct|None, unclaimed_regions: int},
      pages: [{page, drawing_pct|None, text_pct|None, image: "n/a"|"photos", denominator_pt2, unclaimed_pt2,
               claimed_pct|None, unclaimed_regions}],
      unclaimed: [{id: UNC-NNN, page, bbox, area_pt2, area_pct, tier: actionable|auto, kinds: [drawing|text]}]}
  Coverage formula (SF2, A17): per page, denominator = area of the UNION of drawing bboxes and text-line bboxes,
  minus the union of embedded image blocks (full-page background drawings >= 95 % of the page excluded);
  claimed = the part of the denominator inside a cluster occurrence bbox or a structural element's bbox.
  percentages are 0-100. A page with denominator 0 reports None, never 100.
"""
import inspect
import tempfile
import unittest
from pathlib import Path

from tests import fixtures as fx
from tests import fixtures_r2 as r2


def _composites(clusters):
    return [c for c in clusters if c["kind"] == "composite"]


class CompositeClusters(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.tmp = tempfile.TemporaryDirectory()
        cls.pdf = r2.make_composite_pdf(Path(cls.tmp.name) / "c.pdf")
        cls.clusters = fx.mod("dfp.cluster").cluster_patterns(cls.pdf)
        cls.bubble = next((c for c in _composites(cls.clusters) if c["occurrences"] == 6), None)

    @classmethod
    def tearDownClass(cls):
        cls.tmp.cleanup()

    def test_bubble_with_shadow_badge_and_text_is_one_cluster(self):
        self.assertIsNotNone(self.bubble, [(c["kind"], c["occurrences"]) for c in self.clusters])
        self.assertEqual(self.bubble["pages"], [1, 2, 3])
        self.assertEqual(len([c for c in _composites(self.clusters) if c["occurrences"] == 6]), 1)

    def test_size_and_colour_are_variants_not_separate_clusters(self):
        sizes = {v["value"] for v in self.bubble["variants"] if v["attr"] == "size"}
        self.assertGreaterEqual(len(sizes), 2, self.bubble["variants"])
        fills = {v["value"].upper(): v["count"] for v in self.bubble["variants"] if v["attr"] == "fill"}
        self.assertEqual(fills, {r2.BLUE: 4, r2.MAGENTA: 2})

    def test_overlapping_instances_are_not_merged_into_one_compound(self):
        # p.2 holds two bubbles overlapping by 20 %: still two occurrences (6 in total).
        self.assertEqual(self.bubble["occurrences"], 6)

    def test_member_roles(self):
        roles = {m["role"] for m in self.bubble["members"]}
        self.assertTrue({"shape", "shadow", "badge", "text"} <= roles, roles)

    def test_fragments_are_absorbed_nested_and_not_standalone(self):
        ids = {c["id"]: c for c in self.clusters}
        self.assertGreaterEqual(len(self.bubble["absorbed"]), 3)
        for fid in self.bubble["absorbed"]:
            self.assertIn(fid, ids)
            self.assertEqual(ids[fid].get("parent"), self.bubble["id"], fid)
        for c in self.clusters:                                   # the 14x14 badge dot is never a component of its own
            if c["kind"] == "shape" and all(abs(d - 14) < 1.5 for d in c.get("size", [0, 0])):
                self.assertEqual(c.get("parent"), self.bubble["id"])

    def test_second_composite_is_the_callout(self):
        co = [c for c in _composites(self.clusters) if c["occurrences"] == 3]
        self.assertEqual(len(co), 1)
        self.assertEqual(co[0]["pages"], [1, 2, 3])
        self.assertNotEqual(co[0]["id"], self.bubble["id"])

    def test_ids_are_unique_and_sequential(self):
        ids = [c["id"] for c in self.clusters]
        self.assertEqual(ids, ["CL-%03d" % i for i in range(1, len(ids) + 1)])

    def test_signature_has_tolerance_params_and_no_cap(self):
        params = inspect.signature(fx.mod("dfp.cluster").cluster_patterns).parameters
        self.assertNotIn("max_clusters", params)
        self.assertEqual(params["tolerance"].default, 0.15)
        self.assertEqual(params["structure_match"].default, 0.8)

    def test_side_tab_left_and_right_is_one_cluster(self):
        with tempfile.TemporaryDirectory() as t:
            cl = fx.mod("dfp.cluster").cluster_patterns(r2.make_tab_pdf(Path(t) / "tab.pdf"))
        tabs = [c for c in _composites(cl) if c["occurrences"] == 4]
        self.assertEqual(len(tabs), 1, [(c["kind"], c["occurrences"]) for c in cl])
        sides = {v["value"]: v["count"] for v in tabs[0]["variants"] if v["attr"] == "side"}
        self.assertEqual(sides, {"left": 2, "right": 2})

    def test_two_on_one_page_qualify(self):
        import pymupdf
        with tempfile.TemporaryDirectory() as t:
            doc = pymupdf.open()
            pg = doc.new_page(width=595, height=842)
            sh = pg.new_shape()
            for x in (100, 300):
                sh.draw_circle(pymupdf.Point(x + 20, 200), 20)
                sh.finish(fill=r2.rgb(r2.TEAL), color=None)
                sh.draw_circle(pymupdf.Point(x + 20, 200), 6)
                sh.finish(fill=(1, 1, 1), color=None)
            sh.commit()
            doc.save(str(Path(t) / "two.pdf"))
            cl = fx.mod("dfp.cluster").cluster_patterns(Path(t) / "two.pdf")
        comp = [c for c in _composites(cl) if c["occurrences"] == 2]
        self.assertEqual(len(comp), 1, [(c["kind"], c["occurrences"], c["pages"]) for c in cl])
        self.assertEqual(comp[0]["pages"], [1])


class NoRowCap(unittest.TestCase):
    def test_more_than_150_clusters_are_all_returned(self):
        with tempfile.TemporaryDirectory() as t:
            pdf = r2.make_many_rules_pdf(Path(t) / "rules.pdf", n=180)
            cl = fx.mod("dfp.cluster").cluster_patterns(pdf)
        rules = [c for c in cl if c["kind"] == "rule" and c["occurrences"] == 2]
        self.assertGreaterEqual(len(rules), 180, len(cl))


class Coverage(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.tmp = tempfile.TemporaryDirectory()
        cls.pdf = r2.make_composite_pdf(Path(cls.tmp.name) / "c.pdf")
        cls.clusters = fx.mod("dfp.cluster").cluster_patterns(cls.pdf)
        cls.structure = fx.mod("dfp.structure").detect_structure(cls.pdf, clusters=cls.clusters)
        cls.cov = fx.mod("dfp.coverage").compute_coverage(cls.pdf, cls.clusters, cls.structure)

    @classmethod
    def tearDownClass(cls):
        cls.tmp.cleanup()

    def test_shape_and_denominator_statement(self):
        self.assertEqual([p["page"] for p in self.cov["pages"]], [1, 2, 3])
        self.assertRegex(self.cov["denominator"], r"(?i)union.*(drawing|text).*image")
        for p in self.cov["pages"]:
            self.assertEqual(p["image"], "n/a")

    def test_fully_claimed_page(self):
        p2 = self.cov["pages"][1]
        self.assertGreaterEqual(p2["claimed_pct"], 95.0, p2)
        self.assertEqual(p2["unclaimed_regions"], 0)

    def test_unclaimed_area_is_the_box_and_the_speck(self):
        p1 = self.cov["pages"][0]
        self.assertTrue(9900 <= p1["unclaimed_pt2"] <= 10250, p1)
        self.assertEqual(p1["unclaimed_regions"], 2)
        self.assertLess(p1["claimed_pct"], self.cov["pages"][1]["claimed_pct"])

    def test_percentage_matches_the_stated_formula(self):
        for p in self.cov["pages"]:
            expect = 100.0 * (1.0 - p["unclaimed_pt2"] / p["denominator_pt2"])
            self.assertAlmostEqual(p["claimed_pct"], expect, delta=0.05)
        o = self.cov["overall"]
        self.assertAlmostEqual(o["claimed_pct"] + o["unclaimed_pct"], 100.0, delta=0.1)
        self.assertEqual(o["unclaimed_regions"], 2)

    def test_two_tiers(self):
        unc = self.cov["unclaimed"]
        self.assertEqual([u["id"] for u in unc], ["UNC-001", "UNC-002"])
        big, small = unc[0], unc[1]
        self.assertEqual((big["tier"], small["tier"]), ("actionable", "auto"))
        self.assertTrue(1.9 <= big["area_pct"] <= 2.1, big)
        self.assertLess(small["area_pct"], 0.1)
        for got, want in zip(big["bbox"], (300, 520, 400, 620)):
            self.assertAlmostEqual(got, want, delta=2.0)

    def test_threshold_moves_the_tier(self):
        cov = fx.mod("dfp.coverage").compute_coverage(self.pdf, self.clusters, self.structure, threshold=0.05)
        self.assertEqual({u["tier"] for u in cov["unclaimed"]}, {"auto"})

    def test_unique_text_styles_are_unclaimed_text(self):
        with tempfile.TemporaryDirectory() as t:
            pdf = r2.make_sparse_pdf(Path(t) / "s.pdf")
            cl = fx.mod("dfp.cluster").cluster_patterns(pdf)
            cov = fx.mod("dfp.coverage").compute_coverage(pdf, cl, fx.mod("dfp.structure").detect_structure(pdf))
        self.assertEqual(len(cov["unclaimed"]), 2)
        self.assertTrue(all("text" in u["kinds"] for u in cov["unclaimed"]), cov["unclaimed"])

    def test_image_pages_are_excluded_not_counted_as_claimed(self):
        with tempfile.TemporaryDirectory() as t:
            pdf = r2.make_structure_pdf(Path(t) / "st.pdf")
            cl = fx.mod("dfp.cluster").cluster_patterns(pdf)
            cov = fx.mod("dfp.coverage").compute_coverage(pdf, cl, fx.mod("dfp.structure").detect_structure(pdf))
        p4 = cov["pages"][3]
        self.assertEqual(p4["image"], "photos")
        self.assertEqual(p4["denominator_pt2"], 0)
        self.assertIsNone(p4["claimed_pct"])
        self.assertEqual(p4["unclaimed_regions"], 0)

    def test_raster_pdf_has_no_coverage_not_a_fake_hundred(self):
        with tempfile.TemporaryDirectory() as t:
            pdf = fx.make_raster_pdf(Path(t) / "r.pdf")
            cov = fx.mod("dfp.coverage").compute_coverage(pdf, [], None)
        self.assertIsNone(cov["overall"]["claimed_pct"])


if __name__ == "__main__":
    unittest.main()
