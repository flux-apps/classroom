"""Round 2 / AC17 structure + page templates (dfp.structure), AC19 measured usage (dfp.usage).

Pinned API
  structure.detect_structure(path, pages=None, clusters=None) -> {"elements": [STR], "templates": [TPL]}
    STR: {id: STR-NNN, type: page-frame|columns|rhythm|text-role|divider|section-block|photo-frame|table-grid,
          label, value: {...}, status: observed|estimated|inferred, pages: [int], evidence: str}
      page-frame value {top,right,bottom,left} pt   columns value {count, gap}   rhythm value {style, size, leading}
      text-role  name in heading-1..N|body|caption (size order), value {size, bold, italic, family}, sample: str
      photo-frame value {bleed: bool, aspect: w/h}   table-grid value {rows, columns, header_row}
      section-block = filled rect >= 20 % of the page area, or a band >= 80 % of the page width and >= 20 pt tall.
    TPL: {id: TPL-NNN, pages, n, zones: [{name, y0, y1}], components: {zone name: [cluster ids]}}
    A text style needs >= 2 lines to become a role. Raster pages: no element has status `observed`.
  structure.to_tokens(result) -> {"--page-margin-top|right|bottom|left", "--col-gap", "--leading-body": float pt}
  usage.measure_usage(path, clusters, structure=None) -> {cluster id: {
      status, overlap{min,max,median}, z_order: later-on-top|earlier-on-top|none, rotation{min,max} deg,
      neighbour_distance{min,median,max} pt (non-overlapping neighbours only), edge_distance{min,median,max},
      anchor: margin|bleed|column|free, position: top|middle|bottom, per_page{min,max},
      co_occurs: [{id, with, of}], multi_sample: {page, bbox} | None}}
    overlap = intersection area / area of the smaller bbox; z-order from draw order.
"""
import tempfile
import unittest
from pathlib import Path

from tests import fixtures as fx
from tests import fixtures_r2 as r2


