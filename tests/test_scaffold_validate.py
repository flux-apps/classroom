"""AC8 Build output (dfp.scaffold) + AC8/AC9/AC10/AC11 structural validation (dfp.validate)."""
import json
import re
import tempfile
import unittest
from pathlib import Path

from tests import fixtures as fx

FONT_EXT = {".ttf", ".otf", ".woff", ".woff2", ".pfb", ".eot"}


def approved(medium=("publication-print",), items=None):
    base = [
        {"id": "COL-001", "category": "COL", "label": "ink", "value": "#231F20", "status": "observed",
         "evidence": "p.1-3", "keep": True, "edited": False, "original_value": "#231F20"},
        {"id": "COL-002", "category": "COL", "label": "green", "value": "#8DC63F", "status": "observed",
         "evidence": "p.1-3", "keep": True, "edited": False, "original_value": "#8DC63F"},
        {"id": "COL-003", "category": "COL", "label": "dropme", "value": "#123456", "status": "observed",
         "evidence": "p.2", "keep": False, "edited": False, "original_value": "#123456"},
        {"id": "COL-004", "category": "COL", "label": "red", "value": "#111111", "status": "observed",
         "evidence": "p.2", "keep": True, "edited": True, "original_value": "#D2232A"},
        {"id": "TYP-001", "category": "TYP", "label": "body", "value": "OfficinaSansStd 10.5pt 400",
         "status": "observed", "evidence": "p.1-24", "keep": True, "edited": False,
         "original_value": "OfficinaSansStd 10.5pt 400"},
        {"id": "SPC-001", "category": "SPC", "label": "page size", "value": "595pt 805pt", "status": "observed",
         "evidence": "p.1", "keep": True, "edited": False, "original_value": "595pt 805pt"},
        {"id": "RAD-001", "category": "RAD", "label": "callout", "value": "10pt", "status": "estimated",
         "evidence": "p.1-3", "keep": True, "edited": False, "original_value": "10pt"},
    ]
    return {"approved_by": "t", "approved_at": "2026-11-05", "medium": list(medium), "items": items or base}


def scaffold_into(tmp, ap, preview=True):
    ds = Path(tmp) / "ds"
    (ds / "_analysis").mkdir(parents=True)
    (ds / "_analysis" / "approved.json").write_text(json.dumps(ap), encoding="utf-8")
    env = {}
    if preview:
        pj = Path(tmp) / "ds-preview.js"
        pj.write_text("/* preview stub */", encoding="utf-8")
        env["DFP_PREVIEW_JS"] = str(pj)
    r = fx.run_cli("scaffold", ds, env=env)
    return ds, r


