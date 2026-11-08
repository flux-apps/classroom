"""AC13 Self-contained install (bootstrap.sh) + structural guards on the skill itself (SKILL.md, requirements).

bootstrap.sh contract (env-overridable so it is testable offline):
  DFP_VENV_DIR      venv location, exact    (default <DFP_HOME>/venv-<sha256(requirements.txt)[:8]>)
  DFP_HOME          writable data dir        (default %LOCALAPPDATA%/design-from-pdf, else ${XDG_DATA_HOME:-~/.local/share}/design-from-pdf)
                    NEVER inside the skill dir: an installed skill may be read-only and is replaced on update
  --print-venv      print the resolved venv dir and exit 0 (no side effects)
  DFP_BASE_PYTHON   interpreter used to create the venv (default python3, python, py -3)
  stamp             <venv>/.requirements.sha256 = sha256 of requirements.txt
  fast path         venv python exists AND stamp matches  -> exit 0, NO base python, NO pip, NO network
  otherwise         create venv, `pip install -r requirements.txt`, write stamp
  failure           exit 3, message starts with 'blocked:', NO fallback to system python
"""
import hashlib
import os
import re
import shutil
import stat
import subprocess
import tempfile
import unittest
from pathlib import Path

from tests import fixtures as fx

BOOT = fx.SKILL_DIR / "bootstrap.sh"
REQ = fx.SKILL_DIR / "requirements.txt"


def _bash():
    b = shutil.which("bash")
    if not b:
        raise unittest.SkipTest("bash not on PATH")
    return b


def _fake_python(path, marker):
    """A python stand-in that records every invocation to `marker`."""
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text("#!/usr/bin/env bash\necho \"$@\" >> '%s'\nexit %d\n" % (marker.as_posix(), 0))
    path.chmod(path.stat().st_mode | stat.S_IEXEC)
    return path


def _run(env_extra, timeout=60, args=()):
    env = dict(os.environ)
    env.update(env_extra)
    return subprocess.run([_bash(), str(BOOT), *args], capture_output=True, text=True, env=env, timeout=timeout)


def _req_hash():
    return hashlib.sha256(REQ.read_bytes()).hexdigest()


class Bootstrap(unittest.TestCase):
    def test_script_exists(self):
        self.assertTrue(BOOT.is_file(), "bootstrap.sh missing")

    def test_fast_path_when_stamp_matches_touches_nothing(self):
        with tempfile.TemporaryDirectory() as t:
            t = Path(t)
            venv, marker = t / "venv", t / "calls.log"
            _fake_python(venv / "bin" / "python", marker)
            (venv / ".requirements.sha256").write_text(_req_hash() + "\n")
            base = _fake_python(t / "basepy", marker)
            r = _run({"DFP_VENV_DIR": str(venv), "DFP_BASE_PYTHON": str(base)})
            self.assertEqual(r.returncode, 0, r.stdout + r.stderr)
            self.assertFalse(marker.exists(), "fast path must not invoke python/pip: %s" %
                             (marker.read_text() if marker.exists() else ""))

    def test_stale_stamp_triggers_reinstall(self):
        with tempfile.TemporaryDirectory() as t:
            t = Path(t)
            venv, marker = t / "venv", t / "calls.log"
            _fake_python(venv / "bin" / "python", marker)
            (venv / ".requirements.sha256").write_text("deadbeef\n")
            base = _fake_python(t / "basepy", marker)
            r = _run({"DFP_VENV_DIR": str(venv), "DFP_BASE_PYTHON": str(base)})
            self.assertTrue(marker.exists(), "stale stamp must attempt an install")
            self.assertIn("-r", marker.read_text())          # pip install -r requirements.txt
            self.assertEqual(r.returncode, 0, r.stdout + r.stderr)
            self.assertEqual((venv / ".requirements.sha256").read_text().strip(), _req_hash())

    def test_print_venv_default_is_under_dfp_home_never_in_skill_dir(self):
        with tempfile.TemporaryDirectory() as t:
            home = Path(t) / "home"
            r = _run({"DFP_HOME": str(home), "DFP_VENV_DIR": ""}, args=("--print-venv",))
            self.assertEqual(r.returncode, 0, r.stdout + r.stderr)
            venv = Path(r.stdout.strip().splitlines()[-1])
            self.assertEqual(venv.name, "venv-" + _req_hash()[:8])     # keyed by requirements: update => new venv
            self.assertEqual(venv.parent.resolve(), home.resolve())
            self.assertNotIn(fx.SKILL_DIR.resolve(), venv.resolve().parents)
            self.assertFalse(home.exists(), "--print-venv must have no side effects")

    def test_print_venv_explicit_override_wins(self):
        with tempfile.TemporaryDirectory() as t:
            r = _run({"DFP_VENV_DIR": str(Path(t) / "mine"), "DFP_HOME": str(Path(t) / "home")}, args=("--print-venv",))
            self.assertEqual(Path(r.stdout.strip().splitlines()[-1]).resolve(), (Path(t) / "mine").resolve())

    def test_fast_path_resolves_default_location_from_dfp_home(self):
        with tempfile.TemporaryDirectory() as t:
            t = Path(t)
            venv, marker = t / "home" / ("venv-" + _req_hash()[:8]), t / "calls.log"
            _fake_python(venv / "bin" / "python", marker)
            (venv / ".requirements.sha256").write_text(_req_hash() + "\n")
            r = _run({"DFP_HOME": str(t / "home"), "DFP_VENV_DIR": "", "DFP_BASE_PYTHON": str(_fake_python(t / "b", marker))})
            self.assertEqual(r.returncode, 0, r.stdout + r.stderr)
            self.assertFalse(marker.exists(), "default location must hit the fast path")

    def test_bootstrap_writes_nothing_into_the_skill_dir(self):
        before = sorted(p.relative_to(fx.SKILL_DIR).as_posix() for p in fx.SKILL_DIR.rglob("*")
                        if "__pycache__" not in p.parts)
        self.assertTrue(BOOT.is_file(), "bootstrap.sh missing: nothing was exercised")
        with tempfile.TemporaryDirectory() as t:
            r = _run({"DFP_HOME": str(Path(t) / "home"), "DFP_VENV_DIR": "", "DFP_BASE_PYTHON": str(Path(t) / "nope")})
            self.assertEqual(r.returncode, 3, r.stdout + r.stderr)      # blocked: no usable python, no fallback
        after =sorted(p.relative_to(fx.SKILL_DIR).as_posix() for p in fx.SKILL_DIR.rglob("*")
                       if "__pycache__" not in p.parts)
        self.assertEqual(before, after)

    def test_failed_install_is_blocked_with_no_fallback(self):
        with tempfile.TemporaryDirectory() as t:
            t = Path(t)
            failing = t / "failpy"
            failing.write_text("#!/usr/bin/env bash\nexit 1\n")
            failing.chmod(failing.stat().st_mode | stat.S_IEXEC)
            r = _run({"DFP_VENV_DIR": str(t / "venv"), "DFP_BASE_PYTHON": str(failing)})
            self.assertEqual(r.returncode, 3)
            self.assertIn("blocked:", r.stdout + r.stderr)
            self.assertFalse((t / "venv" / ".requirements.sha256").exists(), "no stamp on failure")


