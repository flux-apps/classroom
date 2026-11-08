"""Round 2 build side: tokens in target units (AC18), usage/composition artifacts and validate rules (AC19),
defects of round 1 (AC20), SKILL.md procedure (AC12/AC16/AC20c).

Pinned
  scaffold: structure rows -> tokens/spacing.css  --page-margin-top|right|bottom|left, --col-gap, --leading-body (pt).
            When web-ui is an enabled target every length token T (pt) also gets T-px and T-rem
            (1pt = 1.333px, 1rem = 16px; 3 decimals, trailing zeros cut). Print-only => no -px/-rem variants.
            provenance.json covers them (id = the STR-/SPC- item). `_analysis/substitutions.json` =
            [{family, substitute, kind, confidence}] (AC20a).
  validate: + COMPONENT_NO_USAGE (a component's prompt.md needs a non-empty `## Usage & composition` section),
            + COMPOSITION_CARD_MISSING (guidelines/composition.card.html with an @dsCard line, when any component exists),
            README_SECTION_MISSING also for `Layout & composition rules`; the web-only component rule keys on
            approved.json `targets` (fallback `medium` when absent): violation only when no target is web-ui.
  verify:   report.timing = {per_card: [{component, seconds}], total_seconds}; paths are absolute before the browser or
            any write; a component whose source cluster has usage.overlap.max > 0 or non-zero usage.rotation also gets a
            pair with kind "multi-instance" (crop = usage.multi_sample region).
"""
import json
import os
import re
import tempfile
import unittest
from pathlib import Path

from tests import fixtures as fx
from tests import fixtures_r2 as r2
from tests.test_verify import _ds_with_clusters, _png


# --------------------------------------------------------------------------- validate rules
class ValidateRound2(unittest.TestCase):
    def _codes(self, mutate=None, medium=("publication-print",)):
        with tempfile.TemporaryDirectory() as t:
            ds = fx.make_valid_ds(Path(t) / "ds", medium=medium)
            if mutate:
                mutate(ds)
            r = fx.run_cli("validate", ds)
            try:
                return {v["code"] for v in json.loads(r.stdout)["violations"]}
            except ValueError:
                self.fail(r.stdout + r.stderr)

    def test_baseline_is_clean(self):
        self.assertEqual(self._codes(), set())

    def test_usage_section_is_required_and_non_empty(self):
        prompt = lambda d: d / "components/page/Folio.prompt.md"
        self.assertIn("COMPONENT_NO_USAGE", self._codes(lambda d: prompt(d).write_text("Running footer.\n")))
        self.assertIn("COMPONENT_NO_USAGE", self._codes(
            lambda d: prompt(d).write_text("Running footer.\n\n## Usage & composition\n\n## Other\ntext\n")))

    def test_composition_card_is_required(self):
        self.assertIn("COMPOSITION_CARD_MISSING", self._codes(lambda d: (d / "guidelines/composition.card.html").unlink()))
        self.assertIn("COMPOSITION_CARD_MISSING", self._codes(
            lambda d: (d / "guidelines/composition.card.html").write_text("<div></div>\n")))

    def test_readme_needs_layout_and_composition_rules(self):
        def strip(d):
            (d / "readme.md").write_text((d / "readme.md").read_text().replace("## Layout & composition rules", "## Other"))
        self.assertIn("README_SECTION_MISSING", self._codes(strip))

    def test_web_only_component_follows_targets_not_source(self):
        def add(targets):
            def f(d):
                (d / "components/feedback").mkdir(parents=True)
                (d / "components/feedback/Toast.jsx").write_text("export function Toast(){return null}\n")
                (d / "components/feedback/Toast.d.ts").write_text("export interface ToastProps {}\n")
                (d / "components/feedback/Toast.prompt.md").write_text("Toast.\n\n## Usage & composition\n- Overlap: none.\n")
                m = json.loads((d / "_ds_manifest.json").read_text())
                m["components"].append({"name": "Toast", "sourcePath": "components/feedback/Toast.jsx"})
                (d / "_ds_manifest.json").write_text(json.dumps(m))
                ap = json.loads((d / "_analysis/approved.json").read_text())
                ap["targets"] = targets
                (d / "_analysis/approved.json").write_text(json.dumps(ap))
            return f
        self.assertIn("WEB_ONLY_COMPONENT_FOR_PRINT", self._codes(add(["publication-print"])))
        self.assertNotIn("WEB_ONLY_COMPONENT_FOR_PRINT", self._codes(add(["publication-print", "web-ui"])))


