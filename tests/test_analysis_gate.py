"""AC7 Checkpoint: analysis.md grammar (dfp.analysis_md) and the approval gate (dfp.gate).

analysis.md row grammar (one item per line, ` | `-separated, literal `|` escaped as `\\|`):
    - [x] COL-001 | `#231F20` | ink | observed | p.1-24, n=18234
`[ ]` = dropped. Editing the value cell overrides. `U-NNN` rows are user-added (status forced to `user`).
Header lines:  `Medium: publication-print[, other]`   `Approved: <date> <name>`  (`Approved: no` = pending).
"""
import json
import tempfile
import unittest
from pathlib import Path

from tests import fixtures as fx

INV = {"items": [
    {"id": "COL-001", "category": "COL", "label": "ink", "value": "#231F20", "status": "observed", "evidence": "p.1-3"},
    {"id": "COL-002", "category": "COL", "label": "green", "value": "#8DC63F", "status": "observed", "evidence": "p.1-3"},
    {"id": "SPC-001", "category": "SPC", "label": "grid | gutter", "value": "12 | 6", "status": "inferred",
     "evidence": "p.2", "confidence": "low", "reasoning": "two columns seen"},
]}
PROBE = {"pages": 3, "page_sizes": [{"w": 595.0, "h": 842.0, "count": 3}], "pdf_type": "vector_text",
         "strategy": "vector-exact", "fonts": [], "font_families": [], "producer": "p", "creator": "c",
         "bookmarks": 0, "image_count": 0, "has_text_layer": True, "vector_ratio": 1.0,
         "page_types": ["vector_text"] * 3, "encrypted": False, "text_pages": 3}
MEDIUM = {"candidates": [{"medium": "publication-print", "score": 0.9, "evidence": ["portrait"]}],
          "proposed": ["publication-print"]}


def _render():
    return fx.mod("dfp.analysis_md").render_analysis_md(PROBE, MEDIUM, INV, "book.pdf")


def _approve(text, who="2026-11-05 Alex"):
    return text.replace("Approved: no", "Approved: " + who)


class RenderParse(unittest.TestCase):
    def test_render_has_required_sections_and_pending_marker(self):
        t = _render()
        for h in ("## Probe", "## Medium", "## Not applicable", "## Inventory", "### Colors",
                  "### Typography", "### Spacing", "## Inferred items", "## Checkpoint"):
            self.assertIn(h, t)
        self.assertIn("Approved: no", t)
        self.assertIn("Medium: publication-print", t)
        self.assertIn("book.pdf", t)

    def test_empty_categories_still_listed(self):
        self.assertIn("### Shadows", _render())     # SHD has no items: heading stays, says none found

    def test_inferred_items_listed_separately(self):
        t = _render()
        tail = t.split("## Inferred items", 1)[1]
        self.assertIn("SPC-001", tail)
        self.assertIn("two columns seen", tail)
        self.assertNotIn("COL-001", tail.split("## Checkpoint")[0])

    def test_round_trip_preserves_rows_including_pipes(self):
        p = fx.mod("dfp.analysis_md").parse_analysis_md(_render())
        self.assertEqual(p["errors"], [])
        rows = {r["id"]: r for r in p["items"]}
        self.assertEqual(set(rows), {"COL-001", "COL-002", "SPC-001"})
        self.assertTrue(all(r["keep"] for r in rows.values()))
        self.assertEqual(rows["SPC-001"]["label"], "grid | gutter")
        self.assertEqual(rows["SPC-001"]["value"], "12 | 6")
        self.assertEqual(rows["COL-001"]["value"], "#231F20")
        self.assertEqual(p["medium"], ["publication-print"])
        self.assertFalse(p["approved"])

    def test_edits_are_parsed(self):
        t = _approve(_render())
        t = t.replace("- [x] COL-002", "- [ ] COL-002").replace("`#231F20`", "`#222222`")
        p = fx.mod("dfp.analysis_md").parse_analysis_md(t)
        rows = {r["id"]: r for r in p["items"]}
        self.assertFalse(rows["COL-002"]["keep"])
        self.assertEqual(rows["COL-001"]["value"], "#222222")
        self.assertTrue(p["approved"])
        self.assertEqual(p["approved_by"], "Alex")
        self.assertEqual(p["approved_at"], "2026-11-05")

    def test_pending_variants_are_not_approval(self):
        am = fx.mod("dfp.analysis_md")
        for v in ("no", "No", "pending", "TBD", "-", "n/a", ""):
            t = _render().replace("Approved: no", "Approved: " + v)
            self.assertFalse(am.parse_analysis_md(t)["approved"], repr(v))

    def test_malformed_row_reported(self):
        t = _render() + "\n- [x] COL-009 | only two cells\n"
        p = fx.mod("dfp.analysis_md").parse_analysis_md(t)
        self.assertTrue(any(e["code"] == "MALFORMED_ROW" for e in p["errors"]), p["errors"])


