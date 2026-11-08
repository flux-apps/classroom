"""AC14 Output fidelity: does the produced design system reflect the source PDF? (dfp.verify + validate rules)

Layers (what is machine-checked vs. judged):
  token_fidelity   deterministic  kept approved items == values in tokens/*.css (exact; user edits win)
  compose_pair     deterministic  PDF crop | rendered component, side by side, for Claude to LOOK at
  colour_drift     deterministic  numeric palette distance crop vs render (a tripwire, not a verdict)
  verify_ds        orchestration  pairs every component that declares `source_clusters`; the browser is injected
                                  (`shoot(url, out_png, size)`) so no browser/network is needed in tests
  verify.md        judgement      Claude's per-component verdict; `validate` rejects missing/unresolved/undisclosed
Real browser rendering (system Edge/Chrome via a local http server) is NOT unit-tested -> tech-plan gap G6.
"""
import json
import tempfile
import unittest
from pathlib import Path

from tests import fixtures as fx
from tests.test_scaffold_validate import approved, scaffold_into


def _png(path, color, size=(120, 80)):
    from PIL import Image
    Image.new("RGB", size, color).save(path)
    return Path(path)


class TokenFidelity(unittest.TestCase):
    def _scaffolded(self, t):
        ds, r = scaffold_into(t, approved())
        self.assertEqual(r.returncode, 0, r.stderr)
        return ds

    def test_clean_scaffold_matches_every_kept_colour(self):
        with tempfile.TemporaryDirectory() as t:
            res = fx.mod("dfp.verify").token_fidelity(self._scaffolded(t))
            self.assertEqual(res["mismatches"], [])
            self.assertEqual(res["missing"], [])
            self.assertGreaterEqual(res["checked"], 3)        # COL-001, COL-002, COL-004 (edited) at least
            self.assertEqual(res["matched"], res["checked"])

    def test_changed_token_is_a_mismatch_naming_expected_and_found(self):
        with tempfile.TemporaryDirectory() as t:
            ds = self._scaffolded(t)
            css = ds / "tokens" / "colors.css"
            css.write_text(css.read_text(encoding="utf-8").replace("#8DC63F", "#8DC640"), encoding="utf-8")
            res = fx.mod("dfp.verify").token_fidelity(ds)
            self.assertEqual([m["id"] for m in res["mismatches"]], ["COL-002"])
            self.assertEqual((res["mismatches"][0]["expected"].upper(), res["mismatches"][0]["found"].upper()),
                             ("#8DC63F", "#8DC640"))

    def test_user_edit_is_the_expected_value_not_the_original(self):
        with tempfile.TemporaryDirectory() as t:
            ds = self._scaffolded(t)                           # COL-004 edited: original #D2232A -> kept #111111
            res = fx.mod("dfp.verify").token_fidelity(ds)
            self.assertNotIn("COL-004", [m["id"] for m in res["mismatches"]])

    def test_dropped_items_are_not_required(self):
        with tempfile.TemporaryDirectory() as t:
            res = fx.mod("dfp.verify").token_fidelity(self._scaffolded(t))
            self.assertNotIn("COL-003", res["missing"])

    def test_deleted_token_is_reported_missing(self):
        with tempfile.TemporaryDirectory() as t:
            ds = self._scaffolded(t)
            css = ds / "tokens" / "colors.css"
            css.write_text("\n".join(l for l in css.read_text(encoding="utf-8").splitlines()
                                     if "#231F20" not in l), encoding="utf-8")
            self.assertIn("COL-001", fx.mod("dfp.verify").token_fidelity(ds)["missing"])


class Pairs(unittest.TestCase):
    def test_compose_pair_is_side_by_side_with_label_band(self):
        from PIL import Image
        v = fx.mod("dfp.verify")
        with tempfile.TemporaryDirectory() as t:
            t = Path(t)
            a, b = _png(t / "a.png", "#8DC63F", (120, 80)), _png(t / "b.png", "#D2232A", (100, 60))
            out = v.compose_pair(a, b, t / "pair.png", "Callout: PDF | design system")
            w, h = Image.open(out).size
            self.assertGreaterEqual(w, 120 + 100)              # both panes present, gutter allowed
            self.assertGreater(h, 80)                          # tallest pane + label band
            im = Image.open(out).convert("RGB")
            self.assertEqual(im.getpixel((10, h - 10)), (141, 198, 63))    # left pane = PDF crop colour

    def test_colour_drift_zero_for_same_and_large_for_different(self):
        v = fx.mod("dfp.verify")
        with tempfile.TemporaryDirectory() as t:
            t = Path(t)
            g1, g2 = _png(t / "g1.png", "#8DC63F"), _png(t / "g2.png", "#8DC63F", (200, 90))
            r = _png(t / "r.png", "#D2232A")
            self.assertLess(v.colour_drift(g1, g2), 1.0)
            self.assertGreater(v.colour_drift(g1, r), 20.0)

    def test_find_browser_honours_override_and_never_raises(self):
        v = fx.mod("dfp.verify")
        with tempfile.TemporaryDirectory() as t:
            stub = Path(t) / "browser.exe"
            stub.write_bytes(b"")
            self.assertEqual(Path(v.find_browser({"DFP_BROWSER": str(stub)})), stub)
            self.assertIsNone(v.find_browser({"DFP_BROWSER": str(Path(t) / "nope.exe"), "DFP_NO_BROWSER_SEARCH": "1"}))


