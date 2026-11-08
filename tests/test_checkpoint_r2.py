"""Round 2 checkpoint: analysis.md layout (S2), parser (AC21), gate (AC7a/AC16a/AC21, D22-D24).

Most tests drive the real CLI (`analyze` on a synthetic PDF, edit analysis.md as text, `gate`), so they pin the
file grammar from mockups.md §2-§3 and the gate JSON, not internal function names.

Gate JSON (stdout): {ok, reason, message, problems: [{reason, message, ids?}]}; `reason` = first problem; `problems`
is always present ([] when ok). NOT_APPROVED short-circuits; every other check collects. Message rules: ids listed, at most
5 shown with the total count, never the whole file (< 600 chars).
Order of problems: MALFORMED_ROW NO_MEDIUM BAD_MEDIUM BAD_TARGET UNKNOWN_ID BAD_ADAPTATION UNRESOLVED_UNC VISION_PENDING
UNIDENTIFIED_CMP INVALID_FOR_TARGETS.  New ids allowed in analysis.md besides inventory.json: U-NNN, ADP-NNN (status
`inferred`, evidence cites `adapted-from:`), and CMP-NNN rows whose evidence says `found: vision` (status `observed`).
approved.json gains: targets[], fragments[{id, parent, keep, standalone}], item.merged_into.
"""
import json
import re
import tempfile
import unittest
from pathlib import Path

from tests import fixtures as fx
from tests import fixtures_r2 as r2

SECTIONS = ["Needs you", "Contents", "Coverage", "Vision pass", "Probe", "Medium and targets", "Not applicable",
            "Structure", "Page templates", "Inventory", "Components", "Adaptations", "Unclaimed", "Usage",
            "User additions", "Inferred items", "Checkpoint"]

PARSE_TEXT = """# Pattern analysis - book.pdf

Medium: publication-print
Target media: web-ui, publication-print
Unclaimed threshold: 0.1 %
Approved: no
Inferred: keep

## Components (2)

#### callouts/ (1 row)

- [x] CMP-007 | `speech-bubble` | speech-bubble | observed | p.2-3, n=9
  - members: shape + shadow; absorbed: CL-031 bubble-90, CL-032 bubble-130
  - usage [inferred, high] (edited): bubbles may overlap by ~25 %.
  - split: CL-032
## Unclaimed (1)

- [x] UNC-014 | `p.8 bbox 1,2,3,4 · 0.3 %` | (unnamed) | unassigned | crop: crops/unc-014.png
  - merge: CMP-007
## Structure (1)

- [x] STR-006 | `footer band 740-805pt` | running-footer | observed | 18 of 24 pages
## Page templates (1)

### TPL-002 exercise page (p.8, 10-13) n=7
  zones:    header-band (0-60pt)
## Vision pass

| Page | Overlay | Result | Added ids |
|---|---|---|---|
| 7 | renders/overlay-007.png | pending | none |
| 8 | renders/overlay-008.png | added: CMP-062 | CMP-062 |
"""


class Parser(unittest.TestCase):
    def setUp(self):
        self.p = fx.mod("dfp.analysis_md").parse_analysis_md(PARSE_TEXT)

    def test_continuation_lines_and_new_prefixes_parse_without_errors(self):
        self.assertEqual(self.p["errors"], [])
        self.assertEqual([i["id"] for i in self.p["items"]], ["CMP-007", "UNC-014", "STR-006"])

    def test_row_continuations(self):
        cmp_ = next(i for i in self.p["items"] if i["id"] == "CMP-007")
        self.assertEqual(cmp_["absorbed"], ["CL-031", "CL-032"])
        self.assertEqual(cmp_["split"], ["CL-032"])
        self.assertEqual(cmp_["usage"], {"tag": "inferred, high", "text": "bubbles may overlap by ~25 %.", "edited": True})
        unc = next(i for i in self.p["items"] if i["id"] == "UNC-014")
        self.assertEqual((unc["merge"], unc["status"], unc["label"]), ("CMP-007", "unassigned", "(unnamed)"))

    def test_header_templates_vision(self):
        self.assertEqual(self.p["targets"], ["web-ui", "publication-print"])
        self.assertAlmostEqual(self.p["unclaimed_threshold"], 0.001)
        self.assertEqual(self.p["templates"], ["TPL-002"])
        self.assertEqual(self.p["vision"], [{"page": 7, "result": "pending", "added": []},
                                            {"page": 8, "result": "added: CMP-062", "added": ["CMP-062"]}])

    def test_malformed_row_names_line_and_the_row_before(self):
        text = PARSE_TEXT.replace("- [x] STR-006 | `footer band 740-805pt` | running-footer | observed | 18 of 24 pages",
                                  "- [x] STR-006 | oops")
        p = fx.mod("dfp.analysis_md").parse_analysis_md(text)
        self.assertEqual(len(p["errors"]), 1)
        e = p["errors"][0]
        self.assertEqual((e["code"], e["after"]), ("MALFORMED_ROW", "UNC-014"))
        self.assertEqual(text.splitlines()[e["line"] - 1].strip(), "- [x] STR-006 | oops")

    def test_round_1_defaults(self):
        p = fx.mod("dfp.analysis_md").parse_analysis_md("Medium: web-ui\nApproved: no\n")
        self.assertEqual(p["targets"], [])
        self.assertEqual(p["vision"], [])