class SkillStructure(unittest.TestCase):
    @property
    def text(self):
        skill = fx.SKILL_DIR / "SKILL.md"
        if not skill.is_file():
            self.fail("SKILL.md missing")
        return skill.read_text(encoding="utf-8")

    def test_frontmatter(self):
        m = re.match(r"---\n(.*?)\n---\n", self.text, re.S)
        self.assertIsNotNone(m, "frontmatter")
        fm = dict(l.split(":", 1) for l in m.group(1).splitlines() if ":" in l)
        self.assertEqual(fm["name"].strip(), "design-from-pdf")
        self.assertGreater(len(fm["description"].strip()), 40)

    def test_two_phase_flow_and_checkpoint_documented(self):
        for needle in ("analysis.md", "Approved:", "dfp.sh analyze", "dfp.sh gate", "dfp.sh scaffold",
                       "dfp.sh validate", "STOP"):
            self.assertIn(needle, self.text, needle)

    def test_ip_and_honesty_rules_present(self):
        low = self.text.lower()
        for needle in ("never redistribut", "brand marks", "observed", "inferred", "substitut", "google fonts"):
            self.assertIn(needle, low, needle)

    def test_coordinator_contract(self):
        for needle in ("handoff-log.md", "Recommend:", "/mockups-creating", "/design-generating"):
            self.assertIn(needle, self.text, needle)
        self.assertRegex(self.text, r"(?i)never.{0,40}(invoke|call).{0,40}(agent|skill)")

    def test_return_discipline_and_metrics(self):
        self.assertIn("record-metrics.sh", self.text)
        self.assertIn("≤ 8 lines", self.text)

    def test_requirements_pinned_and_lean(self):
        lines = [l.strip() for l in REQ.read_text().splitlines() if l.strip() and not l.startswith("#")]
        self.assertTrue(lines)
        for l in lines:
            self.assertRegex(l, r"^[A-Za-z0-9_.-]+==\d", l)
        names = {re.split(r"==", l)[0].lower() for l in lines}
        self.assertTrue({"pymupdf", "pillow"} <= names)
        self.assertFalse(names & {"onnxruntime", "numpy", "pymupdf4llm", "pymupdf-layout", "opencv-python"})

    def test_skill_md_is_portable_and_kit_steps_are_optional(self):
        """Installed anywhere: no hardcoded repo path; Talaka steps guarded; standalone mode documented."""
        t = self.text
        self.assertNotIn(".claude/skills/design-from-pdf", t, "hardcoded install path")
        self.assertNotRegex(t, r"[A-Za-z]:\\\\|/Users/|/home/")
        self.assertRegex(t, r"(?i)stand-?alone")
        self.assertRegex(t, r"(?i)if .{0,60}(\.tlk|handoff-log\.md).{0,60}(exist|present)")   # kit contract is conditional
        self.assertRegex(t, r"(?i)python (>=|≥) ?3\.9")
        self.assertIn("DFP_HOME", t)
        self.assertRegex(t, r"(?i)(base|this skill'?s?) directory")                          # how to locate dfp.sh

    def test_wrapper_exists(self):
        self.assertTrue((fx.SKILL_DIR / "dfp.sh").is_file(), "dfp.sh wrapper missing")
        self.assertIn("bootstrap.sh", (fx.SKILL_DIR / "dfp.sh").read_text())


if __name__ == "__main__":
    unittest.main()