def _ds_with_clusters(t, source_clusters=("CL-001",)):
    """valid ds + a real synthetic PDF + clusters.json pointing at a region of page 1."""
    t = Path(t)
    pdf = fx.make_vector_pdf(t / "src.pdf", pages=2)
    ds = fx.make_valid_ds(t / "ds")
    (ds / "_ds_manifest.json").write_text(json.dumps({"namespace": "DS_test", "components": [
        {"name": "Folio", "sourcePath": "components/page/Folio.jsx", "source_clusters": list(source_clusters)}]}),
        encoding="utf-8")
    (ds / "_analysis" / "clusters.json").write_text(json.dumps({"clusters": [
        {"id": "CL-001", "kind": "shape", "occurrences": 2, "pages": [1, 2],
         "samples": [{"page": 1, "bbox": [40, 100, 200, 200]}]}]}), encoding="utf-8")
    return ds, pdf


class VerifyDs(unittest.TestCase):
    def _shoot(self, color="#8DC63F"):
        calls = []

        def shoot(url, out_png, size):
            calls.append((url, Path(out_png).name, size))
            _png(out_png, color, (size[0] // 2, size[1] // 2))
        shoot.calls = calls
        return shoot

    def test_pairs_every_component_with_a_source_cluster(self):
        v = fx.mod("dfp.verify")
        with tempfile.TemporaryDirectory() as t:
            ds, pdf = _ds_with_clusters(t)
            shoot = self._shoot()
            rep = v.verify_ds(ds, pdf, shoot=shoot)
            self.assertEqual(rep["visual"], "performed")
            self.assertEqual([p["component"] for p in rep["pairs"]], ["Folio"])
            p = rep["pairs"][0]
            self.assertTrue((ds / "_analysis" / "verify" / p["sheet"]).is_file())
            self.assertIsInstance(p["colour_drift"], float)
            self.assertEqual(p["source_clusters"], ["CL-001"])
            self.assertEqual(len(shoot.calls), 1)
            self.assertTrue((ds / "_analysis" / "verify" / "report.json").is_file())

    def test_component_without_source_is_listed_unpaired_not_skipped_silently(self):
        v = fx.mod("dfp.verify")
        with tempfile.TemporaryDirectory() as t:
            ds, pdf = _ds_with_clusters(t, source_clusters=())
            rep = v.verify_ds(ds, pdf, shoot=self._shoot())
            self.assertEqual(rep["pairs"], [])
            self.assertEqual(rep["unpaired"], ["Folio"])

    def test_unknown_cluster_id_is_reported(self):
        v = fx.mod("dfp.verify")
        with tempfile.TemporaryDirectory() as t:
            ds, pdf = _ds_with_clusters(t, source_clusters=("CL-999",))
            rep = v.verify_ds(ds, pdf, shoot=self._shoot())
            self.assertIn("Folio", rep["unpaired"])
            self.assertTrue(rep["problems"])

    def test_no_browser_is_a_disclosed_degrade_not_a_failure(self):
        v = fx.mod("dfp.verify")
        with tempfile.TemporaryDirectory() as t:
            ds, pdf = _ds_with_clusters(t)
            rep = v.verify_ds(ds, pdf, shoot=None)             # None = no browser available
            self.assertEqual(rep["visual"], "skipped")
            self.assertTrue(rep["reason"])
            self.assertEqual(rep["pairs"], [])
            self.assertIn("tokens", rep)                       # deterministic layer still ran

    def test_render_failure_is_skipped_with_reason_never_a_fake_pair(self):
        v = fx.mod("dfp.verify")
        with tempfile.TemporaryDirectory() as t:
            ds, pdf = _ds_with_clusters(t)

            def boom(url, out_png, size):
                raise OSError("net::ERR_INTERNET_DISCONNECTED")
            rep = v.verify_ds(ds, pdf, shoot=boom)
            self.assertEqual(rep["visual"], "skipped")
            self.assertIn("ERR_INTERNET_DISCONNECTED", rep["reason"])
            self.assertEqual(rep["pairs"], [])


class VerifyCli(unittest.TestCase):
    def test_token_mismatch_exits_5_with_json_report(self):
        with tempfile.TemporaryDirectory() as t:
            ds, r = scaffold_into(t, approved())
            css = ds / "tokens" / "colors.css"
            css.write_text(css.read_text(encoding="utf-8").replace("#231F20", "#000000"), encoding="utf-8")
            pdf = fx.make_vector_pdf(Path(t) / "src.pdf")
            r = fx.run_cli("verify", ds, "--pdf", pdf, env={"DFP_NO_BROWSER_SEARCH": "1", "DFP_BROWSER": ""})
            self.assertEqual(r.returncode, 5, r.stdout + r.stderr)
            rep = json.loads(r.stdout)
            self.assertEqual(rep["visual"], "skipped")
            self.assertEqual(rep["tokens"]["mismatches"][0]["id"], "COL-001")

    def test_clean_tokens_and_no_browser_exits_0_and_says_skipped(self):
        with tempfile.TemporaryDirectory() as t:
            ds, r = scaffold_into(t, approved())
            pdf = fx.make_vector_pdf(Path(t) / "src.pdf")
            r = fx.run_cli("verify", ds, "--pdf", pdf, env={"DFP_NO_BROWSER_SEARCH": "1", "DFP_BROWSER": ""})
            self.assertEqual(r.returncode, 0, r.stdout + r.stderr)
            self.assertEqual(json.loads(r.stdout)["visual"], "skipped")

    def test_missing_pdf_is_blocked_exit_3(self):
        with tempfile.TemporaryDirectory() as t:
            ds, r = scaffold_into(t, approved())
            r = fx.run_cli("verify", ds, "--pdf", Path(t) / "nope.pdf")
            self.assertEqual(r.returncode, 3)


class ValidateVerifyRules(unittest.TestCase):
    def _codes(self, mutate):
        with tempfile.TemporaryDirectory() as t:
            ds = fx.make_valid_ds(Path(t) / "ds")
            mutate(ds)
            r = fx.run_cli("validate", ds)
            # validate exits 0 (clean) or 5 (violations); anything else, or empty stdout, is a crash, not "no violations"
            self.assertIn(r.returncode, (0, 5), r.stdout + r.stderr)
            self.assertTrue(r.stdout.strip(), "validate printed nothing: " + r.stderr)
            return {v["code"] for v in json.loads(r.stdout).get("violations", [])}

    def test_verify_md_required(self):
        self.assertIn("VERIFY_MISSING", self._codes(lambda d: (d / "_analysis" / "verify.md").unlink()))

    def test_unresolved_drift_blocks(self):
        def drift(d):
            p = d / "_analysis" / "verify.md"
            p.write_text(p.read_text(encoding="utf-8") + "- Callout | drift | corner radius 4px vs 10pt in PDF\n",
                         encoding="utf-8")
        self.assertIn("VERIFY_UNRESOLVED", self._codes(drift))

    def test_fixed_and_match_rows_pass(self):
        def fixed(d):
            p = d / "_analysis" / "verify.md"
            p.write_text(p.read_text(encoding="utf-8") + "- Callout | fixed | radius corrected, re-verified\n",
                         encoding="utf-8")
        self.assertNotIn("VERIFY_UNRESOLVED", self._codes(fixed))

    def test_skipped_visual_must_be_disclosed_in_readme_gaps(self):
        def skipped(d):
            (d / "_analysis" / "verify.md").write_text(
                "# Verification\n\nVisual: skipped (no browser)\n", encoding="utf-8")
        self.assertIn("VERIFY_SKIP_NOT_DISCLOSED", self._codes(skipped))

        def disclosed(d):
            skipped(d)
            r = (d / "readme.md").read_text(encoding="utf-8").replace(
                "## Substitutions & gaps\n\ntext", "## Substitutions & gaps\n\n- Visual verification not performed (no browser)")
            (d / "readme.md").write_text(r, encoding="utf-8")
        self.assertNotIn("VERIFY_SKIP_NOT_DISCLOSED", self._codes(disclosed))

    def test_verify_dir_must_be_gitignored(self):
        self.assertIn("ANALYSIS_NOT_IGNORED",
                      self._codes(lambda d: (d / "_analysis" / ".gitignore").write_text("renders/\n")))


class SkillProcedure(unittest.TestCase):
    """SKILL.md must make the visual loop part of the procedure (the LLM half no script can enforce)."""

    def test_skill_md_requires_viewing_pairs_and_recording_verdicts(self):
        skill = fx.SKILL_DIR / "SKILL.md"
        if not skill.is_file():
            self.fail("SKILL.md missing")
        text = skill.read_text(encoding="utf-8")
        for needle in ("dfp.sh verify", "verify.md", "side-by-side", "drift", "source_clusters"):
            self.assertIn(needle, text, needle)
        self.assertRegex(text, r"(?i)view(ing)? (each|every|all) (pair|sheet)")
        self.assertRegex(text, r"(?i)(at most|max(imum)?) (2|two) (fix )?(rounds|iterations)")


if __name__ == "__main__":
    unittest.main()