class Layout(r2.R2Case):
    build = staticmethod(r2.make_composite_pdf)

    def test_header_lines(self):
        t = self.text0
        self.assertEqual(r2.header(t, "Target media"), "web-ui, presentation, publication-print")      # D18
        self.assertEqual(r2.header(t, "Unclaimed threshold"), "0.1 %")                               # AC16a
        self.assertRegex(r2.header(t, "Cluster tolerance"), r"15 %.*0\.8")                           # D20
        self.assertIsNotNone(r2.header(t, "Layout"))
        self.assertEqual(r2.header(t, "Approved"), "no")

    def test_sections_exist_in_decision_order(self):
        pos = []
        for s in SECTIONS:
            m = re.search(r"^## %s\b" % re.escape(s), self.text0, re.M)
            self.assertIsNotNone(m, "missing section: " + s)
            pos.append(m.start())
        self.assertEqual(pos, sorted(pos))

    def test_needs_you_counts_match_the_rows(self):
        sec = self.text0.split("## Needs you", 1)[1].split("## Contents", 1)[0]
        unc = re.search(r"Unclaimed regions \(UNC\)\s*\|\s*(\d+)", sec)
        vis = re.search(r"Vision pass pages pending\s*\|\s*(\d+)", sec)
        tgt = re.search(r"Targets enabled\s*\|\s*(\d+)", sec)
        self.assertEqual(int(unc.group(1)), len(r2.rows(self.text0, "UNC")))
        self.assertEqual(int(vis.group(1)), 3)
        self.assertEqual(int(tgt.group(1)), 3)

    def test_coverage_section_states_denominator_and_every_page(self):
        sec = self.text0.split("## Coverage", 1)[1].split("\n## ", 1)[0]
        self.assertRegex(sec, r"(?m)^Overall: .*% .*claimed")
        self.assertRegex(sec, r"(?m)^Denominator: ")
        self.assertEqual(len(re.findall(r"(?m)^\| [123] \|", sec)), 3)

    def test_vision_pass_table_and_overlays(self):
        lines = r2.vision_lines(self.text0)
        self.assertEqual(len(lines), 3)
        for l in lines:
            cells = [c.strip() for c in l.strip("|").split("|")]
            self.assertTrue(cells[2].startswith("pending"), l)
            self.assertTrue((self.a / cells[1]).is_file(), cells[1])

    def test_unclaimed_tiers_and_inventory_split(self):
        unc = r2.rows(self.text0, "UNC")
        self.assertEqual(len(unc), 1)
        self.assertIn("unassigned", unc[0])
        self.assertIn("(unnamed)", unc[0])
        sec = self.text0.split("## Unclaimed", 1)[1].split("\n## ", 1)[0]
        self.assertRegex(sec, r"(?i)auto-dismissed")
        inv = json.loads((self.a / "inventory.json").read_text(encoding="utf-8"))
        self.assertEqual(len(inv["dismissed"]), 1)
        self.assertNotIn(inv["dismissed"][0]["id"], {i["id"] for i in inv["items"]})
        p = fx.mod("dfp.analysis_md").parse_analysis_md(self.text0)
        self.assertEqual({r["id"] for r in p["items"]}, {i["id"] for i in inv["items"]})

    def test_component_rows_carry_tool_output_continuations(self):
        bubble = next(l for l in r2.rows(self.text0, "CMP") if "n=6" in l)
        i = self.text0.index(bubble)
        block = self.text0[i:].split("\n- [", 1)[0]
        for key in ("members:", "absorbed:", "variants:", "measured:"):
            self.assertIn(key, block)
        self.assertRegex(block, r"measured:.*overlap")
        self.assertRegex(block, r"measured:.*rotation")
        self.assertEqual(r2.rows(self.text0, "CL"), [], "fragments must not be tickable rows")

    def test_structure_templates_and_adaptations_present(self):
        self.assertGreaterEqual(len(r2.rows(self.text0, "STR")), 3)
        self.assertRegex(self.text0, r"(?m)^### TPL-001\b")
        self.assertTrue(r2.rows(self.text0, "ADP"))                      # default targets differ from nothing: web + slides
        for l in r2.rows(self.text0, "ADP"):
            self.assertIn("| inferred |", l)
            self.assertIn("adapted-from:", l)

    def test_plain_markdown_and_row_length(self):
        self.assertNotRegex(self.text0, r"(?i)<(details|table|div|span)")
        for l in self.text0.splitlines():
            if r2.ROW_RE.match(l):
                self.assertLessEqual(len(l), 160, l)

    def test_empty_sections_say_none(self):
        # the composite fixture has no user additions: the section must say so rather than vanish
        sec = self.text0.split("## User additions", 1)[1].split("\n## ", 1)[0]
        self.assertRegex(sec, r"(?i)\bnone\b")