class Scaffold(unittest.TestCase):
    def test_refuses_without_approval(self):
        with tempfile.TemporaryDirectory() as t:
            ds = Path(t) / "ds"
            (ds / "_analysis").mkdir(parents=True)
            r = fx.run_cli("scaffold", ds)
            self.assertEqual(r.returncode, 4)
            self.assertFalse((ds / "styles.css").exists())

    def test_tokens_honour_keep_and_edits(self):
        with tempfile.TemporaryDirectory() as t:
            ds, r = scaffold_into(t, approved())
            self.assertEqual(r.returncode, 0, r.stderr)
            css = (ds / "tokens" / "colors.css").read_text(encoding="utf-8")
            self.assertRegex(css, r"--color-ink:\s*#231F20;")
            self.assertRegex(css, r"--color-green:\s*#8DC63F;")
            self.assertNotIn("#123456", css)                      # dropped item absent
            self.assertRegex(css, r"--color-red:\s*#111111;")     # user edit wins over observed value
            self.assertNotIn("#D2232A", css)

    def test_typography_uses_substitute_never_font_files(self):
        with tempfile.TemporaryDirectory() as t:
            ds, r = scaffold_into(t, approved())
            typ = (ds / "tokens" / "typography.css").read_text(encoding="utf-8")
            self.assertIn("10.5", typ)
            fonts = (ds / "tokens" / "fonts.css").read_text(encoding="utf-8")
            self.assertRegex(fonts, r"@import url\(['\"]?https://fonts\.googleapis\.com/")
            shipped = [p for p in ds.rglob("*") if p.suffix.lower() in FONT_EXT]
            self.assertEqual(shipped, [])
            self.assertNotRegex(fonts + typ, r"@font-face[^}]*url\(")      # no local font binaries referenced

    def test_styles_css_is_import_only_and_closure_resolves(self):
        with tempfile.TemporaryDirectory() as t:
            ds, _ = scaffold_into(t, approved())
            lines = [l.strip() for l in (ds / "styles.css").read_text(encoding="utf-8").splitlines() if l.strip()]
            self.assertTrue(lines)
            self.assertTrue(all(l.startswith("@import") for l in lines), lines)
            for l in lines:
                m = re.search(r"url\(['\"]?([^'\")]+)", l) or re.search(r"@import\s+['\"]([^'\"]+)", l)
                self.assertTrue((ds / m.group(1)).is_file(), m.group(1))

    def test_print_medium_gets_page_css_and_no_motion(self):
        with tempfile.TemporaryDirectory() as t:
            ds, _ = scaffold_into(t, approved(("publication-print",)))
            page = (ds / "tokens" / "page.css").read_text(encoding="utf-8")
            self.assertIn("@page", page)
            self.assertIn("595pt", page)
            self.assertFalse((ds / "tokens" / "motion.css").exists())
            self.assertFalse((ds / "tokens" / "elevation.css").exists())    # no SHD items kept
            self.assertIn("page.css", (ds / "styles.css").read_text(encoding="utf-8"))

    def test_web_medium_has_no_page_css(self):
        with tempfile.TemporaryDirectory() as t:
            ds, r = scaffold_into(t, approved(("web-ui",)))
            self.assertEqual(r.returncode, 0, r.stdout + r.stderr)      # scaffold must have run, or "absent" proves nothing
            self.assertTrue((ds / "tokens").is_dir())
            self.assertFalse((ds / "tokens" / "page.css").exists())

    def test_provenance_sidecar_covers_every_token(self):
        with tempfile.TemporaryDirectory() as t:
            ds, _ = scaffold_into(t, approved())
            prov = json.loads((ds / "provenance.json").read_text(encoding="utf-8"))
            tokens = set()
            for f in (ds / "tokens").glob("*.css"):
                tokens |= set(re.findall(r"(--[\w-]+)\s*:", f.read_text(encoding="utf-8")))
            self.assertTrue(tokens)
            self.assertEqual(tokens - set(prov), set())
            self.assertEqual(prov["--color-ink"]["id"], "COL-001")
            self.assertEqual(prov["--color-ink"]["status"], "observed")
            self.assertEqual(prov["--color-ink"]["evidence"], "p.1-3")
            self.assertEqual(prov["--color-red"]["status"], "observed")
            self.assertTrue(prov["--color-red"].get("edited"))

    def test_manifest_preview_and_gitignore(self):
        with tempfile.TemporaryDirectory() as t:
            ds, _ = scaffold_into(t, approved())
            man = json.loads((ds / "_ds_manifest.json").read_text(encoding="utf-8"))
            self.assertIn("namespace", man)
            self.assertEqual(man["components"], [])
            self.assertEqual((ds / "_ds_preview.js").read_text(encoding="utf-8"), "/* preview stub */")
            self.assertIn("renders/", (ds / "_analysis" / ".gitignore").read_text(encoding="utf-8"))

    def test_preview_js_defaults_to_the_bundled_copy_not_a_sibling_skill(self):
        """Installed alone (no /design-generating next to it) the skill must still scaffold."""
        bundled = fx.SKILL_DIR / "assets" / "ds-preview.js"
        with tempfile.TemporaryDirectory() as t:
            ds, r = scaffold_into(t, approved(), preview=False)
            self.assertEqual(r.returncode, 0, r.stdout + r.stderr)
            self.assertTrue(bundled.is_file(), "assets/ds-preview.js must be bundled with the skill")
            self.assertEqual((ds / "_ds_preview.js").read_bytes(), bundled.read_bytes())

    def test_explicit_preview_override_to_missing_file_is_blocked(self):
        with tempfile.TemporaryDirectory() as t:
            ds, _ = scaffold_into(t, approved())
            r = fx.run_cli("scaffold", ds, env={"DFP_PREVIEW_JS": str(Path(t) / "nope.js")})
            self.assertEqual(r.returncode, 3)
            self.assertIn("ds-preview", r.stdout + r.stderr)

    def test_slugify(self):
        s = fx.mod("dfp.scaffold").slugify
        self.assertEqual(s("Ink"), "ink")
        self.assertEqual(s("Green / Tint (light)"), "green-tint-light")
        self.assertEqual(s("  ¡Fiesta! "), "fiesta")