# --------------------------------------------------------------------------- scaffold in target units
class ScaffoldTargets(r2.R2Case):
    build = staticmethod(r2.make_structure_pdf)

    def _scaffold(self, text):
        am = self.a / "analysis.md"
        try:
            am.write_text(text, encoding="utf-8")
            g = fx.run_cli("gate", self.ds)
            self.assertEqual(g.returncode, 0, g.stdout + g.stderr)
            s = fx.run_cli("scaffold", self.ds)
            self.assertEqual(s.returncode, 0, s.stdout + s.stderr)
            tokens = "\n".join(p.read_text(encoding="utf-8") for p in sorted((self.ds / "tokens").glob("*.css")))
            prov = json.loads((self.ds / "provenance.json").read_text(encoding="utf-8"))
            subs = json.loads((self.a / "substitutions.json").read_text(encoding="utf-8"))
            return tokens, prov, subs
        finally:
            am.write_text(self.text0, encoding="utf-8")
            import shutil
            for rel in ("tokens", "styles.css", "provenance.json", "_ds_manifest.json", "_ds_preview.js"):
                p = self.ds / rel
                shutil.rmtree(p) if p.is_dir() else p.unlink(missing_ok=True)
            (self.a / "approved.json").unlink(missing_ok=True)
            (self.a / "substitutions.json").unlink(missing_ok=True)

    def test_structure_becomes_tokens_in_pt_px_rem(self):
        tokens, prov, subs = self._scaffold(self.approvable())
        for name in ("--page-margin-top", "--page-margin-right", "--page-margin-bottom", "--page-margin-left",
                     "--col-gap", "--leading-body"):
            self.assertRegex(tokens, r"%s:\s*[\d.]+pt" % re.escape(name))
            self.assertRegex(tokens, r"%s-px:\s*[\d.]+px" % re.escape(name))
            self.assertRegex(tokens, r"%s-rem:\s*[\d.]+rem" % re.escape(name))
            self.assertIn(name, prov)
            self.assertTrue(prov[name]["id"].startswith(("STR-", "SPC-")))
        m = re.search(r"--page-margin-left:\s*([\d.]+)pt", tokens)
        n = re.search(r"--page-margin-left-px:\s*([\d.]+)px", tokens)
        self.assertAlmostEqual(float(n.group(1)), float(m.group(1)) * 4 / 3, delta=0.01)

    def test_print_only_target_has_no_screen_units(self):
        tokens, prov, _ = self._scaffold(r2.set_header(self.approvable(), "Target media", "publication-print"))
        self.assertRegex(tokens, r"--page-margin-left:\s*[\d.]+pt")
        self.assertNotRegex(tokens, r"-px:|-rem:")

    def test_substitutions_json_is_written(self):
        _, _, subs = self._scaffold(self.approvable())
        self.assertTrue(subs)
        for row in subs:
            self.assertTrue({"family", "substitute", "kind", "confidence"} <= set(row), row)


