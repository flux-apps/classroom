"""AC15 Installable anywhere: the skill directory IS the package.

The skill will be packaged as a Claude skill and installed into environments that have no `.tlk/`, no `talaka/`,
no `/design-generating`, a read-only skill dir, and a different current directory. These tests pin that.
  allow-list      only packaged files live under .claude/skills/design-from-pdf/ (tests/examples/venv live elsewhere)
  no coupling     no code path references this repo, the kit, or a drive letter
  relocation      a copy of the skill dir, outside the repo, runs probe + scaffold and writes nothing into itself
  package.sh      tools/package.sh (project root, support) zips exactly the allow-listed files
Real Windows/macOS/Linux matrix and the Python>=3.9 gate are not unit-tested -> tech-plan gaps G7/G8.
"""
import json
import os
import re
import shutil
import subprocess
import tempfile
import unittest
import zipfile
from pathlib import Path

from tests import fixtures as fx
from tests.test_scaffold_validate import approved

TOP_FILES = {"SKILL.md", "requirements.txt", "bootstrap.sh", "dfp.sh", "NOTICE.md"}
TOP_DIRS = {"dfp", "assets"}


def _files(root):
    return sorted(p.relative_to(root).as_posix() for p in Path(root).rglob("*")
                  if p.is_file() and "__pycache__" not in p.parts and p.suffix != ".pyc")


class Allowlist(unittest.TestCase):
    def test_skill_dir_has_only_packaged_files(self):
        stray = []
        for rel in _files(fx.SKILL_DIR):
            parts = rel.split("/")
            ok = (len(parts) == 1 and parts[0] in TOP_FILES) or (len(parts) > 1 and parts[0] in TOP_DIRS)
            if not ok:
                stray.append(rel)
        self.assertEqual(stray, [], "not part of the package (move to tests/, tools/ or the data dir): %s" % stray)

    def test_no_venv_tests_or_examples_inside_skill_dir(self):
        for name in (".venv", "venv", "tests", "examples", ".tlk", ".gitignore"):
            self.assertFalse((fx.SKILL_DIR / name).exists(), name)

    def test_required_package_files_present(self):
        for rel in ("SKILL.md", "requirements.txt", "bootstrap.sh", "dfp.sh", "assets/ds-preview.js",
                    "dfp/__main__.py"):
            self.assertTrue((fx.SKILL_DIR / rel).is_file(), rel)

    def test_notice_discloses_agpl_dependency(self):
        n = fx.SKILL_DIR / "NOTICE.md"
        self.assertTrue(n.is_file(), "NOTICE.md missing")
        low = n.read_text(encoding="utf-8").lower()
        self.assertIn("pymupdf", low)
        self.assertIn("agpl", low)
        self.assertIn("not vendored", low)


class NoCoupling(unittest.TestCase):
    FORBIDDEN = (r"\.tlk\b", r"\btalaka\b", r"\bclassroom\b", r"\.claude/skills", r"\b[A-Za-z]:[\\/]",
                 r"/Users/", r"/home/\w+")

    def test_code_and_scripts_do_not_reference_repo_kit_or_absolute_paths(self):
        targets = list((fx.SKILL_DIR / "dfp").rglob("*.py")) + [fx.SKILL_DIR / "bootstrap.sh", fx.SKILL_DIR / "dfp.sh"]
        existing = [p for p in targets if p.is_file()]
        self.assertTrue(existing, "nothing built yet")
        hits = []
        for p in existing:
            text = p.read_text(encoding="utf-8")
            for pat in self.FORBIDDEN:
                for m in re.finditer(pat, text):
                    hits.append("%s: %s" % (p.relative_to(fx.SKILL_DIR).as_posix(), m.group(0)))
        self.assertEqual(hits, [])

    def test_runtime_writes_go_to_user_paths_not_skill_dir(self):
        py = [p.read_text(encoding="utf-8") for p in (fx.SKILL_DIR / "dfp").rglob("*.py")]
        self.assertTrue(py)
        joined = "\n".join(py)
        self.assertNotRegex(joined, r"__file__[^\n]{0,80}\.(write|mkdir)", "writes next to the module")