class Validate(unittest.TestCase):
    def _v(self, ds):
        return fx.mod("dfp.validate").validate_ds(ds)

    def _codes(self, ds):
        return sorted({v["code"] for v in self._v(ds)})

    def _mut(self, mutate, **kw):
        with tempfile.TemporaryDirectory() as t:
            ds = fx.make_valid_ds(Path(t) / "ds", **kw)
            mutate(ds)
            return self._codes(ds)

    def test_valid_ds_has_zero_violations(self):
        with tempfile.TemporaryDirectory() as t:
            ds = fx.make_valid_ds(Path(t) / "ds")
            self.assertEqual(self._v(ds), [])

    def test_styles_css_not_import_only(self):
        c = self._mut(lambda d: (d / "styles.css").write_text(
            "@import url('./tokens/colors.css');\nbody { color: red; }\n"))
        self.assertIn("STYLES_NOT_IMPORT_ONLY", c)

    def test_import_unresolved(self):
        c = self._mut(lambda d: (d / "styles.css").write_text("@import url('./tokens/nope.css');\n"))
        self.assertIn("IMPORT_UNRESOLVED", c)

    def test_card_without_dscard_line(self):
        c = self._mut(lambda d: (d / "guidelines" / "colors.card.html").write_text("<div></div>\n"))
        self.assertIn("CARD_NO_DSCARD", c)

    def test_component_missing_contract_files(self):
        c = self._mut(lambda d: (d / "components/page/Folio.d.ts").unlink())
        self.assertIn("COMPONENT_NO_DTS", c)
        c = self._mut(lambda d: (d / "components/page/Folio.prompt.md").unlink())
        self.assertIn("COMPONENT_NO_PROMPT", c)

    def test_manifest_missing_component(self):
        c = self._mut(lambda d: (d / "_ds_manifest.json").write_text(json.dumps({"namespace": "x", "components": []})))
        self.assertIn("MANIFEST_MISSING_COMPONENT", c)

    def test_web_only_component_in_print_ds(self):
        def add(d):
            (d / "components/feedback").mkdir(parents=True)
            (d / "components/feedback/Toast.jsx").write_text("export function Toast(){return null}\n")
            (d / "components/feedback/Toast.d.ts").write_text("export interface ToastProps {}\n")
            (d / "components/feedback/Toast.prompt.md").write_text("Toast.\n")
            m = json.loads((d / "_ds_manifest.json").read_text())
            m["components"].append({"name": "Toast", "sourcePath": "components/feedback/Toast.jsx"})
            (d / "_ds_manifest.json").write_text(json.dumps(m))
        self.assertIn("WEB_ONLY_COMPONENT_FOR_PRINT", self._mut(add))
        self.assertNotIn("WEB_ONLY_COMPONENT_FOR_PRINT", self._mut(add, medium=("web-ui",)))

    def test_web_only_artifacts_in_print_ds(self):
        c = self._mut(lambda d: (d / "tokens" / "motion.css").write_text(":root{--ease:ease;}"))
        self.assertIn("WEB_ONLY_ARTIFACT", c)
        c = self._mut(lambda d: (d / "store").mkdir())
        self.assertIn("WEB_ONLY_ARTIFACT", c)

    def test_font_binary_shipped(self):
        def add(d):
            (d / "assets").mkdir(exist_ok=True)
            (d / "assets" / "OfficinaSansStd-Book.ttf").write_bytes(b"\0\1\0\0")
        self.assertIn("FONT_BINARY_SHIPPED", self._mut(add))

    def test_content_image_shipped(self):
        from PIL import Image

        def photo(d):
            Image.new("RGB", (1200, 800), "red").save(d / "assets" / "photo.jpg")
        self.assertIn("CONTENT_IMAGE_SHIPPED", self._mut(photo))

        def big_png(d):
            Image.new("RGB", (1200, 800), "red").save(d / "assets" / "page.png")
        self.assertIn("CONTENT_IMAGE_SHIPPED", self._mut(big_png))

        def small_mark(d):
            Image.new("RGBA", (64, 64), "red").save(d / "assets" / "icon.png")
        self.assertNotIn("CONTENT_IMAGE_SHIPPED", self._mut(small_mark))

    def test_readme_sections_required(self):
        def strip(d):
            t = (d / "readme.md").read_text().replace("## Iconography", "## Other")
            (d / "readme.md").write_text(t)
        v = self._mut(strip)
        self.assertIn("README_SECTION_MISSING", v)

    def test_provenance_required_for_every_token(self):
        c = self._mut(lambda d: (d / "provenance.json").write_text("{}"))
        self.assertIn("PROVENANCE_MISSING", c)

    def test_inferred_items_must_be_listed_in_intentional_additions(self):
        def infer(d):
            (d / "tokens" / "typography.css").write_text(":root{--text-scale: 1.2;}\n")
            (d / "styles.css").write_text("@import url('./tokens/colors.css');\n@import url('./tokens/typography.css');\n")
            p = json.loads((d / "provenance.json").read_text())
            p["--text-scale"] = {"id": "TYP-009", "status": "inferred", "evidence": "ratio fit", "source": "pdf"}
            (d / "provenance.json").write_text(json.dumps(p))
        self.assertIn("INFERRED_NOT_LISTED", self._mut(infer))

        def infer_listed(d):
            infer(d)
            r = (d / "readme.md").read_text().replace("## Intentional additions\n\ntext",
                                                       "## Intentional additions\n\n- TYP-009 type scale (inferred)")
            (d / "readme.md").write_text(r)
        self.assertNotIn("INFERRED_NOT_LISTED", self._mut(infer_listed))

    def test_skill_md_and_analysis_ignore(self):
        self.assertIn("SKILL_MD_MISSING", self._mut(lambda d: (d / "SKILL.md").unlink()))
        self.assertIn("ANALYSIS_NOT_IGNORED", self._mut(lambda d: (d / "_analysis" / ".gitignore").write_text("")))

    def test_violation_shape_and_cli_exit_codes(self):
        with tempfile.TemporaryDirectory() as t:
            ds = fx.make_valid_ds(Path(t) / "ds")
            r = fx.run_cli("validate", ds)
            self.assertEqual(r.returncode, 0, r.stdout + r.stderr)
            (ds / "SKILL.md").unlink()
            r = fx.run_cli("validate", ds)
            self.assertEqual(r.returncode, 5)
            report = json.loads(r.stdout)
            self.assertEqual(report["violations"][0].keys() >= {"code", "path", "message"}, True)


if __name__ == "__main__":
    unittest.main()
