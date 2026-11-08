"""AC6 Inventory + AC10 provenance + AC11 fonts (dfp.inventory, dfp.fontmap)."""
import re
import tempfile
import unittest
from pathlib import Path

from tests import fixtures as fx

ID_RE = re.compile(r"^(COL|TYP|SPC|RAD|BRD|SHD|ICN|IMG|CMP|MOT)-\d{3}$")
STATUSES = {"observed", "inferred", "estimated"}


def _inventory(builder):
    with tempfile.TemporaryDirectory() as t:
        pdf = builder(Path(t) / "x.pdf")
        probe = fx.mod("dfp.probe").probe_pdf(pdf)
        ext = fx.mod("dfp.extract").extract_pdf(pdf)
        cl = fx.mod("dfp.cluster").cluster_patterns(pdf)
        med = fx.mod("dfp.medium").detect_medium(probe, ext, cl)
        return fx.mod("dfp.inventory").build_inventory(probe, ext, cl, med)


class Inventory(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.inv = _inventory(fx.make_vector_pdf)
        cls.items = cls.inv["items"]

    def _by_cat(self, prefix):
        return [i for i in self.items if i["id"].startswith(prefix + "-")]

    def test_every_item_is_well_formed_and_has_provenance(self):
        ids = [i["id"] for i in self.items]
        self.assertEqual(len(ids), len(set(ids)))
        for i in self.items:
            self.assertRegex(i["id"], ID_RE)
            self.assertIn(i["status"], STATUSES, i)
            self.assertTrue(str(i["value"]).strip(), i)
            self.assertTrue(i["label"].strip(), i)
            self.assertTrue(i["evidence"].strip(), i)            # AC10: page refs or reasoning
            if i["status"] == "inferred":
                self.assertIn(i["confidence"], ("low", "medium", "high"), i)
                self.assertTrue(i["reasoning"].strip(), i)

    def test_colours_observed_exact(self):
        cols = {i["value"].upper(): i for i in self._by_cat("COL")}
        for hexv in (fx.INK, fx.GREEN, fx.RED, fx.YELLOW, fx.TINT):
            self.assertIn(hexv, cols)
            self.assertEqual(cols[hexv]["status"], "observed")

    def test_typography_items_exact_sizes(self):
        vals = " ".join(str(i["value"]) for i in self._by_cat("TYP"))
        for size in ("10.5", "24", "8"):
            self.assertIn(size, vals)
        self.assertTrue(all(i["status"] == "observed" for i in self._by_cat("TYP") if "Helvetica" in str(i["value"])))

    def test_page_geometry(self):
        spc = self._by_cat("SPC")
        self.assertTrue(any("595" in str(i["value"]) and "842" in str(i["value"]) and i["status"] == "observed"
                            for i in spc), spc)
        self.assertTrue(any("margin" in i["label"].lower() and i["status"] == "estimated" for i in spc), spc)

    def test_components_from_clusters_carry_page_refs(self):
        cmp_ = self._by_cat("CMP")
        self.assertTrue(cmp_)
        self.assertTrue(all(re.search(r"p\.\s*\d", i["evidence"]) for i in cmp_), cmp_)

    def test_exact_values_never_labelled_inferred(self):
        # an observed vector colour/size may not appear as 'inferred'
        for i in self._by_cat("COL"):
            self.assertNotEqual(i["status"], "inferred")

    def test_raster_inventory_values_are_estimated(self):
        inv = _inventory(fx.make_raster_pdf)
        cols = [i for i in inv["items"] if i["id"].startswith("COL-")]
        self.assertTrue(cols)
        self.assertTrue(all(i["status"] == "estimated" for i in cols))
        self.assertFalse([i for i in inv["items"] if i["id"].startswith("TYP-")])

    def test_categories_listed(self):
        self.assertEqual(set(fx.mod("dfp.inventory").CATEGORIES),
                         {"COL", "TYP", "SPC", "RAD", "BRD", "SHD", "ICN", "IMG", "CMP", "MOT"})


class InferScale(unittest.TestCase):
    def test_regular_scale_inferred(self):
        r = fx.mod("dfp.inventory").infer_scale([10, 12, 14.4, 17.28, 20.74])
        self.assertIsNotNone(r)
        self.assertAlmostEqual(r["ratio"], 1.2, delta=0.02)
        self.assertIn(r["confidence"], ("medium", "high"))

    def test_irregular_sizes_not_inferred(self):
        self.assertIsNone(fx.mod("dfp.inventory").infer_scale([8, 10.5, 24, 60]))

    def test_too_few_sizes(self):
        self.assertIsNone(fx.mod("dfp.inventory").infer_scale([10, 12]))


class FontMap(unittest.TestCase):
    def test_known_families(self):
        sub = fx.mod("dfp.fontmap").substitute
        sans = sub("OfficinaSansStd")
        self.assertEqual(sans["kind"], "sans")
        self.assertTrue(sans["google_font"])
        self.assertEqual(sub("BemboStd")["kind"], "serif")
        self.assertEqual(sub("TektonPro")["kind"], "script")
        for sym in ("ZapfDingbatsITC", "Wingdings"):
            r = sub(sym)
            self.assertEqual(r["kind"], "symbol")
            self.assertIsNone(r["google_font"])

    def test_always_flagged_substituted_never_original_binary(self):
        sub = fx.mod("dfp.fontmap").substitute
        for fam in ("OfficinaSansStd", "BemboStd", "MyriadPro", "Zxqvw"):
            r = sub(fam)
            self.assertTrue(r["substituted"], fam)
            self.assertIn(r["confidence"], ("high", "medium", "low"))
            self.assertTrue(r["reason"].strip())

    def test_unknown_family_low_confidence_with_fallback(self):
        r = fx.mod("dfp.fontmap").substitute("Zxqvw")
        self.assertEqual(r["confidence"], "low")
        self.assertTrue(r["google_font"])

    def test_style_hint_drives_kind_for_unknown(self):
        r = fx.mod("dfp.fontmap").substitute("QuxMono", {"monospaced": True})
        self.assertEqual(r["kind"], "mono")


if __name__ == "__main__":
    unittest.main()
