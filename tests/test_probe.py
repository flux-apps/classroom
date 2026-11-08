"""AC1 Probe (+ AC13 blocked cases). Module: dfp.probe"""
import json
import tempfile
import unittest
from pathlib import Path

from tests import fixtures as fx


class Naming(unittest.TestCase):
    def test_is_subset_name(self):
        p = fx.mod("dfp.probe")
        self.assertTrue(p.is_subset_name("ABCDEF+OfficinaSansStd-Book"))
        self.assertFalse(p.is_subset_name("Helvetica"))
        self.assertFalse(p.is_subset_name("Abcdef+Foo"))      # prefix must be 6 capitals

    def test_family_of(self):
        p = fx.mod("dfp.probe")
        table = {
            "ABCDEF+OfficinaSansStd-Book": "OfficinaSansStd",
            "MyriadPro-LightSemiCn": "MyriadPro",
            "TektonPro-Cond": "TektonPro",
            "ZapfDingbatsITC": "ZapfDingbatsITC",
            "Wingdings-Regular": "Wingdings",
            "Helvetica-Bold": "Helvetica",
            "Arial,Bold": "Arial",
        }
        for raw, fam in table.items():
            self.assertEqual(p.family_of(raw), fam, raw)

    def test_parse_style(self):
        p = fx.mod("dfp.probe")
        cases = [
            ("OfficinaSansStd-Book", 400, False), ("OfficinaSansStd-BookItal", 400, True),
            ("MyriadPro-Light", 300, False), ("MyriadPro-Semibold", 600, False),
            ("Helvetica-Bold", 700, False), ("BemboStd", 400, False),
            ("Foo-BoldItalic", 700, True), ("Foo-Black", 900, False),
        ]
        for name, weight, italic in cases:
            st = p.parse_style(name)
            self.assertEqual((st["weight"], st["italic"]), (weight, italic), name)
        self.assertEqual(p.parse_style("TektonPro-Cond")["width"], "condensed")
        self.assertEqual(p.parse_style("Helvetica")["width"], "normal")


class ProbeSynthetic(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.tmp = tempfile.TemporaryDirectory()
        t = Path(cls.tmp.name)
        cls.vec, cls.ras = fx.make_vector_pdf(t / "v.pdf"), fx.make_raster_pdf(t / "r.pdf")
        cls.mix, cls.enc = fx.make_mixed_pdf(t / "m.pdf"), fx.make_encrypted_pdf(t / "e.pdf")

    @classmethod
    def tearDownClass(cls):
        cls.tmp.cleanup()

    def test_vector(self):
        r = fx.mod("dfp.probe").probe_pdf(self.vec)
        self.assertEqual(r["pages"], 3)
        self.assertEqual(r["page_sizes"], [{"w": 595.0, "h": 842.0, "count": 3}])
        self.assertTrue(r["has_text_layer"])
        self.assertEqual(r["text_pages"], 3)
        self.assertEqual(r["image_count"], 0)
        self.assertEqual(r["bookmarks"], 1)
        self.assertEqual(r["producer"], "DFP fixtures")
        self.assertEqual(r["creator"], "DFP creator")
        self.assertFalse(r["encrypted"])
        self.assertEqual(r["pdf_type"], "vector_text")
        self.assertEqual(r["strategy"], "vector-exact")
        self.assertEqual(r["page_types"], ["vector_text"] * 3)
        self.assertEqual(r["vector_ratio"], 1.0)

    def test_fonts_reported_with_subset_flag(self):
        r = fx.mod("dfp.probe").probe_pdf(self.vec)
        fams = {f["family"]: f for f in r["fonts"]}
        self.assertEqual(set(fams), {"Helvetica"})
        self.assertFalse(fams["Helvetica"]["subset"])          # base-14, not embedded
        self.assertEqual(r["font_families"], ["Helvetica"])
        self.assertEqual(fams["Helvetica"]["pages"], [1, 2, 3])

    def test_raster(self):
        r = fx.mod("dfp.probe").probe_pdf(self.ras)
        self.assertEqual(r["pdf_type"], "raster")
        self.assertEqual(r["strategy"], "raster-sampled")
        self.assertFalse(r["has_text_layer"])
        self.assertEqual(r["image_count"], 2)
        self.assertEqual(r["vector_ratio"], 0.0)

    def test_mixed_chooses_per_page_strategy(self):
        r = fx.mod("dfp.probe").probe_pdf(self.mix)
        self.assertEqual(r["pdf_type"], "mixed")
        self.assertEqual(r["strategy"], "hybrid")
        self.assertEqual(r["page_types"], ["vector_text", "raster"])
        self.assertEqual(r["vector_ratio"], 0.5)

    def test_encrypted_is_blocked_not_guessed(self):
        p = fx.mod("dfp.probe")
        with self.assertRaises(p.PdfBlocked) as cm:
            p.probe_pdf(self.enc)
        self.assertEqual(cm.exception.code, "ENCRYPTED")

    def test_unreadable_is_blocked(self):
        p = fx.mod("dfp.probe")
        bad = Path(self.tmp.name) / "bad.pdf"
        bad.write_bytes(b"not a pdf at all")
        with self.assertRaises(p.PdfBlocked) as cm:
            p.probe_pdf(bad)
        self.assertEqual(cm.exception.code, "UNREADABLE")
        with self.assertRaises(p.PdfBlocked):
            p.probe_pdf(Path(self.tmp.name) / "missing.pdf")


class CliProbe(unittest.TestCase):
    def test_probe_cli_json_and_exit_codes(self):
        with tempfile.TemporaryDirectory() as t:
            vec = fx.make_vector_pdf(Path(t) / "v.pdf")
            r = fx.run_cli("probe", vec)
            self.assertEqual(r.returncode, 0, r.stderr)
            self.assertEqual(json.loads(r.stdout)["pages"], 3)
            enc = fx.make_encrypted_pdf(Path(t) / "e.pdf")
            r = fx.run_cli("probe", enc)
            self.assertEqual(r.returncode, 3)                     # blocked
            self.assertIn("ENCRYPTED", r.stdout + r.stderr)
            self.assertEqual(fx.run_cli("probe").returncode, 2)   # usage
            self.assertEqual(fx.run_cli("nope").returncode, 2)


if __name__ == "__main__":
    unittest.main()