class Gate(r2.R2Case):
    build = staticmethod(r2.make_composite_pdf)

    def test_fresh_checkpoint_lists_every_blocker(self):
        rc, d = self.gate_text(r2.resolve_checkpoint(self.text0, keep_unc=True, keep_vision=True, keep_unnamed=True))
        self.assertEqual(rc, 4)
        self.assertFalse(d["ok"])
        got = self.reasons(d)
        self.assertEqual(got[:3], ["UNRESOLVED_UNC", "VISION_PENDING", "UNIDENTIFIED_CMP"], got)
        self.assertEqual(d["reason"], got[0])

    def test_resolved_checkpoint_passes_and_records_targets(self):
        rc, d = self.gate_text(self.approvable())
        self.assertEqual(rc, 0, d)
        self.assertEqual(d["problems"], [])

    def test_approved_json_has_targets_and_structure_rows(self):
        am = self.a / "analysis.md"
        try:
            am.write_text(self.approvable(), encoding="utf-8")
            self.assertEqual(fx.run_cli("gate", self.ds).returncode, 0)
            ap = json.loads((self.a / "approved.json").read_text(encoding="utf-8"))
        finally:
            am.write_text(self.text0, encoding="utf-8")
            (self.a / "approved.json").unlink(missing_ok=True)
        self.assertEqual(ap["targets"], ["web-ui", "presentation", "publication-print"])
        self.assertTrue(any(i["id"].startswith("STR-") for i in ap["items"]))

    def test_each_blocker_alone(self):
        rc, d = self.gate_text(self.approvable(keep_unc=True))
        self.assertEqual(self.reasons(d), ["UNRESOLVED_UNC"])
        rc, d = self.gate_text(self.approvable(keep_vision=True))
        self.assertEqual(self.reasons(d), ["VISION_PENDING"])
        self.assertTrue(all(str(n) in d["problems"][0]["message"] for n in (1, 2, 3)))
        rc, d = self.gate_text(self.approvable(keep_unnamed=True))
        self.assertEqual(self.reasons(d), ["UNIDENTIFIED_CMP"])

    def test_failed_render_counts_as_pending(self):
        text = self.approvable(keep_vision=True)
        text = re.sub(r"(?m)^(\| 2 \| renders/overlay-002\.png \| )[^|]*\|", r"\1failed (render) |", text)
        text = text.replace("| pending |", "| none missed |")
        rc, d = self.gate_text(text)
        self.assertEqual(self.reasons(d), ["VISION_PENDING"])
        self.assertIn("2", d["problems"][0]["message"])

    def test_unc_is_resolved_by_name_merge_or_untick(self):
        unc = next(l for l in r2.rows(self.text0, "UNC"))
        cmp_id = re.search(r"CMP-\d{3}", next(iter(r2.rows(self.text0, "CMP")))).group(0)
        base = self.approvable(keep_unc=True)
        named = base.replace(unc, unc.replace("(unnamed)", "purple-box"))
        merged = base.replace(unc, unc + "\n  - merge: " + cmp_id)
        for text in (named, merged):
            rc, d = self.gate_text(text)
            self.assertEqual(rc, 0, d)
        am = self.a / "analysis.md"
        try:
            am.write_text(merged, encoding="utf-8")
            fx.run_cli("gate", self.ds)
            ap = json.loads((self.a / "approved.json").read_text(encoding="utf-8"))
        finally:
            am.write_text(self.text0, encoding="utf-8")
            (self.a / "approved.json").unlink(missing_ok=True)
        uid = re.search(r"UNC-\d{3}", unc).group(0)
        self.assertEqual({i["id"]: i for i in ap["items"]}[uid]["merged_into"], cmp_id)

    def test_bad_target_names_the_valid_ones(self):
        rc, d = self.gate_text(r2.set_header(self.approvable(), "Target media", "web, publication-print"))
        self.assertIn("BAD_TARGET", self.reasons(d))
        msg = next(p["message"] for p in d["problems"] if p["reason"] == "BAD_TARGET")
        self.assertIn('"web"', msg)
        for name in ("web-ui", "presentation", "publication-print", "marketing"):
            self.assertIn(name, msg)

    def test_adaptation_rows_must_be_inferred_and_cite_a_source(self):
        ok = "\n- [x] ADP-901 | `list-marker` | list-marker | inferred | adapted-from: CMP-001; confidence: medium; bullets\n"
        rc, d = self.gate_text(self.approvable() + ok)
        self.assertEqual(rc, 0, d)
        for bad in ("\n- [x] ADP-902 | `x` | x | observed | adapted-from: CMP-001\n",
                    "\n- [x] ADP-903 | `x` | x | inferred | because\n"):
            rc, d = self.gate_text(self.approvable() + bad)
            self.assertIn("BAD_ADAPTATION", self.reasons(d), bad)

    def test_invalid_for_targets(self):
        row = "\n- [x] ADP-901 | `toast` | toast | inferred | adapted-from: CMP-001; confidence: medium; alert\n"
        rc, d = self.gate_text(r2.set_header(self.approvable(), "Target media", "publication-print") + row)
        self.assertIn("INVALID_FOR_TARGETS", self.reasons(d))
        p = next(p for p in d["problems"] if p["reason"] == "INVALID_FOR_TARGETS")
        self.assertIn("ADP-901", p["message"])
        rc, d = self.gate_text(self.approvable() + row)                  # web-ui enabled: fine
        self.assertNotIn("INVALID_FOR_TARGETS", self.reasons(d))

    def test_vision_found_rows_are_accepted_but_other_new_ids_are_not(self):
        found = "\n- [x] CMP-901 | `word-box` | word-box | observed | p.1, n=1, found: vision, bbox 62,640,300,712\n"
        rc, d = self.gate_text(self.approvable() + found)
        self.assertEqual(rc, 0, d)
        rc, d = self.gate_text(self.approvable() + found.replace(", found: vision", ""))
        self.assertIn("UNKNOWN_ID", self.reasons(d))

    def test_source_rows_survive_dropping_the_source_target_and_adaptations_follow_targets(self):
        am = self.a / "analysis.md"
        for targets, web_kept in (("web-ui", True), ("publication-print", False)):
            try:
                am.write_text(r2.set_header(self.approvable(), "Target media", targets), encoding="utf-8")
                self.assertEqual(fx.run_cli("gate", self.ds).returncode, 0)
                ap = json.loads((self.a / "approved.json").read_text(encoding="utf-8"))
            finally:
                am.write_text(self.text0, encoding="utf-8")
                (self.a / "approved.json").unlink(missing_ok=True)
            items = ap["items"]
            observed = [i for i in items if i["status"] == "observed" and not i["id"].startswith("UNC-")]
            self.assertTrue(observed and all(i["keep"] for i in observed), targets)         # D24
            web = [i for i in items if i["id"].startswith("ADP-") and i.get("target") == "web-ui"]
            self.assertTrue(web)
            self.assertEqual(all(i["keep"] for i in web), web_kept, targets)

    def test_unticking_a_parent_drops_its_fragments_unless_split(self):
        resolved = self.approvable()
        bubble = next(l for l in r2.rows(resolved, "CMP") if "n=6" in l)
        pid = re.search(r"CMP-\d{3}", bubble).group(0)
        block = resolved[resolved.index(bubble):].split("\n- [", 1)[0]
        frags = re.findall(r"CL-\d{3}", next(l for l in block.splitlines() if "absorbed:" in l))
        self.assertGreaterEqual(len(frags), 3)
        unticked = bubble.replace("- [x]", "- [ ]", 1)
        base = resolved.replace(bubble, unticked)
        am = self.a / "analysis.md"
        for text, standalone in ((base, None),
                                 (base.replace(unticked + "\n", unticked + "\n  - split: %s\n" % frags[0]), frags[0])):
            try:
                am.write_text(text, encoding="utf-8")
                self.assertEqual(fx.run_cli("gate", self.ds).returncode, 0)
                ap = json.loads((self.a / "approved.json").read_text(encoding="utf-8"))
            finally:
                am.write_text(self.text0, encoding="utf-8")
                (self.a / "approved.json").unlink(missing_ok=True)
            mine = {f["id"]: f for f in ap["fragments"] if f["parent"] == pid}
            self.assertEqual(set(mine), set(frags))
            for fid, f in mine.items():
                self.assertEqual(f["keep"], fid == standalone, (fid, f))