class Gate(unittest.TestCase):
    _n = 0

    def _ds(self, tmp, text=None):
        Gate._n += 1                                      # unique dir: one test may build several ds under one tmp
        ds = Path(tmp) / ("ds%d" % Gate._n)
        (ds / "_analysis").mkdir(parents=True)
        (ds / "_analysis" / "inventory.json").write_text(json.dumps(INV), encoding="utf-8")
        if text is not None:
            (ds / "_analysis" / "analysis.md").write_text(text, encoding="utf-8")
        return ds

    def _gate(self, ds):
        return fx.mod("dfp.gate").check_gate(ds)

    def test_no_analysis(self):
        with tempfile.TemporaryDirectory() as t:
            r = self._gate(self._ds(t))
        self.assertEqual((r["ok"], r["reason"]), (False, "NO_ANALYSIS"))

    def test_not_approved_blocks_and_writes_nothing(self):
        with tempfile.TemporaryDirectory() as t:
            ds = self._ds(t, _render())
            r = self._gate(ds)
            self.assertEqual((r["ok"], r["reason"]), (False, "NOT_APPROVED"))
            self.assertFalse((ds / "_analysis" / "approved.json").exists())

    def test_missing_or_bad_medium(self):
        with tempfile.TemporaryDirectory() as t:
            r = self._gate(self._ds(t, _approve(_render()).replace("Medium: publication-print", "Medium:")))
            self.assertEqual(r["reason"], "NO_MEDIUM")
            r = self._gate(self._ds(t, _approve(_render()).replace("Medium: publication-print", "Medium: hologram")))
            self.assertEqual(r["reason"], "BAD_MEDIUM")

    def test_unknown_id_rejected_but_user_rows_allowed(self):
        with tempfile.TemporaryDirectory() as t:
            r = self._gate(self._ds(t, _approve(_render()) + "\n- [x] COL-777 | `#000000` | x | observed | p.1\n"))
            self.assertEqual(r["reason"], "UNKNOWN_ID")
        with tempfile.TemporaryDirectory() as t:
            ds = self._ds(t, _approve(_render()) + "\n- [x] U-001 | `#FF00FF` | accent | user | brand deck\n")
            r = self._gate(ds)
            self.assertTrue(r["ok"], r)
            item = {i["id"]: i for i in json.loads((ds / "_analysis" / "approved.json").read_text())["items"]}["U-001"]
            self.assertEqual(item["status"], "user")

    def test_malformed_row_blocks(self):
        with tempfile.TemporaryDirectory() as t:
            r = self._gate(self._ds(t, _approve(_render()) + "\n- [x] COL-001 | nope\n"))
        self.assertEqual(r["reason"], "MALFORMED_ROW")

    def test_approved_writes_approved_json_honouring_edits(self):
        with tempfile.TemporaryDirectory() as t:
            text = _approve(_render()).replace("- [x] COL-002", "- [ ] COL-002").replace("`#231F20`", "`#222222`")
            ds = self._ds(t, text)
            r = self._gate(ds)
            self.assertTrue(r["ok"], r)
            ap = json.loads((ds / "_analysis" / "approved.json").read_text(encoding="utf-8"))
            self.assertEqual(ap["medium"], ["publication-print"])
            self.assertEqual(ap["approved_by"], "Alex")
            items = {i["id"]: i for i in ap["items"]}
            self.assertFalse(items["COL-002"]["keep"])
            self.assertTrue(items["COL-001"]["keep"])
            self.assertEqual(items["COL-001"]["value"], "#222222")
            self.assertTrue(items["COL-001"]["edited"])
            self.assertEqual(items["COL-001"]["original_value"], "#231F20")
            self.assertFalse(items["SPC-001"]["edited"])
            self.assertEqual(items["SPC-001"]["status"], "inferred")     # status survives approval

    def test_cli_exit_codes(self):
        with tempfile.TemporaryDirectory() as t:
            ds = self._ds(t, _render())
            r = fx.run_cli("gate", ds)
            self.assertEqual(r.returncode, 4)
            self.assertIn("NOT_APPROVED", r.stdout + r.stderr)
            (ds / "_analysis" / "analysis.md").write_text(_approve(_render()), encoding="utf-8")
            r = fx.run_cli("gate", ds)
            self.assertEqual(r.returncode, 0, r.stderr)
            self.assertTrue((ds / "_analysis" / "approved.json").is_file())


if __name__ == "__main__":
    unittest.main()
