"""AC3 Rendering, AC4-AC7 via the `analyze` command: facts on disk, nothing built before approval."""
import json
import re
import tempfile
import unittest
from pathlib import Path

from tests import fixtures as fx
from tests import fixtures_r2 as r2


class Render(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.tmp = tempfile.TemporaryDirectory()
        cls.pdf = fx.make_vector_pdf(Path(cls.tmp.name) / "v.pdf")

    @classmethod
    def tearDownClass(cls):
        cls.tmp.cleanup()

    def _size(self, path):
        from PIL import Image
        with Image.open(path) as im:
            return im.size

    def test_render_pages_names_and_pixel_sizes(self):
        out = Path(self.tmp.name) / "r"
        paths = fx.mod("dfp.render").render_pages(self.pdf, out, dpi=144)
        self.assertEqual([p.name for p in paths], ["page-001.png", "page-002.png", "page-003.png"])
        self.assertEqual(self._size(paths[0]), (1190, 1684))          # 595x842pt @144dpi

    def test_render_pages_subset(self):
        out = Path(self.tmp.name) / "r2"
        paths = fx.mod("dfp.render").render_pages(self.pdf, out, dpi=72, pages=[2])
        self.assertEqual([p.name for p in paths], ["page-002.png"])

    def test_crop(self):
        out = Path(self.tmp.name) / "crop.png"
        p = fx.mod("dfp.render").crop(self.pdf, 1, (220, 300, 340, 350), out, dpi=144)
        self.assertEqual(self._size(p), (240, 100))

    def test_no_system_tool_dependency(self):
        # AC3: no poppler/Cairo/ImageMagick; wheels only.
        bad = re.compile(r"pdf2image|pdftoppm|pdfinfo|pdffonts|pdftocairo|cairosvg|wand\b|ghostscript", re.I)
        offenders = []
        for f in (fx.SKILL_DIR / "dfp").glob("*.py"):
            if bad.search(f.read_text(encoding="utf-8")):
                offenders.append(f.name)
        self.assertEqual(offenders, [])
        self.assertTrue(list((fx.SKILL_DIR / "dfp").glob("*.py")), "dfp package missing")


class Analyze(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.tmp = tempfile.TemporaryDirectory()
        cls.pdf = fx.make_vector_pdf(Path(cls.tmp.name) / "v.pdf")
        cls.ds = fx.make_analyzed_ds(cls.tmp.name, cls.pdf)
        cls.a = cls.ds / "_analysis"

    @classmethod
    def tearDownClass(cls):
        cls.tmp.cleanup()

    def test_artifacts_written(self):
        for name in ("probe.json", "extract.json", "clusters.json", "medium.json", "inventory.json", "analysis.md"):
            self.assertTrue((self.a / name).is_file(), name)
        pngs = sorted(p.name for p in (self.a / "renders").glob("page-*.png"))
        self.assertEqual(pngs, ["page-001.png", "page-002.png", "page-003.png"])
        self.assertEqual(json.loads((self.a / "probe.json").read_text())["pages"], 3)

    def test_crops_exist_for_cluster_samples(self):
        crops = list((self.a / "crops").glob("*.png"))
        self.assertTrue(crops)
        clusters = json.loads((self.a / "clusters.json").read_text())
        self.assertTrue(any(c.get("crop") and (self.a / c["crop"]).is_file() for c in clusters))

    def test_heavy_renders_gitignored_crops_not(self):
        ig = (self.a / ".gitignore").read_text()
        self.assertIn("renders/", ig)
        self.assertNotIn("crops/", ig)

    def test_stops_at_checkpoint_builds_nothing(self):
        for rel in ("styles.css", "tokens", "components", "readme.md", "SKILL.md", "_ds_manifest.json",
                    "provenance.json", "_analysis/approved.json"):
            self.assertFalse((self.ds / rel).exists(), rel)

    def test_analysis_md_is_pending_and_parses(self):
        am = fx.mod("dfp.analysis_md")
        text = (self.a / "analysis.md").read_text(encoding="utf-8")
        self.assertIn("Approved: no", text)
        p = am.parse_analysis_md(text)
        self.assertEqual(p["errors"], [])
        self.assertFalse(p["approved"])
        self.assertEqual(p["medium"], ["publication-print"])
        inv = json.loads((self.a / "inventory.json").read_text())
        self.assertEqual({r["id"] for r in p["items"]}, {i["id"] for i in inv["items"]})

    def test_gate_blocks_until_user_approves_then_passes(self):
        r = fx.run_cli("gate", self.ds)
        self.assertEqual(r.returncode, 4, r.stdout + r.stderr)
        am = self.a / "analysis.md"
        original = am.read_text(encoding="utf-8")
        try:
            am.write_text(r2.resolve_checkpoint(original, "2026-11-05 Tester"), encoding="utf-8")   # round 2: UNC/vision/names too
            r = fx.run_cli("gate", self.ds)
            self.assertEqual(r.returncode, 0, r.stdout + r.stderr)
        finally:
            am.write_text(original, encoding="utf-8")
            (self.a / "approved.json").unlink(missing_ok=True)

    def test_inferred_items_section_matches_inventory(self):
        inv = json.loads((self.a / "inventory.json").read_text())
        inferred = {i["id"] for i in inv["items"] if i["status"] == "inferred"}
        text = (self.a / "analysis.md").read_text(encoding="utf-8")
        tail = text.split("## Inferred items", 1)[1].split("## Checkpoint", 1)[0]
        self.assertEqual(set(re.findall(r"(?m)^- ([A-Z]{1,3}-\d{3})\b", tail)), inferred)   # leading ids only: rows may cite others

    def test_analyze_rerun_refuses_to_clobber_an_edited_analysis(self):
        am = self.a / "analysis.md"
        original = am.read_text(encoding="utf-8")
        try:
            am.write_text(original + "\nUSER-EDIT\n", encoding="utf-8")
            r = fx.run_cli("analyze", self.pdf, "--ds", self.ds)
            self.assertNotEqual(r.returncode, 0)
            self.assertIn("USER-EDIT", am.read_text(encoding="utf-8"))
            r = fx.run_cli("analyze", self.pdf, "--ds", self.ds, "--force")
            self.assertEqual(r.returncode, 0, r.stderr)
        finally:
            am.write_text(original, encoding="utf-8")

    def test_encrypted_pdf_blocks_and_writes_no_analysis(self):
        with tempfile.TemporaryDirectory() as t:
            enc = fx.make_encrypted_pdf(Path(t) / "e.pdf")
            ds = Path(t) / "ds"
            r = fx.run_cli("analyze", enc, "--ds", ds)
            self.assertEqual(r.returncode, 3)
            self.assertFalse((ds / "_analysis" / "analysis.md").exists())


if __name__ == "__main__":
    unittest.main()
