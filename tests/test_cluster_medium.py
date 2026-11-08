"""AC4 Pattern analysis (dfp.cluster) + AC5 Medium detection (dfp.medium) on synthetic PDFs."""
import tempfile
import unittest
from pathlib import Path

from tests import fixtures as fx


def _analysis_inputs(path):
    probe = fx.mod("dfp.probe").probe_pdf(path)
    ext = fx.mod("dfp.extract").extract_pdf(path)
    clusters = fx.mod("dfp.cluster").cluster_patterns(path)
    return probe, ext, clusters


class Clusters(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.tmp = tempfile.TemporaryDirectory()
        cls.pdf = fx.make_vector_pdf(Path(cls.tmp.name) / "v.pdf")
        cls.clusters = fx.mod("dfp.cluster").cluster_patterns(cls.pdf)

    @classmethod
    def tearDownClass(cls):
        cls.tmp.cleanup()

    def _shape(self, **kw):
        out = [c for c in self.clusters if c["kind"] == "shape"
               and all(c.get(k) == v for k, v in kw.items())]
        return out

    def test_repeated_callout_is_one_candidate_with_colour_variants(self):
        hits = [c for c in self.clusters if c["kind"] == "shape" and c["occurrences"] == 4
                and {v["value"].upper() for v in c["variants"] if v["attr"] == "fill"} == {fx.GREEN, fx.YELLOW}]
        self.assertEqual(len(hits), 1, [(c["kind"], c["occurrences"]) for c in self.clusters])
        c = hits[0]
        self.assertEqual(c["pages"], [1, 2, 3])
        counts = {v["value"].upper(): v["count"] for v in c["variants"] if v["attr"] == "fill"}
        self.assertEqual(counts, {fx.GREEN: 3, fx.YELLOW: 1})

    def test_red_dots_cluster(self):
        dots = [c for c in self.clusters if c["kind"] == "shape" and c["occurrences"] == 6
                and any(v["attr"] == "fill" and v["value"].upper() == fx.RED for v in c["variants"])]
        self.assertEqual(len(dots), 1)
        self.assertEqual(dots[0]["pages"], [1, 2, 3])

    def test_singletons_excluded_by_default(self):
        self.assertFalse([c for c in self.clusters if c["occurrences"] < 2])
        self.assertFalse([c for c in self.clusters if any(
            v["attr"] == "fill" and v["value"].upper() == fx.TINT for v in c["variants"])])   # big rect: p.1 only
        again = fx.mod("dfp.cluster").cluster_patterns(self.pdf, min_occurrences=1)
        self.assertTrue([c for c in again if any(
            v["attr"] == "fill" and v["value"].upper() == fx.TINT for v in c["variants"])])

    def test_footer_text_band(self):
        bands = [c for c in self.clusters if c["kind"] == "text-band" and c.get("band") == "footer"]
        self.assertEqual(len(bands), 1)
        self.assertEqual(bands[0]["pages"], [1, 2, 3])
        self.assertEqual(bands[0]["occurrences"], 3)

    def test_cluster_shape_contract(self):
        ids = [c["id"] for c in self.clusters]
        self.assertEqual(len(ids), len(set(ids)))
        for c in self.clusters:
            self.assertRegex(c["id"], r"^CL-\d{3}$")
            self.assertGreaterEqual(len(c["samples"]), 1)
            self.assertLessEqual(len(c["samples"]), 5)
            for s in c["samples"]:
                self.assertEqual(len(s["bbox"]), 4)
                self.assertIn(s["page"], c["pages"])
        occ = [c["occurrences"] for c in self.clusters]
        self.assertEqual(occ, sorted(occ, reverse=True))

    def test_zero_thickness_rules_are_not_shapes(self):
        # the 1.5pt rule has a zero-height bbox: it must be reported as kind 'rule', never 'shape'
        rules = [c for c in self.clusters if c["kind"] == "rule"]
        self.assertEqual(len(rules), 1)
        self.assertEqual(rules[0]["occurrences"], 3)


class Medium(unittest.TestCase):
    def test_textbook_is_publication_print(self):
        with tempfile.TemporaryDirectory() as t:
            probe, ext, cl = _analysis_inputs(fx.make_vector_pdf(Path(t) / "v.pdf"))
        m = fx.mod("dfp.medium").detect_medium(probe, ext, cl)
        self.assertEqual(m["candidates"][0]["medium"], "publication-print")
        self.assertTrue(m["candidates"][0]["evidence"])
        self.assertEqual(m["proposed"], ["publication-print"])
        scores = [c["score"] for c in m["candidates"]]
        self.assertEqual(scores, sorted(scores, reverse=True))

    def test_deck_is_presentation(self):
        with tempfile.TemporaryDirectory() as t:
            probe, ext, cl = _analysis_inputs(fx.make_deck_pdf(Path(t) / "d.pdf"))
        m = fx.mod("dfp.medium").detect_medium(probe, ext, cl)
        self.assertEqual(m["candidates"][0]["medium"], "presentation")
        self.assertIn("presentation", m["proposed"])

    def test_media_taxonomy(self):
        self.assertEqual(set(fx.mod("dfp.medium").MEDIA),
                         {"web-ui", "presentation", "publication-print", "marketing", "mixed"})

    def test_applicability_print(self):
        a = fx.mod("dfp.medium").applicability("publication-print")
        na = {x["category"]: x["reason"] for x in a["not_applicable"]}
        for cat in ("toast", "tabs", "switch", "motion", "elevation-as-interaction"):
            self.assertIn(cat, na)
            self.assertTrue(na[cat].strip(), cat)
        self.assertNotIn("toast", a["applicable"])
        for cat in ("page-geometry", "running-footer", "callout", "table"):
            self.assertIn(cat, a["applicable"])

    def test_applicability_web_and_presentation(self):
        m = fx.mod("dfp.medium")
        web = m.applicability("web-ui")
        for cat in ("toast", "tabs", "switch", "motion"):
            self.assertIn(cat, web["applicable"])
        pres = m.applicability("presentation")
        self.assertIn("slide-layout", pres["applicable"])
        self.assertIn("toast", {x["category"] for x in pres["not_applicable"]})

    def test_unknown_medium_rejected(self):
        with self.assertRaises(ValueError):
            fx.mod("dfp.medium").applicability("hologram")


if __name__ == "__main__":
    unittest.main()