class GateMessages(r2.R2Case):
    build = staticmethod(r2.make_flood_pdf)

    def test_many_unc_rows_are_summarised_not_dumped(self):
        rows = r2.rows(self.text0, "UNC")
        self.assertEqual(len(rows), 30)
        rc, d = self.gate_text(self.approvable(keep_unc=True))
        p = next(p for p in d["problems"] if p["reason"] == "UNRESOLVED_UNC")
        self.assertIn("30", p["message"])
        self.assertIn("UNC-001", p["message"])
        self.assertIn("UNC-005", p["message"])
        self.assertNotIn("UNC-006", p["message"])
        self.assertLess(len(p["message"]), 600)
        self.assertEqual(len(p["ids"]), 30)


class ReanalyzeGuard(unittest.TestCase):
    """AC7a (D23): the checkpoint is the user's work; analyze never destroys it."""

    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.pdf = fx.make_vector_pdf(Path(self.tmp.name) / "v.pdf")
        self.ds = fx.make_analyzed_ds(self.tmp.name, self.pdf)
        self.am = self.ds / "_analysis" / "analysis.md"

    def tearDown(self):
        self.tmp.cleanup()

    def test_edited_row_is_refused_naming_force_and_the_file_is_untouched(self):
        edited = self.am.read_text(encoding="utf-8") + "\n- [x] U-001 | `#FF00FF` | accent | user | mine\n"
        self.am.write_text(edited, encoding="utf-8")
        r = fx.run_cli("analyze", self.pdf, "--ds", self.ds)
        self.assertEqual(r.returncode, 2, r.stdout + r.stderr)
        self.assertIn("--force", r.stderr)
        self.assertEqual(self.am.read_text(encoding="utf-8"), edited)
        self.assertFalse((self.ds / "_analysis" / "analysis.prev.md").exists())

    def test_force_backs_up_the_edited_file_first(self):
        edited = self.am.read_text(encoding="utf-8") + "\n- [x] U-001 | `#FF00FF` | accent | user | mine\n"
        self.am.write_text(edited, encoding="utf-8")
        r = fx.run_cli("analyze", self.pdf, "--ds", self.ds, "--force")
        self.assertEqual(r.returncode, 0, r.stderr)
        self.assertEqual((self.ds / "_analysis" / "analysis.prev.md").read_text(encoding="utf-8"), edited)
        self.assertNotEqual(self.am.read_text(encoding="utf-8"), edited)

    def test_an_approval_line_alone_protects_the_file_even_if_the_stamp_matches(self):
        import hashlib
        approved = self.am.read_text(encoding="utf-8").replace("Approved: no", "Approved: 2026-11-07 Tester")
        self.am.write_text(approved, encoding="utf-8")
        (self.ds / "_analysis" / ".analysis.sha256").write_text(
            hashlib.sha256(approved.encode("utf-8")).hexdigest() + "\n", encoding="utf-8")        # a stamp that "blesses" it
        r = fx.run_cli("analyze", self.pdf, "--ds", self.ds)
        self.assertEqual(r.returncode, 2, r.stdout + r.stderr)
        self.assertIn("--force", r.stderr)
        self.assertEqual(self.am.read_text(encoding="utf-8"), approved)


if __name__ == "__main__":
    unittest.main()