class Structure(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.tmp = tempfile.TemporaryDirectory()
        cls.pdf = r2.make_structure_pdf(Path(cls.tmp.name) / "s.pdf")
        cls.st = fx.mod("dfp.structure").detect_structure(cls.pdf)
        cls.el = cls.st["elements"]

    @classmethod
    def tearDownClass(cls):
        cls.tmp.cleanup()

    def _of(self, typ):
        return [e for e in self.el if e["type"] == typ]

    def test_elements_are_well_formed(self):
        ids = [e["id"] for e in self.el]
        self.assertEqual(ids, ["STR-%03d" % i for i in range(1, len(ids) + 1)])
        for e in self.el:
            for k in ("type", "label", "value", "status", "pages", "evidence"):
                self.assertIn(k, e, e)
            self.assertEqual(e["status"], "observed", e)               # vector PDF: measured, never guessed
            self.assertTrue(e["evidence"])

    def test_page_frame_margins(self):
        frames = self._of("page-frame")
        self.assertTrue(frames)
        v = frames[0]["value"]
        self.assertTrue(47 <= v["left"] <= 53, v)
        self.assertTrue(47 <= v["right"] <= 53, v)
        self.assertTrue(55 <= v["top"] <= 70, v)
        self.assertTrue(52 <= v["bottom"] <= 68, v)

    def test_columns_one_then_two_with_gutter(self):
        by_pages = {tuple(e["pages"]): e["value"] for e in self._of("columns")}
        self.assertEqual(by_pages[(1,)]["count"], 1)
        self.assertEqual(by_pages[(2, 3)]["count"], 2)
        self.assertTrue(27 <= by_pages[(2, 3)]["gap"] <= 45, by_pages[(2, 3)])

    def test_baseline_rhythm(self):
        body = [e for e in self._of("rhythm") if e["value"]["style"] == "body"]
        self.assertEqual(len(body), 1)
        self.assertAlmostEqual(body[0]["value"]["leading"], 14.0, delta=0.6)
        self.assertAlmostEqual(body[0]["value"]["size"], 10.0, delta=0.3)

    def test_text_roles_and_heading_hierarchy(self):
        roles = {e["label"]: e for e in self._of("text-role")}
        want = {"heading-1": 24, "heading-2": 20, "heading-3": 14, "body": 10, "caption": 8}
        for name, size in want.items():
            self.assertIn(name, roles, sorted(roles))
            self.assertAlmostEqual(roles[name]["value"]["size"], size, delta=0.6)
            self.assertTrue(roles[name].get("sample"), name)
        self.assertTrue(roles["caption"]["value"]["italic"])
        self.assertGreaterEqual(len([n for n in roles if n.startswith("heading-")]), 3)

    def test_dividers_photo_frame_table(self):
        div = [e for e in self._of("divider") if set(e["pages"]) >= {1, 2, 3}]
        self.assertTrue(div, [(e["type"], e["pages"]) for e in self.el])
        photo = self._of("photo-frame")
        self.assertEqual([e["pages"] for e in photo], [[4]])
        self.assertTrue(photo[0]["value"]["bleed"])
        self.assertAlmostEqual(photo[0]["value"]["aspect"], 595 / 842.0, delta=0.01)
        tbl = self._of("table-grid")
        self.assertEqual([e["pages"] for e in tbl], [[5]])
        self.assertEqual((tbl[0]["value"]["rows"], tbl[0]["value"]["columns"], tbl[0]["value"]["header_row"]),
                         (5, 3, True))

    def test_page_templates_partition_the_pages(self):
        tpl = self.st["templates"]
        self.assertEqual(sorted(t["pages"] for t in tpl), [[1], [2, 3], [4], [5]])
        self.assertEqual([t["id"] for t in tpl], ["TPL-%03d" % i for i in range(1, len(tpl) + 1)])
        for t in tpl:
            self.assertEqual(t["n"], len(t["pages"]))
            self.assertTrue(t["zones"], t)
            for z in t["zones"]:
                self.assertTrue({"name", "y0", "y1"} <= set(z))
            self.assertIsInstance(t["components"], dict)

    def test_tokens(self):
        tok = fx.mod("dfp.structure").to_tokens(self.st)
        self.assertAlmostEqual(tok["--page-margin-left"], 50, delta=3)
        self.assertTrue(27 <= tok["--col-gap"] <= 45, tok["--col-gap"])
        self.assertAlmostEqual(tok["--leading-body"], 14, delta=0.6)
        for k in ("--page-margin-top", "--page-margin-right", "--page-margin-bottom"):
            self.assertIn(k, tok)

    def test_template_zones_name_the_components_that_appear_in_them(self):
        with tempfile.TemporaryDirectory() as t:
            pdf = r2.make_composite_pdf(Path(t) / "c.pdf")
            cl = fx.mod("dfp.cluster").cluster_patterns(pdf)
            st = fx.mod("dfp.structure").detect_structure(pdf, clusters=cl)
        bubble = next(c["id"] for c in cl if c["kind"] == "composite" and c["occurrences"] == 6)
        placed = {cid for t_ in st["templates"] for ids in t_["components"].values() for cid in ids}
        self.assertIn(bubble, placed)

    def test_raster_pdf_degrades_to_estimated_never_observed(self):
        with tempfile.TemporaryDirectory() as t:
            st = fx.mod("dfp.structure").detect_structure(fx.make_raster_pdf(Path(t) / "r.pdf"))
        self.assertFalse([e for e in st["elements"] if e["status"] == "observed"])


class Usage(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.tmp = tempfile.TemporaryDirectory()
        cls.pdf = r2.make_composite_pdf(Path(cls.tmp.name) / "c.pdf")
        cls.cl = fx.mod("dfp.cluster").cluster_patterns(cls.pdf)
        cls.use = fx.mod("dfp.usage").measure_usage(cls.pdf, cls.cl)
        cls.bubble = next(c for c in cls.cl if c["kind"] == "composite" and c["occurrences"] == 6)
        cls.callout = next(c for c in cls.cl if c["kind"] == "composite" and c["occurrences"] == 3)
        cls.ub, cls.uc = cls.use[cls.bubble["id"]], cls.use[cls.callout["id"]]

    @classmethod
    def tearDownClass(cls):
        cls.tmp.cleanup()

    def test_overlap_and_z_order_of_the_bubbles(self):
        self.assertTrue(0.15 <= self.ub["overlap"]["max"] <= 0.25, self.ub["overlap"])
        self.assertEqual(self.ub["overlap"]["min"], 0)
        self.assertEqual(self.ub["z_order"], "later-on-top")
        self.assertEqual(self.ub["status"], "observed")

    def test_spacing_rotation_anchor_density(self):
        self.assertTrue(30 <= self.ub["neighbour_distance"]["min"] <= 45, self.ub["neighbour_distance"])
        self.assertEqual((self.ub["rotation"]["min"], self.ub["rotation"]["max"]), (0, 0))
        self.assertEqual(self.ub["anchor"], "free")
        self.assertEqual(self.ub["position"], "middle")
        self.assertEqual(self.ub["per_page"], {"min": 2, "max": 2})
        self.assertEqual(self.uc["per_page"], {"min": 1, "max": 1})
        self.assertEqual(self.uc["overlap"]["max"], 0)

    def test_co_occurrence_is_symmetric_and_counted_in_pages(self):
        self.assertIn({"id": self.callout["id"], "with": 3, "of": 3}, self.ub["co_occurs"])
        self.assertIn({"id": self.bubble["id"], "with": 3, "of": 3}, self.uc["co_occurs"])

    def test_multi_instance_sample_spans_the_overlapping_pair(self):
        ms = self.ub["multi_sample"]
        self.assertEqual(ms["page"], 2)
        x0, y0, x1, y1 = ms["bbox"]
        self.assertTrue(x0 <= 101 and x1 >= 335, ms)

    def test_side_tab_rotation_and_edge_anchor(self):
        with tempfile.TemporaryDirectory() as t:
            pdf = r2.make_tab_pdf(Path(t) / "tab.pdf")
            cl = fx.mod("dfp.cluster").cluster_patterns(pdf)
            use = fx.mod("dfp.usage").measure_usage(pdf, cl)
        tab = next(c for c in cl if c["kind"] == "composite" and c["occurrences"] == 4)
        u = use[tab["id"]]
        self.assertEqual(u["anchor"], "bleed")
        self.assertAlmostEqual(abs(u["rotation"]["max"]), 90, delta=2)
        self.assertAlmostEqual(u["rotation"]["min"], u["rotation"]["max"], delta=2)
        self.assertEqual(u["per_page"], {"min": 1, "max": 1})
        self.assertLessEqual(u["edge_distance"]["max"], 1.0)

    def test_raster_has_nothing_to_measure(self):
        with tempfile.TemporaryDirectory() as t:
            pdf = fx.make_raster_pdf(Path(t) / "r.pdf")
            self.assertEqual(fx.mod("dfp.usage").measure_usage(pdf, []), {})


if __name__ == "__main__":
    unittest.main()