class Relocation(unittest.TestCase):
    """Copy the skill dir to a throwaway 'install' location with nothing of this repo around it."""

    def _install(self, t):
        inst = Path(t) / "installed" / "design-from-pdf"
        shutil.copytree(fx.SKILL_DIR, inst, ignore=shutil.ignore_patterns("__pycache__", "*.pyc", ".venv"))
        return inst

    def _cli(self, inst, cwd, *args, env=None):
        e = {"PYTHONPATH": str(inst), "PYTHONDONTWRITEBYTECODE": "1"}
        e.update(env or {})
        return fx.run_cli(*args, cwd=cwd, env=e)

    def test_probe_from_relocated_copy_with_foreign_cwd(self):
        with tempfile.TemporaryDirectory() as t:
            inst, work = self._install(t), Path(t) / "work"
            work.mkdir()
            pdf = fx.make_vector_pdf(Path(t) / "src.pdf")
            before = _files(inst)
            r = self._cli(inst, work, "probe", pdf)
            self.assertEqual(r.returncode, 0, r.stdout + r.stderr)
            self.assertIn("pdf_type", json.loads(r.stdout))
            self.assertEqual(_files(inst), before, "skill dir was written to")
            self.assertEqual(list(work.iterdir()), [], "stray files in cwd")

    def test_scaffold_from_relocated_copy_uses_bundled_preview_without_siblings(self):
        with tempfile.TemporaryDirectory() as t:
            inst = self._install(t)
            self.assertFalse((inst.parent / "design-generating").exists())
            ds = Path(t) / "ds"
            (ds / "_analysis").mkdir(parents=True)
            (ds / "_analysis" / "approved.json").write_text(json.dumps(approved()), encoding="utf-8")
            before = _files(inst)
            r = self._cli(inst, Path(t), "scaffold", ds)
            self.assertEqual(r.returncode, 0, r.stdout + r.stderr)
            self.assertTrue((ds / "_ds_preview.js").is_file())
            self.assertEqual(_files(inst), before, "skill dir was written to")

    def test_scripts_resolve_their_own_directory_not_the_cwd(self):
        """dfp.sh / bootstrap.sh invoked by absolute path from a foreign cwd must find requirements.txt."""
        if not shutil.which("bash"):
            self.skipTest("bash not on PATH")
        with tempfile.TemporaryDirectory() as t:
            inst = self._install(t)
            work = Path(t) / "elsewhere"
            work.mkdir()
            env = dict(os.environ, DFP_HOME=str(Path(t) / "home"), DFP_VENV_DIR="")
            r = subprocess.run(["bash", str(inst / "bootstrap.sh"), "--print-venv"], cwd=str(work),
                               capture_output=True, text=True, env=env, timeout=60)
            self.assertEqual(r.returncode, 0, r.stdout + r.stderr)
            self.assertTrue(r.stdout.strip().splitlines()[-1].replace("\\", "/").startswith(
                str(Path(t) / "home").replace("\\", "/")))


class PackageScript(unittest.TestCase):
    SCRIPT = fx.REPO_ROOT / "tools" / "package.sh"

    def test_package_zip_contains_exactly_the_allowlisted_files(self):
        if not shutil.which("bash"):
            self.skipTest("bash not on PATH")
        self.assertTrue(self.SCRIPT.is_file(), "tools/package.sh missing")
        with tempfile.TemporaryDirectory() as t:
            env = dict(os.environ, DFP_DIST=str(Path(t) / "dist"))
            r = subprocess.run(["bash", str(self.SCRIPT)], capture_output=True, text=True, env=env,
                               cwd=str(fx.REPO_ROOT), timeout=120)
            self.assertEqual(r.returncode, 0, r.stdout + r.stderr)
            z = Path(t) / "dist" / "design-from-pdf.zip"
            self.assertTrue(z.is_file())
            names = sorted(n for n in zipfile.ZipFile(z).namelist() if not n.endswith("/"))
            self.assertIn("design-from-pdf/SKILL.md", names)
            expected = sorted("design-from-pdf/" + f for f in _files(fx.SKILL_DIR))
            self.assertEqual(names, expected)
            for bad in ("tests/", "examples/", ".venv", ".tlk", "__pycache__", ".pyc"):
                self.assertFalse([n for n in names if bad in n], bad)

    def test_package_refuses_when_skill_dir_has_stray_files(self):
        """Packaging must fail loudly rather than ship a venv or test data."""
        if not shutil.which("bash"):
            self.skipTest("bash not on PATH")
        self.assertTrue(self.SCRIPT.is_file(), "tools/package.sh missing")
        with tempfile.TemporaryDirectory() as t:
            stage = Path(t) / "repo"
            (stage / "tools").mkdir(parents=True)
            shutil.copy(self.SCRIPT, stage / "tools" / "package.sh")
            skill = stage / ".claude" / "skills" / "design-from-pdf"
            shutil.copytree(fx.SKILL_DIR, skill, ignore=shutil.ignore_patterns("__pycache__", "*.pyc", ".venv"))
            (skill / "tests").mkdir()
            (skill / "tests" / "x.py").write_text("")
            env = dict(os.environ, DFP_DIST=str(Path(t) / "dist"))
            r = subprocess.run(["bash", str(stage / "tools" / "package.sh")], capture_output=True, text=True,
                               env=env, cwd=str(stage), timeout=120)
            self.assertNotEqual(r.returncode, 0)
            self.assertFalse((Path(t) / "dist" / "design-from-pdf.zip").exists())


if __name__ == "__main__":
    unittest.main()