# --------------------------------------------------------------------------- AC20 defects
class RelativePaths(unittest.TestCase):
    """KI-003: a relative <ds> or --pdf must work from any cwd."""

    def test_verify_resolves_paths_to_absolute_before_the_browser(self):
        seen = []

        def shoot(url, out_png, size):
            seen.append((url, out_png))
            _png(out_png, "#8DC63F", (size[0] // 2, size[1] // 2))

        with tempfile.TemporaryDirectory() as t:
            _ds_with_clusters(t)
            cwd = os.getcwd()
            os.chdir(t)
            try:
                rep = fx.mod("dfp.verify").verify_ds("ds", "src.pdf", shoot=shoot)
            finally:
                os.chdir(cwd)
            self.assertEqual(rep["visual"], "performed", rep)
            self.assertTrue(seen)
            for url, out in seen:
                self.assertTrue(os.path.isabs(str(out)), out)
                self.assertNotRegex(url, r"(^|/)\.\.?(/|$)")
            tm = rep["timing"]
            self.assertEqual(len(tm["per_card"]), 1)
            self.assertEqual(tm["per_card"][0]["component"], "Folio")
            self.assertIsInstance(tm["total_seconds"], float)

    def test_every_command_accepts_a_relative_ds(self):
        env = {"DFP_NO_BROWSER_SEARCH": "1", "DFP_BROWSER": ""}
        with tempfile.TemporaryDirectory() as t:
            ds, pdf = _ds_with_clusters(t)
            r = fx.run_cli("validate", "ds", cwd=t)
            self.assertEqual(r.returncode, 0, r.stdout + r.stderr)
            r = fx.run_cli("verify", "ds", "--pdf", "src.pdf", cwd=t, env=env)
            self.assertIn(r.returncode, (0, 5), r.stdout + r.stderr)
            self.assertNotIn("not found", r.stderr)
            self.assertEqual(json.loads(r.stdout)["tokens"]["checked"] >= 0, True)
            r = fx.run_cli("gate", "ds", cwd=t)
            self.assertEqual(r.returncode, 4)                      # no analysis.md: a gate answer, not a path crash
            self.assertIn("NO_ANALYSIS", r.stdout)


class MultiInstancePairs(unittest.TestCase):
    def _rep(self, usage):
        def shoot(url, out_png, size):
            _png(out_png, "#8DC63F", (size[0] // 2, size[1] // 2))
        with tempfile.TemporaryDirectory() as t:
            ds, pdf = _ds_with_clusters(t)
            cl = json.loads((ds / "_analysis/clusters.json").read_text())
            cl["clusters"][0]["usage"] = usage
            (ds / "_analysis/clusters.json").write_text(json.dumps(cl))
            rep = fx.mod("dfp.verify").verify_ds(ds, pdf, shoot=shoot)
            sheets = [(p, (ds / "_analysis/verify" / p["sheet"]).is_file()) for p in rep["pairs"]]
        return rep, sheets

    def test_overlap_or_rotation_adds_a_multi_instance_pair(self):
        for usage in ({"overlap": {"min": 0, "max": 0.2, "median": 0.1}, "rotation": {"min": 0, "max": 0},
                       "multi_sample": {"page": 1, "bbox": [40, 100, 300, 200]}},
                      {"overlap": {"min": 0, "max": 0, "median": 0}, "rotation": {"min": 90, "max": 90},
                       "multi_sample": {"page": 1, "bbox": [40, 100, 300, 200]}}):
            rep, sheets = self._rep(usage)
            kinds = [p.get("kind", "single") for p in rep["pairs"]]
            self.assertEqual(sorted(kinds), ["multi-instance", "single"], kinds)
            self.assertTrue(all(ok for _, ok in sheets))

    def test_no_overlap_no_rotation_means_no_extra_pair(self):
        rep, _ = self._rep({"overlap": {"min": 0, "max": 0, "median": 0}, "rotation": {"min": 0, "max": 0},
                            "multi_sample": None})
        self.assertEqual([p.get("kind", "single") for p in rep["pairs"]], ["single"])


# --------------------------------------------------------------------------- SKILL.md: procedure + parity (AC20c)
SKILL = fx.SKILL_DIR / "SKILL.md"
# files the procedure has Claude (or the browser step) author, not a dfp command
AUTHORED = ("readme.md", "SKILL.md", "components/", "guidelines/", "assets/", "_analysis/verify", "_analysis/analysis.prev.md",
            "_analysis/crops/", "_analysis/renders/", "index.js", "package.json")


class SkillProcedure(unittest.TestCase):
    def setUp(self):
        self.text = SKILL.read_text(encoding="utf-8")

    def test_round_2_procedure_is_documented(self):
        for needle in ("Target media", "Vision pass", "overlay-", "none missed", "found: vision", "UNC", "STR-", "TPL-",
                       "merge:", "split:", "Unclaimed threshold", "--force", "analysis.prev.md", "Usage & composition",
                       "composition.card.html", "Layout & composition rules", "adapted-from", "multi-instance"):
            self.assertIn(needle, self.text, needle)
        self.assertRegex(self.text, r"(?i)view every (overlay|page)")           # the vision pass is mandatory, not optional
        self.assertRegex(self.text, r"(?i)tools propose.{0,40}vision completes|vision (pass )?completes")

    def test_no_stale_round_1_limits(self):
        self.assertNotRegex(self.text, r"--max-pages|max_clusters|\b50 (rows|components)\b|\b150 clusters\b")

    def test_every_dfp_command_it_names_exists(self):
        named = set(re.findall(r"dfp\.sh (\w+)", self.text))
        for cmd in named:
            r = fx.run_cli(cmd, "--help")                               # argparse: rc 0 only for a real sub-command
            self.assertEqual(r.returncode, 0, "SKILL.md names `dfp.sh %s` but the CLI has no such command" % cmd)
        self.assertTrue({"analyze", "gate", "scaffold", "validate", "verify", "render"} <= named, named)


class SkillPathParity(r2.R2Case):
    """Every concrete path SKILL.md tells the user a dfp command produces must exist after analyze -> gate -> scaffold."""
    build = staticmethod(r2.make_structure_pdf)

    def test_named_paths_are_produced(self):
        text = SKILL.read_text(encoding="utf-8")
        named = set()
        for tok in re.findall(r"`([^`\s]+)`", text):
            tok = tok.strip(".,;:)")
            if re.search(r"[<>*{}]|NNN|\.\.\.", tok):
                continue
            if re.match(r"^(_analysis/|tokens/)[\w./-]+$", tok) or tok in (
                    "styles.css", "provenance.json", "_ds_manifest.json", "_ds_preview.js"):
                named.add(tok)
        self.assertGreaterEqual(len(named), 6, named)
        am = self.a / "analysis.md"
        try:
            am.write_text(self.approvable(), encoding="utf-8")
            self.assertEqual(fx.run_cli("gate", self.ds).returncode, 0)
            self.assertEqual(fx.run_cli("scaffold", self.ds).returncode, 0)
            missing = sorted(p for p in named
                             if not any(p.startswith(a) for a in AUTHORED) and not (self.ds / p).exists())
        finally:
            am.write_text(self.text0, encoding="utf-8")
        self.assertEqual(missing, [], "SKILL.md names paths no command produces")


if __name__ == "__main__":
    unittest.main()
