"""AC2 Extraction. Module: dfp.extract"""
import tempfile
import unittest
from pathlib import Path

from tests import fixtures as fx


def _rgb_dist(a, b):
    a, b = a.lstrip("#"), b.lstrip("#")
    return max(abs(int(a[i:i + 2], 16) - int(b[i:i + 2], 16)) for i in (0, 2, 4))


class ExtractVector(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.tmp = tempfile.TemporaryDirectory()
        cls.r = fx.mod("dfp.extract").extract_pdf(fx.make_vector_pdf(Path(cls.tmp.name) / "v.pdf"))

    @classmethod
    def tearDownClass(cls):
        cls.tmp.cleanup()

    def _color(self, hexv, role):
        for c in self.r["colors"]:
            if c["hex"].upper() == hexv and c["role"] == role:
                return c
        self.fail("no %s colour %s in %s" % (role, hexv, [(c["hex"], c["role"]) for c in self.r["colors"]]))

    def test_exact_fill_colours_with_counts_and_pages(self):
        g = self._color(fx.GREEN, "fill")
        self.assertEqual((g["count"], g["pages"], g["method"]), (3, [1, 2, 3], "exact"))
        self.assertEqual(self._color(fx.RED, "fill")["count"], 6)           # 2 dots x 3 pages
        self.assertEqual(self._color(fx.YELLOW, "fill")["pages"], [3])
        self.assertEqual(self._color(fx.TINT, "fill")["pages"], [1])

    def test_text_and_stroke_roles(self):
        self.assertGreater(self._color(fx.INK, "text")["count"], 0)
        self.assertEqual(self._color(fx.INK, "stroke")["count"], 3)         # one rule per page

    def test_colours_sorted_by_count_desc(self):
        counts = [c["count"] for c in self.r["colors"]]
        self.assertEqual(counts, sorted(counts, reverse=True))

    def test_text_styles(self):
        by = {(s["family"], s["size"], s["weight"]): s for s in self.r["text_styles"]}
        body = by[("Helvetica", 10.5, 400)]
        self.assertEqual(body["color"].upper(), fx.INK)
        self.assertEqual(body["method"], "exact")
        self.assertEqual(body["pages"], [1, 2, 3])
        self.assertAlmostEqual(body["line_height"], 14.0, delta=0.5)
        self.assertIn(("Helvetica", 24.0, 700), by)                         # heading, bold
        self.assertIn(("Helvetica", 8.0, 400), by)                          # footer
        self.assertEqual(self.r["text_styles"][0]["size"], 10.5)            # sorted by chars desc

    def test_stroke_widths(self):
        self.assertIn(1.5, [s["width"] for s in self.r["strokes"]])

    def test_corner_radius_estimated(self):
        radii = [x for x in self.r["radii"] if 8 <= x["radius"] <= 12]      # true value: 10
        self.assertTrue(radii, self.r["radii"])
        self.assertEqual(radii[0]["method"], "estimated")

    def test_unmeasurable_is_listed_not_invented(self):
        self.assertIn("shadows", self.r["unknown"])
        self.assertEqual(self.r["opacities"], [])


class ExtractRaster(unittest.TestCase):
    def test_raster_values_are_estimated_and_gaps_declared(self):
        with tempfile.TemporaryDirectory() as t:
            r = fx.mod("dfp.extract").extract_pdf(fx.make_raster_pdf(Path(t) / "r.pdf"))
        self.assertTrue(r["colors"])
        self.assertTrue(all(c["method"] == "estimated" for c in r["colors"]))
        hexes = [c["hex"] for c in r["colors"]]
        self.assertTrue(any(_rgb_dist(h, fx.GREEN) <= 24 for h in hexes), hexes)
        self.assertTrue(any(_rgb_dist(h, fx.RED) <= 24 for h in hexes), hexes)
        self.assertEqual(r["text_styles"], [])
        for k in ("text_styles", "line_height", "font_names"):
            self.assertIn(k, r["unknown"])

    def test_pages_subset(self):
        with tempfile.TemporaryDirectory() as t:
            r = fx.mod("dfp.extract").extract_pdf(fx.make_vector_pdf(Path(t) / "v.pdf"), pages=[2])
        for c in r["colors"]:
            self.assertEqual(c["pages"], [2])


if __name__ == "__main__":
    unittest.main()
