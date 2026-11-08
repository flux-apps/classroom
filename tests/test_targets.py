"""Round 2 / AC18 source medium vs target media (dfp.medium, dfp.adapt, dfp.util.dual_units).

Pinned API
  medium.TARGETS == ["web-ui", "presentation", "publication-print", "marketing"]
  medium.DEFAULT_TARGETS == ["web-ui", "presentation", "publication-print"]          (D18, all pre-enabled)
  medium.applicability_for(source, targets) -> {"applicable": [cat], "not_applicable": [{"category", "reason"}]}
      applicable = categories of (targets U {source}): observed source rows are always kept (D24); web-only categories
      are N/A only when NO target is web-ui. Unknown target -> ValueError naming the valid ones.
  medium.na_groups(source, targets) -> [{"reason": str, "categories": [cat]}]   (grouped by reason, <= 5 groups)
  adapt.derive_adaptations(source, targets, items) -> [ADP item]
      items = inventory-style dicts {id, category, label, value, status}. Deterministic, token/structure-level
      adaptations only (semantic ones such as side-tab -> tabs are written by Claude at the checkpoint):
        web-ui (source != web-ui): button, input, hover-states      from the palette and body type
        presentation (source != presentation): slide-layout, title-slide
        publication-print (source != publication-print): page-geometry (@page, bleed)
      ADP item: {id ADP-NNN, category, label, value, status "inferred", confidence, reasoning, target, adapted_from [ids]}
  util.dual_units("10.5pt") -> "10.5pt (14px, 0.875rem)"   1pt = 1.333px, 1rem = 16px, <= 3 decimals, trailing zeros cut
"""
import unittest

from tests import fixtures as fx

ITEMS = [
    {"id": "COL-001", "category": "COL", "label": "ink", "value": "#231F20", "status": "observed"},
    {"id": "COL-002", "category": "COL", "label": "green", "value": "#8DC63F", "status": "observed"},
    {"id": "TYP-001", "category": "TYP", "label": "body", "value": "OfficinaSansStd 10.5pt 400", "status": "observed"},
    {"id": "SPC-001", "category": "SPC", "label": "page size", "value": "595pt 805pt", "status": "observed"},
]
INTERACTIVE = {"toast", "tabs", "switch", "dialog", "tooltip", "input", "form-controls"}


class Targets(unittest.TestCase):
    def test_constants(self):
        m = fx.mod("dfp.medium")
        self.assertEqual(m.TARGETS, ["web-ui", "presentation", "publication-print", "marketing"])
        self.assertEqual(m.DEFAULT_TARGETS, ["web-ui", "presentation", "publication-print"])

    def test_print_only_target_reproduces_round_1_behaviour(self):
        a = fx.mod("dfp.medium").applicability_for("publication-print", ["publication-print"])
        na = {x["category"] for x in a["not_applicable"]}
        self.assertTrue(INTERACTIVE <= na, na)
        self.assertIn("folio", a["applicable"])

    def test_default_targets_make_web_categories_applicable(self):
        a = fx.mod("dfp.medium").applicability_for("publication-print", fx.mod("dfp.medium").DEFAULT_TARGETS)
        self.assertTrue(INTERACTIVE <= set(a["applicable"]))
        self.assertIn("folio", a["applicable"])                      # source-evidenced print categories stay

    def test_web_applicability_depends_on_targets_not_source(self):
        m = fx.mod("dfp.medium")
        for targets, toast_applicable in ((["web-ui"], True), (["web-ui", "publication-print"], True),
                                          (["presentation", "publication-print"], False), (["marketing"], False)):
            a = m.applicability_for("publication-print", targets)
            self.assertEqual("toast" in a["applicable"], toast_applicable, targets)

    def test_observed_source_categories_survive_a_dropped_source_target(self):
        a = fx.mod("dfp.medium").applicability_for("web-ui", ["publication-print"])
        self.assertIn("button", a["applicable"])                     # D24: observed web rows are evidence
        self.assertIn("folio", a["applicable"])

    def test_unknown_target_lists_valid_names(self):
        with self.assertRaises(ValueError) as cm:
            fx.mod("dfp.medium").applicability_for("publication-print", ["web"])
        for name in fx.mod("dfp.medium").TARGETS:
            self.assertIn(name, str(cm.exception))

    def test_not_applicable_is_grouped_by_reason(self):
        m = fx.mod("dfp.medium")
        groups = m.na_groups("publication-print", ["publication-print"])
        na = {x["category"] for x in m.applicability_for("publication-print", ["publication-print"])["not_applicable"]}
        self.assertLessEqual(len(groups), 5)
        self.assertLess(len(groups), len(na))
        self.assertEqual({c for g in groups for c in g["categories"]}, na)
        self.assertEqual(len({g["reason"] for g in groups}), len(groups))


class Adaptations(unittest.TestCase):
    def _derive(self, source, targets):
        return fx.mod("dfp.adapt").derive_adaptations(source, targets, ITEMS)

    def test_every_adaptation_is_inferred_cited_and_targeted(self):
        out = self._derive("publication-print", fx.mod("dfp.medium").DEFAULT_TARGETS)
        self.assertTrue(out)
        ids = {i["id"] for i in ITEMS}
        self.assertEqual([a["id"] for a in out], ["ADP-%03d" % i for i in range(1, len(out) + 1)])
        for a in out:
            self.assertEqual(a["status"], "inferred")
            self.assertIn(a["confidence"], ("low", "medium", "high"))
            self.assertTrue(a["reasoning"])
            self.assertTrue(a["adapted_from"] and set(a["adapted_from"]) <= ids, a)
            self.assertIn(a["target"], ("web-ui", "presentation"))   # never the source medium itself

    def test_categories_per_target(self):
        out = self._derive("publication-print", fx.mod("dfp.medium").DEFAULT_TARGETS)
        cats = lambda t: {a["category"] for a in out if a["target"] == t}
        self.assertTrue({"button", "input", "hover-states"} <= cats("web-ui"))
        self.assertTrue({"slide-layout", "title-slide"} <= cats("presentation"))
        back = self._derive("web-ui", ["publication-print"])
        self.assertIn("page-geometry", {a["category"] for a in back})

    def test_dropping_a_target_removes_its_adaptations(self):
        out = self._derive("publication-print", ["publication-print", "presentation"])
        self.assertEqual({a["target"] for a in out}, {"presentation"})
        self.assertEqual(self._derive("publication-print", ["publication-print"]), [])
        self.assertEqual(self._derive("web-ui", ["web-ui"]), [])

    def test_adaptations_are_applicable_for_the_enabled_targets(self):
        m = fx.mod("dfp.medium")
        targets = ["web-ui", "publication-print"]
        applicable = set(m.applicability_for("publication-print", targets)["applicable"])
        for a in self._derive("publication-print", targets):
            self.assertIn(a["category"], applicable, a)

    def test_deterministic(self):
        t = fx.mod("dfp.medium").DEFAULT_TARGETS
        self.assertEqual(self._derive("publication-print", t), self._derive("publication-print", t))


class Units(unittest.TestCase):
    def test_dual_units(self):
        u = fx.mod("dfp.util").dual_units
        self.assertEqual(u("10.5pt"), "10.5pt (14px, 0.875rem)")
        self.assertEqual(u("50pt"), "50pt (66.667px, 4.167rem)")
        self.assertEqual(u("12px"), "12px")
        self.assertEqual(u("#231F20"), "#231F20")


if __name__ == "__main__":
    unittest.main()
